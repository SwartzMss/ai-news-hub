CREATE TABLE favorites (
  id TEXT PRIMARY KEY CHECK (length(id) > 0),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_key TEXT NOT NULL CHECK (length(article_key) = 32 AND article_key NOT GLOB '*[^0-9a-f]*'),
  snapshot_version INTEGER NOT NULL CHECK (snapshot_version = 1),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json) AND length(snapshot_json) <= 131072),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (user_id, article_key)
) STRICT;
CREATE INDEX favorites_user_created ON favorites(user_id, created_at DESC, id DESC);
