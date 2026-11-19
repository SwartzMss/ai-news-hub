ALTER TABLE auth_sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0 CHECK (last_seen_at >= 0);
UPDATE auth_sessions SET last_seen_at = created_at;
CREATE INDEX auth_sessions_idle_expiry ON auth_sessions(last_seen_at);
ALTER TABLE auth_email_tokens ADD COLUMN consumption_id TEXT;

CREATE TABLE auth_rate_limits (
  key_hash TEXT PRIMARY KEY CHECK (length(key_hash) = 64),
  window_start INTEGER NOT NULL CHECK (window_start >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > window_start),
  attempts INTEGER NOT NULL CHECK (attempts > 0)
) STRICT;
CREATE INDEX auth_rate_limits_expiry ON auth_rate_limits(expires_at);
