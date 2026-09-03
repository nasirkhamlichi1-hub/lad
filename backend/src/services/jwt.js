'use strict';

const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const db = require('../db');

function sign(payload) {
  const jti = uuidv4();
  const token = jwt.sign({ ...payload, jti }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    issuer:    'lad-clpd-backend',
    algorithm: 'HS256',
  });
  // Track the session for revocation
  const decoded = jwt.decode(token);
  db.prepare(`INSERT INTO auth_sessions
    (id, user_id, user_type, role, uaepass_uuid, expires_at, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    jti, payload.sub, payload.user_type, payload.role,
    payload.uaepass_uuid || null,
    new Date(decoded.exp * 1000).toISOString(),
    payload.ip || null, payload.user_agent || null
  );
  return token;
}

function verify(token) {
  // Pin the algorithm explicitly — never let the token header choose it
  // (prevents algorithm-confusion / alg:none attacks).
  const decoded = jwt.verify(token, config.jwt.secret, { issuer: 'lad-clpd-backend', algorithms: ['HS256'] });
  // Check revocation
  const row = db.prepare('SELECT revoked FROM auth_sessions WHERE id = ?').get(decoded.jti);
  if (!row || row.revoked) {
    const err = new Error('Session revoked or unknown');
    err.status = 401;
    throw err;
  }
  return decoded;
}

function revoke(jti) {
  db.prepare('UPDATE auth_sessions SET revoked = 1 WHERE id = ?').run(jti);
}

// Revoke every live session for one account. Called when a password is reset:
// resetting a password is what someone does when they think their account is
// compromised, so any token an attacker already holds has to die with it —
// otherwise it stays valid for the rest of its eight hours.
function revokeAllForUser(userId, userType) {
  if (!userId) return 0;
  try {
    const info = db.prepare(
      'UPDATE auth_sessions SET revoked = 1 WHERE user_id = ? AND user_type = ? AND revoked = 0'
    ).run(userId, userType);
    return info.changes || 0;
  } catch (_) { return 0; }
}

// Housekeeping: auth_sessions grows by one row per sign-in for ever, and every
// authenticated request reads this table. Drop rows whose tokens expired more
// than a week ago — they can never authenticate anything again.
function pruneExpired() {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const info = db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(cutoff);
    return info.changes || 0;
  } catch (_) { return 0; }
}

module.exports = { sign, verify, revoke, revokeAllForUser, pruneExpired };
