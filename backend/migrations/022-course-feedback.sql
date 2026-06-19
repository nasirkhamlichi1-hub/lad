-- Mandatory-course feedback ratings (2025 + 2026), aggregated per course and per
-- training provider per year. Source: seed-data/feedback-aggregates.json, loaded
-- by scripts/seed-feedback.js. No individual trainer identities are stored.
--
-- Star scale: Excellent=5, Very Good=4, Good=3, Average=2, Poor=1.

CREATE TABLE IF NOT EXISTS course_feedback (
  course_key     TEXT NOT NULL,        -- normalised course name (stable join key)
  year           INTEGER NOT NULL,
  course_id      TEXT,                 -- resolved catalogue course (nullable)
  course_name    TEXT NOT NULL,
  provider_id    TEXT,
  provider_name  TEXT,
  responses      INTEGER NOT NULL DEFAULT 0,
  content        REAL,                 -- ★ Training course content
  benefits       REAL,                 -- ★ Benefits of the training course
  practical      REAL,                 -- ★ Practical / interesting content
  overall        REAL,                 -- ★ Overall evaluation of the course
  metrics_json   TEXT,                 -- full per-metric avg + distribution (drill-down)
  PRIMARY KEY (course_key, year)
);
CREATE INDEX IF NOT EXISTS idx_course_feedback_course ON course_feedback (course_id);

CREATE TABLE IF NOT EXISTS provider_feedback (
  provider_key   TEXT NOT NULL,        -- provider_id, or 'unmapped:<name>' when unresolved
  year           INTEGER NOT NULL,
  provider_id    TEXT,
  provider_name  TEXT NOT NULL,
  responses      INTEGER NOT NULL DEFAULT 0,
  knowledge      REAL,                 -- ★ Knowledge of trainer
  clarity        REAL,                 -- ★ Ability to convey information clearly
  interaction    REAL,                 -- ★ Ability to stimulate participants to interact
  metrics_json   TEXT,
  PRIMARY KEY (provider_key, year)
);
CREATE INDEX IF NOT EXISTS idx_provider_feedback_provider ON provider_feedback (provider_id);
