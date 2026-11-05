export const codexReportedMigration={version:9,name:'codex_reported_provenance',sql:`
 ALTER TABLE codex_news_runs ADD COLUMN source_mode TEXT NOT NULL DEFAULT 'verified' CHECK(source_mode IN ('verified','codex_reported'));
 ALTER TABLE articles ADD COLUMN source_mode TEXT NOT NULL DEFAULT 'verified' CHECK(source_mode IN ('verified','codex_reported'));
`};
