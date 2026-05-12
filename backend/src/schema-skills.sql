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
