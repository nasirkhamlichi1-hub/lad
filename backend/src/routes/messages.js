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
  if (u.user_type === 'lawyer') {
    const l = store.getLawyerById(u.sub) || {};
    const name = `${l.first_name || ''} ${l.last_name || ''}`.trim() || u.name || u.email || 'Lawyer';
    return { type: 'lawyer', id: u.sub, name, email: l.email || u.email || null, firm_id: l.firm_id || u.firm_id || null };
  }
  if (u.role === 'firm_compliance_officer' && u.firm_id) {
    let firmName = u.firm_id;
    try { const f = db.prepare('SELECT name FROM firms WHERE id = ?').get(u.firm_id); if (f && f.name) firmName = f.name; } catch (_) {}
    return { type: 'firm', id: u.firm_id, name: firmName, email: u.email || null, firm_id: u.firm_id };
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

  // Notify the admin team by email (best-effort, queued).
  if (mailer) {
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

  // Email the other party (best-effort, queued).
  if (mailer) {
    try {
      if (side === 'admin' && c.requester_email) {
        const subj = `Reply from CLPD Admin — ${c.subject || c.id}`;
        const text = `CLPD Admin replied to your conversation "${c.subject || c.id}":\n\n${body}\n\nSign in to the CLPD portal to reply.`;
        mailer.enqueue({ to: c.requester_email, toName: c.requester_name, subject: subj, text, category: 'message', ref: c.id, dedupeKey: 'msg_reply:' + c.id + ':' + ts });
      } else if (side === 'requester') {
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
  const c = db.prepare('SELECT id FROM conversations WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Conversation not found' });
  const assigneeId = (req.body && (req.body.assigneeId || req.body.assigned_to) || '').toString().trim();
  if (!assigneeId) { // unassign
    db.prepare('UPDATE conversations SET assigned_to = NULL, assigned_name = NULL, updated_at = ? WHERE id = ?').run(now(), c.id);
    return res.json({ ok: true, assigned_to: null });
  }
  const a = db.prepare("SELECT id, first_name, last_name, role FROM staff WHERE id = ? AND role IN ('lad_admin','lad_intelligence','lad_super_admin','dg')").get(assigneeId);
  if (!a) return res.status(400).json({ error: 'Not a valid admin assignee.' });
  const name = `${a.first_name || ''} ${a.last_name || ''}`.trim();
  db.prepare("UPDATE conversations SET assigned_to = ?, assigned_name = ?, status = CASE WHEN status='open' THEN 'pending' ELSE status END, updated_at = ? WHERE id = ?")
    .run(a.id, name, now(), c.id);
  res.json({ ok: true, assigned_to: a.id, assigned_name: name });
});

// ─── Set status (admin only) ─────────────────────────────────────────
router.post('/conversations/:id/status', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admins only' });
  const c = db.prepare('SELECT id FROM conversations WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Conversation not found' });
  const status = (req.body && req.body.status || '').toString();
  if (!['open', 'pending', 'resolved', 'closed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), c.id);
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

module.exports = router;
