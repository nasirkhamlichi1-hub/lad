-- ─────────────────────────────────────────────────────────────────────
-- 006 — AI Trainer: record which engine ran each session
-- ─────────────────────────────────────────────────────────────────────
-- The trainer now has two engines:
--   'tavus'   — premium photoreal bundled avatar
--   'browser' — scalable engine: Anam face + Claude brain + ElevenLabs voice
--               + in-browser perception (the cheap-to-scale alternative)
-- We tag each session so analytics and the resume flow know which one ran.

ALTER TABLE trainer_sessions ADD COLUMN engine TEXT DEFAULT 'tavus';
