-- ─────────────────────────────────────────────────────────────────────
-- 004 — Course accreditation workflow + CPD attendance records
-- ─────────────────────────────────────────────────────────────────────
-- Implements the production flow:
--   provider/firm applies (A1 organisation + A2 course)
--     → LAD reviewer runs an AI assessment (suggested points / verdict)
--     → reviewer approves (a unique course code is issued) or rejects
--     → on completion the provider uploads attendees against the code
--     → each attendee's CPD points are recorded (and added to the
--       lifetime total of any matched lawyer account).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accreditation_applications (
  id                 TEXT PRIMARY KEY,            -- e.g. 'ACC-3F9K2'
  -- A1 — organisation / provider
  org_name           TEXT NOT NULL,
  org_type           TEXT,                        -- provider / firm / university / other
  contact_name       TEXT,
  contact_email      TEXT,
  phone              TEXT,
  website            TEXT,
  about              TEXT,
  -- A2 — course
  title              TEXT NOT NULL,
  format             TEXT,                        -- face-to-face / e-learning / hybrid
  duration_hours     REAL,
  cpd_points         INTEGER DEFAULT 0,           -- points requested
  areas              TEXT,                        -- comma-separated practice areas
  summary            TEXT,
  outcomes           TEXT,
  -- workflow
  status             TEXT NOT NULL DEFAULT 'pending',  -- pending / approved / rejected
  course_code        TEXT UNIQUE,                 -- issued on approval, e.g. 'CLPD-7QX2A'
  ai_score           TEXT,                        -- JSON {recommendedPoints,score,verdict,rationale,flags}
  decision_reason    TEXT,
  submitted_by_id    TEXT,
  submitted_by_type  TEXT,                        -- 'lawyer' | 'staff'
  submitted_by_email TEXT,
  reviewed_by_id     TEXT,
  reviewed_by_email  TEXT,
  reviewed_at        TEXT,
  created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_accred_status    ON accreditation_applications (status);
CREATE INDEX IF NOT EXISTS idx_accred_code      ON accreditation_applications (course_code);
CREATE INDEX IF NOT EXISTS idx_accred_submitter ON accreditation_applications (submitted_by_email);

CREATE TABLE IF NOT EXISTS cpd_records (
  id                TEXT PRIMARY KEY,
  attendee_email    TEXT NOT NULL,
  attendee_name     TEXT,
  lawyer_id         TEXT,                         -- matched lawyer account, if any
  course_code       TEXT NOT NULL,
  course_title      TEXT,
  provider          TEXT,
  points            INTEGER DEFAULT 0,
  recorded_by_id    TEXT,
  recorded_by_email TEXT,
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (attendee_email, course_code)            -- one record per attendee per course
);

CREATE INDEX IF NOT EXISTS idx_cpd_email  ON cpd_records (attendee_email);
CREATE INDEX IF NOT EXISTS idx_cpd_code   ON cpd_records (course_code);
CREATE INDEX IF NOT EXISTS idx_cpd_lawyer ON cpd_records (lawyer_id);
