'use strict';

// Lightweight migrations runner. Applies every *.sql file in /migrations
// alphabetically that hasn't been applied yet, tracked by a single
// `_migrations` table. Idempotent — safe to run on every deploy.
//
// File naming: NNN-description.sql  (e.g. 001-initial.sql, 002-add-skills.sql)
// One migration = one SQL transaction. Failure rolls back and exits non-zero.
//
// Usage:
//   node scripts/migrate.js          # apply pending
//   node scripts/migrate.js status   # list applied + pending without changes

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../src/db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function ensureMigrationsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function discoverMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log(`[migrate] no migrations directory at ${MIGRATIONS_DIR} — nothing to do`);
    return [];
  }
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d{3,}-.+\.sql$/.test(f))
    .sort()
    .map(f => ({
      id: f,
      path: path.join(MIGRATIONS_DIR, f),
      sql: fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'),
    }))
    .map(m => ({ ...m, checksum: crypto.createHash('sha256').update(m.sql).digest('hex').slice(0, 16) }));
}

function alreadyApplied(id) {
  return !!db.prepare('SELECT 1 FROM _migrations WHERE id = ?').get(id);
}

function applyOne(m) {
  const tx = db.transaction(() => {
    try {
      db.exec(m.sql);
    } catch (e) {
      // SQLite has no "ADD COLUMN IF NOT EXISTS". If a column was already added
      // out-of-band (e.g. by the app's self-heal path), the bare ALTER throws
      // "duplicate column name". Re-run statement-by-statement, skipping only
      // those duplicate-column errors, so ALTER-based migrations are idempotent
      // and a later migration can never be permanently blocked by this.
      if (!/duplicate column name/i.test(e.message)) throw e;
      for (const stmt of m.sql.split(';').map((s) => s.trim()).filter(Boolean)) {
        try { db.exec(stmt); }
        catch (e2) { if (!/duplicate column name/i.test(e2.message)) throw e2; }
      }
    }
    db.prepare('INSERT INTO _migrations (id, checksum) VALUES (?, ?)').run(m.id, m.checksum);
  });
  tx();
}

function main() {
  const mode = process.argv[2] || 'apply';
  ensureMigrationsTable();
  const migrations = discoverMigrations();

  if (mode === 'status') {
    console.log('Migration status:');
    for (const m of migrations) {
      const applied = alreadyApplied(m.id);
      console.log(`  ${applied ? '✓' : '·'} ${m.id}  (${m.checksum})`);
    }
    return;
  }

  let applied = 0;
  for (const m of migrations) {
    if (alreadyApplied(m.id)) {
      console.log(`[migrate] skip ${m.id} (already applied)`);
      continue;
    }
    console.log(`[migrate] applying ${m.id} …`);
    try {
      applyOne(m);
      console.log(`[migrate] ✓ ${m.id}`);
      applied++;
    } catch (e) {
      console.error(`[migrate] ✗ ${m.id} failed: ${e.message}`);
      process.exit(1);
    }
  }
  console.log(`[migrate] done — ${applied} new migration(s) applied`);
}

main();
