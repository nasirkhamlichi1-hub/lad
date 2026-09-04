'use strict';

// ─────────────────────────────────────────────────────────────────────
// The abandoned-attempt reaper.
// ─────────────────────────────────────────────────────────────────────
// A learner who closes the tab mid-activity leaves an `activity_attempt`
// row at status 'open' with nothing coming to close it. Left alone those
// rows accumulate forever: they overstate how many people are mid-lesson
// right now, they hold time-on-task that never lands on the aggregate,
// and they make "is anyone actually studying at 2am" unanswerable.
//
// 056's checkpoint gives every live attempt a heartbeat. This worker is
// the other half: anything that has stopped beating for longer than the
// window is settled as abandoned. Abandoned is not failed — closeAttempt
// with abandoned:true keeps the seconds, keeps the resume point and
// leaves the learner's status at in_progress, so the learner can still
// walk back in and pick up where they stopped. The only thing that
// changes is that the sitting is no longer pretending to be live.
//
// Deliberately modelled on services/email.js's worker: same start/stop
// shape, same unref so it never holds the process open, same swallow-and-
// log posture, because a maintenance sweep must never be able to take the
// API down with it.

const store = require('./store');
const log = require('../logger');

// How long an attempt may go silent before it counts as abandoned. Two
// hours is comfortably longer than any single sitting the platform offers
// (the longest AI lesson runs well under an hour) and short enough that
// the open count is meaningful within a working day.
const STALE_MINUTES = Number(process.env.LMS_REAP_STALE_MINUTES || 120);

// How often to sweep. The work is one indexed range scan plus a settle per
// stale row, so this is cheap; ten minutes keeps the dashboard honest
// without adding meaningful load.
const SWEEP_MS = Number(process.env.LMS_REAP_INTERVAL_MS || 10 * 60 * 1000);

// How many attempts one sweep will settle. Each is its own transaction plus a
// recompute, so this bounds the work a single pass does; a backlog larger than
// this drains across successive sweeps.
const REAP_LIMIT = Number(process.env.LMS_REAP_LIMIT || 500);

let _timer = null;
let _running = false;

async function sweep({ minutes = STALE_MINUTES } = {}) {
  // One sweep at a time. Each settle is a transaction, and engine.js
  // serialises those through a single queue — overlapping sweeps would
  // just wait on each other while doubling the work.
  if (_running) return { skipped: true };
  _running = true;
  try {
    const result = await store.reapStaleAttempts({ minutes, limit: REAP_LIMIT });
    if (result.reaped) {
      log.info('lms_attempts_reaped', {
        reaped: result.reaped,
        examined: result.examined,
        cutoff: result.cutoff,
      });
    }
    return result;
  } catch (e) {
    log.error('lms_reap_failed', { error: e.message });
    return { error: e.message };
  } finally {
    _running = false;
  }
}

function startWorker() {
  if (_timer) return;
  _timer = setInterval(() => { sweep().catch(() => {}); }, SWEEP_MS);
  _timer.unref && _timer.unref();
  // A sweep shortly after boot clears whatever a restart orphaned. On the
  // first deploy of 056 it also starts on the backlog of attempts opened
  // before heartbeats existed — starts, not finishes: each sweep settles at
  // most REAP_LIMIT, so a large backlog drains over several sweeps rather
  // than locking the database for one long pass.
  setTimeout(() => { sweep().catch(() => {}); }, 20 * 1000).unref();
  log.info('lms_reaper_started', { staleMinutes: STALE_MINUTES, sweepMs: SWEEP_MS });
}

function stopWorker() { if (_timer) { clearInterval(_timer); _timer = null; } }

module.exports = { sweep, startWorker, stopWorker, STALE_MINUTES };
