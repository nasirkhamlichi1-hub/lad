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

// GET /admin/activity — the unified, searchable audit trail. Every transaction
// and action on the platform is here, tagged for the admin team and the AI.
// Filters: q (free text over summary/tags/actor), category, kind, lawyer_id,
// firm_id, from, to (ISO dates). Admin-only; retained ≥4 years.
router.get('/activity', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  const q = req.query || {};
  const where = ['1=1']; const args = [];
  if (q.category) { where.push('a.category = ?'); args.push(String(q.category)); }
  if (q.kind) { where.push('a.kind = ?'); args.push(String(q.kind)); }
  if (q.lawyer_id) { where.push('a.lawyer_id = ?'); args.push(String(q.lawyer_id)); }
  if (q.firm_id) { where.push('a.firm_id = ?'); args.push(String(q.firm_id)); }
  if (q.from) { where.push('a.created_at >= ?'); args.push(String(q.from)); }
  if (q.to) { where.push('a.created_at <= ?'); args.push(String(q.to)); }
  if (q.q && String(q.q).trim()) {
    const like = '%' + String(q.q).trim() + '%';
    where.push('(a.summary LIKE ? OR a.tags LIKE ? OR a.actor_name LIKE ? OR a.ref_id LIKE ?)');
    args.push(like, like, like, like);
  }
  const limit = Math.min(500, parseInt(q.limit || '100', 10) || 100);
  args.push(limit);
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT a.id, a.created_at, a.firm_id, a.lawyer_id, a.kind, a.category, a.tags,
              a.actor_type, a.actor_name, a.summary, a.ref_type, a.ref_id, a.aed,
              (l.first_name || ' ' || l.last_name) AS lawyer_name, f.name AS firm_name
       FROM activity_log a
       LEFT JOIN lawyers l ON l.id = a.lawyer_id
       LEFT JOIN firms f ON f.id = a.firm_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.created_at DESC LIMIT ?`
    ).all(...args);
  } catch (e) { return res.json({ rows: [], error: e.message }); }
  res.json({ rows, count: rows.length });
});

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
  // Bands by lifetime CPD points (the platform-wide source of truth, same as
  // the lawyer/firm portals): <8 critical, 8–15 at risk, 16+ compliant.
  const bands = one(
    `WITH lp AS (
       SELECT l.id, COALESCE(l.lifetime_points,0) pts
       FROM lawyers l WHERE ${PRACT})
     SELECT COUNT(*) practising,
       SUM(CASE WHEN pts>=16 THEN 1 ELSE 0 END) compliant,
       SUM(CASE WHEN pts>=8 AND pts<16 THEN 1 ELSE 0 END) atRisk,
       SUM(CASE WHEN pts<8 THEN 1 ELSE 0 END) critical
     FROM lp`);
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
       SELECT l.firm_id, l.id, COALESCE(l.lifetime_points,0) pts
       FROM lawyers l WHERE ${PRACT} AND l.firm_id IS NOT NULL)
     SELECT f.id, f.name, COUNT(lp.id) lawyers, ROUND(AVG(lp.pts),1) avgPts,
       ROUND(100.0*SUM(CASE WHEN lp.pts>=16 THEN 1 ELSE 0 END)/COUNT(lp.id),1) compliancePct,
       SUM(CASE WHEN lp.pts<8 THEN 1 ELSE 0 END) critical
     FROM firms f JOIN lp ON lp.firm_id = f.id
     GROUP BY f.id HAVING lawyers >= 5
     ORDER BY compliancePct DESC, avgPts DESC`);
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
  all(`WITH lp AS (SELECT l.firm_id, l.id, COALESCE(l.lifetime_points,0) pts
        FROM lawyers l
        WHERE COALESCE(LOWER(l.status),'active') NOT IN ('inactive','resigned','non-practising','struck off','left') AND l.firm_id IS NOT NULL)
      SELECT f.id, f.name, COUNT(lp.id) lawyers, SUM(CASE WHEN lp.pts<8 THEN 1 ELSE 0 END) crit
      FROM firms f JOIN lp ON lp.firm_id=f.id GROUP BY f.id HAVING lawyers>=5 AND crit*1.0/lawyers>0.6 ORDER BY crit*1.0/lawyers DESC LIMIT 5`)
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
  // Real participant feedback (headline rating + response count per course),
  // so the digital-twin worlds and the AI read live ratings — not placeholders.
  let ratingMap = {}; try { ratingMap = require('../services/feedback').courseRatingMap() || {}; } catch (_) { ratingMap = {}; }

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
    const fr = ratingMap[c.id] || null;
    return {
      id: c.id, title: c.title, type: c.type, points: c.pts, credits: c.credits,
      topic: c.category || null, provider: c.provider_id || null,
      capacity: cap, seatsRemaining: seats, fillPct: cap ? Math.round(100 * (cap - seats) / cap) : null,
      upcomingSessions: Number(f.sessions) || 0,
      totalBookings: total, weekly: w, momentum: recent - prior,
      // Real participant feedback (null when a course has no responses yet).
      rating: fr && fr.stars != null ? fr.stars : null,
      trainerRating: null, // trainer identities/ratings are never surfaced
      feedbackCount: fr ? (fr.responses || 0) : 0,
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
    feedbackLive: out.some((c) => c.rating != null), // true once any course carries real ratings
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
    let r = all(`WITH lp AS (SELECT l.firm_id, l.id, COALESCE(l.lifetime_points,0) pts FROM lawyers l WHERE ${_PRACT} AND l.firm_id IS NOT NULL)
      SELECT f.id, f.name, COUNT(lp.id) lawyers, ROUND(100.0*SUM(CASE WHEN lp.pts>=16 THEN 1 ELSE 0 END)/COUNT(lp.id),1) compliancePct, SUM(CASE WHEN lp.pts<8 THEN 1 ELSE 0 END) critical FROM firms f JOIN lp ON lp.firm_id=f.id GROUP BY f.id`);
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
    let r = all(`SELECT l.id, l.first_name, l.last_name, COALESCE(l.lifetime_points,0) pts, fr.name firm FROM lawyers l LEFT JOIN firms fr ON fr.id=l.firm_id WHERE ${_PRACT}`);
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

  // ── Feedback / rating questions answer DIRECTLY from the real ratings
  // dataset (which courses are best/worst rated), not the generic entity query.
  if (/\b(feedback|rating|ratings|rated|satisfaction|satisfied|reviews?|best course|worst course|highest[ -]?rated|lowest[ -]?rated|top[ -]?rated|well[ -]?received)\b/i.test(prompt)) {
    try {
      const sum = require('../services/feedback').summary();
      const worst = /\b(worst|lowest|poor(?:est)?|bad|least|weak)\b/i.test(prompt);
      const list = (sum.courses || [])
        .filter((c) => c.overall != null && (c.responses || 0) > 0)
        .sort((a, b) => worst ? (a.overall - b.overall) : (b.overall - a.overall));
      if (list.length) {
        const r2v = (n) => Math.round(n * 100) / 100;
        const orbs = list.slice(0, 24).map((c) => ({
          label: c.course_name,
          sub: '★ ' + r2v(c.overall) + ' · ' + (c.responses || 0).toLocaleString() + ' ratings',
          count: Math.max(c.responses || 1, 1), kind: 'course', id: c.course_id || c.key,
          meta: { type: 'mandatory', rating: r2v(c.overall), overall: r2v(c.overall), responses: c.responses, provider: c.provider_name, years: c.years },
        }));
        return res.json({
          title: worst ? 'Lowest-rated courses' : 'Best-rated courses',
          entity: 'courses', count: orbs.length, orbs, feedback: true,
          summary: {
            kind: 'feedback', worst,
            coursesRated: sum.totals.courses_rated, responses: sum.totals.responses,
            top: list.slice(0, 6).map((c) => ({ name: c.course_name, overall: r2v(c.overall), responses: c.responses, provider: c.provider_name })),
          },
        });
      }
    } catch (_) { /* fall through to the generic entity query */ }
  }

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
        SELECT l.firm_id, l.id, COALESCE(l.lifetime_points,0) pts
        FROM lawyers l WHERE ${_PRACT} AND l.firm_id IS NOT NULL)
      SELECT f.id, f.name, COUNT(lp.id) lawyers,
        ROUND(100.0*SUM(CASE WHEN lp.pts>=16 THEN 1 ELSE 0 END)/COUNT(lp.id),1) compliancePct,
        SUM(CASE WHEN lp.pts<8 THEN 1 ELSE 0 END) critical
      FROM firms f JOIN lp ON lp.firm_id=f.id GROUP BY f.id HAVING lawyers>=1 ORDER BY lawyers DESC`).all();
  } catch (_) {}
  res.json({ firms, total: firms.length });
});

// GET /api/v1/admin/lawyers?band=critical|atrisk|compliant — practising lawyers
// (optionally filtered to a compliance band) for the cohort galaxy.
router.get('/lawyers', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  const year = String(cycleYear());
  const band = (req.query.band || '').toString();
  const limit = Math.min(1500, Math.max(1, parseInt(req.query.limit || '800', 10) || 800));
  let rows = [];
  try {
    rows = db.prepare(`SELECT l.id, l.first_name, l.last_name, fr.name firm,
      COALESCE(l.lifetime_points,0) pts
      FROM lawyers l LEFT JOIN firms fr ON fr.id=l.firm_id WHERE ${_PRACT}`).all();
  } catch (_) {}
  if (band === 'critical') rows = rows.filter((r) => r.pts < 8);
  else if (band === 'atrisk' || band === 'at-risk') rows = rows.filter((r) => r.pts >= 8 && r.pts < 16);
  else if (band === 'compliant') rows = rows.filter((r) => r.pts >= 16);
  const min = req.query.min != null && req.query.min !== '' ? parseInt(req.query.min, 10) : null;
  const max = req.query.max != null && req.query.max !== '' ? parseInt(req.query.max, 10) : null;
  if (min != null && !isNaN(min)) rows = rows.filter((r) => r.pts >= min);
  if (max != null && !isNaN(max)) rows = rows.filter((r) => r.pts <= max);
  const total = rows.length;
  res.json({ total, lawyers: rows.slice(0, limit).map((r) => ({ id: r.id, name: ((r.first_name || '') + ' ' + (r.last_name || '')).trim() || r.id, points: r.pts, firm: r.firm })) });
});

// GET /api/v1/admin/points-distribution — counts of practising lawyers in each
// CPD points tier, so the Lawyers world can show a moon per tier (critical → full).
router.get('/points-distribution', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  const year = String(cycleYear());
  let rows = [];
  try {
    rows = db.prepare(`SELECT COALESCE(l.lifetime_points,0) pts FROM lawyers l WHERE ${_PRACT}`).all();
  } catch (_) {}
  const buckets = [
    { key: 'lt4', label: 'Critical', sub: 'below 4 pts', min: 0, max: 3, count: 0 },
    { key: 'b4', label: '4–5 pts', sub: 'building', min: 4, max: 5, count: 0 },
    { key: 'b6', label: '6–7 pts', sub: 'building', min: 6, max: 7, count: 0 },
    { key: 'b8', label: '8–9 pts', sub: 'halfway', min: 8, max: 9, count: 0 },
    { key: 'b10', label: '10–11 pts', sub: 'on track', min: 10, max: 11, count: 0 },
    { key: 'b12', label: '12–13 pts', sub: 'nearly there', min: 12, max: 13, count: 0 },
    { key: 'b14', label: '14–15 pts', sub: 'almost done', min: 14, max: 15, count: 0 },
    { key: 'done', label: 'Completed', sub: '16 pts · full', min: 16, max: 99999, count: 0 },
  ];
  rows.forEach((r) => { const p = r.pts || 0; for (const b of buckets) { if (p >= b.min && p <= b.max) { b.count++; break; } } });
  res.json({ total: rows.length, buckets });
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
      COALESCE(l.lifetime_points,0) pts
    FROM lawyers l WHERE l.firm_id=? AND ${_PRACT}`, id);
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

// GET /api/v1/admin/feedback — full mandatory-course feedback dataset for the
// command centre: per-course and per-provider star ratings (combined + per
// year), with full per-metric distributions for drill-down. Trainer-free.
router.get('/feedback', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  try {
    res.json(require('../services/feedback').summary());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── CRM: 360° lawyer profile ────────────────────────────────────────
// Everything an administrator needs about one lawyer on a single screen:
// identity + compliance, their bookings (upcoming & past), credit wallet +
// ledger, CPD history, the conversations they've had with CLPD, and a merged
// recent-activity timeline. Admins see anyone; a firm CO sees only their firm.
router.get('/lawyer/:id', requireAuth, (req, res) => {
  const u = req.user;
  const lawyer = db.prepare(
    `SELECT l.*, f.name AS firm_name FROM lawyers l LEFT JOIN firms f ON f.id = l.firm_id WHERE l.id = ?`
  ).get(req.params.id);
  if (!lawyer) return res.status(404).json({ error: 'Lawyer not found' });
  const allowed = isAdmin(u) || (u.role === 'firm_compliance_officer' && u.firm_id === lawyer.firm_id);
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

  const all = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch (_) { return []; } };
  const one = (sql, ...a) => { try { return db.prepare(sql).get(...a); } catch (_) { return null; } };
  const email = (lawyer.email || '').toLowerCase();
  const pts = Number(lawyer.lifetime_points) || 0;
  const band = pts >= 16 ? 'compliant' : pts >= 8 ? 'at-risk' : 'critical';

  const bookings = all(
    `SELECT b.id, b.status, b.credits_used, b.points_earned, b.scheduled_at, b.booked_at, b.booked_by,
            COALESCE(b.course_title, c.title) AS course_title, c.type AS course_type, b.session_id, b.admin_notes
     FROM bookings b LEFT JOIN courses c ON c.id = b.course_id
     WHERE b.lawyer_id = ? ORDER BY COALESCE(b.scheduled_at, b.booked_at, b.created_at) DESC LIMIT 200`, lawyer.id);
  const nowIso = new Date().toISOString();
  const upcoming = bookings.filter((b) => b.scheduled_at && b.scheduled_at >= nowIso && !['cancelled', 'refunded'].includes((b.status || '').toLowerCase()));
  const past = bookings.filter((b) => !upcoming.includes(b));
  const attended = bookings.filter((b) => (b.status || '').toLowerCase() === 'attended').length;

  const transactions = all(
    `SELECT id, type, amount, aed_amount, description, status, created_at FROM credit_transactions
     WHERE lawyer_id = ? ORDER BY created_at DESC LIMIT 25`, lawyer.id);
  const cpd = all(
    `SELECT course_title, course_code, provider, points, created_at FROM cpd_records
     WHERE lawyer_id = ? OR LOWER(attendee_email) = ? ORDER BY created_at DESC LIMIT 50`, lawyer.id, email);

  const conversations = all(
    `SELECT c.id, c.subject, c.status, c.assigned_name, c.last_message_at, c.last_sender, c.created_at,
            (SELECT body FROM conversation_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) preview,
            (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id = c.id) msg_count
     FROM conversations c WHERE c.requester_type = 'lawyer' AND c.requester_id = ?
     ORDER BY c.last_message_at DESC LIMIT 50`, lawyer.id);
  const lastContact = conversations.length ? conversations[0].last_message_at : null;
  const openConvos = conversations.filter((c) => c.status === 'open' || c.status === 'pending').length;

  // Merged recent-activity timeline (newest first).
  const timeline = [];
  bookings.slice(0, 30).forEach((b) => timeline.push({ at: b.booked_at || b.scheduled_at, kind: 'booking', label: (b.status === 'attended' ? 'Attended' : 'Booked') + ' · ' + (b.course_title || 'course'), meta: { status: b.status, points: b.points_earned } }));
  transactions.slice(0, 30).forEach((t) => timeline.push({ at: t.created_at, kind: 'credit', label: (Number(t.amount) >= 0 ? 'Credited ' : 'Spent ') + Math.abs(Number(t.amount) || 0) + ' credits' + (t.description ? ' · ' + t.description : ''), meta: { aed: t.aed_amount } }));
  cpd.slice(0, 30).forEach((r) => timeline.push({ at: r.created_at, kind: 'cpd', label: '+' + (r.points || 0) + ' CPD · ' + (r.course_title || r.course_code), meta: { provider: r.provider } }));
  conversations.slice(0, 30).forEach((c) => timeline.push({ at: c.last_message_at, kind: 'message', label: 'Message · ' + (c.subject || 'conversation'), meta: { status: c.status } }));
  timeline.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

  res.json({
    lawyer: {
      id: lawyer.id, name: `${lawyer.first_name || ''} ${lawyer.last_name || ''}`.trim() || lawyer.id,
      first_name: lawyer.first_name, last_name: lawyer.last_name, email: lawyer.email, phone: lawyer.phone || '',
      role: lawyer.role || '', firm_id: lawyer.firm_id, firm_name: lawyer.firm_name || '',
      status: (lawyer.status || 'active'), unified_id: lawyer.unified_id || '', practice_areas: lawyer.practice_areas || '',
      joined: lawyer.created_at || null,
    },
    compliance: { points: pts, band, target: 16, remaining: Math.max(0, 16 - pts), year: new Date().getUTCFullYear() },
    credits: { balance: Number(lawyer.credit_balance) || 0, total_purchased: Number(lawyer.total_purchased) || 0, transactions },
    bookings: { total: bookings.length, attended, upcoming, past },
    cpd,
    messaging: { conversations, lastContact, open: openConvos },
    timeline: timeline.slice(0, 60),
  });
});

// POST /api/v1/admin/crm-summary { lawyer_id | firm_id } — a per-customer AI
// brief for the admin opening their record: status, risk, next best action.
router.post('/crm-summary', requireAuth, async (req, res, next) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admins only' });
  const store = require('../services/store');
  const b = req.body || {};
  let ctx = null, who = '';
  try {
    if ((b.lawyer_id || '').toString().trim()) {
      const l = store.getLawyerById(b.lawyer_id.toString().trim()) || {};
      const pts = Number(l.lifetime_points) || 0;
      let bookings = [], acts = [];
      try { bookings = db.prepare("SELECT course_title, status, scheduled_at FROM bookings WHERE lawyer_id = ? ORDER BY scheduled_at DESC LIMIT 8").all(l.id); } catch (_) {}
      try { acts = db.prepare('SELECT summary FROM activity_log WHERE lawyer_id = ? ORDER BY created_at DESC LIMIT 8').all(l.id); } catch (_) {}
      who = 'a Dubai lawyer';
      ctx = { name: `${l.first_name || ''} ${l.last_name || ''}`.trim(), firm: l.firm_name || l.firm_id || '', points: pts, needed: Math.max(0, 16 - pts),
        credits: Number(l.credit_balance) || 0, status: l.status || 'active', bookings, recentActivity: acts.map((a) => a.summary) };
    } else if ((b.firm_id || '').toString().trim()) {
      const fid = b.firm_id.toString().trim();
      const f = db.prepare('SELECT name FROM firms WHERE id = ?').get(fid) || {};
      const agg = db.prepare("SELECT COUNT(*) lawyers, SUM(CASE WHEN COALESCE(lifetime_points,0)<8 THEN 1 ELSE 0 END) critical, SUM(CASE WHEN COALESCE(lifetime_points,0)>=16 THEN 1 ELSE 0 END) compliant FROM lawyers WHERE firm_id = ?").get(fid) || {};
      let acts = []; try { acts = db.prepare('SELECT summary FROM activity_log WHERE firm_id = ? ORDER BY created_at DESC LIMIT 8').all(fid); } catch (_) {}
      who = 'a law firm';
      ctx = { firm: f.name || fid, lawyers: agg.lawyers || 0, critical: agg.critical || 0, compliant: agg.compliant || 0,
        compliancePct: agg.lawyers ? Math.round(100 * (agg.compliant || 0) / agg.lawyers) : 0, recentActivity: acts.map((a) => a.summary) };
    } else return res.status(400).json({ error: 'lawyer_id or firm_id is required.' });
  } catch (e) { return next(e); }
  if (!aimodel.configured()) return res.json({ summary: 'AI is not configured. Live snapshot: ' + JSON.stringify(ctx) });
  try {
    const system = 'You are Maryam, the CLPD CRM assistant. In 3–4 sentences brief an admin about to help ' + who
      + ': their CLPD compliance status and risk, what is going on recently, and the single most useful next action. Use ONLY the JSON with real numbers, warm and practical, plain text, no markdown.';
    const text = await aimodel.chat({ system, messages: [{ role: 'user', content: JSON.stringify(ctx) }], maxTokens: 300, temperature: 0.3 });
    res.json({ summary: text });
  } catch (e) { if (e.code === 'AIMODEL_ERROR') return res.status(502).json({ error: 'AiModel call failed' }); next(e); }
});

module.exports = router;