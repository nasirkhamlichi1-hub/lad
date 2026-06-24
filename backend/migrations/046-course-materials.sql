-- Course materials: SCORM packages, slide decks, PDFs and other downloadable
-- files attendees get for e-learning / completed courses.
--   kind  = 'link'  → an external URL (best for large SCORM packages / videos)
--           'file'  → a small file stored inline (base64 in `data`)
--           'scorm' → a SCORM package, by URL or inline
-- Inline files are capped in the API to protect the SQLite row size; anything
-- large should be added as a link.
CREATE TABLE IF NOT EXISTS course_materials (
  id          TEXT PRIMARY KEY,
  course_id   TEXT NOT NULL,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'link',
  url         TEXT,
  file_name   TEXT,
  mime        TEXT,
  size        INTEGER DEFAULT 0,
  data        TEXT,            -- base64 payload for inline files (kind='file'/'scorm')
  created_by  TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_course_materials_course ON course_materials (course_id);
