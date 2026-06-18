'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const db = require('../db');
const store = require('../services/store');
const skills = require('../services/skills');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth');

const DEFAULT_CREDIT_COST = 5;
const txId = () => 'TX-' + crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8);

// GET /api/v1/bookings/availability — public seat counts per session, so the
// portal can render live "X seats left" / "SOLD OUT" like a cinema.
//   { seats: { "<sid>": n, ... }, soldOut: ["<sid>", ...] }
router.get('/availability', optionalAuth, (_req, res) => {
  const seats = {};
  const soldOut = [];
  try {
    for (const s of db.prepare('SELECT id, seats_remaining, capacity, status FROM course_sessions').all()) {
      const left = Math.max(0, Number(s.seats_remaining) || 0);
      seats[s.id] = left;
      if (left <= 0 || s.status === 'closed' || s.status === 'cancelled') soldOut.push(s.id);
    }
  } catch (_) {}
  res.json({ seats, soldOut });
});

// POST /api/v1/bookings — create a booking (lawyer self-books or firm CO books a member)
//
// Enforces, atomically:
//   • credit gate     — lawyer must hold enough credits (402 if short)
//   • seat inventory  — face-to-face sessions decrement seats_remaining,
//                       reject when sold out (409) — cinema-ticket model
//   • no double-book  — one active booking per (lawyer, session) (409)
// On success: deducts credits (ledger row), books the seat, returns the new
// balance + seats_remaining.
router.post('/', requireAuth, (req, res) => {
  const u = req.user;
  const lawyer_id = req.body.lawyer_id || (u.user_type === 'lawyer' ? u.sub : null);
  if (!lawyer_id) return res.status(400).json({ error: 'lawyer_id required' });

  // Authorisation
  if (u.user_type === 'lawyer' && u.sub !== lawyer_id) {
    return res.status(403).json({ error: 'Lawyers can only book themselves' });
  }
  if (u.role === 'firm_compliance_officer') {
    const fl = store.getLawyerById(lawyer_id);
    if (!fl || fl.firm_id !== u.firm_id) {
      return res.status(403).json({ error: 'CO can only book lawyers from their firm' });
    }
  }

  const lawyer = store.getLawyerById(lawyer_id);
  if (!lawyer) return res.status(404).json({ error: 'Lawyer not found' });

  const session_id = req.body.session_id || null;
  const course = req.body.course_id ? store.getCourseById(req.body.course_id) : null;
  const cost = Math.max(0, Math.round(Number(
    req.body.credits_used != null ? req.body.credits_used
      : (course && course.credits != null ? course.credits : DEFAULT_CREDIT_COST))));
  const balance = Number(lawyer.credit_balance) || 0;

  // ── Credit gate ──
  if (balance < cost) {
    return res.status(402).json({
      error: 'insufficient_credits', needed: cost, balance, shortfall: cost - balance,
      message: `This course costs ${cost} credits — you have ${balance}. Top up ${cost - balance} more to book.`,
    });
  }

  try {
    const result = db.transaction(() => {
      let seatsRemaining = null;
      if (session_id) {
        const dup = db.prepare(
          "SELECT id FROM bookings WHERE lawyer_id = ? AND session_id = ? AND status IN ('booked','attended')"
        ).get(lawyer_id, session_id);
        if (dup) { const e = new Error('already_booked'); e.code = 'already_booked'; throw e; }

        const s = db.prepare('SELECT seats_remaining, status FROM course_sessions WHERE id = ?').get(session_id);
        if (s) {
          if (s.status === 'cancelled') { const e = new Error('cancelled'); e.code = 'session_cancelled'; throw e; }
          if ((Number(s.seats_remaining) || 0) <= 0) { const e = new Error('sold_out'); e.code = 'sold_out'; throw e; }
          // Conditional decrement — guards against a concurrent oversell.
          const upd = db.prepare(
            "UPDATE course_sessions SET seats_remaining = seats_remaining - 1, " +
            "status = CASE WHEN seats_remaining - 1 <= 0 THEN 'closed' ELSE status END " +
            "WHERE id = ? AND seats_remaining > 0"
          ).run(session_id);
          if (upd.changes !== 1) { const e = new Error('sold_out'); e.code = 'sold_out'; throw e; }
          seatsRemaining = db.prepare('SELECT seats_remaining FROM course_sessions WHERE id = ?').get(session_id).seats_remaining;
        }
      }

      // ── Deduct credits + ledger ──
      if (cost > 0) {
        db.prepare('UPDATE lawyers SET credit_balance = credit_balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(cost, lawyer_id);
        try {
          db.prepare(
            `INSERT INTO credit_transactions (id, lawyer_id, type, amount, aed_amount, description, payment_method, status)
             VALUES (?,?,?,?,?,?,?, 'completed')`
          ).run(txId(), lawyer_id, 'use', -cost, 0,
            'Course booking: ' + (req.body.course_title || (course && course.title) || req.body.course_id || ''), 'credits');
        } catch (_) {}
      }

      const booking = store.createBooking({
        lawyer_id,
        course_id:    req.body.course_id,
        session_id,
        course_title: req.body.course_title || (course && course.title) || null,
        provider_id:  req.body.provider_id || null,
        scheduled_at: req.body.scheduled_at,
        language:     req.body.language || 'English',
        credits_used: cost,
        booked_by:    u.user_type === 'lawyer' ? 'self' : 'firm',
      });

      const newBal = db.prepare('SELECT credit_balance FROM lawyers WHERE id = ?').get(lawyer_id).credit_balance;
      return { booking, balance: Number(newBal) || 0, credits_used: cost, seats_remaining: seatsRemaining };
    })();
    res.status(201).json(result);
  } catch (e) {
    if (e.code === 'sold_out') return res.status(409).json({ error: 'sold_out', message: 'This session is sold out — please choose another date.' });
    if (e.code === 'already_booked') return res.status(409).json({ error: 'already_booked', message: 'You have already booked this session.' });
    if (e.code === 'session_cancelled') return res.status(409).json({ error: 'session_cancelled', message: 'This session has been cancelled.' });
    throw e;
  }
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
