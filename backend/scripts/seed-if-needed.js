'use strict';

// Runs the report seed once per data version, on deploy. Production starts with
//   node scripts/migrate.js && node scripts/seed-if-needed.js && node src/server.js
// so the live DB reflects the committed seed-data/ report without a manual step.
//
// It is idempotent and NON-destructive: seed.js uses INSERT OR REPLACE, so it
// updates/adds rows keyed by their real IDs and never blanks the database. A
// version marker in app_meta means the heavy seed runs only when the data
// changes (bump SEED_VERSION), not on every boot. Any failure is logged and
// swallowed so it never blocks the server from starting.

const path = require('path');
const { spawnSync } = require('child_process');
const db = require('../src/db');

const SEED_VERSION = '2025-26-report-v1';

function getMarker() {
  try {
    db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)');
    const row = db.prepare("SELECT value FROM app_meta WHERE key='seed_version'").get();
    return row ? row.value : null;
  } catch (_) { return null; }
}

function setMarker(v) {
  try {
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('seed_version', ?)").run(v);
  } catch (_) {}
}

function lawyerCount() {
  try { return db.prepare('SELECT COUNT(*) n FROM lawyers').get().n; } catch (_) { return 0; }
}

const current = getMarker();
if (current === SEED_VERSION && lawyerCount() > 0) {
  console.log(`[seed-if-needed] up to date (version ${SEED_VERSION}, ${lawyerCount()} lawyers) — skipping.`);
  process.exit(0);
}

console.log(`[seed-if-needed] data version ${current || 'none'} → ${SEED_VERSION}; running seed…`);
const res = spawnSync('node', [path.join(__dirname, 'seed.js')], { stdio: 'inherit' });
if (res.status === 0) {
  setMarker(SEED_VERSION);
  console.log(`[seed-if-needed] done — marker set to ${SEED_VERSION}.`);
} else {
  console.error('[seed-if-needed] seed failed; leaving marker unset to retry next boot. Server will still start.');
}
process.exit(0);
