-- ─────────────────────────────────────────────────────────────────────
-- 063 — A course belongs to a track
-- ─────────────────────────────────────────────────────────────────────
-- The freelance portal teaches two kinds of thing: the law (legal
-- practice) and the running of a practice (operations). A course names
-- its track so the builder files it, the learner's home shelves it, and
-- progress is counted per track. NULL is a course nobody has placed yet —
-- shown everywhere, as before.

ALTER TABLE course_module ADD COLUMN track TEXT;
