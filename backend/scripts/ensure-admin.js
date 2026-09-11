'use strict';

// ─────────────────────────────────────────────────────────────────────
// Bootstrap administrator — the first sign-in on a fresh instance.
// ─────────────────────────────────────────────────────────────────────
// A brand-new deployment (a Living Horizon App Service on day one) has an
// empty staff table and no shell to run create-account.js in. This creates
// ONE super-admin from two application settings so the person setting the
// portal up can sign in and create everyone else from the Staff page:
//
//   BOOTSTRAP_ADMIN_EMAIL     e.g. training@livinghorizon.com
//   BOOTSTRAP_ADMIN_PASSWORD  a temporary password (8+ characters)
//   BOOTSTRAP_ADMIN_NAME      optional, "First Last"
//
// The account is created with must_change_password = 1, so the temporary
// password is replaced on first sign-in and the setting can be removed
// afterwards. Idempotent: if an account with that email already exists,
// nothing is changed — this never resets a password that has been set.
//
// Runs on every boot from scripts/boot.sh and exits 0 whatever happens; a
// bootstrap problem is logged, never allowed to stop the server.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../src/db');

function main() {
  const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '');
  if (!email) { console.log('[ensure-admin] BOOTSTRAP_ADMIN_EMAIL not set — nothing to do'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('[ensure-admin] BOOTSTRAP_ADMIN_EMAIL is not an email address'); return; }
  if (password.length < 8) { console.error('[ensure-admin] BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters'); return; }

  const existing = db.prepare('SELECT id, role, status FROM staff WHERE LOWER(email) = ?').get(email);
  if (existing) {
    console.log(`[ensure-admin] ${email} already exists (id=${existing.id}, role=${existing.role}) — leaving it alone`);
    return;
  }
  const name = String(process.env.BOOTSTRAP_ADMIN_NAME || '').trim().split(/\s+/).filter(Boolean);
  const first = name[0] || 'Training';
  const last = name.slice(1).join(' ') || 'Administrator';
  const id = 'S-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  db.prepare(`INSERT INTO staff (id, email, first_name, last_name, role, status, password_hash,
                                 must_change_password, password_changed_at, created_by_type)
              VALUES (?, ?, ?, ?, 'lad_super_admin', 'active', ?, 1, CURRENT_TIMESTAMP, 'bootstrap')`)
    .run(id, email, first, last, bcrypt.hashSync(password, 12));
  try {
    db.prepare(`INSERT INTO audit_log (actor_id, actor_type, action, target_type, target_id, details)
                VALUES ('bootstrap', 'system', 'user.create', 'staff', ?, ?)`)
      .run(id, JSON.stringify({ email, role: 'lad_super_admin', via: 'BOOTSTRAP_ADMIN_EMAIL' }));
  } catch (_) {}
  console.log(`[ensure-admin] created super admin ${email} (id=${id}) — password must be changed on first sign-in`);
}

try { main(); } catch (e) { console.error('[ensure-admin] failed:', e.message); }
process.exit(0);
