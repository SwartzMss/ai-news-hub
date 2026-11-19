import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

test('security migration preserves sessions and creates durable rate limits', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(readFileSync(new URL('../users/migrations/0001.sql', import.meta.url), 'utf8'));
  db.prepare("INSERT INTO users VALUES ('u1','reader@example.com','hash',1,'active',1,1)").run();
  db.prepare("INSERT INTO auth_sessions VALUES ('s1','u1','token-hash',100,200,NULL)").run();
  db.exec(readFileSync(new URL('../users/migrations/0002.sql', import.meta.url), 'utf8'));
  assert.equal(db.prepare("SELECT last_seen_at FROM auth_sessions WHERE id='s1'").get().last_seen_at, 100);
  const key = 'a'.repeat(64);
  db.prepare('INSERT INTO auth_rate_limits (key_hash,window_start,expires_at,attempts) VALUES (?,100,200,1)').run(key);
  assert.throws(() => db.prepare('INSERT INTO auth_rate_limits VALUES (?,100,200,1)').run(key), /UNIQUE/);
  assert.throws(() => db.prepare('INSERT INTO auth_rate_limits VALUES (?,200,200,1)').run('b'.repeat(64)), /CHECK/);
});
