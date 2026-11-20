import { AuthError, getConfig, hashToken, json, nowMs, readSessionToken, requireOrigin, requireSameOrigin,
  type AuthContext, type AuthConfig } from '../../../auth/runtime.js';
import { validateSnapshot, type FavoriteSnapshot } from '../../../favorites/snapshot.js';

const IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY = 65536;
type Row = { id: string; article_key: string; snapshot_json: string; created_at: number };

async function requireUser(ctx: AuthContext, config: AuthConfig): Promise<string> {
  const token = readSessionToken(ctx.request);
  if (!token) throw new AuthError('unauthorized', 401);
  const now = nowMs(ctx);
  const row = await config.db.prepare(`SELECT u.id,s.id AS session_id,s.last_seen_at FROM auth_sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL
    AND s.expires_at>? AND s.last_seen_at>? AND u.status='active' AND u.email_verified_at IS NOT NULL`)
    .bind(await hashToken(token), now, now - IDLE_MS).first<{ id: string; session_id: string; last_seen_at: number }>();
  if (!row) throw new AuthError('unauthorized', 401);
  if (now - row.last_seen_at >= 5 * 60000) {
    const refreshed = await config.db.prepare(`UPDATE auth_sessions SET last_seen_at=? WHERE id=?
      AND revoked_at IS NULL AND expires_at>? AND last_seen_at>?`).bind(now, row.session_id, now, now - IDLE_MS).run();
    if (refreshed.meta.changes !== 1) throw new AuthError('unauthorized', 401);
  }
  return row.id;
}

async function bodyFrom(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new AuthError('invalid_request', 400);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError('invalid_request', 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.length;
    if (size > MAX_BODY) { await reader.cancel(); throw new AuthError('request_too_large', 413); }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error();
    return data as Record<string, unknown>;
  } catch { throw new AuthError('invalid_request', 400); }
}

function favorite(row: Row): { id: string; articleKey: string; createdAt: number; snapshot: FavoriteSnapshot } {
  return { id: row.id, articleKey: row.article_key, createdAt: row.created_at,
    snapshot: JSON.parse(row.snapshot_json) as FavoriteSnapshot };
}

async function route(ctx: AuthContext, config: AuthConfig, userId: string): Promise<Response> {
  const url = new URL(ctx.request.url);
  const path = url.pathname.slice('/api/favorites'.length).replace(/\/$/, '');
  if (path === '' && ctx.request.method === 'POST') {
    requireSameOrigin(ctx, config);
    if (url.search) throw new AuthError('invalid_request', 400);
    const body = await bodyFrom(ctx.request);
    if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'articleKey')
      || typeof body.articleKey !== 'string' || !/^[0-9a-f]{32}$/.test(body.articleKey)) throw new AuthError('invalid_request', 400);
    const key = body.articleKey;
    const existing = await config.db.prepare('SELECT id,article_key,snapshot_json,created_at FROM favorites WHERE user_id=? AND article_key=?')
      .bind(userId, key).first<Row>();
    if (existing) return json({ favorite: favorite(existing) }, 200);
    if (!ctx.env.ASSETS) throw new AuthError('favorites_unavailable', 503);
    let asset: Response;
    try { asset = await ctx.env.ASSETS.fetch(`${config.origin}/data/articles/${key}.json`); }
    catch { throw new AuthError('favorites_unavailable', 503); }
    if (asset.status === 404) throw new AuthError('not_found', 404);
    if (!asset.ok) throw new AuthError('favorites_unavailable', 503);
    const content = await asset.text();
    if (new TextEncoder().encode(content).length > MAX_BODY) throw new AuthError('invalid_snapshot', 400);
    let source: unknown;
    try { source = JSON.parse(content); } catch { throw new AuthError('invalid_snapshot', 400); }
    const snapshot = await validateSnapshot(source);
    if (snapshot.article.key !== key) throw new AuthError('invalid_snapshot', 400);
    const id = crypto.randomUUID();
    const now = nowMs(ctx);
    const inserted = await config.db.prepare(`INSERT OR IGNORE INTO favorites
      (id,user_id,article_key,snapshot_version,snapshot_json,created_at)
      SELECT ?,id,?,1,?,? FROM users WHERE id=? AND status='active' AND email_verified_at IS NOT NULL`)
      .bind(id, key, JSON.stringify(snapshot), now, userId).run();
    const row = await config.db.prepare('SELECT id,article_key,snapshot_json,created_at FROM favorites WHERE user_id=? AND article_key=?')
      .bind(userId, key).first<Row>();
    if (!row) throw new AuthError('unauthorized', 401);
    return json({ favorite: favorite(row) }, inserted.meta.changes === 1 ? 201 : 200);
  }
  if (path === '' && ctx.request.method === 'GET') {
    if ([...url.searchParams.keys()].some(key => !['limit', 'offset', 'sort'].includes(key))
      || ['limit', 'offset', 'sort'].some(key => url.searchParams.getAll(key).length > 1)) throw new AuthError('invalid_request', 400);
    const limitText = url.searchParams.get('limit') ?? '20';
    const offsetText = url.searchParams.get('offset') ?? '0';
    const sort = url.searchParams.get('sort') ?? 'newest';
    if (!/^[1-9]\d*$/.test(limitText) || !/^\d+$/.test(offsetText) || !['newest', 'oldest'].includes(sort)) throw new AuthError('invalid_request', 400);
    const limit = Number(limitText), offset = Number(offsetText);
    if (limit > 50 || offset > 10000) throw new AuthError('invalid_request', 400);
    const order = sort === 'newest' ? 'DESC' : 'ASC';
    const rows = await config.db.prepare(`SELECT id,article_key,snapshot_json,created_at FROM favorites WHERE user_id=?
      ORDER BY created_at ${order},id ${order} LIMIT ? OFFSET ?`).bind(userId, limit + 1, offset).all<Row>();
    return json({ favorites: rows.results.slice(0, limit).map(row => {
      const snapshot = JSON.parse(row.snapshot_json) as FavoriteSnapshot;
      const article = snapshot.article;
      return { id: row.id, articleKey: row.article_key, createdAt: row.created_at,
        title: article.title, topic: article.topic, category: article.category, reportDate: article.report_date };
    }), limit, offset, sort, hasMore: rows.results.length > limit });
  }
  const id = /^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(path)?.[1];
  if (!id || url.search) throw new AuthError('not_found', 404);
  if (ctx.request.method === 'GET') {
    const row = await config.db.prepare('SELECT id,article_key,snapshot_json,created_at FROM favorites WHERE id=? AND user_id=?')
      .bind(id, userId).first<Row>();
    if (!row) throw new AuthError('not_found', 404);
    return json({ favorite: favorite(row) });
  }
  if (ctx.request.method === 'DELETE') {
    requireSameOrigin(ctx, config);
    const result = await config.db.prepare('DELETE FROM favorites WHERE id=? AND user_id=?').bind(id, userId).run();
    if (result.meta.changes !== 1) throw new AuthError('not_found', 404);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }
  throw new AuthError('not_found', 404);
}

export async function onRequest(ctx: AuthContext): Promise<Response> {
  try {
    const config = getConfig(ctx.env);
    requireOrigin(ctx, config);
    const site = ctx.request.headers.get('sec-fetch-site');
    if (site && !['same-origin', 'none'].includes(site)) throw new AuthError('invalid_origin', 403);
    return await route(ctx, config, await requireUser(ctx, config));
  } catch (error) {
    const safe = error instanceof AuthError ? error : new AuthError('favorites_unavailable', 503);
    return json({ error: safe.code }, safe.status);
  }
}
