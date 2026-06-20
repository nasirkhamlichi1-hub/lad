-- 033-activity-tags-retention.sql
-- Make the unified activity log a complete, searchable, AI-readable audit trail.
--
-- Every transaction and action on the platform is written here, tagged so the
-- admin team can search it and so Maryam (the AI) can reason over it. Entries
-- are attributed to a lawyer and/or firm so they also surface on those records'
-- activity timelines. Retention policy: keep for at least 4 years (see
-- services/activity.js — nothing prunes younger than that).

-- AI-readable classification + free-text tags for search.
ALTER TABLE activity_log ADD COLUMN category TEXT;   -- credits | bookings | accreditation | account | course | message | compliance | system
ALTER TABLE activity_log ADD COLUMN tags     TEXT;   -- space-separated tags, e.g. "credits purchase refund firm"

-- Money value attached to financial actions, so credits always reconcile to AED.
ALTER TABLE activity_log ADD COLUMN aed      REAL;

-- Search / retention indexes.
CREATE INDEX IF NOT EXISTS idx_activity_created  ON activity_log (created_at);
CREATE INDEX IF NOT EXISTS idx_activity_kind     ON activity_log (kind, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_category ON activity_log (category, created_at);
