import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../dist/apps/server/src/db/migrations.js';
import { RssCollector } from '../dist/apps/server/src/news/collector.js';

const item = (link = 'https://github.blog/a?utm_source=rss', guid = 'entry-a') => `<item><title>Fixture release announcement</title><link>${link}</link><guid>${guid}</guid><description>Source-provided fixture summary.</description><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate></item>`;
const xml = (items) => `<rss version="2.0"><channel>${items}</channel></rss>`;
function setup(fetcher) {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); migrate(db);
  let date = new Date('2026-11-03T00:00:00Z');
  const collector = new RssCollector(db, fetcher, undefined, () => date);
  return { db, collector, advance() { date = new Date(date.getTime() + 300001); } };
}
test('canonical/GUID/fingerprint dedup, rate cache and original times remain stable', async () => {
  let requests = 0;
  const s = setup(async () => { requests++; return new Response(xml(item() + item('https://github.blog/a', 'alias') + item('https://github.blog/duplicate', 'different-guid')), { headers: { etag: '"fixture"' } }); });
  try {
    const a = await s.collector.collect(new AbortController().signal);
    assert.equal(a.articles.length, 1);
    assert.equal(a.articles[0].eventAt, null);
    const firstFetch = a.articles[0].fetchedAt;
    assert.equal((await s.collector.collect(new AbortController().signal)).cached, true);
    assert.equal(requests, 1);
    s.advance();
    const b = await s.collector.collect(new AbortController().signal);
    assert.equal(b.articles[0].id, a.articles[0].id);
    assert.equal(b.articles[0].fetchedAt, firstFetch);
    assert.equal(s.db.prepare('SELECT count(*) n FROM articles').get().n, 1);
    assert.notEqual(s.db.prepare('SELECT last_seen_at FROM articles').get().last_seen_at, firstFetch);
  } finally { s.db.close(); }
});
test('304 uses verified cached entries; conditional headers are sent', async () => {
  let calls = 0;
  const s = setup(async (_url, init) => {
    if (calls++ === 0) return new Response(xml(item()), { headers: { etag: '"cached"' } });
    assert.equal(init.headers['if-none-match'], '"cached"');
    return new Response(null, { status: 304 });
  });
  try {
    await s.collector.collect(new AbortController().signal); s.advance();
    assert.equal((await s.collector.collect(new AbortController().signal)).articles.length, 1);
  } finally { s.db.close(); }
});
test('fetch failure is recorded and never silently returns an old successful feed', async () => {
  let calls = 0;
  const s = setup(async () => calls++ === 0 ? new Response(xml(item())) : new Response('blocked', { status: 503 }));
  try {
    await s.collector.collect(new AbortController().signal); s.advance();
    await assert.rejects(s.collector.collect(new AbortController().signal), { code: 'feed_http_503' });
    await assert.rejects(s.collector.collect(new AbortController().signal), { code: 'source_rate_limited' });
    assert.equal(s.db.prepare('SELECT last_error_code FROM rss_sources').get().last_error_code, 'feed_http_503');
  } finally { s.db.close(); }
});
test('cross-origin redirect is rejected before reaching another host', async () => {
  let calls = 0;
  const s = setup(async () => { calls++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }); });
  try {
    await assert.rejects(s.collector.collect(new AbortController().signal), { code: 'feed_redirect_forbidden' });
    assert.equal(calls, 1);
  } finally { s.db.close(); }
});
test('oversize and non-XML responses never create articles', async () => {
  const s = setup(async () => new Response('<rss/>', { headers: { 'content-length': '3000000' } }));
  try {
    await assert.rejects(s.collector.collect(new AbortController().signal), { code: 'feed_too_large' });
    assert.equal(s.db.prepare('SELECT count(*) n FROM articles').get().n, 0);
  } finally { s.db.close(); }
});
test('publisher corrections refresh current content without binding weak fingerprint aliases', async () => {
  const revisions = [
    { url: 'https://github.blog/a', guid: 'a', title: 'Initial wrong release announcement', text: 'The source initially claims a release.', date: 'Mon, 02 Nov 2026 10:00:00 GMT' },
    { url: 'https://github.blog/a', guid: 'a', title: 'Correction withdrawing the announcement', text: 'The source withdraws the earlier release claim.', date: 'Mon, 02 Nov 2026 11:00:00 GMT' },
    { url: 'https://github.blog/b', guid: 'b', title: 'Correction withdrawing the announcement', text: 'The source withdraws the earlier release claim.', date: 'Mon, 02 Nov 2026 11:00:00 GMT' },
    { url: 'https://github.blog/b', guid: 'b', title: 'An independent later announcement', text: 'This is now a different story at the second URL.', date: 'Mon, 02 Nov 2026 12:00:00 GMT' },
  ];
  let requests = 0;
  const s = setup(async () => {
    const r = revisions[requests++];
    return new Response(xml(`<item><title>${r.title}</title><link>${r.url}</link><guid>${r.guid}</guid><description>${r.text}</description><pubDate>${r.date}</pubDate></item>`));
  });
  try {
    const first = (await s.collector.collect(new AbortController().signal)).articles[0]; s.advance();
    const corrected = (await s.collector.collect(new AbortController().signal)).articles[0]; s.advance();
    assert.equal(corrected.id, first.id);
    assert.equal(corrected.title, revisions[1].title);
    assert.equal(corrected.excerpt, revisions[1].text);
    assert.equal(corrected.publishedAt, '2026-11-02T11:00:00.000Z');
    const alias = (await s.collector.collect(new AbortController().signal)).articles[0]; s.advance();
    assert.equal(alias.id, first.id); assert.equal(alias.title, revisions[1].title);
    const independent = (await s.collector.collect(new AbortController().signal)).articles[0];
    assert.notEqual(independent.id, first.id);
    assert.equal(independent.canonicalUrl, 'https://github.blog/b');
    assert.equal(s.db.prepare('SELECT title FROM articles WHERE id=?').get(first.id).title, revisions[1].title);
  } finally { s.db.close(); }
});
