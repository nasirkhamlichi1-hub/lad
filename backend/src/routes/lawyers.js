'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const store = require('../services/store');
const { requireAuth, requireRole } = require('../middleware/auth');

// Accredited-course attendance (recorded by providers/firms against a course
// code) shaped like a booking, so it shows in the lawyer's completed list and
// firm/admin views alongside normal bookings.
function cpdAttendance(lawyer) {
  if (!lawyer) return [];
  try {
    const rows = db.prepare(
      `SELECT * FROM cpd_records WHERE lawyer_id = ? OR LOWER(attendee_email) = LOWER(?) ORDER BY created_at DESC`
    ).all(lawyer.id, lawyer.email || '');
    return rows.map((r) => ({
      id: r.id,
      course_title: r.course_title || 'Accredited course',
      course_points: r.points,
      points_received: r.points,
      points_earned: r.points,
      credits_used: 0,
      status: 'completed',
      booked_at: r.created_at,
      venue: r.provider || '',
      provider: r.provider || '',
      course_code: r.course_code,
      source: 'accreditation',
    }));
  } catch (_) { return []; }
}

// Full attendance = real bookings + accredited CPD records.
function fullAttendance(lawyer) {
  const bookings = store.getLawyerBookings(lawyer.id) || [];
  return bookings.concat(cpdAttendance(lawyer));
}

// GET /api/v1/lawyers/me — current lawyer's full profile
router.get('/me', requireAuth, (req, res) => {
  if (req.user.user_type !== 'lawyer') {
    return res.status(403).json({ error: 'Only lawyers can access this endpoint' });
  }
  const profile = store.getLawyerById(req.user.sub);
  if (!profile) return res.status(404).json({ error: 'Lawyer record not found' });
  const bookings = fullAttendance(profile);
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

  const bookings = fullAttendance(lawyer);
  res.json({ profile: lawyer, bookings });
});

module.exports = router;
