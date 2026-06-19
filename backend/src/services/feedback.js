'use strict';

// Read helpers for course / provider feedback ratings (out of 5). Aggregates
// are stored per year (course_feedback / provider_feedback); these combine the
// years response-weighted so callers get a single headline rating plus the
// per-year breakdown for drill-down. No trainer identities are exposed.

const db = require('../db');

function tableExists(name) {
  try { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name); }
  catch (_) { return false; }
}
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

// Response-weighted mean of a set of {avg, n} year rows.
function wmean(rows, key) {
  let s = 0, n = 0;
  for (const r of rows) { if (r[key] != null && r.responses) { s += r[key] * r.responses; n += r.responses; } }
  return n ? r2(s / n) : null;
}

// ── Course rating (the 4 headline course metrics) ──────────────────────────
function courseRating(courseId) {
  if (!courseId || !tableExists('course_feedback')) return null;
  const rows = db.prepare(
    'SELECT year, responses, content, benefits, practical, overall, provider_id FROM course_feedback WHERE course_id = ? ORDER BY year'
  ).all(courseId);
  if (!rows.length) return null;
  const responses = rows.reduce((a, r) => a + (r.responses || 0), 0);
  const content = wmean(rows, 'content'), benefits = wmean(rows, 'benefits');
  const practical = wmean(rows, 'practical'), overall = wmean(rows, 'overall');
  const provId = (rows.find((r) => r.provider_id) || {}).provider_id || null;
  return {
    responses,
    stars: overall, // headline = overall evaluation
    content, benefits, practical, overall,
    years: rows.map((r) => r.year),
    provider: provId ? providerRating(provId) : null,
  };
}

// ── Provider rating (the 3 headline trainer-delivery metrics) ──────────────
function providerRating(providerId) {
  if (!providerId || !tableExists('provider_feedback')) return null;
  const rows = db.prepare(
    'SELECT year, responses, knowledge, clarity, interaction, provider_name FROM provider_feedback WHERE provider_id = ? ORDER BY year'
  ).all(providerId);
  if (!rows.length) return null;
  const responses = rows.reduce((a, r) => a + (r.responses || 0), 0);
  const knowledge = wmean(rows, 'knowledge'), clarity = wmean(rows, 'clarity'), interaction = wmean(rows, 'interaction');
  return {
    provider_id: providerId,
    provider_name: rows[0].provider_name,
    responses,
    stars: r2(((knowledge || 0) + (clarity || 0) + (interaction || 0)) / 3) || null,
    knowledge, clarity, interaction,
    years: rows.map((r) => r.year),
  };
}

// Map of course_id → headline rating, for cheaply decorating course lists.
function courseRatingMap() {
  if (!tableExists('course_feedback')) return {};
  const rows = db.prepare('SELECT course_id, year, responses, content, benefits, practical, overall, provider_id FROM course_feedback WHERE course_id IS NOT NULL').all();
  const byId = {};
  for (const r of rows) (byId[r.course_id] = byId[r.course_id] || []).push(r);
  const out = {};
  for (const [id, rs] of Object.entries(byId)) {
    out[id] = {
      responses: rs.reduce((a, r) => a + (r.responses || 0), 0),
      content: wmean(rs, 'content'), benefits: wmean(rs, 'benefits'),
      practical: wmean(rs, 'practical'), overall: wmean(rs, 'overall'),
      stars: wmean(rs, 'overall'),
    };
  }
  return out;
}

// ── Full datasets for the command centre drill-down ────────────────────────
function parse(j) { try { return JSON.parse(j); } catch (_) { return null; } }

function allCourseFeedback() {
  if (!tableExists('course_feedback')) return [];
  const rows = db.prepare('SELECT * FROM course_feedback ORDER BY course_name, year').all();
  return rows.map((r) => ({ ...r, metrics: parse(r.metrics_json), metrics_json: undefined }));
}
function allProviderFeedback() {
  if (!tableExists('provider_feedback')) return [];
  const rows = db.prepare('SELECT * FROM provider_feedback ORDER BY provider_name, year').all();
  return rows.map((r) => ({ ...r, metrics: parse(r.metrics_json), metrics_json: undefined }));
}

// Command-centre summary: combined-by-course + combined-by-provider + totals.
function summary() {
  const courses = allCourseFeedback();
  const providers = allProviderFeedback();
  // combine course rows by course (id when present else key)
  const cmap = {};
  for (const r of courses) {
    const k = r.course_id || r.course_key;
    (cmap[k] = cmap[k] || { key: k, course_id: r.course_id, course_name: r.course_name, provider_name: r.provider_name, rows: [] }).rows.push(r);
  }
  const courseRollup = Object.values(cmap).map((c) => ({
    key: c.key, course_id: c.course_id, course_name: c.course_name, provider_name: c.provider_name,
    responses: c.rows.reduce((a, r) => a + r.responses, 0),
    content: wmean(c.rows, 'content'), benefits: wmean(c.rows, 'benefits'),
    practical: wmean(c.rows, 'practical'), overall: wmean(c.rows, 'overall'),
    years: c.rows.map((r) => r.year).sort(),
  })).sort((a, b) => (b.responses || 0) - (a.responses || 0));

  const pmap = {};
  for (const r of providers) {
    const k = r.provider_id || r.provider_key;
    (pmap[k] = pmap[k] || { key: k, provider_id: r.provider_id, provider_name: r.provider_name, rows: [] }).rows.push(r);
  }
  const providerRollup = Object.values(pmap).map((p) => ({
    key: p.key, provider_id: p.provider_id, provider_name: p.provider_name,
    responses: p.rows.reduce((a, r) => a + r.responses, 0),
    knowledge: wmean(p.rows, 'knowledge'), clarity: wmean(p.rows, 'clarity'), interaction: wmean(p.rows, 'interaction'),
    years: p.rows.map((r) => r.year).sort(),
  })).sort((a, b) => (b.responses || 0) - (a.responses || 0));

  const totalResponses = courses.reduce((a, r) => a + r.responses, 0);
  return {
    totals: {
      responses: totalResponses,
      courses_rated: courseRollup.length,
      providers_rated: providerRollup.filter((p) => p.provider_id).length,
      years: [...new Set(courses.map((r) => r.year))].sort(),
    },
    courses: courseRollup,
    providers: providerRollup,
    course_years: courses,     // raw per-year (with metrics) for deepest drill
    provider_years: providers,
  };
}

module.exports = {
  courseRating, providerRating, courseRatingMap,
  allCourseFeedback, allProviderFeedback, summary,
};
