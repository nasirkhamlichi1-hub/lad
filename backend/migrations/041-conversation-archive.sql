-- Archive layer on conversations: admins can archive a resolved/closed thread so
-- it drops out of the working inbox without being deleted. Archived threads stay
-- fully readable from the "Archived" view and can be restored at any time.
ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;  -- 0 active, 1 archived
ALTER TABLE conversations ADD COLUMN archived_at TEXT;
