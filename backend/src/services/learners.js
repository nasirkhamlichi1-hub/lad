'use strict';

// ─────────────────────────────────────────────────────────────────────
// Learners — whoever is doing the learning, whichever table they live in.
// ─────────────────────────────────────────────────────────────────────
// The learning spine keys everything on `lawyer_id`, which is the JWT `sub`
// of whoever opened the attempt. On the CLPD platform that is a row in
// `lawyers`; on a staff-training instance (Living Horizon) it is a row in
// `staff`. Reporting and assignment used to look a learner up in `lawyers`
// alone, so a staff learner had no name on the cohort page and could not be
// assigned a course at all. This resolves either, in one place.

const db = require('../db');

// Staff roles that are LEARNERS — people who take courses, as opposed to
// running the platform. The admin roles can also be enrolled (an admin
// previewing a course records real progress), but "assign to everyone"
// means these.
const STAFF_LEARNER_ROLES = ['lad_staff', 'lad_staff_training', 'staff_training', 'trainee'];

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
  };
}

function findLearner(id) {
  if (!id) return null;
  try {
    const l = db.prepare('SELECT id, first_name, last_name, email, firm_id, status FROM lawyers WHERE id = ?').get(id);
    if (l) return shape(l, 'lawyer');
  } catch (_) { /* no lawyers table on a minimal schema */ }
  try {
    const s = db.prepare('SELECT id, first_name, last_name, email, firm_id, role, status FROM staff WHERE id = ?').get(id);
    if (s) return shape(s, 'staff');
  } catch (_) {}
  return null;
}

// Every active staff learner — "assign this course to everyone".
function listStaffLearners() {
  const marks = STAFF_LEARNER_ROLES.map(() => '?').join(',');
  return db.prepare(
    `SELECT id, first_name, last_name, email, firm_id, role, status FROM staff
     WHERE role IN (${marks}) AND COALESCE(LOWER(status), 'active') = 'active'
     ORDER BY last_name, first_name`
  ).all(...STAFF_LEARNER_ROLES).map((r) => shape(r, 'staff'));
}

// Search staff learners by name or email (the assign dialog).
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

// A SQL fragment that names a learner from either table. `alias` is the
// column holding the learner id. Portable: COALESCE and TRIM only.
function nameSql(alias) {
  return `COALESCE(NULLIF(TRIM(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')), ''),
                   NULLIF(TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')), ''),
                   ${alias})`;
}

module.exports = { findLearner, listStaffLearners, searchStaffLearners, nameSql, STAFF_LEARNER_ROLES };
