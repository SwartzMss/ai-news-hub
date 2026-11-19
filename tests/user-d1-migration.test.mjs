import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const migration = new URL('../users/migrations/0001.sql', import.meta.url);
const wranglerExample = new URL('../deploy/newsletter/wrangler.toml.example', import.meta.url);

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(migration, 'utf8'));
  return db;
}

const user = ['u1', 'reader@example.com', 'argon2id$example', null, 'active', 100, 100];
const insertUser = 'INSERT INTO users (id, email_normalized, password_hash, email_verified_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)';

test('user migration creates independent strict tables with required indexes and foreign keys', t => {
  const db = database(); t.after(() => db.close());
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'auth_sessions', 'auth_email_tokens') ORDER BY name").all().map(row => row.name), ['auth_email_tokens', 'auth_sessions', 'users']);
  for (const table of ['auth_sessions', 'auth_email_tokens']) {
    const keys = db.prepare(`PRAGMA foreign_key_list(${table})`).all();
    assert.equal(keys.length, 1);
    assert.equal(keys[0].table, 'users');
    assert.equal(keys[0].on_delete, 'CASCADE');
  }
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'auth_sessions_user_expiry'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'auth_email_tokens_user_purpose_expiry'").get());
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'newsletter_%'").get().n, 0);
});

test('users require normalized unique email, a password hash, valid status and timestamps', t => {
  const db = database(); t.after(() => db.close());
  db.prepare(insertUser).run(...user);
  assert.throws(() => db.prepare(insertUser).run('u2', user[1], 'argon2id$another', null, 'active', 100, 100), /UNIQUE/);
  assert.throws(() => db.prepare(insertUser).run('u2', 'Reader@Example.com', 'argon2id$another', null, 'active', 100, 100), /CHECK/);
  assert.throws(() => db.prepare(insertUser).run('u2', 'reader2@example.com', '', null, 'active', 100, 100), /CHECK/);
  assert.throws(() => db.prepare(insertUser).run('u2', 'reader2@example.com', 'argon2id$another', null, 'invalid', 100, 100), /CHECK/);
  assert.throws(() => db.prepare(insertUser).run('u2', 'reader2@example.com', 'argon2id$another', null, 'active', 101, 100), /CHECK/);
});

test('session and email tokens enforce hashed uniqueness, purpose, expiry and user ownership', t => {
  const db = database(); t.after(() => db.close());
  db.prepare(insertUser).run(...user);
  const session = db.prepare('INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)');
  session.run('s1', 'u1', 'session-hash-1', 100, 200, null);
  assert.throws(() => session.run('s2', 'u1', 'session-hash-1', 100, 200, null), /UNIQUE/);
  assert.throws(() => session.run('s2', 'missing', 'session-hash-2', 100, 200, null), /FOREIGN KEY/);
  assert.throws(() => session.run('s2', 'u1', 'session-hash-2', 200, 200, null), /CHECK/);
  assert.throws(() => session.run('s2', 'u1', '', 100, 200, null), /CHECK/);
  const email = db.prepare('INSERT INTO auth_email_tokens (id, user_id, token_hash, purpose, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  email.run('e1', 'u1', 'email-hash-1', 'verify_email', 100, 200, null);
  assert.throws(() => email.run('e2', 'u1', 'email-hash-1', 'reset_password', 100, 200, null), /UNIQUE/);
  assert.throws(() => email.run('e2', 'u1', 'email-hash-2', 'other', 100, 200, null), /CHECK/);
  assert.throws(() => email.run('e2', 'missing', 'email-hash-2', 'verify_email', 100, 200, null), /FOREIGN KEY/);
  assert.throws(() => email.run('e2', 'u1', 'email-hash-2', 'verify_email', 200, 200, null), /CHECK/);
  db.prepare('DELETE FROM users WHERE id = ?').run('u1');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_email_tokens').get().n, 0);
});

test('Pages example separates production user and preview user D1 bindings', () => {
  const config = readFileSync(wranglerExample, 'utf8');
  const production = config.split('[[env.preview.d1_databases]]')[0];
  const preview = config.split('[[env.preview.d1_databases]]').slice(1).join('');
  assert.match(production, /binding = "NEWSLETTER_DB"[\s\S]*migrations_dir = "newsletter\/migrations"/);
  assert.match(production, /binding = "USER_DB"[\s\S]*database_name = "ai-news-hub-users"[\s\S]*migrations_dir = "users\/migrations"/);
  assert.match(preview, /binding = "USER_DB"[\s\S]*database_name = "ai-news-hub-users-preview"[\s\S]*migrations_dir = "users\/migrations"/);
  assert.doesNotMatch(preview, /NEWSLETTER_DB|ai-news-hub-users"/);
  const productionUserId = production.match(/binding = "USER_DB"[\s\S]*?database_id = "([^"]+)"/)?.[1];
  const previewUserId = preview.match(/binding = "USER_DB"[\s\S]*?database_id = "([^"]+)"/)?.[1];
  assert.ok(productionUserId && previewUserId);
  assert.notEqual(productionUserId, previewUserId);
});
