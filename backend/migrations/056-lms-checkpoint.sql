-- ─────────────────────────────────────────────────────────────────────
-- 056 — Checkpoints: progress that survives a closed tab
-- ─────────────────────────────────────────────────────────────────────
-- 048 gave every sitting an `activity_attempt` row and every lawyer an
-- `activity_progress` aggregate. Both are written at the boundaries: once
-- when the attempt opens, once when it closes. Nothing is written in
-- between.
--
-- That leaves two holes a real learner falls into daily:
--
--   1. `activity_progress.resume_state` is only set by closeAttempt. A
--      learner who shuts the laptop mid-lesson never gets one written, so
--      "pick up where you left off" has nothing to pick up from. (Until
--      now nothing read the column either — see 056's store changes.)
--
--   2. An attempt that is never closed stays 'open' forever. Its seconds
--      are lost, it inflates the open-attempt count, and the learner's
--      time on task under-reports for good.
--
-- The fix is a heartbeat. The launching engine calls checkpoint() every
-- so often while the learner is working; each call writes the resume
-- point and the time so far WITHOUT settling anything. Completion still
-- happens only in closeAttempt, so the derived-not-asserted rule from 048
-- is untouched: a checkpoint can move `percent` and `resume_state`, and
-- can never move `status` to completed or passed.
--
-- `heartbeat_at` also makes abandonment detectable. An attempt whose last
-- heartbeat is older than the reaper's window was abandoned, and can be
-- settled as such — keeping the evidence, releasing the 'open' state.
-- ─────────────────────────────────────────────────────────────────────

-- When the engine last reported this attempt alive. NULL for attempts that
-- pre-date this migration and for engines that never check in; the reaper
-- falls back to started_at in that case, so old rows still settle.
ALTER TABLE activity_attempt ADD COLUMN heartbeat_at TEXT;

-- The resume point as at the last checkpoint, kept per-attempt as well as
-- on the aggregate. The aggregate answers "where do I resume this
-- activity"; this column answers "where was this particular sitting when
-- it died", which is what a support query or an audit actually asks.
ALTER TABLE activity_attempt ADD COLUMN resume_state TEXT;

-- Progress within this sitting, 0..100, as last reported. Distinct from
-- activity_progress.percent, which is the best across every sitting.
ALTER TABLE activity_attempt ADD COLUMN percent INTEGER;

-- Finding stale open attempts is the reaper's only query, and it runs on a
-- timer against a table that grows forever. Index the two columns it filters
-- on so it stays a range scan rather than a full table scan.
CREATE INDEX IF NOT EXISTS idx_attempt_open_heartbeat
  ON activity_attempt (status, heartbeat_at);

-- Checkpoints touch activity_progress.last_at on every heartbeat, and the
-- overview's "who has gone quiet" query sorts on it across all courses.
CREATE INDEX IF NOT EXISTS idx_activity_progress_last_at
  ON activity_progress (last_at);

-- The overview counts attempts per day across the whole estate. Without
-- this it is a full scan of the append-only log on every dashboard load.
CREATE INDEX IF NOT EXISTS idx_attempt_started_at
  ON activity_attempt (started_at);
