import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export const NOW = Date.parse('2026-11-19T02:00:00Z');

export function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(new URL('../../users/migrations/0001.sql', import.meta.url), 'utf8'));
  const messages = [];
  class Statement {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...params) { return new Statement(this.sql, params); }
    async run() { const result = db.prepare(this.sql).run(...this.params); return { meta: { changes: Number(result.changes) } }; }
    async first() { return db.prepare(this.sql).get(...this.params) ?? null; }
    async all() { return { results: db.prepare(this.sql).all(...this.params) }; }
  }
  const adapter = {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      db.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  const env = {
    AUTH_ENABLED: '1', AUTH_SITE_URL: 'https://news.example', AUTH_FROM: 'AI News Hub <account@mail.example.com>',
    RESEND_API_KEY: 're_test_private', USER_DB: adapter,
  };
  const fetcher = async (_url, options) => {
    messages.push({ payload: JSON.parse(options.body), key: options.headers['idempotency-key'] });
    return Response.json({ id: `mail-${messages.length}` });
  };
  function context(action, options = {}) {
    const method = options.method ?? 'POST';
    const headers = new Headers({ origin: env.AUTH_SITE_URL, accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) });
    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    const body = method === 'GET' || method === 'HEAD' ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body ?? {});
    return { env, fetcher: options.fetcher ?? fetcher, now: options.now ?? (() => new Date(NOW)), ...(options.waitUntil ? { waitUntil: options.waitUntil } : {}), request: new Request(new URL(`/api/auth/${action}`, env.AUTH_SITE_URL), { method, headers, ...(body === undefined ? {} : { body }) }) };
  }
  return { db, env, messages, context, close() { db.close(); } };
}
