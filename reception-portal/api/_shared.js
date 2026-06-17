// Shared helpers for the Academy API.
// One Azure Table ("academyprogress") holds three kinds of rows by partition key:
//   academy/<email> → a trainee's saved progress
//   users/<email>   → an enrolled trainee (whitelist) + optional per-user password
//   config/settings → global settings (e.g. the shared password hash)
const crypto = require('crypto');
const { TableClient } = require('@azure/data-tables');

const CONN = process.env.TABLES_CONNECTION || process.env.AzureWebJobsStorage || '';
const TABLE = 'academyprogress';
const P_PROGRESS = 'academy', P_USERS = 'users', P_CONFIG = 'config';
const SECRET = process.env.AUTH_SECRET || ('lad-academy::' + (process.env.TRAINEE_PASSWORD || 'set-a-password'));

function client() { return TableClient.fromConnectionString(CONN, TABLE); }
async function ensureTable(c) { try { await c.createTable(); } catch (e) {} }

function json(context, status, body) {
  context.res = { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body };
}

// ---- login tokens (HMAC; not secret-grade, but not trivially forgeable) ----
function sign(email) {
  email = String(email).toLowerCase();
  const h = crypto.createHmac('sha256', SECRET).update(email).digest('hex');
  return Buffer.from(email + '.' + h).toString('base64url');
}
function verify(token) {
  try {
    const s = Buffer.from(String(token), 'base64url').toString('utf8');
    const i = s.lastIndexOf('.');
    if (i < 0) return null;
    const email = s.slice(0, i), h = s.slice(i + 1);
    const exp = crypto.createHmac('sha256', SECRET).update(email).digest('hex');
    const a = Buffer.from(h), b = Buffer.from(exp);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return email;
  } catch (e) {}
  return null;
}

// ---- password hashing (salted SHA-256) ----
function hashPw(pw) {
  const salt = crypto.randomBytes(8).toString('hex');
  return salt + ':' + crypto.createHash('sha256').update(salt + ':' + pw).digest('hex');
}
function checkPw(pw, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 2) return false;
  const got = crypto.createHash('sha256').update(parts[0] + ':' + pw).digest('hex');
  const a = Buffer.from(got), b = Buffer.from(parts[1]);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function getUser(c, email) { try { return await c.getEntity(P_USERS, String(email).toLowerCase()); } catch (e) { return null; } }
async function getConfig(c) { try { return await c.getEntity(P_CONFIG, 'settings'); } catch (e) { return null; } }

// Email is allowed if it's enrolled in the users table, or listed in ALLOWED_EMAILS (bootstrap).
function envAllowed(email) {
  const list = String(process.env.ALLOWED_EMAILS || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  return list.length ? list.includes(String(email).toLowerCase()) : false;
}

function certifiedCount(progress) {
  return Object.values(progress || {}).filter(p => p && p.quiz && p.sim).length;
}
function adminOk(req) {
  const ADMIN = process.env.ADMIN_PASSWORD || '';
  const pass = req.headers['x-admin-pass'] || (req.query && req.query.pass) || (req.body && req.body.adminPass) || '';
  return (ADMIN && pass === ADMIN) || isSuperReq(req);
}

// Super-admins: full access to everything (trainer + admin dashboard + course
// builder) via their own signed-in session token. Configurable via the
// SUPER_ADMINS app setting (comma-separated); a built-in default is included.
function superAdmins() {
  const built = ['nasir.khamlichi@legal.dubai.gov.ae'];
  const env = String(process.env.SUPER_ADMINS || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  return new Set(built.concat(env).map(e => e.toLowerCase()));
}
function isSuper(email) { return !!email && superAdmins().has(String(email).toLowerCase()); }
function isSuperReq(req) {
  const t = (req.headers && (req.headers['x-trainer-token'] || req.headers['X-Trainer-Token'])) ||
            (req.query && req.query.token) || (req.body && req.body.token) || '';
  return isSuper(verify(t));
}

module.exports = {
  crypto, client, ensureTable, json, sign, verify, hashPw, checkPw,
  getUser, getConfig, envAllowed, certifiedCount, adminOk, isSuper, isSuperReq, superAdmins,
  TABLE, P_PROGRESS, P_USERS, P_CONFIG
};
