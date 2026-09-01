'use strict';

// ─────────────────────────────────────────────────────────────────────
// The learning subsystem's data-access layer.
// ─────────────────────────────────────────────────────────────────────
// Everything under src/lms talks to the database through this module and
// never through `require('../db')` directly. The API is asynchronous even
// though today's engine (better-sqlite3) is synchronous, and that is the
// entire point: when this subsystem moves to Postgres, only this file
// changes. Nothing else in src/lms has to become async, because it
// already is.
//
// Why not migrate the whole backend at once: the rest of the app uses
// better-sqlite3's synchronous API at ~400 call sites across 29 files,
// including bookings, credits, accreditations and the immutable financial
// audit trail. Converting those to promises to build a learning feature
// none of them are part of is a large refactor with real regression risk
// on live compliance records. This seam gets the new code Postgres-ready
// without paying for that today, and leaves the legacy migration as its
// own properly-scoped piece of work.
//
// Rules for SQL written against this layer, so the swap stays cheap:
//   * `?` placeholders only. translate() rewrites them to $1..$n for pg.
//   * No SQLite-only functions. In particular never datetime('now') —
//     use now() from this module so the timestamp comes from the app.
//   * No INSERT OR REPLACE / OR IGNORE. Use ON CONFLICT ... DO UPDATE,
//     which both engines support.
//   * No implicit type coercion games. Booleans are INTEGER 0/1 here and
//     are converted at the store boundary, not in SQL.

const crypto = require('crypto');
const sqlite = require('../db');
const log = require('../logger');

// The engine currently backing this layer. When a pg implementation lands,
// this becomes a switch on an env var and the rest of the file is the only
// thing that needs to know.
const DRIVER = 'sqlite';

// ─── Helpers shared by every caller ──────────────────────────────────

// UTC timestamp in exactly the shape SQLite's datetime('now') produces, so
// new rows sort and compare against the columns written by migrations
// 001–047. Generated in the app rather than in SQL: a portable schema
// cannot depend on a particular engine's date functions, and a single
// source of "now" is easier to freeze in a test.
function now() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

// JSON columns are (de)serialised at this boundary so store code only ever
// handles plain objects. A malformed value yields the fallback rather than
// throwing — a corrupt detail blob must never take down a progress read.
function toJson(value) {
  if (value == null) return null;
  try { return JSON.stringify(value); } catch { return null; }
}
function fromJson(value, fallback) {
  if (value == null) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

// ─── Placeholder translation ─────────────────────────────────────────
// Kept even while the driver is sqlite so that the pg path is a one-line
// change rather than a rewrite of every query in the subsystem.
function translate(sql) {
  if (DRIVER !== 'postgres') return sql;
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// ─── Core operations ─────────────────────────────────────────────────
// all/one/run mirror the shapes the rest of the codebase already uses
// (`.all()`, `.get()`, `.run()`), so the style is familiar — the only
// difference is that these return promises.

async function all(sql, params = []) {
  try {
    return sqlite.prepare(translate(sql)).all(...params);
  } catch (e) {
    log.error('lms_query_failed', { op: 'all', error: e.message, sql: sql.slice(0, 160) });
    throw e;
  }
}

async function one(sql, params = []) {
  try {
    return sqlite.prepare(translate(sql)).get(...params) || null;
  } catch (e) {
    log.error('lms_query_failed', { op: 'one', error: e.message, sql: sql.slice(0, 160) });
    throw e;
  }
}

async function run(sql, params = []) {
  try {
    const r = sqlite.prepare(translate(sql)).run(...params);
    return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
  } catch (e) {
    log.error('lms_query_failed', { op: 'run', error: e.message, sql: sql.slice(0, 160) });
    throw e;
  }
}

// ─── Transactions ────────────────────────────────────────────────────
// better-sqlite3's own db.transaction() requires a fully synchronous
// function — an `await` inside one would let the transaction commit before
// the awaited work ran. So transactions are driven with explicit BEGIN /
// COMMIT / ROLLBACK instead, which behaves correctly with async callbacks.
//
// That raises a second problem: between an await and the COMMIT, another
// request could interleave and issue its own BEGIN on the same connection.
// SQLite has one writer regardless, so the honest fix is to serialise
// transactions through a queue. Under Postgres this disappears — each
// transaction takes its own pooled client and they run concurrently.
let chain = Promise.resolve();

function tx(fn) {
  const result = chain.then(async () => {
    sqlite.prepare('BEGIN').run();
    try {
      const value = await fn({ all, one, run });
      sqlite.prepare('COMMIT').run();
      return value;
    } catch (e) {
      try { sqlite.prepare('ROLLBACK').run(); }
      catch (rollbackError) {
        log.error('lms_rollback_failed', { error: rollbackError.message });
      }
      throw e;
    }
  });
  // Keep the chain alive even when this transaction rejects, otherwise one
  // failure would block every subsequent transaction for the process' life.
  chain = result.catch(() => {});
  return result;
}

module.exports = { all, one, run, tx, now, genId, toJson, fromJson, driver: DRIVER };
