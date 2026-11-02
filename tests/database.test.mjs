import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, statSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../dist/apps/server/src/db/database.js';
import { migrate, migrations } from '../dist/apps/server/src/db/migrations.js';

test('migration initializes empty SQLite and preserves records after re-open', () => {
  const parent = mkdtempSync(join(tmpdir(), 'news-db-'));
  const dir = join(parent, 'state');
  let db;
  try {
    db = openDatabase(dir);
    for (const table of ['tasks', 'task_runs', 'articles', 'reports', 'report_articles', 'publication_records']) {
      assert.ok(db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', table));
    }
    db.prepare('INSERT INTO tasks (id, name, channel, prompt) VALUES (?, ?, ?, ?)').run('task-1', 'daily', 'ai', 'summarize');
    migrate(db);
    assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations').get().n, migrations.length);
    db.close(); db = openDatabase(dir);
    assert.equal(db.prepare('SELECT name FROM tasks WHERE id = ?').get('task-1').name, 'daily');
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.equal(statSync(join(dir, 'news.db')).mode & 0o777, 0o600);
  } finally { if (db?.isOpen) db.close(); rmSync(parent, { recursive: true, force: true }); }
});

test('foreign keys, Run idempotency and state constraints are enforced', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON'); migrate(db);
    assert.throws(() => db.prepare('INSERT INTO task_runs (id, task_id, idempotency_key) VALUES (?, ?, ?)').run('r', 'missing', 'day'));
    db.exec("INSERT INTO tasks (id, name, channel, prompt) VALUES ('t', 'daily', 'ai', 'summarize')");
    db.exec("INSERT INTO task_runs (id, task_id, idempotency_key) VALUES ('r', 't', 'day')");
    assert.throws(() => db.exec("INSERT INTO task_runs (id, task_id, idempotency_key) VALUES ('r2', 't', 'day')"));
    assert.throws(() => db.exec("UPDATE task_runs SET status = 'invented' WHERE id = 'r'"));
    assert.throws(() => db.exec("DELETE FROM tasks WHERE id = 't'"));
  } finally { db.close(); }
});

test('failed new migrations roll back SQL and version records together', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrate(db);
    const broken = { version: 2, name: 'broken', sql: 'CREATE TABLE temporary_change (id TEXT); INVALID SQL;' };
    assert.throws(() => migrate(db, [...migrations, broken]));
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'temporary_change'").get(), undefined);
    assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations').get().n, 1);
    migrate(db);
  } finally { db.close(); }
});

test('modified or newer migration history prevents startup', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrate(db);
    assert.throws(() => migrate(db, [{ ...migrations[0], sql: migrations[0].sql + '\n-- changed' }]), { code: 'migration_history_mismatch' });
    db.exec("INSERT INTO schema_migrations (version, name, checksum) VALUES (99, 'future', 'abc')");
    assert.throws(() => migrate(db), { code: 'migration_history_mismatch' });
  } finally { db.close(); }
});

test('unsafe directory permissions and symlink database are refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'news-perms-'));
  try {
    chmodSync(dir, 0o755);
    assert.throws(() => openDatabase(dir), { code: 'unsafe_data_permissions' });
    chmodSync(dir, 0o700);
    symlinkSync(join(dir, 'target'), join(dir, 'news.db'));
    assert.throws(() => openDatabase(dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('report provenance and publication idempotency survive SQLite constraints', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON'); migrate(db);
    db.exec("INSERT INTO tasks (id, name, channel, prompt) VALUES ('t', 'test', 'ai', 'test')");
    db.exec("INSERT INTO task_runs (id, task_id, idempotency_key) VALUES ('r', 't', 'day')");
    db.prepare(`INSERT INTO articles (id, original_url, canonical_url, source_name, title, source_published_at, event_at, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('a', 'https://example.invalid/source', 'https://example.invalid/source', 'fixture', 'fixture', '2026-11-01T00:00:00Z', '2026-10-31T00:00:00Z', '2026-11-02T00:00:00Z');
    db.exec(`INSERT INTO reports (id, run_id, report_date, channel, title, body_markdown, content_json)
      VALUES ('report', 'r', '2026-11-02', 'ai', 'fixture', 'fixture', '{}')`);
    db.exec("INSERT INTO report_articles (report_id, article_id, position) VALUES ('report', 'a', 0)");
    const source = db.prepare('SELECT a.* FROM report_articles ra JOIN articles a ON ra.article_id = a.id WHERE ra.report_id = ?').get('report');
    assert.notEqual(source.source_published_at, source.event_at);
    assert.notEqual(source.event_at, source.fetched_at);
    db.exec("INSERT INTO publication_records (id, report_id, target, idempotency_key) VALUES ('p', 'report', 'github', 'github/report/v1')");
    assert.throws(() => db.exec("INSERT INTO publication_records (id, report_id, target, idempotency_key) VALUES ('p2', 'report', 'github', 'github/report/v1')"));
    assert.throws(() => db.exec("UPDATE reports SET content_json = 'not-json' WHERE id = 'report'"));
    assert.throws(() => db.exec("DELETE FROM articles WHERE id = 'a'"));
  } finally { db.close(); }
});
