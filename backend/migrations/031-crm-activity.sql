-- 031-crm-activity.sql
-- Turn the support inbox into a CRM: AI triage tags every conversation, work is
-- routed to a single owner instead of the whole team, and every interaction is
-- written to one activity log that powers a per-firm / per-lawyer timeline.

-- ── Conversation triage metadata (set by Maryam) ──
ALTER TABLE conversations ADD COLUMN category TEXT;            -- compliance | credits | bookings | accreditation | technical | general
ALTER TABLE conversations ADD COLUMN priority TEXT DEFAULT 'normal'; -- low | normal | high

-- ── Routing ownership ──
ALTER TABLE staff ADD COLUMN speciality TEXT;                  -- the category this admin handles (optional)
ALTER TABLE firms ADD COLUMN account_owner TEXT;              -- staff id who owns this firm relationship (optional)

-- ── Unified activity log — the CRM timeline ──
CREATE TABLE IF NOT EXISTS activity_log (
  id          TEXT PRIMARY KEY,
  firm_id     TEXT,                 -- the firm this activity relates to (nullable)
  lawyer_id   TEXT,                 -- the lawyer this activity relates to (nullable)
  kind        TEXT NOT NULL,        -- message_in | ai_reply | escalation | assignment | status_change | note | booking | credit_purchase
  actor_type  TEXT,                 -- requester | ai | admin | system
  actor_id    TEXT,
  actor_name  TEXT,
  summary     TEXT,                 -- human-readable one-liner
  ref_type    TEXT,                 -- conversation | booking | transaction | ...
  ref_id      TEXT,
  meta        TEXT,                 -- optional JSON
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_firm    ON activity_log (firm_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_lawyer  ON activity_log (lawyer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_ref     ON activity_log (ref_type, ref_id);
