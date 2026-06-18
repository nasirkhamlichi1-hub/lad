-- 017-attendance-alerts.sql
-- Attendance-filing deadline engine for accredited internal sessions.
-- A firm must file attendees within 30 DAYS of accreditation. Escalating
-- reminders fire at day 20, 25, 29 and a FINAL alert at day 30 — shown to the
-- firm, the training provider and LAD, with an email logged at each milestone.

-- Idempotent log so each milestone's email/banner fires once per submission.
CREATE TABLE IF NOT EXISTS attendance_alert_log (
  ref         TEXT NOT NULL,
  milestone   INTEGER NOT NULL,        -- 20 / 25 / 29 / 30
  channel     TEXT NOT NULL,           -- 'email'
  recipient   TEXT,
  sent_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ref, milestone, channel)
);
CREATE INDEX IF NOT EXISTS idx_alertlog_ref ON attendance_alert_log (ref);

-- Demo: four Allen & Overy internal sessions accredited but still awaiting
-- attendance filing, aged 20 / 25 / 29 / 30 days (relative to the live date) so
-- the full escalation is visible immediately. points_awarded_at is NULL =
-- attendance not yet filed. INSERT OR IGNORE keeps it safe to re-run.
INSERT OR IGNORE INTO accreditations
  (ref, type, status, payload, submitted_by, submitted_by_email, submitted_at, reviewed_at, accreditation_code, final_points, created_at, updated_at)
VALUES
  ('ALL2690', 'session_submission', 'approved',
   '{"courseTitle":"Cross-Border M&A Masterclass","providerName":"Kwintessential","firm":"Allen Overy Shearman Sterling LLP","pointsPerLawyer":2,"lawyers":[]}',
   'co.allenovery@clpd.test', 'co.allenovery@clpd.test', datetime('now','-20 days'), datetime('now','-20 days'), 'ALL2690', 2, datetime('now','-20 days'), datetime('now','-20 days')),
  ('ALL2691', 'session_submission', 'approved',
   '{"courseTitle":"Banking Litigation Update","providerName":"Kwintessential","firm":"Allen Overy Shearman Sterling LLP","pointsPerLawyer":2,"lawyers":[]}',
   'co.allenovery@clpd.test', 'co.allenovery@clpd.test', datetime('now','-25 days'), datetime('now','-25 days'), 'ALL2691', 2, datetime('now','-25 days'), datetime('now','-25 days')),
  ('ALL2692', 'session_submission', 'approved',
   '{"courseTitle":"Data Protection in Practice","providerName":"Kwintessential","firm":"Allen Overy Shearman Sterling LLP","pointsPerLawyer":2,"lawyers":[]}',
   'co.allenovery@clpd.test', 'co.allenovery@clpd.test', datetime('now','-29 days'), datetime('now','-29 days'), 'ALL2692', 2, datetime('now','-29 days'), datetime('now','-29 days')),
  ('ALL2693', 'session_submission', 'approved',
   '{"courseTitle":"Competition Law Essentials","providerName":"Kwintessential","firm":"Allen Overy Shearman Sterling LLP","pointsPerLawyer":2,"lawyers":[]}',
   'co.allenovery@clpd.test', 'co.allenovery@clpd.test', datetime('now','-30 days'), datetime('now','-30 days'), 'ALL2693', 2, datetime('now','-30 days'), datetime('now','-30 days'));
