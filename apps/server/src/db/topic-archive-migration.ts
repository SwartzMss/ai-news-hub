export const topicArchiveMigration = {
  version: 10,
  name: 'public_topic_snapshots',
  sql: `
 ALTER TABLE codex_news_runs ADD COLUMN public_topic_json TEXT CHECK (public_topic_json IS NULL OR json_valid(public_topic_json));
`,
};
