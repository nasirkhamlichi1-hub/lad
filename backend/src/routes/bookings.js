'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const db = require('../db');
const store = require('../services/store');
const skills = require('../services/skills');
const activity = require('../services/activity');
const email = require('../services/email');
const tpl = require('../services/email-templates');
const { requireAuth, requireRole, optionalAuth, isSuper } = require('../middleware/auth');

const DEFAULT_CREDIT_COST = 5;
const txId = () => 'TX-' + crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
const ADMIN_BK_ROLES = ['lad_admin', 'lad_intelligence', 'lad_super_admin', 'super_admin', 'dg'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtSession(iso) {
  if (!iso) return '—';
  const d = new Date(iso); if (isNaN(d)) return String(iso).slice(0, 16);
  const hh = String(d.getUTCHours()).padStart(2, '0'); const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${hh}:${mm}`;
}

// GET /api/v1/bookings — every booking across the platform (admin/oversight).
router.get('/', requireAuth, (req, res) => {
  if (!ADMIN_BK_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit || '300', 10) || 300));
  const where = ['1=1']; const args = [];
  const status = (req.query.status || '').toString().trim();
  if (status) { where.push('b.status = ?'); args.push(status); }
  const q = (req.query.q || '').toString().trim();
  if (q) {
    const like = '%' + q + '%';
    where.push('(l.first_name LIKE ? OR l.last_name LIKE ? OR f.name LIKE ? OR b.course_title LIKE ? OR c.title LIKE ? OR b.id LIKE ?)');
    args.push(like, like, like, like, like, like);
  }
  const whereSql = where.join(' AND ');
  let rows = [], summary = { total: 0, confirmed: 0, attended: 0, no_show: 0, cancelled: 0 };
  try {
    rows = db.prepare(
      `SELECT b.id, b.status, b.credits_used, b.points_earned, b.scheduled_at, b.booked_at, b.lawyer_id,
              b.course_title, c.title AS course_cur, l.first_name, l.last_name, l.firm_id, f.name AS firm_name
       FROM bookings b
       LEFT JOIN lawyers l ON l.id = b.lawyer_id
       LEFT JOIN firms f ON f.id = l.firm_id
       LEFT JOIN courses c ON c.id = b.course_id
       WHERE ${whereSql}
       ORDER BY COALESCE(b.booked_at, b.scheduled_at) DESC LIMIT ?`
    ).all(...args, limit);
    const s = db.prepare(
      `SELECT COUNT(*) total,
              COALESCE(SUM(CASE WHEN b.status = 'booked' THEN 1 ELSE 0 END),0) confirmed,
              COALESCE(SUM(CASE WHEN b.status = 'attended' THEN 1 ELSE 0 END),0) attended,
              COALESCE(SUM(CASE WHEN b.status = 'no_show' THEN 1 ELSE 0 END),0) no_show,
              COALESCE(SUM(CASE WHEN b.status IN ('cancelled','refunded') THEN 1 ELSE 0 END),0) cancelled
       FROM bookings b LEFT JOIN lawyers l ON l.id = b.lawyer_id LEFT JOIN firms f ON f.id = l.firm_id LEFT JOIN courses c ON c.id = b.course_id
       WHERE ${whereSql}`
    ).get(...args);
    if (s) summary = s;
  } catch (_) {}
  const data = rows.map((b) => ({
    id: b.id,
    lawyer_id: b.lawyer_id || null,
    firm_id: b.firm_id || null,
    lawyer: `${b.first_name || ''} ${b.last_name || ''}`.trim() || '—',
    firm: b.firm_name || '—',
    course: b.course_title || b.course_cur || '—',
    session: fmtSession(b.scheduled_at),
    scheduled_at: b.scheduled_at,
    credits: Number(b.credits_used) || 0,
    pts: Number(b.points_earned) || 0,
    status: b.status || 'booked',
  }));
  res.json({ data, summary, meta: { total: data.length } });
});

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

// GET /api/v1/bookings/session/:id — who is booked onto a session (admin).
// Returns the session header + the list of booked lawyers, for the admin
// "manage a session" view.
router.get('/session/:id', requireAuth, (req, res) => {
  if (!ADMIN_BK_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const sid = req.params.id;
  let s = null;
  try {
    s = db.prepare(
      `SELECT s.id, s.course_id, s.scheduled_at, s.capacity, s.seats_remaining, s.status, s.venue, c.title AS course_title
       FROM course_sessions s LEFT JOIN courses c ON c.id = s.course_id WHERE s.id = ?`
    ).get(sid);
  } catch (_) {}
  if (!s) return res.status(404).json({ error: 'Session not found' });
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT b.id, b.status, b.credits_used, b.booked_at, b.points_earned, b.lawyer_id,
              l.first_name, l.last_name, l.email, l.lifetime_points, f.name AS firm_name
       FROM bookings b LEFT JOIN lawyers l ON l.id = b.lawyer_id LEFT JOIN firms f ON f.id = l.firm_id
       WHERE b.session_id = ? AND b.status NOT IN ('cancelled','refunded')
       ORDER BY b.booked_at DESC`
    ).all(sid);
  } catch (_) {}
  res.json({
    session: { id: s.id, course_id: s.course_id, course_title: s.course_title || s.course_id, scheduled_at: s.scheduled_at, capacity: s.capacity, seats_remaining: s.seats_remaining, status: s.status, venue: s.venue },
    bookings: rows.map((b) => ({
      id: b.id, lawyer_id: b.lawyer_id, name: `${b.first_name || ''} ${b.last_name || ''}`.trim() || b.lawyer_id,
      email: b.email || '', firm: b.firm_name || '', status: b.status || 'booked',
      credits_used: Number(b.credits_used) || 0, points: Number(b.lifetime_points) || 0,
    })),
  });
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
  // Block booking a private accredited course that isn't the lawyer's own firm.
  if (course && Number(course.private) && !store.canAccessCourse(course, req.user)) {
    return res.status(403).json({ error: 'course_private', message: 'This course is restricted to its firm.' });
  }
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

    // Confirmation email (best-effort, queued — never blocks the response).
    if (lawyer.email) {
      const courseTitle = req.body.course_title || (course && course.title) || 'your CLPD course';
      email.send('booking', tpl.bookingConfirmation({
        name: tpl.fullName(lawyer.first_name, lawyer.last_name),
        courseTitle,
        sessionWhen: fmtSession(req.body.scheduled_at),
        venue: req.body.venue || (course && course.venue) || null,
        language: req.body.language || 'English',
        credits: cost,
        balance: result.balance,
      }), { to: lawyer.email, toName: tpl.fullName(lawyer.first_name, lawyer.last_name), ref: result.booking && result.booking.id, dedupeKey: 'booking:' + (result.booking && result.booking.id) });
    }

    res.status(201).json(result);
  } catch (e) {
    if (e.code === 'sold_out') return res.status(409).json({ error: 'sold_out', message: 'This session is sold out — please choose another date.' });
    if (e.code === 'already_booked') return res.status(409).json({ error: 'already_booked', message: 'You have already booked this session.' });
    if (e.code === 'session_cancelled') return res.status(409).json({ error: 'session_cancelled', message: 'This session has been cancelled.' });
    throw e;
  }
});

// POST /api/v1/bookings/bulk — book MANY lawyers onto one course/session at once
// (admin or firm CO). Each lawyer is processed independently: one failing
// (insufficient credits, already booked, sold out) skips just that lawyer and
// the rest still go through. Returns a per-lawyer result summary.
router.post('/bulk', requireAuth, (req, res) => {
  const u = req.user;
  const isLADBulk = isSuper(u.role) || u.role === 'lad_admin' || u.role === 'provider_admin';
  const isCO = u.role === 'firm_compliance_officer';
  if (!isLADBulk && !isCO) return res.status(403).json({ error: 'Admins or firm officers only' });

  const ids = Array.isArray(req.body.lawyer_ids) ? req.body.lawyer_ids.map(String).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'lawyer_ids is required' });
  if (ids.length > 200) return res.status(400).json({ error: 'Too many lawyers in one batch (max 200).' });

  const session_id = req.body.session_id || null;
  const course = req.body.course_id ? store.getCourseById(req.body.course_id) : null;
  if (course && Number(course.private) && isCO) {
    // A firm CO may only bulk-book their own firm's private course.
    if (!store.canAccessCourse(course, u)) return res.status(403).json({ error: 'course_private' });
  }
  const baseCost = Math.max(0, Math.round(Number(
    req.body.credits_used != null ? req.body.credits_used
      : (course && course.credits != null ? course.credits : DEFAULT_CREDIT_COST))));

  const results = [];
  let booked = 0;
  const bookOne = (lawyer_id) => {
    const lawyer = store.getLawyerById(lawyer_id);
    if (!lawyer) return { lawyer_id, ok: false, reason: 'not_found' };
    if (isCO && lawyer.firm_id !== u.firm_id) return { lawyer_id, ok: false, reason: 'other_firm' };
    const balance = Number(lawyer.credit_balance) || 0;
    if (balance < baseCost) return { lawyer_id, ok: false, reason: 'insufficient_credits', name: `${lawyer.first_name || ''} ${lawyer.last_name || ''}`.trim() };
    try {
      return db.transaction(() => {
        if (session_id) {
          const dup = db.prepare("SELECT id FROM bookings WHERE lawyer_id = ? AND session_id = ? AND status IN ('booked','attended')").get(lawyer_id, session_id);
          if (dup) { const e = new Error('already_booked'); e.code = 'already_booked'; throw e; }
          const s = db.prepare('SELECT seats_remaining, status FROM course_sessions WHERE id = ?').get(session_id);
          if (s) {
            if (s.status === 'cancelled') { const e = new Error('cancelled'); e.code = 'session_cancelled'; throw e; }
            const upd = db.prepare("UPDATE course_sessions SET seats_remaining = seats_remaining - 1, status = CASE WHEN seats_remaining - 1 <= 0 THEN 'closed' ELSE status END WHERE id = ? AND seats_remaining > 0").run(session_id);
            if (upd.changes !== 1) { const e = new Error('sold_out'); e.code = 'sold_out'; throw e; }
          }
        }
        if (baseCost > 0) {
          db.prepare('UPDATE lawyers SET credit_balance = credit_balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(baseCost, lawyer_id);
          try {
            db.prepare(`INSERT INTO credit_transactions (id, lawyer_id, type, amount, aed_amount, description, payment_method, status) VALUES (?,?,?,?,?,?,?, 'completed')`)
              .run(txId(), lawyer_id, 'use', -baseCost, 0, 'Course booking (bulk): ' + (req.body.course_title || (course && course.title) || ''), 'credits');
          } catch (_) {}
        }
        const bk = store.createBooking({
          lawyer_id, course_id: req.body.course_id, session_id,
          course_title: req.body.course_title || (course && course.title) || null,
          provider_id: req.body.provider_id || null, scheduled_at: req.body.scheduled_at,
          language: req.body.language || 'English', credits_used: baseCost, booked_by: 'admin',
        });
        // Confirmation email (best-effort).
        if (lawyer.email) {
          try {
            email.send('booking', tpl.bookingConfirmation({
              name: tpl.fullName(lawyer.first_name, lawyer.last_name),
              courseTitle: req.body.course_title || (course && course.title) || 'your CLPD course',
              sessionWhen: fmtSession(req.body.scheduled_at), venue: req.body.venue || null,
              language: req.body.language || 'English', credits: baseCost,
              balance: (db.prepare('SELECT credit_balance FROM lawyers WHERE id = ?').get(lawyer_id) || {}).credit_balance,
            }), { to: lawyer.email, toName: tpl.fullName(lawyer.first_name, lawyer.last_name), ref: bk && bk.id, dedupeKey: 'booking:' + (bk && bk.id) });
          } catch (_) {}
        }
        return { lawyer_id, ok: true, booking_id: bk && bk.id };
      })();
    } catch (e) { return { lawyer_id, ok: false, reason: e.code || 'error' }; }
  };

  for (const id of ids) { const r = bookOne(id); if (r.ok) booked++; results.push(r); }
  const skipped = results.filter((r) => !r.ok);
  res.status(201).json({ ok: true, requested: ids.length, booked, skipped_count: skipped.length, results });
});

// PATCH /api/v1/bookings/:id — change status (cancel, mark attended, etc.)
router.patch('/:id', requireAuth, (req, res) => {
  const u = req.user;
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  const isOwner = u.user_type === 'lawyer' && u.sub === booking.lawyer_id;
  const isLAD = isSuper(u.role) || u.role === 'lad_admin' || u.role === 'provider_admin';
  const lawyer = store.getLawyerById(booking.lawyer_id);
  const isFirmCO = u.role === 'firm_compliance_officer' && lawyer && lawyer.firm_id === u.firm_id;
  if (!isOwner && !isLAD && !isFirmCO) return res.status(403).json({ error: 'Forbidden' });

  const allowed = ['booked','attended','cancelled','no-show','refunded'];
  if (req.body.status && !allowed.includes(req.body.status)) {
    return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });
  }

  // Only LAD / firm officers may award CPD points or edit notes. A booking's
  // owner (the lawyer) can change status (e.g. cancel) but must NOT be able to
  // self-award compliance points. points_earned is validated and bounded.
  const canAwardPoints = isLAD || isFirmCO;
  const fields = [];
  const values = [];
  if (req.body.status !== undefined) { fields.push('status = ?'); values.push(req.body.status); }
  if (canAwardPoints && req.body.points_earned !== undefined) {
    const p = Math.round(Number(req.body.points_earned));
    if (!Number.isFinite(p) || p < 0 || p > 50) return res.status(400).json({ error: 'points_earned must be 0–50' });
    fields.push('points_earned = ?'); values.push(p);
  }
  if (canAwardPoints && req.body.admin_notes !== undefined) {
    fields.push('admin_notes = ?'); values.push(String(req.body.admin_notes).slice(0, 2000));
  }
  if (!fields.length) return res.status(400).json({ error: 'No updates supplied' });
  values.push(req.params.id);

  db.prepare(`UPDATE bookings SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);

  // Cancelling/refunding an active booking → refund the credits once and free
  // the seat. Idempotent: only fires on the transition out of an active state.
  const wasActive = !['cancelled', 'refunded'].includes((booking.status || '').toLowerCase());
  const nowCancelled = ['cancelled', 'refunded'].includes((req.body.status || '').toLowerCase());
  let refundedCredits = 0, refundDest = null;
  if (nowCancelled && wasActive) {
    try {
      const cost = Number(booking.credits_used) || 0;
      refundedCredits = cost > 0 && booking.lawyer_id ? cost : 0;
      if (cost > 0 && booking.lawyer_id) {
        const PRICE = Number(process.env.CREDIT_PRICE_AED || 120);
        const firmId = lawyer && lawyer.firm_id;
        // Where do the credits go back to? Firm-funded bookings return to the
        // firm POOL; self-funded ones to the lawyer's balance. An admin or firm
        // officer may force it either way with refund_to.
        let dest = ((req.body.refund_to === 'firm' || req.body.refund_to === 'lawyer') && (isLAD || isFirmCO)) ? req.body.refund_to : null;
        if (!dest) dest = (firmId && booking.booked_by !== 'self') ? 'firm' : 'lawyer';
        if (dest === 'firm' && firmId) {
          // Return the credits the firm had committed back into its pool. The
          // lawyer's balance stays as-is (those credits were the firm's).
          db.prepare('UPDATE firms SET credit_pool = COALESCE(credit_pool,0) + ? WHERE id = ?').run(cost, firmId);
          try {
            const name = `${(lawyer.first_name || '')} ${(lawyer.last_name || '')}`.trim();
            db.prepare(
              `INSERT INTO firm_credit_transactions (id, firm_id, type, amount, aed_amount, description, lawyer_id)
               VALUES (?,?,?,?,?,?,?)`
            ).run('FTX-' + crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8), firmId, 'refund', cost, cost * PRICE,
              `Booking cancelled — ${cost} credits returned to firm pool${name ? ` (${name})` : ''}`, booking.lawyer_id);
          } catch (_) {}
          refundDest = 'firm';
        } else {
          db.prepare('UPDATE lawyers SET credit_balance = COALESCE(credit_balance,0) + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(cost, booking.lawyer_id);
          try {
            db.prepare(
              `INSERT INTO credit_transactions (id, lawyer_id, type, amount, aed_amount, description, payment_method, status)
               VALUES (?,?,?,?,?,?,?, 'completed')`
            ).run(txId(), booking.lawyer_id, 'refund', cost, cost * PRICE,
              'Booking cancelled — credits refunded', 'admin');
          } catch (_) {}
          refundDest = 'lawyer';
        }
      }
      if (booking.session_id) {
        // Refund the seat but never let seats_remaining exceed the session
        // capacity (guards against double-cancel races inflating availability).
        db.prepare("UPDATE course_sessions SET seats_remaining = MIN(COALESCE(seats_remaining,0) + 1, COALESCE(capacity, seats_remaining + 1)), status = CASE WHEN status = 'closed' THEN 'scheduled' ELSE status END WHERE id = ?").run(booking.session_id);
      }
    } catch (_) {}
    // Cancellation/refund confirmation email (best-effort, queued).
    if (lawyer && lawyer.email) {
      let bal = null;
      try { bal = db.prepare('SELECT credit_balance FROM lawyers WHERE id = ?').get(booking.lawyer_id).credit_balance; } catch (_) {}
      email.send('cancellation', tpl.bookingCancellation({
        name: tpl.fullName(lawyer.first_name, lawyer.last_name),
        courseTitle: booking.course_title || 'your CLPD course',
        refundCredits: refundedCredits,
        balance: bal != null ? Number(bal) : null,
      }), { to: lawyer.email, toName: tpl.fullName(lawyer.first_name, lawyer.last_name), ref: booking.id, dedupeKey: 'cancellation:' + booking.id });
    }
  }

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

  // CRM timeline
  if (req.body.status && req.body.status !== booking.status) {
    const title = booking.course_title || booking.course_id || 'a course';
    const sum = req.body.status === 'attended' ? `Marked attended: ${title}`
      : (nowCancelled ? `Booking cancelled: ${title}${refundedCredits ? ` · ${refundedCredits} cr refunded to ${refundDest === 'firm' ? 'firm pool' : 'lawyer'}` : ''}`
      : `Booking ${req.body.status}: ${title}`);
    activity.logActivity({ lawyer_id: booking.lawyer_id, firm_id: activity.firmOfLawyer(booking.lawyer_id), kind: req.body.status === 'attended' ? 'attended' : 'booking',
      actor_type: 'admin', actor_id: u.sub, actor_name: u.name, ref_type: 'booking', ref_id: booking.id, summary: sum });
  }

  res.json({ ...updated, skill_propagation: skillResult, refunded_credits: refundedCredits, refund_to: refundDest });
});

// POST /api/v1/bookings/:id/reschedule { session_id } — move a booking to another
// session: free the old seat, take the new one, keep credits/points unchanged.
router.post('/:id/reschedule', requireAuth, (req, res) => {
  const u = req.user;
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  const isLAD = isSuper(u.role) || u.role === 'lad_admin' || u.role === 'provider_admin';
  const lawyer = store.getLawyerById(booking.lawyer_id);
  const isFirmCO = u.role === 'firm_compliance_officer' && lawyer && lawyer.firm_id === u.firm_id;
  if (!isLAD && !isFirmCO) return res.status(403).json({ error: 'Forbidden' });
  const newSid = (req.body && req.body.session_id || '').toString();
  if (!newSid) return res.status(400).json({ error: 'session_id is required' });
  if (newSid === booking.session_id) return res.status(400).json({ error: 'Already on that session' });
  const ns = db.prepare('SELECT * FROM course_sessions WHERE id = ?').get(newSid);
  if (!ns) return res.status(404).json({ error: 'Target session not found' });
  if ((ns.status || '') === 'cancelled') return res.status(409).json({ error: 'session_cancelled', message: 'That session has been cancelled.' });
  try {
    const tx = db.transaction(() => {
      // duplicate guard: already booked on the target session
      const dup = db.prepare("SELECT id FROM bookings WHERE lawyer_id = ? AND session_id = ? AND status IN ('booked','attended') AND id != ?").get(booking.lawyer_id, newSid, booking.id);
      if (dup) { const e = new Error('already_booked'); e.code = 'already_booked'; throw e; }
      if ((ns.seats_remaining != null)) {
        const upd = db.prepare("UPDATE course_sessions SET seats_remaining = seats_remaining - 1, status = CASE WHEN seats_remaining - 1 <= 0 THEN 'closed' ELSE status END WHERE id = ? AND seats_remaining > 0").run(newSid);
        if (upd.changes !== 1) { const e = new Error('sold_out'); e.code = 'sold_out'; throw e; }
      }
      if (booking.session_id) {
        db.prepare("UPDATE course_sessions SET seats_remaining = MIN(COALESCE(seats_remaining,0) + 1, COALESCE(capacity, seats_remaining + 1)), status = CASE WHEN status = 'closed' THEN 'scheduled' ELSE status END WHERE id = ?").run(booking.session_id);
      }
      db.prepare("UPDATE bookings SET session_id = ?, scheduled_at = ?, course_id = COALESCE(?, course_id), status = CASE WHEN status IN ('cancelled','refunded') THEN 'booked' ELSE status END WHERE id = ?")
        .run(newSid, ns.scheduled_at, ns.course_id || null, req.params.id);
    });
    tx();
  } catch (e) {
    if (e.code === 'sold_out') return res.status(409).json({ error: 'sold_out', message: 'That session is full.' });
    if (e.code === 'already_booked') return res.status(409).json({ error: 'already_booked', message: 'This lawyer is already booked on that session.' });
    throw e;
  }
  const updated = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  activity.logActivity({ lawyer_id: booking.lawyer_id, firm_id: activity.firmOfLawyer(booking.lawyer_id), kind: 'booking', actor_type: 'admin', actor_id: u.sub, actor_name: u.name, ref_type: 'booking', ref_id: booking.id, summary: `Rescheduled "${booking.course_title || booking.course_id || 'a course'}" to ${fmtSession(ns.scheduled_at)}` });
  res.json({ ok: true, booking: updated, scheduled_at: ns.scheduled_at });
});

module.exports = router;
