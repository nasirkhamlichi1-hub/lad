'use strict';
/**
 * Library insights — what the reference library shows around its documents.
 *
 *   insights()  — per course, drafted once by the model from the documents'
 *                 own text: a plain one-line summary of every document (both
 *                 languages), the subject it belongs to, "what applies to me"
 *                 situations with the documents to read in order, questions
 *                 worth asking the library, and the course step each
 *                 document supports.
 *   articles()  — a document's text, article by article, for the reader.
 *   quiz()      — three questions on one document, from its articles.
 *   reads()     — the learner's own trail: what they opened, what they pinned.
 *
 * Every id the model returns is checked against the real shelf and anything
 * it invents is dropped. Drafts are cached against a signature of what they
 * were drafted from. Without a model the library still works; it simply
 * shows less.
 */

const crypto = require('crypto');
const db = require('../db');
const aimodel = require('./aimodel');
const materialIndex = require('./materialIndex');

const OPENING = 900;         // chars of each document's text sent for its summary
const HEADS = 12;            // article headings sent per document
const BATCH = 6;             // documents per summary call (each call must finish inside the model timeout)
const QUIZ_BUDGET = 16000;   // chars of articles sent for a self-test

const inflight = new Map();

// ─── Cache ──────────────────────────────────────────────────────────

function cacheGet(key) {
  const row = db.prepare('SELECT signature, data, created_at FROM library_cache WHERE key = ?').get(key);
  if (!row) return null;
  try { return { signature: row.signature, data: JSON.parse(row.data), created_at: row.created_at }; } catch (_) { return null; }
}
function cachePut(key, signature, data) {
  db.prepare(`INSERT INTO library_cache (key, signature, data, created_at) VALUES (?,?,?,datetime('now'))
              ON CONFLICT(key) DO UPDATE SET signature = excluded.signature, data = excluded.data, created_at = excluded.created_at`)
    .run(key, signature, JSON.stringify(data));
}
const sha = (v) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex');

// ─── Helpers ────────────────────────────────────────────────────────

function extractJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch (_) { return null; }
}
const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

function shelf(courseId) {
  return db.prepare(`SELECT id, title, title_ar, kind, lang, pair_id, description, indexed_at, index_error,
                            substr(text_content, 1, ${OPENING}) AS opening
                     FROM course_materials WHERE course_id = ? ORDER BY created_at`).all(courseId);
}
function steps(courseId) {
  try {
    return db.prepare(`SELECT id, kind, title, title_ar, summary, material_id, material_id_ar
                       FROM activity WHERE course_id = ? AND published = 1 ORDER BY position`).all(courseId);
  } catch (_) { return []; }
}
function headings(materialId) {
  return db.prepare('SELECT label FROM material_article WHERE material_id = ? ORDER BY position LIMIT ?')
    .all(materialId, HEADS).map((r) => r.label);
}

function signatureOf(mats, acts) {
  return sha({
    v: 1,
    m: mats.map((m) => [m.id, m.title, m.title_ar, m.description, m.indexed_at]),
    s: acts.map((a) => [a.id, a.title, a.title_ar]),
  });
}

// ─── Insights ───────────────────────────────────────────────────────

const SUMMARY_SYSTEM =
  'You catalogue the reference library of a training course at The Government of Dubai Legal Affairs Department. ' +
  'For each document you are given its id, title and the opening of its text. Write ONE plain sentence saying what the ' +
  'document does for a practising lawyer (for example "Sets the fees and fines for practising advocacy in Dubai."), in English ' +
  'and in formal Arabic, each at most 140 characters. Work only from what you are given; never invent numbers, dates, ' +
  'amounts or article references. Also give each document a short subject label (2 to 4 words, English and Arabic) that ' +
  'groups related instruments, reusing the same label wording for documents on the same subject. ' +
  'Return JSON only: {"documents":[{"id":"...","summary_en":"...","summary_ar":"...","subject_en":"...","subject_ar":"..."}]}';

const GUIDE_SYSTEM =
  'You design the reference library of a training course at The Government of Dubai Legal Affairs Department. ' +
  'You are given the course steps and the documents (id, title, summary). Return JSON only, in this shape:\n' +
  '{"situations":[{"en":"I\'m opening a legal consultancy office","ar":"...","documents":["<id>","<id>"]}],\n' +
  ' "questions":{"en":["..."],"ar":["..."]},\n' +
  ' "steps":[{"step":"<step id>","documents":["<id>"]}]}\n' +
  'Rules: 4 to 6 situations, each a practical moment in a lawyer\'s working life written in the first person and at most ' +
  '60 characters, listing 1 to 5 document ids in the order the lawyer should read them. 4 questions in each language that ' +
  'the documents can answer, each at most 90 characters. For each course step, the document ids that support it (none if ' +
  'nothing fits). Use only ids from the lists given, exactly as written. No marketing language, no exclamation marks.';

function subjectKey(en) { return clip(en, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'general'; }

async function draftSummaries(docs) {
  const user = docs.map((m) => {
    const heads = headings(m.id);
    return `id: ${m.id}\ntitle: ${m.title}${m.title_ar && m.title_ar !== m.title ? '\narabic title: ' + m.title_ar : ''}` +
      (m.description ? '\ncatalogue note: ' + clip(m.description, 300) : '') +
      (heads.length ? '\narticles: ' + heads.join(', ') : '') +
      '\nopening: ' + (m.opening ? clip(m.opening, OPENING) : '(no text — a packaged interactive module or a page that could not be read)');
  }).join('\n\n---\n\n');
  const raw = await aimodel.chat({ system: SUMMARY_SYSTEM, messages: [{ role: 'user', content: user }], maxTokens: 1800, temperature: 0 });
  const j = extractJson(raw) || {};
  return Array.isArray(j.documents) ? j.documents : [];
}

async function build(courseId, mats, acts) {
  const ids = new Set(mats.map((m) => m.id));
  const byId = Object.fromEntries(mats.map((m) => [m.id, m]));

  // 1. Summaries and subjects, a few documents per call, in parallel.
  const batches = [];
  for (let i = 0; i < mats.length; i += BATCH) batches.push(mats.slice(i, i + BATCH));
  const results = await Promise.all(batches.map((b) => draftSummaries(b).catch(() => [])));
  const documents = {};
  const subjects = {};
  for (const d of results.flat()) {
    if (!d || !ids.has(d.id)) continue;
    const en = clip(d.subject_en, 40); const ar = clip(d.subject_ar, 40);
    const key = en ? subjectKey(en) : null;
    if (key && !subjects[key]) subjects[key] = { key, en, ar: ar || en };
    documents[d.id] = { summary_en: clip(d.summary_en, 180) || null, summary_ar: clip(d.summary_ar, 180) || null, subject: key };
  }
  // A document and its twin in the other language share one entry.
  for (const m of mats) {
    if (!documents[m.id] && m.pair_id && documents[m.pair_id]) documents[m.id] = documents[m.pair_id];
  }

  // 2. Situations, questions and step links, from the titles and summaries.
  let guide = {};
  try {
    const user = 'Course steps:\n' + (acts.length ? acts.map((a) => `- ${a.id}: ${a.title} (${a.kind})`).join('\n') : '(none)') +
      '\n\nDocuments:\n' + mats.map((m) => `- ${m.id}: ${m.title}${m.title_ar && m.title_ar !== m.title ? ' / ' + m.title_ar : ''}` +
        (documents[m.id] && documents[m.id].summary_en ? ' — ' + documents[m.id].summary_en : '')).join('\n');
    const raw = await aimodel.chat({ system: GUIDE_SYSTEM, messages: [{ role: 'user', content: user }], maxTokens: 1500, temperature: 0.2 });
    guide = extractJson(raw) || {};
  } catch (_) { guide = {}; }

  const keepIds = (list, max) => Array.from(new Set((Array.isArray(list) ? list : []).map(String).filter((id) => ids.has(id)))).slice(0, max);
  const situations = (Array.isArray(guide.situations) ? guide.situations : []).map((s) => ({
    en: clip(s && s.en, 80), ar: clip(s && s.ar, 80), documents: keepIds(s && s.documents, 5),
  })).filter((s) => s.en && s.documents.length).slice(0, 6);
  const q = guide.questions || {};
  const questions = {
    en: (Array.isArray(q.en) ? q.en : []).map((x) => clip(x, 120)).filter(Boolean).slice(0, 4),
    ar: (Array.isArray(q.ar) ? q.ar : []).map((x) => clip(x, 120)).filter(Boolean).slice(0, 4),
  };
  const stepIds = new Set(acts.map((a) => a.id));
  const stepLinks = {};
  for (const s of (Array.isArray(guide.steps) ? guide.steps : [])) {
    if (!s || !stepIds.has(String(s.step))) continue;
    const docsFor = keepIds(s.documents, 4);
    if (docsFor.length) stepLinks[String(s.step)] = docsFor;
  }
  // A step that IS a document links to it without asking the model.
  for (const a of acts) {
    for (const mid of [a.material_id, a.material_id_ar]) {
      if (mid && ids.has(mid) && byId[mid].kind !== 'scorm') {
        stepLinks[a.id] = Array.from(new Set([mid].concat(stepLinks[a.id] || []))).slice(0, 4);
      }
    }
  }

  return {
    documents,
    subjects: Object.values(subjects),
    situations,
    questions,
    steps: stepLinks,
    generated_at: new Date().toISOString(),
  };
}

function rebuild(courseId) {
  const key = 'insights:' + courseId;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    // Read any document not read yet first, so its summary comes from its
    // text rather than its title. The shelf is re-read afterwards and the
    // draft is filed under the signature of what it was drafted from.
    try { await materialIndex.ensureIndexed(courseId, { budgetMs: 60000 }); } catch (_) {}
    const mats = shelf(courseId);
    const acts = steps(courseId);
    const data = await build(courseId, mats, acts);
    // Nothing came back at all (model down): do not cache an empty draft.
    if (Object.keys(data.documents).length || data.situations.length) cachePut(key, signatureOf(mats, acts), data);
    return data;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/**
 * The course's insights. Never waits on the model: a fresh draft is started
 * in the background and the caller is told it is pending (or handed the last
 * draft, marked stale, while the new one is written).
 */
function insights(courseId) {
  const mats = shelf(courseId);
  if (!mats.length) return { available: false, reason: 'empty' };
  const acts = steps(courseId);
  const sig = signatureOf(mats, acts);
  const cached = cacheGet('insights:' + courseId);
  if (cached && cached.signature === sig) return { available: true, ...cached.data };
  if (!aimodel.configured()) {
    return cached ? { available: true, stale: true, ...cached.data } : { available: false, reason: 'no_model' };
  }
  rebuild(courseId).catch(() => {});
  return cached ? { available: true, stale: true, ...cached.data } : { available: true, pending: true };
}

// ─── The reader: a document, article by article ─────────────────────

async function articles(courseId, materialId) {
  const m = db.prepare('SELECT * FROM course_materials WHERE id = ? AND course_id = ?').get(materialId, courseId);
  if (!m) return null;
  if (!m.indexed_at) { try { await materialIndex.indexMaterial(m); } catch (_) {} }
  const rows = db.prepare('SELECT id, position, label, body FROM material_article WHERE material_id = ? ORDER BY position').all(materialId);
  const after = db.prepare('SELECT index_error FROM course_materials WHERE id = ?').get(materialId) || {};
  return { material_id: materialId, articles: rows, reason: rows.length ? null : (after.index_error || 'no_text') };
}

// ─── Test yourself ──────────────────────────────────────────────────

async function quiz(courseId, materialId, lang = 'en') {
  const ar = lang === 'ar';
  const m = db.prepare('SELECT id, title, title_ar, indexed_at FROM course_materials WHERE id = ? AND course_id = ?').get(materialId, courseId);
  if (!m) { const e = new Error('Material not found'); e.status = 404; throw e; }
  const doc = await articles(courseId, materialId);
  if (!doc.articles.length) { const e = new Error('This document has no readable text to build questions from.'); e.status = 422; e.code = 'no_text'; throw e; }
  const key = `quiz:${materialId}:${ar ? 'ar' : 'en'}`;
  const fresh = db.prepare('SELECT indexed_at FROM course_materials WHERE id = ?').get(materialId).indexed_at;
  const cached = cacheGet(key);
  if (cached && cached.signature === fresh) return cached.data;
  if (!aimodel.configured()) { const e = new Error('No AI model is configured on this server.'); e.status = 503; e.code = 'AIMODEL_NOT_CONFIGURED'; throw e; }

  let chars = 0;
  const sent = [];
  for (const a of doc.articles) {
    if (chars + a.body.length > QUIZ_BUDGET) break;
    sent.push(a); chars += a.body.length;
  }
  const labels = new Set(sent.map((a) => a.label));
  const system = (ar
    ? 'أنت تعدّ اختباراً قصيراً لمحامٍ على مستند قانوني في دورة تدريبية لدائرة الشؤون القانونية لحكومة دبي. اكتب ثلاثة أسئلة اختيار من متعدد بالعربية الفصحى، '
      + 'لكل سؤال ثلاثة خيارات، واحد منها فقط صحيح وفق النص المرفق حرفياً. اعتمد على النص المرفق وحده، ولا تخترع أرقاماً أو مدداً. اذكر المادة التي يستند إليها كل سؤال كما وردت.'
    : 'You write a short self-test for a lawyer on one legal document in a training course at The Government of Dubai Legal Affairs Department. '
      + 'Write three multiple-choice questions in plain English, each with three options, exactly one of which is correct according to the text given. '
      + 'Work only from the text given; never invent numbers or time periods. Name the article each question rests on, exactly as labelled.')
    + ' Return JSON only: {"questions":[{"q":"...","options":["...","...","..."],"answer":0,"article":"<label>","why":"<one sentence>"}]}';
  const user = (ar && m.title_ar ? m.title_ar : m.title) + '\n\n' + sent.map((a) => `[${a.label}]\n${a.body}`).join('\n\n');
  const raw = await aimodel.chat({ system, messages: [{ role: 'user', content: user }], maxTokens: 1200, temperature: 0.2 });
  const j = extractJson(raw) || {};
  const questions = (Array.isArray(j.questions) ? j.questions : []).map((x) => {
    const options = (Array.isArray(x && x.options) ? x.options : []).map((o) => clip(o, 200)).filter(Boolean).slice(0, 4);
    const answer = Number(x && x.answer);
    return {
      q: clip(x && x.q, 300), options,
      answer: Number.isInteger(answer) && answer >= 0 && answer < options.length ? answer : -1,
      article: labels.has(String(x && x.article)) ? String(x.article) : null,
      why: clip(x && x.why, 300) || null,
    };
  }).filter((x) => x.q && x.options.length >= 2 && x.answer >= 0).slice(0, 3);
  if (!questions.length) { const e = new Error('Could not write questions on this document just now.'); e.status = 502; e.code = 'quiz_failed'; throw e; }
  const data = { material_id: materialId, lang: ar ? 'ar' : 'en', questions };
  cachePut(key, fresh, data);
  return data;
}

// ─── Reading trail ──────────────────────────────────────────────────

function reads(courseId, userId) {
  const rows = db.prepare('SELECT material_id, first_opened_at, last_opened_at, opens, pinned FROM material_read WHERE user_id = ? AND course_id = ?')
    .all(userId, courseId);
  const out = {};
  for (const r of rows) out[r.material_id] = { opened: r.opens > 0, opens: r.opens, last_opened_at: r.last_opened_at, pinned: !!r.pinned };
  return out;
}

function belongs(courseId, materialId) {
  return !!db.prepare('SELECT 1 FROM course_materials WHERE id = ? AND course_id = ?').get(materialId, courseId);
}

function markRead(courseId, userId, materialId) {
  if (!belongs(courseId, materialId)) return null;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO material_read (user_id, material_id, course_id, first_opened_at, last_opened_at, opens, pinned)
              VALUES (?,?,?,?,?,1,0)
              ON CONFLICT(user_id, material_id) DO UPDATE SET last_opened_at = excluded.last_opened_at, opens = opens + 1,
                first_opened_at = COALESCE(first_opened_at, excluded.first_opened_at)`)
    .run(userId, materialId, courseId, now, now);
  return reads(courseId, userId)[materialId];
}

function setPinned(courseId, userId, materialId, pinned) {
  if (!belongs(courseId, materialId)) return null;
  db.prepare(`INSERT INTO material_read (user_id, material_id, course_id, opens, pinned) VALUES (?,?,?,0,?)
              ON CONFLICT(user_id, material_id) DO UPDATE SET pinned = excluded.pinned`)
    .run(userId, materialId, courseId, pinned ? 1 : 0);
  return reads(courseId, userId)[materialId];
}

module.exports = { insights, articles, quiz, reads, markRead, setPinned, _build: build, _signatureOf: signatureOf };
