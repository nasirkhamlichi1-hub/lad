'use strict';

// ─────────────────────────────────────────────────────────────────────
// Learners — whoever is doing the learning, whichever table they live in.
// ─────────────────────────────────────────────────────────────────────
// The learning spine keys everything on `lawyer_id`, which is the JWT `sub`
// of whoever opened the attempt. On the CLPD platform that is a row in
// `lawyers`; on a staff-training instance (Living Horizon) it is a row in
// `staff`; on the freelance-lawyers portal it is a `lawyers` row again,
// but one with no firm. Reporting and assignment used to look a learner up
// in `lawyers` alone, so a staff learner had no name on the cohort page and
// could not be assigned a course at all. This resolves either, in one place,
// and answers "who is everyone?" for the brand this instance serves.

const db = require('../db');
const brand = require('../brand');

// Staff roles that are LEARNERS — people who take courses, as opposed to
// running the platform. The admin roles can also be enrolled (an admin
// previewing a course records real progress), but "assign to everyone"
// means these.
const STAFF_LEARNER_ROLES = ['lad_staff', 'lad_staff_training', 'staff_training', 'trainee'];

// Lawyer statuses that keep a lawyer out of "everyone" and out of the
// assign dialog: they are not practising, or they have been shut out.
const LAWYER_EXCLUDED_STATUS = ['inactive', 'resigned', 'non-practising', 'suspended'];

function shape(row, kind) {
  if (!row) return null;
  return {
    id: row.id,
    kind,
    first_name: row.first_name || '',
    last_name: row.last_name || '',
    name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email || row.id,
    email: row.email || null,
    firm_id: row.firm_id || null,
    role: kind === 'lawyer' ? 'lawyer' : row.role,
    status: row.status || 'active',
    roll_number: row.roll_number || null,
  };
}

function findLearner(id) {
  if (!id) return null;
  try {
    const l = db.prepare('SELECT id, first_name, last_name, email, firm_id, status, roll_number FROM lawyers WHERE id = ?').get(id);
    if (l) return shape(l, 'lawyer');
  } catch (_) { /* no lawyers table on a minimal schema */ }
  try {
    const s = db.prepare('SELECT id, first_name, last_name, email, firm_id, role, status FROM staff WHERE id = ?').get(id);
    if (s) return shape(s, 'staff');
  } catch (_) {}
  return null;
}

// ─── Staff learners ─────────────────────────────────────────────────
function listStaffLearners() {
  const marks = STAFF_LEARNER_ROLES.map(() => '?').join(',');
  return db.prepare(
    `SELECT id, first_name, last_name, email, firm_id, role, status FROM staff
     WHERE role IN (${marks}) AND COALESCE(LOWER(status), 'active') = 'active'
     ORDER BY last_name, first_name`
  ).all(...STAFF_LEARNER_ROLES).map((r) => shape(r, 'staff'));
}

function searchStaffLearners(q, limit = 25) {
  const like = `%${String(q || '').toLowerCase()}%`;
  const marks = STAFF_LEARNER_ROLES.map(() => '?').join(',');
  return db.prepare(
    `SELECT id, first_name, last_name, email, firm_id, role, status FROM staff
     WHERE role IN (${marks})
       AND (LOWER(email) LIKE ? OR LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ?
            OR LOWER(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) LIKE ?)
     ORDER BY last_name, first_name LIMIT ?`
  ).all(...STAFF_LEARNER_ROLES, like, like, like, like, limit).map((r) => shape(r, 'staff'));
}

// ─── Lawyer learners (the freelance portal) ─────────────────────────
// Every practising lawyer on the instance. On the CLPD platform "everyone"
// would be the whole Dubai roll, which is never what an admin means, so
// these are only offered when the brand's learners are firm-less lawyers.
function lawyerStatusClause() {
  const marks = LAWYER_EXCLUDED_STATUS.map(() => '?').join(',');
  return { sql: `COALESCE(LOWER(status), 'active') NOT IN (${marks})`, args: LAWYER_EXCLUDED_STATUS };
}

function listLawyerLearners() {
  const st = lawyerStatusClause();
  return db.prepare(
    `SELECT id, first_name, last_name, email, firm_id, status, roll_number FROM lawyers
     WHERE ${st.sql} ORDER BY last_name, first_name`
  ).all(...st.args).map((r) => shape(r, 'lawyer'));
}

function searchLawyerLearners(q, limit = 25) {
  const like = `%${String(q || '').toLowerCase()}%`;
  const st = lawyerStatusClause();
  return db.prepare(
    `SELECT id, first_name, last_name, email, firm_id, status, roll_number FROM lawyers
     WHERE ${st.sql}
       AND (LOWER(email) LIKE ? OR LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ?
            OR LOWER(COALESCE(roll_number,'')) LIKE ?
            OR LOWER(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) LIKE ?)
     ORDER BY last_name, first_name LIMIT ?`
  ).all(...st.args, like, like, like, like, like, limit).map((r) => shape(r, 'lawyer'));
}

// ─── Whoever this instance teaches ──────────────────────────────────
// "Everyone" and the assign dialog's search, for the brand's own learners.
// A firm-based brand (LAD) keeps its staff learners here: its lawyers are
// reached through firms, never as "everyone".
const everyoneIsLawyers = brand.learnerKind === 'lawyer' && !brand.firms;
function listLearners() { return everyoneIsLawyers ? listLawyerLearners() : listStaffLearners(); }
function searchLearners(q, limit) { return everyoneIsLawyers ? searchLawyerLearners(q, limit) : searchStaffLearners(q, limit); }

// A SQL fragment that names a learner from either table. `alias` is the
// column holding the learner id. Portable: COALESCE and TRIM only.
function nameSql(alias) {
  return `COALESCE(NULLIF(TRIM(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')), ''),
                   NULLIF(TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')), ''),
                   ${alias})`;
}

module.exports = {
  findLearner, nameSql, STAFF_LEARNER_ROLES,
  listStaffLearners, searchStaffLearners, listLawyerLearners, searchLawyerLearners,
  listLearners, searchLearners, everyoneIsLawyers,
};
