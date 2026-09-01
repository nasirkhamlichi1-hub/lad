'use strict';

// ─────────────────────────────────────────────────────────────────────
// /api/v1/audit — the audit trail the Activity screen reads.
// ─────────────────────────────────────────────────────────────────────
// The screen shipped before the endpoint did: lad-admin's Activity view has
// been calling /api/v1/audit since the CRM launched, and until now the
// server had nothing there, so the page rendered its empty state for ever.
//
// It reads from activity_log — the write-once table every booking, credit,
// accreditation decision, account change and message already writes to
// (migration 034 blocks UPDATE/DELETE at the database, so what this returns
// is the permanent record, not a curated view of it). Nothing new is
// collected; this only exposes what the platform has been recording all
// along, in the exact shape the screen was already built to render.

const express = require('express');
const db = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const ROLES = ['lad_admin', 'lad_super_admin', 'super_admin', 'dg', 'lad_intelligence'];

// The screen's row shape, from activity_log's columns.
function toRow(r) {
  return {
    timestamp: r.created_at,
    actor_id: r.actor_name || r.actor_id || '—',
    actor_role: r.actor_type || '',
    action: r.kind,
    target_type: r.ref_type || '',
    target_id: r.ref_id || '',
    payload_after: r.summary || '',
  };
}

// GET /api/v1/audit?limit=&offset=&search=&action=
router.get('/', requireRole(...ROLES), (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const search = String(req.query.search || '').trim();
  const action = String(req.query.action || '').trim();

  const where = [];
  const params = [];
  if (action) { where.push('kind = ?'); params.push(action); }
  if (search) {
    where.push("(summary LIKE ? OR actor_name LIKE ? OR actor_id LIKE ? OR ref_id LIKE ? OR kind LIKE ? OR ifnull(tags,'') LIKE ?)");
    const like = '%' + search + '%';
    params.push(like, like, like, like, like, like);
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  try {
    const total = db.prepare(`SELECT COUNT(*) AS n FROM activity_log ${clause}`).get(...params).n;
    const rows = db.prepare(
      `SELECT * FROM activity_log ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    res.json({ data: rows.map(toRow), meta: { total, limit, offset } });
  } catch (e) {
    res.status(500).json({ error: 'audit_failed', message: e.message });
  }
});

// GET /api/v1/audit/_/summary — the KPI strip, top actions, daily chart.
router.get('/_/summary', requireRole(...ROLES), (_req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) AS n FROM activity_log').get().n;
    const by_action = db.prepare(
      'SELECT kind AS action, COUNT(*) AS c FROM activity_log GROUP BY kind ORDER BY c DESC'
    ).all();
    const by_role = db.prepare(
      "SELECT ifnull(actor_type,'unknown') AS role, COUNT(*) AS c FROM activity_log GROUP BY actor_type ORDER BY c DESC"
    ).all();
    const by_day = db.prepare(
      "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM activity_log \
       WHERE created_at >= datetime('now', '-30 days') GROUP BY day ORDER BY day"
    ).all();
    // Failed sign-ins land in activity_log only if the auth path logs them;
    // count what exists rather than pretending. Zero means none recorded.
    const failed = db.prepare(
      "SELECT COUNT(*) AS n FROM activity_log WHERE kind LIKE '%login%fail%' AND created_at >= datetime('now', '-7 days')"
    ).get().n;
    res.json({ data: { total, by_action, by_role, by_day, failed_logins_7d: failed } });
  } catch (e) {
    res.status(500).json({ error: 'audit_failed', message: e.message });
  }
});

module.exports = router;
