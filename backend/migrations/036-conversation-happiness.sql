-- Customer-happiness layer on conversations: every conversation (AI or human)
-- ends in a 1–5 star happiness rating, and we track first-response time so the
-- super-admin can see how quick AND how happy clients are with the service.
ALTER TABLE conversations ADD COLUMN rating INTEGER;            -- 1..5, set by the requester
ALTER TABLE conversations ADD COLUMN rating_at TEXT;
ALTER TABLE conversations ADD COLUMN first_response_at TEXT;    -- first reply (Maryam or admin)
