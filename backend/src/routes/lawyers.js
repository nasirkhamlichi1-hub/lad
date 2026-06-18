'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const store = require('../services/store');
const aimodel = require('../services/aimodel');
const log = require('../logger');
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

// Flatten a lawyer DB record into the view-model the portals read
// (flat fields + bookings), with friendly names the UI expects.
function lawyerView(p, bookings) {
  const first = p.first_name || '';
  const last = p.last_name || '';
  const name = (first + ' ' + last).trim() || p.id;
  const status = (p.status || 'active').toLowerCase();
  return {
    id: p.id,
    firstName: first,
    lastName: last,
    fullName: name,
    name,
    email: p.email || '',
    phone: p.phone || '',
    points: Number(p.lifetime_points) || 0,
    lifetime_points: Number(p.lifetime_points) || 0,
    credits: Number(p.credit_balance) || 0,
    credit_balance: Number(p.credit_balance) || 0,
    practicing: status !== 'inactive' && status !== 'resigned' && status !== 'non-practising',
    status,
    role: p.role || '',
    job_title: p.role || '',
    firmId: p.firm_id || '',
    firmName: p.firm_name || '',
    firm_name: p.firm_name || '',
    specialisms: p.practice_areas || '',
    practice_areas: p.practice_areas || '',
    barNo: p.unified_id || '',
    complianceYear: new Date().getUTCFullYear(),
    bookings: bookings || [],
    attendance: attendanceView(bookings || []),
    profile: p, // raw record for any consumer that wants column names
  };
}

// Shape bookings/CPD records into the "attendance history" view-model the
// lawyer portal's History/Completed section reads.
function attendanceView(bookings) {
  return (bookings || [])
    .filter((b) => !['cancelled', 'refunded'].includes((b.status || '').toLowerCase()))
    .map((b) => ({
      course_title: b.course_title || b.course_title_current || 'CLPD activity',
      delta_points: Number(b.points_earned != null ? b.points_earned : (b.points_received != null ? b.points_received : b.course_points)) || 0,
      provider: b.provider || b.provider_name || b.venue || '',
      date_held: b.scheduled_at || b.booked_at || b.created_at || null,
      awarded_at: b.booked_at || b.created_at || null,
      accreditation_code: b.accreditation_code || b.course_code || '',
      session_ref: b.session_id || '',
      status: (b.status || 'booked').toLowerCase(),
    }));
}

// GET /api/v1/lawyers/me — current lawyer's full profile
router.get('/me', requireAuth, (req, res) => {
  if (req.user.user_type !== 'lawyer') {
    return res.status(403).json({ error: 'Only lawyers can access this endpoint' });
  }
  const profile = store.getLawyerById(req.user.sub);
  if (!profile) return res.status(404).json({ error: 'Lawyer record not found' });
  res.json(lawyerView(profile, fullAttendance(profile)));
});

// Approved accredited courses (for the copilot's recommendations).
function approvedCatalogue() {
  try {
    return db.prepare("SELECT * FROM accreditations WHERE status='approved' AND accreditation_code IS NOT NULL ORDER BY reviewed_at DESC LIMIT 80").all()
      .map((r) => { let p = {}; try { p = JSON.parse(r.payload || '{}'); } catch (_) {}
        return { code: r.accreditation_code, title: p.courseTitle || p.course || p.title || r.ref,
          points: r.final_points != null ? r.final_points : (p.pointsRequested || 0),
          areas: p.areas || '', provider: p.providerName || p.firm || r.submitted_by || '',
          format: p.format || '' }; });
  } catch (_) { return []; }
}

// GET /api/v1/lawyers/copilot — Maryam's proactive, personalised briefing +
// study plan from the lawyer's real record and the live accredited catalogue.
router.get('/copilot', requireAuth, async (req, res, next) => {
  const lawyer = req.user.user_type === 'lawyer' ? store.getLawyerById(req.user.sub)
    : (req.user.email ? store.getLawyerByEmail(req.user.email) : null);
  if (!lawyer) return res.status(404).json({ error: 'Lawyer record not found' });

  const points = Number(lawyer.lifetime_points) || 0;
  const needed = Math.max(0, 16 - points);
  const today = new Date();
  const deadline = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
  const daysLeft = Math.max(0, Math.ceil((deadline - today) / 86400000));
  const completed = fullAttendance(lawyer).map((b) => b.course_title).filter(Boolean);
  const firstName = lawyer.first_name || 'there';
  const courses = approvedCatalogue();

  const meta = { points, needed, daysLeft, firstName, year: today.getUTCFullYear() };

  if (needed === 0) {
    return res.json(Object.assign({ engine: 'rule', compliant: true,
      headline: `You're fully compliant — ${points}/16 points for ${meta.year}. Well done, ${firstName}.`,
      insights: ['You have met the 16-point CLPD requirement for this cycle.', 'Keep skills current — refresher CPD compounds your expertise.'],
      recommendations: [], plan: [] }, meta));
  }

  if (aimodel.configured()) {
    try {
      const courseList = courses.map((c) => `- ${c.title} [${c.code}] · ${c.points} pts · ${c.format || 'course'} · areas: ${c.areas || 'general'}`).join('\n') || '(no accredited courses available yet)';
      const system = 'You are Maryam, a proactive CLPD compliance copilot for a Dubai lawyer. From the lawyer\'s record and the accredited course catalogue, produce a short, warm, specific briefing and a concrete study plan to reach 16 CPD points by 31 December. Reply with ONLY a JSON object: {"headline": string, "insights": [string, string, string], "recommendations": [{"code": string, "title": string, "points": number, "why": string}], "plan": [{"when": string, "title": string, "code": string, "points": number, "action": string}]}. Recommendations and plan items must use courses STRICTLY from the catalogue (exact code+title), summing to at least the points needed. The plan should spread courses sensibly across the time remaining. Keep it concise.';
      const user = `Lawyer: ${firstName}\nCurrent points: ${points}/16 (needs ${needed} more)\nDays to 31 Dec: ${daysLeft}\nAlready completed: ${completed.slice(0, 12).join('; ') || 'none yet'}\n\nAccredited catalogue:\n${courseList}`;
      const text = await aimodel.chat({ system, messages: [{ role: 'user', content: user }], maxTokens: 1000, temperature: 0.35 });
      let parsed = null; try { const m = text.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : text); } catch (_) {}
      if (parsed && (parsed.headline || parsed.recommendations)) return res.json(Object.assign({ engine: 'aimodel' }, meta, parsed));
    } catch (e) { log.error('copilot_aimodel', { error: e.message }); }
  }

  // Heuristic fallback: pick highest-point courses until the gap is covered.
  const picks = []; let acc = 0;
  for (const c of courses.slice().sort((a, b) => (b.points || 0) - (a.points || 0))) {
    if (acc >= needed) break;
    picks.push(c); acc += Number(c.points) || 0;
  }
  const weeks = Math.max(1, Math.ceil(daysLeft / 7));
  const plan = picks.map((c, i) => ({
    when: `Week ${Math.min(weeks, i + 1)}`,
    title: c.title, code: c.code, points: c.points,
    action: /e-?learning|online/i.test(c.format) ? 'Start this e-learning module' : 'Book the next session',
  }));
  res.json(Object.assign({ engine: 'heuristic',
    headline: `You're at ${points}/16, ${firstName} — ${needed} points to go with ${daysLeft} days left.`,
    insights: [
      `${needed} CPD point${needed === 1 ? '' : 's'} still needed before 31 December.`,
      picks.length ? `These ${picks.length} accredited course${picks.length === 1 ? '' : 's'} cover it: ${acc} points available.` : 'No accredited courses are in the catalogue yet — check back soon.',
      daysLeft < 60 ? 'Time is tight — prioritise the highest-point courses first.' : 'You have runway — spread courses evenly to avoid a year-end crunch.',
    ],
    recommendations: picks.map((c) => ({ code: c.code, title: c.title, points: c.points, why: 'High-value accredited course toward your target.' })),
    plan,
  }, meta));
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

  res.json(lawyerView(lawyer, fullAttendance(lawyer)));
});

module.exports = router;
