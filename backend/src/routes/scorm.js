'use strict';

// ─── SCORM: store the package, play it inside the hub ────────────────
//
// A SCORM package (Rise, Storyline, iSpring…) is a zip of static web
// content that expects to find a SCORM runtime — `window.API` (1.2) or
// `window.API_1484_11` (2004) — on a parent frame OF THE SAME ORIGIN.
// That is why "open it in a new tab" could never report a score: the
// content was served from wherever it was hosted, found no API, and the
// hub had to take the lawyer's word for it.
//
// This module closes the loop:
//
//   POST /api/v1/scorm/:courseId/:materialId/launch     (signed-in learner)
//        → unzips the stored package (inline row or Azure blob) into a
//          server-side cache, reads imsmanifest.xml for the entry href and
//          SCORM version, and answers with a player URL carrying a
//          short-lived signed path token.
//
//   GET  /api/v1/scorm/play/:token/__player
//        → a page served FROM THIS ORIGIN that provides the SCORM runtime
//          and frames the package entry, so API discovery just works.
//          Progress is saved back here, and mirrored to the hub with
//          postMessage so it can settle the attempt it opened.
//
//   GET  /api/v1/scorm/play/:token/<any path in the package>
//        → the package's own files. The token travels as a path segment,
//          so every relative asset request is authorised by construction.
//
//   GET/POST /api/v1/scorm/play/:token/__state
//        → the learner's cmi data (suspend_data, status, score…), keyed by
//          material + learner, so closing the tab and coming back resumes.
//
// The router is mounted BEFORE the global rate limiter: a Rise export is
// hundreds of small asset files and would blow a 120-requests-a-minute
// budget on the first screen.

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const router = express.Router();
const db = require('../db');
const store = require('../services/store');
const blob = require('../services/blobStorage');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

router.use(express.json({ limit: '4mb' })); // suspend_data can be generous

const CACHE_ROOT = path.join(os.tmpdir(), 'lad-scorm');
const TOKEN_AUD = 'scorm-play';
const TOKEN_TTL = '6h';
const MAX_ZIP_BYTES = 600 * 1024 * 1024;

// The origins allowed to EMBED the player. Mirrors the CORS allow-list —
// the hub pages live there.
const FRAME_ANCESTORS = [
  "'self'",
  'https://legalaffairstraining.com',
  'https://www.legalaffairstraining.com',
  'https://icy-mud-07d00dc03.7.azurestaticapps.net',
  'https://nice-ocean-0a45eff10.7.azurestaticapps.net',
].concat(config.isDev ? ['http://localhost:*', 'http://127.0.0.1:*'] : []).join(' ');

// ─── Access: same rule as course materials ──────────────────────────
const MATERIAL_ROLES = ['lad_admin', 'provider_admin', 'lad_super_admin', 'super_admin', 'dg'];
function canAccess(courseId, user) {
  if (!user) return false;
  if (MATERIAL_ROLES.includes(user.role)) return true;
  const course = db.prepare('SELECT id, private, owner_firm_id FROM courses WHERE id = ?').get(courseId);
  if (course && !store.canAccessCourse(course, user)) return false;
  if (user.role === 'firm_compliance_officer') return true;
  try {
    const b = db.prepare("SELECT 1 FROM bookings WHERE lawyer_id = ? AND course_id = ? AND status NOT IN ('cancelled','refunded') LIMIT 1").get(user.sub, courseId);
    if (b) return true;
  } catch (_) { /* fall through */ }
  try {
    const e = db.prepare('SELECT 1 FROM enrolment WHERE lawyer_id = ? AND course_id = ? LIMIT 1').get(user.sub, courseId);
    return !!e;
  } catch (_) { return false; }
}

// ─── Learner state ───────────────────────────────────────────────────
db.prepare(`CREATE TABLE IF NOT EXISTS scorm_state (
  material_id TEXT NOT NULL,
  lawyer_id   TEXT NOT NULL,
  cmi         TEXT,
  updated_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (material_id, lawyer_id)
)`).run();

// ─── The package on disk ─────────────────────────────────────────────
async function zipBuffer(m) {
  if (m.data) return Buffer.from(m.data, 'base64');
  if (m.storage_key && blob.isConfigured()) {
    const url = blob.getDownloadUrl(m.storage_key, m.file_name || 'package.zip');
    const r = await axios.get(url, { responseType: 'arraybuffer', maxContentLength: MAX_ZIP_BYTES, maxBodyLength: MAX_ZIP_BYTES });
    return Buffer.from(r.data);
  }
  throw Object.assign(new Error('This SCORM step has a link, not an uploaded package — links still open in their own tab.'), { status: 409 });
}

// imsmanifest.xml → { entry, version }. A light regex read, not an XML
// parser: manifests vary, but the launch resource is always a <resource>
// with an href, and the default organization's first item names it.
function readManifest(xml) {
  const version = /2004|CAM\s*1\.3/i.test((xml.match(/<\w*:?schemaversion[^>]*>([^<]*)</i) || [])[1] || '') ? '2004' : '1.2';
  const resources = {};
  let first = null;
  const resRe = /<resource\b[^>]*>/gi;
  let r;
  while ((r = resRe.exec(xml))) {
    const tag = r[0];
    const id = (tag.match(/\bidentifier\s*=\s*"([^"]+)"/i) || [])[1];
    const href = (tag.match(/\bhref\s*=\s*"([^"]+)"/i) || [])[1];
    const base = (tag.match(/xml:base\s*=\s*"([^"]+)"/i) || [])[1] || '';
    const sco = /scormtype\s*=\s*"sco"/i.test(tag);
    if (id && href) {
      resources[id] = base + href;
      if (!first || (sco && !first.sco)) first = { href: base + href, sco };
    }
  }
  const itemRe = /<item\b[^>]*\bidentifierref\s*=\s*"([^"]+)"[^>]*>/gi;
  let it;
  while ((it = itemRe.exec(xml))) {
    if (resources[it[1]]) return { entry: resources[it[1]], version };
  }
  if (first) return { entry: first.href, version };
  return null;
}

function extractedDir(materialId) {
  return path.join(CACHE_ROOT, String(materialId).replace(/[^A-Za-z0-9_-]/g, '_'));
}

async function ensureExtracted(m) {
  const dir = extractedDir(m.id);
  const meta = path.join(dir, '.lad-entry.json');
  if (fs.existsSync(meta)) {
    try { return JSON.parse(fs.readFileSync(meta, 'utf8')); } catch (_) { /* re-extract */ }
  }
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(await zipBuffer(m));
  fs.mkdirSync(dir, { recursive: true });
  // Some authoring tools wrap everything in one top-level folder; the
  // manifest tells us. Extract flat, guarding against zip-slip.
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const rel = e.entryName.replace(/\\/g, '/');
    if (rel.split('/').some((p) => p === '..')) continue;
    const out = path.join(dir, rel);
    if (!out.startsWith(dir + path.sep)) continue;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, e.getData());
  }
  // Find the manifest — usually at the root, sometimes one folder down.
  let manifestPath = path.join(dir, 'imsmanifest.xml');
  let prefix = '';
  if (!fs.existsSync(manifestPath)) {
    const kids = fs.readdirSync(dir).filter((k) => fs.statSync(path.join(dir, k)).isDirectory());
    for (const k of kids) {
      if (fs.existsSync(path.join(dir, k, 'imsmanifest.xml'))) { manifestPath = path.join(dir, k, 'imsmanifest.xml'); prefix = k + '/'; break; }
    }
  }
  if (!fs.existsSync(manifestPath)) {
    throw Object.assign(new Error('No imsmanifest.xml in the package — upload the SCORM zip exactly as the authoring tool exported it, without unzipping or re-zipping a folder.'), { status: 422 });
  }
  const parsed = readManifest(fs.readFileSync(manifestPath, 'utf8'));
  if (!parsed) throw Object.assign(new Error('The package manifest names no launchable resource.'), { status: 422 });
  const info = { entry: prefix + parsed.entry, version: parsed.version };
  fs.writeFileSync(meta, JSON.stringify(info));
  return info;
}

// ─── Tokens ──────────────────────────────────────────────────────────
function signPlayToken(m, user) {
  return jwt.sign(
    { aud: TOKEN_AUD, mid: m.id, cid: m.course_id, sub: user.sub, name: user.name || '' },
    config.jwt.secret,
    { expiresIn: TOKEN_TTL, algorithm: 'HS256' }
  );
}
function verifyPlayToken(token) {
  try { return jwt.verify(token, config.jwt.secret, { audience: TOKEN_AUD, algorithms: ['HS256'] }); }
  catch (_) { return null; }
}

// ─── Launch ──────────────────────────────────────────────────────────
router.post('/:courseId/:materialId/launch', requireAuth, async (req, res) => {
  if (!canAccess(req.params.courseId, req.user)) {
    return res.status(403).json({ error: 'no_access', message: 'Enrol on this topic to open its assessment.' });
  }
  const m = db.prepare('SELECT * FROM course_materials WHERE id = ? AND course_id = ?')
    .get(req.params.materialId, req.params.courseId);
  if (!m) return res.status(404).json({ error: 'Material not found' });
  if (!m.data && !m.storage_key) {
    return res.status(409).json({ error: 'link_only', message: 'This SCORM step is a link, not an uploaded package.', url: m.url || null });
  }
  try {
    const info = await ensureExtracted(m);
    const token = signPlayToken(m, req.user);
    res.json({
      player_url: `/api/v1/scorm/play/${token}/__player`,
      entry: info.entry,
      version: info.version,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: 'launch_failed', message: e.message });
  }
});

// ─── Learner state ────────────────────────────────────────────────
router.get('/play/:token/__state', (req, res) => {
  const t = verifyPlayToken(req.params.token);
  if (!t) return res.status(401).json({ error: 'bad_token' });
  const row = db.prepare('SELECT cmi FROM scorm_state WHERE material_id = ? AND lawyer_id = ?').get(t.mid, t.sub);
  let cmi = {};
  if (row && row.cmi) { try { cmi = JSON.parse(row.cmi); } catch (_) {} }
  res.json({ cmi, learner: { id: t.sub, name: t.name || '' } });
});

router.post('/play/:token/__state', (req, res) => {
  const t = verifyPlayToken(req.params.token);
  if (!t) return res.status(401).json({ error: 'bad_token' });
  const cmi = req.body && typeof req.body.cmi === 'object' ? req.body.cmi : null;
  if (!cmi) return res.status(400).json({ error: 'cmi required' });
  db.prepare(`INSERT INTO scorm_state (material_id, lawyer_id, cmi, updated_at)
              VALUES (?,?,?,datetime('now'))
              ON CONFLICT(material_id, lawyer_id) DO UPDATE SET cmi = excluded.cmi, updated_at = excluded.updated_at`)
    .run(t.mid, t.sub, JSON.stringify(cmi));
  // The package's own verdict settles the learner's step the moment it is
  // saved — not when (or whether) the page around it gets round to closing.
  settleFromState(t.mid, t.sub, cmi).then((n) => res.json({ ok: true, settled: n })).catch(() => res.json({ ok: true }));
});

// ─── Settlement ───────────────────────────────────────────────────────
// A SCORM step counts as done when the package says so: lesson_status
// completed/passed/failed (1.2) or completion_status completed /
// success_status passed|failed (2004). When that arrives, every open
// attempt this learner has on a step that plays this package is closed
// with the package's score; if there is no open attempt at all — the
// learner opened it from the reference library, or a tab died before the
// hub could open one — one is written and closed, so progress is never
// lost to the page around the player.
function verdictOf(cmi) {
  const g = (k) => (cmi[k] == null ? '' : String(cmi[k]));
  const ls = g('cmi.core.lesson_status'), cs = g('cmi.completion_status'), ss = g('cmi.success_status');
  const done = ls === 'completed' || ls === 'passed' || ls === 'failed' || cs === 'completed' || ss === 'passed' || ss === 'failed';
  let score = null;
  const raw = g('cmi.core.score.raw') || g('cmi.score.raw');
  if (raw !== '' && Number.isFinite(Number(raw))) score = Number(raw);
  else { const sc = g('cmi.score.scaled'); if (sc !== '' && Number.isFinite(Number(sc))) score = Math.round(Number(sc) * 100); }
  return { done, score, status: cs || ls || 'unknown' };
}
async function settleFromState(materialId, lawyerId, cmi) {
  const v = verdictOf(cmi || {});
  if (!v.done) return 0;
  const spine = require('../lms/store');
  const steps = db.prepare("SELECT id FROM activity WHERE kind = 'scorm' AND material_id = ? AND published = 1").all(materialId);
  let n = 0;
  for (const a of steps) {
    const open = db.prepare("SELECT id, started_at FROM activity_attempt WHERE activity_id = ? AND lawyer_id = ? AND status = 'open' ORDER BY started_at DESC").all(a.id, lawyerId);
    let ids = open.map((r) => r.id);
    if (!ids.length) {
      const prog = db.prepare('SELECT status FROM activity_progress WHERE activity_id = ? AND lawyer_id = ?').get(a.id, lawyerId);
      if (prog && ['completed', 'passed', 'failed'].includes(prog.status)) continue; // already settled
      const att = await spine.startAttempt({ activityId: a.id, lawyerId, detail: { source: 'scorm_state' } });
      if (!att) continue;
      ids = [att.id];
    }
    for (const id of ids) {
      const row = db.prepare('SELECT started_at FROM activity_attempt WHERE id = ?').get(id);
      const seconds = row && row.started_at ? Math.max(1, Math.round((Date.now() - new Date(row.started_at.replace(' ', 'T') + (row.started_at.endsWith('Z') ? '' : 'Z')).getTime()) / 1000)) : 0;
      await spine.closeAttempt(id, lawyerId, {
        completed: true, abandoned: false, score: v.score, seconds: Number.isFinite(seconds) ? seconds : 0,
        percent: v.score != null ? v.score : 100, detail: { source: 'scorm_state', settled_at: 'commit', package_status: v.status },
      });
      n++;
    }
  }
  return n;
}
router.settleFromState = settleFromState;
router.verdictOf = verdictOf;

// ─── The player ──────────────────────────────────────────────────────
function playHeaders(res, contentType) {
  res.setHeader('Content-Type', contentType);
  // Helmet's API-wide CSP says default-src 'none' / frame-ancestors 'none';
  // this route genuinely serves embeddable HTML, so it overrides with a
  // policy scoped to the package sandbox.
  res.setHeader('Content-Security-Policy',
    "default-src 'self' blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; " +
    "font-src 'self' data:; connect-src 'self' data: blob:; frame-src 'self' blob:; " +
    'frame-ancestors ' + FRAME_ANCESTORS);
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}

router.get('/play/:token/__player', (req, res) => {
  const t = verifyPlayToken(req.params.token);
  if (!t) return res.status(401).send('This assessment link has expired — go back to the hub and start it again.');
  const m = db.prepare('SELECT * FROM course_materials WHERE id = ?').get(t.mid);
  if (!m) return res.status(404).send('Package not found');
  let info;
  try { info = JSON.parse(fs.readFileSync(path.join(extractedDir(t.mid), '.lad-entry.json'), 'utf8')); }
  catch (_) { return res.status(409).send('Package not prepared — go back to the hub and start it again.'); }
  playHeaders(res, 'text/html; charset=utf-8');
  res.send(playerPage(req.params.token, info));
});

const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript',
  css: 'text/css', json: 'application/json', xml: 'application/xml', xsd: 'application/xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon',
  mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', vtt: 'text/vtt',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  txt: 'text/plain; charset=utf-8', csv: 'text/csv', map: 'application/json', wasm: 'application/wasm', pdf: 'application/pdf',
};

router.get('/play/:token/*', (req, res) => {
  const t = verifyPlayToken(req.params.token);
  if (!t) return res.status(401).json({ error: 'bad_token' });
  const rel = decodeURIComponent(req.params[0] || '').replace(/\\/g, '/');
  if (!rel || rel.split('/').some((p) => p === '..')) return res.status(400).json({ error: 'bad_path' });
  const dir = extractedDir(t.mid);
  const file = path.join(dir, rel.split('?')[0]);
  if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return res.status(404).json({ error: 'not_found' });
  }
  const ext = path.extname(file).slice(1).toLowerCase();
  playHeaders(res, MIME[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  fs.createReadStream(file).pipe(res);
});

// ─── The runtime the package talks to ────────────────────────────────
// One page, both dialects. The cmi data model is a flat key→value map:
// GetValue answers from it (with sane defaults), SetValue writes to it,
// Commit persists it and mirrors status + score to the hub.
function playerPage(token, info) {
  const base = `/api/v1/scorm/play/${token}/`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Assessment</title>
<style>html,body{margin:0;height:100%;background:#0e1120}iframe{border:0;width:100%;height:100%;display:block}</style>
</head><body>
<iframe id="sco" allow="autoplay; fullscreen" allowfullscreen></iframe>
<script>
(function(){
  'use strict';
  var BASE=${JSON.stringify(base)}, ENTRY=${JSON.stringify(info.entry)}, VERSION=${JSON.stringify(info.version)};
  var cmi={}, learner={id:'',name:''}, err='0', dirty=false, finished=false, t0=Date.now();

  function get(k,d){ return (k in cmi)?String(cmi[k]):(d===undefined?'':d); }
  function set(k,v){ cmi[k]=String(v); dirty=true; return 'true'; }

  function num(v){ var n=parseFloat(v); return isNaN(n)?null:n; }
  function status(){
    if(VERSION==='2004'){
      var cs=get('cmi.completion_status','unknown'), ss=get('cmi.success_status','unknown');
      return { completed: cs==='completed'||ss==='passed'||ss==='failed', passedKnown:ss==='passed'||ss==='failed', passed:ss==='passed', raw:num(get('cmi.score.raw')), scaled:num(get('cmi.score.scaled')) };
    }
    var ls=get('cmi.core.lesson_status','not attempted');
    return { completed: ls==='completed'||ls==='passed'||ls==='failed', passedKnown:ls==='passed'||ls==='failed', passed:ls==='passed', raw:num(get('cmi.core.score.raw')), scaled:null };
  }
  function tell(event){
    var s=status();
    var percent = s.scaled!==null ? Math.round(s.scaled*100) : (s.raw!==null?Math.round(s.raw):null);
    try{ parent.postMessage({ladScorm:{event:event, completed:s.completed, passedKnown:s.passedKnown, passed:s.passed, score:s.raw, percent:percent, seconds:Math.round((Date.now()-t0)/1000)}}, '*'); }catch(e){}
  }
  function save(beacon){
    dirty=false;
    var payload=JSON.stringify({cmi:cmi});
    if(beacon && navigator.sendBeacon){
      try{ navigator.sendBeacon(BASE+'__state', new Blob([payload],{type:'application/json'})); return; }catch(e){}
    }
    fetch(BASE+'__state',{method:'POST',headers:{'Content-Type':'application/json'},body:payload,keepalive:true}).catch(function(){});
  }

  function defaults12(k){
    switch(k){
      case 'cmi.core.student_id': return learner.id;
      case 'cmi.core.student_name': return learner.name;
      case 'cmi.core.lesson_status': return 'not attempted';
      case 'cmi.core.entry': return get('cmi.suspend_data')||get('cmi.core.lesson_location')?'resume':'ab-initio';
      case 'cmi.core.credit': return 'credit';
      case 'cmi.core.lesson_mode': return 'normal';
      case 'cmi.core.total_time': return '0000:00:00.00';
      case 'cmi.launch_data': return '';
      case 'cmi.core.score._children': return 'raw,min,max';
      case 'cmi.core._children': return 'student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time';
      case 'cmi._version': return '3.4';
      case 'cmi.interactions._count': case 'cmi.objectives._count': return String(countOf(k));
      case 'cmi.student_data.mastery_score': case 'cmi.student_data.max_time_allowed': case 'cmi.student_data.time_limit_action': return '';
      default: return '';
    }
  }
  function defaults04(k){
    switch(k){
      case 'cmi.learner_id': return learner.id;
      case 'cmi.learner_name': return learner.name;
      case 'cmi.completion_status': return 'unknown';
      case 'cmi.success_status': return 'unknown';
      case 'cmi.entry': return get('cmi.suspend_data')||get('cmi.location')?'resume':'ab-initio';
      case 'cmi.credit': return 'credit';
      case 'cmi.mode': return 'normal';
      case 'cmi.total_time': return 'PT0H0M0S';
      case 'cmi._version': return '1.0';
      case 'cmi.interactions._count': case 'cmi.objectives._count': case 'cmi.comments_from_learner._count': case 'cmi.comments_from_lms._count': return String(countOf(k));
      default: return '';
    }
  }
  function countOf(k){
    var prefix=k.replace(/\\._count$/,'')+'.', max=-1;
    for(var key in cmi){ if(key.indexOf(prefix)===0){ var m=key.slice(prefix.length).match(/^(\\d+)\\./); if(m) max=Math.max(max,parseInt(m[1],10)); } }
    return max+1;
  }

  var api12={
    LMSInitialize:function(){ err='0'; if(get('cmi.core.lesson_status','')===''||get('cmi.core.lesson_status')==='not attempted'){ set('cmi.core.lesson_status','incomplete'); } tell('start'); return 'true'; },
    LMSFinish:function(){ err='0'; finished=true; save(); tell('finish'); return 'true'; },
    LMSGetValue:function(k){ err='0'; return (k in cmi)?String(cmi[k]):defaults12(k); },
    LMSSetValue:function(k,v){ err='0'; return set(k,v); },
    LMSCommit:function(){ err='0'; save(); tell('commit'); return 'true'; },
    LMSGetLastError:function(){ return err; },
    LMSGetErrorString:function(){ return 'No error'; },
    LMSGetDiagnostic:function(){ return ''; }
  };
  var api04={
    Initialize:function(){ err='0'; tell('start'); return 'true'; },
    Terminate:function(){ err='0'; finished=true; save(); tell('finish'); return 'true'; },
    GetValue:function(k){ err='0'; return (k in cmi)?String(cmi[k]):defaults04(k); },
    SetValue:function(k,v){ err='0'; return set(k,v); },
    Commit:function(){ err='0'; save(); tell('commit'); return 'true'; },
    GetLastError:function(){ return err; },
    GetErrorString:function(){ return 'No error'; },
    GetDiagnostic:function(){ return ''; }
  };
  // Publish both — content probes for the one it was built against.
  window.API=api12; window.API_1484_11=api04;

  window.addEventListener('beforeunload',function(){ if(dirty||!finished) save(true); });
  setInterval(function(){ if(dirty) save(); }, 15000);

  fetch(BASE+'__state').then(function(r){return r.json();}).then(function(j){
    cmi=(j&&j.cmi)||{}; learner=(j&&j.learner)||learner;
    delete cmi['cmi.core.session_time']; delete cmi['cmi.session_time'];
    document.getElementById('sco').src=BASE+ENTRY;
  }).catch(function(){ document.getElementById('sco').src=BASE+ENTRY; });
})();
</script>
</body></html>`;
}

module.exports = router;
