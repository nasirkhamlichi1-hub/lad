-- 032-crm-tasks.sql
-- Follow-up tasks for the CRM — an admin can set a task ("call back re: refund",
-- "chase attendance") against a firm or a lawyer, with a due date and owner.
CREATE TABLE IF NOT EXISTS crm_tasks (
  id          TEXT PRIMARY KEY,
  firm_id     TEXT,
  lawyer_id   TEXT,
  title       TEXT NOT NULL,
  due_at      TEXT,
  done        INTEGER DEFAULT 0,
  done_at     TEXT,
  created_by  TEXT,
  created_by_name TEXT,
  assigned_to TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_firm   ON crm_tasks (firm_id, done);
CREATE INDEX IF NOT EXISTS idx_tasks_lawyer ON crm_tasks (lawyer_id, done);
CREATE INDEX IF NOT EXISTS idx_tasks_open   ON crm_tasks (done, due_at);
