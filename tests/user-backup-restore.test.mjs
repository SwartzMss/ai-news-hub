import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { prepareRestoreSql } from '../scripts/prepare-user-restore.mjs';

const USER = '33333333-3333-4333-8333-333333333333';
test('restore preparation replays deletion tombstones after importing an older backup', () => {
  const migration = readFileSync(new URL('../users/migrations/0001.sql', import.meta.url), 'utf8');
  const oldDump = `${migration}\nINSERT INTO users(id,email_normalized,password_hash,email_verified_at,created_at,updated_at)
    VALUES('${USER}','deleted@example.com','hash',1,1,1);\n`;
  const result = prepareRestoreSql(oldDump, [{ schemaVersion: 1, userId: USER, deletedAt: '2026-11-20T12:00:00.000Z' }]);
  const db = new DatabaseSync(':memory:');
  try { db.exec(result); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0); }
  finally { db.close(); }
});

test('restore preparation rejects malformed deletion records', () => {
  assert.throws(() => prepareRestoreSql('SELECT 1;', [{ schemaVersion: 1, userId: "x'); DROP TABLE users; --", deletedAt: '2026-11-20T12:00:00.000Z' }]));
});
