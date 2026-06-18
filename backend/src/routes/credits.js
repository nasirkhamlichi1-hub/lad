'use strict';

// Credits API.
//   GET  /me               balance + ledger (lawyer) / own requests (others)
//   POST /buy              { credits } -> pending purchase request (PSP deferred)
//   GET  /requests         (admin) pending purchase requests
//   POST /confirm          (admin) { id } -> credit the buyer
//   POST /topup            (admin) { email, credits, note } -> grant credits
//   POST /assign           (firm CO/admin) { lawyerId, credits } -> grant to a lawyer
//
// Balances live on lawyers.credit_balance; every movement writes a
// credit_transactions row. Purchase requests live in credit_requests until a
// payment gateway is connected.

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const store = require('../services/store');
const { requireAuth } = require('../middleware/auth');

const ADMIN_ROLES = ['lad_admin', 'lad_intelligence', 'lad_super_admin', 'super_admin', 'dg'];
const isAdmin = (u) => !!u && ADMIN_ROLES.includes(u.role);
const PRICE = Number(process.env.CREDIT_PRICE_AED || 120); // AED per credit
const rid = (p) => p + crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8);

function lawyerOf(req) {
  if (req.user.user_type === 'lawyer') return store.getLawyerById(req.user.sub);
  if (req.user.email) return store.getLawyerByEmail(req.user.email);
  return null;
}
function ledger(lawyerId) {
  try {
    return db.prepare(
      `SELECT id, type, amount, aed_amount, description, status, created_at
       FROM credit_transactions WHERE lawyer_id = ? ORDER BY created_at DESC LIMIT 100`
    ).all(lawyerId);
  } catch (_) { return []; }
}
function ownRequests(email) {
  try {
    return db.prepare(
      `SELECT id, credits, aed_amount, status, created_at FROM credit_requests
       WHERE LOWER(email) = ? ORDER BY created_at DESC LIMIT 50`
    ).all((email || '').toLowerCase());
  } catch (_) { return []; }
}
// Apply a credit movement to a lawyer's balance + write a ledger row.
function grant(lawyer, credits, opts) {
  const amt = Math.round(Number(credits) || 0);
  if (!lawyer || !amt) return lawyer ? (Number(lawyer.credit_balance) || 0) : 0;
  db.prepare(
    `UPDATE lawyers SET credit_balance = COALESCE(credit_balance,0) + ?,
       total_purchased = COALESCE(total_purchased,0) + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(amt, amt > 0 ? amt : 0, lawyer.id);
  try {
    db.prepare(
      `INSERT INTO credit_transactions (id, lawyer_id, type, amount, aed_amount, description, payment_method, reference, status)
       VALUES (?,?,?,?,?,?,?,?, 'completed')`
    ).run(rid('TX-'), lawyer.id, (opts && opts.type) || 'purchase', amt,
      (opts && opts.aed) != null ? opts.aed : (amt * PRICE),
      (opts && opts.description) || 'Credit movement', (opts && opts.method) || 'admin', (opts && opts.reference) || null);
  } catch (_) {}
  const row = db.prepare('SELECT credit_balance FROM lawyers WHERE id = ?').get(lawyer.id);
  return row ? Number(row.credit_balance) || 0 : 0;
}

router.get('/me', requireAuth, (req, res) => {
  const lawyer = lawyerOf(req);
  const requests = ownRequests(req.user.email);
  if (lawyer) {
    return res.json({ balance: Number(lawyer.credit_balance) || 0, transactions: ledger(lawyer.id), requests, pricePerCredit: PRICE });
  }
  res.json({ balance: 0, transactions: [], requests, pricePerCredit: PRICE });
});

router.post('/buy', requireAuth, (req, res) => {
  const credits = Math.round(Number((req.body && (req.body.credits || req.body.amount)) || 0));
  if (credits <= 0) return res.status(400).json({ error: 'A positive credit amount is required.' });
  const email = (req.user.email || '').toLowerCase();
  const lawyer = lawyerOf(req);
  const id = rid('CR-');
  db.prepare(
    `INSERT INTO credit_requests (id, email, lawyer_id, credits, aed_amount, status, requested_by)
     VALUES (?,?,?,?,?, 'pending', ?)`
  ).run(id, email, lawyer ? lawyer.id : null, credits, credits * PRICE, email);
  res.status(201).json({ ok: true, requested: true, id, credits, aed: credits * PRICE,
    message: 'Purchase request received — LAD Admin will confirm your credits shortly.' });
});

router.get('/requests', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  res.json({ requests: db.prepare("SELECT * FROM credit_requests WHERE status = 'pending' ORDER BY created_at ASC").all(), pricePerCredit: PRICE });
});

router.post('/confirm', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  const id = (req.body && req.body.id) || '';
  const r = db.prepare('SELECT * FROM credit_requests WHERE id = ?').get(id);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  if (r.status !== 'pending') return res.status(400).json({ error: 'Already handled' });
  const lawyer = r.lawyer_id ? store.getLawyerById(r.lawyer_id) : store.getLawyerByEmail(r.email);
  let balance = null;
  if (lawyer) balance = grant(lawyer, r.credits, { type: 'purchase', aed: r.aed_amount, description: 'Credit purchase confirmed', method: 'admin' });
  db.prepare("UPDATE credit_requests SET status='confirmed', confirmed_by=?, confirmed_at=CURRENT_TIMESTAMP, lawyer_id=COALESCE(lawyer_id,?) WHERE id=?")
    .run(req.user.email || req.user.sub || 'admin', lawyer ? lawyer.id : null, id);
  res.json({ ok: true, credited: !!lawyer, balance, note: lawyer ? undefined : 'Confirmed, but no lawyer account matched the email — no balance updated.' });
});

router.post('/topup', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  const b = req.body || {};
  const email = (b.email || '').toString().trim().toLowerCase();
  const credits = Math.round(Number(b.credits || b.amount) || 0);
  if (!email || !credits) return res.status(400).json({ error: 'email and credits are required' });
  const lawyer = store.getLawyerByEmail(email);
  if (!lawyer) return res.status(404).json({ error: 'No lawyer account with that email' });
  const balance = grant(lawyer, credits, { type: credits >= 0 ? 'purchase' : 'refund', description: b.note || 'Administrator top-up', method: 'admin' });
  res.json({ ok: true, email, balance });
});

router.post('/assign', requireAuth, (req, res) => {
  const u = req.user;
  if (u.role !== 'firm_compliance_officer' && !isAdmin(u)) return res.status(403).json({ error: 'Firm officers or admins only' });
  const b = req.body || {};
  const lawyer = store.getLawyerById((b.lawyerId || b.id || '').toString());
  const credits = Math.round(Number(b.credits || b.amount) || 0);
  if (!lawyer || !credits) return res.status(400).json({ error: 'lawyerId and credits are required' });
  if (u.role === 'firm_compliance_officer' && lawyer.firm_id !== u.firm_id) return res.status(403).json({ error: 'That lawyer is not in your firm' });
  const balance = grant(lawyer, credits, { type: 'transfer', description: 'Assigned by firm', method: 'firm' });
  res.json({ ok: true, lawyerId: lawyer.id, balance });
});

module.exports = router;
