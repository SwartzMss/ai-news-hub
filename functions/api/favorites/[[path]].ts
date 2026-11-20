import { AuthError, getConfig, json, nowMs, requireOrigin, requireSameOrigin,
  type AuthContext, type AuthConfig } from '../../../auth/runtime.js';
import { onlyFavoriteKeys, readFavoriteJson, requireFavoriteUser, validId } from '../../../favorites/http.js';
import { validateSnapshot, type FavoriteSnapshot } from '../../../favorites/snapshot.js';

const MAX_BODY = 65536;
type Row = { id: string; article_key: string; snapshot_json: string; created_at: number; category_id: string | null };

function favorite(row: Row): { id: string; articleKey: string; createdAt: number; categoryId: string | null; snapshot: FavoriteSnapshot } {
  return { id: row.id, articleKey: row.article_key, createdAt: row.created_at, categoryId: row.category_id,
    snapshot: JSON.parse(row.snapshot_json) as FavoriteSnapshot };
}

async function route(ctx: AuthContext, config: AuthConfig, userId: string): Promise<Response> {
  const url = new URL(ctx.request.url);
  const path = url.pathname.slice('/api/favorites'.length).replace(/\/$/, '');
  if (path === '' && ctx.request.method === 'POST') {
    requireSameOrigin(ctx, config);
    if (url.search) throw new AuthError('invalid_request', 400);
    const body = await readFavoriteJson(ctx.request, MAX_BODY);
    onlyFavoriteKeys(body, ['articleKey']);
    if (typeof body.articleKey !== 'string' || !/^[0-9a-f]{32}$/.test(body.articleKey)) throw new AuthError('invalid_request', 400);
    const key = body.articleKey;
    const existing = await config.db.prepare('SELECT id,article_key,snapshot_json,created_at,category_id FROM favorites WHERE user_id=? AND article_key=?')
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
    const row = await config.db.prepare('SELECT id,article_key,snapshot_json,created_at,category_id FROM favorites WHERE user_id=? AND article_key=?')
      .bind(userId, key).first<Row>();
    if (!row) throw new AuthError('unauthorized', 401);
    return json({ favorite: favorite(row) }, inserted.meta.changes === 1 ? 201 : 200);
  }
  if (path === '' && ctx.request.method === 'GET') {
    if ([...url.searchParams.keys()].some(key => !['limit', 'offset', 'sort', 'q', 'category', 'articleKey'].includes(key))
      || ['limit', 'offset', 'sort', 'q', 'category', 'articleKey'].some(key => url.searchParams.getAll(key).length > 1)) throw new AuthError('invalid_request', 400);
    const limitText = url.searchParams.get('limit') ?? '20';
    const offsetText = url.searchParams.get('offset') ?? '0';
    const sort = url.searchParams.get('sort') ?? 'newest';
    const query = (url.searchParams.get('q') ?? '').trim();
    const categoryId = url.searchParams.get('category') ?? 'all';
    const articleKey = url.searchParams.get('articleKey');
    if (!/^[1-9]\d*$/.test(limitText) || !/^\d+$/.test(offsetText) || !['newest', 'oldest'].includes(sort)) throw new AuthError('invalid_request', 400);
    if (query.length > 100 || /[\u0000-\u001f\u007f]/u.test(query)
      || (categoryId !== 'all' && categoryId !== 'none' && !validId(categoryId))) throw new AuthError('invalid_request', 400);
    if (articleKey !== null && !/^[0-9a-f]{32}$/.test(articleKey)) throw new AuthError('invalid_request', 400);
    const limit = Number(limitText), offset = Number(offsetText);
    if (limit > 50 || offset > 10000) throw new AuthError('invalid_request', 400);
    const order = sort === 'newest' ? 'DESC' : 'ASC';
    const filters = ['user_id=?'];
    const args: unknown[] = [userId];
    if (categoryId === 'none') filters.push('category_id IS NULL');
    else if (categoryId !== 'all') { filters.push('category_id=?'); args.push(categoryId); }
    if (articleKey) { filters.push('article_key=?'); args.push(articleKey); }
    if (query) {
      const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
      filters.push(`(json_extract(snapshot_json,'$.article.title') LIKE ? ESCAPE '\\'
        OR json_extract(snapshot_json,'$.article.source.name') LIKE ? ESCAPE '\\')`);
      args.push(pattern, pattern);
    }
    const rows = await config.db.prepare(`SELECT id,article_key,snapshot_json,created_at,category_id FROM favorites WHERE ${filters.join(' AND ')}
      ORDER BY created_at ${order},id ${order} LIMIT ? OFFSET ?`).bind(...args, limit + 1, offset).all<Row>();
    return json({ favorites: rows.results.slice(0, limit).map(row => {
      const snapshot = JSON.parse(row.snapshot_json) as FavoriteSnapshot;
      const article = snapshot.article;
      const source = article.source as { name: string; published_at: string | null } | undefined;
      return { id: row.id, articleKey: row.article_key, createdAt: row.created_at, categoryId: row.category_id,
        title: article.title, topic: article.topic, category: article.category, reportDate: article.report_date,
        sourceName: source?.name ?? '', sourcePublishedAt: source?.published_at ?? null };
    }), limit, offset, sort, q: query, categoryId, hasMore: rows.results.length > limit });
  }
  const moveId = /^\/([^/]+)\/category$/.exec(path)?.[1];
  if (moveId && ctx.request.method === 'PATCH') {
    requireSameOrigin(ctx, config);
    if (!validId(moveId) || url.search) throw new AuthError('invalid_request', 400);
    const body = await readFavoriteJson(ctx.request);
    onlyFavoriteKeys(body, ['categoryId']);
    const categoryId = body.categoryId;
    if (categoryId !== null && (typeof categoryId !== 'string' || !validId(categoryId))) throw new AuthError('invalid_request', 400);
    const result = await config.db.prepare(`UPDATE favorites SET category_id=? WHERE id=? AND user_id=?
      AND (? IS NULL OR EXISTS (SELECT 1 FROM favorite_categories WHERE id=? AND user_id=?))`)
      .bind(categoryId, moveId, userId, categoryId, categoryId, userId).run();
    if (result.meta.changes !== 1) throw new AuthError('not_found', 404);
    const row = await config.db.prepare('SELECT id,article_key,snapshot_json,created_at,category_id FROM favorites WHERE id=? AND user_id=?')
      .bind(moveId, userId).first<Row>();
    if (!row) throw new AuthError('not_found', 404);
    return json({ favorite: favorite(row) });
  }
  const id = /^\/([^/]+)$/.exec(path)?.[1];
  if (!id || url.search) throw new AuthError('not_found', 404);
  if (!validId(id)) throw new AuthError('not_found', 404);
  if (ctx.request.method === 'GET') {
    const row = await config.db.prepare('SELECT id,article_key,snapshot_json,created_at,category_id FROM favorites WHERE id=? AND user_id=?')
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
    return await route(ctx, config, await requireFavoriteUser(ctx, config));
  } catch (error) {
    const safe = error instanceof AuthError ? error : new AuthError('favorites_unavailable', 503);
    return json({ error: safe.code }, safe.status);
  }
}
