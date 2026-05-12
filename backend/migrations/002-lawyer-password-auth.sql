-- ─────────────────────────────────────────────────────────────────────
-- 002 — Password authentication for lawyers
-- ─────────────────────────────────────────────────────────────────────
-- Originally lawyers authenticated only via UAE Pass. While UAE Pass
-- production onboarding is in flight, we allow password sign-in too.
-- The column is nullable — UAE Pass remains the preferred flow once
-- credentials arrive (the routes will be additive, never destructive).

ALTER TABLE lawyers ADD COLUMN password_hash TEXT;

-- Index for email lookup (lawyer email already exists in the table but
-- isn't indexed because UAE Pass UUID was the primary lookup key)
CREATE INDEX IF NOT EXISTS idx_lawyers_email ON lawyers (LOWER(email));
