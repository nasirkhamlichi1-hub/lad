'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const store = require('../services/store');
const { requireAuth } = require('../middleware/auth');

// GET /api/v1/stats/aggregate — public (used by the hero & landing pages)
router.get('/aggregate', (_req, res) => res.json(store.getAggregateStats()));

// GET /api/v1/stats/firms — top firms by compliance (for admin dashboard)
router.get('/firms', requireAuth, (req, res) => {
  if (!['lad_admin','lad_intelligence'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const year = String(req.query.year || new Date().getFullYear());

  const rows = db.prepare(`
    SELECT f.id, f.name, f.abbreviation,
      (SELECT COUNT(*) FROM lawyers WHERE firm_id = f.id AND status='active') AS lawyers,
      (SELECT COALESCE(SUM(CASE WHEN b.status='attended' THEN b.points_earned ELSE 0 END), 0)
         FROM bookings b
         JOIN lawyers l ON l.id = b.lawyer_id
         WHERE l.firm_id = f.id AND strftime('%Y', b.scheduled_at) = ?
      ) AS total_pts_year
    FROM firms f
    WHERE f.status = 'practising'
    HAVING lawyers >= 5
    ORDER BY (CAST(total_pts_year AS FLOAT) / NULLIF(lawyers,0)) DESC
    LIMIT 20
  `).all(year);

  // Per-firm compliance breakdown
  const out = rows.map(f => {
    const buckets = db.prepare(`
      SELECT
        SUM(CASE WHEN pts >= 16 THEN 1 ELSE 0 END) AS compliant,
        SUM(CASE WHEN pts > 0 AND pts < 16 THEN 1 ELSE 0 END) AS at_risk,
        SUM(CASE WHEN pts = 0 THEN 1 ELSE 0 END) AS critical
      FROM (
        SELECT l.id,
          COALESCE(SUM(CASE WHEN b.status='attended' THEN b.points_earned ELSE 0 END), 0) AS pts
        FROM lawyers l
        LEFT JOIN bookings b ON b.lawyer_id = l.id AND strftime('%Y', b.scheduled_at) = ?
        WHERE l.firm_id = ? AND l.status = 'active'
        GROUP BY l.id
      )`).get(year, f.id);

    return {
      ...f,
      ...buckets,
      avg_pts: f.lawyers ? Math.round((f.total_pts_year / f.lawyers) * 10) / 10 : 0,
      compliance_pct: f.lawyers ?
        Math.round((((buckets.compliant || 0) + (buckets.at_risk || 0)/2) / f.lawyers) * 1000) / 10 : 0,
    };
  });

  res.json(out);
});

// GET /api/v1/stats/firm/:id — compliance for one firm
router.get('/firm/:id', requireAuth, (req, res) => {
  const u = req.user;
  const isLAD = ['lad_admin','lad_intelligence'].includes(u.role);
  const isOwnCO = u.role === 'firm_compliance_officer' && u.firm_id === req.params.id;
  if (!isLAD && !isOwnCO) return res.status(403).json({ error: 'Forbidden' });

  const year = String(req.query.year || new Date().getFullYear());
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS lawyers,
      SUM(CASE WHEN pts >= 16 THEN 1 ELSE 0 END) AS compliant,
      SUM(CASE WHEN pts > 0 AND pts < 16 THEN 1 ELSE 0 END) AS at_risk,
      SUM(CASE WHEN pts = 0 THEN 1 ELSE 0 END) AS critical,
      AVG(pts) AS avg_pts
    FROM (
      SELECT l.id,
        COALESCE(SUM(CASE WHEN b.status='attended' THEN b.points_earned ELSE 0 END), 0) AS pts
      FROM lawyers l
      LEFT JOIN bookings b ON b.lawyer_id = l.id AND strftime('%Y', b.scheduled_at) = ?
      WHERE l.firm_id = ? AND l.status = 'active'
      GROUP BY l.id
    )`).get(year, req.params.id);

  res.json({ ...stats, avg_pts: Math.round((stats.avg_pts || 0) * 10) / 10, year });
});

module.exports = router;
