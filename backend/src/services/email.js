'use strict';

// Transactional email service — SMTP relay + DB outbox.
//
// Design goals (the platform must never go down because of mail):
//   • enqueue() is synchronous and best-effort — it writes one row to
//     email_outbox and returns. It NEVER throws, so a request handler can call
//     it inside its own transaction without risking the user's action.
//   • A background worker drains the queue over SMTP with capped retries and
//     exponential backoff. An SMTP outage just leaves mail queued.
//   • Idempotent: a dedupe_key (e.g. "booking:<id>") makes re-sends impossible.
//
// Configuration (all via env, set on the host — nothing committed):
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_SECURE ("true" for 465),
//   SMTP_USER, SMTP_PASS, MAIL_FROM (e.g. "no-reply@legalaffairstraining.com"),
//   MAIL_FROM_NAME (default "LAD CLPD"). If SMTP_HOST is unset the service is
//   "not configured": mail is still queued and logged, just never transmitted.

const crypto = require('crypto');
const db = require('../db');
const log = require('../logger');

let _transporter = null;
let _nodemailer = null;

const MAX_ATTEMPTS = 6;
const BATCH = 20;

function host() { return (process.env.SMTP_HOST || '').trim(); }
function configured() { return !!host(); }

function fromAddress() {
  const addr = (process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@legalaffairstraining.com').trim();
  const name = (process.env.MAIL_FROM_NAME || 'LAD CLPD').trim();
  return name ? `"${name}" <${addr}>` : addr;
}

function transporter() {
  if (_transporter || !configured()) return _transporter;
  try {
    _nodemailer = _nodemailer || require('nodemailer');
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    _transporter = _nodemailer.createTransport({
      host: host(),
      port,
      secure: String(process.env.SMTP_SECURE || (port === 465)).toLowerCase() === 'true',
      auth: (process.env.SMTP_USER || process.env.SMTP_PASS)
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
      // Keep the request path unaffected by slow relays.
      connectionTimeout: 10000,
      greetingTimeout: 8000,
      socketTimeout: 15000,
      pool: true,
      maxConnections: 3,
    });
  } catch (e) {
    log.error('email_transporter_init_failed', { error: e.message });
    _transporter = null;
  }
  return _transporter;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const oid = () => 'EM-' + crypto.randomBytes(7).toString('hex').toUpperCase().slice(0, 12);

// Queue one email. Returns the row id, or null if it was skipped (bad address,
// duplicate dedupe_key, or a DB error). Never throws.
function enqueue({ to, toName, subject, html, text, category, ref, dedupeKey }) {
  try {
    const addr = String(to || '').trim().toLowerCase();
    if (!EMAIL_RE.test(addr)) return null;
    if (!subject) return null;
    const id = oid();
    const info = db.prepare(
      `INSERT OR IGNORE INTO email_outbox (id, to_email, to_name, subject, html, body_text, category, ref, dedupe_key, status)
       VALUES (?,?,?,?,?,?,?,?,?, 'queued')`
    ).run(id, addr, toName || null, String(subject), html || null, text || null, category || null, ref || null, dedupeKey || null);
    if (info.changes === 0) return null; // dedupe hit — already queued/sent
    // Nudge the worker so the mail goes out promptly without waiting for the tick.
    setImmediate(() => { flush().catch(() => {}); });
    return id;
  } catch (e) {
    log.error('email_enqueue_failed', { error: e.message, category });
    return null;
  }
}

// Convenience: build from a template module export + enqueue.
function send(category, built, { to, toName, ref, dedupeKey }) {
  if (!built) return null;
  return enqueue({ to, toName, subject: built.subject, html: built.html, text: built.text, category, ref, dedupeKey });
}

function backoffMs(attempts) {
  // 1m, 2m, 4m, 8m, 16m, capped at ~30m
  return Math.min(30 * 60 * 1000, 60 * 1000 * Math.pow(2, Math.max(0, attempts - 1)));
}

let _flushing = false;

// Drain due rows. Safe to call concurrently (guarded). Never throws.
async function flush() {
  if (_flushing) return;
  if (!configured()) return; // leave mail queued until SMTP is configured
  const tx = transporter();
  if (!tx) return;
  _flushing = true;
  try {
    const now = new Date().toISOString();
    const rows = db.prepare(
      `SELECT * FROM email_outbox
       WHERE status IN ('queued','failed') AND attempts < ? AND COALESCE(next_attempt_at, created_at) <= ?
       ORDER BY created_at ASC LIMIT ?`
    ).all(MAX_ATTEMPTS, now, BATCH);

    for (const row of rows) {
      try {
        await tx.sendMail({
          from: fromAddress(),
          to: row.to_name ? `"${row.to_name}" <${row.to_email}>` : row.to_email,
          subject: row.subject,
          html: row.html || undefined,
          text: row.body_text || undefined,
        });
        db.prepare("UPDATE email_outbox SET status='sent', sent_at=CURRENT_TIMESTAMP, attempts=attempts+1, last_error=NULL WHERE id=?").run(row.id);
        log.info('email_sent', { id: row.id, category: row.category, ref: row.ref });
      } catch (e) {
        const attempts = (row.attempts || 0) + 1;
        const failedFinal = attempts >= MAX_ATTEMPTS;
        const next = new Date(Date.now() + backoffMs(attempts)).toISOString();
        db.prepare("UPDATE email_outbox SET status=?, attempts=?, last_error=?, next_attempt_at=? WHERE id=?")
          .run(failedFinal ? 'failed' : 'queued', attempts, String(e.message).slice(0, 500), next, row.id);
        log.error('email_send_failed', { id: row.id, attempts, final: failedFinal, error: e.message });
      }
    }
  } catch (e) {
    log.error('email_flush_failed', { error: e.message });
  } finally {
    _flushing = false;
  }
}

let _timer = null;
function startWorker() {
  if (_timer) return;
  if (!configured()) {
    log.warn('email_not_configured', { hint: 'SMTP_HOST unset — emails will queue in email_outbox but not send.' });
  }
  // Periodic drain catches retries and anything enqueued during an SMTP outage.
  _timer = setInterval(() => { flush().catch(() => {}); }, 30 * 1000);
  _timer.unref && _timer.unref();
  // Initial drain shortly after boot.
  setTimeout(() => { flush().catch(() => {}); }, 4000).unref();
}

function stopWorker() { if (_timer) { clearInterval(_timer); _timer = null; } }

module.exports = { configured, enqueue, send, flush, startWorker, stopWorker };
