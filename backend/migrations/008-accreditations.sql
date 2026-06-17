-- ─────────────────────────────────────────────────────────────────────
-- 008 — Accreditations (review-workspace + firm session model)
-- ─────────────────────────────────────────────────────────────────────
-- Backs the provider-portal application form, the firm-portal internal
-- session submissions, and the LAD accreditation review workspace. The full
-- submission is stored as JSON `payload`; workflow state (status, reviewers,
-- rubric scores, decision, issued code, award timestamp) lives in columns.
-- CPD attendance is recorded in cpd_records (migration 007).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accreditations (
  ref                TEXT PRIMARY KEY,            -- e.g. 'LAD-MQI1WVHP' or 'ACC-7QX2A'
  type               TEXT DEFAULT 'new',          -- new / provider_registration / session_submission / renewal / amendment
  status             TEXT NOT NULL DEFAULT 'pending',  -- pending / approved / rejected / returned
  payload            TEXT,                        -- JSON blob of the submission
  submitted_by       TEXT,
  submitted_by_email TEXT,
  submitted_at       TEXT DEFAULT CURRENT_TIMESTAMP,
  reviewer1          TEXT,
  reviewer2          TEXT,
  scores             TEXT,                        -- JSON {r1:{},r2:{},ai:{}}
  final_points       INTEGER,
  final_credits      INTEGER,
  ai_rationale       TEXT,
  reviewed_by        TEXT,
  reviewed_at        TEXT,
  accreditation_code TEXT,                        -- issued / linked course code
  points_awarded_at  TEXT,                        -- set once attendee points are awarded (idempotency)
  created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_accreditations_status ON accreditations (status);
CREATE INDEX IF NOT EXISTS idx_accreditations_code   ON accreditations (accreditation_code);
CREATE INDEX IF NOT EXISTS idx_accreditations_email  ON accreditations (submitted_by_email);
