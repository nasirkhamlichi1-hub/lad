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

// Compact list of upcoming sessions the AI can act on (resolve by title+date).
function upcomingSessions(limit) {
  try {
    return db.prepare(
      `SELECT s.id, c.title AS course_title, s.scheduled_at, s.venue, s.seats_remaining,
              (SELECT COUNT(*) FROM bookings b WHERE b.session_id = s.id AND b.status NOT IN ('cancelled','refunded')) AS booked
       FROM course_sessions s JOIN courses c ON c.id = s.course_id
       WHERE COALESCE(s.status,'scheduled') NOT IN ('cancelled') AND s.scheduled_at >= datetime('now')
       ORDER BY s.scheduled_at LIMIT ?`
    ).all(limit || 80);
  } catch (_) { return []; }
}

router.post('/command', requireAuth, async (req, res, next) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  const prompt = (req.body && req.body.prompt || '').toString().trim();
  if (!prompt) return res.status(400).json({ error: 'Ask a question or describe an action.' });
  const snap = snapshot();
  const sessions = upcomingSessions(80);
  const sessIndex = {}; sessions.forEach((s) => { sessIndex[s.id] = s; });
  if (!aimodel.configured()) {
    return res.json({ intent: 'answer', engine: 'snapshot', snapshot: snap,
      answer: 'AI is not configured here, but the live snapshot is: ' + JSON.stringify(snap) });
  }
  const sessList = sessions.map((s) => `- id=${s.id} | ${s.course_title} | ${new Date(s.scheduled_at).toUTCString()} | booked=${s.booked} | seatsLeft=${s.seats_remaining}`).join('\n') || '(no upcoming sessions)';
  const system = 'You are the LAD CLPD admin copilot for the Dubai Legal Affairs Department. You can ANSWER questions and PROPOSE actions for the admin to confirm. Use ONLY the provided live data. Reply with ONLY a JSON object.\n'
    + 'Context: practising lawyers need 16 CPD points by 31 December; <8 = critical, 8-15 = at risk, 16+ = compliant.\n'
    + 'If the admin asks a question, reply {"intent":"answer","answer": string} using the real numbers.\n'
    + 'If the admin asks to perform an action, choose exactly one:\n'
    + '- Cancel a session: {"intent":"cancel_session","summary": string,"params":{"sessionId": string}}\n'
    + '- Reschedule a session: {"intent":"reschedule_session","summary": string,"params":{"sessionId": string,"scheduled_at": ISO-8601 string,"venue": string (optional)}}\n'
    + '- Notify people: {"intent":"notify","summary": string,"params":{"audience":"all" or "segment","segment":{"band":"critical"|"at-risk"|"compliant"} or {"noBookings":true} (omit segment for all),"title": string,"body": string}}\n'
    + 'For session actions you MUST set sessionId to the EXACT id of a session from the SESSIONS list that best matches by course title and date. If none matches, return an answer saying so. '
    + '"summary" must be one clear sentence stating what will happen, including the number booked (they will be refunded + notified). For notify, write a professional title and a 2-4 sentence body. Output JSON only.';
  const user = 'Live snapshot:\n' + JSON.stringify(snap) + '\n\nSESSIONS:\n' + sessList + '\n\nAdmin says: ' + prompt;
  try {
    const text = await aimodel.chat({ system, messages: [{ role: 'user', content: user }], maxTokens: 600, temperature: 0.2 });
    let p = null; try { const m = text.match(/\{[\s\S]*\}/); p = JSON.parse(m ? m[0] : text); } catch (_) {}
    if (!p || !p.intent) return res.json({ intent: 'answer', engine: 'aimodel', answer: text });
    // Validate action plans against real data; downgrade to answer if invalid.
    if (p.intent === 'cancel_session' || p.intent === 'reschedule_session') {
      const sid = p.params && p.params.sessionId;
      if (!sid || !sessIndex[sid]) {
        return res.json({ intent: 'answer', engine: 'aimodel', answer: (p.summary || 'I could not find a matching upcoming session for that. Please be more specific (course name + date).') });
      }
      const s = sessIndex[sid];
      p.params.session = { id: s.id, title: s.course_title, scheduled_at: s.scheduled_at, booked: s.booked, venue: s.venue };
    } else if (p.intent === 'notify') {
      if (!p.params) p.params = {};
      if (p.params.audience !== 'segment') p.params.audience = p.params.segment ? 'segment' : 'all';
    } else if (p.intent !== 'answer') {
      return res.json({ intent: 'answer', engine: 'aimodel', answer: p.summary || text });
    }
    p.engine = 'aimodel';
    res.json(p);
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

// POST /api/v1/admin/reclassify-practising — apply the standard practising rules.
router.post('/reclassify-practising', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  let total = 0, practising = 0, nonPractising = 0;
  try {
    const rows = db.prepare("SELECT id, COALESCE(LOWER(status),'active') status FROM lawyers").all();
    const upd = db.prepare('UPDATE lawyers SET status = ? WHERE id = ?');
    const tx = db.transaction(() => {
      for (const r of rows) {
        total++;
        if (r.status === 'inactive' || r.status === 'resigned') { nonPractising++; continue; } // preserve
        const id = (r.id || '').toUpperCase();
        const nonLawyer = /^D-?\d/.test(id) || /CWTEAM|LAD|TEAM|ADMIN|STAFF/.test(id);
        if (nonLawyer) { upd.run('non-practising', r.id); nonPractising++; }
        else { upd.run('active', r.id); practising++; }
      }
    });
    tx();
  } catch (e) { return res.status(500).json({ error: e.message }); }
  res.json({ data: { practising, non_practising: nonPractising, total } });
});

module.exports = router;
