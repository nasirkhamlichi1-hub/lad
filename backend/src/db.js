'use strict';

// SQLite via better-sqlite3 (synchronous, fast, zero-config). For production,
// swap this file for a pg/Postgres pool — the rest of the code uses prepared
// statements through `db.prepare(sql).all/get/run`, which is portable.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('./config');

const dbPath = path.resolve(config.databaseUrl);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');     // faster concurrent reads, atomic crash recovery
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');   // good safety/perf balance for WAL
// Wait (don't error) for a lock — lets the background seed process and the live
// server write to the same file without SQLITE_BUSY during boot-time seeding.
db.pragma('busy_timeout = 10000');

function ping() {
  try {
    db.prepare('SELECT 1').get();
    return true;
  } catch { return false; }
}

module.exports = db;
module.exports.ping = ping;
module.exports.path = dbPath;
