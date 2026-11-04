import { managedTasksMigration } from './managed-tasks-migration.js';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../errors.js';
import { taskEngineMigration } from './task-engine-migration.js';
import { publicationMigration } from './publication-migration.js';
import { newsMigration } from './news-migration.js';
import { researchMigration } from './research-migration.js';
import { settingsMigration } from './settings-migration.js';

export interface Migration { version: number; name: string; sql: string }
export const migrations: readonly Migration[] = [{
  version: 1, name: 'initial_schema', sql: `
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      channel TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
      schedule TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;
    CREATE TABLE task_runs (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
      idempotency_key TEXT NOT NULL,
      trigger_kind TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_kind IN ('manual', 'scheduled', 'retry')),
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'waiting_approval', 'succeeded', 'failed', 'cancelled', 'interrupted')),
      thread_id TEXT,
      turn_id TEXT,
      started_at TEXT,
      finished_at TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE (task_id, idempotency_key)
    ) STRICT;
    CREATE INDEX task_runs_by_task ON task_runs(task_id, created_at);
    CREATE INDEX task_runs_by_status ON task_runs(status, created_at);
    CREATE TABLE articles (
      id TEXT PRIMARY KEY NOT NULL,
      original_url TEXT NOT NULL,
      canonical_url TEXT NOT NULL UNIQUE,
      source_name TEXT NOT NULL,
      title TEXT NOT NULL,
      source_published_at TEXT,
      event_at TEXT,
      fetched_at TEXT NOT NULL,
      content_kind TEXT NOT NULL DEFAULT 'unverified' CHECK (content_kind IN ('fact', 'opinion', 'unverified')),
      content_text TEXT,
      content_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;
    CREATE INDEX articles_by_fetch ON articles(fetched_at);
    CREATE TABLE reports (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE RESTRICT,
      report_date TEXT NOT NULL,
      channel TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      title TEXT NOT NULL,
      body_markdown TEXT NOT NULL,
      content_json TEXT NOT NULL CHECK (json_valid(content_json)),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'approved', 'published', 'rejected')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE (channel, report_date, version)
    ) STRICT;
    CREATE TABLE report_articles (
      report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
      position INTEGER NOT NULL CHECK (position >= 0),
      PRIMARY KEY (report_id, article_id),
      UNIQUE (report_id, position)
    ) STRICT;
    CREATE TABLE publication_records (
      id TEXT PRIMARY KEY NOT NULL,
      report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
      target TEXT NOT NULL CHECK (target IN ('github', 'cloudflare_pages')),
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'publishing', 'succeeded', 'failed')),
      artifact_path TEXT,
      remote_url TEXT,
      error_code TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;
    CREATE INDEX publications_by_report ON publication_records(report_id, created_at);
  `,
}, taskEngineMigration, newsMigration, publicationMigration, researchMigration, settingsMigration, managedTasksMigration];

export function migrate(db: DatabaseSync, registry: readonly Migration[] = migrations): void {
  if (registry.some((entry, index) => entry.version !== index + 1)) throw new AppError('invalid_migration_registry');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT`);
    const applied = db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all();
    const checksum = (sql: string) => createHash('sha256').update(sql).digest('hex');
    for (const [index, row] of applied.entries()) {
      const expected = registry[index];
      if (!expected || row.version !== expected.version || row.name !== expected.name || row.checksum !== checksum(expected.sql)) {
        throw new AppError('migration_history_mismatch');
      }
    }
    for (const entry of registry.slice(applied.length)) {
      db.exec(entry.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)').run(entry.version, entry.name, checksum(entry.sql));
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
