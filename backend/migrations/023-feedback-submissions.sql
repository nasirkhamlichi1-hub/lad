-- Live participant feedback submissions (face-to-face & e-learning). Each row is
-- one attendee's rating on the 1–5 scale (Excellent=5 … Poor=1). These are
-- aggregated into 'live:' rows in course_feedback / provider_feedback so the
-- cards and command centre update automatically. Raw rows survive re-seeds.

CREATE TABLE IF NOT EXISTS feedback_responses (
  id           TEXT PRIMARY KEY,
  course_id    TEXT NOT NULL,
  provider_id  TEXT,                 -- resolved to the historical provider id
  session_id   TEXT,
  lawyer_id    TEXT,
  year         INTEGER,
  -- provider / trainer-delivery metrics
  knowledge    INTEGER,
  clarity      INTEGER,
  interaction  INTEGER,
  -- course metrics
  content      INTEGER,
  benefits     INTEGER,
  practical    INTEGER,
  overall      INTEGER,
  comment      TEXT,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_feedback_responses_course ON feedback_responses (course_id);
CREATE INDEX IF NOT EXISTS idx_feedback_responses_provider ON feedback_responses (provider_id);
