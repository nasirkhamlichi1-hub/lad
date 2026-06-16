'use strict';

// Database access helpers used by route handlers. Wraps better-sqlite3 prepared
// statements with sensible defaults; deserialises JSON columns.

const db = require('../db');

// ─── Courses ─────────────────────────────────────────────────────────

function getCourses() {
  return db.prepare(`
    SELECT c.*, p.name AS provider_name
    FROM courses c
    LEFT JOIN providers p ON p.id = c.provider_id
    WHERE c.active = 1
    ORDER BY c.title
  `).all();
}

function getCourseById(id) {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  if (!course) return null;
  course.sessions = db.prepare(`
    SELECT * FROM course_sessions WHERE course_id = ?
    ORDER BY scheduled_at
  `).all(id);
  return course;
}

function upsertCourse(c) {
  db.prepare(`
    INSERT INTO courses (id, title, category, type, format, pts, credits, provider_id, location, description, language, bg, icon, active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET
      title=excluded.title, category=excluded.category, type=excluded.type, format=excluded.format,
      pts=excluded.pts, credits=excluded.credits, provider_id=excluded.provider_id,
      location=excluded.location, description=excluded.description, language=excluded.language,
      bg=excluded.bg, icon=excluded.icon, active=excluded.active, updated_at=CURRENT_TIMESTAMP
  `).run(
    c.id, c.title, c.category || null, c.type || null, c.format || null,
    c.pts || 0, c.credits || 5, c.provider_id || null, c.location || null,
    c.description || null, c.language || 'English', c.bg || null, c.icon || null,
    c.active !== undefined ? c.active : 1
  );
  return getCourseById(c.id);
}

function deleteCourse(id) {
  db.prepare('DELETE FROM courses WHERE id = ?').run(id);
}

// ─── Sessions ────────────────────────────────────────────────────────

function getSessions() {
  return db.prepare(`
    SELECT s.*, c.title AS course_title, c.pts, p.name AS provider_name
    FROM course_sessions s
    JOIN courses c ON c.id = s.course_id
    LEFT JOIN providers p ON p.id = c.provider_id
    ORDER BY s.scheduled_at
  `).all();
}

function bulkUpsertSessions(rows) {
  const stmt = db.prepare(`
    INSERT INTO course_sessions (id, course_id, scheduled_at, end_at, capacity, seats_remaining, venue, language, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      scheduled_at=excluded.scheduled_at, end_at=excluded.end_at,
      capacity=excluded.capacity, seats_remaining=excluded.seats_remaining,
      venue=excluded.venue, language=excluded.language, status=excluded.status
  `);
  const tx = db.transaction((rs) => rs.forEach(r => stmt.run(
    r.id, r.course_id, r.scheduled_at, r.end_at || null,
    r.capacity || 60, r.seats_remaining ?? r.capacity ?? 60,
    r.venue || null, r.language || 'English', r.status || 'open'
  )));
  tx(rows);
  return getSessions();
}

// ─── Content / FAQ ───────────────────────────────────────────────────

const CONTENT_DEFAULT = {
  // matches lad-config.json shape — used as fallback if no rows
  hero_title: 'CLPD — Continuing Legal Professional Development',
  hero_desc: "The 11th year of Dubai's premier legal development programme. 4,411 licensed practitioners. 69 accredited courses.",
  stat_practitioners: 4411,
  stat_courses: 69,
  stat_providers: 11,
  stat_firms: 499,
  stat_rate: 10,
};

function getContent() {
  const rows = db.prepare('SELECT key, value FROM content').all();
  const out = { ...CONTENT_DEFAULT };
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); }
    catch { out[r.key] = r.value; }
  }
  return out;
}

function saveContent(payload) {
  const stmt = db.prepare(`
    INSERT INTO content (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);
  const tx = db.transaction((entries) => {
    for (const [k, v] of entries) {
      stmt.run(k, typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v));
    }
  });
  tx(Object.entries(payload));
  return getContent();
}

function getFAQ() {
  return db.prepare(`
    SELECT id, question, answer, category, display_order
    FROM faq WHERE active = 1
    ORDER BY display_order, id
  `).all();
}

function saveFAQ(items) {
  const ins = db.prepare(`
    INSERT INTO faq (question, answer, category, display_order, active, updated_at)
    VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
  `);
  const tx = db.transaction((arr) => {
    db.prepare('UPDATE faq SET active = 0').run();
    arr.forEach((f, i) => ins.run(f.question, f.answer, f.category || null, f.display_order ?? i * 10));
  });
  tx(items);
  return getFAQ();
}

// ─── Lawyers ─────────────────────────────────────────────────────────

function getLawyerById(id) {
  return db.prepare(`
    SELECT l.*, f.name AS firm_name, f.id AS firm_id
    FROM lawyers l
    LEFT JOIN firms f ON f.id = l.firm_id
    WHERE l.id = ?
  `).get(id);
}

function getLawyerByUaePassUuid(uuid) {
  return db.prepare('SELECT * FROM lawyers WHERE uaepass_uuid = ?').get(uuid);
}

function getLawyerByEmiratesId(eid) {
  return db.prepare('SELECT * FROM lawyers WHERE emirates_id = ?').get(eid);
}

function getLawyerByEmail(email) {
  return db.prepare('SELECT * FROM lawyers WHERE LOWER(email) = LOWER(?)').get(email);
}

function getLawyersByFirm(firmId) {
  return db.prepare(`
    SELECT id, first_name, last_name, role, practice_areas, lifetime_points,
           credit_balance, status, email
    FROM lawyers WHERE firm_id = ? ORDER BY last_name, first_name
  `).all(firmId);
}

function linkLawyerToUaePass({ lawyerId, uaepass_uuid, unified_id, ip }) {
  db.prepare(`UPDATE lawyers
    SET uaepass_uuid = ?, unified_id = ?, last_login_at = CURRENT_TIMESTAMP
    WHERE id = ?`).run(uaepass_uuid, unified_id, lawyerId);
  db.prepare(`INSERT INTO audit_log (actor_id, actor_type, action, target_type, target_id, details, ip)
    VALUES (?, 'lawyer', 'uaepass_link', 'lawyer', ?, ?, ?)`)
    .run(lawyerId, lawyerId, JSON.stringify({ uaepass_uuid }), ip || null);
}

// ─── Firms ───────────────────────────────────────────────────────────

// Award CPD points to a lawyer (e.g. on completing an AI Trainer lesson).
// Increments the lifetime total and records an audit-log entry. Idempotency
// (awarding once) is the caller's responsibility.
function awardCpdPoints({ lawyerId, points, source = 'ai_trainer', refId = null, ip = null }) {
  if (!lawyerId || !points) return false;
  db.prepare('UPDATE lawyers SET lifetime_points = lifetime_points + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(points | 0, lawyerId);
  try {
    db.prepare(`INSERT INTO audit_log (actor_id, actor_type, action, target_type, target_id, details, ip)
      VALUES (?, 'lawyer', 'cpd_award', 'lawyer', ?, ?, ?)`)
      .run(lawyerId, lawyerId, JSON.stringify({ points: points | 0, source, refId }), ip);
  } catch { /* audit is best-effort */ }
  return true;
}

function getFirmById(id) {
  return db.prepare('SELECT * FROM firms WHERE id = ?').get(id);
}

function getAllFirms() {
  return db.prepare(`
    SELECT f.*,
      (SELECT COUNT(*) FROM lawyers WHERE firm_id = f.id AND status = 'active') AS active_lawyers
    FROM firms f
    ORDER BY active_lawyers DESC, f.name
  `).all();
}

// ─── Bookings ────────────────────────────────────────────────────────

function getLawyerBookings(lawyerId) {
  return db.prepare(`
    SELECT b.*, c.title AS course_title_current, p.name AS provider_name
    FROM bookings b
    LEFT JOIN courses c ON c.id = b.course_id
    LEFT JOIN providers p ON p.id = b.provider_id
    WHERE b.lawyer_id = ?
    ORDER BY b.scheduled_at DESC
  `).all(lawyerId);
}

function getFirmBookings(firmId) {
  return db.prepare(`
    SELECT b.*, l.first_name, l.last_name, l.role, c.title AS course_title_current
    FROM bookings b
    JOIN lawyers l ON l.id = b.lawyer_id
    LEFT JOIN courses c ON c.id = b.course_id
    WHERE l.firm_id = ?
    ORDER BY b.scheduled_at DESC
    LIMIT 200
  `).all(firmId);
}

function createBooking(b) {
  const id = b.id || `BK-${Date.now()}-${Math.floor(Math.random()*1000)}`;
  db.prepare(`INSERT INTO bookings
    (id, lawyer_id, session_id, course_id, course_title, provider_id, scheduled_at, status,
     points_earned, credits_used, language, booked_by, booked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
    .run(id, b.lawyer_id, b.session_id || null, b.course_id, b.course_title || null,
         b.provider_id || null, b.scheduled_at, b.status || 'booked',
         b.points_earned || 0, b.credits_used || 0, b.language || 'English',
         b.booked_by || 'self');
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
}

// ─── Aggregate stats (for dashboards) ────────────────────────────────

function getAggregateStats() {
  const totalLawyers = db.prepare(`SELECT COUNT(*) AS n FROM lawyers WHERE status = 'active'`).get().n;
  const totalFirms = db.prepare(`SELECT COUNT(*) AS n FROM firms WHERE status = 'practising'`).get().n;
  const totalCourses = db.prepare(`SELECT COUNT(*) AS n FROM courses WHERE active = 1`).get().n;
  const totalProviders = db.prepare(`SELECT COUNT(*) AS n FROM providers WHERE accredited = 1`).get().n;

  // 2026 compliance — lawyers with 16+ points from completed bookings this year
  const year = new Date().getFullYear();
  const lawyer2026 = db.prepare(`
    SELECT l.id, COALESCE(SUM(CASE WHEN b.status = 'attended' THEN b.points_earned ELSE 0 END), 0) AS pts
    FROM lawyers l
    LEFT JOIN bookings b ON b.lawyer_id = l.id
      AND strftime('%Y', b.scheduled_at) = ?
    WHERE l.status = 'active'
    GROUP BY l.id
  `).all(String(year));

  let compliant = 0, atRisk = 0, critical = 0;
  for (const r of lawyer2026) {
    if (r.pts >= 16) compliant++;
    else if (r.pts > 0) atRisk++;
    else critical++;
  }
  const compliance = totalLawyers ? ((compliant + atRisk/2) / totalLawyers * 100) : 0;

  // Days to 31 Dec
  const today = new Date();
  const deadline = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
  const daysLeft = Math.max(0, Math.ceil((deadline - today) / (1000*60*60*24)));

  return {
    practitioners: totalLawyers,
    firms: totalFirms,
    providers: totalProviders,
    active_courses: totalCourses,
    compliant,
    at_risk: atRisk,
    critical,
    compliance_pct: Math.round(compliance * 10) / 10,
    days_to_deadline: daysLeft,
    year,
  };
}

module.exports = {
  // courses
  getCourses, getCourseById, upsertCourse, deleteCourse,
  getSessions, bulkUpsertSessions,
  // cms
  getContent, saveContent, getFAQ, saveFAQ,
  // lawyers
  getLawyerById, getLawyerByUaePassUuid, getLawyerByEmiratesId, getLawyerByEmail,
  getLawyersByFirm, linkLawyerToUaePass, awardCpdPoints,
  // firms
  getFirmById, getAllFirms,
  // bookings
  getLawyerBookings, getFirmBookings, createBooking,
  // stats
  getAggregateStats,
};
