-- 038-password-reset-tokens.sql
-- Self-service password reset. We store only a SHA-256 hash of the emailed
-- token (never the raw token), with a short expiry and single-use semantics.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash   TEXT PRIMARY KEY,        -- sha256(raw token) — raw is only ever emailed
  user_type    TEXT NOT NULL,           -- 'lawyer' | 'staff'
  user_id      TEXT NOT NULL,
  email        TEXT,
  expires_at   TEXT NOT NULL,
  used_at      TEXT,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens (user_type, user_id);
CREATE INDEX IF NOT EXISTS idx_prt_expires ON password_reset_tokens (expires_at);
