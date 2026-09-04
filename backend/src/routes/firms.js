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

// ─── Roster management helpers ───────────────────────────────────────
const crypto = require('crypto');
const now = () => new Date().toISOString();
const rid = (p) => p + '-' + crypto.randomBytes(5).toString('hex').toUpperCase();
function logActivity(a) {
  try {
    db.prepare(
      `INSERT INTO activity_log (id, firm_id, lawyer_id, kind, actor_type, actor_id, actor_name, summary, ref_type, ref_id, meta, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(rid('AC'), a.firm_id || null, a.lawyer_id || null, a.kind, a.actor_type || null, a.actor_id || null,
      a.actor_name || null, a.summary || null, a.ref_type || 'roster', a.ref_id || null,
      a.meta ? JSON.stringify(a.meta) : null, now());
  } catch (e) { log.error('activity_log_failed', { error: e.message }); }
}
function notifyLawyer(lawyerId, title, body, level, by) {
  try {
    db.prepare('INSERT INTO notifications (id, recipient_type, recipient_id, title, body, level, created_by) VALUES (?,?,?,?,?,?,?)')
      .run(rid('NT'), 'lawyer', lawyerId, title, body, level || 'info', by || 'LAD');
  } catch (e) { log.error('notify_failed', { error: e.message }); }
}
function firmName(id) { if (!id) return null; try { const f = db.prepare('SELECT name FROM firms WHERE id = ?').get(id); return f ? f.name : id; } catch (_) { return id; } }
function lawyerName(l) { return `${l.first_name || ''} ${l.last_name || ''}`.trim() || l.id; }
// The officer of the firm in the URL, or a LAD role. Everyone else is out.
function canManageRoster(u, firmId) {
  return isLADrole(u) || (u.role === 'firm_compliance_officer' && !!u.firm_id && u.firm_id === firmId);
}

// ─── Transfer requests (LAD decides) ─────────────────────────────────
// Registered before /:id so the literal path is not swallowed as a firm id.
function requestRow(r) {
  const l = store.getLawyerById(r.lawyer_id) || { id: r.lawyer_id };
  return {
    id: r.id, status: r.status, note: r.note, created_at: r.created_at,
    lawyer: { id: l.id, name: lawyerName(l), roll_number: l.roll_number || null },
    from_firm: r.from_firm_id ? { id: r.from_firm_id, name: firmName(r.from_firm_id) } : null,
    to_firm: { id: r.to_firm_id, name: firmName(r.to_firm_id) },
    requested_by_name: r.requested_by_name,
    decided_by_name: r.decided_by_name, decided_at: r.decided_at, decision_note: r.decision_note,
  };
}
// GET /api/v1/firms/roster-requests?status=pending — the Department's queue
router.get('/roster-requests', requireAuth, (req, res) => {
  if (!isLADrole(req.user)) return res.status(403).json({ error: 'Forbidden' });
  const status = (req.query.status || 'pending').toString();
  const rows = status === 'all'
    ? db.prepare('SELECT * FROM firm_roster_requests ORDER BY created_at DESC LIMIT 200').all()
    : db.prepare('SELECT * FROM firm_roster_requests WHERE status = ? ORDER BY created_at DESC LIMIT 200').all(status);
  res.json({ requests: rows.map(requestRow) });
});
// POST /api/v1/firms/roster-requests/:rid/decide  { approve: true|false, note }
router.post('/roster-requests/:rid/decide', requireAuth, (req, res) => {
  if (!isLADrole(req.user)) return res.status(403).json({ error: 'Forbidden' });
  const r = db.prepare('SELECT * FROM firm_roster_requests WHERE id = ?').get(req.params.rid);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  if (r.status !== 'pending') return res.status(409).json({ error: `This request was already ${r.status}.` });
  const approve = !!(req.body && req.body.approve === true);
  const note = String((req.body && req.body.note) || '').slice(0, 500) || null;
  const l = store.getLawyerById(r.lawyer_id);
  if (!l) return res.status(404).json({ error: 'Lawyer no longer on the roll' });
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare('UPDATE firm_roster_requests SET status = ?, decided_by = ?, decided_by_name = ?, decided_at = ?, decision_note = ? WHERE id = ?')
      .run(approve ? 'approved' : 'declined', req.user.sub, req.user.name || null, ts, note, r.id);
    if (approve) db.prepare('UPDATE lawyers SET firm_id = ?, updated_at = ? WHERE id = ?').run(r.to_firm_id, ts, l.id);
  });
  tx();
  const who = req.user.name || 'The Department';
  const toName = firmName(r.to_firm_id), fromName = firmName(r.from_firm_id) || 'no firm';
  logActivity({ firm_id: r.to_firm_id, lawyer_id: l.id, kind: approve ? 'roster_transfer_approved' : 'roster_transfer_declined',
    actor_type: 'admin', actor_id: req.user.sub, actor_name: req.user.name, ref_id: r.id,
    summary: `${who} ${approve ? 'approved' : 'declined'} the transfer of ${lawyerName(l)} from ${fromName} to ${toName}${note ? ' — ' + note : ''}`,
    meta: { from_firm_id: r.from_firm_id, to_firm_id: r.to_firm_id } });
  if (approve && r.from_firm_id) logActivity({ firm_id: r.from_firm_id, lawyer_id: l.id, kind: 'roster_removed', actor_type: 'admin', actor_id: req.user.sub, actor_name: req.user.name, ref_id: r.id,
    summary: `${lawyerName(l)} moved to ${toName} — transfer approved by ${who}` });
  notifyLawyer(l.id, approve ? `You have been moved to ${toName}` : 'A firm transfer request was declined',
    approve ? `The Department has approved ${toName}'s request to add you to its roster. Your CPD record is unchanged.`
            : `The Department declined ${toName}'s request to add you to its roster. You remain with ${fromName}.`,
    approve ? 'success' : 'info', who);
  res.json({ ok: true, status: approve ? 'approved' : 'declined', request: requestRow({ ...r, status: approve ? 'approved' : 'declined', decided_by_name: req.user.name, decided_at: ts, decision_note: note }) });
});

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

// ─── Roster: search the roll ─────────────────────────────────────────
// GET /api/v1/firms/:id/lawyers/search?q=  — find a lawyer to add.
// Returns the minimum a firm needs to recognise the right person and know
// what will happen if they add them. It does not say which other firm a
// lawyer is at, and it carries no CPD figures: that is another firm's data.
router.get('/:id/lawyers/search', requireAuth, (req, res) => {
  const u = req.user; const id = effectiveFirmId(u, req.params.id);
  if (!canManageRoster(u, id)) return res.status(403).json({ error: 'Forbidden' });
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json({ results: [], hint: 'Type at least three characters of a name, email or roll number.' });
  const like = '%' + q.replace(/[%_]/g, '') + '%';
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT id, first_name, last_name, email, roll_number, firm_id, status FROM lawyers
       WHERE COALESCE(LOWER(status),'active') NOT IN ('resigned','inactive','suspended')
         AND (first_name || ' ' || last_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR roll_number LIKE ?)
       ORDER BY last_name, first_name LIMIT 15`
    ).all(like, like, like, like);
  } catch (e) { log.error('roster_search_failed', { error: e.message }); }
  const pending = new Set(db.prepare("SELECT lawyer_id FROM firm_roster_requests WHERE to_firm_id = ? AND status = 'pending'").all(id).map((r) => r.lawyer_id));
  const mask = (e) => { if (!e) return null; const [a, d] = String(e).split('@'); return d ? a.slice(0, 2) + '…@' + d : null; };
  res.json({ results: rows.map((l) => {
    const affiliation = !l.firm_id ? 'none' : (l.firm_id === id ? 'own' : 'other');
    return { id: l.id, name: lawyerName(l), roll_number: l.roll_number || null, email_masked: mask(l.email),
      affiliation, pending_request: pending.has(l.id),
      action: affiliation === 'own' ? 'already_here' : affiliation === 'none' ? 'add' : (pending.has(l.id) ? 'requested' : 'request_transfer') };
  }) });
});

// GET /api/v1/firms/:id/lawyers/requests — this firm's outgoing transfer requests
router.get('/:id/lawyers/requests', requireAuth, (req, res) => {
  const u = req.user; const id = effectiveFirmId(u, req.params.id);
  if (!canManageRoster(u, id)) return res.status(403).json({ error: 'Forbidden' });
  const rows = db.prepare('SELECT * FROM firm_roster_requests WHERE to_firm_id = ? ORDER BY created_at DESC LIMIT 50').all(id);
  res.json({ requests: rows.map(requestRow) });
});

// ─── Roster: add ─────────────────────────────────────────────────────
// POST /api/v1/firms/:id/lawyers  { lawyer_id, note }
// Unaffiliated lawyer → joins now. Lawyer at another firm → a transfer
// request for the Department to decide. Nothing else changes a firm_id.
router.post('/:id/lawyers', requireAuth, (req, res) => {
  const u = req.user; const id = effectiveFirmId(u, req.params.id);
  if (!canManageRoster(u, id)) return res.status(403).json({ error: 'Forbidden' });
  const firm = store.getFirmById(id);
  if (!firm) return res.status(404).json({ error: 'Firm not found' });
  const lawyerId = String((req.body && req.body.lawyer_id) || '').trim();
  const note = String((req.body && req.body.note) || '').slice(0, 500) || null;
  if (!lawyerId) return res.status(400).json({ error: 'lawyer_id is required' });
  const l = store.getLawyerById(lawyerId);
  if (!l) return res.status(404).json({ error: 'No lawyer with that id is on the roll.' });
  const st = String(l.status || 'active').toLowerCase();
  if (['resigned', 'inactive', 'suspended'].includes(st)) return res.status(409).json({ error: `This lawyer is ${st} on the roll and cannot be added to a roster.` });
  if (l.firm_id === id) return res.status(409).json({ error: `${lawyerName(l)} is already on your roster.` });
  const actor = u.name || 'The compliance officer';
  const ts = now();
  if (!l.firm_id) {
    db.prepare('UPDATE lawyers SET firm_id = ?, updated_at = ? WHERE id = ?').run(id, ts, l.id);
    logActivity({ firm_id: id, lawyer_id: l.id, kind: 'roster_added', actor_type: 'requester', actor_id: u.sub, actor_name: u.name, ref_id: l.id,
      summary: `${actor} added ${lawyerName(l)} to ${firm.name}'s roster${note ? ' — ' + note : ''}` });
    notifyLawyer(l.id, `You have been added to ${firm.name}`, `${firm.name} has added you to its roster on the CLPD portal. Your CPD record is unchanged. If this is not right, contact the Department on 800 523.`, 'info', firm.name);
    return res.status(201).json({ ok: true, outcome: 'added', lawyer: lawyerRow(store.getLawyerById(l.id)) });
  }
  // At another firm: file a request, unless one is already open.
  const open = db.prepare("SELECT id FROM firm_roster_requests WHERE lawyer_id = ? AND to_firm_id = ? AND status = 'pending'").get(l.id, id);
  if (open) return res.status(409).json({ error: 'A transfer request for this lawyer is already with the Department.', request_id: open.id });
  const reqId = rid('RR');
  db.prepare(`INSERT INTO firm_roster_requests (id, lawyer_id, from_firm_id, to_firm_id, requested_by, requested_by_name, note, status, created_at)
              VALUES (?,?,?,?,?,?,?,'pending',?)`).run(reqId, l.id, l.firm_id, id, u.sub, u.name || null, note, ts);
  logActivity({ firm_id: id, lawyer_id: l.id, kind: 'roster_transfer_requested', actor_type: 'requester', actor_id: u.sub, actor_name: u.name, ref_id: reqId,
    summary: `${actor} asked the Department to move ${lawyerName(l)} from ${firmName(l.firm_id)} to ${firm.name}${note ? ' — ' + note : ''}`,
    meta: { from_firm_id: l.firm_id, to_firm_id: id } });
  res.status(202).json({ ok: true, outcome: 'transfer_requested', request_id: reqId,
    message: `${lawyerName(l)} is currently with another firm. Your request has gone to the Department for a decision; you will see the result under Pending requests.` });
});

// ─── Roster: remove ──────────────────────────────────────────────────
// DELETE /api/v1/firms/:id/lawyers/:lawyerId  { reason }
// Unlinks the lawyer from the firm. Their roll entry, CPD points, credits
// and history are untouched — only the affiliation changes, and the change
// is on the timeline with the reason the firm gave.
router.delete('/:id/lawyers/:lawyerId', requireAuth, (req, res) => {
  const u = req.user; const id = effectiveFirmId(u, req.params.id);
  if (!canManageRoster(u, id)) return res.status(403).json({ error: 'Forbidden' });
  const firm = store.getFirmById(id);
  if (!firm) return res.status(404).json({ error: 'Firm not found' });
  const l = store.getLawyerById(req.params.lawyerId);
  if (!l || l.firm_id !== id) return res.status(404).json({ error: 'That lawyer is not on your roster.' });
  const reason = String((req.body && req.body.reason) || '').slice(0, 500) || null;
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare('UPDATE lawyers SET firm_id = NULL, updated_at = ? WHERE id = ?').run(ts, l.id);
    // Any transfer request another firm had open for this lawyer is now moot.
    db.prepare("UPDATE firm_roster_requests SET status = 'cancelled', decided_at = ?, decision_note = 'Lawyer left the firm before a decision' WHERE lawyer_id = ? AND from_firm_id = ? AND status = 'pending'").run(ts, l.id, id);
  });
  tx();
  const actor = u.name || 'The compliance officer';
  logActivity({ firm_id: id, lawyer_id: l.id, kind: 'roster_removed', actor_type: isLADrole(u) ? 'admin' : 'requester', actor_id: u.sub, actor_name: u.name, ref_id: l.id,
    summary: `${actor} removed ${lawyerName(l)} from ${firm.name}'s roster${reason ? ' — ' + reason : ''}`, meta: { reason } });
  notifyLawyer(l.id, `You have been removed from ${firm.name}'s roster`, `${firm.name} has recorded that you are no longer with the firm. Your CPD record and points are unchanged. If this is not right, contact the Department on 800 523.`, 'warning', firm.name);
  res.json({ ok: true, outcome: 'removed', lawyer_id: l.id });
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
