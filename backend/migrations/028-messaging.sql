-- 028-messaging.sql
-- Support-inbox messaging. Lawyers and firms open a conversation addressed to
-- "CLPD Admin"; the whole admin team sees the queue and any admin can assign a
-- conversation to a specific admin on duty. 1-to-1 between a requester
-- (a lawyer OR a firm) and the admin team — never lawyer↔lawyer or cross-firm.
CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  subject         TEXT,
  requester_type  TEXT NOT NULL,            -- 'lawyer' | 'firm'
  requester_id    TEXT NOT NULL,            -- lawyer id or firm id
  requester_name  TEXT,
  requester_email TEXT,
  firm_id         TEXT,                     -- the lawyer's firm, or the firm itself
  status          TEXT DEFAULT 'open',      -- open | pending | resolved | closed
  assigned_to     TEXT,                     -- staff id of the admin handling it
  assigned_name   TEXT,
  created_by      TEXT,                     -- user id who opened it
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  last_message_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_sender     TEXT DEFAULT 'requester'  -- 'requester' | 'admin' (drives unread)
);
CREATE INDEX IF NOT EXISTS idx_conv_requester ON conversations (requester_type, requester_id);
CREATE INDEX IF NOT EXISTS idx_conv_status    ON conversations (status, last_message_at);
CREATE INDEX IF NOT EXISTS idx_conv_assigned  ON conversations (assigned_to);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_side     TEXT NOT NULL,            -- 'requester' | 'admin'
  sender_id       TEXT,
  sender_name     TEXT,
  sender_role     TEXT,
  body            TEXT NOT NULL,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cmsg_conv ON conversation_messages (conversation_id, created_at);

-- Per-reader read state, so both the requester and each admin get accurate
-- unread badges independently.
CREATE TABLE IF NOT EXISTS conversation_reads (
  conversation_id TEXT NOT NULL,
  reader_id       TEXT NOT NULL,            -- user id (lawyer / firm officer / staff)
  last_read_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, reader_id)
);
