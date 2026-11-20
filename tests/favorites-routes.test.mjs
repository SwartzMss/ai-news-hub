import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixture, NOW } from './fixtures/auth.mjs';
import { onRequest } from '../dist/functions/api/favorites/[[path]].js';

const TOPIC = 't-0123456789abcdef01234567';
const ARTICLE_ID = 'story-1';
const KEY = createHash('sha256').update(`${TOPIC}:${ARTICLE_ID}`).digest('hex').slice(0, 32);
const TOKEN = 'a'.repeat(43);
const article = {
  id: ARTICLE_ID, key: KEY, title: 'A real article', topic: { id: TOPIC, name: 'AI' },
  category: 'ai', importance: 3, fact_summary: 'A sourced summary.', analysis: 'An analysis.',
  details: { kind: 'news', background: 'Context.', evidence: [{ id: 'e1', name: 'Original', url: 'https://source.example/a', supports: 'Fact.' }] },
  evidence_quote: 'A quote from the original.', verification: 'source_only',
  source: { name: 'Publisher', original_url: 'https://source.example/a', canonical_url: 'https://source.example/a',
    published_at: '2026-11-19T00:00:00Z', event_at: null, fetched_at: '2026-11-19T01:00:00Z' },
  report_date: '2026-11-19', report_version: 1, first_approved_at: '2026-11-19T02:00:00Z',
};

function seed(f, userId = 'u1', token = TOKEN) {
  f.db.prepare(`INSERT INTO users (id,email_normalized,password_hash,email_verified_at,created_at,updated_at)
    VALUES (?,?,?,1,1,1)`).run(userId, `${userId}@example.com`, 'hash');
  f.db.prepare(`INSERT INTO auth_sessions (id,user_id,token_hash,created_at,expires_at,last_seen_at)
    VALUES (?,?,?,?,?,?)`).run(`session-${userId}`, userId, createHash('sha256').update(token).digest('hex'), NOW - 1000, NOW + 100000, NOW);
  return `__Host-anh_session=${token}`;
}
function assets(f, current = article) {
  f.env.ASSETS = { fetch: async input => {
    if (String(input) !== `${f.env.AUTH_SITE_URL}/data/articles/${KEY}.json`) return new Response(null, { status: 404 });
    return Response.json(current);
  } };
}
function request(f, path, method = 'GET', body, cookie) {
  const ctx = f.context('unused', { method, body, headers: cookie ? { cookie } : {} });
  ctx.request = new Request(new URL(`/api/favorites${path}`, f.env.AUTH_SITE_URL), ctx.request);
  return onRequest(ctx);
}

test('favorites persist full snapshot, paginate, remain after report deletion, and delete by owner', async t => {
  const f = fixture(); t.after(() => f.close());
  const cookie = seed(f);
  assets(f);
  const created = await request(f, '', 'POST', { articleKey: KEY }, cookie);
  assert.equal(created.status, 201);
  const saved = await created.json();
  assert.equal(saved.favorite.snapshot.article.details.evidence[0].url, 'https://source.example/a');
  assert.equal(saved.favorite.snapshot.article.title, article.title);
  assert.equal((await request(f, '', 'POST', { articleKey: KEY }, cookie)).status, 200);
  f.env.ASSETS = { fetch: async () => new Response(null, { status: 404 }) };
  assert.equal((await request(f, '', 'POST', { articleKey: KEY }, cookie)).status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM favorites').get().n, 1);
  const list = await request(f, '?limit=1&offset=0', 'GET', undefined, cookie);
  assert.equal(list.status, 200);
  assert.equal((await list.json()).favorites[0].id, saved.favorite.id);
  const detail = await request(f, `/${saved.favorite.id}`, 'GET', undefined, cookie);
  assert.deepEqual((await detail.json()).favorite.snapshot.article, article);
  assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE name='favorites'").get().name, 'favorites');
  assert.equal((await request(f, `/${saved.favorite.id}`, 'DELETE', undefined, cookie)).status, 204);
  assert.equal((await request(f, `/${saved.favorite.id}`, 'GET', undefined, cookie)).status, 404);
});

test('favorites reject anonymous access, user spoofing, unsafe snapshots and cross-user ids', async t => {
  const f = fixture(); t.after(() => f.close());
  const owner = seed(f);
  const other = seed(f, 'u2', 'b'.repeat(43));
  assets(f);
  assert.equal((await request(f, '', 'GET')).status, 401);
  assert.equal((await request(f, '', 'POST', { articleKey: KEY, user_id: 'u2' }, owner)).status, 400);
  assert.equal((await request(f, '', 'POST', { articleKey: 'f'.repeat(32) }, owner)).status, 404);
  assets(f, { ...article, title: '<script>alert(1)</script>' });
  assert.equal((await request(f, '', 'POST', { articleKey: KEY }, owner)).status, 400);
  assets(f, { ...article, source: { ...article.source, canonical_url: 'javascript:alert(1)' } });
  assert.equal((await request(f, '', 'POST', { articleKey: KEY }, owner)).status, 400);
  assets(f, { ...article, unknown: true });
  assert.equal((await request(f, '', 'POST', { articleKey: KEY }, owner)).status, 400);
  assets(f);
  const created = await request(f, '', 'POST', { articleKey: KEY }, owner);
  const { favorite } = await created.json();
  assert.equal((await request(f, `/${favorite.id}`, 'GET', undefined, other)).status, 404);
  assert.equal((await request(f, `/${favorite.id}`, 'DELETE', undefined, other)).status, 404);
  assert.equal((await request(f, `/${favorite.id}`, 'GET', undefined, owner)).status, 200);
  assert.equal((await request(f, '?limit=1000', 'GET', undefined, owner)).status, 400);
  assert.equal((await request(f, '', 'POST', { articleKey: KEY, padding: 'x'.repeat(200000) }, owner)).status, 413);
});
