import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, NOW } from './fixtures/auth.mjs';
import { onRequest } from '../dist/functions/api/auth/[[path]].js';

const PASSWORD = 'correct horse battery staple';
const request = (f, action, options) => onRequest(f.context(action, options));
const tokenFrom = f => new URL(f.messages.at(-1).payload.text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
const cookieFrom = response => response.headers.get('set-cookie')?.match(/__Host-anh_session=([^;]+)/)?.[1];
async function activeUser(f, email = 'reader@example.com') {
  await request(f, 'register', { body: { email, password: PASSWORD } });
  await request(f, 'verify-email', { body: { token: tokenFrom(f), password: PASSWORD } });
  const login = await request(f, 'login', { body: { email, password: PASSWORD } });
  return { cookie: `__Host-anh_session=${cookieFrom(login)}`, id: (await login.json()).user.id };
}

test('authenticated data export includes private favorites and categories without credentials', async t => {
  const f = fixture(); t.after(() => f.close());
  const user = await activeUser(f);
  f.db.prepare(`INSERT INTO favorite_categories(id,user_id,name,name_key,created_at,updated_at)
    VALUES ('33333333-3333-4333-8333-333333333333',?,'Later','later',?,?)`).run(user.id, NOW, NOW);
  f.db.prepare(`INSERT INTO favorites(id,user_id,article_key,snapshot_version,snapshot_json,created_at,category_id)
    VALUES ('44444444-4444-4444-8444-444444444444',?,'a' || substr('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',2),1,?,?,'33333333-3333-4333-8333-333333333333')`)
    .run(user.id, JSON.stringify({ schemaVersion: 1, article: { title: 'Saved story' } }), NOW);
  const response = await request(f, 'export-data', { body: { password: PASSWORD }, headers: { cookie: user.cookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /attachment/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const text = await response.text();
  const data = JSON.parse(text);
  assert.equal(data.account.email, 'reader@example.com');
  assert.equal(data.categories[0].name, 'Later');
  assert.equal(data.favorites[0].snapshot.article.title, 'Saved story');
  assert.doesNotMatch(text, /password_hash|token_hash|correct horse battery staple/);
  assert.equal((await request(f, 'export-data', { body: { password: 'wrong password string' }, headers: { cookie: user.cookie } })).status, 401);
});

test('account deletion requires a private ledger write and cascades only the current user', async t => {
  const f = fixture(); t.after(() => f.close());
  const user = await activeUser(f);
  const other = await activeUser(f, 'other@example.com');
  f.db.prepare(`INSERT INTO favorite_categories(id,user_id,name,name_key,created_at,updated_at)
    VALUES ('33333333-3333-4333-8333-333333333333',?,'Later','later',?,?)`).run(user.id, NOW, NOW);
  const options = { body: { password: PASSWORD }, headers: { cookie: user.cookie } };
  assert.equal((await request(f, 'delete-account', options)).status, 503);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
  f.env.USER_BACKUP_BUCKET = { put: async () => { throw Error('R2 down'); } };
  assert.equal((await request(f, 'delete-account', options)).status, 503);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
  const writes = [];
  f.env.USER_BACKUP_BUCKET = { put: async (key, value) => { writes.push({ key, value: JSON.parse(value) }); return { key }; } };
  assert.equal((await request(f, 'delete-account', { body: { password: 'wrong password string' }, headers: { cookie: user.cookie } })).status, 401);
  assert.equal(writes.length, 0);
  const deleted = await request(f, 'delete-account', options);
  assert.equal(deleted.status, 204);
  assert.match(deleted.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, `tombstones/${user.id}.json`);
  assert.equal(writes[0].value.userId, user.id);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users WHERE id=?').get(user.id).n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM favorite_categories').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id=?').get(user.id).n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users WHERE id=?').get(other.id).n, 1);
});
