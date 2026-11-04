export const managedTasksMigration = {
  version: 7,
  name: "managed_tasks_and_schedules",
  sql: `
 ALTER TABLE tasks ADD COLUMN configuration_json TEXT CHECK (configuration_json IS NULL OR json_valid(configuration_json));
 ALTER TABLE tasks ADD COLUMN next_run_at TEXT;
 ALTER TABLE tasks ADD COLUMN deleted_at TEXT;
 ALTER TABLE task_runs ADD COLUMN configuration_json TEXT CHECK (configuration_json IS NULL OR json_valid(configuration_json));
 ALTER TABLE report_approvals ADD COLUMN approval_kind TEXT NOT NULL DEFAULT 'manual' CHECK (approval_kind IN ('manual','automatic'));
`,
};
