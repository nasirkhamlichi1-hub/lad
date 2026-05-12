'use strict';

const jwtService = require('../services/jwt');

// Extract JWT from `Authorization: Bearer …` or `?token=` (used during OAuth redirect)
function getToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  if (req.query.token) return String(req.query.token);
  return null;
}

function requireAuth(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });
  try {
    req.user = jwtService.verify(token);
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token', code: e.code || 'BAD_TOKEN' });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    requireAuth(req, res, (err) => {
      if (err) return;
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden — insufficient permissions', required: allowedRoles });
      }
      next();
    });
  };
}

// Optional — attaches `req.user` if a valid token is present, but doesn't reject anonymous requests.
function optionalAuth(req, _res, next) {
  const token = getToken(req);
  if (!token) return next();
  try { req.user = jwtService.verify(token); } catch { /* ignore */ }
  next();
}

module.exports = { requireAuth, requireRole, optionalAuth };
