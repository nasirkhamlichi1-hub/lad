-- ─────────────────────────────────────────────────────────────────────
-- 050 — The author's own words on the hub
-- ─────────────────────────────────────────────────────────────────────
-- The learner's hub could show the journey but not explain it: there was
-- nowhere for the person who built a topic to say, in their own words, what
-- this course of study is, why it matters, and what the lawyer will be able
-- to do at the end. `welcome` holds that text on the topic's first section
-- (the one whose title and summary already name the topic), and the hub
-- renders it under the title, before the pathway.
ALTER TABLE course_module ADD COLUMN welcome TEXT;
