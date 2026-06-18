'use strict';

// Admin AI copilot — answers the admin team's questions grounded in a LIVE
// data snapshot, and guides them to the right action.
//   POST /command   { prompt } -> { answer, snapshot }

const express = require('express');
const router = express.Router();
const db = require('../db');
const aimodel = require('../services/aimodel');
const { requireAuth } = require('../middleware/auth');

const ADMIN_ROLES = ['lad_admin', 'lad_intelligence', 'lad_super_admin', 'super_admin', 'dg'];
const isAdmin = (u) => !!u && ADMIN_ROLES.includes(u.role);

function snapshot() {
  const one = (sql) => { try { return db.prepare(sql).get() || {}; } catch (_) { return {}; } };
  const all = (sql) => { try { return db.prepare(sql).all(); } catch (_) { return []; } };
  return {
    lawyers: one("SELECT COUNT(*) total, SUM(CASE WHEN COALESCE(lifetime_points,0)<8 THEN 1 ELSE 0 END) critical, SUM(CASE WHEN COALESCE(lifetime_points,0)>=8 AND COALESCE(lifetime_points,0)<16 THEN 1 ELSE 0 END) atRisk, SUM(CASE WHEN COALESCE(lifetime_points,0)>=16 THEN 1 ELSE 0 END) compliant FROM lawyers WHERE COALESCE(LOWER(status),'active') NOT IN ('inactive','resigned')"),
    firms: one('SELECT COUNT(*) total FROM firms'),
    courses: one('SELECT COUNT(*) active FROM courses WHERE active = 1'),
    upcomingSessions: one("SELECT COUNT(*) sessions, COALESCE(SUM(seats_remaining),0) openSeats FROM course_sessions WHERE status NOT IN ('cancelled','closed') AND scheduled_at >= datetime('now')"),
    lowSeatSessions: one("SELECT COUNT(*) n FROM course_sessions WHERE status NOT IN ('cancelled','closed') AND scheduled_at >= datetime('now') AND seats_remaining > 0 AND seats_remaining <= 5"),
    bookings: one("SELECT COUNT(*) total, SUM(CASE WHEN status='attended' THEN 1 ELSE 0 END) attended, SUM(CASE WHEN status='no-show' THEN 1 ELSE 0 END) noShow, SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) cancelled FROM bookings"),
    bottomFirmsByCompliance: all("SELECT f.name, ROUND(AVG(COALESCE(l.lifetime_points,0)),1) avgPts, COUNT(l.id) lawyers FROM firms f JOIN lawyers l ON l.firm_id = f.id GROUP BY f.id HAVING lawyers >= 3 ORDER BY avgPts ASC LIMIT 8"),
  };
}

router.post('/command', requireAuth, async (req, res, next) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  const prompt = (req.body && req.body.prompt || '').toString().trim();
  if (!prompt) return res.status(400).json({ error: 'Ask a question or describe an action.' });
  const snap = snapshot();
  if (!aimodel.configured()) {
    return res.json({ engine: 'snapshot', snapshot: snap,
      answer: 'AI is not configured on this environment, but here is the live snapshot to work from: ' + JSON.stringify(snap) });
  }
  const system = 'You are the LAD CLPD admin copilot for the Dubai Legal Affairs Department. '
    + 'Answer the admin\'s question using ONLY the live data snapshot provided (JSON), with the real numbers. '
    + 'Context: practising lawyers need 16 CPD points by 31 December; <8 = critical, 8-15 = at risk, 16+ = compliant. '
    + 'If the admin asks to DO something (cancel or move a session, notify lawyers/firms, refund a booking), briefly explain what will happen and point them to the right control: '
    + '"Bookings → Manage" for a single booking; the course Sessions panel to cancel/reschedule a session (which auto-refunds and notifies everyone booked); or the Notify action to message a lawyer, a firm, or a segment. Offer to draft the message. '
    + 'Be concise and practical. Plain text, no markdown headings.';
  const user = 'Live snapshot:\n' + JSON.stringify(snap) + '\n\nAdmin asks: ' + prompt;
  try {
    const text = await aimodel.chat({ system, messages: [{ role: 'user', content: user }], maxTokens: 520, temperature: 0.3 });
    res.json({ engine: 'aimodel', answer: text, snapshot: snap });
  } catch (e) {
    if (e.code === 'AIMODEL_ERROR') return res.status(502).json({ error: 'AiModel call failed' });
    next(e);
  }
});

// GET /api/v1/admin/snapshot — live snapshot (powers inline suggestions).
router.get('/snapshot', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  res.json(snapshot());
});

module.exports = router;
