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
  const decoded = jwt.verify(token, config.jwt.secret, { issuer: 'lad-clpd-backend' });
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

module.exports = { sign, verify, revoke };
