'use strict';

// ─────────────────────────────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────────────────────────────
// GET  /api/v1/auth/uaepass/login        — Start OAuth flow (redirects to UAE Pass)
// GET  /api/v1/auth/uaepass/callback     — UAE Pass redirects back here with ?code=&state=
// GET  /api/v1/auth/me                   — Return current user (requires Bearer)
// POST /api/v1/auth/logout               — Revoke the current JWT
// GET  /api/v1/auth/uaepass/logout       — Redirect to UAE Pass single sign-out
//
// FALLBACK (when UAE Pass is unavailable or for back-office users):
// POST /api/v1/auth/staff/login          — Email + password for LAD staff / firm CO's

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const config = require('../config');
const db = require('../db');
const store = require('../services/store');
const uaepass = require('../services/uaepass');
const jwtService = require('../services/jwt');
const { requireAuth } = require('../middleware/auth');

// ─── UAE Pass: start ─────────────────────────────────────────────────
router.get('/uaepass/login', (req, res) => {
  if (!uaepass.isConfigured()) {
    return res.status(503).json({
      error: 'UAE Pass is not configured',
      hint: 'Set UAEPASS_CLIENT_ID and UAEPASS_CLIENT_SECRET in .env',
    });
  }

  const state = uaepass.generateState();
  const pkce = uaepass.generatePkcePair();
  const locale = (req.query.locale === 'ar') ? 'ar' : 'en';

  // Persist state + verifier for callback to look up
  db.prepare(`INSERT INTO oauth_state (state, redirect, created_at) VALUES (?, ?, ?)`).run(
    state,
    JSON.stringify({ verifier: pkce.verifier, returnTo: req.query.returnTo || null }),
    Date.now()
  );

  const url = uaepass.buildAuthorizeUrl({
    state,
    codeChallenge: pkce.challenge,
    locale,
  });

  res.redirect(url);
});

// ─── UAE Pass: callback ──────────────────────────────────────────────
router.get('/uaepass/callback', async (req, res, next) => {
  const { code, state, error: oauthError, error_description } = req.query;

  if (oauthError) {
    return res.redirect(`${config.uaepass.postLoginUrl}#error=${encodeURIComponent(oauthError)}&desc=${encodeURIComponent(error_description||'')}`);
  }
  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state in callback' });
  }

  // Look up & invalidate the state (one-time use)
  const row = db.prepare('SELECT redirect, created_at FROM oauth_state WHERE state = ?').get(state);
  if (!row) return res.status(400).json({ error: 'Unknown or expired state — CSRF protection' });
  db.prepare('DELETE FROM oauth_state WHERE state = ?').run(state);

  // Reject states older than 10 minutes (enforced, not just one-time-use). Also
  // prune any other stale states so the table can't grow unbounded.
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  if (!Number.isFinite(ageMs) || ageMs > 10 * 60 * 1000) {
    return res.status(400).json({ error: 'Login request expired — please try again.' });
  }
  try { db.prepare("DELETE FROM oauth_state WHERE created_at < datetime('now','-1 hour')").run(); } catch (_) {}

  let parsedRedirect = {};
  try { parsedRedirect = JSON.parse(row.redirect || '{}'); } catch { /* ignore */ }
  const codeVerifier = parsedRedirect.verifier;

  try {
    const tokenRes = await uaepass.exchangeCodeForToken({ code, codeVerifier });
    const profile = await uaepass.getUserInfo(tokenRes.access_token);

    // ─── Map UAE Pass profile → local user ────────────────────────────
    //
    // Lookup strategy (in order):
    //   1. By uaepass_uuid (returning user — already linked)
    //   2. By emirates_id (existing lawyer record, first-time UAE Pass login)
    //   3. By email (back-office staff)
    //
    // First-time lawyer logins automatically link their UAE Pass UUID to
    // their LAD lawyer record. Visitors with no LAD record get a 403.

    const uaepass_uuid = profile.uuid || profile.sub;
    const emirates_id  = profile.idn || null;
    const unified_id   = profile.unifiedID || null;
    const email        = (profile.email || '').toLowerCase();

    let user = null;
    let userType = null;
    let role = null;

    // 1. Match by UAE Pass UUID (already linked)
    user = store.getLawyerByUaePassUuid(uaepass_uuid);
    if (user) {
      userType = 'lawyer';
      role = 'lawyer';
    }

    // 2. Match by Emirates ID
    if (!user && emirates_id) {
      user = store.getLawyerByEmiratesId(emirates_id);
      if (user) {
        userType = 'lawyer';
        role = 'lawyer';
        store.linkLawyerToUaePass({
          lawyerId: user.id,
          uaepass_uuid,
          unified_id,
          ip: req.ip,
        });
      }
    }

    // 3. Match by email (lawyer or staff)
    if (!user && email) {
      user = store.getLawyerByEmail(email);
      if (user) {
        userType = 'lawyer';
        role = 'lawyer';
        store.linkLawyerToUaePass({ lawyerId: user.id, uaepass_uuid, unified_id, ip: req.ip });
      } else {
        // Staff lookup
        user = db.prepare("SELECT * FROM staff WHERE LOWER(email) = LOWER(?) AND status = 'active'").get(email);
        if (user) {
          userType = 'staff';
          role = user.role; // lad_admin / firm_compliance_officer / etc.
          db.prepare(`UPDATE staff SET uaepass_uuid = ?, emirates_id = COALESCE(emirates_id, ?)
                      WHERE id = ?`).run(uaepass_uuid, emirates_id, user.id);
        }
      }
    }

    if (!user) {
      // No matching record — direct UAE Pass users to onboarding
      return res.redirect(
        `${config.uaepass.postLoginUrl}#error=no_lad_record` +
        `&emirates_id=${encodeURIComponent(emirates_id || '')}` +
        `&name=${encodeURIComponent(((profile.firstnameEN||'') + ' ' + (profile.lastnameEN||'')).trim())}` +
        `&email=${encodeURIComponent(email || '')}`
      );
    }

    // Issue JWT
    const token = jwtService.sign({
      sub:          user.id,
      user_type:    userType,
      role,
      uaepass_uuid,
      firm_id:      user.firm_id || null,
      name:         ((user.first_name || profile.firstnameEN || '') + ' ' + (user.last_name || profile.lastnameEN || '')).trim(),
      email:        user.email || email,
      ip:           req.ip,
      user_agent:   req.headers['user-agent'],
    });

    // Audit
    db.prepare(`INSERT INTO audit_log (actor_id, actor_type, action, target_type, target_id, details, ip)
                VALUES (?, ?, 'login', ?, ?, ?, ?)`)
      .run(user.id, userType, userType, user.id,
           JSON.stringify({ method: 'uaepass', userType_uaepass: profile.userType }),
           req.ip || null);

    // Redirect to the frontend with the JWT in the URL fragment
    const finalRedirect = `${config.uaepass.postLoginUrl}` +
      `#token=${encodeURIComponent(token)}` +
      `&role=${encodeURIComponent(role)}` +
      `&name=${encodeURIComponent(((user.first_name||'') + ' ' + (user.last_name||'')).trim())}`;

    res.redirect(finalRedirect);
  } catch (err) {
    return next(err);
  }
});

// ─── UAE Pass: logout (single sign-out) ──────────────────────────────
router.get('/uaepass/logout', requireAuth, (req, res) => {
  jwtService.revoke(req.user.jti);
  const url = uaepass.buildLogoutUrl(config.uaepass.postLoginUrl);
  res.redirect(url);
});

// ─── Whoami ──────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const u = req.user;
  let profile = null;
  if (u.user_type === 'lawyer') {
    profile = store.getLawyerById(u.sub);
  } else if (u.user_type === 'staff') {
    profile = db.prepare('SELECT id, email, first_name, last_name, role, firm_id FROM staff WHERE id = ?').get(u.sub);
  }
  res.json({
    sub: u.sub,
    user_type: u.user_type,
    role: u.role,
    firm_id: u.firm_id || null,
    name: u.name,
    email: u.email,
    profile,
  });
});

// ─── Logout (local — revoke JWT) ─────────────────────────────────────
router.post('/logout', requireAuth, (req, res) => {
  jwtService.revoke(req.user.jti);
  res.json({ ok: true });
});

// ─── Staff fallback login (email + password) ─────────────────────────
// Useful for LAD admins before they're set up in UAE Pass, or when
// UAE Pass is down. Disable in production by removing this route.
router.post('/staff/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const staff = db.prepare(`SELECT id, email, first_name, last_name, role, firm_id,
                                   password_hash, status, must_change_password
                            FROM staff WHERE LOWER(email) = LOWER(?)`).get(email);
  if (!staff || staff.status !== 'active' || !staff.password_hash) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const ok = await bcrypt.compare(password, staff.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwtService.sign({
    sub:        staff.id,
    user_type:  'staff',
    role:       staff.role,
    firm_id:    staff.firm_id || null,
    name:       `${staff.first_name} ${staff.last_name}`.trim(),
    email:      staff.email,
    ip:         req.ip,
    user_agent: req.headers['user-agent'],
  });

  db.prepare(`INSERT INTO audit_log (actor_id, actor_type, action, details, ip)
              VALUES (?, 'staff', 'login', ?, ?)`)
    .run(staff.id, JSON.stringify({ method: 'password' }), req.ip || null);
  try { db.prepare('UPDATE staff SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(staff.id); } catch (_) {}

  res.json({ token, role: staff.role, name: `${staff.first_name} ${staff.last_name}`.trim(),
             must_change_password: !!staff.must_change_password });
});

// ─── Lawyer: email + password (temporary, until UAE Pass production is live)
// Same shape as /staff/login. The `lawyers` table gained a password_hash
// column in migration 002. Once UAE Pass is fully wired this remains
// available as a recovery path — useful when a lawyer's UAE Pass account
// is being re-issued and they need to keep filing CLPD.
router.post('/lawyer/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const lawyer = db.prepare(`SELECT id, email, first_name, last_name, firm_id,
                                    password_hash, status, credit_balance, lifetime_points,
                                    must_change_password
                             FROM lawyers WHERE LOWER(email) = LOWER(?)`).get(email);
  if (!lawyer || lawyer.status !== 'active' || !lawyer.password_hash) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const ok = await bcrypt.compare(password, lawyer.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwtService.sign({
    sub:        lawyer.id,
    user_type:  'lawyer',
    role:       'lawyer',
    firm_id:    lawyer.firm_id || null,
    name:       `${lawyer.first_name} ${lawyer.last_name}`.trim(),
    email:      lawyer.email,
    ip:         req.ip,
    user_agent: req.headers['user-agent'],
  });

  // Record last login + audit
  db.prepare(`UPDATE lawyers SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`).run(lawyer.id);
  db.prepare(`INSERT INTO audit_log (actor_id, actor_type, action, details, ip)
              VALUES (?, 'lawyer', 'login', ?, ?)`)
    .run(lawyer.id, JSON.stringify({ method: 'password' }), req.ip || null);

  res.json({
    token,
    role: 'lawyer',
    name: `${lawyer.first_name} ${lawyer.last_name}`.trim(),
    profile: {
      id: lawyer.id,
      firm_id: lawyer.firm_id,
      credit_balance: lawyer.credit_balance,
      lifetime_points: lawyer.lifetime_points,
    },
    must_change_password: !!lawyer.must_change_password,
  });
});

// ─── POST /auth/login ────────────────────────────────────────────────────
// Unified email/username + password login. The caller does not need to know
// the role in advance: we look the address up in `staff` first, then
// `lawyers`, bcrypt-verify, and return the same `{token, role, name}` shape as
// the role-specific routes. This is what the frontend `api.login()` calls.
router.post('/login', async (req, res) => {
  const body = req.body || {};
  const email = body.username || body.email;
  const password = body.password;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  // Try staff (LAD admins, firm COs) first, then lawyers.
  const staff = db.prepare(`SELECT id, email, first_name, last_name, role, firm_id,
                                   password_hash, status, must_change_password
                            FROM staff WHERE LOWER(email) = LOWER(?)`).get(email);
  if (staff && staff.status === 'active' && staff.password_hash &&
      await bcrypt.compare(password, staff.password_hash)) {
    const name = `${staff.first_name} ${staff.last_name}`.trim();
    const token = jwtService.sign({
      sub: staff.id, user_type: 'staff', role: staff.role, firm_id: staff.firm_id || null,
      name, email: staff.email, ip: req.ip, user_agent: req.headers['user-agent'],
    });
    db.prepare(`INSERT INTO audit_log (actor_id, actor_type, action, details, ip)
                VALUES (?, 'staff', 'login', ?, ?)`)
      .run(staff.id, JSON.stringify({ method: 'password' }), req.ip || null);
    return res.json({ token, role: staff.role, name,
                      must_change_password: !!staff.must_change_password });
  }

  const lawyer = db.prepare(`SELECT id, email, first_name, last_name, firm_id,
                                    password_hash, status, credit_balance, lifetime_points,
                                    must_change_password
                             FROM lawyers WHERE LOWER(email) = LOWER(?)`).get(email);
  if (lawyer && lawyer.status === 'active' && lawyer.password_hash &&
      await bcrypt.compare(password, lawyer.password_hash)) {
    const name = `${lawyer.first_name} ${lawyer.last_name}`.trim();
    const token = jwtService.sign({
      sub: lawyer.id, user_type: 'lawyer', role: 'lawyer', firm_id: lawyer.firm_id || null,
      name, email: lawyer.email, ip: req.ip, user_agent: req.headers['user-agent'],
    });
    db.prepare(`UPDATE lawyers SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`).run(lawyer.id);
    db.prepare(`INSERT INTO audit_log (actor_id, actor_type, action, details, ip)
                VALUES (?, 'lawyer', 'login', ?, ?)`)
      .run(lawyer.id, JSON.stringify({ method: 'password' }), req.ip || null);
    return res.json({
      token, role: 'lawyer', name,
      profile: {
        id: lawyer.id, firm_id: lawyer.firm_id,
        credit_balance: lawyer.credit_balance, lifetime_points: lawyer.lifetime_points,
      },
      must_change_password: !!lawyer.must_change_password,
    });
  }

  return res.status(401).json({ error: 'Invalid credentials' });
});

// ─── POST /auth/change-password ─────────────────────────────────────────
// Used both for the first-login forced flow and for users rotating their
// password voluntarily. Requires a valid JWT. Verifies the old password,
// validates the new one against minimum strength, hashes + persists,
// clears must_change_password.
const passwords = require('../services/passwords');
router.post('/change-password', requireAuth, async (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!old_password || !new_password) {
    return res.status(400).json({ error: 'old_password and new_password are required' });
  }

  // Strength check on the new password
  const errors = passwords.validateUserChosen(new_password);
  if (errors.length) {
    return res.status(400).json({ error: errors.join('; '), code: 'WEAK_PASSWORD', details: errors });
  }

  const userType = req.user.user_type;
  const table = userType === 'lawyer' ? 'lawyers' : 'staff';
  const row = db.prepare(`SELECT password_hash FROM ${table} WHERE id = ?`).get(req.user.sub);
  if (!row || !row.password_hash) return res.status(404).json({ error: 'Account not found' });

  const ok = await bcrypt.compare(old_password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

  const newHash = bcrypt.hashSync(new_password, 12);
  db.prepare(`UPDATE ${table} SET password_hash = ?,
                                  must_change_password = 0,
                                  password_changed_at = CURRENT_TIMESTAMP
                            WHERE id = ?`).run(newHash, req.user.sub);

  db.prepare(`INSERT INTO audit_log (actor_id, actor_type, action, details, ip)
              VALUES (?, ?, 'user.self_password_change', ?, ?)`)
    .run(req.user.sub, userType, JSON.stringify({}), req.ip || null);

  res.json({ ok: true });
});

module.exports = router;
