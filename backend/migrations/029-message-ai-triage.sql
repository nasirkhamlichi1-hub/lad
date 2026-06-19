-- 029-message-ai-triage.sql
-- Maryam acts as the first responder in the support inbox: she attempts to help
-- when a lawyer or firm opens a conversation, and escalates to a human when she
-- can't. These flags let the admin queue tell AI-answered threads from ones that
-- need a person.
--   ai_handled : Maryam has posted at least one reply on this thread
--   escalated  : Maryam handed off to a human (needs CLPD officer attention)
ALTER TABLE conversations ADD COLUMN ai_handled INTEGER DEFAULT 0;
ALTER TABLE conversations ADD COLUMN escalated INTEGER DEFAULT 0;
