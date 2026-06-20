'use strict';

const express = require('express');
const router = express.Router();
const store = require('../services/store');
const db = require('../db');
const aimodel = require('../services/aimodel');
const log = require('../logger');
const { requireAuth, requireRole } = require('../middleware/auth');

const LAD_ROLES = ['lad_admin', 'lad_intelligence', 'lad_super_admin', 'super_admin', 'dg'];
const isLADrole = (u) => !!u && LAD_ROLES.includes(u.role);

// A firm compliance officer always sees their OWN firm — the portal may pass a
// placeholder id (e.g. 'F-GA'), so resolve to the signed-in CO's firm. LAD
// roles use the requested id.
function effectiveFirmId(u, paramId) {
  if (u.role === 'firm_compliance_officer' && u.firm_id) return u.firm_id;
  if (u.user_type === 'lawyer' && u.firm_id) return u.firm_id;
  return paramId;
}

// Flatten a lawyer DB row into the shape the firm portal reads
// (points/credits aliases + practicing).
function lawyerRow(l) {
  const status = (l.status || 'active').toLowerCase();
  return {
    id: l.id,
    first_name: l.first_name,
    last_name: l.last_name,
    name: `${l.first_name || ''} ${l.last_name || ''}`.trim(),
    email: l.email || '',
    role: l.role || '',
    practice_areas: l.practice_areas || '',
    points: Number(l.lifetime_points) || 0,
    lifetime_points: Number(l.lifetime_points) || 0,
    credits: Number(l.credit_balance) || 0,
    credit_balance: Number(l.credit_balance) || 0,
    practicing: status !== 'inactive' && status !== 'resigned' && status !== 'non-practising',
    status,
  };
}

// GET /api/v1/firms — list (LAD roles)
router.get('/', requireAuth, (req, res) => {
  if (!isLADrole(req.user)) return res.status(403).json({ error: 'Forbidden' });
  res.json(store.getAllFirms());
});

// GET /api/v1/firms/:id
router.get('/:id', requireAuth, (req, res) => {
  const id = effectiveFirmId(req.user, req.params.id);
  const firm = store.getFirmById(id);
  if (!firm) return res.status(404).json({ error: 'Firm not found' });

  const u = req.user;
  const allowed = isLADrole(u) ||
    (u.role === 'firm_compliance_officer' && u.firm_id === firm.id) ||
    (u.user_type === 'lawyer' && u.firm_id === firm.id);
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

  res.json(firm);
});

// GET /api/v1/firms/:id/lawyers
router.get('/:id/lawyers', requireAuth, (req, res) => {
  const u = req.user;
  const id = effectiveFirmId(u, req.params.id);
  const isOwnCO = u.role === 'firm_compliance_officer' && u.firm_id === id;
  if (!isLADrole(u) && !isOwnCO) return res.status(403).json({ error: 'Forbidden' });

  res.json((store.getLawyersByFirm(id) || []).map(lawyerRow));
});

// GET /api/v1/firms/:id/transactions — credit ledger across the firm's lawyers
const _FMONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
router.get('/:id/transactions', requireAuth, (req, res) => {
  const u = req.user;
  const id = effectiveFirmId(u, req.params.id);
  const isOwnCO = u.role === 'firm_compliance_officer' && u.firm_id === id;
  if (!isLADrole(u) && !isOwnCO) return res.status(403).json({ error: 'Forbidden' });
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT t.type, t.amount, t.aed_amount, t.description, t.created_at, l.first_name, l.last_name
       FROM credit_transactions t JOIN lawyers l ON l.id = t.lawyer_id
       WHERE l.firm_id = ? ORDER BY t.created_at DESC LIMIT 200`
    ).all(id);
  } catch (_) {}
  const fmt = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : `${d.getUTCDate()} ${_FMONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  res.json(rows.map((t) => ({
    date: fmt(t.created_at),
    type: t.type === 'use' ? 'booking' : (t.type || 'purchase'),
    desc: t.description || `${t.first_name || ''} ${t.last_name || ''}`.trim() || 'Credit movement',
    amount: Number(t.amount) || 0,
    aed: Math.abs(Number(t.aed_amount) || 0),
  })));
});

// GET /api/v1/firms/:id/bookings — recent bookings across the firm
router.get('/:id/bookings', requireAuth, (req, res) => {
  const u = req.user;
  const id = effectiveFirmId(u, req.params.id);
  const isOwnCO = u.role === 'firm_compliance_officer' && u.firm_id === id;
  if (!isLADrole(u) && !isOwnCO) return res.status(403).json({ error: 'Forbidden' });

  res.json(store.getFirmBookings(id));
});

// ─── AI firm-insights ────────────────────────────────────────────────
// Live, data-driven priorities for the firm compliance officer. AiModel
// composes the narrative from the firm's REAL lawyers + the live course
// catalogue; a deterministic heuristic is the always-on fallback.
const _IMONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function _idate(iso) { if (!iso) return 'TBC'; const d = new Date(iso); return isNaN(d) ? 'TBC' : `${d.getUTCDate()} ${_IMONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }

// Pace-aware standing (mirrors the portals/oversight): judge on whether a lawyer
// can still reach 16 points by 31 Dec at a sensible monthly rate, NOT on raw
// points. Mid-year, a lawyer on ~8 points is on track, not "critical".
function _clpdMonthsLeft() { const e = Date.UTC(new Date().getUTCFullYear(), 11, 31); return Math.max(0, (e - Date.now()) / 86400000) / 30.44; }
function _clpdBand(points) {
  const p = Number(points) || 0;
  if (p >= 16) return 'compliant';
  const m = _clpdMonthsLeft();
  const r = m > 0 ? (16 - p) / m : Infinity;
  if (r >= 6) return 'critical';
  if (r >= 3) return 'at-risk';
  return 'on-track';
}

function firmInsightData(firmId) {
  const firm = store.getFirmById(firmId);
  const all = store.getLawyersByFirm(firmId) || [];
  const practising = all.filter((l) => {
    const s = (l.status || 'active').toLowerCase();
    return s !== 'inactive' && s !== 'resigned' && s !== 'non-practising';
  });
  const pts = (l) => Number(l.lifetime_points) || 0;
  const critical = practising.filter((l) => _clpdBand(pts(l)) === 'critical');
  const atRisk = practising.filter((l) => _clpdBand(pts(l)) === 'at-risk');
  const onTrack = practising.filter((l) => _clpdBand(pts(l)) === 'on-track');
  const compliant = practising.filter((l) => pts(l) >= 16);
  const totalPts = practising.reduce((s, l) => s + pts(l), 0);
  const avg = practising.length ? Math.round((totalPts / practising.length) * 10) / 10 : 0;
  const compliancePct = practising.length ? Math.round((compliant.length + atRisk.length / 2) / practising.length * 1000) / 10 : 0;
  const topCritical = critical.slice().sort((a, b) => pts(a) - pts(b)).slice(0, 6)
    .map((l) => ({ id: l.id, name: `${l.first_name || ''} ${l.last_name || ''}`.trim() || l.id, pts: pts(l), practice: l.practice_areas || '' }));

  // Live upcoming courses with seats
  const now = new Date().toISOString();
  let courses = [];
  try {
    courses = db.prepare('SELECT * FROM courses WHERE active = 1').all().map((c) => {
      let sessions = [];
      try { sessions = db.prepare("SELECT id, scheduled_at, seats_remaining FROM course_sessions WHERE course_id = ? AND scheduled_at >= ? AND status != 'cancelled' ORDER BY scheduled_at ASC LIMIT 1").all(c.id, now); } catch (_) {}
      return { id: c.id, title: c.title, type: c.type, format: c.format, elearning: /e-?learning/i.test(c.format || ''),
        pts: Number(c.pts) || 2, credits: Number(c.credits) || 5,
        next: sessions.length ? sessions[0].scheduled_at : null,
        seats: sessions.length ? Number(sessions[0].seats_remaining) || 0 : 0 };
    });
  } catch (_) {}
  return { firm, practising, critical, atRisk, onTrack, compliant, avg, compliancePct, topCritical, courses };
}

function heuristicInsights(d) {
  const cards = [];
  const f2f = d.courses.filter((c) => !c.elearning && c.seats > 0).sort((a, b) => b.pts - a.pts);
  const elearn = d.courses.filter((c) => c.elearning);
  // 1. Critical cluster
  if (d.critical.length) {
    const names = d.topCritical.slice(0, 3).map((l) => `${l.name} (${l.pts} pts)`).join(', ');
    const course = f2f[0];
    cards.push({ kind: 'urgent', eyebrow: `URGENT · ${d.critical.length} LAWYER${d.critical.length === 1 ? '' : 'S'}`,
      title: `${d.critical.length} lawyer${d.critical.length === 1 ? '' : 's'} critically behind`,
      body: `${d.critical.length} lawyers are well behind the pace needed for 31 Dec${names ? ': ' + names : ''}.${course ? ` <strong>${course.title}</strong> on ${_idate(course.next)} adds +${course.pts} each.` : ''}`,
      actionLabel: course ? `Book onto ${course.title.split(' ').slice(0, 3).join(' ')}` : 'Review critical lawyers',
      courseId: course ? course.id : null, lawyerCount: d.critical.length, pointsGain: course ? course.pts * d.critical.length : 0, credits: course ? course.credits * d.critical.length : 0 });
  }
  // 2. High-leverage seat opportunity
  if (f2f.length) {
    const c = f2f[0];
    const benef = Math.min(d.atRisk.length + d.critical.length, c.seats);
    cards.push({ kind: 'opportunity', eyebrow: `OPPORTUNITY · ${c.seats} SEATS`,
      title: `${c.title.split(' ').slice(0, 5).join(' ')} — high-leverage booking`,
      body: `<strong>${benef} lawyers</strong> can claim a seat on <strong>${_idate(c.next)}</strong> — adds <strong>+${c.pts * benef} compliance points</strong> firm-wide for <strong>${c.credits * benef} credits</strong>.${c.seats <= 5 ? ' Only ' + c.seats + ' seats left — book today.' : ''}`,
      actionLabel: `Mass-book ${c.title.split(' ').slice(0, 3).join(' ')}`, courseId: c.id, lawyerCount: benef, pointsGain: c.pts * benef, credits: c.credits * benef });
  }
  // 3. Strategic e-learning
  if (elearn.length) {
    const c = elearn[0]; const gap = d.critical.length + d.atRisk.length;
    cards.push({ kind: 'strategy', eyebrow: 'STRATEGY · FIRM-WIDE',
      title: `${c.title} closes ${gap} gaps`,
      body: `<strong>${gap} lawyers</strong> still need <strong>${c.title}</strong> — ${c.credits} credits each, self-paced, worth <strong>+${c.pts} points each</strong>. The highest-value single action firm-wide.`,
      actionLabel: `Enrol all ${gap}`, courseId: c.id, lawyerCount: gap, pointsGain: c.pts * gap, credits: c.credits * gap });
  }
  if (!cards.length) cards.push({ kind: 'strategy', eyebrow: 'STATUS · ON TRACK', title: 'Firm in good standing', body: 'No critical clusters detected. Keep momentum with refresher CPD.', actionLabel: 'Review trajectory', courseId: null, lawyerCount: 0, pointsGain: 0, credits: 0 });
  return cards.slice(0, 3);
}

router.get('/:id/insights', requireAuth, async (req, res, next) => {
  const u = req.user;
  const id = effectiveFirmId(u, req.params.id);
  const isOwnCO = u.role === 'firm_compliance_officer' && u.firm_id === id;
  if (!isLADrole(u) && !isOwnCO) return res.status(403).json({ error: 'Forbidden' });
  const d = firmInsightData(id);
  const firmName = (d.firm && d.firm.name) || 'the firm';
  const metrics = { firm: firmName, practising: d.practising.length, critical: d.critical.length, atRisk: d.atRisk.length, onTrack: d.onTrack.length, compliant: d.compliant.length, avgPoints: d.avg, compliancePct: d.compliancePct };

  if (aimodel.configured() && d.practising.length) {
    try {
      const courseList = d.courses.map((c) => `- ${c.title} [${c.id}] · ${c.type} · ${c.elearning ? 'e-learning' : 'face-to-face'} · ${c.pts}pts · ${c.credits}cr${c.next ? ' · next ' + _idate(c.next) + ' · ' + c.seats + ' seats' : ''}`).join('\n');
      const critList = d.topCritical.map((l) => `${l.name} ${l.pts}/16${l.practice ? ' · ' + l.practice : ''}`).join('; ') || 'none';
      const system = 'You are Maryam, an elite legal-sector CLPD compliance strategist advising the compliance officer of a Dubai law firm. '
        + 'CRITICAL CONTEXT — judge on PACE, not raw points: CLPD is ONE 12-month cycle (16 points = 8 mandatory + 8 accredited, due 31 December). It is normal for lawyers to be mid-progress mid-year, so most of a firm having fewer than 16 points now is NOT a crisis and a low compliance rate mid-cycle is EXPECTED. The data already classifies lawyers by pace: "onTrack" (progressing at a healthy rate), "atRisk" (behind the pace needed), "critical" (well behind with little time), "compliant" (16+). Treat onTrack + compliant as HEALTHY. Do NOT say the firm is "in critical condition", "critical compliance exposure", "100% below target" or similar when most lawyers are on track — be accurate and constructive, not alarmist. '
        + 'From the firm\'s REAL data, produce the THREE highest-impact, specific, quantified priorities for THIS WEEK. Each must cite real numbers (lawyers affected, points gained, credits, seats, dates) and be directly actionable by booking a course from the catalogue. Reply with ONLY JSON: {"summary": string (one accurate, measured sentence on firm posture — lead with how many are on track/compliant before any concern), "cards": [{"kind": "urgent"|"opportunity"|"strategy", "eyebrow": string (e.g. "URGENT · 3 LAWYERS"), "title": string, "body": string (may use <strong> for key numbers), "actionLabel": string, "courseId": string|null (EXACT id from the catalogue or null), "lawyerCount": number, "pointsGain": number, "credits": number}]}. Exactly 3 cards: one urgent (only the genuinely behind-pace lawyers — if there are none, make it an early-momentum nudge instead), one opportunity (a seat-limited course that lifts many), one strategy (firm-wide, e.g. e-learning). Use only catalogue course ids.';
      const user = `Firm: ${firmName}\nPractising lawyers: ${d.practising.length} · avg ${d.avg}/16 pts · ${_clpdMonthsLeft().toFixed(1)} months left in the cycle\nBy PACE: ${d.onTrack.length} on track · ${d.atRisk.length} behind pace (at risk) · ${d.critical.length} well behind (critical) · ${d.compliant.length} already compliant (16+)\nMost-behind lawyers: ${critList}\n\nLive course catalogue:\n${courseList || '(none scheduled)'}`;
      const text = await aimodel.chat({ system, messages: [{ role: 'user', content: user }], maxTokens: 1100, temperature: 0.4 });
      let parsed = null; try { const m = text.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : text); } catch (_) {}
      if (parsed && Array.isArray(parsed.cards) && parsed.cards.length) {
        // Validate courseIds against the catalogue
        const ids = new Set(d.courses.map((c) => c.id));
        parsed.cards.forEach((c) => { if (c.courseId && !ids.has(c.courseId)) c.courseId = null; });
        return res.json({ engine: 'aimodel', summary: parsed.summary || '', cards: parsed.cards.slice(0, 3), metrics });
      }
    } catch (e) { log.error('firm_insights_aimodel', { error: e.message }); }
  }
  const _healthy = d.onTrack.length + d.compliant.length;
  const _behind = d.critical.length + d.atRisk.length;
  const heurSummary = _behind
    ? `${firmName}: ${_healthy} of ${d.practising.length} lawyers on track or compliant; ${_behind} behind pace to prioritise before 31 Dec.`
    : `${firmName}: all ${d.practising.length} practising lawyers are on track or compliant — keep the momentum.`;
  res.json({ engine: 'heuristic', summary: heurSummary, cards: heuristicInsights(d), metrics });
});

module.exports = router;
