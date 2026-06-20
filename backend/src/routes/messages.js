'use strict';

// ─────────────────────────────────────────────────────────────────────
// Messaging — a support inbox between requesters (lawyers & firms) and the
// CLPD admin team.
//
//   POST   /conversations                 (lawyer/firm) open a conversation
//   GET    /conversations                 list — own (requester) or queue (admin)
//   GET    /conversations/:id             one conversation + its messages
//   POST   /conversations/:id/messages    post a reply (requester or admin)
//   POST   /conversations/:id/assign      (admin) assign to an admin on duty
//   POST   /conversations/:id/status      (admin) open | pending | resolved | closed
//   POST   /conversations/:id/read        mark read for the caller
//   GET    /admins                        (admin) admin team — for the assignment picker
//   GET    /unread                        unread badge count for the caller
//
// Only two requester↔admin pairs exist: lawyer↔CLPD admin and firm↔CLPD admin.
// A requester only ever sees their own conversations; the whole admin team sees
// every conversation and any admin can pick one up.
// ─────────────────────────────────────────────────────────────────────

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const store = require('../services/store');
const log = require('../logger');
const aimodel = require('../services/aimodel');
const { requireAuth } = require('../middleware/auth');

let mailer = null, tpl = null;
try { mailer = require('../services/email'); tpl = require('../services/email-templates'); } catch (_) {}

const ADMIN_ROLES = ['lad_admin', 'lad_intelligence', 'lad_super_admin', 'super_admin', 'dg'];
const isAdmin = (u) => !!u && ADMIN_ROLES.includes(u.role);
const cid = () => 'CV-' + crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 10);
const mid = () => 'CM-' + crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 10);
const now = () => new Date().toISOString();
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

// Resolve the requester identity for a lawyer or a firm compliance officer.
// Returns null for anyone who isn't allowed to open a conversation (e.g. admins,
// providers).
function requesterCtx(u) {
  if (!u) return null;
  if (u.user_type === 'lawyer' || u.role === 'lawyer') {
    const l = store.getLawyerById(u.sub) || (u.email ? store.getLawyerByEmail(u.email) : null) || {};
    const name = `${l.first_name || ''} ${l.last_name || ''}`.trim() || u.name || u.email || 'Lawyer';
    return { type: 'lawyer', id: u.sub, name, email: l.email || u.email || null, firm_id: l.firm_id || u.firm_id || null };
  }
  if (u.role === 'firm_compliance_officer' || u.user_type === 'firm') {
    // The firm_id usually rides in the token, but fall back to the staff record
    // so a CO whose token predates that claim can still message CLPD.
    let firmId = u.firm_id || null;
    if (!firmId) { try { const s = db.prepare('SELECT firm_id FROM staff WHERE id = ?').get(u.sub); if (s && s.firm_id) firmId = s.firm_id; } catch (_) {} }
    if (!firmId) return null;
    let firmName = firmId;
    try { const f = db.prepare('SELECT name FROM firms WHERE id = ?').get(firmId); if (f && f.name) firmName = f.name; } catch (_) {}
    return { type: 'firm', id: firmId, name: firmName, email: u.email || null, firm_id: firmId };
  }
  return null;
}

// Can this user see / act on this conversation?
function canSee(u, conv) {
  if (!conv) return false;
  if (isAdmin(u)) return true;
  const ctx = requesterCtx(u);
  return !!ctx && conv.requester_type === ctx.type && conv.requester_id === ctx.id;
}

function sideOf(u) { return isAdmin(u) ? 'admin' : 'requester'; }

function markRead(convId, readerId) {
  if (!convId || !readerId) return;
  try {
    db.prepare(
      `INSERT INTO conversation_reads (conversation_id, reader_id, last_read_at) VALUES (?,?,?)
       ON CONFLICT(conversation_id, reader_id) DO UPDATE SET last_read_at = excluded.last_read_at`
    ).run(convId, readerId, now());
  } catch (e) { log.error('conv_read_failed', { error: e.message }); }
}

function adminEmails() {
  try {
    return db.prepare(
      `SELECT email FROM staff WHERE COALESCE(status,'active')='active' AND role IN ('lad_admin','lad_intelligence','lad_super_admin','dg') AND email IS NOT NULL`
    ).all().map((r) => r.email).filter(Boolean);
  } catch (_) { return []; }
}

// Active CLPD admins who can own a conversation.
function adminStaff() {
  try {
    return db.prepare(
      `SELECT id, first_name, last_name, email, speciality FROM staff
       WHERE COALESCE(status,'active')='active' AND role IN ('lad_admin','lad_intelligence','lad_super_admin','dg')`
    ).all();
  } catch (_) { return []; }
}
function fullName(a) { return `${(a && a.first_name) || ''} ${(a && a.last_name) || ''}`.trim() || 'CLPD Admin'; }

const aid = () => 'AC-' + crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 12);

// One row per interaction — this is the CRM timeline.
function logActivity(a) {
  try {
    db.prepare(
      `INSERT INTO activity_log (id, firm_id, lawyer_id, kind, actor_type, actor_id, actor_name, summary, ref_type, ref_id, meta, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(aid(), a.firm_id || null, a.lawyer_id || null, a.kind, a.actor_type || null, a.actor_id || null,
      a.actor_name || null, a.summary || null, a.ref_type || 'conversation', a.ref_id || null,
      a.meta ? JSON.stringify(a.meta) : null, now());
  } catch (e) { log.error('activity_log_failed', { error: e.message }); }
}
// Which firm / lawyer a conversation belongs to.
function convScope(conv) {
  return {
    firm_id: conv.requester_type === 'firm' ? conv.requester_id : (conv.firm_id || null),
    lawyer_id: conv.requester_type === 'lawyer' ? conv.requester_id : null,
  };
}

// ─── Routing — give a conversation a single owner, not the whole team ──
function leastLoaded(cands) {
  let best = null, bestN = Infinity;
  for (const a of cands) {
    let n = 0;
    try { n = db.prepare("SELECT COUNT(*) n FROM conversations WHERE assigned_to = ? AND status IN ('open','pending')").get(a.id).n; } catch (_) {}
    if (n < bestN) { bestN = n; best = a; }
  }
  return best;
}
// The firm's account owner → a category specialist → the least-loaded admin on
// duty (round-robin). One owner per conversation; never the whole team.
function chooseAssignee(conv) {
  const admins = adminStaff();
  if (!admins.length) return null;
  const byId = (id) => admins.find((a) => a.id === id);
  const fid = conv.requester_type === 'firm' ? conv.requester_id : conv.firm_id;
  if (fid) {
    try { const f = db.prepare('SELECT account_owner FROM firms WHERE id = ?').get(fid); if (f && f.account_owner && byId(f.account_owner)) return byId(f.account_owner); } catch (_) {}
  }
  if (conv.category) {
    const specialists = admins.filter((a) => (a.speciality || '') === conv.category);
    if (specialists.length) return leastLoaded(specialists);
  }
  return leastLoaded(admins);
}

// ─── Maryam — AI first responder ─────────────────────────────────────
// When a lawyer or firm opens a conversation (or replies while it's still
// AI-handled and unassigned), Maryam attempts to help using their live CLPD
// context. If she can't, she escalates to a human and the admin team is paged.
const MARYAM = { id: 'maryam', name: 'Maryam · CLPD Assistant', role: 'assistant' };

function daysToDec31() {
  const t = new Date(); const d = new Date(Date.UTC(t.getUTCFullYear(), 11, 31));
  return Math.max(0, Math.ceil((d - t) / 86400000));
}

// Live grounding for the requester behind a conversation.
function requesterContext(conv) {
  try {
    if (conv.requester_type === 'lawyer') {
      const l = store.getLawyerById(conv.requester_id) || {};
      const points = Number(l.lifetime_points) || 0;
      let completed = [];
      try { completed = db.prepare('SELECT course_title FROM cpd_records WHERE lawyer_id = ? LIMIT 12').all(l.id || conv.requester_id).map((r) => r.course_title).filter(Boolean); } catch (_) {}
      return { who: 'a Dubai lawyer', name: conv.requester_name,
        firstName: l.first_name || 'there', points, needed: Math.max(0, 16 - points),
        creditBalance: Number(l.credit_balance) || 0, firm: l.firm_name || '', daysToDeadline: daysToDec31(), completedCourses: completed };
    }
    if (conv.requester_type === 'firm') {
      let agg = {};
      try {
        agg = db.prepare("SELECT COUNT(*) lawyers, SUM(CASE WHEN COALESCE(lifetime_points,0)<8 THEN 1 ELSE 0 END) critical, SUM(CASE WHEN COALESCE(lifetime_points,0)>=8 AND COALESCE(lifetime_points,0)<16 THEN 1 ELSE 0 END) atRisk, SUM(CASE WHEN COALESCE(lifetime_points,0)>=16 THEN 1 ELSE 0 END) compliant, COALESCE(SUM(credit_balance),0) pooledCredits FROM lawyers WHERE firm_id = ?").get(conv.requester_id) || {};
      } catch (_) {}
      return Object.assign({ who: 'a law-firm compliance officer', name: conv.requester_name, firm: conv.requester_name, daysToDeadline: daysToDec31() }, agg);
    }
  } catch (_) {}
  return { who: 'a CLPD user', name: conv.requester_name, daysToDeadline: daysToDec31() };
}

function maryamSystem(who) {
  return 'You are Maryam, the Dubai Legal Affairs Department (LAD) CLPD team\'s AI assistant and the FIRST responder in the support inbox. '
    + 'A ' + who + ' has messaged the CLPD team. Use ONLY the live context (JSON) with the real numbers — never invent figures. '
    + 'CLPD rules: practising lawyers need 16 CPD points by 31 December (<8 critical, 8–15 at risk, 16+ compliant); a course books with 5 credits. '
    + 'Answer warmly, directly and concisely in plain text (no markdown headings, no sign-off). '
    + 'Decide whether a human CLPD officer is needed. Set needsHuman=true when the request needs an action or decision you cannot take or verify — '
    + 'refunds, payments, credit adjustments, record/account changes, exemptions or extensions, complaints, accreditation decisions, or anything needing human judgement or data you do not have. '
    + 'Otherwise answer it fully yourself with needsHuman=false. '
    + 'Always classify the message. category is one of: compliance, credits, bookings, accreditation, technical, general. '
    + 'priority is one of: low, normal, high (use high for a missed/at-risk deadline, a complaint, or anything involving money). '
    + 'Reply with ONLY JSON: {"answer": string, "needsHuman": boolean, "category": string, "priority": string}. '
    + 'When needsHuman is true, make "answer" a short, reassuring note that you are bringing in a CLPD colleague who will follow up — do not promise specifics or timeframes.';
}

// Notify the ONE owner the work was routed to (fall back to the team only if we
// couldn't resolve an owner). This is what stops every message paging everyone.
function notifyAssignee(conv, body, owner) {
  if (!mailer) return;
  try {
    const subj = `CLPD message needs you — ${conv.requester_name}`;
    const text = `${conv.requester_name} (${conv.requester_type}) messaged CLPD and Maryam routed it to you.\n\n`
      + `Subject: ${conv.subject || '(no subject)'}\nCategory: ${conv.category || '—'} · Priority: ${conv.priority || 'normal'}\n\n${body}\n\nOpen the CLPD admin inbox to respond.`;
    const list = (owner && owner.email) ? [owner.email] : adminEmails();
    for (const to of list) if (to) mailer.enqueue({ to, subject: subj, text, category: 'message', ref: conv.id, dedupeKey: 'msg_escalate:' + conv.id + ':' + to + ':' + Date.now() });
  } catch (_) {}
}

// Run Maryam against a conversation in the background. Safe to call fire-and-forget.
async function runMaryam(convId, latestText) {
  let conv;
  try { conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId); } catch (_) { return; }
  if (!conv) return;
  // A human has taken over (assigned), or we've already handed off — stay quiet.
  if (conv.assigned_to || conv.escalated) return;

  const scope = convScope(conv);
  const CATS = ['compliance', 'credits', 'bookings', 'accreditation', 'technical', 'general'];

  // Hand off to a human: post Maryam's note (if any), tag the thread, route it to
  // ONE owner, notify only them, and record it on the CRM timeline.
  const escalate = (note, category, priority) => {
    let owner = null;
    const cat = CATS.includes(category) ? category : (conv.category || 'general');
    const pri = ['low', 'normal', 'high'].includes(priority) ? priority : (conv.priority || 'normal');
    try {
      const ts = now();
      if (note) db.prepare("INSERT INTO conversation_messages (id, conversation_id, sender_side, sender_id, sender_name, sender_role, body, created_at) VALUES (?,?,'admin',?,?,?,?,?)")
        .run(mid(), convId, MARYAM.id, MARYAM.name, MARYAM.role, note, ts);
      owner = chooseAssignee(Object.assign({}, conv, { category: cat }));
      db.prepare('UPDATE conversations SET escalated=1, ai_handled=1, category=?, priority=?, assigned_to=?, assigned_name=?, status=?, last_sender=?, last_message_at=?, updated_at=? WHERE id=?')
        .run(cat, pri, owner ? owner.id : null, owner ? fullName(owner) : null, 'pending',
          note ? 'admin' : conv.last_sender, note ? ts : conv.last_message_at, ts, convId);
      logActivity({ ...scope, kind: 'escalation', actor_type: 'ai', actor_id: MARYAM.id, actor_name: MARYAM.name, ref_id: convId,
        summary: `Maryam escalated "${conv.subject || ''}"` + (owner ? ` → ${fullName(owner)}` : '') + ` · ${cat}/${pri}`,
        meta: { category: cat, priority: pri, assignee: owner && owner.id } });
      if (owner) logActivity({ ...scope, kind: 'assignment', actor_type: 'ai', actor_id: MARYAM.id, actor_name: MARYAM.name, ref_id: convId, summary: `Routed to ${fullName(owner)}` });
    } catch (e) { log.error('maryam_escalate_failed', { error: e.message }); }
    notifyAssignee(Object.assign({}, conv, { category: cat, priority: pri }), latestText || conv.subject || '', owner);
  };

  if (!aimodel.configured()) { escalate(null); return; }

  let parsed = null;
  try {
    const ctx = requesterContext(conv);
    let history = [];
    try { history = db.prepare('SELECT sender_side, sender_name, body FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC').all(convId).slice(-6); } catch (_) {}
    const convo = history.map((m) => (m.sender_side === 'admin' ? 'CLPD' : (m.sender_name || 'User')) + ': ' + m.body).join('\n');
    const text = await aimodel.chat({
      system: maryamSystem(ctx.who),
      messages: [{ role: 'user', content: 'Live context:\n' + JSON.stringify(ctx) + '\n\nConversation so far:\n' + (convo || '(none)') + '\n\nRespond to the latest message.' }],
      maxTokens: 480, temperature: 0.3,
    });
    try { const m = text.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : text); } catch (_) { parsed = { answer: text, needsHuman: false }; }
  } catch (e) {
    log.error('maryam_call_failed', { error: e.message });
    escalate(null); // AI unreachable → hand to a human so nothing is dropped
    return;
  }

  const answer = (parsed && (parsed.answer || parsed.reply) || '').toString().trim();
  const needsHuman = !!(parsed && parsed.needsHuman);
  const category = (parsed && parsed.category || '').toString().toLowerCase().trim();
  const priority = (parsed && parsed.priority || 'normal').toString().toLowerCase().trim();

  // No answer, or a human is needed → escalate (this also posts Maryam's note).
  if (!answer || needsHuman) { escalate(answer || null, category, priority); return; }

  // Maryam resolved it herself — record the reply, no human paged.
  const cat = CATS.includes(category) ? category : 'general';
  try {
    const ts = now();
    db.prepare("INSERT INTO conversation_messages (id, conversation_id, sender_side, sender_id, sender_name, sender_role, body, created_at) VALUES (?,?,'admin',?,?,?,?,?)")
      .run(mid(), convId, MARYAM.id, MARYAM.name, MARYAM.role, answer, ts);
    db.prepare('UPDATE conversations SET ai_handled=1, escalated=0, category=?, priority=?, status=?, last_sender=?, last_message_at=?, updated_at=? WHERE id=?')
      .run(cat, ['low', 'normal', 'high'].includes(priority) ? priority : 'normal', 'pending', 'admin', ts, ts, convId);
    logActivity({ ...scope, kind: 'ai_reply', actor_type: 'ai', actor_id: MARYAM.id, actor_name: MARYAM.name, ref_id: convId, summary: `Maryam answered "${conv.subject || ''}" · ${cat}` });
  } catch (e) { log.error('maryam_reply_failed', { error: e.message }); }
}

function scheduleMaryam(convId, latestText) {
  setImmediate(() => { runMaryam(convId, latestText).catch((e) => log.error('maryam_bg_failed', { error: e.message })); });
}

// ─── Create a conversation (lawyer / firm) ───────────────────────────
router.post('/conversations', requireAuth, (req, res) => {
  const ctx = requesterCtx(req.user);
  if (!ctx) return res.status(403).json({ error: 'Only lawyers and firms can open a conversation with CLPD Admin.' });
  const b = req.body || {};
  const subject = clip(b.subject, 200).trim();
  const body = clip(b.body || b.message, 5000).trim();
  if (!body) return res.status(400).json({ error: 'A message is required.' });

  const id = cid();
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO conversations (id, subject, requester_type, requester_id, requester_name, requester_email, firm_id, status, created_by, created_at, updated_at, last_message_at, last_sender)
       VALUES (?,?,?,?,?,?,?, 'open', ?, ?, ?, ?, 'requester')`
    ).run(id, subject || '(no subject)', ctx.type, ctx.id, ctx.name, ctx.email, ctx.firm_id, req.user.sub, ts, ts, ts);
    db.prepare(
      `INSERT INTO conversation_messages (id, conversation_id, sender_side, sender_id, sender_name, sender_role, body, created_at)
       VALUES (?,?, 'requester', ?, ?, ?, ?, ?)`
    ).run(mid(), id, req.user.sub, ctx.name, req.user.role, body, ts);
  });
  tx();
  markRead(id, req.user.sub);
  logActivity({
    firm_id: ctx.type === 'firm' ? ctx.id : ctx.firm_id, lawyer_id: ctx.type === 'lawyer' ? ctx.id : null,
    kind: 'message_in', actor_type: 'requester', actor_id: ctx.id, actor_name: ctx.name, ref_id: id,
    summary: `${ctx.name} opened "${subject || '(no subject)'}"`,
  });

  // Maryam answers first; if she can't, she escalates and pages the team. When
  // the AI isn't configured, fall back to paging the admins straight away so a
  // human always gets it.
  if (aimodel.configured()) {
    scheduleMaryam(id, body);
  } else if (mailer) {
    try {
      const subj = `New CLPD message from ${ctx.name}`;
      const text = `${ctx.name} (${ctx.type}) opened a conversation:\n\nSubject: ${subject || '(no subject)'}\n\n${body}\n\nReply from the CLPD admin inbox.`;
      for (const to of adminEmails()) mailer.enqueue({ to, subject: subj, text, category: 'message', ref: id, dedupeKey: 'msg_new:' + id + ':' + to });
    } catch (_) {}
  }

  res.status(201).json({ ok: true, id, conversation: getConversation(id, req.user) });
});

// ─── List conversations ──────────────────────────────────────────────
router.get('/conversations', requireAuth, (req, res) => {
  const admin = isAdmin(req.user);
  const mySide = sideOf(req.user);
  const reader = req.user.sub;
  let rows = [];
  try {
    if (admin) {
      const status = (req.query.status || '').toString();
      const box = (req.query.box || '').toString(); // mine | unassigned | all
      const where = ['1=1']; const args = [];
      if (status && status !== 'all') { where.push('c.status = ?'); args.push(status); }
      if (box === 'mine') { where.push('c.assigned_to = ?'); args.push(reader); }
      else if (box === 'unassigned') { where.push('c.assigned_to IS NULL'); }
      rows = db.prepare(
        `SELECT c.*, (SELECT body FROM conversation_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) last_body,
                r.last_read_at
         FROM conversations c LEFT JOIN conversation_reads r ON r.conversation_id = c.id AND r.reader_id = ?
         WHERE ${where.join(' AND ')} ORDER BY c.last_message_at DESC LIMIT 300`
      ).all(reader, ...args);
    } else {
      const ctx = requesterCtx(req.user);
      if (!ctx) return res.json({ conversations: [], unread: 0 });
      rows = db.prepare(
        `SELECT c.*, (SELECT body FROM conversation_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) last_body,
                r.last_read_at
         FROM conversations c LEFT JOIN conversation_reads r ON r.conversation_id = c.id AND r.reader_id = ?
         WHERE c.requester_type = ? AND c.requester_id = ? ORDER BY c.last_message_at DESC LIMIT 200`
      ).all(reader, ctx.type, ctx.id);
    }
  } catch (e) { log.error('conv_list_failed', { error: e.message }); }

  let unread = 0;
  const conversations = rows.map((c) => {
    const isUnread = c.last_sender !== mySide && (!c.last_read_at || c.last_read_at < c.last_message_at);
    if (isUnread) unread++;
    return {
      id: c.id, subject: c.subject, status: c.status,
      requester_type: c.requester_type, requester_id: c.requester_id, requester_name: c.requester_name,
      firm_id: c.firm_id, assigned_to: c.assigned_to, assigned_name: c.assigned_name,
      last_message_at: c.last_message_at, last_sender: c.last_sender,
      preview: clip(c.last_body, 140), unread: isUnread,
      ai_handled: !!c.ai_handled, escalated: !!c.escalated, category: c.category || null, priority: c.priority || 'normal',
    };
  });
  res.json({ conversations, unread, admin });
});

// ─── One conversation + messages ─────────────────────────────────────
function getConversation(id, u) {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!c) return null;
  const messages = db.prepare(
    'SELECT id, sender_side, sender_id, sender_name, sender_role, body, created_at FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(id);
  return {
    id: c.id, subject: c.subject, status: c.status,
    requester_type: c.requester_type, requester_id: c.requester_id, requester_name: c.requester_name, requester_email: c.requester_email,
    firm_id: c.firm_id, assigned_to: c.assigned_to, assigned_name: c.assigned_name,
    ai_handled: !!c.ai_handled, escalated: !!c.escalated, category: c.category || null, priority: c.priority || 'normal',
    created_at: c.created_at, last_message_at: c.last_message_at, last_sender: c.last_sender,
    messages,
  };
}

router.get('/conversations/:id', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Conversation not found' });
  if (!canSee(req.user, c)) return res.status(403).json({ error: 'Forbidden' });
  markRead(c.id, req.user.sub);
  res.json({ conversation: getConversation(c.id, req.user) });
});

// ─── Post a reply ────────────────────────────────────────────────────
router.post('/conversations/:id/messages', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Conversation not found' });
  if (!canSee(req.user, c)) return res.status(403).json({ error: 'Forbidden' });
  const body = clip((req.body && (req.body.body || req.body.message)) || '', 5000).trim();
  if (!body) return res.status(400).json({ error: 'A message is required.' });

  const side = sideOf(req.user);
  const senderName = req.user.name || (side === 'admin' ? 'CLPD Admin' : c.requester_name) || 'User';
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO conversation_messages (id, conversation_id, sender_side, sender_id, sender_name, sender_role, body, created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(mid(), c.id, side, req.user.sub, senderName, req.user.role, body, ts);
    // A new message reopens a resolved/closed thread; otherwise status is kept.
    const reopen = (c.status === 'resolved' || c.status === 'closed');
    db.prepare('UPDATE conversations SET last_message_at = ?, updated_at = ?, last_sender = ?, status = CASE WHEN ? THEN ? ELSE status END WHERE id = ?')
      .run(ts, ts, side, reopen ? 1 : 0, side === 'admin' ? 'pending' : 'open', c.id);
  });
  tx();
  markRead(c.id, req.user.sub);
  logActivity({ ...convScope(c), kind: side === 'admin' ? 'reply_out' : 'message_in',
    actor_type: side === 'admin' ? 'admin' : 'requester', actor_id: req.user.sub, actor_name: senderName, ref_id: c.id,
    summary: `${senderName} replied on "${c.subject || ''}"` });

  // While a thread is still Maryam's (unassigned, not yet escalated) she fields
  // the requester's replies too; the admins are only paged if she escalates.
  const maryamWillHandle = side === 'requester' && aimodel.configured() && !c.assigned_to && !c.escalated;
  if (maryamWillHandle) scheduleMaryam(c.id, body);

  // Email the other party (best-effort, queued).
  if (mailer) {
    try {
      if (side === 'admin' && c.requester_email) {
        const subj = `Reply from CLPD Admin — ${c.subject || c.id}`;
        const text = `CLPD Admin replied to your conversation "${c.subject || c.id}":\n\n${body}\n\nSign in to the CLPD portal to reply.`;
        mailer.enqueue({ to: c.requester_email, toName: c.requester_name, subject: subj, text, category: 'message', ref: c.id, dedupeKey: 'msg_reply:' + c.id + ':' + ts });
      } else if (side === 'requester' && !maryamWillHandle) {
        const subj = `New reply on CLPD conversation from ${c.requester_name}`;
        const text = `${c.requester_name} replied on "${c.subject || c.id}":\n\n${body}\n\nOpen the CLPD admin inbox to respond.`;
        const targets = c.assigned_to ? (db.prepare('SELECT email FROM staff WHERE id = ?').get(c.assigned_to) || {}).email : null;
        const list = targets ? [targets] : adminEmails();
        for (const to of list) if (to) mailer.enqueue({ to, subject: subj, text, category: 'message', ref: c.id, dedupeKey: 'msg_reply:' + c.id + ':' + ts + ':' + to });
      }
    } catch (_) {}
  }

  res.status(201).json({ ok: true, conversation: getConversation(c.id, req.user) });
});

// ─── Assign to an admin (admin only) ─────────────────────────────────
router.post('/conversations/:id/assign', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admins only' });
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Conversation not found' });
  const assigneeId = (req.body && (req.body.assigneeId || req.body.assigned_to) || '').toString().trim();
  if (!assigneeId) { // unassign
    db.prepare('UPDATE conversations SET assigned_to = NULL, assigned_name = NULL, updated_at = ? WHERE id = ?').run(now(), c.id);
    logActivity({ ...convScope(c), kind: 'assignment', actor_type: 'admin', actor_id: req.user.sub, actor_name: req.user.name, ref_id: c.id, summary: `${req.user.name || 'An admin'} unassigned "${c.subject || ''}"` });
    return res.json({ ok: true, assigned_to: null });
  }
  const a = db.prepare("SELECT id, first_name, last_name, role FROM staff WHERE id = ? AND role IN ('lad_admin','lad_intelligence','lad_super_admin','dg')").get(assigneeId);
  if (!a) return res.status(400).json({ error: 'Not a valid admin assignee.' });
  const name = `${a.first_name || ''} ${a.last_name || ''}`.trim();
  db.prepare("UPDATE conversations SET assigned_to = ?, assigned_name = ?, status = CASE WHEN status='open' THEN 'pending' ELSE status END, updated_at = ? WHERE id = ?")
    .run(a.id, name, now(), c.id);
  logActivity({ ...convScope(c), kind: 'assignment', actor_type: 'admin', actor_id: req.user.sub, actor_name: req.user.name, ref_id: c.id, summary: `${req.user.name || 'An admin'} assigned "${c.subject || ''}" → ${name}` });
  res.json({ ok: true, assigned_to: a.id, assigned_name: name });
});

// ─── Set status (admin only) ─────────────────────────────────────────
router.post('/conversations/:id/status', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admins only' });
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Conversation not found' });
  const status = (req.body && req.body.status || '').toString();
  if (!['open', 'pending', 'resolved', 'closed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), c.id);
  logActivity({ ...convScope(c), kind: 'status_change', actor_type: 'admin', actor_id: req.user.sub, actor_name: req.user.name, ref_id: c.id, summary: `${req.user.name || 'An admin'} marked "${c.subject || ''}" ${status}`, meta: { from: c.status, to: status } });
  res.json({ ok: true, status });
});

// ─── Mark read ───────────────────────────────────────────────────────
router.post('/conversations/:id/read', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Conversation not found' });
  if (!canSee(req.user, c)) return res.status(403).json({ error: 'Forbidden' });
  markRead(c.id, req.user.sub);
  res.json({ ok: true });
});

// ─── Admin team (for the assignment picker) ──────────────────────────
router.get('/admins', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admins only' });
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT id, first_name, last_name, role FROM staff
       WHERE COALESCE(status,'active')='active' AND role IN ('lad_admin','lad_intelligence','lad_super_admin','dg')
       ORDER BY first_name, last_name`
    ).all();
  } catch (_) {}
  res.json({ admins: rows.map((a) => ({ id: a.id, name: `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.id, role: a.role })) });
});

// ─── Unread badge count ──────────────────────────────────────────────
router.get('/unread', requireAuth, (req, res) => {
  const mySide = sideOf(req.user);
  const reader = req.user.sub;
  let count = 0, mine = 0;
  try {
    let rows;
    if (isAdmin(req.user)) {
      rows = db.prepare(
        `SELECT c.last_sender, c.last_message_at, c.assigned_to, r.last_read_at
         FROM conversations c LEFT JOIN conversation_reads r ON r.conversation_id = c.id AND r.reader_id = ?
         WHERE c.status != 'closed'`
      ).all(reader);
    } else {
      const ctx = requesterCtx(req.user);
      rows = ctx ? db.prepare(
        `SELECT c.last_sender, c.last_message_at, c.assigned_to, r.last_read_at
         FROM conversations c LEFT JOIN conversation_reads r ON r.conversation_id = c.id AND r.reader_id = ?
         WHERE c.requester_type = ? AND c.requester_id = ?`
      ).all(reader, ctx.type, ctx.id) : [];
    }
    for (const c of rows) {
      const unread = c.last_sender !== mySide && (!c.last_read_at || c.last_read_at < c.last_message_at);
      if (unread) { count++; if (c.assigned_to === reader) mine++; }
    }
  } catch (e) { log.error('conv_unread_failed', { error: e.message }); }
  res.json({ unread: count, mine });
});

// ─── CRM timeline — every recorded interaction for a firm or a lawyer ────
// GET /activity?firm_id=…  or  ?lawyer_id=…   (admin only)
router.get('/activity', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admins only' });
  const firmId = (req.query.firm_id || '').toString().trim();
  const lawyerId = (req.query.lawyer_id || '').toString().trim();
  if (!firmId && !lawyerId) return res.status(400).json({ error: 'firm_id or lawyer_id is required.' });
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
  let rows = [];
  try {
    const where = []; const args = [];
    if (firmId) { where.push('firm_id = ?'); args.push(firmId); }
    if (lawyerId) { where.push('lawyer_id = ?'); args.push(lawyerId); }
    rows = db.prepare(
      `SELECT id, firm_id, lawyer_id, kind, actor_type, actor_id, actor_name, summary, ref_type, ref_id, meta, created_at
       FROM activity_log WHERE ${where.join(' OR ')} ORDER BY created_at DESC LIMIT ?`
    ).all(...args, limit);
  } catch (e) { log.error('activity_list_failed', { error: e.message }); }
  res.json({ activity: rows.map((r) => ({ ...r, meta: (() => { try { return r.meta ? JSON.parse(r.meta) : null; } catch (_) { return null; } })() })) });
});

// POST /activity — an admin logs a note against a firm or lawyer (CRM note).
router.post('/activity', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admins only' });
  const b = req.body || {};
  const firm_id = (b.firm_id || '').toString().trim() || null;
  const lawyer_id = (b.lawyer_id || '').toString().trim() || null;
  const summary = clip(b.summary || b.note || '', 1000).trim();
  if (!firm_id && !lawyer_id) return res.status(400).json({ error: 'firm_id or lawyer_id is required.' });
  if (!summary) return res.status(400).json({ error: 'A note is required.' });
  logActivity({ firm_id, lawyer_id, kind: (b.kind || 'note'), actor_type: 'admin', actor_id: req.user.sub, actor_name: req.user.name || 'CLPD Admin', ref_type: 'note', ref_id: null, summary });
  res.status(201).json({ ok: true });
});

module.exports = router;
