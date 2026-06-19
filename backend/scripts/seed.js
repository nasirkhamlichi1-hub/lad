'use strict';

// Seed the database from data/Blank_data_25.xlsx — the LAD-supplied report.
// Usage: `npm run seed`. Idempotent — uses INSERT OR REPLACE on every row.

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const db = require('../src/db');

// Prefer the committed, PII-free report in seed-data/ (ships with the image,
// not hidden by the /app/data runtime volume); fall back to data/ for local use.
const SOURCE = [
  path.join(__dirname, '..', 'seed-data', 'Blank_data_25.xlsx'),
  path.join(__dirname, '..', 'data', 'Blank_data_25.xlsx'),
].find((p) => fs.existsSync(p));
if (!SOURCE) {
  console.error('✗ Blank_data_25.xlsx not found in seed-data/ or data/. Place the LAD report and re-run.');
  process.exit(1);
}

console.log(`Reading ${SOURCE} …`);
const wb = xlsx.readFile(SOURCE);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });
console.log(`Loaded ${rows.length.toLocaleString()} rows.`);

// ─── Helpers ─────────────────────────────────────────────────────────
const slug = (s) => (s || '').toString()
  .toLowerCase()
  .replace(/&/g, 'and')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 40);

const cleanFirmName = (s) => (s || '').toString().trim();
const EXCLUDE_FIRMS = new Set(['Resigned', 'Resigned ', 'Others', 'Non-Lawyer',
  'Non-practising', 'Inactive', 'Left Jurisdiction', '']);

const parseSchedule = (s) => {
  if (!s) return { start: null, end: null };
  const m = /(\d{1,2}\s\w+,\s\d{4})/.exec(s);
  if (!m) return { start: null, end: null };
  const d = new Date(m[1].replace(',', ''));
  if (isNaN(d.getTime())) return { start: null, end: null };
  return { start: d.toISOString().slice(0, 19) + 'Z', end: null };
};

const mapStatus = (s) => {
  if (!s) return 'booked';
  const head = s.toString().split('<br/>')[0].trim();
  return ({
    'Completed': 'attended', 'In Progress': 'booked', 'Not Started': 'booked',
    'Cancelled': 'cancelled', 'Dropped': 'no-show', 'Absent': 'no-show',
    'Self Dropped': 'cancelled', 'Self Dropped & Refunded': 'refunded',
    'Firm Dropped & Refunded': 'refunded',
  })[head] || 'booked';
};

const courseIdFor = (title) => {
  const t = (title || '').toString().toLowerCase();
  if (t.includes('anti money laundering') || t.includes('aml')) return 'aml';
  if (t.includes('code of ethics')) return 'ethics';
  if (t.includes('uae legal framework')) return 'uae-framework';
  if (t.includes('civil transactions')) return 'civil-trans';
  if (t.includes('data protection')) return 'data-protection';
  if (t.includes('international arbitration')) return 'difc-arb';
  if (t.includes('exclusion and limitation')) return 'exclusion';
  if (t.includes('powers of attorney')) return 'poa';
  if (t.includes('advanced mediation')) return 'mediation';
  if (t.includes('common law contract')) return 'common-law';
  if (t.includes('artificial intelligence and copyright')) return 'ai-copyright';
  if (t.includes('assignment')) return 'assignment';
  if (t.includes('tax law update')) return 'tax-update';
  if (t.includes('ai governance')) return 'ai-gov';
  if (t.includes('esg') || t.includes('climate')) return 'esg';
  if (t.includes('real estate') && t.includes('construction')) return 'construction';
  return slug(title) || 'misc';
};

// ─── 1. Insert reference data: firms & providers ─────────────────────
console.log('\n[1/4] Firms & providers…');

const firms = new Map();   // id → { id, name, lawyer_count }
const providers = new Map(); // id → { id, name }

for (const r of rows) {
  const firmName = cleanFirmName(r['Firm']);
  if (firmName && !EXCLUDE_FIRMS.has(firmName)) {
    const id = slug(firmName);
    if (!firms.has(id)) {
      firms.set(id, { id, name: firmName, full_name: firmName });
    }
  }
  const provName = (r['Course Provider'] || '').toString().trim();
  if (provName && provName !== '-' && provName !== '') {
    const id = slug(provName);
    if (!providers.has(id)) {
      providers.set(id, { id, name: provName, full_name: provName });
    }
  }
}

const insertFirm = db.prepare(`INSERT OR REPLACE INTO firms (id, name, full_name, status)
                                VALUES (?, ?, ?, 'practising')`);
const insertProv = db.prepare(`INSERT OR REPLACE INTO providers (id, name, full_name, accredited)
                                VALUES (?, ?, ?, 1)`);

db.transaction(() => {
  for (const f of firms.values()) insertFirm.run(f.id, f.name, f.full_name);
  for (const p of providers.values()) insertProv.run(p.id, p.name, p.full_name);
})();

console.log(`  → ${firms.size} firms, ${providers.size} providers`);

// ─── 2. Aggregate lawyers (one row per unique Firm/Lawyer ID) ────────
console.log('\n[2/4] Lawyers…');

const lawyers = new Map(); // id → record
for (const r of rows) {
  const lid = r['Firm/Lawyer ID'];
  if (!lid || !lid.startsWith('L-')) continue; // skip non-Lawyer rows
  if (!lawyers.has(lid)) {
    const firmName = cleanFirmName(r['Firm']);
    const nm = (r['Name'] || '').toString().trim();
    const sp = nm.indexOf(' ');
    lawyers.set(lid, {
      id: lid,
      first_name: sp > 0 ? nm.slice(0, sp) : nm,
      last_name: sp > 0 ? nm.slice(sp + 1) : '',
      email: r['Email'] || r['Email '] || null,
      phone: r['Phone'] || null,
      gender: r['Gender'] || null,
      firm_id: (firmName && !EXCLUDE_FIRMS.has(firmName)) ? slug(firmName) : null,
      role: r['Jobtitle'] || null,
      practice_areas: r['Specialisms'] || null,
      qualification_country: r['Qualification Country'] || null,
      joined_date: r['Joining Date'] || null,
      preferred_language: r['Prefer Language'] || 'English',
      status: 'active',
      credit_balance: r['Current Credits'] || 0,
      total_purchased: r['Total Purchased Credits'] || 0,
      total_refunded: r['Total Refunded Credits'] || 0,
      lifetime_points: 0, // computed below by summing completed-course points
    });
  }
  // Anonymise: real names are typically null in the LAD report. If the
  // partner wants names populated, they go here; otherwise we leave blank
  // and let the frontend fall back to "Lawyer L-01494" style labels.
}

// Mark resigned/non-practising for filtering
for (const r of rows) {
  const lid = r['Firm/Lawyer ID'];
  if (!lid || !lawyers.has(lid)) continue;
  const fn = cleanFirmName(r['Firm']);
  if (fn === 'Resigned' || fn === 'Resigned ') lawyers.get(lid).status = 'resigned';
  else if (fn === 'Inactive') lawyers.get(lid).status = 'inactive';
  else if (fn === 'Non-practising') lawyers.get(lid).status = 'inactive';
  else if (fn === 'Left Jurisdiction') lawyers.get(lid).status = 'inactive';
}

// Points are earned on COMPLETED courses. lifetime_points = the sum of every
// completed course's Points Received for that lawyer (the report has no
// pre-aggregated total). This is what drives the compliance bands.
for (const r of rows) {
  const lid = r['Firm/Lawyer ID'];
  if (!lid || !lawyers.has(lid)) continue;
  if (mapStatus(r['Course Status']) === 'attended') {
    const p = Number(r['Points Received']) || 0;
    lawyers.get(lid).lifetime_points += p;
  }
}

const insertLawyer = db.prepare(`INSERT OR REPLACE INTO lawyers
  (id, first_name, last_name, email, phone, gender, firm_id, role, practice_areas,
   qualification_country, joined_date, preferred_language, status,
   credit_balance, total_purchased, total_refunded, lifetime_points)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

db.transaction(() => {
  for (const l of lawyers.values()) {
    insertLawyer.run(l.id, l.first_name, l.last_name, l.email, l.phone, l.gender,
      l.firm_id, l.role, l.practice_areas, l.qualification_country, l.joined_date,
      l.preferred_language, l.status, l.credit_balance, l.total_purchased,
      l.total_refunded, l.lifetime_points);
  }
})();
console.log(`  → ${lawyers.size.toLocaleString()} lawyers (${[...lawyers.values()].filter(l=>l.status==='active').length.toLocaleString()} practising)`);

// ─── 3. Courses (deduced from booking history) ───────────────────────
console.log('\n[3/4] Courses…');

const courses = new Map();
for (const r of rows) {
  const title = (r['Course Name'] || '').toString().trim();
  if (!title) continue;
  const id = courseIdFor(title);
  if (!courses.has(id)) {
    const provName = (r['Course Provider'] || '').toString().trim();
    courses.set(id, {
      id, title,
      pts: r['Points Received'] && r['Points Received'] > 0 ? r['Points Received'] : 2,
      provider_id: provName && provName !== '-' ? slug(provName) : null,
      type: title.toLowerCase().includes('ethics') ? 'mandatory' : 'accredited',
      format: 'face-to-face',
      active: 1,
    });
  }
}

const insertCourse = db.prepare(`INSERT OR REPLACE INTO courses
  (id, title, type, format, pts, credits, provider_id, active)
  VALUES (?, ?, ?, ?, ?, 5, ?, ?)`);

db.transaction(() => {
  for (const c of courses.values()) {
    insertCourse.run(c.id, c.title, c.type, c.format, c.pts, c.provider_id, c.active);
  }
})();
console.log(`  → ${courses.size} unique courses`);

// ─── 4. Bookings ─────────────────────────────────────────────────────
console.log('\n[4/4] Bookings (this takes ~30s)…');

const insertBooking = db.prepare(`INSERT OR REPLACE INTO bookings
  (id, lawyer_id, course_id, course_title, provider_id, scheduled_at, status,
   points_earned, credits_used, language, booked_by, booked_at, admin_notes, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

let inserted = 0, skipped = 0;
db.transaction(() => {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const lid = r['Firm/Lawyer ID'];
    if (!lid || !lid.startsWith('L-') || !lawyers.has(lid)) { skipped++; continue; }
    const title = (r['Course Name'] || '').toString().trim();
    if (!title) { skipped++; continue; }

    const courseId = courseIdFor(title);
    const sched = parseSchedule(r['Course Schedule']);
    const providerName = (r['Course Provider'] || '').toString().trim();
    const id = `${lid}::${courseId}::${sched.start || i}`.replace(/[^a-zA-Z0-9_:-]/g,'_');
    let bookedAt = null;
    if (r['Course booked date']) { try { bookedAt = new Date(r['Course booked date'].toString().replace(',','')).toISOString(); } catch (_) {} }
    const createdAt = bookedAt || sched.start || null; // real activity date, not import time

    insertBooking.run(
      id, lid, courseId, title,
      providerName && providerName !== '-' ? slug(providerName) : null,
      sched.start, mapStatus(r['Course Status']),
      r['Points Received'] || 0, 0,
      r['Prefer Language'] || 'English',
      r['Course bookedby'] || null,
      bookedAt,
      r['Course Admin Notes'] || null,
      createdAt
    );
    inserted++;

    if (inserted % 10000 === 0) {
      console.log(`    …${inserted.toLocaleString()} bookings inserted`);
    }
  }
})();
console.log(`  → ${inserted.toLocaleString()} bookings (${skipped.toLocaleString()} skipped)`);

// ─── 5. Default seed staff ───────────────────────────────────────────
console.log('\n[5/5] Default staff accounts (development only — change in production)…');
const bcrypt = require('bcryptjs');
const hash = bcrypt.hashSync('Welcome2026!', 8);

db.prepare(`INSERT OR REPLACE INTO staff (id, email, first_name, last_name, role, password_hash)
  VALUES (?, ?, ?, ?, ?, ?)`).run(
  'staff-lad-1', 'admin@legal.dubai.gov.ae', 'LAD', 'Admin', 'lad_admin', hash);

db.prepare(`INSERT OR REPLACE INTO staff (id, email, first_name, last_name, role, firm_id, password_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
  'staff-galadari-co', 'f.almansouri@galadari.ae', 'Fatima', 'Al Mansouri',
  'firm_compliance_officer', 'galadari-advocates-and-legal-consultants', hash);

console.log('  → staff seeded. Default password: Welcome2026!  (CHANGE BEFORE PRODUCTION)');

// ─── 6. Skill Graph: schema + taxonomy + course topic fingerprints ───
console.log('\n[6/8] Applying skills schema…');
const skillsSchema = require('fs').readFileSync(
  path.join(__dirname, '..', 'src', 'schema-skills.sql'), 'utf8');
db.exec(skillsSchema);
console.log('  → schema-skills.sql applied');

console.log('\n[7/8] Loading taxonomy (220 nodes)…');
const taxonomy = require('./taxonomy-seed');
const insertTaxon = db.prepare(`INSERT OR REPLACE INTO taxonomies
  (id, parent_id, label, label_ar, domain, level, active)
  VALUES (?, ?, ?, ?, ?, ?, 1)`);
db.transaction(() => {
  for (const n of taxonomy) {
    insertTaxon.run(n.id, n.parent || null, n.label, n.label_ar || null, n.domain, n.level);
  }
})();
console.log(`  → ${taxonomy.length} taxonomy nodes loaded`);

console.log('\n  Loading course → topic fingerprints…');
const courseTopics = require('./course-topics-seed');
const insertCourseTopic = db.prepare(`INSERT OR REPLACE INTO course_topics
  (course_id, topic_id, weight, source) VALUES (?, ?, ?, 'manual')`);
let mappingCount = 0;
// Only map topics for courses that actually exist in this dataset — the
// fingerprint seed is a superset and its course ids won't all be present.
const knownCourses = new Set(db.prepare('SELECT id FROM courses').all().map((c) => c.id));
db.transaction(() => {
  for (const [courseId, topics] of Object.entries(courseTopics)) {
    if (!knownCourses.has(courseId)) continue;
    for (const t of topics) {
      try { insertCourseTopic.run(courseId, t.topic_id, t.weight); mappingCount++; } catch (_) {}
    }
  }
})();
console.log(`  → ${mappingCount} course-topic mappings inserted for ${Object.keys(courseTopics).length} courses`);

console.log('\n[8/8] Rebuilding skill graph from all attended bookings…');
const skillsService = require('../src/services/skills');
const rebuilt = skillsService.rebuildAllSkillEvents();
console.log(`  → ${rebuilt.events.toLocaleString()} skill events created across ${rebuilt.matched.toLocaleString()} bookings`);

// ─── Summary ─────────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────');
console.log('  Seed complete.');
console.log(`  Firms:        ${db.prepare('SELECT COUNT(*) AS n FROM firms').get().n}`);
console.log(`  Providers:    ${db.prepare('SELECT COUNT(*) AS n FROM providers').get().n}`);
console.log(`  Courses:      ${db.prepare('SELECT COUNT(*) AS n FROM courses').get().n}`);
console.log(`  Lawyers:      ${db.prepare('SELECT COUNT(*) AS n FROM lawyers').get().n.toLocaleString()}`);
console.log(`  Bookings:     ${db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n.toLocaleString()}`);
console.log(`  Staff:        ${db.prepare('SELECT COUNT(*) AS n FROM staff').get().n}`);
console.log(`  Taxonomy:     ${db.prepare('SELECT COUNT(*) AS n FROM taxonomies').get().n} nodes`);
console.log(`  Course tags:  ${db.prepare('SELECT COUNT(*) AS n FROM course_topics').get().n}`);
console.log(`  Skill events: ${db.prepare('SELECT COUNT(*) AS n FROM skill_events').get().n.toLocaleString()}`);
console.log('────────────────────────────────────────');
