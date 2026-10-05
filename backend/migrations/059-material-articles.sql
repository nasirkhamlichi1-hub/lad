-- ─────────────────────────────────────────────────────────────────────
-- 059 — Material articles: the library, readable by the model
-- ─────────────────────────────────────────────────────────────────────
-- "Ask the library" answers a lawyer's question from the course's own
-- documents and nothing else, citing the article each sentence came from.
-- For that the server needs the TEXT of every material, split into the
-- articles a legal instrument is written in (المادة (3) / Article 3).
--
-- The text is extracted once, server-side, when a material is added or
-- the first time a question is asked (older rows), and kept here. The
-- original file is never touched; a material that cannot be read (a SCORM
-- package, a scanned page, a page the server cannot fetch) records why in
-- index_error and simply does not take part in answers.

ALTER TABLE course_materials ADD COLUMN text_content TEXT;
ALTER TABLE course_materials ADD COLUMN indexed_at   TEXT;
ALTER TABLE course_materials ADD COLUMN index_error  TEXT;

CREATE TABLE IF NOT EXISTS material_article (
  id           TEXT PRIMARY KEY,
  material_id  TEXT NOT NULL,
  course_id    TEXT NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  label        TEXT,                 -- "Article 3" / "المادة (3)" / "§ 2"
  body         TEXT NOT NULL,
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_material_article_course   ON material_article (course_id);
CREATE INDEX IF NOT EXISTS idx_material_article_material ON material_article (material_id, position);
