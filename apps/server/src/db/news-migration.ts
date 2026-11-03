export const newsMigration = {
  version: 3, name: 'rss_collection_and_reports', sql: `
    ALTER TABLE articles ADD COLUMN last_seen_at TEXT;
    UPDATE articles SET last_seen_at=fetched_at;
    CREATE TABLE rss_sources (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      feed_url TEXT NOT NULL,
      last_attempt_at TEXT,
      last_success_at TEXT,
      last_error_code TEXT,
      etag TEXT,
      last_modified TEXT
    ) STRICT;
    CREATE TABLE rss_entries (
      source_id TEXT NOT NULL REFERENCES rss_sources(id),
      entry_key TEXT NOT NULL,
      article_id TEXT NOT NULL REFERENCES articles(id),
      PRIMARY KEY (source_id,entry_key)
    ) STRICT;
    CREATE TABLE article_fingerprints (
      source_id TEXT NOT NULL REFERENCES rss_sources(id),
      fingerprint TEXT NOT NULL,
      article_id TEXT NOT NULL REFERENCES articles(id),
      PRIMARY KEY (source_id,fingerprint)
    ) STRICT;
    CREATE TABLE rss_feed_items (
      source_id TEXT NOT NULL REFERENCES rss_sources(id),
      position INTEGER NOT NULL,
      article_id TEXT NOT NULL REFERENCES articles(id),
      PRIMARY KEY (source_id,position),
      UNIQUE (source_id,article_id)
    ) STRICT;
    CREATE TABLE news_runs (
      run_id TEXT PRIMARY KEY NOT NULL REFERENCES task_runs(id),
      source_id TEXT NOT NULL REFERENCES rss_sources(id),
      report_date TEXT NOT NULL,
      channel TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      candidates_json TEXT NOT NULL CHECK (json_valid(candidates_json)),
      report_id TEXT UNIQUE REFERENCES reports(id)
    ) STRICT;
  `,
};
