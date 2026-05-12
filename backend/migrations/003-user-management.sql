-- ─────────────────────────────────────────────────────────────────────
-- 003 — User management lifecycle columns
-- ─────────────────────────────────────────────────────────────────────
-- Adds the columns needed for:
--   - First-login forced password change
--   - Password rotation tracking (when did this account last rotate?)
--   - Auditability of who created which account
--
-- The `lad_super_admin` role is just a new string value for staff.role —
-- the column is TEXT so no schema change is required to support it.
-- Role-checking happens in the middleware, not at the database layer.

-- Lawyers
ALTER TABLE lawyers ADD COLUMN must_change_password   INTEGER DEFAULT 0;
ALTER TABLE lawyers ADD COLUMN password_changed_at    TEXT;
ALTER TABLE lawyers ADD COLUMN created_by_id          TEXT;
ALTER TABLE lawyers ADD COLUMN created_by_type        TEXT;  -- 'staff' or 'lawyer' (self-registration future)

-- Staff
ALTER TABLE staff ADD COLUMN must_change_password   INTEGER DEFAULT 0;
ALTER TABLE staff ADD COLUMN password_changed_at    TEXT;
ALTER TABLE staff ADD COLUMN created_by_id          TEXT;
ALTER TABLE staff ADD COLUMN created_by_type        TEXT;

-- Useful index for the audit page that asks "who did this admin create?"
CREATE INDEX IF NOT EXISTS idx_lawyers_created_by ON lawyers (created_by_id);
CREATE INDEX IF NOT EXISTS idx_staff_created_by   ON staff (created_by_id);
