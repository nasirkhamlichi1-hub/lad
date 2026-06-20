-- The Users admin list (GET /admin/users) selects last_login_at from BOTH the
-- lawyers and staff tables, but the column only ever existed on lawyers. Any
-- list that included staff (i.e. every load without a role=lawyer filter) threw
-- "no such column: last_login_at" and returned 500 Internal Server Error.
-- Add the column to staff so the list loads and staff sign-ins can be recorded.
ALTER TABLE staff ADD COLUMN last_login_at TEXT;
