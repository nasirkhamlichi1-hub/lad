-- ─────────────────────────────────────────────────────────────────────
-- 010 — Credit purchase requests
-- ─────────────────────────────────────────────────────────────────────
-- Until a payment gateway (Network International / Telr / Stripe) is wired,
-- "Buy credits" creates a pending request that LAD Admin confirms. On
-- confirmation the credits land on the buyer's lawyer balance and a
-- credit_transactions row is written. Requests are keyed by email so both
-- lawyers and firm officers can raise them.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS credit_requests (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  lawyer_id     TEXT,                       -- resolved buyer, if a lawyer account matches
  credits       INTEGER NOT NULL,
  aed_amount    INTEGER,                    -- price at request time
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending / confirmed / cancelled
  note          TEXT,
  requested_by  TEXT,                       -- token email/id that raised it
  confirmed_by  TEXT,
  confirmed_at  TEXT,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_requests_email  ON credit_requests (email);
CREATE INDEX IF NOT EXISTS idx_credit_requests_status ON credit_requests (status);
