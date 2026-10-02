-- ─────────────────────────────────────────────────────────────────────
-- 057 — Bilingual course text: Arabic alongside English
-- ─────────────────────────────────────────────────────────────────────
-- The portal's chrome switches cleanly between Arabic and English (the
-- lad-i18n switch), but a course's own words — its title, the line on
-- the card, the welcome at the top of the hub, each step's name — were
-- single-language: whatever the author typed, in whatever language.
-- On the Arabic site an English title leaked through; on the English
-- site an Arabic one did.
--
-- Each of those fields now has an `_ar` twin. The author fills in both;
-- the learner pages pick the one matching the active language and fall
-- back to the other when it is empty, so a half-translated course still
-- reads rather than going blank. Nothing here changes any existing row:
-- the new columns are NULL until an author fills them in.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE course_module ADD COLUMN title_ar   TEXT;
ALTER TABLE course_module ADD COLUMN summary_ar TEXT;
ALTER TABLE course_module ADD COLUMN welcome_ar TEXT;

ALTER TABLE activity ADD COLUMN title_ar   TEXT;
ALTER TABLE activity ADD COLUMN summary_ar TEXT;
