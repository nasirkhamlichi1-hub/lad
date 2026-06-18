-- Firm credit pool + ledger.
-- Until now credits lived only on lawyers (lawyers.credit_balance). Firms buy a
-- POOL of credits, then assign them out to their lawyers. This adds the pool
-- balance to firms and a dedicated ledger for firm-level movements (purchases
-- and assignments) so the firm wallet is real and auditable, mirroring the
-- lawyer credit journey.

ALTER TABLE firms ADD COLUMN credit_pool INTEGER DEFAULT 0;
ALTER TABLE firms ADD COLUMN total_purchased INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS firm_credit_transactions (
  id              TEXT PRIMARY KEY,
  firm_id         TEXT NOT NULL,
  type            TEXT NOT NULL,                 -- purchase / assign / refund
  amount          INTEGER NOT NULL,              -- + into pool, - out of pool
  aed_amount      INTEGER,                       -- AED paid (purchase) — null for assignments
  description     TEXT,
  payment_method  TEXT,
  reference       TEXT,
  lawyer_id       TEXT,                          -- set on assignments
  status          TEXT NOT NULL DEFAULT 'completed',
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_firm_credit_tx ON firm_credit_transactions (firm_id, created_at);
