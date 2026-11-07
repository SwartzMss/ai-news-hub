export const reportDeletionMigration = {
  version: 11,
  name: 'report_deletions',
  sql: `
 CREATE TABLE report_deletions (
   report_id TEXT PRIMARY KEY NOT NULL,
   channel TEXT NOT NULL,
   report_date TEXT NOT NULL,
   version INTEGER NOT NULL,
   status TEXT NOT NULL CHECK (status IN ('pending','failed','succeeded')),
   error_code TEXT,
   created_at TEXT NOT NULL,
   updated_at TEXT NOT NULL
 ) STRICT;
 CREATE INDEX deleted_report_versions ON report_deletions(channel,report_date,version);
`,
};
