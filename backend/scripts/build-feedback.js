'use strict';

// build-feedback.js — one-off (re-runnable) builder. Reads the two raw mandatory
// feedback exports, STRIPS all individual trainer identity, resolves each row to
// a catalogue course_id / provider_id, aggregates into per-course and
// per-provider star ratings (1–5) per year, and writes a trainer-free artifact
// to seed-data/feedback-aggregates.json. Only this artifact is committed — the
// raw exports (which contain trainer names) are never stored in the repo.
//
// Usage: node scripts/build-feedback.js <feedback_2025.xlsx> <feedback_2026.xlsx>

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const config = require('../src/config');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node scripts/build-feedback.js <2025.xlsx> <2026.xlsx>');
  process.exit(1);
}
const [F2025, F2026] = args;

// ── Rating scales → stars out of 5 ──────────────────────────────────────────
const EXCELLENT = { excellent: 5, 'very good': 4, good: 3, average: 2, poor: 1 };
const AGREE = { 'strongly agree': 5, agree: 4, neutral: 3, disagree: 2, 'strongly disagree': 1 };

// English leading part of a bilingual cell ("Excellent ممتاز" → "excellent").
const norm = (s) => String(s == null ? '' : s).trim().split(/\s+(?=[؀-ۿ])/)[0].trim().toLowerCase();
function score(val, scale) {
  const v = norm(val);
  if (!v) return null;
  return Object.prototype.hasOwnProperty.call(scale, v) ? scale[v] : null;
}

// Metric definitions: key → { col index per file, scale }. The four headline
// COURSE metrics and three headline PROVIDER metrics the portal surfaces are
// flagged; the rest are kept for command-centre drill-down.
const E = 'excellent', A = 'agree';
const METRICS = [
  // provider / trainer-delivery metrics
  ['knowledge',       5,  4,  E], // Knowledge of the training course subject   ★ provider
  ['clarity',         6,  5,  E], // Ability to convey information clearly       ★ provider
  ['organization',    7,  6,  E],
  ['variety',         8,  7,  E],
  ['interaction',     9,  8,  E], // Ability to stimulate participants           ★ provider
  ['management',      10, 9,  E],
  ['responsiveness',  11, 10, E],
  // course metrics
  ['content',         12, 11, E], // Training course content                     ★ course
  ['volume',          13, 12, E],
  ['clarity_content', 14, 13, E],
  ['benefits',        15, 14, E], // Benefits of the training course             ★ course
  ['relevancy',       16, 15, E],
  ['presentation',    17, 16, E],
  ['practical',       18, 17, E], // The content was interesting and practical   ★ course
  ['recommend',       19, 18, A],
  ['practice',        20, 19, A],
  ['overall',         21, 20, E], // Overall evaluation of the course            ★ course
];
const SCALE = { excellent: EXCELLENT, agree: AGREE };

// ── Course / provider name resolution against the live catalogue ────────────
const db = new Database(path.resolve(config.databaseUrl), { readonly: true });
const catalogue = db.prepare('SELECT id, title, provider_id FROM courses').all();
const providers = db.prepare('SELECT id, name FROM providers').all();

function courseKey(name) {
  let s = String(name || '').toLowerCase();
  s = s.replace(/[؀-ۿ]/g, ' ');
  s = s.replace(/&#0?38;|&amp;/g, 'and').replace(/&/g, 'and');
  s = s.replace(/[‘’′`]/g, '');
  s = s.replace(/\([^)]*\)/g, ' ');
  s = s.split(/[–—:-]/)[0];
  s = s.replace(/\b(updated content|e ?learning|masterclass|part\s*[i1]|aa\d+|bb\d+)\b/g, ' ');
  s = s.replace(/[^a-z0-9]+/g, ' ');
  s = s.replace(/\b(the|a|an|of|in|and|for|to|under|uae|course|only|internal|employees)\b/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}
const byKey = new Map();
for (const c of catalogue) { const k = courseKey(c.title); if (k && !byKey.has(k)) byKey.set(k, c); }
const catById = new Map(catalogue.map((c) => [c.id, c]));
// Manual aliases for feedback names that don't normalise onto a catalogue title
// (renamed year-to-year, Arabic-only, or shortened). Maps raw feedback name → course_id.
const ALIAS = {
  'التقاضي والتحكيم في القانون الجوي': 'litigation-and-arbitration-in-aviation-l',
  'Anti Money Laundering': 'anti-money-laundering-for-law-firms',
  'Data Protection Law (E-learning)': 'data-protection',
  'Common law contract principles': 'common-law',
};
function resolveCourse(name) {
  const alias = ALIAS[String(name || '').trim()];
  if (alias && catById.has(alias)) return catById.get(alias);
  const k = courseKey(name);
  if (byKey.has(k)) return byKey.get(k);
  for (const c of catalogue) {
    const ck = courseKey(c.title);
    if (ck && (ck.includes(k) || k.includes(ck)) && Math.min(ck.length, k.length) > 6) return c;
  }
  return null;
}
function resolveProvider(name) {
  const t = String(name || '').toLowerCase().replace(/[^a-z]/g, ' ').trim().split(' ')[0];
  if (!t) return null;
  return providers.find((p) => p.id.includes(t) || p.name.toLowerCase().includes(t)) || null;
}

// ── Parse one file into normalised rows ─────────────────────────────────────
function parse(file, year) {
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  const body = rows.slice(1).filter((r) => r && r[1] != null && String(r[1]).trim());
  const idx = year === 2025 ? 1 : 0; // column-set: 2025 has Identifier+Trainer, 2026 doesn't
  return body.map((r) => {
    const out = { year, course: String(r[1]).trim(), language: norm(r[2]), provider: String(r[3]).trim(), m: {} };
    for (const [key, c25, c26, sc] of METRICS) out.m[key] = score(r[idx === 1 ? c25 : c26], SCALE[sc]);
    return out;
  });
}

// ── Aggregate ───────────────────────────────────────────────────────────────
function blankAgg() { const m = {}; for (const [k] of METRICS) m[k] = { sum: 0, n: 0, dist: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } }; return m; }
function add(agg, row) {
  agg.responses++;
  for (const [k] of METRICS) {
    const v = row.m[k];
    if (v == null) continue;
    agg.m[k].sum += v; agg.m[k].n += 1; agg.m[k].dist[v] += 1;
  }
}
function finalize(m) {
  const out = {};
  for (const [k] of METRICS) { const a = m[k]; out[k] = { avg: a.n ? Math.round((a.sum / a.n) * 100) / 100 : null, n: a.n, dist: a.dist }; }
  return out;
}

const rows = [...parse(F2025, 2025), ...parse(F2026, 2026)];

// per course-key + year
const courseAgg = new Map();
const provAgg = new Map();
let matched = 0; const unmatched = new Set();
for (const r of rows) {
  const c = resolveCourse(r.course);
  if (c) matched++; else unmatched.add(`${r.year}: ${r.course}`);
  const ck = courseKey(r.course) || r.course.toLowerCase();
  const cKey = `${ck}|${r.year}`;
  if (!courseAgg.has(cKey)) {
    const p = resolveProvider(r.provider);
    courseAgg.set(cKey, { course_key: ck, course_id: c ? c.id : null, course_name: r.course, provider_id: p ? p.id : null, provider_name: r.provider, year: r.year, responses: 0, m: blankAgg() });
  }
  add(courseAgg.get(cKey), r);

  const p = resolveProvider(r.provider);
  const pid = p ? p.id : ('unmapped:' + r.provider.toLowerCase());
  const pKey = `${pid}|${r.year}`;
  if (!provAgg.has(pKey)) provAgg.set(pKey, { provider_id: p ? p.id : null, provider_name: r.provider, year: r.year, responses: 0, m: blankAgg() });
  add(provAgg.get(pKey), r);
}

const courses = [...courseAgg.values()].map((c) => ({
  course_key: c.course_key, course_id: c.course_id, course_name: c.course_name,
  provider_id: c.provider_id, provider_name: c.provider_name, year: c.year,
  responses: c.responses, metrics: finalize(c.m),
})).sort((a, b) => a.course_name.localeCompare(b.course_name) || a.year - b.year);

const provs = [...provAgg.values()].map((p) => ({
  provider_id: p.provider_id, provider_name: p.provider_name, year: p.year,
  responses: p.responses, metrics: finalize(p.m),
})).sort((a, b) => a.provider_name.localeCompare(b.provider_name) || a.year - b.year);

const artifact = {
  generated_at: new Date().toISOString(),
  note: 'Aggregated mandatory-course feedback. Trainer identities intentionally excluded.',
  scale: 'Excellent=5, Very Good=4, Good=3, Average=2, Poor=1 (Agree-scale: Strongly Agree=5 … Strongly Disagree=1)',
  headline: {
    course: { content: 'Training course content', benefits: 'Benefits of the training course', practical: 'Practical / interesting content', overall: 'Overall evaluation' },
    provider: { knowledge: 'Knowledge of trainer', clarity: 'Ability to convey information clearly', interaction: 'Ability to stimulate participants to interact' },
  },
  courses, providers: provs,
};

const outPath = path.join(__dirname, '..', 'seed-data', 'feedback-aggregates.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));

console.log(`Rows parsed: ${rows.length} (matched to catalogue: ${matched}, unmatched rows: ${rows.length - matched})`);
console.log(`Course-year aggregates: ${courses.length}; provider-year aggregates: ${provs.length}`);
console.log(`Unmatched course names (${unmatched.size}):`); [...unmatched].sort().forEach((u) => console.log('   ✗ ' + u));
console.log(`\nWrote ${outPath}`);
