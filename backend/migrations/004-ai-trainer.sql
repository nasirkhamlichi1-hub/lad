-- ─────────────────────────────────────────────────────────────────────
-- 004 — AI Trainer (Tavus Conversational Video Interface)
-- ─────────────────────────────────────────────────────────────────────
-- The fully AI-generated, realistic-avatar trainer. Two tables:
--
--   trainer_lessons  — the content an admin uploads. Each row IS the
--                      knowledge base the avatar teaches from. No hardcoded
--                      lessons ship with the platform; surfaces reflect what
--                      has actually been uploaded.
--
--   trainer_sessions — one row per live 1-2-1 conversation. Links a lawyer
--                      to a lesson and to the Tavus conversation, and stores
--                      the engagement summary Raven produces at end-of-call
--                      (attention, distraction events, mood) plus transcript.
--
-- These feed back into the existing CLPD record: a completed, engaged
-- session can award CPD points just like an in-person course.

CREATE TABLE IF NOT EXISTS trainer_lessons (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  summary       TEXT,
  body          TEXT NOT NULL,              -- the material the trainer teaches from (RAG context)
  objectives    TEXT,                       -- JSON array of learning objectives
  course_id     TEXT,                       -- optional link to an existing CLPD course
  language      TEXT DEFAULT 'English',
  duration_min  INTEGER DEFAULT 15,
  cpd_points    INTEGER DEFAULT 0,
  active        INTEGER DEFAULT 1,
  created_by_id TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trainer_sessions (
  id               TEXT PRIMARY KEY,        -- our session id (st_...)
  conversation_id  TEXT,                    -- Tavus conversation id (c...)
  conversation_url TEXT,                    -- Daily room URL the attendee joins
  lesson_id        TEXT,
  lawyer_id        TEXT,
  status           TEXT DEFAULT 'active',   -- active | ended | error
  engagement       TEXT,                    -- JSON: Raven end-of-call perception summary
  transcript       TEXT,                    -- JSON / text transcript
  events           TEXT,                    -- JSON array of in-call perception events
  started_at       TEXT DEFAULT (datetime('now')),
  ended_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_trainer_lessons_active   ON trainer_lessons (active);
CREATE INDEX IF NOT EXISTS idx_trainer_sessions_lawyer  ON trainer_sessions (lawyer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_sessions_lesson  ON trainer_sessions (lesson_id);
