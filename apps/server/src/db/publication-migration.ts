export const publicationMigration = {
  version: 4,
  name: "approved_github_publications",
  sql: `
 CREATE TABLE report_approvals (
   report_id TEXT PRIMARY KEY NOT NULL REFERENCES reports(id),
   content_hash TEXT NOT NULL,
   approved_at TEXT NOT NULL
 ) STRICT;
 ALTER TABLE publication_records ADD COLUMN repository TEXT;
 ALTER TABLE publication_records ADD COLUMN branch TEXT;
 ALTER TABLE publication_records ADD COLUMN content_hash TEXT;
 ALTER TABLE publication_records ADD COLUMN commit_sha TEXT;
 ALTER TABLE publication_records ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
`,
};
