'use strict';

// build-accredited.js — parses the accredited-course application data (2025 +
// Q1-2026), de-duplicates by course code, classifies each course public vs
// private, resolves the owning law firm, and writes a committed artifact to
// seed-data/accredited-courses.json.
//
// Rule (from LAD): every accredited course is PRIVATE to its provider firm —
// it must only appear on that firm's view and the LAD backend, never on the
// public site or in another firm's list — EXCEPT courses by DIFC Academy and
// Kwintessential, which are public. (Mandatory courses are separate and always
// public.) A firm's own lawyers can see and book that firm's private courses.
//
// Usage: node scripts/build-accredited.js <2025.xlsx> <Q1-2026.xlsx>

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const config = require('../src/config');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node scripts/build-accredited.js <2025.xlsx> <Q1-2026.xlsx>');
  process.exit(1);
}
const [F2025, F2026] = args;

// ── Firm resolution against the live catalogue ──────────────────────────────
const db = new Database(path.resolve(config.databaseUrl), { readonly: true });
const firms = db.prepare('SELECT id, name, full_name FROM firms').all();
function normFirm(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(llp|llc|ltd|limited|advocates|legal|consultants|consultancy|company|co|and|partners|the|dubai|difc|adgm|branch|middle|east|mea|uae|me)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
const firmKeys = firms.map((f) => ({ id: f.id, name: f.name, k: normFirm(f.name || f.full_name) }));
// Providers whose name doesn't normalise onto their firm record.
const FIRM_ALIAS = {
  'pwc': 'pricewaterhouse-coopers-legal-middle-eas',
};
function resolveFirm(provider) {
  const alias = FIRM_ALIAS[String(provider || '').toLowerCase().trim()];
  if (alias) { const f = firmKeys.find((x) => x.id === alias); if (f) return f; }
  const k = normFirm(provider);
  if (!k) return null;
  let m = firmKeys.find((f) => f.k === k); if (m) return m;
  const pt = k.split(' ')[0];
  if (pt && pt.length > 2) { m = firmKeys.find((f) => f.k.split(' ')[0] === pt); if (m) return m; }
  m = firmKeys.find((f) => (f.k.includes(k) || k.includes(f.k)) && Math.min(f.k.length, k.length) > 4);
  return m || null;
}

// Public accredited providers (the only exceptions to the private rule).
function isPublicProvider(provider) {
  const p = String(provider || '').toLowerCase();
  return /difc\s*academy/.test(p) || /kwintessential/.test(p) || /lexis\s*nexis/.test(p);
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
function parsePoints(v) {
  const m = String(v == null ? '' : v).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 2;
}

// ── Parse one course-database sheet (provider name forward-fills per group) ──
function parseSheet(file, sheet, cols) {
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: null });
  const out = []; let prov = null;
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const name = r[cols.name]; const code = r[cols.code];
    if (!name && !code) continue;
    if (r[cols.prov] != null && String(r[cols.prov]).trim()) prov = String(r[cols.prov]).trim();
    if (!name) continue;
    let pcode = cols.pcode != null && r[cols.pcode] ? String(r[cols.pcode]).trim() : null;
    if (!pcode && code) { const mm = String(code).match(/^([A-Z]+-\d{4}-\d+)/); if (mm) pcode = mm[1]; }
    out.push({ provider: prov, pcode, course: String(name).trim(), code: code ? String(code).trim() : null, points: parsePoints(r[cols.points]) });
  }
  return out;
}

const rows2025 = parseSheet(F2025, 'Accredited Details 2025', { prov: 1, pcode: 2, name: 3, code: 4, points: 5 });
const rows2026 = parseSheet(F2026, 'Accr. Details Jan-Mar 2026', { prov: 1, pcode: 2, name: 4, code: 5, points: 6 });

// ── De-dupe by course code (fallback: provider+name) and build records ──────
const byKey = new Map();
let matched = 0;
const unresolvedPrivate = new Set();
for (const r of [...rows2026, ...rows2025]) { // 2026 first so newer wins
  if (!r.provider) continue;
  const dedupe = (r.code || (r.provider + '::' + r.course)).toLowerCase();
  if (byKey.has(dedupe)) continue;
  const pub = isPublicProvider(r.provider);
  const firm = pub ? null : resolveFirm(r.provider);
  if (!pub) { if (firm) matched++; else unresolvedPrivate.add(r.provider); }
  const id = 'acc-' + (r.code ? slug(r.code) : slug(r.provider).slice(0, 18) + '-' + slug(r.course).slice(0, 24));
  byKey.set(dedupe, {
    id,
    title: r.course,
    code: r.code || null,
    points: r.points,
    provider: r.provider,
    provider_code: r.pcode || null,
    private: pub ? 0 : 1,
    owner_firm_id: firm ? firm.id : null,
    owner_firm_name: firm ? firm.name : null,
  });
}

const courses = [...byKey.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.title.localeCompare(b.title));
const artifact = {
  generated_at: new Date().toISOString(),
  note: 'Accredited courses. Private to the owning firm unless the provider is DIFC Academy or Kwintessential (public). Never list private courses publicly or for other firms.',
  courses,
};
const outPath = path.join(__dirname, '..', 'seed-data', 'accredited-courses.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(artifact, null, 1));

const pub = courses.filter((c) => !c.private).length;
const priv = courses.filter((c) => c.private).length;
const privNoFirm = courses.filter((c) => c.private && !c.owner_firm_id).length;
console.log(`Unique accredited courses: ${courses.length}`);
console.log(`  public (DIFC Academy / Kwintessential): ${pub}`);
console.log(`  private: ${priv}  (resolved to a firm: ${priv - privNoFirm}, no firm match: ${privNoFirm})`);
console.log(`\nPrivate providers with NO firm match (stay LAD-only):`);
[...unresolvedPrivate].sort().forEach((p) => console.log('   • ' + p));
console.log(`\nWrote ${outPath}`);
