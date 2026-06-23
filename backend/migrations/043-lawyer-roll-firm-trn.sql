-- Admin-requested account fields:
--  • lawyers.roll_number — the Dubai legal-consultant ID / roll / registration
--    number the admin team searches and identifies a lawyer by (distinct from
--    our internal id like L-01494).
--  • firms.trn — the firm's Tax Registration Number (for VAT invoicing).
ALTER TABLE lawyers ADD COLUMN roll_number TEXT;
ALTER TABLE firms   ADD COLUMN trn TEXT;
CREATE INDEX IF NOT EXISTS idx_lawyers_roll ON lawyers (roll_number);
