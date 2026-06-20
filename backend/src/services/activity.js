'use strict';

// Shared CRM activity logger — writes a single row to activity_log so the
// per-firm / per-lawyer timeline captures bookings, reschedules, refunds, notes,
// tasks, messages, etc. Best-effort; never throws into the caller.
const crypto = require('crypto');
const db = require('../db');

function logActivity(a) {
  try {
    db.prepare(
      `INSERT INTO activity_log (id, firm_id, lawyer_id, kind, actor_type, actor_id, actor_name, summary, ref_type, ref_id, meta, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      'AC-' + crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 12),
      a.firm_id || null, a.lawyer_id || null, a.kind, a.actor_type || null, a.actor_id || null,
      a.actor_name || null, a.summary || null, a.ref_type || null, a.ref_id || null,
      a.meta ? JSON.stringify(a.meta) : null, new Date().toISOString()
    );
  } catch (_) { /* activity logging is never fatal */ }
}

// Resolve a lawyer's firm_id so activity is attributed to both lawyer and firm.
function firmOfLawyer(lawyerId) {
  try { const r = db.prepare('SELECT firm_id FROM lawyers WHERE id = ?').get(lawyerId); return r && r.firm_id || null; } catch (_) { return null; }
}

module.exports = { logActivity, firmOfLawyer };
