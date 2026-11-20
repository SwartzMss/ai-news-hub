import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixture, NOW } from './fixtures/auth.mjs';
import { onRequest as categoriesRequest } from '../dist/functions/api/favorite-categories/[[path]].js';
import { onRequest as favoritesRequest } from '../dist/functions/api/favorites/[[path]].js';

function seed(f, id, token) {
  f.db.prepare(`INSERT INTO users (id,email_normalized,password_hash,email_verified_at,created_at,updated_at)
    VALUES (?,?,?,1,1,1)`).run(id, `${id}@example.com`, 'hash');
  f.db.prepare(`INSERT INTO auth_sessions (id,user_id,token_hash,created_at,expires_at,last_seen_at)
    VALUES (?,?,?,?,?,?)`).run(`session-${id}`, id, createHash('sha256').update(token).digest('hex'), NOW - 1000, NOW + 100000, NOW);
  return `__Host-anh_session=${token}`;
}
function request(f, resource, path, method = 'GET', body, cookie, headers = {}) {
  const ctx = f.context('unused', { method, body, headers: {
    ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}), ...headers,
  } });
  ctx.request = new Request(new URL(`/api/${resource}${path}`, f.env.AUTH_SITE_URL), ctx.request);
  return (resource === 'favorite-categories' ? categoriesRequest : favoritesRequest)(ctx);
}

test('category CRUD is private, ordered, idempotent and validates names', async t => {
  const f = fixture(); t.after(() => f.close());
  const own = seed(f, 'u1', 'a'.repeat(43));
  const other = seed(f, 'u2', 'b'.repeat(43));
  const call = (path, method, body, cookie = own, headers) => request(f, 'favorite-categories', path, method, body, cookie, headers);
  assert.equal((await call('', 'GET', undefined, '')).status, 401);
  assert.equal((await call('', 'POST', { name: '' })).status, 400);
  assert.equal((await call('', 'POST', { name: 'x'.repeat(51) })).status, 400);
  assert.equal((await call('', 'POST', { name: '<script>' })).status, 400);
  const first = await call('', 'POST', { name: ' Research ', sortOrder: 5 });
  assert.equal(first.status, 201);
  const { category } = await first.json();
  assert.equal(category.name, 'Research');
  assert.equal((await call('', 'POST', { name: 'research', sortOrder: 2 })).status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM favorite_categories').get().n, 1);
  const second = await call('', 'POST', { name: 'Later', sortOrder: 1 });
  const secondId = (await second.json()).category.id;
  const list = await call('', 'GET');
  assert.deepEqual((await list.json()).categories.map(item => item.id), [secondId, category.id]);
  const changed = await call(`/${category.id}`, 'PATCH', { name: 'Selected', sortOrder: 0 });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).category.sortOrder, 0);
  assert.equal((await call(`/${secondId}`, 'PATCH', { name: 'selected' })).status, 409);
  assert.equal((await call(`/${category.id}`, 'PATCH', { sortOrder: 10001 })).status, 400);
  assert.equal((await call(`/${category.id}`, 'PATCH', { name: 'X' }, own, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(`/${category.id}`, 'PATCH', { name: 'Stolen' }, other)).status, 404);
  assert.equal((await call(`/${category.id}`, 'DELETE', undefined, other)).status, 404);
  assert.deepEqual((await call('', 'GET', undefined, other).then(r => r.json())).categories, []);
  assert.equal((await call('/bad-id', 'DELETE')).status, 404);
});

test('moving favorites checks both owners; deleting a category leaves snapshots unclassified', async t => {
  const f = fixture(); t.after(() => f.close());
  const own = seed(f, 'u1', 'a'.repeat(43));
  const other = seed(f, 'u2', 'b'.repeat(43));
  const category = (await (await request(f, 'favorite-categories', '', 'POST', { name: 'Watch' }, own)).json()).category;
  const otherCategory = (await (await request(f, 'favorite-categories', '', 'POST', { name: 'Private' }, other)).json()).category;
  const favoriteId = '33333333-3333-4333-8333-333333333333';
  f.db.prepare(`INSERT INTO favorites (id,user_id,article_key,snapshot_version,snapshot_json,created_at)
    VALUES (?,'u1','0123456789abcdef0123456789abcdef',1,'{"schemaVersion":1,"article":{}}',?)`).run(favoriteId, NOW);
  const move = (categoryId, cookie = own) => request(f, 'favorites', `/${favoriteId}/category`, 'PATCH', { categoryId }, cookie);
  assert.equal((await move(otherCategory.id)).status, 404);
  assert.equal((await move(category.id, other)).status, 404);
  assert.equal((await move(category.id)).status, 200);
  assert.equal(f.db.prepare('SELECT category_id FROM favorites WHERE id=?').get(favoriteId).category_id, category.id);
  const list = await request(f, 'favorites', '', 'GET', undefined, own);
  assert.equal((await list.json()).favorites[0].categoryId, category.id);
  assert.equal((await request(f, 'favorite-categories', `/${category.id}`, 'DELETE', undefined, own)).status, 204);
  const row = f.db.prepare('SELECT snapshot_json,category_id FROM favorites WHERE id=?').get(favoriteId);
  assert.equal(row.category_id, null);
  assert.deepEqual(JSON.parse(row.snapshot_json), { schemaVersion: 1, article: {} });
  assert.equal((await move(null)).status, 200);
  assert.equal((await move('not-a-uuid')).status, 400);
});

test('concurrent name and sort edits do not overwrite each other', async t => {
  const f = fixture(); t.after(() => f.close());
  const cookie = seed(f, 'u1', 'a'.repeat(43));
  const created = await request(f, 'favorite-categories', '', 'POST', { name: 'Original', sortOrder: 1 }, cookie);
  const id = (await created.json()).category.id;
  const prepare = f.env.USER_DB.prepare.bind(f.env.USER_DB);
  let reads = 0;
  let release;
  const bothRead = new Promise(resolve => { release = resolve; });
  f.env.USER_DB.prepare = sql => {
    const statement = prepare(sql);
    if (!sql.includes('WHERE id=? AND user_id=?') || !sql.includes('FROM favorite_categories')) return statement;
    return { bind(...values) {
      const bound = statement.bind(...values);
      return { first: async () => {
        const row = await bound.first();
        if (++reads === 2) release();
        await bothRead;
        return row;
      } };
    } };
  };
  const results = await Promise.all([
    request(f, 'favorite-categories', `/${id}`, 'PATCH', { name: 'Renamed' }, cookie),
    request(f, 'favorite-categories', `/${id}`, 'PATCH', { sortOrder: 7 }, cookie),
  ]);
  assert.deepEqual(results.map(result => result.status), [200, 200]);
  const row = f.db.prepare('SELECT name,sort_order FROM favorite_categories WHERE id=?').get(id);
  assert.equal(row.name, 'Renamed');
  assert.equal(row.sort_order, 7);
});
