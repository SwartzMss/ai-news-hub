PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY CHECK (length(id) > 0),
  email_normalized TEXT NOT NULL UNIQUE
    CHECK (length(email_normalized) > 0 AND email_normalized = lower(trim(email_normalized))),
  password_hash TEXT NOT NULL CHECK (length(password_hash) > 0),
  email_verified_at INTEGER CHECK (email_verified_at >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY CHECK (length(id) > 0),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) > 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  revoked_at INTEGER CHECK (revoked_at >= created_at)
) STRICT;
CREATE INDEX auth_sessions_user_expiry ON auth_sessions(user_id, expires_at);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE auth_email_tokens (
  id TEXT PRIMARY KEY CHECK (length(id) > 0),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) > 0),
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  consumed_at INTEGER CHECK (consumed_at >= created_at)
) STRICT;
CREATE INDEX auth_email_tokens_user_purpose_expiry
  ON auth_email_tokens(user_id, purpose, expires_at);
CREATE INDEX auth_email_tokens_expiry ON auth_email_tokens(expires_at);
