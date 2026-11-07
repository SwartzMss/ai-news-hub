PRAGMA foreign_keys = ON;

CREATE TABLE newsletter_subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'unsubscribed')),
  confirmation_hash TEXT,
  confirmation_expires_at INTEGER,
  confirmation_sent_at INTEGER,
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX newsletter_subscribers_status ON newsletter_subscribers(status);
CREATE UNIQUE INDEX newsletter_subscribers_confirmation ON newsletter_subscribers(confirmation_hash) WHERE confirmation_hash IS NOT NULL;

CREATE TABLE newsletter_rate_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL CHECK (hits >= 0),
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX newsletter_rate_limits_expiry ON newsletter_rate_limits(expires_at);

CREATE TABLE newsletter_digests (
  day TEXT PRIMARY KEY,
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE newsletter_deliveries (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL REFERENCES newsletter_subscribers(id),
  day TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'uncertain')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  lease_until INTEGER,
  provider_id TEXT,
  error_code TEXT,
  UNIQUE(subscriber_id, day)
) STRICT;
CREATE INDEX newsletter_deliveries_work ON newsletter_deliveries(day, status);
