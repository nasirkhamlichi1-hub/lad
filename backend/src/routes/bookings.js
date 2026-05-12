'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const store = require('../services/store');
const skills = require('../services/skills');
const { requireAuth, requireRole } = require('../middleware/auth');

// POST /api/v1/bookings — create a booking (lawyer self-books or firm CO books a member)
router.post('/', requireAuth, (req, res) => {
  const u = req.user;
  const lawyer_id = req.body.lawyer_id || (u.user_type === 'lawyer' ? u.sub : null);
  if (!lawyer_id) return res.status(400).json({ error: 'lawyer_id required' });

  // Authorisation
  if (u.user_type === 'lawyer' && u.sub !== lawyer_id) {
    return res.status(403).json({ error: 'Lawyers can only book themselves' });
  }
  if (u.role === 'firm_compliance_officer') {
    const lawyer = store.getLawyerById(lawyer_id);
    if (!lawyer || lawyer.firm_id !== u.firm_id) {
      return res.status(403).json({ error: 'CO can only book lawyers from their firm' });
    }
  }

  const booking = store.createBooking({
    lawyer_id,
    course_id:    req.body.course_id,
    session_id:   req.body.session_id || null,
    course_title: req.body.course_title || null,
    provider_id:  req.body.provider_id || null,
    scheduled_at: req.body.scheduled_at,
    language:     req.body.language || 'English',
    credits_used: req.body.credits_used || 5,
    booked_by:    u.user_type === 'lawyer' ? 'self' : 'firm',
  });
  res.status(201).json(booking);
});

// PATCH /api/v1/bookings/:id — change status (cancel, mark attended, etc.)
router.patch('/:id', requireAuth, (req, res) => {
  const u = req.user;
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  const isOwner = u.user_type === 'lawyer' && u.sub === booking.lawyer_id;
  const isLAD = u.role === 'lad_admin' || u.role === 'provider_admin';
  const lawyer = store.getLawyerById(booking.lawyer_id);
  const isFirmCO = u.role === 'firm_compliance_officer' && lawyer && lawyer.firm_id === u.firm_id;
  if (!isOwner && !isLAD && !isFirmCO) return res.status(403).json({ error: 'Forbidden' });

  const allowed = ['booked','attended','cancelled','no-show','refunded'];
  if (req.body.status && !allowed.includes(req.body.status)) {
    return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });
  }

  const fields = [];
  const values = [];
  for (const k of ['status', 'points_earned', 'admin_notes']) {
    if (req.body[k] !== undefined) { fields.push(`${k} = ?`); values.push(req.body[k]); }
  }
  if (!fields.length) return res.status(400).json({ error: 'No updates supplied' });
  values.push(req.params.id);

  db.prepare(`UPDATE bookings SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);

  // ─── Skill graph propagation ────────────────────────────────────
  // When a booking flips to 'attended', the topic fingerprint of the
  // course is written onto the lawyer's skill graph.
  // When a previously-attended booking is reversed (refund / no-show
  // after the fact), the skill events are removed.
  let skillResult = null;
  if (req.body.status === 'attended' && booking.status !== 'attended') {
    skillResult = skills.recordAttendance(updated.id);
  } else if (booking.status === 'attended' &&
             req.body.status &&
             req.body.status !== 'attended') {
    skillResult = skills.unrecordAttendance(updated.id);
  } else if (req.body.points_earned !== undefined && updated.status === 'attended') {
    // Points changed on an already-attended booking — rewrite the events
    skills.unrecordAttendance(updated.id);
    skillResult = skills.recordAttendance(updated.id);
  }

  res.json({ ...updated, skill_propagation: skillResult });
});

module.exports = router;
