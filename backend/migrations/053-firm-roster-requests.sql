-- ─────────────────────────────────────────────────────────────────────
-- 053 — Firms manage their own roster; transfers between firms go to LAD
-- ─────────────────────────────────────────────────────────────────────
-- A firm compliance officer can add a lawyer who is on the Department's roll
-- and currently attached to no firm, and can remove a lawyer from their own
-- roster. Both act directly on lawyers.firm_id and are written to the CRM
-- activity timeline, so the Department sees every change.
--
-- What a firm cannot do on its own is take a lawyer from another firm. The
-- roll is the Department's register; a move between two regulated firms is
-- a fact the Department records, not one a firm asserts. So that case
-- becomes a request in this table, decided by a LAD admin. The lawyer's row
-- does not change until the decision is approved.
CREATE TABLE IF NOT EXISTS firm_roster_requests (
  id                TEXT PRIMARY KEY,
  lawyer_id         TEXT NOT NULL,
  from_firm_id      TEXT,                              -- where the lawyer is now (NULL = unaffiliated)
  to_firm_id        TEXT NOT NULL,                     -- the firm asking
  requested_by      TEXT,                              -- staff id of the compliance officer
  requested_by_name TEXT,
  note              TEXT,                              -- the firm's reason, optional
  status            TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | declined | cancelled
  decided_by        TEXT,
  decided_by_name   TEXT,
  decided_at        TEXT,
  decision_note     TEXT,
  created_at        TEXT NOT NULL,
  FOREIGN KEY (lawyer_id) REFERENCES lawyers (id)
);
CREATE INDEX IF NOT EXISTS idx_roster_req_status ON firm_roster_requests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_roster_req_firm   ON firm_roster_requests (to_firm_id, status);
