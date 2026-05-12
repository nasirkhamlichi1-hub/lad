'use strict';

const express = require('express');
const router = express.Router();
const store = require('../services/store');
const { requireAuth, requireRole } = require('../middleware/auth');

// GET /api/v1/lawyers/me — current lawyer's full profile
router.get('/me', requireAuth, (req, res) => {
  if (req.user.user_type !== 'lawyer') {
    return res.status(403).json({ error: 'Only lawyers can access this endpoint' });
  }
  const profile = store.getLawyerById(req.user.sub);
  if (!profile) return res.status(404).json({ error: 'Lawyer record not found' });
  const bookings = store.getLawyerBookings(req.user.sub);
  res.json({ profile, bookings });
});

// GET /api/v1/lawyers/:id — staff lookup (LAD admin or own firm CO)
router.get('/:id', requireAuth, (req, res) => {
  const lawyer = store.getLawyerById(req.params.id);
  if (!lawyer) return res.status(404).json({ error: 'Lawyer not found' });

  // Authorisation: LAD admin sees all; firm CO sees only their firm; lawyer sees self.
  const u = req.user;
  const allowed =
    (u.role === 'lad_admin' || u.role === 'lad_intelligence') ||
    (u.role === 'firm_compliance_officer' && u.firm_id === lawyer.firm_id) ||
    (u.user_type === 'lawyer' && u.sub === lawyer.id);
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

  const bookings = store.getLawyerBookings(lawyer.id);
  res.json({ profile: lawyer, bookings });
});

module.exports = router;
