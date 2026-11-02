export const taskEngineMigration = {
  version: 2,
  name: 'task_execution_history',
  sql: `
    CREATE TABLE run_threads (
      run_id TEXT PRIMARY KEY NOT NULL REFERENCES task_runs(id) ON DELETE RESTRICT,
      thread_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;
    CREATE TABLE run_turns (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE RESTRICT,
      sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 20),
      idempotency_key TEXT NOT NULL,
      input_text TEXT NOT NULL,
      thread_id TEXT REFERENCES run_threads(thread_id) ON DELETE RESTRICT,
      server_turn_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting_approval','succeeded','failed','cancelled','interrupted')),
      output_text TEXT,
      error_code TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE (run_id, sequence),
      UNIQUE (run_id, idempotency_key),
      UNIQUE (thread_id, server_turn_id)
    ) STRICT;
    CREATE TABLE run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE RESTRICT,
      turn_record_id TEXT REFERENCES run_turns(id) ON DELETE RESTRICT,
      kind TEXT NOT NULL,
      data_json TEXT NOT NULL CHECK (json_valid(data_json)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;
    CREATE INDEX events_by_run ON run_events(run_id, id);
    CREATE TABLE backend_owner (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      owner_id TEXT NOT NULL,
      pid INTEGER NOT NULL,
      process_start TEXT NOT NULL,
      boot_id TEXT NOT NULL
    ) STRICT;
  `,
};
