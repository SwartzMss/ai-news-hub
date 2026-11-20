import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

test('category migration enforces ownership and keeps favorites when a category is deleted', () => {
  const db = new DatabaseSync(':memory:');
  const categoryId = '11111111-1111-4111-8111-111111111111';
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const version of ['0001', '0002', '0003', '0004']) {
      db.exec(readFileSync(new URL(`../users/migrations/${version}.sql`, import.meta.url), 'utf8'));
    }
    for (const id of ['u1', 'u2']) db.prepare(`INSERT INTO users
      (id,email_normalized,password_hash,email_verified_at,created_at,updated_at)
      VALUES (?,?,?,1,1,1)`).run(id, `${id}@example.com`, 'hash');
    db.prepare(`INSERT INTO favorite_categories (id,user_id,name,name_key,sort_order,created_at,updated_at)
      VALUES (?,'u1','Research','research',0,1,1)`).run(categoryId);
    assert.throws(() => db.prepare(`INSERT INTO favorite_categories
      (id,user_id,name,name_key,sort_order,created_at,updated_at)
      VALUES ('22222222-2222-4222-8222-222222222222','u1','RESEARCH','research',0,1,1)`).run());
    db.prepare(`INSERT INTO favorites (id,user_id,article_key,snapshot_version,snapshot_json,created_at)
      VALUES ('f1','u2','0123456789abcdef0123456789abcdef',1,'{}',2)`).run();
    assert.throws(() => db.prepare("UPDATE favorites SET category_id=? WHERE id='f1'").run(categoryId));
    db.prepare("UPDATE favorites SET user_id='u1',category_id=? WHERE id='f1'").run(categoryId);
    db.prepare('DELETE FROM favorite_categories WHERE id=?').run(categoryId);
    assert.equal(db.prepare("SELECT category_id FROM favorites WHERE id='f1'").get().category_id, null);
  } finally { db.close(); }
});
