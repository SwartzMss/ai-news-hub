import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRss, canonicalUrl } from '../dist/apps/server/src/news/rss.js';
import { GITHUB_SOURCE } from '../dist/apps/server/src/news/source.js';

const feed = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture</title>${items}</channel></rss>`;
test('RSS preserves source time, separates canonical URL and strips HTML', () => {
  const entries = parseRss(feed(`<item><title> A &amp; B </title><link>https://github.blog/example/?utm_source=test&amp;q=1#part</link><guid>stable-1</guid><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>A source excerpt <b>only</b>.</p>]]></description></item>`), GITHUB_SOURCE);
  assert.equal(entries[0].title, 'A & B');
  assert.equal(entries[0].originalUrl, 'https://github.blog/example/?utm_source=test&q=1#part');
  assert.equal(entries[0].canonicalUrl, 'https://github.blog/example/?q=1');
  assert.equal(entries[0].publishedAt, '2026-11-02T10:00:00.000Z');
  assert.equal(entries[0].excerpt, 'A source excerpt only.');
});
test('invalid source publication time stays unknown; missing valid source cannot enter candidates', () => {
  const items = `<item><title>valid source title</title><link>https://github.blog/a</link><pubDate>unknown</pubDate></item>
    <item><title>missing</title></item><item><title>private</title><link>http://127.0.0.1/secret</link></item>
    <item><title>wrong publisher</title><link>https://evil.example/story</link></item>`;
  const entries = parseRss(feed(items), GITHUB_SOURCE);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].publishedAt, null);
});
test('tracking query/fragment dedup does not remove semantic query parameters', () => {
  assert.equal(canonicalUrl('https://github.blog/a?z=2&utm_medium=rss&a=1#x', GITHUB_SOURCE), 'https://github.blog/a?a=1&z=2');
});
for (const xml of [
  '<rss><channel><item></channel></rss>',
  '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><channel/></rss>',
  '<html><body>blocked</body></html>',
]) {
  test('malformed/non-RSS/DTD input is rejected', () => assert.throws(() => parseRss(xml, GITHUB_SOURCE)));
}
