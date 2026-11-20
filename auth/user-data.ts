import { verifyPassword } from './password.js';
import { limitRequest } from './rate-limit.js';
import {
  AuthError, type AuthContext, type AuthConfig, empty, hashToken, nowMs, onlyKeys, readBody,
  readSessionToken, requireSameOrigin, sessionCookie,
} from './runtime.js';

const DAY = 86400000;
type User = { id: string; email_normalized: string; password_hash: string;
  email_verified_at: number; created_at: number; updated_at: number };

async function currentUser(ctx: AuthContext, config: AuthConfig, action: 'export_data' | 'delete_account'): Promise<User> {
  requireSameOrigin(ctx, config);
  const token = readSessionToken(ctx.request);
  if (!token) throw new AuthError('unauthorized', 401);
  const body = await readBody(ctx.request);
  onlyKeys(body, ['password']);
  if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128
    || new TextEncoder().encode(body.password).length > 256) throw new AuthError('invalid_request', 400);
  const now = nowMs(ctx);
  const user = await config.db.prepare(`SELECT u.id,u.email_normalized,u.password_hash,u.email_verified_at,u.created_at,u.updated_at
    FROM auth_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.last_seen_at>?
    AND u.status='active' AND u.email_verified_at IS NOT NULL`)
    .bind(await hashToken(token), now, now - 7 * DAY).first<User>();
  if (!user) throw new AuthError('unauthorized', 401);
  await limitRequest(ctx, config, action, user.id);
  if (!await verifyPassword(body.password, user.password_hash)) throw new AuthError('invalid_credentials', 401);
  return user;
}

export async function exportData(ctx: AuthContext, config: AuthConfig): Promise<Response> {
  const user = await currentUser(ctx, config, 'export_data');
  const encoder = new TextEncoder();
  const exportedAt = nowMs(ctx);
  let cursorAt = -1;
  let cursorId = '';
  let first = true;
  let phase: 'head' | 'favorites' | 'done' = 'head';
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (phase === 'head') {
          const rows = await config.db.prepare(`SELECT id,name,sort_order,created_at,updated_at FROM favorite_categories
            WHERE user_id=? ORDER BY sort_order,created_at,id`).bind(user.id).all<{
            id: string; name: string; sort_order: number; created_at: number; updated_at: number }>();
          const categories = rows.results.map(row => ({ id: row.id, name: row.name, sortOrder: row.sort_order,
            createdAt: row.created_at, updatedAt: row.updated_at }));
          const head = JSON.stringify({ schemaVersion: 1, exportedAt: new Date(exportedAt).toISOString(),
            account: { email: user.email_normalized, verifiedAt: user.email_verified_at,
              createdAt: user.created_at, updatedAt: user.updated_at }, categories });
          controller.enqueue(encoder.encode(head.slice(0, -1) + ',"favorites":['));
          phase = 'favorites';
          return;
        }
        if (phase === 'favorites') {
          const rows = await config.db.prepare(`SELECT id,article_key,snapshot_version,snapshot_json,created_at,category_id
            FROM favorites WHERE user_id=? AND created_at<=?
              AND (created_at>? OR (created_at=? AND id>?))
              ORDER BY created_at,id LIMIT 50`).bind(user.id, exportedAt, cursorAt, cursorAt, cursorId).all<{
              id: string; article_key: string; snapshot_version: number; snapshot_json: string;
              created_at: number; category_id: string | null }>();
          const values = rows.results.map(row => JSON.stringify({ id: row.id, articleKey: row.article_key,
            snapshotVersion: row.snapshot_version, snapshot: JSON.parse(row.snapshot_json) as unknown,
            createdAt: row.created_at, categoryId: row.category_id }));
          if (values.length) controller.enqueue(encoder.encode((first ? '' : ',') + values.join(',')));
          first = false;
          if (rows.results.length) { const last = rows.results.at(-1)!; cursorAt = last.created_at; cursorId = last.id; }
          if (rows.results.length < 50) {
            controller.enqueue(encoder.encode(']}'));
            controller.close();
            phase = 'done';
          }
        }
      } catch (error) { controller.error(error); }
    },
  });
  return new Response(stream, { status: 200, headers: {
    'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="ai-news-hub-data.json"',
    'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
  } });
}

export async function deleteAccount(ctx: AuthContext, config: AuthConfig): Promise<Response> {
  const user = await currentUser(ctx, config, 'delete_account');
  const bucket = ctx.env.USER_BACKUP_BUCKET;
  if (!bucket) throw new AuthError('account_unavailable', 503);
  try {
    const recorded = await bucket.put(`tombstones/${user.id}.json`, JSON.stringify({ schemaVersion: 1, userId: user.id,
      deletedAt: new Date(nowMs(ctx)).toISOString() }), { httpMetadata: { contentType: 'application/json' } });
    if (!recorded) throw new AuthError('account_unavailable', 503);
    const result = await config.db.prepare('DELETE FROM users WHERE id=?').bind(user.id).run();
    if (result.meta.changes !== 1) throw new AuthError('unauthorized', 401);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError('account_unavailable', 503);
  }
  return empty(204, { 'set-cookie': sessionCookie('', 0) });
}
