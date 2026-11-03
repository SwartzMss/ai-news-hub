import sax from 'sax';
import { AppError } from '../errors.js';
import type { FeedSource } from './source.js';
import type { RssEntry } from './types.js';

export function canonicalUrl(raw: string, source: FeedSource): string {
  if (raw.length > 2048 || [...raw].some((character) => character.charCodeAt(0) <= 0x20 || character.charCodeAt(0) === 0x7f)) throw new AppError('invalid_source_url');
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || !source.articleHosts.includes(url.hostname) || url.port) {
    throw new AppError('invalid_source_url');
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.href;
}
function plainText(value: string, limit: number): string {
  return value.replace(/<[^<>]*>/g, ' ').replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_match, name: string) => ({
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  }[name] ?? '')).replace(/\s+/g, ' ').replace(/\s+([.,!?;:，。！？；：])/g, '$1').trim().slice(0, limit);
}
function publicationTime(value: string): string | null {
  if (!/\d{2}:\d{2}.*(?:Z|GMT|UTC|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

export function parseRss(xml: string, source: FeedSource): RssEntry[] {
  if (Buffer.byteLength(xml) > 2 * 1024 * 1024) throw new AppError('feed_too_large');
  const xmlOptions = { strictEntities: true, position: false };
  const parser = sax.parser(true, xmlOptions);
  const path: string[] = [], entries: RssEntry[] = [];
  let root = '', count = 0, item: Record<string, string> | undefined;
  const fields = new Set(['title', 'link', 'guid', 'pubdate', 'description', 'content:encoded']);
  const text = (value: string) => {
    const field = path[3];
    if (item && fields.has(field)) item[field] = ((item[field] ?? '') + value).slice(0, 6000);
  };
  parser.ondoctype = () => { throw new AppError('feed_doctype_forbidden'); };
  parser.onsgmldeclaration = () => { throw new AppError('feed_invalid_xml'); };
  parser.onerror = () => { throw new AppError('feed_invalid_xml'); };
  parser.onopentag = (tag) => {
    path.push(tag.name.toLowerCase());
    if (path.length === 1) root = path[0];
    if (path.length > 32) throw new AppError('feed_invalid_xml');
    if (path.join('/') === 'rss/channel/item') {
      if (++count > 200) throw new AppError('feed_too_many_items');
      item = {};
    } else if (path.length > 4) text(' ');
  };
  parser.ontext = text; parser.oncdata = text;
  parser.onclosetag = () => {
    if (path.join('/') === 'rss/channel/item' && item) {
      const raw = (item.link ?? '').trim();
      const title = plainText(item.title ?? '', 500);
      if (title && raw) {
        try {
          const canonical = canonicalUrl(raw, source);
          entries.push({ title, originalUrl: raw, canonicalUrl: canonical,
            entryKey: (item.guid ?? '').trim().slice(0, 512) || canonical,
            publishedAt: publicationTime(item.pubdate ?? ''),
            excerpt: plainText(item.description || item['content:encoded'] || '', 1000),
          });
        } catch { /* Invalid links are excluded, never repaired by the model. */ }
      }
      item = undefined;
    } else if (path.length > 4) text(' ');
    path.pop();
  };
  try { parser.write(xml).close(); }
  catch (error) { throw error instanceof AppError ? error : new AppError('feed_invalid_xml'); }
  if (root !== 'rss') throw new AppError('feed_unsupported');
  return entries;
}
