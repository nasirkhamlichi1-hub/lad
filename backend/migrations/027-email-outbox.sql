-- 027-email-outbox.sql
-- Transactional email outbox. Every user action that should notify someone by
-- email writes a row here SYNCHRONOUSLY (in the same request), and a background
-- worker drains the queue over SMTP with retry/backoff. This decouples sending
-- from the request: an SMTP outage queues mail and retries — it never fails a
-- booking, purchase or accreditation submission.
CREATE TABLE IF NOT EXISTS email_outbox (
  id               TEXT PRIMARY KEY,
  to_email         TEXT NOT NULL,
  to_name          TEXT,
  subject          TEXT NOT NULL,
  html             TEXT,
  body_text        TEXT,
  category         TEXT,                       -- booking | cancellation | credit_purchase | accreditation_submitted | accreditation_decision | points_awarded
  ref              TEXT,                        -- related domain id (booking id, ref, tx id…)
  dedupe_key       TEXT UNIQUE,                 -- INSERT OR IGNORE on this → never send the same notice twice
  status           TEXT DEFAULT 'queued',       -- queued | sent | failed
  attempts         INTEGER DEFAULT 0,
  last_error       TEXT,
  next_attempt_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
  sent_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON email_outbox (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_outbox_ref     ON email_outbox (ref);
