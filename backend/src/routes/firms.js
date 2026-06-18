'use strict';

const express = require('express');
const router = express.Router();
const store = require('../services/store');
const db = require('../db');
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

module.exports = router;
