-- 020-notifications.sql
-- In-system notifications: LAD admins message a lawyer, a firm, a segment, or
-- everyone. 'all'/'firm' rows are matched at read time; lawyer/segment sends
-- write one row per recipient.
CREATE TABLE IF NOT EXISTS notifications (
  id             TEXT PRIMARY KEY,
  recipient_type TEXT NOT NULL,             -- 'lawyer' | 'firm' | 'all'
  recipient_id   TEXT,                       -- lawyer id / firm id / NULL for 'all'
  title          TEXT,
  body           TEXT,
  level          TEXT DEFAULT 'info',        -- info | success | warning | urgent
  created_by     TEXT,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  read_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications (recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_notif_created   ON notifications (created_at);
