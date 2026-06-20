-- 034-immutable-financial-audit.sql
-- Financial and audit records are WRITE-ONCE. No one — not an admin, not a
-- super user, not a stray code path — may change or delete them. They are
-- preserved permanently for audit. Enforced at the database level with triggers
-- so the guarantee holds regardless of application logic.
--
--   • credit_transactions — every purchase / refund / adjustment (the money ledger)
--   • activity_log        — the unified, tagged audit trail
--   • audit_log           — the security audit log
--
-- INSERT is always allowed (append-only). UPDATE and DELETE raise and abort.

-- Money ledger
CREATE TRIGGER IF NOT EXISTS credit_tx_no_update
BEFORE UPDATE ON credit_transactions
BEGIN SELECT RAISE(ABORT, 'credit_transactions is an immutable financial record'); END;

CREATE TRIGGER IF NOT EXISTS credit_tx_no_delete
BEFORE DELETE ON credit_transactions
BEGIN SELECT RAISE(ABORT, 'credit_transactions is an immutable financial record'); END;

-- Unified activity / audit trail
CREATE TRIGGER IF NOT EXISTS activity_log_no_update
BEFORE UPDATE ON activity_log
BEGIN SELECT RAISE(ABORT, 'activity_log is an immutable audit record'); END;

CREATE TRIGGER IF NOT EXISTS activity_log_no_delete
BEFORE DELETE ON activity_log
BEGIN SELECT RAISE(ABORT, 'activity_log is an immutable audit record'); END;

-- Security audit log
CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is an immutable audit record'); END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is an immutable audit record'); END;
