'use strict';

// Role-based access control middleware.
//
// Usage:
//   router.get('/path', requireRole('lad_super_admin'), handler);
//   router.post('/path', requireAnyRole('lad_super_admin', 'lad_admin'), handler);
//   router.post('/path', requireAdminTier(), handler);     // super_admin OR admin
//   router.post('/path', requireSuperAdmin(), handler);    // super_admin only
//
// All assume `requireAuth` has already populated `req.user`.
// On failure: 403 with a structured error body listing what was required.

const { requireAuth } = require('./auth');

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    requireAuth(req, res, (err) => {
      if (err) return;  // requireAuth already handled the 401
      if (!req.user || !allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          error: 'Forbidden — your role does not have access to this resource',
          code: 'INSUFFICIENT_ROLE',
          required: allowedRoles,
          actual: req.user ? req.user.role : null,
        });
      }
      next();
    });
  };
}

// Shortcuts
const requireSuperAdmin  = () => requireRole('lad_super_admin');
const requireAdminTier   = () => requireRole('lad_super_admin', 'lad_admin');
const requireFirmCO      = () => requireRole('firm_compliance_officer');
const requireAnyAdmin    = () => requireRole('lad_super_admin', 'lad_admin', 'firm_compliance_officer');

module.exports = {
  requireRole,
  requireSuperAdmin,
  requireAdminTier,
  requireFirmCO,
  requireAnyAdmin,
};
