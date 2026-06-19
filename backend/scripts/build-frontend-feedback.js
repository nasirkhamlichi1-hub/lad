'use strict';

// Builds frontend/feedback.json — a precomputed, response-weighted view of the
// committed feedback aggregates, so the portal / command centre can show real
// ratings straight from the static frontend deploy even if the backend API
// hasn't loaded the data yet. Keyed by course_id and normalised course key, with
// each course's provider rating attached, plus a command-centre summary.
//
// Usage: node scripts/build-frontend-feedback.js

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'seed-data', 'feedback-aggregates.json');
const OUT = path.join(__dirname, '..', '..', 'frontend', 'feedback.json');
const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));

const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
// Displayed score = 5 × proportion rated Good or better (3+), combined across
// the metric's distribution. Falls back to response-weighted mean if no dist.
function wmean(rows, key) {
  let pos = 0, tot = 0, haveDist = false;
  for (const r of rows) {
    const m = r.metrics && r.metrics[key];
    if (m && m.dist) { haveDist = true; pos += (m.dist[3] || 0) + (m.dist[4] || 0) + (m.dist[5] || 0); tot += (m.dist[1] || 0) + (m.dist[2] || 0) + (m.dist[3] || 0) + (m.dist[4] || 0) + (m.dist[5] || 0); }
  }
  if (haveDist) return tot ? r2(pos / tot * 5) : null;
  let s = 0, n = 0;
  for (const r of rows) { const v = r.metrics && r.metrics[key] ? r.metrics[key].avg : r[key]; if (v != null && r.responses) { s += v * r.responses; n += r.responses; } }
  return n ? r2(s / n) : null;
}
function courseKey(name) {
  let s = String(name || '').toLowerCase();
  s = s.replace(/[؀-ۿ]/g, ' ').replace(/&#0?38;|&amp;/g, 'and').replace(/&/g, 'and').replace(/[‘’′`]/g, '');
  s = s.replace(/\([^)]*\)/g, ' ').split(/[–—:-]/)[0];
  s = s.replace(/\b(updated content|e ?learning|masterclass|part\s*[i1]|aa\d+|bb\d+)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ');
  s = s.replace(/\b(the|a|an|of|in|and|for|to|under|uae|course|only|internal|employees)\b/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}
const provToken = (name) => String(name || '').toLowerCase().replace(/[^a-z]/g, ' ').trim().split(' ')[0] || '';

// ── Providers: combine by id and by name token ──
const provById = {}, provByToken = {};
const pgroups = {};
for (const p of data.providers) { const k = p.provider_id || provToken(p.provider_name); (pgroups[k] = pgroups[k] || { name: p.provider_name, id: p.provider_id, rows: [] }).rows.push(p); }
const provObjs = [];
for (const g of Object.values(pgroups)) {
  const knowledge = wmean(g.rows, 'knowledge'), clarity = wmean(g.rows, 'clarity'), interaction = wmean(g.rows, 'interaction');
  const obj = {
    provider_id: g.id, provider_name: g.name,
    responses: g.rows.reduce((a, r) => a + r.responses, 0),
    knowledge, clarity, interaction,
    stars: r2(((knowledge || 0) + (clarity || 0) + (interaction || 0)) / 3) || null,
    years: g.rows.map((r) => r.year).sort(),
  };
  provObjs.push(obj);
  if (g.id) provById[g.id] = obj;
  const tok = provToken(g.name); if (tok) provByToken[tok] = obj;
}
function provFor(course) {
  return (course.provider_id && provById[course.provider_id]) || provByToken[provToken(course.provider_name)] || null;
}

// ── Courses: combine by course_id (and key) ──
const cgroups = {};
for (const c of data.courses) {
  const k = c.course_id || c.course_key;
  (cgroups[k] = cgroups[k] || { id: c.course_id, key: c.course_key, name: c.course_name, provider_id: c.provider_id, provider_name: c.provider_name, rows: [] }).rows.push(c);
}
const byCourseId = {}, byCourseKey = {}, courseRollup = [];
for (const g of Object.values(cgroups)) {
  const overall = wmean(g.rows, 'overall');
  const obj = {
    responses: g.rows.reduce((a, r) => a + r.responses, 0),
    content: wmean(g.rows, 'content'), benefits: wmean(g.rows, 'benefits'),
    practical: wmean(g.rows, 'practical'), overall, stars: overall,
    years: g.rows.map((r) => r.year).sort(),
    provider: provFor(g),
  };
  if (g.id) byCourseId[g.id] = obj;
  if (g.key) byCourseKey[g.key] = obj;
  courseRollup.push({ key: g.id || g.key, course_id: g.id, course_name: g.name, provider_name: g.provider_name, responses: obj.responses, content: obj.content, benefits: obj.benefits, practical: obj.practical, overall, years: obj.years });
}
courseRollup.sort((a, b) => (b.responses || 0) - (a.responses || 0));

const totalResponses = data.courses.reduce((a, r) => a + r.responses, 0);
const summary = {
  totals: { responses: totalResponses, courses_rated: courseRollup.length, providers_rated: provObjs.filter((p) => p.provider_id).length, years: [...new Set(data.courses.map((r) => r.year))].sort() },
  courses: courseRollup,
  providers: provObjs.slice().sort((a, b) => (b.responses || 0) - (a.responses || 0)),
  course_years: data.courses,
  provider_years: data.providers,
};

const out = { generated_at: data.generated_at, byCourseId, byCourseKey, providers: provById, summary };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`Wrote ${OUT}: ${Object.keys(byCourseId).length} courses by id, ${provObjs.length} providers, ${totalResponses} responses.`);
