import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

test('favorites migration creates an independent user-owned snapshot table', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const version of ['0001', '0002', '0003']) {
      db.exec(readFileSync(new URL(`../users/migrations/${version}.sql`, import.meta.url), 'utf8'));
    }
    db.prepare(`INSERT INTO users (id,email_normalized,password_hash,email_verified_at,created_at,updated_at)
      VALUES ('u1','one@example.com','hash',1,1,1)`).run();
    db.prepare(`INSERT INTO favorites (id,user_id,article_key,snapshot_version,snapshot_json,created_at)
      VALUES ('f1','u1','0123456789abcdef0123456789abcdef',1,'{}',2)`).run();
    assert.throws(() => db.prepare(`INSERT INTO favorites (id,user_id,article_key,snapshot_version,snapshot_json,created_at)
      VALUES ('f2','u1','0123456789abcdef0123456789abcdef',1,'{}',3)`).run());
    assert.throws(() => db.prepare(`INSERT INTO favorites (id,user_id,article_key,snapshot_version,snapshot_json,created_at)
      VALUES ('f3','missing','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,'{}',3)`).run());
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM favorites").get().count, 1);
  } finally { db.close(); }
});
