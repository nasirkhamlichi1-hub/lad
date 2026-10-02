-- ─────────────────────────────────────────────────────────────────────
-- 058 — Bilingual files: an Arabic file beside the English one
-- ─────────────────────────────────────────────────────────────────────
-- 057 gave every course its words in both languages. The files were still
-- single-language: one SCORM package or document per step, one file per
-- library item, whatever language it happened to be in.
--
-- A step now carries two materials — the one the English site opens and
-- the one the Arabic site opens — and falls back to whichever exists when
-- only one has been uploaded. A library item is stored as a PAIR of
-- material rows, one per language, linked through pair_id; the learner
-- page shows the row that matches the site language and hides its twin.
-- Nothing here changes an existing row: the new columns are NULL, which
-- means "shown to everyone, in whatever language it was uploaded".

ALTER TABLE activity ADD COLUMN material_id_ar TEXT;

ALTER TABLE course_materials ADD COLUMN lang     TEXT;   -- 'en' | 'ar' | NULL (both)
ALTER TABLE course_materials ADD COLUMN title_ar TEXT;
ALTER TABLE course_materials ADD COLUMN pair_id  TEXT;   -- the same item in the other language
