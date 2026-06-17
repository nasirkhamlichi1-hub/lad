'use strict';

// CPD records for the signed-in user — the accredited courses they have
// completed (recorded by providers against a course code), plus the points
// total. Surfaces in the lawyer portal alongside the lifetime points.
//   GET /me   ->  { total, cycleTarget, records }

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const CYCLE_TARGET = 16;

router.get('/me', requireAuth, (req, res) => {
  const u = req.user;
  const email = (u.email || '').toLowerCase();
  const records = db.prepare(
    `SELECT * FROM cpd_records
     WHERE LOWER(attendee_email) = ? OR (lawyer_id IS NOT NULL AND lawyer_id = ?)
     ORDER BY created_at DESC`
  ).all(email, u.sub || '');
  const total = records.reduce((s, r) => s + (Number(r.points) || 0), 0);
  res.json({ total, cycleTarget: CYCLE_TARGET, records });
});

module.exports = router;
