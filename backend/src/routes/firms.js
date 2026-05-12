'use strict';

const express = require('express');
const router = express.Router();
const store = require('../services/store');
const { requireAuth, requireRole } = require('../middleware/auth');

// GET /api/v1/firms — list (LAD admin)
router.get('/', requireRole('lad_admin', 'lad_intelligence'), (_req, res) => {
  res.json(store.getAllFirms());
});

// GET /api/v1/firms/:id
router.get('/:id', requireAuth, (req, res) => {
  const firm = store.getFirmById(req.params.id);
  if (!firm) return res.status(404).json({ error: 'Firm not found' });

  const u = req.user;
  const allowed =
    (u.role === 'lad_admin' || u.role === 'lad_intelligence') ||
    (u.role === 'firm_compliance_officer' && u.firm_id === firm.id) ||
    (u.user_type === 'lawyer' && u.firm_id === firm.id);
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

  res.json(firm);
});

// GET /api/v1/firms/:id/lawyers
router.get('/:id/lawyers', requireAuth, (req, res) => {
  const u = req.user;
  const isLAD = u.role === 'lad_admin' || u.role === 'lad_intelligence';
  const isOwnCO = u.role === 'firm_compliance_officer' && u.firm_id === req.params.id;
  if (!isLAD && !isOwnCO) return res.status(403).json({ error: 'Forbidden' });

  res.json(store.getLawyersByFirm(req.params.id));
});

// GET /api/v1/firms/:id/bookings — recent bookings across the firm
router.get('/:id/bookings', requireAuth, (req, res) => {
  const u = req.user;
  const isLAD = u.role === 'lad_admin' || u.role === 'lad_intelligence';
  const isOwnCO = u.role === 'firm_compliance_officer' && u.firm_id === req.params.id;
  if (!isLAD && !isOwnCO) return res.status(403).json({ error: 'Forbidden' });

  res.json(store.getFirmBookings(req.params.id));
});

module.exports = router;
