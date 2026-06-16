-- ─────────────────────────────────────────────────────────────────────
-- 005 — AI Trainer: learning progress + resumable sessions
-- ─────────────────────────────────────────────────────────────────────
-- 004 gave us one row per live conversation (trainer_sessions). That is the
-- raw attempt log. This migration adds the *learning* layer on top:
--
--   trainer_progress — ONE row per (lawyer, lesson). It aggregates every
--                      session a lawyer has on a given lesson into a single
--                      durable record: how far they've got, how long they've
--                      spent, whether they finished, the CPD points awarded,
--                      and — crucially — a `resume_context` recap so a lawyer
--                      can stop halfway and pick the lesson back up later in a
--                      brand-new conversation that continues where they left
--                      off instead of starting over.
--
-- Multiple lawyers studying the same lesson simply get one trainer_progress
-- row each, which is how we track many users against the same material.

CREATE TABLE IF NOT EXISTS trainer_progress (
  id                 TEXT PRIMARY KEY,        -- pr_...
  lawyer_id          TEXT NOT NULL,
  lesson_id          TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'in_progress', -- in_progress | completed
  percent_complete   INTEGER NOT NULL DEFAULT 0,          -- 0..100
  objectives_done    TEXT DEFAULT '[]',       -- JSON array of covered objectives
  total_seconds      INTEGER NOT NULL DEFAULT 0,          -- cumulative time across sessions
  session_count      INTEGER NOT NULL DEFAULT 0,
  resume_context     TEXT,                    -- recap fed into the next conversation
  last_session_id    TEXT,
  best_engagement    REAL,                    -- 0..1 best attentiveness seen (optional)
  cpd_points_awarded INTEGER NOT NULL DEFAULT 0,
  started_at         TEXT DEFAULT (datetime('now')),
  last_active_at     TEXT DEFAULT (datetime('now')),
  completed_at       TEXT,
  UNIQUE (lawyer_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_trainer_progress_lawyer ON trainer_progress (lawyer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_progress_lesson ON trainer_progress (lesson_id);

-- Link each session/attempt to its progress record and support pause/resume.
ALTER TABLE trainer_sessions ADD COLUMN progress_id     TEXT;
ALTER TABLE trainer_sessions ADD COLUMN resumed_from_id TEXT;   -- the session this one resumed
ALTER TABLE trainer_sessions ADD COLUMN seconds         INTEGER DEFAULT 0;
-- trainer_sessions.status now also takes the value 'paused' (user stopped, will resume).

CREATE INDEX IF NOT EXISTS idx_trainer_sessions_progress ON trainer_sessions (progress_id);
