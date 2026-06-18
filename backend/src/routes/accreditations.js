'use strict';

// ─────────────────────────────────────────────────────────────────────
// Accreditations — provider applications, firm internal-session submissions,
// and the LAD review workspace.
//
//   POST   /                       submit (provider form / firm session — public/optional auth)
//   GET    /                       (reviewer)  queue + counts (?status,reviewer,search,limit)
//   GET    /_/reviewers            (reviewer)  distinct reviewer names
//   GET    /catalogue              (public)    approved courses
//   GET    /:ref                   (reviewer/owner) one application
//   PATCH  /:ref                   (reviewer)  status | scores | reviewer1/2 | final_points/credits
//   POST   /:ref/ai-rationale      (reviewer)  AiModel assessment text
//   GET    /:code/attendees        (owner/rev) attendance for a code
//   POST   /:code/attendees        (owner/rev) record attendance -> CPD
//
// Point awards match attendees by the canonical lawyer id (L-#####) first,
// then by email — so points reliably land on the right profile.
// ─────────────────────────────────────────────────────────────────────

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const store = require('../services/store');
const aimodel = require('../services/aimodel');
const log = require('../logger');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const REVIEWER_ROLES = ['lad_admin', 'lad_intelligence', 'lad_super_admin', 'dg'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const isReviewer = (u) => !!u && REVIEWER_ROLES.includes(u.role);
const parse = (s, fb) => { try { return s ? JSON.parse(s) : fb; } catch (_) { return fb; } };
const newRef = (p) => p + crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
const rid = (p) => p + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 5);

function uniqueRef(proposed, nameRaw) {
  if (proposed && !db.prepare('SELECT 1 FROM accreditations WHERE ref = ?').get(proposed)) return proposed;
  // Follow the agreed structured naming pattern from submission onward.
  return structuredCode(nameRaw);
}
// Agreed course-code methodology: <3 letters of the provider/firm name><2-digit
// year><2-digit sequence for that prefix+year>. E.g. Galadari, 2026, 1st course
// -> "GAL2601". The sequence is unique across BOTH ref and accreditation_code so
// the same structured code carries from submission through to the issued code.
function structuredCode(nameRaw) {
  const letters = (String(nameRaw || 'LAD').replace(/[^A-Za-z]/g, '') || 'LAD').toUpperCase();
  const prefix = (letters.slice(0, 3) + 'XXX').slice(0, 3);
  const yy = String(new Date().getFullYear()).slice(-2);
  const base = prefix + yy;
  let max = 0;
  for (const col of ['accreditation_code', 'ref']) {
    for (const r of db.prepare(`SELECT ${col} c FROM accreditations WHERE ${col} LIKE ?`).all(base + '%')) {
      const m = String(r.c || '').slice(base.length).match(/^(\d+)/);
      if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
    }
  }
  const exists = (code) => db.prepare('SELECT 1 FROM accreditations WHERE accreditation_code = ? OR ref = ?').get(code, code);
  let seq = max + 1;
  let code = base + String(seq).padStart(2, '0');
  while (exists(code)) { seq += 1; code = base + String(seq).padStart(2, '0'); }
  return code;
}
function genCode(row) {
  const p = parse(row.payload, {});
  // A submission already issued a structured ref keeps it as its code.
  if (/^[A-Z]{3}\d{2,}$/.test(row.ref || '')) return row.ref;
  return structuredCode(p.providerName || p.firm || p.orgName || row.submitted_by || 'LAD');
}
function emailOf(p) { return String((p && (p.applicantEmail || p.contactEmail || p.submittedByEmail)) || '').toLowerCase() || null; }
function ownsRow(u, row) {
  if (!u || !row) return false;
  if (isReviewer(u)) return true;
  const e = (u.email || '').toLowerCase();
  if (e && row.submitted_by_email && row.submitted_by_email.toLowerCase() === e) return true;
  if (e && emailOf(parse(row.payload, {})) === e) return true;
  return false;
}

// Resolve an attendee item ({id, email, ...}) to a lawyer record — id first.
function matchLawyer(item) {
  if (!item) return null;
  const id = (item.id || item.laId || item.lawyerId || item.practitionerId || '').toString().trim();
  if (id && /^L-/i.test(id)) { const byId = store.getLawyerById(id); if (byId) return byId; }
  const email = (item.email || (typeof item === 'string' ? item : '') || '').toString().trim().toLowerCase();
  if (EMAIL_RE.test(email)) { const byEmail = store.getLawyerByEmail(email); if (byEmail) return byEmail; }
  if (id) { const byId = store.getLawyerById(id); if (byId) return byId; }
  return null;
}

function rowOut(r) {
  return {
    ref: r.ref, type: r.type, status: r.status, payload: parse(r.payload, {}),
    submitted_by: r.submitted_by, submitted_at: r.submitted_at,
    reviewer1: r.reviewer1, reviewer2: r.reviewer2, scores: parse(r.scores, { r1: {}, r2: {}, ai: {} }),
    final_points: r.final_points, final_credits: r.final_credits, ai_rationale: r.ai_rationale,
    reviewed_by: r.reviewed_by, reviewed_at: r.reviewed_at, accreditation_code: r.accreditation_code,
    points_awarded_at: r.points_awarded_at,
  };
}

// Award CPD points for a session submission's attendee lawyers. Idempotent:
// once points_awarded_at is set, it never double-awards.
function awardSessionPoints(row) {
  if (row.points_awarded_at) return { already: true, awarded: [], unmatched: [], perLawyer: 0, total: 0 };
  const p = parse(row.payload, {});
  const lawyers = Array.isArray(p.lawyers) ? p.lawyers : (Array.isArray(p.attendees) ? p.attendees : []);
  const per = Number(row.final_points != null ? row.final_points : (p.pointsPerLawyer != null ? p.pointsPerLawyer : (p.pointsRequested || 0))) || 0;
  const code = row.accreditation_code || p.accreditationCode || row.ref;
  const title = p.courseTitle || p.course || p.title || row.ref;
  const provider = p.providerName || p.firm || row.submitted_by || '';

  if (!lawyers.length || !per) {
    db.prepare('UPDATE accreditations SET points_awarded_at = ? WHERE ref = ?').run(new Date().toISOString(), row.ref);
    return { awarded: [], unmatched: lawyers.map((l) => (l && (l.email || l.name)) || String(l)), perLawyer: per, total: 0,
      note: per ? 'No attendees matched a lawyer account.' : 'No points configured for this submission.' };
  }

  const insert = db.prepare(`INSERT INTO cpd_records
    (id, attendee_email, attendee_name, lawyer_id, course_code, course_title, provider, points, recorded_by_id, recorded_by_email)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(attendee_email, course_code) DO NOTHING`);

  const awarded = [], unmatched = [];
  const tx = db.transaction(() => {
    for (const item of lawyers) {
      const lawyer = matchLawyer(item);
      const email = ((item && item.email) || (lawyer && lawyer.email) || '').toString().toLowerCase();
      if (!lawyer) { unmatched.push((item && (item.email || item.name)) || String(item)); continue; }
      insert.run(rid('CPD-'), email || (lawyer.id + '@lad'), (item && item.name) || `${lawyer.first_name || ''} ${lawyer.last_name || ''}`.trim() || null,
        lawyer.id, code, title, provider, per, row.reviewed_by || row.submitted_by || null, (row.submitted_by_email || '').toLowerCase() || null);
      store.awardCpdPoints({ lawyerId: lawyer.id, points: per, source: 'accreditation', refId: row.ref });
      awarded.push(email || lawyer.id);
    }
    db.prepare('UPDATE accreditations SET points_awarded_at = ? WHERE ref = ?').run(new Date().toISOString(), row.ref);
  });
  tx();
  return { awarded, unmatched, perLawyer: per, total: awarded.length * per };
}

// ─── Submit ──────────────────────────────────────────────────────────
router.post('/', optionalAuth, (req, res) => {
  const p = req.body || {};
  if (!p || typeof p !== 'object' || (!p.providerName && !p.courseTitle && !p.course && !p.title && p.type !== 'session_submission')) {
    return res.status(400).json({ error: 'A provider or course name is required.' });
  }
  const u = req.user || null;
  const ref = uniqueRef(p.referenceNumber, p.providerName || p.firm || p.orgName || (u && u.name) || (u && u.email) || 'LAD');
  const now = new Date().toISOString();
  const type = p.type || 'new';

  // Firm internal session against an already-accredited course → auto-approve
  // and award immediately. Everything else enters the review queue.
  const linkedCode = (p.accreditationCode || '').toString().trim() || null;
  const linked = linkedCode ? db.prepare("SELECT * FROM accreditations WHERE accreditation_code = ? AND status = 'approved'").get(linkedCode) : null;
  // Auto-approve a firm session only when its code resolves to an approved
  // course; otherwise it enters the review queue. Points come from the
  // approved course (authoritative) so submissions can't inflate them.
  const autoApprove = type === 'session_submission' && !!linked;
  const status = autoApprove ? 'approved' : 'pending';
  const authPoints = linked ? (linked.final_points != null ? linked.final_points : (parse(linked.payload, {}).pointsRequested || null)) : null;

  db.prepare(`INSERT INTO accreditations
    (ref, type, status, payload, submitted_by, submitted_by_email, submitted_at,
     accreditation_code, final_points, reviewed_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    ref, type, status, JSON.stringify(p),
    (u && u.email) || p.submittedBy || p.contactName || null,
    (u && u.email && u.email.toLowerCase()) || emailOf(p),
    p.submittedAt || now, autoApprove ? linked.accreditation_code : null,
    autoApprove ? authPoints : null, autoApprove ? now : null, now, now
  );

  let pointsAwarded = null;
  if (autoApprove) {
    try { pointsAwarded = awardSessionPoints(db.prepare('SELECT * FROM accreditations WHERE ref = ?').get(ref)); }
    catch (e) { log.error('award_failed', { ref, error: e.message }); }
  }
  res.status(201).json({ ok: true, ref, data: { ref, status, accreditationCode: autoApprove ? linkedCode : undefined }, pointsAwarded });
});

// ─── Queue + counts ──────────────────────────────────────────────────
// Reviewers get the full queue; everyone else gets their OWN submissions
// (so providers/firms can track what they applied for).
router.get('/', requireAuth, (req, res) => {
  if (!isReviewer(req.user)) {
    const email = (req.user.email || '').toLowerCase();
    const rows = db.prepare(
      `SELECT * FROM accreditations
       WHERE LOWER(submitted_by_email) = ? OR payload LIKE ?
       ORDER BY submitted_at DESC`
    ).all(email, '%"applicantEmail":"' + email + '"%').map(rowOut);
    const counts = { pending: 0, approved: 0, rejected: 0, returned: 0 };
    rows.forEach((r) => { if (counts[r.status] !== undefined) counts[r.status]++; });
    return res.json({ rows, counts, mine: true });
  }
  const { status, reviewer, search } = req.query;
  const limit = Math.min(500, parseInt(req.query.limit || '200', 10) || 200);
  let sql = 'SELECT * FROM accreditations WHERE 1=1';
  const args = [];
  if (status && status !== 'all') { sql += ' AND status = ?'; args.push(status); }
  if (reviewer) { sql += ' AND (reviewer1 = ? OR reviewer2 = ?)'; args.push(reviewer, reviewer); }
  if (search) { const q = '%' + search + '%'; sql += ' AND (ref LIKE ? OR payload LIKE ?)'; args.push(q, q); }
  sql += ' ORDER BY submitted_at ASC LIMIT ?'; args.push(limit);
  const rows = db.prepare(sql).all(...args).map(rowOut);
  const counts = { pending: 0, approved: 0, rejected: 0, returned: 0 };
  for (const r of db.prepare('SELECT status, COUNT(*) n FROM accreditations GROUP BY status').all()) {
    if (counts[r.status] !== undefined) counts[r.status] = r.n;
  }
  res.json({ rows, counts });
});

router.get('/_/reviewers', requireAuth, (req, res) => {
  if (!isReviewer(req.user)) return res.status(403).json({ error: 'Reviewers only' });
  const set = new Set();
  for (const r of db.prepare('SELECT DISTINCT reviewer1 r FROM accreditations WHERE reviewer1 IS NOT NULL').all()) set.add(r.r);
  for (const r of db.prepare('SELECT DISTINCT reviewer2 r FROM accreditations WHERE reviewer2 IS NOT NULL').all()) set.add(r.r);
  res.json({ reviewers: Array.from(set).filter(Boolean).sort() });
});

// Public catalogue of approved courses. Returns each course with BOTH the
// review/booking field names the portals expect (accreditation_code,
// courseTitle, points, credits, ref, applied_at) and friendly aliases.
function catalogCourse(r) {
  const p = parse(r.payload, {});
  const points = r.final_points != null ? r.final_points : (p.pointsRequested != null ? p.pointsRequested : 0);
  const credits = r.final_credits != null ? r.final_credits : (p.credits != null ? p.credits : (p.proposedCredits != null ? p.proposedCredits : 5));
  const title = p.courseTitle || p.course || p.title || r.ref;
  const provider = p.providerName || p.firm || r.submitted_by || 'Accredited provider';
  return {
    accreditation_code: r.accreditation_code,
    courseCode: r.accreditation_code,
    ref: r.ref,
    courseTitle: title,
    title,
    provider,
    format: p.format || '',
    points: Number(points) || 0,
    cpdPoints: Number(points) || 0,
    credits: Number(credits) || 5,
    areas: p.areas || (Array.isArray(p.topics) ? p.topics.map((t) => t.label).join(', ') : ''),
    summary: p.summary || p.description || '',
    applied_at: r.submitted_at,
    approvedAt: r.reviewed_at,
    earliest_session_date: p.dateHeld || p.earliest_session_date || '',
  };
}
function sendCatalog(_req, res) {
  const rows = db.prepare("SELECT * FROM accreditations WHERE status = 'approved' AND accreditation_code IS NOT NULL ORDER BY reviewed_at DESC").all();
  res.json({ courses: rows.map(catalogCourse) });
}
router.get('/catalogue', sendCatalog);
router.get('/catalog', sendCatalog);
router.get('/_/catalog', sendCatalog);
router.get('/_/catalogue', sendCatalog);

router.get('/:ref', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM accreditations WHERE ref = ?').get(req.params.ref);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!ownsRow(req.user, row)) return res.status(403).json({ error: 'Forbidden' });
  res.json(rowOut(row));
});

// ─── PATCH ───────────────────────────────────────────────────────────
router.patch('/:ref', requireAuth, (req, res) => {
  if (!isReviewer(req.user)) return res.status(403).json({ error: 'Reviewers only' });
  const row = db.prepare('SELECT * FROM accreditations WHERE ref = ?').get(req.params.ref);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const now = new Date().toISOString();
  const me = req.user.email || req.user.sub || null;

  const sets = [], args = [];
  if (b.scores !== undefined) { sets.push('scores = ?'); args.push(JSON.stringify(b.scores || {})); }
  if (b.reviewer1 !== undefined) { sets.push('reviewer1 = ?'); args.push(b.reviewer1 || null); }
  if (b.reviewer2 !== undefined) { sets.push('reviewer2 = ?'); args.push(b.reviewer2 || null); }
  if (b.final_points !== undefined) { sets.push('final_points = ?'); args.push(b.final_points == null ? null : Math.round(Number(b.final_points))); }
  if (b.final_credits !== undefined) { sets.push('final_credits = ?'); args.push(b.final_credits == null ? null : Math.round(Number(b.final_credits))); }
  if (b.ai_rationale !== undefined) { sets.push('ai_rationale = ?'); args.push(b.ai_rationale || null); }

  let courseCode = row.accreditation_code;
  if (b.status !== undefined) {
    if (!['pending', 'approved', 'rejected', 'returned'].includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
    sets.push('status = ?', 'reviewed_by = ?', 'reviewed_at = ?');
    args.push(b.status, me, now);
    if (b.status === 'approved' && !courseCode) { courseCode = genCode(row); sets.push('accreditation_code = ?'); args.push(courseCode); }
  }
  if (!sets.length) return res.status(400).json({ error: 'No updates supplied' });
  sets.push('updated_at = ?'); args.push(now, row.ref);
  db.prepare(`UPDATE accreditations SET ${sets.join(', ')} WHERE ref = ?`).run(...args);

  // Award on approval of a firm session submission.
  let pointsAwarded = null;
  const updated = db.prepare('SELECT * FROM accreditations WHERE ref = ?').get(row.ref);
  if (b.status === 'approved' && updated.type === 'session_submission') {
    try { pointsAwarded = awardSessionPoints(updated); } catch (e) { log.error('award_failed', { ref: row.ref, error: e.message }); }
  }
  res.json(Object.assign({ ok: true }, rowOut(db.prepare('SELECT * FROM accreditations WHERE ref = ?').get(row.ref)),
    pointsAwarded ? { pointsAwarded } : {}, courseCode ? { courseCode } : {}));
});

// ─── AI rationale ────────────────────────────────────────────────────
router.post('/:ref/ai-rationale', requireAuth, async (req, res, next) => {
  if (!isReviewer(req.user)) return res.status(403).json({ error: 'Reviewers only' });
  const row = db.prepare('SELECT * FROM accreditations WHERE ref = ?').get(req.params.ref);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!aimodel.configured()) return res.status(503).json({ error: 'AiModel is not configured' });
  const p = parse(row.payload, {});
  const profile = [
    `Reference: ${row.ref} (${row.type})`,
    `Provider: ${p.providerName || p.firm || row.submitted_by || 'n/a'}`,
    `Course: ${p.courseTitle || p.course || p.title || 'n/a'}`,
    `Format: ${p.format || 'n/a'}; Duration: ${p.duration || 'n/a'}`,
    `Points requested: ${p.pointsRequested != null ? p.pointsRequested : (p.pointsPerLawyer != null ? p.pointsPerLawyer : 'n/a')}`,
    `Audience: ${p.audience || 'n/a'}`,
    `Description: ${p.description || p.summary || 'n/a'}`,
    `Learning objectives: ${Array.isArray(p.learningObjectives) ? p.learningObjectives.join('; ') : (p.learningObjectives || p.objectives || 'n/a')}`,
  ].join('\n');
  // Rubric criteria depend on the application kind (course vs renewal).
  const isRenewal = /renew/i.test(row.type || '');
  const CRITERIA = isRenewal
    ? [['compliance','Compliance history'],['quality','Delivery quality'],['reach','Reach & demand'],['governance','Governance & QA'],['fees','Fee structure']]
    : [['relevance','Relevance & alignment'],['depth','Substantive depth'],['trainer','Trainer credentials'],['materials','Quality of materials'],['pedagogy','Delivery & pedagogy']];
  const keys = CRITERIA.map((c) => c[0]);
  const critList = CRITERIA.map((c) => `- ${c[0]}: ${c[1]}`).join('\n');

  const system = 'You are Lex, an accreditation assessor for the Dubai Legal Affairs Department CLPD programme. '
    + 'Score the submission on EACH listed criterion from 1 to 10 (10 = excellent), recommend the CPD points '
    + '(about 1 point per hour of substantive learning), and write a 4–6 sentence rationale ending with a clear '
    + 'recommendation. Reply with ONLY a JSON object: {"scores": {<criterionKey>: integer 1-10, ...}, '
    + '"recommendedPoints": integer, "recommendation": "approve"|"request_changes"|"reject", "rationale": string}. '
    + 'Use EXACTLY these criterion keys:\n' + critList;
  try {
    const text = await aimodel.chat({ system, messages: [{ role: 'user', content: 'Assess this submission:\n\n' + profile }], maxTokens: 700, temperature: 0.3 });
    let parsed = null; try { const m = text.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : text); } catch (_) {}
    const rationale = (parsed && parsed.rationale) ? String(parsed.rationale) : text;
    const aiScores = {};
    if (parsed && parsed.scores && typeof parsed.scores === 'object') {
      for (const k of keys) {
        const v = Math.round(Number(parsed.scores[k]));
        if (Number.isFinite(v)) aiScores[k] = Math.max(1, Math.min(10, v));
      }
    }
    const recommendedPoints = parsed && parsed.recommendedPoints != null ? Math.max(0, Math.round(Number(parsed.recommendedPoints))) : null;
    const recommendation = parsed && parsed.recommendation ? String(parsed.recommendation) : null;
    const scoresObj = parse(row.scores, { r1: {}, r2: {}, ai: {} });
    scoresObj.ai = aiScores;
    db.prepare('UPDATE accreditations SET ai_rationale = ?, scores = ?, updated_at = ? WHERE ref = ?')
      .run(rationale, JSON.stringify(scoresObj), new Date().toISOString(), row.ref);
    res.json({ ok: true, rationale, scores: aiScores, recommendedPoints, recommendation });
  } catch (e) {
    if (e.code === 'AIMODEL_ERROR') return res.status(502).json({ error: 'AiModel call failed' });
    next(e);
  }
});

// ─── Attendees / CPD ─────────────────────────────────────────────────
router.get('/:code/attendees', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM accreditations WHERE accreditation_code = ?').get(req.params.code);
  if (!row) return res.status(404).json({ error: 'Course not found' });
  if (!ownsRow(req.user, row)) return res.status(403).json({ error: 'Forbidden' });
  const list = db.prepare('SELECT * FROM cpd_records WHERE course_code = ? ORDER BY created_at DESC').all(req.params.code);
  res.json({ courseCode: row.accreditation_code, attendees: list });
});

router.post('/:code/attendees', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM accreditations WHERE accreditation_code = ?').get(req.params.code);
  if (!row) return res.status(404).json({ error: 'Course not found' });
  if (row.status !== 'approved') return res.status(400).json({ error: 'Course is not approved.' });
  if (!ownsRow(req.user, row)) return res.status(403).json({ error: 'Forbidden' });
  const list = Array.isArray(req.body && req.body.attendees) ? req.body.attendees : [];
  if (!list.length) return res.status(400).json({ error: 'No attendees supplied.' });
  const p = parse(row.payload, {});
  const points = row.final_points != null ? row.final_points : (p.pointsRequested || 0);
  const title = p.courseTitle || p.course || p.title || row.ref;
  const provider = p.providerName || p.firm || row.submitted_by || '';
  const insert = db.prepare(`INSERT INTO cpd_records
    (id, attendee_email, attendee_name, lawyer_id, course_code, course_title, provider, points, recorded_by_id, recorded_by_email)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(attendee_email, course_code) DO NOTHING`);
  let recorded = 0, matched = 0, skipped = 0;
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const lawyer = matchLawyer(r);
      const email = String((r && (r.email || r)) || (lawyer && lawyer.email) || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email) && !lawyer) { skipped++; continue; }
      const info = insert.run(rid('CPD-'), email || (lawyer.id + '@lad'), (r && r.name) || null, lawyer ? lawyer.id : null,
        row.accreditation_code, title, provider, points, req.user.sub || null, (req.user.email || '').toLowerCase() || null);
      if (info.changes > 0) { recorded++; if (lawyer) { matched++; store.awardCpdPoints({ lawyerId: lawyer.id, points, source: 'accreditation', refId: row.accreditation_code }); } }
    }
  });
  tx(list);
  res.json({ ok: true, recorded, matched, skipped, points });
});

module.exports = router;
