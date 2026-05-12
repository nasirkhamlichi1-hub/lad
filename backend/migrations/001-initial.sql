-- ─────────────────────────────────────────────────────────────────────
-- LAD CLPD — Database schema
-- ─────────────────────────────────────────────────────────────────────
-- Designed to mirror the structure of Blank_data_25.xlsx. Identifiers
-- (lawyer_id, firm_id, etc.) match those in the source spreadsheet so
-- analytics can round-trip back to source records.

PRAGMA foreign_keys = ON;

-- ─── Reference data ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS firms (
  id              TEXT PRIMARY KEY,            -- short slug, e.g. 'galadari'
  name            TEXT NOT NULL,               -- display name, e.g. 'Galadari Advocates'
  full_name       TEXT,                        -- full registered name from spreadsheet
  abbreviation    TEXT,
  size            INTEGER,                     -- # practising lawyers
  status          TEXT DEFAULT 'practising',   -- practising / inactive / left
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS providers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  full_name       TEXT,
  accredited      INTEGER DEFAULT 1,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS courses (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  category        TEXT,
  type            TEXT,                        -- mandatory / accredited / e-learning
  format          TEXT,                        -- face-to-face / e-learning / hybrid
  pts             INTEGER NOT NULL DEFAULT 0,  -- CLPD points per attendance
  credits         INTEGER DEFAULT 5,           -- credit cost
  provider_id     TEXT,
  location        TEXT,
  description     TEXT,
  language        TEXT,
  active          INTEGER DEFAULT 1,
  bg              TEXT,                        -- gradient css for portal card
  icon            TEXT,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_id) REFERENCES providers (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS course_sessions (
  id              TEXT PRIMARY KEY,
  course_id       TEXT NOT NULL,
  scheduled_at    TEXT NOT NULL,                -- ISO 8601
  end_at          TEXT,
  capacity        INTEGER DEFAULT 60,
  seats_remaining INTEGER DEFAULT 60,
  venue           TEXT,
  language        TEXT,
  status          TEXT DEFAULT 'open',          -- open / waitlist / closed / cancelled
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_course ON course_sessions (course_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON course_sessions (scheduled_at);

-- ─── People ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lawyers (
  id                   TEXT PRIMARY KEY,         -- internal LAD ID, e.g. 'L-01494'
  uaepass_uuid         TEXT UNIQUE,              -- UAE Pass user UUID
  emirates_id          TEXT UNIQUE,              -- 784-YYYY-NNNNNNN-N
  unified_id           TEXT UNIQUE,              -- UAE Pass unifiedID
  first_name           TEXT,
  last_name            TEXT,
  first_name_ar        TEXT,
  last_name_ar         TEXT,
  email                TEXT,
  phone                TEXT,
  gender               TEXT,
  date_of_birth        TEXT,
  nationality          TEXT,
  firm_id              TEXT,
  role                 TEXT,                     -- Partner / Senior Associate / etc.
  practice_areas       TEXT,                     -- comma-separated specialisms
  qualification_country TEXT,
  joined_date          TEXT,
  admitted_year        INTEGER,
  preferred_language   TEXT DEFAULT 'English',
  status               TEXT DEFAULT 'active',    -- active / suspended / resigned / inactive
  credit_balance       INTEGER DEFAULT 0,
  total_purchased      INTEGER DEFAULT 0,
  total_refunded       INTEGER DEFAULT 0,
  lifetime_points      INTEGER DEFAULT 0,
  last_login_at        TEXT,
  created_at           TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at           TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (firm_id) REFERENCES firms (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_lawyers_firm ON lawyers (firm_id);
CREATE INDEX IF NOT EXISTS idx_lawyers_uaepass ON lawyers (uaepass_uuid);
CREATE INDEX IF NOT EXISTS idx_lawyers_emirates ON lawyers (emirates_id);
CREATE INDEX IF NOT EXISTS idx_lawyers_status ON lawyers (status);

-- LAD admins and firm compliance officers — separate from lawyers because
-- they may not be practitioners themselves.
CREATE TABLE IF NOT EXISTS staff (
  id                   TEXT PRIMARY KEY,
  uaepass_uuid         TEXT UNIQUE,
  emirates_id          TEXT UNIQUE,
  email                TEXT NOT NULL,
  first_name           TEXT,
  last_name            TEXT,
  role                 TEXT NOT NULL,            -- lad_admin / lad_intelligence / firm_compliance_officer / provider_admin
  firm_id              TEXT,
  provider_id          TEXT,
  status               TEXT DEFAULT 'active',
  password_hash        TEXT,
  created_at           TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (firm_id) REFERENCES firms (id) ON DELETE SET NULL,
  FOREIGN KEY (provider_id) REFERENCES providers (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_email ON staff (email);
CREATE INDEX IF NOT EXISTS idx_staff_uaepass ON staff (uaepass_uuid);

-- ─── Activity ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bookings (
  id              TEXT PRIMARY KEY,
  lawyer_id       TEXT NOT NULL,
  session_id      TEXT,                          -- nullable for free-text legacy imports
  course_id       TEXT NOT NULL,
  course_title    TEXT,                          -- denormalised — historical row may not match current course
  provider_id     TEXT,
  scheduled_at    TEXT,
  status          TEXT NOT NULL,                 -- booked / attended / cancelled / no-show / refunded
  points_earned   INTEGER DEFAULT 0,
  credits_used    INTEGER DEFAULT 0,
  language        TEXT,
  booked_by       TEXT,                          -- self / firm / admin
  booked_at       TEXT,
  admin_notes     TEXT,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lawyer_id) REFERENCES lawyers (id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES course_sessions (id) ON DELETE SET NULL,
  FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE SET NULL,
  FOREIGN KEY (provider_id) REFERENCES providers (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_lawyer ON bookings (lawyer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_course ON bookings (course_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings (scheduled_at);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id              TEXT PRIMARY KEY,
  lawyer_id       TEXT NOT NULL,
  type            TEXT NOT NULL,                 -- purchase / refund / transfer / use
  amount          INTEGER NOT NULL,              -- credits (positive or negative)
  aed_amount      INTEGER,                       -- AED cost (positive) or refund (negative)
  description     TEXT,
  payment_method  TEXT,
  reference       TEXT,                          -- order ref, refund ref, etc.
  status          TEXT NOT NULL DEFAULT 'completed',
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lawyer_id) REFERENCES lawyers (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transactions_lawyer ON credit_transactions (lawyer_id);

-- ─── CMS / content ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL,                 -- JSON string
  updated_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_by      TEXT
);

CREATE TABLE IF NOT EXISTS faq (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  question        TEXT NOT NULL,
  answer          TEXT NOT NULL,
  category        TEXT,
  display_order   INTEGER DEFAULT 100,
  active          INTEGER DEFAULT 1,
  updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ─── Auth & audit ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auth_sessions (
  id              TEXT PRIMARY KEY,              -- JWT jti
  user_id         TEXT NOT NULL,                 -- lawyer_id or staff_id
  user_type       TEXT NOT NULL,                 -- 'lawyer' | 'staff'
  role            TEXT NOT NULL,
  uaepass_uuid    TEXT,
  issued_at       TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at      TEXT NOT NULL,
  revoked         INTEGER DEFAULT 0,
  ip              TEXT,
  user_agent      TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON auth_sessions (expires_at);

-- OAuth `state` parameter store (1-time use, short TTL) — protects against CSRF
CREATE TABLE IF NOT EXISTS oauth_state (
  state           TEXT PRIMARY KEY,
  redirect        TEXT,
  created_at      INTEGER NOT NULL                 -- unix ms
);

CREATE TABLE IF NOT EXISTS audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id        TEXT,
  actor_type      TEXT,
  action          TEXT NOT NULL,
  target_type     TEXT,
  target_id       TEXT,
  details         TEXT,                            -- JSON
  ip              TEXT,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_log (created_at);
-- ─────────────────────────────────────────────────────────────────────
-- LAD CLPD — Skill Graph schema (Module 5b: Lawyer Capability Tracking)
-- ─────────────────────────────────────────────────────────────────────
-- Run AFTER schema.sql. Adds three tables that turn attended bookings
-- into a structured competency record per lawyer.
--
-- Design:
--   * taxonomies   — controlled vocabulary of legal skills/topics
--   * course_topics — many-to-many between courses and taxonomy nodes,
--                    weighted (0.0–1.0) for coverage prominence
--   * Skill graph derived-on-read from bookings + course_topics
--     (no materialised aggregate, so decay/freshness logic stays tunable)
--
-- The skills derivation lives in services/skills.js — see
-- computeLawyerSkills() and computeFirmCapabilities().

PRAGMA foreign_keys = ON;

-- ─── Controlled taxonomy ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS taxonomies (
  id              TEXT PRIMARY KEY,            -- e.g. 'dr.arbitration.difc'
  parent_id       TEXT,                        -- null at top level
  label           TEXT NOT NULL,               -- 'DIFC Arbitration'
  label_ar        TEXT,                        -- Arabic label
  description     TEXT,
  domain          TEXT NOT NULL,               -- top-level domain slug
  level           INTEGER NOT NULL DEFAULT 1,  -- 1=domain, 2=area, 3=topic
  display_order   INTEGER DEFAULT 100,
  active          INTEGER DEFAULT 1,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES taxonomies (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_taxonomies_parent ON taxonomies (parent_id);
CREATE INDEX IF NOT EXISTS idx_taxonomies_domain ON taxonomies (domain);

-- ─── Course → topic fingerprint ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS course_topics (
  course_id       TEXT NOT NULL,
  topic_id        TEXT NOT NULL,
  weight          REAL NOT NULL DEFAULT 0.5,   -- 0.0–1.0 coverage prominence
  source          TEXT DEFAULT 'manual',       -- 'ai' / 'reviewer' / 'manual'
  confirmed_by    TEXT,                        -- reviewer staff_id if reviewer-confirmed
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (course_id, topic_id),
  FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  FOREIGN KEY (topic_id) REFERENCES taxonomies (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_course_topics_topic ON course_topics (topic_id);
CREATE INDEX IF NOT EXISTS idx_course_topics_course ON course_topics (course_id);

-- ─── Skill events log ────────────────────────────────────────────────
-- One row per (lawyer, topic, booking) when attendance is recorded.
-- This is the audit trail; skill graph is computed from it.

CREATE TABLE IF NOT EXISTS skill_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  lawyer_id       TEXT NOT NULL,
  topic_id        TEXT NOT NULL,
  booking_id      TEXT NOT NULL,
  course_id       TEXT NOT NULL,
  weight          REAL NOT NULL,               -- copied from course_topics at the time
  points          INTEGER NOT NULL,            -- CPD points earned, copied from booking
  contribution    REAL NOT NULL,               -- weight * points (the depth delta before decay)
  is_self_booked  INTEGER DEFAULT 0,           -- 1 if lawyer self-booked (interest signal)
  attended_at     TEXT NOT NULL,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lawyer_id) REFERENCES lawyers (id) ON DELETE CASCADE,
  FOREIGN KEY (topic_id) REFERENCES taxonomies (id) ON DELETE CASCADE,
  FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  UNIQUE (lawyer_id, topic_id, booking_id)     -- no double-counting on replay
);

CREATE INDEX IF NOT EXISTS idx_skill_events_lawyer ON skill_events (lawyer_id);
CREATE INDEX IF NOT EXISTS idx_skill_events_topic ON skill_events (topic_id);
CREATE INDEX IF NOT EXISTS idx_skill_events_attended ON skill_events (attended_at);

-- ─── Decay / config table ────────────────────────────────────────────
-- Tunable parameters for the skill score calculation. LAD admins can
-- change these without a deploy.

CREATE TABLE IF NOT EXISTS skill_config (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL,
  description     TEXT,
  updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO skill_config (key, value, description) VALUES
  ('decay_half_life_years', '5',
    'Half-life in years for skill depth decay. After this many years a course contributes half its original weight.'),
  ('freshness_warning_months', '24',
    'Skills not refreshed within this many months are flagged as stale in the UI.'),
  ('freshness_stale_months', '48',
    'Skills not refreshed within this many months are flagged as critically stale.'),
  ('beginner_threshold', '2',
    'Depth score below this is shown as Beginner (1 light course).'),
  ('intermediate_threshold', '6',
    'Depth score at/above this is Intermediate (2–3 relevant courses).'),
  ('advanced_threshold', '14',
    'Depth score at/above this is Advanced (5+ relevant courses or several deep ones).');
