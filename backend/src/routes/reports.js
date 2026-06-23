'use strict';

// Finance reports & invoices — admin/finance only.
//   GET /api/v1/admin/reports/credits.csv        full credits ledger + VAT split
//   GET /api/v1/admin/reports/vat.csv            VAT report (net / 5% VAT / gross)
//   GET /api/v1/admin/reports/course-drops.csv   cancellations/refunds to adjust revenue
//   GET /api/v1/admin/reports/invoice/:id         invoice data (JSON) for one transaction
//
// VAT is UAE-standard 5% and prices are VAT-INCLUSIVE, so for a gross amount G:
//   net = round(G / 1.05, 2)   vat = G - net
// Computed on read so it applies to historical rows too (the ledger is immutable).

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');

const ADMIN_ROLES = ['lad_admin', 'lad_intelligence', 'lad_super_admin', 'super_admin', 'dg'];
const VAT_RATE = 0.05;

// Issuer details for invoices — placeholders; edit before real billing.
const ISSUER = {
  name: 'Legal Affairs Department — Government of Dubai',
  trn: 'TRN-PENDING',
  address: 'Legal Affairs Department, Government of Dubai, United Arab Emirates',
  email: 'clpd@legalaffairs.gov.ae',
};

// A refund reduces revenue/VAT regardless of how its amount sign is stored.
const refundSign = (t) => (t.type === 'refund' || Number(t.aed_amount) < 0) ? -1 : 1;

function vatSplit(gross) {
  const g = Math.round((Math.abs(Number(gross) || 0)) * 100) / 100;
  const net = Math.round((g / (1 + VAT_RATE)) * 100) / 100;
  const vat = Math.round((g - net) * 100) / 100;
  return { gross: g, net, vat };
}

// Inclusive date window from ?from=YYYY-MM-DD&to=YYYY-MM-DD or ?month=YYYY-MM.
function dateWindow(q) {
  let from = (q.from || '').toString().slice(0, 10);
  let to = (q.to || '').toString().slice(0, 10);
  const month = (q.month || '').toString().slice(0, 7);
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    from = month + '-01';
    const [y, m] = month.split('-').map(Number);
    const end = new Date(Date.UTC(y, m, 0)); // last day of month
    to = month + '-' + String(end.getUTCDate()).padStart(2, '0');
  }
  return { from: from || null, to: to || null };
}
function applyWindow(where, args, win, col = 't.created_at') {
  if (win.from) { where.push(`${col} >= ?`); args.push(win.from + 'T00:00:00'); }
  if (win.to) { where.push(`${col} <= ?`); args.push(win.to + 'T23:59:59'); }
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csv(headers, rows) {
  const head = headers.map((h) => csvCell(h.label)).join(',');
  const body = rows.map((r) => headers.map((h) => csvCell(r[h.key])).join(',')).join('\n');
  return head + '\n' + body + '\n';
}
function sendCsv(res, filename, headers, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv(headers, rows));
}

// All money-moving transactions (lawyer + firm pools), buyer/firm resolved.
function ledgerRows(win, opts = {}) {
  const where = ['t.aed_amount IS NOT NULL', 't.aed_amount != 0', "COALESCE(t.status,'completed') = 'completed'"];
  const args = [];
  if (opts.refundsOnly) where.push("(t.type = 'refund' OR t.aed_amount < 0)");
  if (opts.purchasesOnly) where.push("t.aed_amount > 0");
  applyWindow(where, args, win);
  const lawyerRows = db.prepare(
    `SELECT t.id, t.type, t.amount, t.aed_amount, t.payment_method, t.reference, t.description, t.created_at,
            COALESCE(NULLIF(TRIM((l.first_name || ' ' || l.last_name)), ''), 'Lawyer') AS buyer,
            f.name AS firm
     FROM credit_transactions t LEFT JOIN lawyers l ON l.id = t.lawyer_id LEFT JOIN firms f ON f.id = l.firm_id
     WHERE ${where.join(' AND ')}`
  ).all(...args);
  const firmWhere = ['t.aed_amount IS NOT NULL', 't.aed_amount != 0', "COALESCE(t.status,'completed') = 'completed'"];
  const firmArgs = [];
  if (opts.refundsOnly) firmWhere.push("(t.type = 'refund' OR t.aed_amount < 0)");
  if (opts.purchasesOnly) firmWhere.push("t.aed_amount > 0");
  applyWindow(firmWhere, firmArgs, win);
  let firmRows = [];
  try {
    firmRows = db.prepare(
      `SELECT t.id, t.type, t.amount, t.aed_amount, t.payment_method, t.reference, t.description, t.created_at,
              f.name AS buyer, f.name AS firm
       FROM firm_credit_transactions t LEFT JOIN firms f ON f.id = t.firm_id
       WHERE ${firmWhere.join(' AND ')}`
    ).all(...firmArgs);
  } catch (_) {}
  return lawyerRows.concat(firmRows).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

// ── Full credits ledger with VAT split ───────────────────────────────
router.get('/credits.csv', requireRole(...ADMIN_ROLES), (req, res) => {
  const win = dateWindow(req.query);
  const rows = ledgerRows(win).map((t) => {
    const s = vatSplit(t.aed_amount); const sign = refundSign(t);
    return {
      transaction_id: t.id, date: (t.created_at || '').slice(0, 10), type: sign < 0 ? 'refund' : t.type,
      buyer: t.buyer, firm: t.firm || '', credits: t.amount,
      gross_aed: (sign * s.gross).toFixed(2),
      net_aed: (sign * s.net).toFixed(2),
      vat_aed: (sign * s.vat).toFixed(2),
      method: t.payment_method || '', reference: t.reference || '', description: t.description || '',
    };
  });
  sendCsv(res, `clpd-credits-${win.from || 'all'}-to-${win.to || 'now'}.csv`, [
    { key: 'transaction_id', label: 'Transaction ID' }, { key: 'date', label: 'Date' },
    { key: 'type', label: 'Type' }, { key: 'buyer', label: 'Buyer' }, { key: 'firm', label: 'Firm' },
    { key: 'credits', label: 'Credits' }, { key: 'gross_aed', label: 'Gross AED' },
    { key: 'net_aed', label: 'Net AED' }, { key: 'vat_aed', label: 'VAT AED' },
    { key: 'method', label: 'Method' }, { key: 'reference', label: 'Reference' }, { key: 'description', label: 'Description' },
  ], rows);
});

// ── VAT report (revenue / 5% VAT / gross) ────────────────────────────
router.get('/vat.csv', requireRole(...ADMIN_ROLES), (req, res) => {
  const win = dateWindow(req.query);
  const ledger = ledgerRows(win);
  let tNet = 0, tVat = 0, tGross = 0;
  const rows = ledger.map((t) => {
    const sign = refundSign(t);
    const s = vatSplit(t.aed_amount);
    tNet += sign * s.net; tVat += sign * s.vat; tGross += sign * s.gross;
    return {
      transaction_id: t.id, date: (t.created_at || '').slice(0, 10),
      type: sign < 0 ? 'refund' : (t.type || 'sale'), description: t.description || '',
      net_aed: (sign * s.net).toFixed(2), vat_5pct_aed: (sign * s.vat).toFixed(2), gross_aed: (sign * s.gross).toFixed(2),
    };
  });
  rows.push({ transaction_id: 'TOTAL', date: '', type: '', description: 'Net VAT-inclusive totals',
    net_aed: tNet.toFixed(2), vat_5pct_aed: tVat.toFixed(2), gross_aed: tGross.toFixed(2) });
  sendCsv(res, `clpd-vat-${win.from || 'all'}-to-${win.to || 'now'}.csv`, [
    { key: 'transaction_id', label: 'Transaction ID' }, { key: 'date', label: 'Date' },
    { key: 'type', label: 'Type' }, { key: 'description', label: 'Description' },
    { key: 'net_aed', label: 'Net revenue AED' }, { key: 'vat_5pct_aed', label: 'VAT 5% AED' }, { key: 'gross_aed', label: 'Gross AED' },
  ], rows);
});

// ── Course-drop / refund report (to adjust revenue monthly) ──────────
router.get('/course-drops.csv', requireRole(...ADMIN_ROLES), (req, res) => {
  const win = dateWindow(req.query);
  const rows = ledgerRows(win, { refundsOnly: true }).map((t) => {
    const s = vatSplit(t.aed_amount);
    return {
      transaction_id: t.id, date: (t.created_at || '').slice(0, 10),
      buyer: t.buyer, firm: t.firm || '', course: t.description || '',
      credits_refunded: Math.abs(t.amount || 0),
      gross_refund_aed: s.gross, net_refund_aed: s.net, vat_refund_aed: s.vat,
      method: t.payment_method || '', reference: t.reference || '',
    };
  });
  sendCsv(res, `clpd-course-drops-${win.from || 'all'}-to-${win.to || 'now'}.csv`, [
    { key: 'transaction_id', label: 'Transaction ID' }, { key: 'date', label: 'Date' },
    { key: 'buyer', label: 'Buyer' }, { key: 'firm', label: 'Firm' }, { key: 'course', label: 'Course / reason' },
    { key: 'credits_refunded', label: 'Credits refunded' }, { key: 'gross_refund_aed', label: 'Gross refund AED' },
    { key: 'net_refund_aed', label: 'Net refund AED' }, { key: 'vat_refund_aed', label: 'VAT refund AED' },
    { key: 'method', label: 'Method' }, { key: 'reference', label: 'Reference' },
  ], rows);
});

// ── Bookings divided by channel: public / internal / partner ─────────
router.get('/bookings.csv', requireRole(...ADMIN_ROLES), (req, res) => {
  const win = dateWindow(req.query);
  const where = ['1=1']; const args = [];
  applyWindow(where, args, win, 'b.booked_at');
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT b.id, b.booked_at, b.status, b.credits_used, b.points_earned, b.booked_by,
              COALESCE(b.booking_type,'public') AS booking_type, b.course_title,
              COALESCE(NULLIF(TRIM((l.first_name||' '||l.last_name)),''),'') AS lawyer, f.name AS firm
       FROM bookings b LEFT JOIN lawyers l ON l.id=b.lawyer_id LEFT JOIN firms f ON f.id=l.firm_id
       WHERE ${where.join(' AND ')} ORDER BY b.booked_at DESC`
    ).all(...args);
  } catch (_) {}
  const out = rows.map((b) => ({
    booking_id: b.id, date: (b.booked_at || '').slice(0, 10), channel: b.booking_type,
    booked_by: b.booked_by || '', lawyer: b.lawyer, firm: b.firm || '', course: b.course_title || '',
    credits: b.credits_used || 0, points: b.points_earned || 0, status: b.status || '',
  }));
  sendCsv(res, `clpd-bookings-${win.from || 'all'}-to-${win.to || 'now'}.csv`, [
    { key: 'booking_id', label: 'Booking ID' }, { key: 'date', label: 'Date' },
    { key: 'channel', label: 'Channel (public/internal/partner)' }, { key: 'booked_by', label: 'Booked by' },
    { key: 'lawyer', label: 'Lawyer' }, { key: 'firm', label: 'Firm' }, { key: 'course', label: 'Course' },
    { key: 'credits', label: 'Credits' }, { key: 'points', label: 'Points' }, { key: 'status', label: 'Status' },
  ], out);
});

// Breakdown counts by channel (for the ops dashboard).
router.get('/bookings-breakdown', requireRole(...ADMIN_ROLES), (req, res) => {
  const win = dateWindow(req.query);
  const where = ['1=1']; const args = [];
  applyWindow(where, args, win, 'booked_at');
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT COALESCE(booking_type,'public') AS channel, COUNT(*) n, COALESCE(SUM(credits_used),0) credits
       FROM bookings WHERE ${where.join(' AND ')} GROUP BY COALESCE(booking_type,'public')`
    ).all(...args);
  } catch (_) {}
  const out = { public: { n: 0, credits: 0 }, internal: { n: 0, credits: 0 }, partner: { n: 0, credits: 0 } };
  rows.forEach((r) => { out[r.channel] = { n: r.n, credits: r.credits }; });
  res.json({ breakdown: out, total: rows.reduce((a, r) => a + r.n, 0) });
});

// ── Invoice data for one transaction (JSON; frontend renders & prints) ──
router.get('/invoice/:id', requireRole(...ADMIN_ROLES), (req, res) => {
  let t = db.prepare(
    `SELECT t.*, COALESCE(NULLIF(TRIM((l.first_name||' '||l.last_name)),''),'') AS buyer, f.name AS firm, f.trn AS firm_trn
     FROM credit_transactions t LEFT JOIN lawyers l ON l.id=t.lawyer_id LEFT JOIN firms f ON f.id=l.firm_id WHERE t.id = ?`
  ).get(req.params.id);
  let scope = 'lawyer';
  if (!t) {
    try {
      t = db.prepare(`SELECT t.*, f.name AS buyer, f.name AS firm, f.trn AS firm_trn
                      FROM firm_credit_transactions t LEFT JOIN firms f ON f.id=t.firm_id WHERE t.id = ?`).get(req.params.id);
      scope = 'firm';
    } catch (_) {}
  }
  if (!t) return res.status(404).json({ error: 'Transaction not found' });
  const s = vatSplit(t.aed_amount);
  res.json({
    issuer: ISSUER,
    invoice_no: 'INV-' + String(t.id).replace(/[^A-Za-z0-9]/g, ''),
    transaction_id: t.id, date: (t.created_at || '').slice(0, 10),
    scope, buyer: t.buyer || t.firm || '—', firm: t.firm || '', customer_trn: t.firm_trn || '',
    description: t.description || (t.type === 'purchase' ? 'CLPD credit purchase' : t.type),
    credits: Number(t.amount) || 0, payment_method: t.payment_method || '', reference: t.reference || '',
    vat_rate: '5%', net_aed: s.net.toFixed(2), vat_aed: s.vat.toFixed(2), gross_aed: s.gross.toFixed(2),
  });
});

module.exports = router;
