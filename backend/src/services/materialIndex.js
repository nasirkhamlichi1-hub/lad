'use strict';
/**
 * Material index — the course library, readable by the model.
 *
 * Two jobs:
 *   1. indexMaterial()  — pull the text out of a material (PDF, Word,
 *      slides, plain text, or a fetched web page), split it into the
 *      articles a legal instrument is written in, and store them.
 *   2. answer()         — answer a lawyer's question from those articles and
 *      nothing else, citing the article behind each sentence.
 *
 * The model never sees a document it was not given, and the reply is
 * rebuilt here from the passages it cited: a citation that names a passage
 * we did not send is dropped, and a reply with no surviving citation is
 * reported as "not found" rather than shown as an answer.
 */

const crypto = require('crypto');
const axios = require('axios');
const db = require('../db');
const blob = require('./blobStorage');
const aimodel = require('./aimodel');

const MAX_TEXT = 300 * 1000;          // chars kept per material
const MAX_ARTICLE = 4000;             // chars per article body
const MAX_ARTICLES = 400;             // per material
const FETCH_TIMEOUT = 15000;
const PROMPT_BUDGET = 48 * 1000;      // chars of passages sent per question

const _aid = () => 'AR-' + crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 10);

// ─── Text extraction ────────────────────────────────────────────────

function arabicDigits(s) {
  return String(s || '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
       .replace(/<style[\s\S]*?<\/style>/gi, ' ')
       .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
       .replace(/<(br|p|div|li|tr|h[1-6]|section|article|td|th)[^>]*>/gi, '\n')
       .replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
       .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
       .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  return s;
}

function cleanText(s) {
  return String(s || '')
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT);
}

async function fetchBytes(url) {
  const r = await axios.get(url, {
    responseType: 'arraybuffer', timeout: FETCH_TIMEOUT, maxContentLength: 40 * 1024 * 1024,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LAD-Training-Library/1.0)', 'Accept': '*/*' },
    validateStatus: () => true,
  });
  if (r.status < 200 || r.status >= 300) throw new Error('fetch_failed_' + r.status);
  return { buf: Buffer.from(r.data), type: String(r.headers['content-type'] || '') };
}

// pdf.js (legacy build, no workers) — text items are regrouped into lines by
// their y position, so "Article 3" keeps its own line and the splitter can
// see it. Arabic PDFs from the Legislation Portal extract in logical order.
async function pdfToText(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
  const lines = [];
  const pages = Math.min(doc.numPages, 400);
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let line = '', lastY = null;
    for (const it of tc.items) {
      if (!it || typeof it.str !== 'string') continue;
      const y = it.transform ? it.transform[5] : 0;
      if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
      line += (line && !line.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
      lastY = y;
    }
    lines.push(line); lines.push('');
    page.cleanup();
  }
  try { await doc.destroy(); } catch (_) {}
  return lines.join('\n');
}

async function bufferToText(buf, mime, fileName) {
  const name = String(fileName || '').toLowerCase();
  const type = String(mime || '').toLowerCase();
  const is = (ext, m) => name.endsWith(ext) || (m && type.includes(m));

  if (is('.pdf', 'pdf')) return pdfToText(buf);
  if (is('.docx', 'wordprocessingml')) {
    const mammoth = require('mammoth');
    const out = await mammoth.extractRawText({ buffer: buf });
    return out && out.value ? out.value : '';
  }
  if (is('.pptx', 'presentationml')) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(buf);
    const slides = zip.getEntries()
      .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
      .sort((a, b) => Number(a.entryName.match(/(\d+)\.xml$/)[1]) - Number(b.entryName.match(/(\d+)\.xml$/)[1]));
    return slides.map((e) => {
      const xml = e.getData().toString('utf8');
      const runs = []; const re = /<a:t>([^<]*)<\/a:t>/g; let m;
      while ((m = re.exec(xml))) runs.push(m[1]);
      return runs.join(' ');
    }).join('\n\n');
  }
  if (is('.html', 'html') || is('.htm', null)) return htmlToText(buf.toString('utf8'));
  if (is('.txt', 'text/plain') || is('.md', 'markdown') || is('.csv', 'csv') || is('.json', 'json')) return buf.toString('utf8');
  // Unknown binary: only accept it if it decodes as mostly printable text.
  const s = buf.toString('utf8');
  const printable = (s.match(/[\p{L}\p{N}\s\p{P}]/gu) || []).length;
  return printable > s.length * 0.9 ? s : '';
}

// What this material says, as plain text — or '' with a reason why not.
async function extractText(m) {
  if (m.kind === 'scorm') { const e = new Error('scorm_package'); e.soft = true; throw e; }
  if (m.data) return bufferToText(Buffer.from(m.data, 'base64'), m.mime, m.file_name);
  if (m.storage_key) {
    if (!blob.isConfigured()) throw new Error('storage_unavailable');
    const { buf } = await fetchBytes(blob.getDownloadUrl(m.storage_key, m.file_name || m.title));
    return bufferToText(buf, m.mime, m.file_name);
  }
  if (m.url && /^https?:\/\//i.test(m.url)) {
    if (/(youtube\.com|youtu\.be)\//i.test(m.url)) { const e = new Error('video'); e.soft = true; throw e; }
    const { buf, type } = await fetchBytes(m.url);
    const guessName = type.includes('pdf') ? 'x.pdf' : (type.includes('html') ? 'x.html' : (m.file_name || m.url.split('?')[0]));
    return bufferToText(buf, type, guessName);
  }
  throw new Error('no_content');
}

// ─── Splitting into articles ────────────────────────────────────────

const AR_ORDINALS = ['الأولى','الثانية','الثالثة','الرابعة','الخامسة','السادسة','السابعة','الثامنة','التاسعة','العاشرة',
  'الحادية عشرة','الثانية عشرة','الثالثة عشرة','الرابعة عشرة','الخامسة عشرة','السادسة عشرة','السابعة عشرة','الثامنة عشرة','التاسعة عشرة','العشرون'];

// A heading line that opens an article, in either language.
//   المادة (3)   المادة 3   مادة (3)   المادة الثالثة   Article (3)   Article 3   Art. 3
const HEAD_RE = new RegExp(
  '(^|\\n)[ \\t]*(?:' +
    '(?:ال)?مادة[ \\t]*[\\(（]?[ \\t]*([0-9٠-٩]{1,4})[ \\t]*[\\)）]?' +
    '|(?:ال)?مادة[ \\t]+(' + AR_ORDINALS.join('|') + ')' +
    '|Article[ \\t]*[\\(]?[ \\t]*([0-9]{1,4})[ \\t]*[\\)]?' +
    '|Art\\.[ \\t]*([0-9]{1,4})' +
  ')[ \\t]*[:：\\-–—.]?[ \\t]*(?=\\S|\\n)',
  'giu'
);

function splitArticles(text) {
  const t = cleanText(text);
  if (!t) return [];
  const heads = [];
  let m;
  while ((m = HEAD_RE.exec(t))) {
    const num = m[2] ? Number(arabicDigits(m[2])) : (m[3] ? AR_ORDINALS.indexOf(m[3]) + 1 : Number(m[4] || m[5]));
    heads.push({ at: m.index + m[1].length, end: m.index + m[0].length, num, raw: m[0].trim(), arabic: /مادة/.test(m[0]) });
    if (heads.length > MAX_ARTICLES * 3) break;
  }
  // Tables of contents repeat the headings; keep the LAST run of ascending
  // numbers, which is the body of the instrument, not its index.
  let out = [];
  if (heads.length >= 2) {
    let runs = [[heads[0]]];
    for (let i = 1; i < heads.length; i++) {
      const prev = runs[runs.length - 1];
      if (heads[i].num > prev[prev.length - 1].num) prev.push(heads[i]); else runs.push([heads[i]]);
    }
    const best = runs.reduce((a, b) => (b.length >= a.length ? b : a), runs[0]);
    const pre = t.slice(0, best[0].at).trim();
    if (pre.length > 200) out.push({ label: best[0].arabic ? 'الديباجة' : 'Preamble', body: pre.slice(0, MAX_ARTICLE) });
    for (let i = 0; i < best.length; i++) {
      const h = best[i];
      const stop = i + 1 < best.length ? best[i + 1].at : t.length;
      const body = t.slice(h.end, stop).trim();
      if (!body) continue;
      out.push({ label: h.arabic ? `المادة (${h.num})` : `Article ${h.num}`, body: body.slice(0, MAX_ARTICLE) });
    }
  }
  if (out.length < 2) {
    // No article structure (a guidance note, a web page): paragraphs,
    // packed into ~1200-character passages.
    out = [];
    const paras = t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    let cur = '';
    for (const p of paras) {
      if (cur && (cur.length + p.length) > 1200) { out.push(cur); cur = ''; }
      cur = cur ? cur + '\n\n' + p : p;
      if (cur.length > MAX_ARTICLE) { out.push(cur.slice(0, MAX_ARTICLE)); cur = cur.slice(MAX_ARTICLE); }
    }
    if (cur) out.push(cur);
    out = out.map((body, i) => ({ label: `§ ${i + 1}`, body }));
  }
  return out.slice(0, MAX_ARTICLES);
}

// ─── Indexing ───────────────────────────────────────────────────────

async function indexMaterial(m, { force = false } = {}) {
  if (!m) return { ok: false, reason: 'missing' };
  if (!force && m.indexed_at) return { ok: true, cached: true };
  let text = '';
  try {
    text = cleanText(await extractText(m));
  } catch (e) {
    const reason = e.soft ? e.message : ('extract_failed: ' + (e.message || String(e)).slice(0, 180));
    db.prepare('UPDATE course_materials SET indexed_at = ?, index_error = ?, text_content = NULL WHERE id = ?')
      .run(new Date().toISOString(), reason, m.id);
    db.prepare('DELETE FROM material_article WHERE material_id = ?').run(m.id);
    return { ok: false, reason };
  }
  const arts = splitArticles(text);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM material_article WHERE material_id = ?').run(m.id);
    const ins = db.prepare('INSERT INTO material_article (id, material_id, course_id, position, label, body) VALUES (?,?,?,?,?,?)');
    arts.forEach((a, i) => ins.run(_aid(), m.id, m.course_id, i, a.label, a.body));
    db.prepare('UPDATE course_materials SET text_content = ?, indexed_at = ?, index_error = ? WHERE id = ?')
      .run(text || null, new Date().toISOString(), arts.length ? null : 'no_text', m.id);
  });
  tx();
  return { ok: arts.length > 0, articles: arts.length, reason: arts.length ? null : 'no_text' };
}

function indexMaterialById(id, opts) {
  const m = db.prepare('SELECT * FROM course_materials WHERE id = ?').get(id);
  return indexMaterial(m, opts);
}

// Index whatever in the course is not indexed yet, within a time budget —
// the first question on an older course pays for the shelf, later ones do not.
async function ensureIndexed(courseId, { budgetMs = 20000 } = {}) {
  const rows = db.prepare('SELECT * FROM course_materials WHERE course_id = ? AND indexed_at IS NULL ORDER BY created_at').all(courseId);
  const started = Date.now();
  let done = 0;
  for (const m of rows) {
    if (Date.now() - started > budgetMs) break;
    try { await indexMaterial(m); } catch (_) {}
    done++;
  }
  return { pending: rows.length - done, done };
}

async function reindexCourse(courseId) {
  const rows = db.prepare('SELECT * FROM course_materials WHERE course_id = ? ORDER BY created_at').all(courseId);
  const out = [];
  for (const m of rows) { try { out.push({ id: m.id, ...(await indexMaterial(m, { force: true })) }); } catch (e) { out.push({ id: m.id, ok: false, reason: e.message }); } }
  return out;
}

// ─── Answering ──────────────────────────────────────────────────────

const STOP = new Set(('the a an of to in on for and or is are be by with from as at that this it what which who how when where '
  + 'do does did can could should would may might have has had i my me we our you your they their there here any all not no '
  + 'في من على إلى عن أن إن ما هل هذا هذه ذلك تلك كان كانت يكون التي الذي الذين مع أو و لا لم لن قد كل بعد قبل عند حتى إذا كيف متى أين كم هو هي هم نحن أنا انا').split(/\s+/));

function tokens(s) {
  return arabicDigits(String(s || '')).toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .map((w) => w.replace(/^(ال|و|ب|ل|ف|ك)/u, (p) => (w.length > 4 ? '' : p)))
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

function rankPassages(question, articles) {
  const q = Array.from(new Set(tokens(question)));
  const scored = articles.map((a) => {
    const hay = (a.label + ' ' + a.body);
    const hayTok = tokens(hay);
    const set = new Set(hayTok);
    let score = 0;
    for (const w of q) {
      if (set.has(w)) score += /^\d+$/.test(w) ? 3 : 2;
      else if (w.length >= 4 && hayTok.some((h) => h.startsWith(w) || w.startsWith(h))) score += 1;
    }
    // Titles that name the instrument matter even when the body is thin.
    const tt = tokens(a.title + ' ' + (a.title_ar || ''));
    for (const w of q) if (tt.includes(w)) score += 1;
    return { a, score };
  });
  scored.sort((x, y) => y.score - x.score || x.a.position - y.a.position);
  const picked = [];
  let chars = 0;
  for (const s of scored) {
    if (chars + s.a.body.length > PROMPT_BUDGET) continue;
    picked.push(s.a); chars += s.a.body.length;
    if (picked.length >= 40) break;
  }
  return picked;
}

function materialsForCourse(courseId) {
  return db.prepare('SELECT id, title, title_ar, kind, lang, pair_id FROM course_materials WHERE course_id = ?').all(courseId);
}

function extractJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch (_) { return null; }
}

async function answer({ courseId, question, lang = 'en' }) {
  const q = String(question || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!q) { const e = new Error('question_required'); e.status = 400; throw e; }
  if (!aimodel.configured()) { const e = new Error('No AI model is configured on this server.'); e.status = 503; e.code = 'AIMODEL_NOT_CONFIGURED'; throw e; }

  const mats = materialsForCourse(courseId);
  const byMat = Object.fromEntries(mats.map((m) => [m.id, m]));
  const rows = db.prepare(`SELECT a.id, a.material_id, a.position, a.label, a.body
                           FROM material_article a WHERE a.course_id = ? ORDER BY a.material_id, a.position`).all(courseId)
    .map((r) => ({ ...r, title: (byMat[r.material_id] || {}).title || '', title_ar: (byMat[r.material_id] || {}).title_ar || null }));
  if (!rows.length) return { found: false, answer: '', citations: [], reason: 'no_index' };

  const passages = rankPassages(q, rows);
  const ids = passages.map((p, i) => ({ key: 'P' + (i + 1), p }));
  const block = ids.map(({ key, p }) => {
    const name = (lang === 'ar' && p.title_ar) ? p.title_ar : p.title;
    return `[${key}] ${name} — ${p.label}\n${p.body}`;
  }).join('\n\n');

  const ar = lang === 'ar';
  const system = ar
    ? 'أنت أمين مكتبة مراجع في دورة تدريبية لدائرة الشؤون القانونية لحكومة دبي. أجب عن سؤال المحامي من المقاطع المرفقة فقط، ولا تستخدم أي معرفة أخرى. '
      + 'اكتب بالعربية الفصحى بأسلوب مؤسسي موجز (لا يزيد عن 120 كلمة). بعد كل جملة تعتمد على مقطع ضع معرّفه بين قوسين مربعين مثل [P3]. '
      + 'إذا لم تكن المقاطع تحتوي على الجواب فقل ذلك في جملة واحدة واجعل not_found صحيحاً. لا تخترع أرقام مواد أو مدداً. '
      + 'أعد JSON فقط بالشكل: {"answer":"...","not_found":false}'
    : 'You are the reference librarian for a training course at The Government of Dubai Legal Affairs Department. Answer the lawyer\'s question ONLY from the passages provided; use no other knowledge. '
      + 'Write in plain, institutional English, at most 120 words. After every sentence that relies on a passage, put its id in square brackets, e.g. [P3]. '
      + 'If the passages do not contain the answer, say so in one sentence and set not_found to true. Never invent an article number or a time period. '
      + 'Return JSON only: {"answer":"...","not_found":false}';
  const user = (ar ? 'السؤال: ' : 'Question: ') + q + '\n\n' + (ar ? 'المقاطع:' : 'Passages:') + '\n\n' + block;

  const raw = await aimodel.chat({ system, messages: [{ role: 'user', content: user }], maxTokens: 600, temperature: 0 });
  const j = extractJson(raw) || { answer: String(raw || ''), not_found: false };
  let text = String(j.answer || '').trim();

  // Rebuild the citations from what was actually sent: [P#] → [n].
  const order = [];
  const keyToN = {};
  text = text.replace(/\[\s*P(\d+)\s*\]/gi, (_, n) => {
    const key = 'P' + Number(n);
    const hit = ids.find((x) => x.key === key);
    if (!hit) return '';
    if (!keyToN[key]) { order.push(hit); keyToN[key] = order.length; }
    return '[' + keyToN[key] + ']';
  }).replace(/\s+([.،,؛;])/g, '$1').replace(/\s{2,}/g, ' ').trim();

  const citations = order.map((x, i) => ({
    n: i + 1, article_id: x.p.id, material_id: x.p.material_id, label: x.p.label,
    title: x.p.title, title_ar: x.p.title_ar,
    pair_id: (byMat[x.p.material_id] || {}).pair_id || null,
  }));
  const found = !j.not_found && citations.length > 0;
  return { found, answer: text, citations, passages_considered: passages.length };
}

module.exports = { indexMaterial, indexMaterialById, ensureIndexed, reindexCourse, answer, splitArticles, extractText, bufferToText, htmlToText };
