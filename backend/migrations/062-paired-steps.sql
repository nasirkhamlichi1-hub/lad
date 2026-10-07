-- ─────────────────────────────────────────────────────────────────────
-- 062 — Two halves of one lesson
-- ─────────────────────────────────────────────────────────────────────
-- A lesson is often taught two ways: an AI trainer session and the
-- e-learning module (Articulate) on the same subject. The course page used
-- to guess which steps belong together from their titles, so a module whose
-- title differed from its AI session's showed as a separate lesson.
--
-- pair_id names the step this one is taught alongside. It is set on both
-- steps, from the course builder, and the course page shows the two as one
-- lesson card with two ways in. Each step keeps its own progress and counts
-- on its own; NULL means the step stands alone (the title guess still
-- applies to steps nobody has paired).

ALTER TABLE activity ADD COLUMN pair_id TEXT;
