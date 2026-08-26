-- ─────────────────────────────────────────────────────────────────────
-- 048 — AI Trainer: record which learning BOT ran each session
-- ─────────────────────────────────────────────────────────────────────
-- A "bot" is one AI teacher: a photoreal Anam face + voice, a persona and a
-- teaching charter (backend/bots/*.json, services/botRegistry.js). Several
-- bots share the same lesson library, brain and progress tracking, so a
-- session has to remember which one taught it — for analytics, and so that
-- /trainer/turn rebuilds the right persona on every turn instead of trusting
-- a bot id sent by the browser.
--
-- Existing rows predate the registry and were all taught by the original
-- trainer, so they backfill to 'clpd-trainer'.

ALTER TABLE trainer_sessions ADD COLUMN bot_id TEXT DEFAULT 'clpd-trainer';

UPDATE trainer_sessions SET bot_id = 'clpd-trainer' WHERE bot_id IS NULL;
