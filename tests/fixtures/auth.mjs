import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export const NOW = Date.parse('2026-11-19T02:00:00Z');

export function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(new URL('../../users/migrations/0001.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../../users/migrations/0002.sql', import.meta.url), 'utf8'));
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
    RESEND_API_KEY: 're_test_private', AUTH_TURNSTILE_SITE_KEY: 'site-test', AUTH_TURNSTILE_SECRET: 'secret-test',
    AUTH_RATE_LIMIT_SECRET: 'rate-secret-test-value-long-enough', USER_DB: adapter,
  };
  const fetcher = async (_url, options) => {
    messages.push({ payload: JSON.parse(options.body), key: options.headers['idempotency-key'] });
    return Response.json({ id: `mail-${messages.length}` });
  };
  let challengeId = 0;
  function context(action, options = {}) {
    const method = options.method ?? 'POST';
    const headers = new Headers({ origin: env.AUTH_SITE_URL, 'cf-connecting-ip': '203.0.113.1', accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) });
    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    const value = action === 'register' && !options.noTurnstile && options.body && typeof options.body === 'object'
      ? { ...options.body, turnstileToken: options.body.turnstileToken ?? `test-token-${++challengeId}` } : options.body;
    const body = method === 'GET' || method === 'HEAD' ? undefined : typeof value === 'string' ? value : JSON.stringify(value ?? {});
    const outgoing = (url, init) => String(url).includes('/siteverify')
      ? Response.json(options.turnstileResult ?? { success: true, hostname: 'news.example', action: options.turnstileAction ?? 'register' })
      : (options.fetcher ?? fetcher)(url, init);
    return { env, fetcher: outgoing, now: options.now ?? (() => new Date(NOW)), ...(options.waitUntil ? { waitUntil: options.waitUntil } : {}), request: new Request(new URL(`/api/auth/${action}`, env.AUTH_SITE_URL), { method, headers, ...(body === undefined ? {} : { body }) }) };
  }
  return { db, env, messages, context, close() { db.close(); } };
}
