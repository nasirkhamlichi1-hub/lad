'use strict';

// ─────────────────────────────────────────────────────────────────────
// Harden a non-LAD instance — no demo sign-ins, no borrowed data.
// ─────────────────────────────────────────────────────────────────────
// scripts/migrate.js already skips the LAD data migrations on another
// brand. This is the belt to that brace: if a database was migrated BEFORE
// the brand was set (or copied from a LAD instance), the demo and test
// accounts those migrations create — every one of which signs in with the
// password "test" — are suspended here, on every boot, so they can never be
// used to reach a Living Horizon instance.
//
// Nothing is deleted: suspending keeps the audit trail intact and is
// reversible from the Staff page if a row turns out to be wanted.

const db = require('../src/db');
const brand = require('../src/brand');

// bcrypt("test") as shipped in 009/014/016/018/019 and 039/040.
const TEST_HASHES = [
  '$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2',
  '$2a$12$O037dqi4bnE/RuNvuZUi4uU6QdRmWidXwRUWhEmajinoFQgRyTiq2',
];

function main() {
  if (brand.ladData) { console.log('[harden-brand] LAD brand — nothing to do'); return; }
  const marks = TEST_HASHES.map(() => '?').join(',');
  const staff = db.prepare(`UPDATE staff SET status = 'suspended' WHERE status = 'active' AND password_hash IN (${marks})`).run(...TEST_HASHES);
  let lawyers = { changes: 0 };
  try { lawyers = db.prepare(`UPDATE lawyers SET status = 'suspended' WHERE status = 'active' AND password_hash IN (${marks})`).run(...TEST_HASHES); } catch (_) {}
  const staffTest = db.prepare("UPDATE staff SET status = 'suspended' WHERE status = 'active' AND (LOWER(email) LIKE '%@clpd.test' OR LOWER(email) LIKE '%@lad.com' OR LOWER(email) LIKE '%@demo.lad.dubai.gov.ae')").run();
  const n = staff.changes + lawyers.changes + staffTest.changes;
  console.log(`[harden-brand] brand=${brand.id}: ${n ? n + ' demo/test account(s) suspended' : 'no demo accounts present'}`);
}

try { main(); } catch (e) { console.error('[harden-brand] failed:', e.message); }
process.exit(0);
