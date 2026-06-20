'use strict';

// CRM follow-up tasks. Admins create tasks against a firm or lawyer, see what's
// due, and tick them off. Feeds the record's Tasks tab and the activity timeline.
//   GET   /api/v1/tasks?firm_id=&lawyer_id=&open=1   list
//   POST  /api/v1/tasks            { firm_id|lawyer_id, title, due_at }
//   PATCH /api/v1/tasks/:id        { done } | { title, due_at }

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const activity = require('../services/activity');

const ADMIN_ROLES = ['lad_admin', 'lad_intelligence', 'lad_super_admin', 'super_admin', 'dg'];
const isAdmin = (u) => !!u && ADMIN_ROLES.includes(u.role);
const tid = () => 'TK-' + crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 10);
const now = () => new Date().toISOString();
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

function rowOut(r) {
  return { id: r.id, firm_id: r.firm_id, lawyer_id: r.lawyer_id, title: r.title, due_at: r.due_at,
    done: !!r.done, done_at: r.done_at, created_by_name: r.created_by_name, assigned_to: r.assigned_to, created_at: r.created_at };
}

router.get('/', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admins only' });
  const firmId = (req.query.firm_id || '').toString().trim();
  const lawyerId = (req.query.lawyer_id || '').toString().trim();
  const openOnly = req.query.open === '1' || req.query.open === 'true';
  const where = []; const args = [];
  if (firmId) { where.push('firm_id = ?'); args.push(firmId); }
  if (lawyerId) { where.push('lawyer_id = ?'); args.push(lawyerId); }
  let sql = 'SELECT * FROM crm_tasks';
  if (where.length) sql += ' WHERE (' + where.join(' OR ') + ')';
  else sql += ' WHERE 1=1';
  if (openOnly) sql += ' AND done = 0';
  sql += ' ORDER BY done ASC, COALESCE(due_at, created_at) ASC LIMIT 200';
  let rows = [];
  try { rows = db.prepare(sql).all(...args); } catch (_) {}
  res.json({ tasks: rows.map(rowOut) });
});

router.post('/', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admins only' });
  const b = req.body || {};
  const firm_id = (b.firm_id || '').toString().trim() || null;
  const lawyer_id = (b.lawyer_id || '').toString().trim() || null;
  const title = clip(b.title, 300).trim();
  if (!firm_id && !lawyer_id) return res.status(400).json({ error: 'firm_id or lawyer_id is required.' });
  if (!title) return res.status(400).json({ error: 'A task title is required.' });
  const id = tid();
  db.prepare(`INSERT INTO crm_tasks (id, firm_id, lawyer_id, title, due_at, done, created_by, created_by_name, assigned_to, created_at)
              VALUES (?,?,?,?,?,0,?,?,?,?)`)
    .run(id, firm_id, lawyer_id, title, (b.due_at || '').toString() || null, req.user.sub, req.user.name || 'CLPD Admin', (b.assigned_to || req.user.sub), now());
  activity.logActivity({ firm_id, lawyer_id, kind: 'task', actor_type: 'admin', actor_id: req.user.sub, actor_name: req.user.name, ref_type: 'task', ref_id: id, summary: 'Task: ' + title + (b.due_at ? ' (due ' + String(b.due_at).slice(0, 10) + ')' : '') });
  res.status(201).json({ ok: true, id });
});

router.patch('/:id', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admins only' });
  const t = db.prepare('SELECT * FROM crm_tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const b = req.body || {};
  const sets = [], args = [];
  if (b.done !== undefined) { sets.push('done = ?', 'done_at = ?'); args.push(b.done ? 1 : 0, b.done ? now() : null); }
  if (b.title !== undefined) { sets.push('title = ?'); args.push(clip(b.title, 300)); }
  if (b.due_at !== undefined) { sets.push('due_at = ?'); args.push((b.due_at || '').toString() || null); }
  if (!sets.length) return res.status(400).json({ error: 'No updates supplied' });
  sets.push('updated_at = ?'); args.push(now()); args.push(req.params.id);
  db.prepare(`UPDATE crm_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  if (b.done) activity.logActivity({ firm_id: t.firm_id, lawyer_id: t.lawyer_id, kind: 'task', actor_type: 'admin', actor_id: req.user.sub, actor_name: req.user.name, ref_type: 'task', ref_id: t.id, summary: 'Completed task: ' + t.title });
  res.json({ ok: true });
});

module.exports = router;
