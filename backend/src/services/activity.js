'use strict';

// Shared activity logger — the single source of truth for "what happened on the
// platform". Every transaction and action (bookings, credits, refunds,
// accreditation decisions, account changes, notes, tasks, messages…) writes one
// row to activity_log. Each row is:
//   • attributed to a lawyer and/or firm  → surfaces on their record timeline
//   • classified (category) + tagged      → searchable by admins, readable by AI
//   • stamped with an AED value where money moved → credits reconcile to money
// Retention: rows are kept for at least 4 years. Nothing prunes activity younger
// than that (see purgeExpiredActivity). Best-effort; never throws into callers.
const crypto = require('crypto');
const db = require('../db');

// Map a kind → a coarse category the admin filters and the AI reasons over.
const CATEGORY_BY_KIND = {
  credit_purchase: 'credits', credit_refund: 'credits', credit_adjustment: 'credits', credit_assign: 'credits',
  booking: 'bookings', booking_cancel: 'bookings', booking_reschedule: 'bookings', attended: 'bookings',
  accreditation_decision: 'accreditation', accreditation_submit: 'accreditation', attendance_filed: 'accreditation',
  account_create: 'account', account_suspend: 'account', account_reactivate: 'account', password_reset: 'account',
  course_create: 'course', course_update: 'course', course_publish: 'course', session_create: 'course',
  message_in: 'message', reply_out: 'message', ai_reply: 'message', escalation: 'message',
  assignment: 'message', status_change: 'message', note: 'message', task: 'message',
};
function categoryFor(kind) { return CATEGORY_BY_KIND[kind] || 'system'; }

// Build a clean, de-duplicated tag string for search + AI from the kind,
// category, explicit tags, and any meta keys worth indexing.
function buildTags(a, category) {
  const t = new Set();
  if (a.kind) t.add(String(a.kind));
  if (category) t.add(category);
  const extra = a.tags;
  if (Array.isArray(extra)) extra.forEach((x) => x && t.add(String(x).toLowerCase()));
  else if (typeof extra === 'string') extra.split(/[\s,]+/).forEach((x) => x && t.add(x.toLowerCase()));
  if (a.meta && a.meta.method) t.add(String(a.meta.method).toLowerCase());
  if (a.meta && a.meta.refund_to) t.add('refund-' + String(a.meta.refund_to).toLowerCase());
  return Array.from(t).join(' ');
}

function logActivity(a) {
  const id = 'AC-' + crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 12);
  const category = a.category || categoryFor(a.kind);
  const tags = buildTags(a, category);
  const now = new Date().toISOString();
  const meta = a.meta ? JSON.stringify(a.meta) : null;
  const aed = a.aed != null && a.aed !== '' ? Number(a.aed) : null;
  try {
    db.prepare(
      `INSERT INTO activity_log (id, firm_id, lawyer_id, kind, category, tags, actor_type, actor_id, actor_name, summary, ref_type, ref_id, aed, meta, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, a.firm_id || null, a.lawyer_id || null, a.kind, category, tags,
      a.actor_type || null, a.actor_id || null, a.actor_name || null, a.summary || null,
      a.ref_type || null, a.ref_id || null, aed, meta, now);
  } catch (e) {
    // Pre-migration fallback: category/tags/aed columns may not exist yet.
    try {
      db.prepare(
        `INSERT INTO activity_log (id, firm_id, lawyer_id, kind, actor_type, actor_id, actor_name, summary, ref_type, ref_id, meta, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(id, a.firm_id || null, a.lawyer_id || null, a.kind, a.actor_type || null, a.actor_id || null,
        a.actor_name || null, a.summary || null, a.ref_type || null, a.ref_id || null, meta, now);
    } catch (_) { /* activity logging is never fatal */ }
  }
}

// Pull an actor descriptor straight off a req.user (admin/staff/lawyer JWT).
function actorFrom(user) {
  if (!user) return { actor_type: 'system' };
  const type = (user.user_type === 'lawyer' || user.role === 'lawyer') ? 'lawyer'
    : (user.role && /admin|dg|intelligence|staff|super/.test(user.role)) ? 'admin' : (user.role || 'user');
  return { actor_type: type, actor_id: user.sub || null, actor_name: user.name || null };
}

// Resolve a lawyer's firm_id so activity is attributed to both lawyer and firm.
function firmOfLawyer(lawyerId) {
  try { const r = db.prepare('SELECT firm_id FROM lawyers WHERE id = ?').get(lawyerId); return r && r.firm_id || null; } catch (_) { return null; }
}

// Retention: delete only entries OLDER than 4 years; never touches the 4-year
// window. Call from a scheduled job if/when desired.
function purgeExpiredActivity() {
  try {
    const cutoff = new Date(Date.now() - 4 * 365.25 * 24 * 3600 * 1000).toISOString();
    const r = db.prepare('DELETE FROM activity_log WHERE created_at < ?').run(cutoff);
    return r.changes || 0;
  } catch (_) { return 0; }
}

module.exports = { logActivity, firmOfLawyer, actorFrom, categoryFor, purgeExpiredActivity };
