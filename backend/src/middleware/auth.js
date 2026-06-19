'use strict';

const jwtService = require('../services/jwt');

// Extract the JWT from the `Authorization: Bearer …` header ONLY. Tokens are
// never read from the query string — a token in a URL leaks into access logs,
// browser history, Referer headers and proxies. The OAuth redirect returns the
// token in the URL *fragment* (#token=), which the browser reads client-side
// and then sends as a Bearer header; it never reaches the server as a query param.
function getToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
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

// Super-admin roles bypass every role gate — they have access to all tabs.
const SUPER_ROLES = new Set(['lad_super_admin', 'super_admin', 'dg']);
function isSuper(role) { return SUPER_ROLES.has(role); }
// True if the user holds any of the listed roles, or is a super-admin.
function hasRole(user, ...roles) { return !!user && (isSuper(user.role) || roles.includes(user.role)); }

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    requireAuth(req, res, (err) => {
      if (err) return;
      if (!isSuper(req.user.role) && !allowedRoles.includes(req.user.role)) {
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

module.exports = { requireAuth, requireRole, optionalAuth, isSuper, hasRole };
