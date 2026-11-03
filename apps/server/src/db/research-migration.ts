export const researchMigration = {
  version: 5, name: 'codex_topic_research', sql: `
    UPDATE tasks SET status='paused' WHERE id='news-github';
    ALTER TABLE run_turns ADD COLUMN mode TEXT NOT NULL DEFAULT 'default'
      CHECK (mode IN ('default','research','finalize'));
    CREATE TABLE codex_news_runs (
      run_id TEXT PRIMARY KEY NOT NULL REFERENCES task_runs(id),
      topic TEXT NOT NULL,
      initial_input TEXT NOT NULL,
      report_date TEXT NOT NULL,
      channel TEXT NOT NULL,
      collected_at TEXT,
      candidates_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(candidates_json)),
      report_id TEXT UNIQUE REFERENCES reports(id)
    ) STRICT;
  `,
};
