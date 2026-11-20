import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, NOW } from './fixtures/auth.mjs';
import { cleanupUserDb } from '../deploy/user-cleanup/cleanup.mjs';

test('hourly privacy cleanup removes expired auth records and keeps active sessions', async t => {
  const f = fixture(); t.after(() => f.close());
  f.db.prepare(`INSERT INTO users(id,email_normalized,password_hash,email_verified_at,created_at,updated_at)
    VALUES('u1','user@example.com','hash',1,1,1)`).run();
  const insertSession = f.db.prepare(`INSERT INTO auth_sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at)
    VALUES (?,'u1',?,?,?,?)`);
  insertSession.run('active', 'a'.repeat(64), 1, NOW + 100000, NOW);
  insertSession.run('expired', 'b'.repeat(64), 1, NOW - 1, 1);
  f.db.prepare(`INSERT INTO auth_email_tokens(id,user_id,token_hash,purpose,created_at,expires_at,consumed_at)
    VALUES ('old','u1',?,'verify_email',1,?,NULL)`).run('c'.repeat(64), NOW - 1);
  f.db.prepare(`INSERT INTO auth_rate_limits(key_hash,window_start,expires_at,attempts) VALUES(?,1,?,1)`).run('d'.repeat(64), NOW - 1);
  await cleanupUserDb(f.env.USER_DB, NOW);
  assert.deepEqual(f.db.prepare('SELECT id FROM auth_sessions').all().map(row => row.id), ['active']);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM auth_email_tokens').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM auth_rate_limits').get().n, 0);
});
