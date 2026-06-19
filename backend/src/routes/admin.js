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
  const history = Array.isArray(req.body.history) ? req.body.history.filter((m) => m && m.role && typeof m.content === 'string').slice(-8) : [];
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
    const text = await aimodel.chat({ system, messages: history.concat([{ role: 'user', content: user }]), maxTokens: 600, temperature: 0.2 });
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

// ─── City-wide oversight ────────────────────────────────────────────────────
// One composite, fully-live snapshot for the LAD super-user landing. Compliance
// points are this-cycle attended-booking points (consistent with stats.js), so
// every number on the oversight dashboard matches the rest of the platform.
function cycleYear() { return new Date().getUTCFullYear(); }
function daysToDeadline() {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59));
  return Math.max(0, Math.ceil((end - now) / 86400000));
}
function oversight() {
  const year = String(cycleYear());
  const one = (sql, ...a) => { try { return db.prepare(sql).get(...a) || {}; } catch (_) { return {}; } };
  const all = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch (_) { return []; } };
  // Practising = anyone not explicitly out of the profession.
  const PRACT = "COALESCE(LOWER(l.status),'active') NOT IN ('inactive','resigned','non-practising','struck off','left')";
  // Bands by this-cycle attended-booking points: <8 critical, 8–15 at risk, 16+ compliant.
  const bands = one(
    `WITH lp AS (
       SELECT l.id, COALESCE(SUM(CASE WHEN b.status='attended' AND strftime('%Y', b.created_at)=? THEN b.points_earned ELSE 0 END),0) pts
       FROM lawyers l LEFT JOIN bookings b ON b.lawyer_id = l.id
       WHERE ${PRACT} GROUP BY l.id)
     SELECT COUNT(*) practising,
       SUM(CASE WHEN pts>=16 THEN 1 ELSE 0 END) compliant,
       SUM(CASE WHEN pts>=8 AND pts<16 THEN 1 ELSE 0 END) atRisk,
       SUM(CASE WHEN pts<8 THEN 1 ELSE 0 END) critical
     FROM lp`, year);
  const roll = one('SELECT COUNT(*) n FROM lawyers').n || 0;
  const firms = one('SELECT COUNT(*) n FROM firms').n || 0;
  const providers = one('SELECT COUNT(*) n FROM providers').n || 0;
  const courses = one('SELECT COUNT(*) n FROM courses WHERE active = 1').n || 0;
  const sess = one("SELECT COUNT(*) sessions, COALESCE(SUM(seats_remaining),0) openSeats FROM course_sessions WHERE COALESCE(status,'scheduled') NOT IN ('cancelled','closed') AND scheduled_at >= datetime('now')");
  const lowSeat = one("SELECT COUNT(*) n FROM course_sessions WHERE COALESCE(status,'scheduled') NOT IN ('cancelled','closed') AND scheduled_at >= datetime('now') AND seats_remaining>0 AND seats_remaining<=5").n || 0;
  const bk = one("SELECT COUNT(*) total, SUM(CASE WHEN status='attended' THEN 1 ELSE 0 END) attended, SUM(CASE WHEN status='no-show' THEN 1 ELSE 0 END) noShow, SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) cancelled FROM bookings");
  const acc = one("SELECT SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending, SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) approved, SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) rejected, SUM(CASE WHEN status='returned' THEN 1 ELSE 0 END) returned FROM accreditations");
  const firmRows = all(
    `WITH lp AS (
       SELECT l.firm_id, l.id, COALESCE(SUM(CASE WHEN b.status='attended' AND strftime('%Y', b.created_at)=? THEN b.points_earned ELSE 0 END),0) pts
       FROM lawyers l LEFT JOIN bookings b ON b.lawyer_id = l.id
       WHERE ${PRACT} AND l.firm_id IS NOT NULL GROUP BY l.id)
     SELECT f.id, f.name, COUNT(lp.id) lawyers, ROUND(AVG(lp.pts),1) avgPts,
       ROUND(100.0*SUM(CASE WHEN lp.pts>=16 THEN 1 ELSE 0 END)/COUNT(lp.id),1) compliancePct,
       SUM(CASE WHEN lp.pts<8 THEN 1 ELSE 0 END) critical
     FROM firms f JOIN lp ON lp.firm_id = f.id
     GROUP BY f.id HAVING lawyers >= 5
     ORDER BY compliancePct DESC, avgPts DESC`, year);
  const practising = bands.practising || 0, compliant = bands.compliant || 0;
  const attended = bk.attended || 0, noShow = bk.noShow || 0;
  return {
    generatedAt: new Date().toISOString(),
    cycleYear: cycleYear(), daysToDeadline: daysToDeadline(),
    lawyers: { roll, practising, critical: bands.critical || 0, atRisk: bands.atRisk || 0, compliant,
      complianceRate: practising ? Math.round(1000 * compliant / practising) / 10 : 0 },
    firms: { total: firms },
    providers: { total: providers },
    courses: { active: courses },
    sessions: { upcoming: sess.sessions || 0, openSeats: sess.openSeats || 0, lowSeat },
    bookings: { total: bk.total || 0, attended, noShow, cancelled: bk.cancelled || 0,
      attendanceRate: (attended + noShow) ? Math.round(1000 * attended / (attended + noShow)) / 10 : null },
    accreditations: { pending: acc.pending || 0, approved: acc.approved || 0, rejected: acc.rejected || 0, returned: acc.returned || 0 },
    firmRankings: { top: firmRows.slice(0, 6), bottom: firmRows.slice(-6).reverse() },
  };
}

router.get('/oversight', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  res.json(oversight());
});

// GET /api/v1/admin/briefing — AI executive briefing grounded in the live
// oversight snapshot. Returns headline + summary + ranked actions + risk flags.
router.get('/briefing', requireAuth, async (req, res, next) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  const o = oversight();
  if (!aimodel.configured()) {
    return res.json({ engine: 'snapshot', oversight: o,
      headline: `${o.lawyers.complianceRate}% of practising lawyers are compliant with ${o.daysToDeadline} days to the deadline.`,
      summary: `${o.lawyers.compliant} of ${o.lawyers.practising} practising lawyers have reached 16 points. ${o.lawyers.critical} are critical (below 8) and ${o.lawyers.atRisk} are at risk. ${o.accreditations.pending} accreditations await review.`,
      actions: [], watch: [] });
  }
  const system = 'You are chief of staff to the Director-General of the Dubai Legal Affairs Department, briefing the LAD super-users who oversee the entire CLPD programme. From the LIVE oversight data, write a crisp executive briefing. Reply with ONLY JSON: {"headline": string (one sentence on overall programme health), "summary": string (2-3 sentences citing the real key numbers), "actions": [{"priority":"high"|"medium"|"low","title": string,"detail": string (one sentence citing a real number)}] (exactly 3, most important first), "watch": [string] (1-3 short risk flags)}. Use ONLY the numbers provided. Context: practising lawyers need 16 CPD points by 31 December; <8 = critical, 8-15 = at risk, 16+ = compliant.';
  try {
    const text = await aimodel.chat({ system, messages: [{ role: 'user', content: 'Live oversight snapshot:\n' + JSON.stringify(o) }], maxTokens: 650, temperature: 0.3 });
    let p = null; try { const m = text.match(/\{[\s\S]*\}/); p = JSON.parse(m ? m[0] : text); } catch (_) {}
    if (!p) p = { headline: '', summary: text, actions: [], watch: [] };
    p.engine = 'aimodel'; p.oversight = o;
    res.json(p);
  } catch (e) {
    if (e.code === 'AIMODEL_ERROR') return res.json({ engine: 'snapshot', oversight: o, headline: '', summary: 'AI briefing is unavailable right now — showing live numbers only.', actions: [], watch: [] });
    next(e);
  }
});

// GET /api/v1/admin/anomalies — REAL anomaly detection from live data (no fakes).
function detectAnomalies() {
  const all = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch (_) { return []; } };
  const out = [];
  const fmt = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toUTCString().slice(5, 16); };
  // 1. Firms with an elevated no-show rate (>=3 no-shows AND >25%).
  all(`SELECT f.id, f.name, COUNT(*) total, SUM(CASE WHEN b.status='no-show' THEN 1 ELSE 0 END) ns
       FROM bookings b JOIN lawyers l ON l.id=b.lawyer_id JOIN firms f ON f.id=l.firm_id
       GROUP BY f.id HAVING ns>=3 AND ns*1.0/total>0.25 ORDER BY ns DESC LIMIT 5`)
    .forEach((r) => out.push({ level: 'high', kind: 'attendance', title: r.name + ' — elevated no-show rate',
      detail: r.ns + ' no-shows across ' + r.total + ' bookings (' + Math.round(100 * r.ns / r.total) + '%). Recommend compliance follow-up.', metric: r.ns, firmId: r.id }));
  // 2. Sessions within 21 days that are >80% empty.
  all(`SELECT c.title, s.scheduled_at, s.seats_remaining, s.capacity FROM course_sessions s JOIN courses c ON c.id=s.course_id
       WHERE COALESCE(s.status,'scheduled') NOT IN ('cancelled','closed') AND s.scheduled_at BETWEEN datetime('now') AND datetime('now','+21 day')
       AND s.capacity>0 AND s.seats_remaining*1.0/s.capacity>0.8 ORDER BY s.scheduled_at LIMIT 5`)
    .forEach((r) => out.push({ level: 'medium', kind: 'capacity', title: r.title + ' — under-subscribed',
      detail: r.seats_remaining + ' of ' + r.capacity + ' seats open with the session on ' + fmt(r.scheduled_at) + '. High-leverage capacity to fill.', metric: r.seats_remaining }));
  // 3. Cancellation spike in the last 7 days.
  const cx = (all("SELECT COUNT(*) n FROM bookings WHERE status='cancelled' AND created_at>=datetime('now','-7 day')")[0] || {}).n || 0;
  if (cx >= 10) out.push({ level: cx >= 25 ? 'high' : 'medium', kind: 'demand', title: 'Cancellation spike', detail: cx + ' bookings cancelled in the last 7 days — review whether sessions are mistimed.', metric: cx });
  // 4. Firms where >60% of lawyers are critical (and >=5 lawyers).
  const year = String(cycleYear());
  all(`WITH lp AS (SELECT l.firm_id, l.id, COALESCE(SUM(CASE WHEN b.status='attended' AND strftime('%Y',b.created_at)=? THEN b.points_earned ELSE 0 END),0) pts
        FROM lawyers l LEFT JOIN bookings b ON b.lawyer_id=l.id
        WHERE COALESCE(LOWER(l.status),'active') NOT IN ('inactive','resigned','non-practising','struck off','left') AND l.firm_id IS NOT NULL GROUP BY l.id)
      SELECT f.id, f.name, COUNT(lp.id) lawyers, SUM(CASE WHEN lp.pts<8 THEN 1 ELSE 0 END) crit
      FROM firms f JOIN lp ON lp.firm_id=f.id GROUP BY f.id HAVING lawyers>=5 AND crit*1.0/lawyers>0.6 ORDER BY crit*1.0/lawyers DESC LIMIT 5`, year)
    .forEach((r) => out.push({ level: 'high', kind: 'compliance', title: r.name + ' — compliance cluster',
      detail: r.crit + ' of ' + r.lawyers + ' lawyers are critical (' + Math.round(100 * r.crit / r.lawyers) + '%). Prioritise firm-wide outreach.', metric: r.crit, firmId: r.id }));
  const order = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => (order[a.level] - order[b.level]));
  return out;
}
router.get('/anomalies', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  const anomalies = detectAnomalies();
  const counts = anomalies.reduce((m, a) => { m[a.level] = (m[a.level] || 0) + 1; return m; }, {});
  res.json({ anomalies, total: anomalies.length, counts });
});

// GET /api/v1/admin/forecast — honest pace-based projection of cycle compliance.
router.get('/forecast', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  const year = String(cycleYear());
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT b.lawyer_id lid, b.points_earned pts, b.created_at FROM bookings b JOIN lawyers l ON l.id=b.lawyer_id
       WHERE b.status='attended' AND strftime('%Y',b.created_at)=?
       AND COALESCE(LOWER(l.status),'active') NOT IN ('inactive','resigned','non-practising','struck off','left')
       ORDER BY b.created_at ASC`, year).all();
  } catch (_) {}
  const practising = oversight().lawyers.practising || 0;
  const sum = {}, compliantMonth = {};
  rows.forEach((r) => {
    sum[r.lid] = (sum[r.lid] || 0) + (Number(r.pts) || 0);
    if (sum[r.lid] >= 16 && compliantMonth[r.lid] == null) {
      const m = new Date(r.created_at).getUTCMonth();
      compliantMonth[r.lid] = isNaN(m) ? 11 : m;
    }
  });
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const nowM = new Date().getUTCMonth();
  const cumAt = (m) => Object.values(compliantMonth).filter((cm) => cm <= m).length;
  const series = [];
  for (let m = 0; m <= nowM; m++) series.push({ month: MON[m], compliant: cumAt(m), rate: practising ? Math.round(1000 * cumAt(m) / practising) / 10 : 0 });
  const cNow = cumAt(nowM), cPrev = nowM >= 2 ? cumAt(nowM - 2) : 0;
  const perMonth = nowM >= 2 ? (cNow - cPrev) / 2 : (cNow / Math.max(nowM + 1, 1));
  const monthsLeft = 11 - nowM;
  const projected = Math.min(practising, Math.round(cNow + perMonth * monthsLeft));
  for (let m = nowM + 1; m <= 11; m++) {
    const c = Math.min(practising, Math.round(cNow + perMonth * (m - nowM)));
    series.push({ month: MON[m], compliant: c, rate: practising ? Math.round(1000 * c / practising) / 10 : 0, projected: true });
  }
  res.json({
    cycleYear: cycleYear(), practising,
    currentCompliant: cNow, currentRate: practising ? Math.round(1000 * cNow / practising) / 10 : 0,
    projectedCompliant: projected, projectedRate: practising ? Math.round(1000 * projected / practising) / 10 : 0,
    perMonth: Math.round(perMonth * 10) / 10, daysToDeadline: daysToDeadline(), series,
    method: 'Pace-based linear projection from the last two months of attendance',
  });
});

// GET /api/v1/admin/course-analytics — REAL market intelligence per course:
// weekly buying patterns, fill rates, accredited-vs-mandatory demand, momentum.
// Feedback/trainer-rating slots are returned as null until go-live capture.
router.get('/course-analytics', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  const all = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch (_) { return []; } };
  const WEEKS = 12, DAY = 86400000, now = Date.now();
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // week bucket: 0 = (WEEKS-1) weeks ago … WEEKS-1 = this week
  const bucketOf = (iso) => { const t = Date.parse(iso); if (isNaN(t)) return -1; const b = (WEEKS - 1) - Math.floor((now - t) / (7 * DAY)); return (b >= 0 && b < WEEKS) ? b : -1; };
  const weeks = []; for (let i = WEEKS - 1; i >= 0; i--) { const d = new Date(now - i * 7 * DAY); weeks.push(d.getUTCDate() + ' ' + MON[d.getUTCMonth()]); }

  const courses = all("SELECT id, title, COALESCE(type,'accredited') type, COALESCE(pts,0) pts, COALESCE(credits,5) credits, category, provider_id FROM courses WHERE active = 1");
  const fillRows = all("SELECT course_id, SUM(capacity) cap, SUM(seats_remaining) seats, COUNT(*) sessions FROM course_sessions WHERE COALESCE(status,'open') NOT IN ('cancelled','closed') AND scheduled_at >= datetime('now') GROUP BY course_id");
  const fill = {}; fillRows.forEach((r) => { fill[r.course_id] = r; });
  const bk = all("SELECT course_id, created_at, status FROM bookings WHERE created_at >= datetime('now', ?)", '-' + (WEEKS * 7) + ' day');

  const perCourse = {}; courses.forEach((c) => { perCourse[c.id] = new Array(WEEKS).fill(0); });
  const marketWeekly = new Array(WEEKS).fill(0);
  let byMandatory = 0, byAccredited = 0;
  const typeOf = {}; courses.forEach((c) => { typeOf[c.id] = (c.type || '').toLowerCase(); });
  bk.forEach((r) => { const b = bucketOf(r.created_at); if (b < 0) return; if (perCourse[r.course_id]) perCourse[r.course_id][b]++; marketWeekly[b]++; if (typeOf[r.course_id] === 'mandatory') byMandatory++; else byAccredited++; });

  const out = courses.map((c) => {
    const w = perCourse[c.id] || new Array(WEEKS).fill(0);
    const f = fill[c.id] || {};
    const cap = Number(f.cap) || 0, seats = Number(f.seats) || 0;
    const total = w.reduce((s, x) => s + x, 0);
    const recent = w.slice(WEEKS - 4).reduce((s, x) => s + x, 0);
    const prior = w.slice(WEEKS - 8, WEEKS - 4).reduce((s, x) => s + x, 0);
    return {
      id: c.id, title: c.title, type: c.type, points: c.pts, credits: c.credits,
      topic: c.category || null, provider: c.provider_id || null,
      capacity: cap, seatsRemaining: seats, fillPct: cap ? Math.round(100 * (cap - seats) / cap) : null,
      upcomingSessions: Number(f.sessions) || 0,
      totalBookings: total, weekly: w, momentum: recent - prior,
      rating: null, trainerRating: null, feedbackCount: 0, // awaiting go-live capture
    };
  }).sort((a, b) => b.totalBookings - a.totalBookings);

  const ranked = out.filter((c) => c.totalBookings > 0).sort((a, b) => b.momentum - a.momentum);
  res.json({
    weeks,
    market: {
      totalBookings: marketWeekly.reduce((s, x) => s + x, 0),
      weekly: marketWeekly,
      mandatory: byMandatory, accredited: byAccredited,
      topGrowing: ranked.slice(0, 5).map((c) => ({ id: c.id, title: c.title, momentum: c.momentum, total: c.totalBookings })),
      cooling: ranked.slice(-3).reverse().map((c) => ({ id: c.id, title: c.title, momentum: c.momentum, total: c.totalBookings })),
    },
    courses: out.slice(0, 40),
    feedbackLive: false, // flips true once course/trainer feedback capture goes live
  });
});

// POST /api/v1/admin/query — natural-language → real query over the dataset.
// Returns "orbs" (matching firms / courses / lawyers / sessions) that the
// command centre renders as a live, explorable constellation.
function heuristicSpec(q, hint) {
  q = (q || '').toLowerCase();
  const spec = { filters: {}, limit: 30 };
  spec.entity = /firm/.test(q) ? 'firms' : /course/.test(q) ? 'courses' : /session/.test(q) ? 'sessions'
    : /(lawyer|practitioner|critical|at.?risk|compliant)/.test(q) ? 'lawyers' : (hint || 'firms');
  let m;
  if ((m = q.match(/(?:over|more than|above|>|at least|with)\s*(\d+)\s*\+?\s*lawyer/))) spec.filters.minLawyers = +m[1];
  if ((m = q.match(/(?:under|less than|below|fewer than|<)\s*(\d+)\s*lawyer/))) spec.filters.maxLawyers = +m[1];
  if ((m = q.match(/(?:under|less than|below|<)\s*(\d+)\s*%/))) spec.filters.maxCompliance = +m[1];
  if ((m = q.match(/(?:over|more than|above|>|at least)\s*(\d+)\s*%/))) spec.filters.minCompliance = +m[1];
  if (/mandatory/.test(q)) spec.filters.type = 'mandatory';
  if (/accredited/.test(q)) spec.filters.type = 'accredited';
  if (/this week/.test(q)) { spec.filters.upcomingWithinDays = 7; spec.filters.withinDays = 7; }
  if (/today/.test(q)) { spec.filters.upcomingWithinDays = 1; spec.filters.withinDays = 1; }
  if (/this month|next 30/.test(q)) { spec.filters.upcomingWithinDays = 30; spec.filters.withinDays = 30; }
  if (/critical/.test(q)) spec.filters.band = 'critical';
  if (/at.?risk/.test(q)) spec.filters.band = 'at-risk';
  if (/compliant/.test(q)) spec.filters.band = 'compliant';
  if (/low.?seat|under.?subscribed|empty/.test(q)) spec.filters.lowSeats = true;
  spec.title = (q ? q.charAt(0).toUpperCase() + q.slice(1) : 'Results').slice(0, 60);
  return spec;
}
const _PRACT = "COALESCE(LOWER(l.status),'active') NOT IN ('inactive','resigned','non-practising','struck off','left')";
function _fmtD(iso) { const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; const d = new Date(iso); return isNaN(d) ? '—' : d.getUTCDate() + ' ' + M[d.getUTCMonth()]; }
function runQuery(spec) {
  const all = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch (_) { return []; } };
  const f = spec.filters || {}, lim = Math.min(60, Math.max(1, spec.limit || 30)), year = String(cycleYear());
  if (spec.entity === 'firms') {
    let r = all(`WITH lp AS (SELECT l.firm_id, l.id, COALESCE(SUM(CASE WHEN b.status='attended' AND strftime('%Y',b.created_at)=? THEN b.points_earned ELSE 0 END),0) pts FROM lawyers l LEFT JOIN bookings b ON b.lawyer_id=l.id WHERE ${_PRACT} AND l.firm_id IS NOT NULL GROUP BY l.id)
      SELECT f.id, f.name, COUNT(lp.id) lawyers, ROUND(100.0*SUM(CASE WHEN lp.pts>=16 THEN 1 ELSE 0 END)/COUNT(lp.id),1) compliancePct, SUM(CASE WHEN lp.pts<8 THEN 1 ELSE 0 END) critical FROM firms f JOIN lp ON lp.firm_id=f.id GROUP BY f.id`, year);
    if (f.minLawyers != null) r = r.filter((x) => x.lawyers >= f.minLawyers);
    if (f.maxLawyers != null) r = r.filter((x) => x.lawyers <= f.maxLawyers);
    if (f.minCompliance != null) r = r.filter((x) => (x.compliancePct || 0) >= f.minCompliance);
    if (f.maxCompliance != null) r = r.filter((x) => (x.compliancePct || 0) <= f.maxCompliance);
    r.sort((a, b) => b.lawyers - a.lawyers);
    return r.slice(0, lim).map((x) => ({ id: x.id, label: x.name, sub: x.lawyers + ' lawyers · ' + (x.compliancePct || 0) + '%', count: x.lawyers, kind: 'firm', meta: { lawyers: x.lawyers, compliancePct: x.compliancePct, critical: x.critical } }));
  }
  if (spec.entity === 'courses') {
    let where = 'WHERE c.active=1'; const p = [];
    if (f.type) { where += ' AND LOWER(COALESCE(c.type,\'\'))=?'; p.push(String(f.type).toLowerCase()); }
    let r = all(`SELECT c.id, c.title, c.type, c.pts, c.credits,
      (SELECT COUNT(*) FROM bookings b WHERE b.course_id=c.id) bookings,
      (SELECT COUNT(*) FROM course_sessions s WHERE s.course_id=c.id AND s.scheduled_at>=datetime('now') AND COALESCE(s.status,'open') NOT IN ('cancelled','closed')) upcoming,
      (SELECT MIN(s.scheduled_at) FROM course_sessions s WHERE s.course_id=c.id AND s.scheduled_at>=datetime('now')) nextAt
      FROM courses c ${where}`, ...p);
    if (f.upcomingWithinDays != null) { const cut = Date.now() + f.upcomingWithinDays * 86400000; r = r.filter((x) => x.nextAt && Date.parse(x.nextAt) <= cut); }
    if (f.minBookings != null) r = r.filter((x) => x.bookings >= f.minBookings);
    r.sort((a, b) => (b.upcoming - a.upcoming) || (b.bookings - a.bookings));
    return r.slice(0, lim).map((x) => ({ id: x.id, label: x.title, sub: (x.upcoming || 0) + ' upcoming · ' + x.bookings + ' booked', count: Math.max(x.bookings, 1), kind: 'course', meta: { type: x.type, bookings: x.bookings, upcoming: x.upcoming, points: x.pts, credits: x.credits, nextAt: x.nextAt } }));
  }
  if (spec.entity === 'lawyers') {
    let r = all(`SELECT l.id, l.first_name, l.last_name, COALESCE(SUM(CASE WHEN b.status='attended' AND strftime('%Y',b.created_at)=? THEN b.points_earned ELSE 0 END),0) pts, fr.name firm FROM lawyers l LEFT JOIN bookings b ON b.lawyer_id=l.id LEFT JOIN firms fr ON fr.id=l.firm_id WHERE ${_PRACT} GROUP BY l.id`, year);
    if (f.band === 'critical') r = r.filter((x) => x.pts < 8); else if (f.band === 'at-risk') r = r.filter((x) => x.pts >= 8 && x.pts < 16); else if (f.band === 'compliant') r = r.filter((x) => x.pts >= 16);
    if (f.minPoints != null) r = r.filter((x) => x.pts >= f.minPoints);
    if (f.maxPoints != null) r = r.filter((x) => x.pts <= f.maxPoints);
    r.sort((a, b) => a.pts - b.pts);
    return r.slice(0, 42).map((x) => ({ id: x.id, label: ((x.first_name || '') + ' ' + (x.last_name || '')).trim() || x.id, sub: x.pts + ' pts · ' + (x.firm || '—'), count: Math.max(x.pts, 1), kind: 'lawyer', meta: { points: x.pts, firm: x.firm } }));
  }
  if (spec.entity === 'sessions') {
    const days = f.withinDays != null ? f.withinDays : 14;
    let r = all(`SELECT s.id, c.title, s.scheduled_at, s.capacity, s.seats_remaining, s.venue FROM course_sessions s JOIN courses c ON c.id=s.course_id WHERE COALESCE(s.status,'open') NOT IN ('cancelled','closed') AND s.scheduled_at BETWEEN datetime('now') AND datetime('now', ?) ORDER BY s.scheduled_at`, '+' + days + ' day');
    if (f.lowSeats) r = r.filter((x) => x.capacity > 0 && (x.seats_remaining / x.capacity) > 0.8);
    return r.slice(0, 42).map((x) => ({ id: x.id, label: x.title, sub: _fmtD(x.scheduled_at) + ' · ' + x.seats_remaining + '/' + x.capacity + ' seats', count: Math.max((x.capacity || 0) - (x.seats_remaining || 0), 1), kind: 'session', meta: { scheduled_at: x.scheduled_at, capacity: x.capacity, seats_remaining: x.seats_remaining, venue: x.venue } }));
  }
  return [];
}
router.post('/query', requireAuth, async (req, res, next) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  const prompt = (req.body && req.body.prompt || '').toString().trim();
  if (!prompt) return res.status(400).json({ error: 'Ask a question about the data.' });
  let spec = heuristicSpec(prompt, req.body && req.body.entity);
  if (aimodel.configured()) {
    try {
      const sys = 'Convert the question about a Dubai legal CPD dataset into a JSON query spec. Reply with ONLY JSON: {"entity":"firms"|"courses"|"lawyers"|"sessions","filters":{...},"limit":number,"title":string}. '
        + 'Allowed filters by entity — firms:{minLawyers,maxLawyers,minCompliance,maxCompliance}; courses:{type:"mandatory"|"accredited",upcomingWithinDays,minBookings}; lawyers:{band:"critical"|"at-risk"|"compliant",minPoints,maxPoints}; sessions:{withinDays,lowSeats(boolean)}. '
        + 'Only include filters you need. "this week"=7 days, "today"=1, "this month"=30. limit default 30. title = a short human label for the result. Output JSON only.';
      const text = await aimodel.chat({ system: sys, messages: [{ role: 'user', content: prompt }], maxTokens: 300, temperature: 0 });
      const m = text.match(/\{[\s\S]*\}/); const p = m ? JSON.parse(m[0]) : null;
      if (p && p.entity) spec = { entity: p.entity, filters: p.filters || {}, limit: p.limit || 30, title: p.title || spec.title };
    } catch (_) { /* keep heuristic */ }
  }
  try {
    const orbs = runQuery(spec);
    res.json({ title: spec.title, entity: spec.entity, count: orbs.length, orbs });
  } catch (e) { next(e); }
});

// GET /api/v1/admin/firms — every firm with its practising-lawyer count and
// compliance, sorted largest-first (powers the size-ranked firm galaxy).
router.get('/firms', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  const year = String(cycleYear());
  let firms = [];
  try {
    firms = db.prepare(`WITH lp AS (
        SELECT l.firm_id, l.id, COALESCE(SUM(CASE WHEN b.status='attended' AND strftime('%Y',b.created_at)=? THEN b.points_earned ELSE 0 END),0) pts
        FROM lawyers l LEFT JOIN bookings b ON b.lawyer_id=l.id WHERE ${_PRACT} AND l.firm_id IS NOT NULL GROUP BY l.id)
      SELECT f.id, f.name, COUNT(lp.id) lawyers,
        ROUND(100.0*SUM(CASE WHEN lp.pts>=16 THEN 1 ELSE 0 END)/COUNT(lp.id),1) compliancePct,
        SUM(CASE WHEN lp.pts<8 THEN 1 ELSE 0 END) critical
      FROM firms f JOIN lp ON lp.firm_id=f.id GROUP BY f.id HAVING lawyers>=1 ORDER BY lawyers DESC`).all(year);
  } catch (_) {}
  res.json({ firms, total: firms.length });
});

// GET /api/v1/admin/firm/:id — rich firm profile (lawyers, bands, courses,
// compliance) computed server-side, so a firm dives into its whole world.
router.get('/firm/:id', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  const id = req.params.id, year = String(cycleYear());
  const one = (sql, ...a) => { try { return db.prepare(sql).get(...a) || null; } catch (_) { return null; } };
  const all = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch (_) { return []; } };
  const firm = one('SELECT id, name FROM firms WHERE id = ?', id);
  if (!firm) return res.status(404).json({ error: 'Firm not found' });
  const lawyers = all(`SELECT l.id, l.first_name, l.last_name, l.status,
      COALESCE(SUM(CASE WHEN b.status='attended' AND strftime('%Y',b.created_at)=? THEN b.points_earned ELSE 0 END),0) pts
    FROM lawyers l LEFT JOIN bookings b ON b.lawyer_id=l.id WHERE l.firm_id=? AND ${_PRACT} GROUP BY l.id`, year, id);
  let crit = 0, risk = 0, comp = 0;
  lawyers.forEach((l) => { if (l.pts < 8) crit++; else if (l.pts < 16) risk++; else comp++; });
  const courses = all(`SELECT COALESCE(NULLIF(b.course_title,''), c.title) title, COUNT(*) n,
      SUM(CASE WHEN b.status='attended' THEN 1 ELSE 0 END) attended
    FROM bookings b LEFT JOIN courses c ON c.id=b.course_id JOIN lawyers l ON l.id=b.lawyer_id
    WHERE l.firm_id=? GROUP BY title ORDER BY n DESC LIMIT 24`, id);
  const total = lawyers.length;
  res.json({
    id: firm.id, name: firm.name, total,
    counts: { critical: crit, atRisk: risk, compliant: comp },
    compliancePct: total ? Math.round(100 * comp / total) : 0,
    lawyers: lawyers.map((l) => ({ id: l.id, name: ((l.first_name || '') + ' ' + (l.last_name || '')).trim() || l.id, points: l.pts, status: l.status })),
    courses: courses.map((c) => ({ title: c.title || 'Course', count: c.n, attended: c.attended })),
  });
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
