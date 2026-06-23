'use strict';

// ─────────────────────────────────────────────────────────────────────
// ADMIN USER MANAGEMENT
// ─────────────────────────────────────────────────────────────────────
// All routes here require an admin-tier role. Scoping rules:
//
//   lad_super_admin         — can do anything (create/edit/suspend any role
//                             including other admins, change roles, reset
//                             any password)
//   lad_admin               — can manage non-admin accounts only. Cannot
//                             create or modify lad_admin / lad_super_admin
//                             accounts, cannot promote a user into those.
//   firm_compliance_officer — scoped to lawyers within their own firm only.
//                             Cannot create staff roles. firm_id is forced
//                             to their own — client input ignored.
//
// All mutating routes log to audit_log so we can trace every account change.

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const store = require('../services/store');
const activity = require('../services/activity');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const passwords = require('../services/passwords');

// ─── Role rules ─────────────────────────────────────────────────────────
const ALL_ROLES = ['lawyer', 'firm_compliance_officer', 'lad_intelligence', 'lad_admin', 'lad_super_admin', 'provider_admin'];
const ADMIN_ROLES = ['lad_admin', 'lad_super_admin'];

// What roles can the actor create?
function rolesActorCanCreate(actor) {
  if (actor.role === 'lad_super_admin') return ALL_ROLES;
  if (actor.role === 'lad_admin') return ALL_ROLES.filter(r => !ADMIN_ROLES.includes(r));
  if (actor.role === 'firm_compliance_officer') return ['lawyer'];
  return [];
}

// Can the actor modify (edit/suspend/reset) the given target user?
function canActorTouch(actor, target) {
  if (actor.role === 'lad_super_admin') return true;
  if (actor.role === 'lad_admin') {
    // Cannot touch other admins
    return !ADMIN_ROLES.includes(target.role);
  }
  if (actor.role === 'firm_compliance_officer') {
    // Only lawyers in their firm
    return target.role === 'lawyer' && target.firm_id === actor.firm_id;
  }
  return false;
}

// ─── Helpers ────────────────────────────────────────────────────────────
function audit(actor, action, targetId, details) {
  try {
    db.prepare(`INSERT INTO audit_log (actor_id, actor_type, action, details, ip)
                VALUES (?, ?, ?, ?, ?)`)
      .run(actor.sub, actor.user_type || 'staff', action,
           JSON.stringify({ target_id: targetId, ...details }), null);
  } catch (e) {
    // Audit failures must not break the operation
    // eslint-disable-next-line no-console
    console.error('[audit] failed:', e.message);
  }
  // Mirror account actions into the unified, searchable activity log so they sit
  // alongside credits/bookings/accreditation and surface on the lawyer/firm
  // timeline. Best-effort; never breaks the operation.
  try {
    const act = String(action).replace(/^user\./, '');
    const kind = { create: 'account_create', suspend: 'account_suspend', reactivate: 'account_reactivate',
      password_reset: 'password_reset', update: 'account_update', delete: 'account_delete' }[act] || ('account_' + act);
    const d = details || {};
    let lawyer_id = null, firm_id = d.firm_id || null, who = '';
    if (/^L-/i.test(String(targetId))) {
      const l = store.getLawyerById(targetId);
      if (l) { lawyer_id = l.id; firm_id = firm_id || l.firm_id || null; who = `${l.first_name || ''} ${l.last_name || ''}`.trim() || l.email || l.id; }
    } else if (/^S-/i.test(String(targetId))) {
      try { const s = db.prepare('SELECT first_name, last_name, email FROM staff WHERE id = ?').get(targetId); if (s) who = `${s.first_name || ''} ${s.last_name || ''}`.trim() || s.email || targetId; } catch (_) {}
    }
    who = who || d.email || targetId;
    const summary = {
      account_create: `New account created — ${who}${d.role ? ` (${d.role})` : ''}`,
      account_suspend: `Account suspended — ${who}`,
      account_reactivate: `Account reactivated — ${who}`,
      password_reset: `Password reset issued — ${who}`,
      account_update: `Account updated — ${who}`,
      account_delete: `Account deleted — ${who}`,
    }[kind] || `Account ${act} — ${who}`;
    activity.logActivity(Object.assign({
      lawyer_id, firm_id, kind, category: 'account',
      tags: [d.role].filter(Boolean),
      summary, ref_type: 'user', ref_id: targetId, meta: d,
    }, activity.actorFrom(actor)));
  } catch (_) { /* never fatal */ }
}

function genStaffId() { return 'S-' + crypto.randomBytes(4).toString('hex').toUpperCase(); }
function genLawyerId() { return 'L-' + crypto.randomBytes(4).toString('hex').toUpperCase(); }

// Combined user row — abstracts over lawyers + staff tables for list views.
function rowToUser(r, source) {
  return {
    id: r.id,
    email: r.email,
    first_name: r.first_name,
    last_name: r.last_name,
    name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
    role: source === 'lawyer' ? 'lawyer' : r.role,
    firm_id: r.firm_id || null,
    roll_number: r.roll_number || null,
    phone: r.phone || null,
    status: r.status || 'active',
    must_change_password: !!r.must_change_password,
    last_login_at: r.last_login_at || null,
    password_changed_at: r.password_changed_at || null,
    created_at: r.created_at || null,
    user_type: source,
  };
}

// ─── GET /admin/users — list ────────────────────────────────────────────
// Query params: ?role=&firm_id=&status=&search=
// Firm CO is auto-scoped to their own firm regardless of query.
router.get('/', requireRole('lad_super_admin', 'lad_admin', 'firm_compliance_officer'), (req, res) => {
  const actor = req.user;
  const { role: roleFilter, firm_id: firmFilter, status: statusFilter, search } = req.query;

  // Build WHERE for lawyers
  const lawyerWhere = [];
  const lawyerParams = [];
  // Build WHERE for staff
  const staffWhere = [];
  const staffParams = [];

  // Firm CO is locked to their firm
  if (actor.role === 'firm_compliance_officer') {
    lawyerWhere.push('firm_id = ?');
    lawyerParams.push(actor.firm_id);
    // Firm CO sees no staff — return empty for staff side
    staffWhere.push('1 = 0');
  }

  if (firmFilter) {
    lawyerWhere.push('firm_id = ?'); lawyerParams.push(firmFilter);
    staffWhere.push('firm_id = ?'); staffParams.push(firmFilter);
  }
  if (statusFilter) {
    lawyerWhere.push('status = ?'); lawyerParams.push(statusFilter);
    staffWhere.push('status = ?'); staffParams.push(statusFilter);
  }
  if (search) {
    const q = `%${search.toLowerCase()}%`;
    // Lawyers are also searchable by their internal id and their roll/lawyer ID.
    lawyerWhere.push('(LOWER(email) LIKE ? OR LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ? OR LOWER(id) LIKE ? OR LOWER(COALESCE(roll_number,\'\')) LIKE ?)');
    lawyerParams.push(q, q, q, q, q);
    staffWhere.push('(LOWER(email) LIKE ? OR LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ? OR LOWER(id) LIKE ?)');
    staffParams.push(q, q, q, q);
  }

  // Role filter routes us to one table or the other (or both)
  const includeLawyers = !roleFilter || roleFilter === 'lawyer';
  const includeStaff   = !roleFilter || roleFilter !== 'lawyer';

  // lad_admin cannot see other admins in the list either
  if (actor.role === 'lad_admin' && includeStaff) {
    staffWhere.push("role NOT IN ('lad_admin','lad_super_admin')");
  }

  const out = [];

  if (includeLawyers) {
    const sql = `SELECT id, email, first_name, last_name, firm_id, roll_number, phone, status, last_login_at,
                        password_changed_at, must_change_password, created_at
                 FROM lawyers
                 ${lawyerWhere.length ? 'WHERE ' + lawyerWhere.join(' AND ') : ''}
                 ORDER BY created_at DESC
                 LIMIT 500`;
    const rows = db.prepare(sql).all(...lawyerParams);
    for (const r of rows) out.push(rowToUser(r, 'lawyer'));
  }

  if (includeStaff) {
    let staffRoleClause = '';
    if (roleFilter && roleFilter !== 'lawyer') {
      staffWhere.push('role = ?'); staffParams.push(roleFilter);
    }
    const sql = `SELECT id, email, first_name, last_name, role, firm_id, status, last_login_at,
                        password_changed_at, must_change_password, created_at
                 FROM staff
                 ${staffWhere.length ? 'WHERE ' + staffWhere.join(' AND ') : ''}
                 ORDER BY created_at DESC
                 LIMIT 500`;
    const rows = db.prepare(sql).all(...staffParams);
    for (const r of rows) out.push(rowToUser(r, 'staff'));
  }

  res.json({ users: out, count: out.length });
});

// ─── POST /admin/users — create ─────────────────────────────────────────
router.post('/', requireRole('lad_super_admin', 'lad_admin', 'firm_compliance_officer'), async (req, res) => {
  const actor = req.user;
  const body = req.body || {};
  const { role, email, first_name, last_name, password, must_change_password,
          roll_number, phone, emirates_id, nationality } = body;
  let { firm_id } = body;

  // Validate inputs
  if (!role || !email || !first_name || !last_name) {
    return res.status(400).json({ error: 'role, email, first_name, last_name are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const allowedRoles = rolesActorCanCreate(actor);
  if (!allowedRoles.includes(role)) {
    return res.status(403).json({ error: 'You cannot create users with this role', code: 'ROLE_NOT_ALLOWED', allowed: allowedRoles });
  }

  // Firm CO: force firm_id to their own
  if (actor.role === 'firm_compliance_officer') {
    firm_id = actor.firm_id;
  }

  // Lawyers and firm_compliance_officers require a firm
  if (['lawyer', 'firm_compliance_officer'].includes(role) && !firm_id) {
    return res.status(400).json({ error: 'firm_id is required for this role' });
  }

  // Generate password if not provided
  const finalPassword = (password && String(password).length >= 6)
    ? String(password)
    : passwords.generateReadable();

  const hash = bcrypt.hashSync(finalPassword, 12);
  const mustChange = must_change_password !== false; // default true

  // Check email isn't already used in either table
  const existingLawyer = db.prepare('SELECT id FROM lawyers WHERE LOWER(email) = LOWER(?)').get(email);
  const existingStaff  = db.prepare('SELECT id FROM staff   WHERE LOWER(email) = LOWER(?)').get(email);
  if (existingLawyer || existingStaff) {
    return res.status(409).json({ error: 'A user with this email already exists' });
  }

  try {
    if (role === 'lawyer') {
      const id = genLawyerId();
      db.prepare(`INSERT INTO lawyers
        (id, email, first_name, last_name, firm_id, roll_number, phone, emirates_id, nationality,
         password_hash, status, must_change_password, password_changed_at, created_by_id, created_by_type, credit_balance)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP, ?, ?, 0)`)
        .run(id, email, first_name, last_name, firm_id,
             roll_number || null, phone || null, emirates_id || null, nationality || null,
             hash, mustChange ? 1 : 0, actor.sub, actor.user_type || 'staff');
      audit(actor, 'user.create', id, { role, email, firm_id, roll_number });
      return res.status(201).json({
        user: { id, email, first_name, last_name, role, firm_id, roll_number: roll_number || null, status: 'active', must_change_password: mustChange },
        initial_password: finalPassword,  // shown ONCE to the admin; not stored anywhere
      });
    } else {
      const id = genStaffId();
      db.prepare(`INSERT INTO staff
        (id, email, first_name, last_name, role, firm_id, password_hash, status,
         must_change_password, password_changed_at, created_by_id, created_by_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP, ?, ?)`)
        .run(id, email, first_name, last_name, role, firm_id || null, hash, mustChange ? 1 : 0,
             actor.sub, actor.user_type || 'staff');
      audit(actor, 'user.create', id, { role, email, firm_id });
      return res.status(201).json({
        user: { id, email, first_name, last_name, role, firm_id, status: 'active', must_change_password: mustChange },
        initial_password: finalPassword,
      });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Failed to create user: ' + e.message });
  }
});

// Helper — fetch the target user from either table
function fetchTarget(id) {
  const lawyer = db.prepare(`SELECT id, email, first_name, last_name, firm_id, status,
                                    roll_number, phone, emirates_id, nationality,
                                    'lawyer' AS role, must_change_password
                             FROM lawyers WHERE id = ?`).get(id);
  if (lawyer) return { ...lawyer, _source: 'lawyer' };
  const staff = db.prepare(`SELECT id, email, first_name, last_name, firm_id, role, status,
                                   must_change_password
                            FROM staff WHERE id = ?`).get(id);
  if (staff) return { ...staff, _source: 'staff' };
  return null;
}

// ─── GET /admin/users/:id — one user's full detail (for the edit form) ──
router.get('/:id', requireRole('lad_super_admin', 'lad_admin', 'firm_compliance_officer'), (req, res) => {
  const actor = req.user;
  const target = fetchTarget(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (!canActorTouch(actor, target)) return res.status(403).json({ error: 'You cannot view this user' });
  const { _source, ...user } = target;
  res.json({ user: { ...user, user_type: _source } });
});

// ─── PATCH /admin/users/:id — update ────────────────────────────────────
router.patch('/:id', requireRole('lad_super_admin', 'lad_admin', 'firm_compliance_officer'), (req, res) => {
  const actor = req.user;
  const target = fetchTarget(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (!canActorTouch(actor, target)) return res.status(403).json({ error: 'You cannot modify this user' });

  const { first_name, last_name, email, firm_id, role,
          roll_number, phone, emirates_id, nationality } = req.body || {};
  const updates = {};
  if (first_name !== undefined) updates.first_name = first_name;
  if (last_name  !== undefined) updates.last_name = last_name;
  if (email      !== undefined) updates.email = email;
  if (firm_id    !== undefined) updates.firm_id = firm_id || null;
  // Lawyer-only profile fields (ignored for staff, whose table lacks them).
  if (target._source === 'lawyer') {
    if (roll_number !== undefined) updates.roll_number = roll_number || null;
    if (phone       !== undefined) updates.phone = phone || null;
    if (emirates_id !== undefined) updates.emirates_id = emirates_id || null;
    if (nationality !== undefined) updates.nationality = nationality || null;
  }

  // Role change — only super admin can change roles, and only into roles they're allowed to create
  if (role !== undefined && role !== target.role) {
    if (actor.role !== 'lad_super_admin') {
      return res.status(403).json({ error: 'Only super admin can change roles' });
    }
    if (target._source === 'lawyer' && role !== 'lawyer') {
      return res.status(400).json({ error: 'Cross-table role changes (lawyer → staff) are not supported. Suspend this account and create a new staff account instead.' });
    }
    if (target._source === 'staff' && role === 'lawyer') {
      return res.status(400).json({ error: 'Cross-table role changes (staff → lawyer) are not supported. Suspend this account and create a new lawyer account instead.' });
    }
    if (target._source === 'staff') updates.role = role;
  }

  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No changes provided' });

  const table = target._source === 'lawyer' ? 'lawyers' : 'staff';
  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  db.prepare(`UPDATE ${table} SET ${setClause} WHERE id = ?`).run(...values, target.id);
  audit(actor, 'user.update', target.id, updates);
  res.json({ ok: true, updates });
});

// ─── POST /admin/users/:id/reset-password ───────────────────────────────
// Generates a fresh password, returns it once (admin must copy + share).
router.post('/:id/reset-password', requireRole('lad_super_admin', 'lad_admin', 'firm_compliance_officer'), (req, res) => {
  const actor = req.user;
  const target = fetchTarget(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (!canActorTouch(actor, target)) return res.status(403).json({ error: 'You cannot reset this user\'s password' });

  const newPassword = passwords.generateReadable();
  const hash = bcrypt.hashSync(newPassword, 12);
  const table = target._source === 'lawyer' ? 'lawyers' : 'staff';
  db.prepare(`UPDATE ${table} SET password_hash = ?, must_change_password = 1,
                                  password_changed_at = CURRENT_TIMESTAMP
                            WHERE id = ?`).run(hash, target.id);
  audit(actor, 'user.password_reset', target.id, {});
  res.json({ ok: true, new_password: newPassword });
});

// ─── POST /admin/users/:id/suspend ──────────────────────────────────────
router.post('/:id/suspend', requireRole('lad_super_admin', 'lad_admin', 'firm_compliance_officer'), (req, res) => {
  const actor = req.user;
  const target = fetchTarget(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (!canActorTouch(actor, target)) return res.status(403).json({ error: 'You cannot suspend this user' });
  if (target.id === actor.sub) return res.status(400).json({ error: 'You cannot suspend your own account' });

  const table = target._source === 'lawyer' ? 'lawyers' : 'staff';
  db.prepare(`UPDATE ${table} SET status = 'suspended' WHERE id = ?`).run(target.id);
  audit(actor, 'user.suspend', target.id, {});
  res.json({ ok: true, status: 'suspended' });
});

// ─── POST /admin/users/:id/reactivate ───────────────────────────────────
router.post('/:id/reactivate', requireRole('lad_super_admin', 'lad_admin', 'firm_compliance_officer'), (req, res) => {
  const actor = req.user;
  const target = fetchTarget(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (!canActorTouch(actor, target)) return res.status(403).json({ error: 'You cannot reactivate this user' });

  const table = target._source === 'lawyer' ? 'lawyers' : 'staff';
  db.prepare(`UPDATE ${table} SET status = 'active' WHERE id = ?`).run(target.id);
  audit(actor, 'user.reactivate', target.id, {});
  res.json({ ok: true, status: 'active' });
});

// ─── GET /admin/users/firms — convenience for the Add User form ─────────
// Returns the list of firms the actor can assign to.
router.get('/firms/list', requireRole('lad_super_admin', 'lad_admin', 'firm_compliance_officer'), (req, res) => {
  const actor = req.user;
  if (actor.role === 'firm_compliance_officer') {
    const f = db.prepare('SELECT id, name FROM firms WHERE id = ?').get(actor.firm_id);
    return res.json({ firms: f ? [f] : [] });
  }
  const firms = db.prepare('SELECT id, name, trn FROM firms ORDER BY name').all();
  res.json({ firms });
});

// ─── GET /admin/users/firms/:id — firm account details (incl. TRN) ──────
router.get('/firms/:id', requireRole('lad_super_admin', 'lad_admin', 'firm_compliance_officer'), (req, res) => {
  const actor = req.user;
  if (actor.role === 'firm_compliance_officer' && actor.firm_id !== req.params.id) {
    return res.status(403).json({ error: 'You can only view your own firm' });
  }
  const f = db.prepare('SELECT id, name, full_name, abbreviation, trn, status FROM firms WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Firm not found' });
  res.json({ firm: f });
});

// ─── PATCH /admin/users/firms/:id — set a firm's TRN (and basics) ───────
router.patch('/firms/:id', requireRole('lad_super_admin', 'lad_admin', 'firm_compliance_officer'), (req, res) => {
  const actor = req.user;
  if (actor.role === 'firm_compliance_officer' && actor.firm_id !== req.params.id) {
    return res.status(403).json({ error: 'You can only edit your own firm' });
  }
  const f = db.prepare('SELECT id FROM firms WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Firm not found' });
  const { trn, name, full_name } = req.body || {};
  const updates = {};
  if (trn !== undefined) updates.trn = (trn || '').toString().trim() || null;
  // Only LAD admins can rename a firm; a firm CO may only set the TRN.
  if (actor.role !== 'firm_compliance_officer') {
    if (name !== undefined && String(name).trim()) updates.name = String(name).trim();
    if (full_name !== undefined) updates.full_name = (full_name || '').toString().trim() || null;
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No changes provided' });
  const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE firms SET ${setClause} WHERE id = ?`).run(...Object.values(updates), req.params.id);
  audit(actor, 'firm.update', req.params.id, updates);
  res.json({ ok: true, updates });
});

module.exports = router;
