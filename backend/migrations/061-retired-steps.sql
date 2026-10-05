-- ─────────────────────────────────────────────────────────────────────
-- 061 — A removed step stays removed
-- ─────────────────────────────────────────────────────────────────────
-- Removing a step that learners have attempted retires it rather than
-- deleting it: the attempts are evidence and must outlive the syllabus.
-- Retiring used to mean only "published = 0", which is also what a fresh
-- draft looks like — so the retired step stayed in the Topic Builder as a
-- draft, and the next Publish put it straight back on the course page.
--
-- retired_at marks the difference. A retired step is left out of the
-- builder, out of Publish and out of the sequence; its attempts and
-- progress rows stay where they are.

ALTER TABLE activity ADD COLUMN retired_at TEXT;
CREATE INDEX IF NOT EXISTS idx_activity_retired ON activity (course_id, retired_at);
