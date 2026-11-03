import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../errors.js';
import { GITHUB_SOURCE, type FeedSource } from './source.js';
import { parseRss } from './rss.js';
import { fetchFeed, feedText, type FeedFetch } from './http.js';
import type { ArticleCandidate, Collection, RssEntry } from './types.js';

const fingerprint = (entry: RssEntry) => createHash('sha256').update(`${entry.title}\n${entry.excerpt}`.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ')).digest('hex');
const safeHeader = (value: string | null) => value && value.length <= 1024 && !/[\r\n]/.test(value) ? value : null;

export class RssCollector {
  constructor(private db: DatabaseSync, private fetcher: FeedFetch,
    readonly source: FeedSource = GITHUB_SOURCE, private now: () => Date = () => new Date()) {
    db.prepare('INSERT OR IGNORE INTO rss_sources(id,name,feed_url) VALUES (?,?,?)').run(source.id, source.name, source.feedUrl);
  }

  async collect(signal: AbortSignal): Promise<Collection> {
    if (signal.aborted) throw new AppError('feed_cancelled');
    const timestamp = this.now().toISOString();
    const saved = this.db.prepare('SELECT * FROM rss_sources WHERE id=?').get(this.source.id)!;
    if (saved.last_attempt_at && Date.parse(timestamp) - Date.parse(String(saved.last_attempt_at)) < this.source.minIntervalMs) {
      if (saved.last_error_code || !saved.last_success_at) throw new AppError('source_rate_limited');
      return { articles: this.cached(), cached: true, collectedAt: String(saved.last_success_at) };
    }
    this.db.prepare("UPDATE rss_sources SET last_attempt_at=?,last_error_code='fetch_in_progress' WHERE id=?").run(timestamp, this.source.id);
    const headers: Record<string, string> = {
      accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
      'user-agent': 'AI-News-Hub/0.1 (+https://github.com/SwartzMss/ai-news-hub)',
    };
    if (saved.etag) headers['if-none-match'] = String(saved.etag);
    if (saved.last_modified) headers['if-modified-since'] = String(saved.last_modified);
    const timeout = AbortSignal.timeout(15000);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      const response = await fetchFeed(this.fetcher, this.source, headers, combined);
      if (response.status === 304) {
        await response.body?.cancel();
        const articles = this.cached();
        if (!articles.length) throw new AppError('feed_no_cache');
        this.db.prepare('UPDATE rss_sources SET last_success_at=?,last_error_code=NULL WHERE id=?').run(timestamp, this.source.id);
        return { articles, cached: true, collectedAt: timestamp };
      }
      if (!response.ok) { await response.body?.cancel(); throw new AppError(`feed_http_${response.status}`); }
      const entries = parseRss(await feedText(response), this.source);
      if (!entries.length) throw new AppError('feed_empty');
      if (combined.aborted) throw new AppError('feed_cancelled');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const seenUrls = new Set<string>(), seenKeys = new Set<string>();
        // The publisher's first occurrence wins inside a single feed response.
        const current = entries.filter((entry) => {
          if (seenUrls.has(entry.canonicalUrl) || seenKeys.has(entry.entryKey)) return false;
          seenUrls.add(entry.canonicalUrl); seenKeys.add(entry.entryKey); return true;
        });
        const ids = [...new Set(current.map((entry) => this.ingest(entry, timestamp)))];
        this.db.prepare('DELETE FROM rss_feed_items WHERE source_id=?').run(this.source.id);
        ids.forEach((id, position) => this.db.prepare('INSERT INTO rss_feed_items(source_id,position,article_id) VALUES (?,?,?)').run(this.source.id, position, id));
        this.db.prepare('UPDATE rss_sources SET last_success_at=?,last_error_code=NULL,etag=?,last_modified=? WHERE id=?').run(
          timestamp, safeHeader(response.headers.get('etag')), safeHeader(response.headers.get('last-modified')), this.source.id,
        );
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      return { articles: this.cached(), cached: false, collectedAt: timestamp };
    } catch (error) {
      const code = signal.aborted ? 'feed_cancelled' : timeout.aborted ? 'feed_timeout' : error instanceof AppError ? error.code : 'feed_fetch_failed';
      this.db.prepare('UPDATE rss_sources SET last_error_code=? WHERE id=?').run(code, this.source.id);
      throw new AppError(code);
    }
  }

  private cached(): ArticleCandidate[] {
    const seen = new Set<string>();
    return this.db.prepare(`SELECT a.* FROM rss_feed_items f JOIN articles a ON a.id=f.article_id
      WHERE f.source_id=? ORDER BY f.position LIMIT 200`).all(this.source.id).filter((row) => {
      const hash = String(row.content_hash ?? '');
      if (hash && seen.has(hash)) return false;
      if (hash) seen.add(hash); return true;
    }).map((row) => ({
      id: String(row.id), title: String(row.title), originalUrl: String(row.original_url), canonicalUrl: String(row.canonical_url),
      sourceName: String(row.source_name), publishedAt: row.source_published_at as string | null,
      eventAt: row.event_at as string | null, fetchedAt: String(row.fetched_at), excerpt: String(row.content_text ?? ''),
    }));
  }
  private ingest(entry: RssEntry, timestamp: string): string {
    const hash = fingerprint(entry);
    const canonical = this.db.prepare('SELECT id FROM articles WHERE canonical_url=?').get(entry.canonicalUrl);
    const stable = this.db.prepare('SELECT article_id id FROM rss_entries WHERE source_id=? AND entry_key=?').get(this.source.id, entry.entryKey);
    if (canonical && stable && canonical.id !== stable.id) throw new AppError('feed_identity_conflict');
    const identity = canonical ?? stable;
    const existing = identity ?? this.db.prepare(`SELECT a.id FROM article_fingerprints f JOIN articles a ON a.id=f.article_id
      WHERE f.source_id=? AND f.fingerprint=? AND a.content_hash=?`).get(this.source.id, hash, hash);
    const id = existing ? String(existing.id) : randomUUID();
    if (!existing) {
      this.db.prepare(`INSERT INTO articles(id,original_url,canonical_url,source_name,title,source_published_at,event_at,fetched_at,content_kind,content_text,content_hash,last_seen_at)
        VALUES (?,?,?,?,?,?,NULL,?,'unverified',?,?,?)`).run(id, entry.originalUrl, entry.canonicalUrl, this.source.name, entry.title, entry.publishedAt, timestamp, entry.excerpt, hash, timestamp);
    } else if (identity) {
      // Current source content may be corrected. Existing news_runs and reports
      // retain their own immutable candidate/document snapshots.
      this.db.prepare(`UPDATE articles SET original_url=?,canonical_url=?,source_name=?,title=?,source_published_at=?,event_at=NULL,
        content_text=?,content_hash=?,last_seen_at=? WHERE id=?`).run(entry.originalUrl, entry.canonicalUrl, this.source.name, entry.title, entry.publishedAt, entry.excerpt, hash, timestamp, id);
      this.db.prepare('DELETE FROM article_fingerprints WHERE article_id=?').run(id);
    } else this.db.prepare('UPDATE articles SET last_seen_at=? WHERE id=?').run(timestamp, id);
    // A matching content hash alone is not proof that a new GUID owns the same
    // article: if that URL later diverges it must become an independent record.
    if (!existing || identity) this.db.prepare('INSERT OR IGNORE INTO rss_entries(source_id,entry_key,article_id) VALUES (?,?,?)').run(this.source.id, entry.entryKey, id);
    this.db.prepare('INSERT OR IGNORE INTO article_fingerprints(source_id,fingerprint,article_id) VALUES (?,?,?)').run(this.source.id, hash, id);
    return id;
  }
}
