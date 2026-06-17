'use strict';

// Lightweight notifications feed for the LAD review workspace — surfaces
// recent accreditation submissions and decisions so reviewers see activity.
// Returns both `rows` and `notifications` so either client shape works.

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit || '50', 10) || 50);
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT ref, type, status, submitted_by, submitted_at, reviewed_at
       FROM accreditations
       ORDER BY COALESCE(reviewed_at, submitted_at) DESC
       LIMIT ?`
    ).all(limit);
  } catch (_) { rows = []; }

  const out = rows.map((r) => ({
    id: r.ref,
    ref: r.ref,
    kind: r.status === 'pending' ? 'submission' : 'decision',
    status: r.status,
    title: r.status === 'pending'
      ? `New accreditation submission · ${r.ref}`
      : `Accreditation ${r.ref} · ${r.status}`,
    body: (r.submitted_by ? ('From ' + r.submitted_by) : '') + (r.type ? (' · ' + r.type) : ''),
    at: r.reviewed_at || r.submitted_at,
    read: false,
  }));

  res.json({ rows: out, notifications: out, count: out.length });
});

module.exports = router;
