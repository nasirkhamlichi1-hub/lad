-- ─────────────────────────────────────────────────────────────────────
-- 048 — The learning spine
-- ─────────────────────────────────────────────────────────────────────
-- Until now "progress" existed only for AI trainer lessons (005). Course
-- materials were delivered but never observed, and a SCORM package was a
-- link. There was no answer to "how far has this lawyer got on this course",
-- because nothing modelled a course as a *course of study*.
--
-- This migration adds that spine. Every learnable thing — an AI lesson, a
-- SCORM package, a document, a video, an assessment — becomes an `activity`
-- belonging to a course, optionally grouped into `course_module`s. A lawyer
-- on a course has one `enrolment`; against each activity they have one
-- `activity_progress` row; each sitting appends an `activity_attempt`.
--
-- Nothing existing is replaced. trainer_progress stays as the AI-lesson
-- specialisation and mirrors into activity_progress; course_materials rows
-- become activities. 049 backfills both.
--
-- Conventions, chosen for portability because this schema is expected to
-- move to Postgres later:
--   * Timestamps are TEXT, UTC, 'YYYY-MM-DD HH:MM:SS' — the same shape
--     datetime('now') produces, so they sort and compare against the
--     existing 47 migrations' columns. Written from JS, never from a SQL
--     function, so the engine can change underneath.
--   * No SQLite-only syntax. ON CONFLICT ... DO UPDATE is standard in both.
--   * Percentages are INTEGER 0..100. Scores are REAL 0..100 or NULL.
-- ─────────────────────────────────────────────────────────────────────

-- ─── Modules: ordered sections of a course ──────────────────────────
-- Optional. A course with no modules holds its activities directly; the
-- outline API presents those in a single implicit section.
CREATE TABLE IF NOT EXISTS course_module (
  id          TEXT PRIMARY KEY,
  course_id   TEXT NOT NULL,
  title       TEXT NOT NULL,
  summary     TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  -- 'none'       → everything in the module is open
  -- 'sequential' → an activity opens once the previous required one is done
  gate        TEXT NOT NULL DEFAULT 'none',
  published   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_course_module_course ON course_module (course_id, position);

-- ─── Activities: one row per learnable thing ────────────────────────
-- `kind` decides how it launches and how completion is judged. The content
-- itself is NOT duplicated here — the row points at whatever already holds
-- it, so there is exactly one copy of every asset:
--   ai_lesson → lesson_id   → trainer_lessons.id
--   document  → material_id → course_materials.id
--   link      → material_id → course_materials.id
--   scorm     → material_id today (a link); package_id once 05x lands
--   video     → material_id
--   assessment→ (reserved — no launch reference yet)
CREATE TABLE IF NOT EXISTS activity (
  id           TEXT PRIMARY KEY,
  course_id    TEXT NOT NULL,
  module_id    TEXT,
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  summary      TEXT,
  position     INTEGER NOT NULL DEFAULT 0,

  -- Only required activities count toward course completion. An optional
  -- reading still tracks progress; it just cannot hold the course open.
  required     INTEGER NOT NULL DEFAULT 1,
  weight       INTEGER NOT NULL DEFAULT 1,
  cpd_minutes  INTEGER NOT NULL DEFAULT 0,
  -- NULL = completion alone is enough. Otherwise the learner must also
  -- reach this score (0..100) for the activity to count as passed.
  pass_score   REAL,

  lesson_id    TEXT,
  material_id  TEXT,
  package_id   TEXT,

  -- Migration 002-047 taught us (the hard way, in the Wonder Academy build)
  -- that a content loader which deletes whatever is not in its source files
  -- will happily delete admin-authored rows too. Every delete that a loader
  -- or importer performs must be scoped to its own origin.
  --   'authored' → created by a human in the admin UI. Never bulk-deleted.
  --   'imported' → created by the 049 backfill or a future content loader.
  --   'derived'  → generated from another record and safe to rebuild.
  origin       TEXT NOT NULL DEFAULT 'authored',

  published    INTEGER NOT NULL DEFAULT 1,
  created_by   TEXT,
  created_at   TEXT,
  updated_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_course   ON activity (course_id, position);
CREATE INDEX IF NOT EXISTS idx_activity_module   ON activity (module_id, position);
CREATE INDEX IF NOT EXISTS idx_activity_lesson   ON activity (lesson_id);
CREATE INDEX IF NOT EXISTS idx_activity_material ON activity (material_id);
CREATE INDEX IF NOT EXISTS idx_activity_origin   ON activity (origin);

-- ─── Enrolment: one row per lawyer per course ───────────────────────
-- `percent`, `required_total` and `required_done` are a derived cache,
-- recomputed from activity_progress whenever an attempt settles. They are
-- never set by hand — the API exposes no writer for them — so the number a
-- regulator sees can always be rebuilt from the underlying rows.
CREATE TABLE IF NOT EXISTS enrolment (
  id             TEXT PRIMARY KEY,
  course_id      TEXT NOT NULL,
  lawyer_id      TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT 'manual',  -- manual | booking | self | import
  status         TEXT NOT NULL DEFAULT 'active',  -- active | completed | withdrawn
  percent        INTEGER NOT NULL DEFAULT 0,
  required_total INTEGER NOT NULL DEFAULT 0,
  required_done  INTEGER NOT NULL DEFAULT 0,
  total_seconds  INTEGER NOT NULL DEFAULT 0,
  started_at     TEXT,
  last_active_at TEXT,
  completed_at   TEXT,
  created_at     TEXT,
  UNIQUE (course_id, lawyer_id)
);
CREATE INDEX IF NOT EXISTS idx_enrolment_lawyer ON enrolment (lawyer_id);
CREATE INDEX IF NOT EXISTS idx_enrolment_course ON enrolment (course_id, status);

-- ─── Activity progress: one durable row per lawyer per activity ─────
-- The aggregate across every attempt. `resume_state` is deliberately opaque
-- — the AI trainer keeps a recap sentence there, a SCORM package will keep
-- its suspend_data pointer. Nothing outside the launching engine reads it.
CREATE TABLE IF NOT EXISTS activity_progress (
  id            TEXT PRIMARY KEY,
  activity_id   TEXT NOT NULL,
  lawyer_id     TEXT NOT NULL,
  course_id     TEXT NOT NULL,
  -- not_started | in_progress | completed | passed | failed
  -- 'completed' means the learner finished it; 'passed'/'failed' are used
  -- only where the activity carries a pass_score.
  status        TEXT NOT NULL DEFAULT 'not_started',
  percent       INTEGER NOT NULL DEFAULT 0,
  score         REAL,
  total_seconds INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  resume_state  TEXT,
  first_at      TEXT,
  last_at       TEXT,
  completed_at  TEXT,
  UNIQUE (activity_id, lawyer_id)
);
CREATE INDEX IF NOT EXISTS idx_activity_progress_lawyer ON activity_progress (lawyer_id, course_id);
CREATE INDEX IF NOT EXISTS idx_activity_progress_course ON activity_progress (course_id, status);

-- ─── Attempts: append-only log of individual sittings ───────────────
-- One row per launch. This is the evidence layer: the aggregate above can
-- be rebuilt from it, and a progress report cites it rather than asserting.
-- Rows are never updated after they close, and never deleted.
CREATE TABLE IF NOT EXISTS activity_attempt (
  id           TEXT PRIMARY KEY,
  activity_id  TEXT NOT NULL,
  lawyer_id    TEXT NOT NULL,
  course_id    TEXT NOT NULL,
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',   -- open | completed | abandoned
  score        REAL,
  seconds      INTEGER NOT NULL DEFAULT 0,
  -- The launching engine's own record: trainer_sessions.id for an AI lesson,
  -- the SCORM attempt id once that exists. Lets an attempt be traced back to
  -- its transcript or cmi data without this table knowing either format.
  external_id  TEXT,
  detail       TEXT,                            -- JSON, engine-specific
  started_at   TEXT,
  ended_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_attempt_activity ON activity_attempt (activity_id, lawyer_id);
CREATE INDEX IF NOT EXISTS idx_attempt_lawyer   ON activity_attempt (lawyer_id, started_at);
CREATE INDEX IF NOT EXISTS idx_attempt_external ON activity_attempt (external_id);
