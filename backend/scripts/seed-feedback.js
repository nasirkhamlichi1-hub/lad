'use strict';

// Loads the trainer-free historical feedback aggregates (seed-data/
// feedback-aggregates.json) into course_feedback / provider_feedback, and
// rebuilds the 'live:' aggregate rows from any participant submissions
// (feedback_responses). Idempotent. Also exposes submitResponse() so the API can
// record a new rating and refresh the live aggregates on the fly.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'seed-data', 'feedback-aggregates.json');
const MIGRATION = path.join(__dirname, '..', 'migrations', '022-course-feedback.sql');
const MIGRATION_SUB = path.join(__dirname, '..', 'migrations', '023-feedback-submissions.sql');

const COURSE_METRICS = ['content', 'benefits', 'practical', 'overall'];
const PROVIDER_METRICS = ['knowledge', 'clarity', 'interaction'];
const cycleYear = () => new Date().getUTCFullYear();

// Displayed score = 5 × proportion who rated Very Good or Excellent (4+).
function satStar(dist) {
  if (!dist) return null;
  const tot = (dist[1] || 0) + (dist[2] || 0) + (dist[3] || 0) + (dist[4] || 0) + (dist[5] || 0);
  if (!tot) return null;
  return Math.round(((dist[4] || 0) + (dist[5] || 0)) / tot * 5 * 100) / 100;
}
function ensureTables(db) {
  try { db.exec(fs.readFileSync(MIGRATION, 'utf8')); } catch (_) {}
  try { db.exec(fs.readFileSync(MIGRATION_SUB, 'utf8')); } catch (_) {}
}
const provToken = (name) => String(name || '').toLowerCase().replace(/[^a-z]/g, ' ').trim().split(' ')[0] || '';

// Resolve a course's provider to the id/name the HISTORICAL feedback uses, so
// live + historical provider data merge instead of splitting across namespaces.
function resolveHistProvider(db, courseProviderId) {
  let name = null;
  try { name = (db.prepare('SELECT name FROM providers WHERE id = ?').get(courseProviderId) || {}).name; } catch (_) {}
  const tok = provToken(name || courseProviderId);
  if (tok && tok.length >= 3) {
    try {
      const row = db.prepare("SELECT provider_id, provider_name FROM provider_feedback WHERE provider_key NOT LIKE 'live:%' AND lower(provider_name) LIKE ? LIMIT 1").get(tok + '%');
      if (row) return { id: row.provider_id, name: row.provider_name };
    } catch (_) {}
  }
  return { id: courseProviderId || null, name: name || courseProviderId || null };
}

// ── Historical load ─────────────────────────────────────────────────────────
function loadFeedback(db) {
  if (!fs.existsSync(SRC)) return null;
  const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  ensureTables(db);

  const insC = db.prepare(`INSERT OR REPLACE INTO course_feedback
    (course_key, year, course_id, course_name, provider_id, provider_name, responses, content, benefits, practical, overall, metrics_json)
    VALUES (@course_key, @year, @course_id, @course_name, @provider_id, @provider_name, @responses, @content, @benefits, @practical, @overall, @metrics_json)`);
  const insP = db.prepare(`INSERT OR REPLACE INTO provider_feedback
    (provider_key, year, provider_id, provider_name, responses, knowledge, clarity, interaction, metrics_json)
    VALUES (@provider_key, @year, @provider_id, @provider_name, @responses, @knowledge, @clarity, @interaction, @metrics_json)`);

  const a = (m, k) => (m && m[k] ? satStar(m[k].dist) : null);

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM course_feedback WHERE course_key NOT LIKE 'live:%'").run();
    for (const c of data.courses) {
      insC.run({
        course_key: c.course_key, year: c.year, course_id: c.course_id, course_name: c.course_name,
        provider_id: c.provider_id, provider_name: c.provider_name, responses: c.responses,
        content: a(c.metrics, 'content'), benefits: a(c.metrics, 'benefits'),
        practical: a(c.metrics, 'practical'), overall: a(c.metrics, 'overall'),
        metrics_json: JSON.stringify(c.metrics),
      });
    }
    db.prepare("DELETE FROM provider_feedback WHERE provider_key NOT LIKE 'live:%'").run();
    for (const p of data.providers) {
      insP.run({
        provider_key: p.provider_id || ('unmapped:' + (p.provider_name || '').toLowerCase()),
        year: p.year, provider_id: p.provider_id, provider_name: p.provider_name, responses: p.responses,
        knowledge: a(p.metrics, 'knowledge'), clarity: a(p.metrics, 'clarity'), interaction: a(p.metrics, 'interaction'),
        metrics_json: JSON.stringify(p.metrics),
      });
    }
  });
  tx();
  recomputeAllLive(db); // rebuild live rows from any submissions (survives re-seed)
  return { courses: data.courses.length, providers: data.providers.length, generated_at: data.generated_at };
}

// ── Live aggregation from feedback_responses ─────────────────────────────────
function distFor(db, scope, id, metric) {
  const col = scope === 'course' ? 'course_id' : 'provider_id';
  const d = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let rows = [];
  try {
    rows = db.prepare(`SELECT ${metric} AS v, COUNT(*) AS c FROM feedback_responses WHERE ${col} = ? AND ${metric} BETWEEN 1 AND 5 GROUP BY ${metric}`).all(id);
  } catch (_) {}
  for (const r of rows) d[r.v] = r.c;
  return d;
}
function liveCount(db, scope, id) {
  const col = scope === 'course' ? 'course_id' : 'provider_id';
  try { return db.prepare(`SELECT COUNT(*) AS n FROM feedback_responses WHERE ${col} = ?`).get(id).n; } catch (_) { return 0; }
}

function recomputeCourseLive(db, courseId) {
  ensureTables(db);
  const n = liveCount(db, 'course', courseId);
  const key = 'live:' + courseId;
  if (!n) { try { db.prepare('DELETE FROM course_feedback WHERE course_key = ?').run(key); } catch (_) {} return; }
  let info = {};
  try { info = db.prepare('SELECT c.title, c.provider_id FROM courses c WHERE c.id = ?').get(courseId) || {}; } catch (_) {}
  const prov = resolveHistProvider(db, info.provider_id);
  const metrics = {}, vals = {};
  for (const m of COURSE_METRICS) { const dist = distFor(db, 'course', courseId, m); metrics[m] = { avg: null, n: Object.values(dist).reduce((a, b) => a + b, 0), dist }; vals[m] = satStar(dist); }
  db.prepare(`INSERT OR REPLACE INTO course_feedback
    (course_key, year, course_id, course_name, provider_id, provider_name, responses, content, benefits, practical, overall, metrics_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    key, cycleYear(), courseId, info.title || courseId, prov.id, prov.name, n,
    vals.content, vals.benefits, vals.practical, vals.overall, JSON.stringify(metrics));
}

function recomputeProviderLive(db, providerId) {
  if (!providerId) return;
  ensureTables(db);
  const n = liveCount(db, 'provider', providerId);
  const key = 'live:' + providerId;
  if (!n) { try { db.prepare('DELETE FROM provider_feedback WHERE provider_key = ?').run(key); } catch (_) {} return; }
  let name = providerId;
  try { const r = db.prepare("SELECT provider_name FROM provider_feedback WHERE provider_id = ? AND provider_key NOT LIKE 'live:%' LIMIT 1").get(providerId); if (r) name = r.provider_name; } catch (_) {}
  const metrics = {}, vals = {};
  for (const m of PROVIDER_METRICS) { const dist = distFor(db, 'provider', providerId, m); metrics[m] = { avg: null, n: Object.values(dist).reduce((a, b) => a + b, 0), dist }; vals[m] = satStar(dist); }
  db.prepare(`INSERT OR REPLACE INTO provider_feedback
    (provider_key, year, provider_id, provider_name, responses, knowledge, clarity, interaction, metrics_json)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    key, cycleYear(), providerId, name, n, vals.knowledge, vals.clarity, vals.interaction, JSON.stringify(metrics));
}

function recomputeAllLive(db) {
  let courses = [], providers = [];
  try { courses = db.prepare('SELECT DISTINCT course_id FROM feedback_responses').all().map((r) => r.course_id); } catch (_) { return; }
  try { providers = db.prepare('SELECT DISTINCT provider_id FROM feedback_responses WHERE provider_id IS NOT NULL').all().map((r) => r.provider_id); } catch (_) {}
  for (const id of courses) recomputeCourseLive(db, id);
  for (const id of providers) recomputeProviderLive(db, id);
}

// Record one submission and refresh the affected live aggregates.
// ratings: { knowledge, clarity, interaction, content, benefits, practical, overall } (1–5)
function submitResponse(db, { courseId, ratings = {}, comment, sessionId, lawyerId }) {
  ensureTables(db);
  if (!courseId) throw new Error('courseId required');
  let info = {};
  try { info = db.prepare('SELECT provider_id FROM courses WHERE id = ?').get(courseId) || {}; } catch (_) {}
  const prov = resolveHistProvider(db, info.provider_id);
  const clamp = (v) => { v = Number(v); return Number.isInteger(v) && v >= 1 && v <= 5 ? v : null; };
  const row = {
    id: 'FR-' + crypto.randomBytes(7).toString('hex').toUpperCase(),
    course_id: courseId, provider_id: prov.id, session_id: sessionId || null, lawyer_id: lawyerId || null,
    year: cycleYear(),
    knowledge: clamp(ratings.knowledge), clarity: clamp(ratings.clarity), interaction: clamp(ratings.interaction),
    content: clamp(ratings.content), benefits: clamp(ratings.benefits), practical: clamp(ratings.practical), overall: clamp(ratings.overall),
    comment: comment ? String(comment).slice(0, 2000) : null,
  };
  db.prepare(`INSERT INTO feedback_responses
    (id, course_id, provider_id, session_id, lawyer_id, year, knowledge, clarity, interaction, content, benefits, practical, overall, comment)
    VALUES (@id,@course_id,@provider_id,@session_id,@lawyer_id,@year,@knowledge,@clarity,@interaction,@content,@benefits,@practical,@overall,@comment)`).run(row);
  recomputeCourseLive(db, courseId);
  recomputeProviderLive(db, prov.id);
  return { id: row.id, course_id: courseId, provider_id: prov.id };
}

module.exports = { loadFeedback, recomputeAllLive, recomputeCourseLive, recomputeProviderLive, submitResponse };

// CLI entry point: node scripts/seed-feedback.js
if (require.main === module) {
  const db = require('../src/db');
  if (!fs.existsSync(SRC)) {
    console.error(`✗ ${SRC} not found. Run: node scripts/build-feedback.js <2025.xlsx> <2026.xlsx>`);
    process.exit(1);
  }
  const r = loadFeedback(db);
  console.log(`✓ Feedback loaded: ${r.courses} course-year rows, ${r.providers} provider-year rows (generated ${r.generated_at}).`);
}
