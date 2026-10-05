-- ─────────────────────────────────────────────────────────────────────
-- 060 — Library insights and the learner's reading trail
-- ─────────────────────────────────────────────────────────────────────
-- The reference library on a course page now shows more than a list:
-- a plain-language line under each instrument, the subject it belongs to,
-- "what applies to me" situations, questions worth asking, which course
-- step each document supports, and a short self-test on any document.
--
-- All of that is drafted by the model from the documents' own text, once,
-- and kept here against a signature of the shelf it was drafted from. When
-- a document is added, removed, renamed or re-read the signature changes
-- and the next visitor's page asks for a fresh draft.
--
-- material_read is the learner's own trail through the library: what they
-- have opened and what they have pinned. It is theirs alone — never shown
-- to another learner — and it is not progress: opening a document does not
-- complete a step.

CREATE TABLE IF NOT EXISTS library_cache (
  key         TEXT PRIMARY KEY,      -- "insights:<course>" / "quiz:<material>:<lang>"
  signature   TEXT,
  data        TEXT NOT NULL,         -- JSON
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS material_read (
  user_id          TEXT NOT NULL,
  material_id      TEXT NOT NULL,
  course_id        TEXT NOT NULL,
  first_opened_at  TEXT,
  last_opened_at   TEXT,
  opens            INTEGER NOT NULL DEFAULT 0,
  pinned           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, material_id)
);
CREATE INDEX IF NOT EXISTS idx_material_read_course ON material_read (user_id, course_id);
