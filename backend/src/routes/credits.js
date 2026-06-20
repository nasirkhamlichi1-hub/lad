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
const mailer = require('../services/email');
const tpl = require('../services/email-templates');
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

// POST /credits/checkout — instant card purchase. Credits the lawyer's balance
// immediately (simulated PSP authorisation) so they can buy mid-booking and
// continue. Records a completed purchase transaction for the ledger/audit.
router.post('/checkout', requireAuth, (req, res) => {
  const lawyer = lawyerOf(req);
  if (!lawyer) return res.status(404).json({ error: 'No lawyer account for this user.' });
  const credits = Math.round(Number((req.body && (req.body.credits || req.body.amount)) || 0));
  if (!Number.isFinite(credits) || credits <= 0 || credits > 100000) return res.status(400).json({ error: 'A valid credit amount is required.' });
  const aed = credits * PRICE; // never trust a client-supplied amount
  const reference = rid('PAY-');
  const balance = grant(lawyer, credits, {
    type: 'purchase', aed, method: 'card', reference,
    description: `Card purchase — ${credits} credits`,
  });
  if (lawyer.email) {
    mailer.send('credit_purchase', tpl.creditPurchase({
      name: tpl.fullName(lawyer.first_name, lawyer.last_name), credits, aed, balance, reference, scope: 'lawyer',
    }), { to: lawyer.email, toName: tpl.fullName(lawyer.first_name, lawyer.last_name), ref: reference, dedupeKey: 'credit:' + reference });
  }
  res.status(201).json({ ok: true, credited: true, credits, aed, balance });
});

// GET /credits/transactions — full ledger across the platform (admin).
const _MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtTxDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso); if (isNaN(d)) return String(iso).slice(0, 16);
  const hh = String(d.getUTCHours()).padStart(2, '0'); const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${hh}:${mm}`;
}
router.get('/transactions', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit || '300', 10) || 300));
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT t.id, t.type, t.amount, t.aed_amount, t.payment_method, t.created_at, t.status, t.description,
              l.first_name, l.last_name, f.name AS firm_name
       FROM credit_transactions t
       LEFT JOIN lawyers l ON l.id = t.lawyer_id
       LEFT JOIN firms f ON f.id = l.firm_id
       ORDER BY t.created_at DESC LIMIT ?`
    ).all(limit);
  } catch (_) {}
  const kindOf = (type, amount) => {
    if (type === 'transfer') return 'adjustment';   // pool ↔ lawyer move, not a refund
    if (type === 'use') return 'booking';
    if (type === 'refund' || amount < 0) return 'refund';
    return 'lawyer';
  };
  const data = rows.map((t) => ({
    id: t.id,
    kind: kindOf(t.type, Number(t.amount) || 0),
    buyer: `${t.first_name || ''} ${t.last_name || ''}`.trim() || t.firm_name || '—',
    credits: Number(t.amount) || 0,
    aed: Number(t.aed_amount) || 0,
    method: t.payment_method || t.description || '—',
    date: fmtTxDate(t.created_at),
    status: t.status || 'completed',
  }));
  res.json({ data, meta: { total: data.length } });
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
  // Receipt to the buyer once the admin confirms the purchase.
  const buyerEmail = (lawyer && lawyer.email) || r.email;
  if (buyerEmail) {
    mailer.send('credit_purchase', tpl.creditPurchase({
      name: lawyer ? tpl.fullName(lawyer.first_name, lawyer.last_name) : null,
      credits: r.credits, aed: r.aed_amount, balance, reference: r.id, scope: 'lawyer',
    }), { to: buyerEmail, ref: r.id, dedupeKey: 'credit:' + r.id });
  }
  res.json({ ok: true, credited: !!lawyer, balance, note: lawyer ? undefined : 'Confirmed, but no lawyer account matched the email — no balance updated.' });
});

router.post('/topup', requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
  const b = req.body || {};
  const email = (b.email || '').toString().trim().toLowerCase();
  const credits = Math.round(Number(b.credits || b.amount) || 0);
  if (!credits) return res.status(400).json({ error: 'credits are required' });
  // Resolve the lawyer by email, falling back to id — so admins can grant to a
  // lawyer who has no email on file (looked up by record id from the CRM).
  let lawyer = email ? store.getLawyerByEmail(email) : null;
  const id = (b.lawyer_id || b.lawyerId || b.id || '').toString().trim();
  if (!lawyer && id) lawyer = store.getLawyerById(id);
  if (!lawyer) return res.status(404).json({ error: 'No matching lawyer account' });
  const balance = grant(lawyer, credits, { type: credits >= 0 ? 'purchase' : 'refund', description: b.note || 'Administrator top-up', method: 'admin' });
  res.json({ ok: true, email: lawyer.email || email, balance });
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
  // Move the credits between the firm pool and the lawyer, and record it on
  // the firm ledger. Positive = assign out of pool; negative = return to pool.
  // Non-blocking: clamp at 0 so legacy firms with no pool aren't stuck.
  if (lawyer.firm_id && credits !== 0) {
    try {
      const name = `${(lawyer.first_name || '')} ${(lawyer.last_name || '')}`.trim();
      db.prepare('UPDATE firms SET credit_pool = MAX(0, COALESCE(credit_pool,0) - ?) WHERE id = ?').run(credits, lawyer.firm_id);
      db.prepare(
        `INSERT INTO firm_credit_transactions (id, firm_id, type, amount, description, lawyer_id)
         VALUES (?,?,?,?,?,?)`
      ).run(rid('FTX-'), lawyer.firm_id, credits > 0 ? 'assign' : 'refund', -credits,
        credits > 0 ? `Assigned ${credits} credits to ${name}` : `Returned ${-credits} credits from ${name}`, lawyer.id);
    } catch (_) {}
  }
  res.json({ ok: true, lawyerId: lawyer.id, balance });
});

// ─── Firm credit pool ─────────────────────────────────────────────────────
const canFirm = (u) => !!u && (u.role === 'firm_compliance_officer' || isAdmin(u));
// Non-LAD users (e.g. a firm compliance officer) are ALWAYS scoped to their own
// firm — an explicit firmId from the request is ignored for them, preventing
// cross-firm wallet access (IDOR). Only LAD admins may target another firm.
function firmIdOf(req, explicit) {
  if (isAdmin(req.user) && explicit) return explicit.toString();
  return (req.user && req.user.firm_id) || null;
}
// Build the live firm wallet: pool, assigned-to-lawyers, used-this-cycle,
// total purchased, and the firm-level ledger.
function firmWallet(firmId) {
  const firm = db.prepare('SELECT id, name, COALESCE(credit_pool,0) pool, COALESCE(total_purchased,0) totalPurchased FROM firms WHERE id = ?').get(firmId);
  if (!firm) return null;
  const a = db.prepare("SELECT COALESCE(SUM(CASE WHEN credit_balance>0 THEN credit_balance ELSE 0 END),0) assigned, COUNT(CASE WHEN COALESCE(credit_balance,0)>0 THEN 1 END) lawyers FROM lawyers WHERE firm_id = ?").get(firmId) || {};
  const used = db.prepare("SELECT COALESCE(-SUM(t.amount),0) used FROM credit_transactions t JOIN lawyers l ON l.id = t.lawyer_id WHERE l.firm_id = ? AND t.type = 'use'").get(firmId) || {};
  const txns = db.prepare('SELECT id, type, amount, aed_amount, description, lawyer_id, created_at FROM firm_credit_transactions WHERE firm_id = ? ORDER BY created_at DESC LIMIT 100').all(firmId);
  return {
    firmId: firm.id, firmName: firm.name,
    pool: Number(firm.pool) || 0,
    totalPurchased: Number(firm.totalPurchased) || 0,
    assigned: Number(a.assigned) || 0,
    lawyersWithCredits: Number(a.lawyers) || 0,
    used: Number(used.used) || 0,
    pricePerCredit: PRICE,
    transactions: txns.map((t) => ({
      id: t.id, type: t.type, credits: Number(t.amount) || 0,
      aed: Number(t.aed_amount) || 0, description: t.description,
      lawyerId: t.lawyer_id, date: t.created_at,
    })),
  };
}

// GET /credits/firm — the logged-in firm's wallet (admins may pass ?firmId=).
router.get('/firm', requireAuth, (req, res) => {
  if (!canFirm(req.user)) return res.status(403).json({ error: 'Firm officers or admins only' });
  const firmId = firmIdOf(req, (req.query.firmId || '').toString());
  if (!firmId) return res.status(400).json({ error: 'No firm context for this user.' });
  const w = firmWallet(firmId);
  if (!w) return res.status(404).json({ error: 'Firm not found' });
  res.json(w);
});

// POST /credits/firm/checkout — instant card purchase into the firm pool
// (simulated PSP authorisation), mirroring the lawyer /checkout flow.
router.post('/firm/checkout', requireAuth, (req, res) => {
  if (!canFirm(req.user)) return res.status(403).json({ error: 'Firm officers or admins only' });
  const firmId = firmIdOf(req, (req.body && req.body.firmId || '').toString());
  if (!firmId) return res.status(400).json({ error: 'No firm context for this user.' });
  const firm = db.prepare('SELECT id FROM firms WHERE id = ?').get(firmId);
  if (!firm) return res.status(404).json({ error: 'Firm not found' });
  const credits = Math.round(Number((req.body && (req.body.credits || req.body.amount)) || 0));
  if (!Number.isFinite(credits) || credits <= 0 || credits > 1000000) return res.status(400).json({ error: 'A valid credit amount is required.' });
  const aed = credits * PRICE; // never trust a client-supplied amount
  const reference = rid('PAY-');
  db.prepare('UPDATE firms SET credit_pool = COALESCE(credit_pool,0) + ?, total_purchased = COALESCE(total_purchased,0) + ? WHERE id = ?').run(credits, credits, firmId);
  db.prepare(
    `INSERT INTO firm_credit_transactions (id, firm_id, type, amount, aed_amount, description, payment_method, reference)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(rid('FTX-'), firmId, 'purchase', credits, aed, `Card purchase — ${credits} credits`, 'card', reference);
  const wallet = firmWallet(firmId);
  // Receipt to the purchasing firm officer.
  if (req.user.email) {
    mailer.send('credit_purchase', tpl.creditPurchase({
      name: req.user.name || null, credits, aed, balance: wallet ? wallet.pool : null, reference, scope: 'firm',
    }), { to: req.user.email, ref: reference, dedupeKey: 'credit:' + reference });
  }
  res.status(201).json({ ok: true, credited: true, credits, aed, wallet });
});

module.exports = router;
