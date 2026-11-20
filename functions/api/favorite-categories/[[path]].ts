import { AuthError, getConfig, json, nowMs, requireOrigin, requireSameOrigin,
  type AuthContext, type AuthConfig } from '../../../auth/runtime.js';
import { onlyFavoriteKeys, readFavoriteJson, requireFavoriteUser, validId } from '../../../favorites/http.js';

type Row = { id: string; name: string; sort_order: number; created_at: number; updated_at: number };
const category = (row: Row) => ({ id: row.id, name: row.name, sortOrder: row.sort_order,
  createdAt: row.created_at, updatedAt: row.updated_at });

function validName(value: unknown): { name: string; key: string } {
  if (typeof value !== 'string') throw new AuthError('invalid_request', 400);
  const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  const key = name.toLowerCase();
  if (!name || [...name].length > 50 || [...key].length > 50 || new TextEncoder().encode(name).length > 200
    || /[<>\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069]/u.test(name)) {
    throw new AuthError('invalid_request', 400);
  }
  return { name, key };
}

function validOrder(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 10000) {
    throw new AuthError('invalid_request', 400);
  }
  return value as number;
}

async function route(ctx: AuthContext, config: AuthConfig, userId: string): Promise<Response> {
  const url = new URL(ctx.request.url);
  const path = url.pathname.slice('/api/favorite-categories'.length).replace(/\/$/, '');
  if (url.search) throw new AuthError('invalid_request', 400);
  if (path === '' && ctx.request.method === 'GET') {
    const rows = await config.db.prepare(`SELECT id,name,sort_order,created_at,updated_at FROM favorite_categories
      WHERE user_id=? ORDER BY sort_order ASC,created_at ASC,id ASC`).bind(userId).all<Row>();
    return json({ categories: rows.results.map(category) });
  }
  if (path === '' && ctx.request.method === 'POST') {
    requireSameOrigin(ctx, config);
    const body = await readFavoriteJson(ctx.request);
    onlyFavoriteKeys(body, ['name', 'sortOrder'], ['name']);
    const { name, key } = validName(body.name);
    const order = Object.hasOwn(body, 'sortOrder') ? validOrder(body.sortOrder) : 0;
    const now = nowMs(ctx);
    const result = await config.db.prepare(`INSERT OR IGNORE INTO favorite_categories
      (id,user_id,name,name_key,sort_order,created_at,updated_at)
      SELECT ?,id,?,?,?,?,? FROM users WHERE id=? AND status='active' AND email_verified_at IS NOT NULL`)
      .bind(crypto.randomUUID(), name, key, order, now, now, userId).run();
    const row = await config.db.prepare(`SELECT id,name,sort_order,created_at,updated_at FROM favorite_categories
      WHERE user_id=? AND name_key=?`).bind(userId, key).first<Row>();
    if (!row) throw new AuthError('unauthorized', 401);
    return json({ category: category(row) }, result.meta.changes === 1 ? 201 : 200);
  }
  const id = /^\/([^/]+)$/.exec(path)?.[1];
  if (!id || !validId(id)) throw new AuthError('not_found', 404);
  if (ctx.request.method === 'PATCH') {
    requireSameOrigin(ctx, config);
    const body = await readFavoriteJson(ctx.request);
    onlyFavoriteKeys(body, ['name', 'sortOrder'], []);
    if (Object.keys(body).length === 0) throw new AuthError('invalid_request', 400);
    const prior = await config.db.prepare(`SELECT id,name,sort_order,created_at,updated_at FROM favorite_categories
      WHERE id=? AND user_id=?`).bind(id, userId).first<Row>();
    if (!prior) throw new AuthError('not_found', 404);
    const edits: string[] = [];
    const values: unknown[] = [];
    if (Object.hasOwn(body, 'name')) {
      const nextName = validName(body.name);
      edits.push('name=?', 'name_key=?');
      values.push(nextName.name, nextName.key);
    }
    if (Object.hasOwn(body, 'sortOrder')) {
      edits.push('sort_order=?');
      values.push(validOrder(body.sortOrder));
    }
    edits.push('updated_at=?');
    values.push(nowMs(ctx));
    const result = await config.db.prepare(`UPDATE OR IGNORE favorite_categories
      SET ${edits.join(',')} WHERE id=? AND user_id=?`).bind(...values, id, userId).run();
    if (result.meta.changes !== 1) {
      const exists = await config.db.prepare('SELECT id FROM favorite_categories WHERE id=? AND user_id=?')
        .bind(id, userId).first();
      throw new AuthError(exists ? 'category_conflict' : 'not_found', exists ? 409 : 404);
    }
    const row = await config.db.prepare(`SELECT id,name,sort_order,created_at,updated_at FROM favorite_categories
      WHERE id=? AND user_id=?`).bind(id, userId).first<Row>();
    if (!row) throw new AuthError('not_found', 404);
    return json({ category: category(row) });
  }
  if (ctx.request.method === 'DELETE') {
    requireSameOrigin(ctx, config);
    const results = await config.db.batch([
      config.db.prepare('UPDATE favorites SET category_id=NULL WHERE user_id=? AND category_id=?').bind(userId, id),
      config.db.prepare('DELETE FROM favorite_categories WHERE id=? AND user_id=?').bind(id, userId),
    ]);
    if (results[1].meta.changes !== 1) throw new AuthError('not_found', 404);
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
    const safe = error instanceof AuthError ? error : new AuthError('categories_unavailable', 503);
    return json({ error: safe.code }, safe.status);
  }
}
