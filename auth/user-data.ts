import { verifyPassword } from './password.js';
import { limitRequest } from './rate-limit.js';
import {
  AuthError, type AuthContext, type AuthConfig, hashToken, nowMs, onlyKeys, readBody,
  readSessionToken, requireSameOrigin,
} from './runtime.js';

const DAY = 86400000;
type User = { id: string; email_normalized: string; password_hash: string;
  email_verified_at: number; created_at: number; updated_at: number };

async function exportKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function issueExportToken(secret: string, userId: string, exportedAt: number): Promise<string> {
  const expiresAt = exportedAt + 15 * 60000;
  const signature = await crypto.subtle.sign('HMAC', await exportKey(secret),
    new TextEncoder().encode(`export|${userId}|${exportedAt}|${expiresAt}`));
  return `${expiresAt}.${hex(signature)}`;
}

async function validExportToken(secret: string, userId: string, exportedAt: number, token: unknown, now: number): Promise<boolean> {
  if (typeof token !== 'string' || !/^\d{13}\.[0-9a-f]{64}$/.test(token)) return false;
  const [expiry, signature] = token.split('.');
  const expiresAt = Number(expiry);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now || expiresAt !== exportedAt + 15 * 60000) return false;
  const bytes = new Uint8Array(signature.match(/../g)!.map(pair => Number.parseInt(pair, 16)));
  return crypto.subtle.verify('HMAC', await exportKey(secret), bytes,
    new TextEncoder().encode(`export|${userId}|${exportedAt}|${expiresAt}`));
}

async function currentUser(ctx: AuthContext, config: AuthConfig):
  Promise<{ user: User; body: Record<string, unknown> }> {
  requireSameOrigin(ctx, config);
  const token = readSessionToken(ctx.request);
  if (!token) throw new AuthError('unauthorized', 401);
  const body = await readBody(ctx.request);
  const continuation = body.cursor !== undefined;
  onlyKeys(body, continuation ? ['cursor', 'exportedAt', 'exportToken'] : ['password']);
  if (!continuation && (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128
    || new TextEncoder().encode(body.password).length > 256)) throw new AuthError('invalid_request', 400);
  const now = nowMs(ctx);
  const user = await config.db.prepare(`SELECT u.id,u.email_normalized,u.password_hash,u.email_verified_at,u.created_at,u.updated_at
    FROM auth_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.last_seen_at>?
    AND u.status='active' AND u.email_verified_at IS NOT NULL`)
    .bind(await hashToken(token), now, now - 7 * DAY).first<User>();
  if (!user) throw new AuthError('unauthorized', 401);
  if (!continuation) {
    await limitRequest(ctx, config, 'export_data', user.id);
    if (!await verifyPassword(body.password as string, user.password_hash)) throw new AuthError('invalid_credentials', 401);
  }
  return { user, body };
}

export async function exportData(ctx: AuthContext, config: AuthConfig): Promise<Response> {
  const { user, body } = await currentUser(ctx, config);
  const firstPage = body.cursor === undefined && body.exportedAt === undefined;
  if (!firstPage && (!body.cursor || typeof body.cursor !== 'object' || Array.isArray(body.cursor)
    || !Number.isSafeInteger((body.cursor as { createdAt?: unknown }).createdAt)
    || typeof (body.cursor as { id?: unknown }).id !== 'string'
    || (body.cursor as { id: string }).id.length < 1 || (body.cursor as { id: string }).id.length > 128
    || !Number.isSafeInteger(body.exportedAt) || (body.exportedAt as number) > nowMs(ctx)
    || (body.exportedAt as number) < 0)) throw new AuthError('invalid_request', 400);
  const exportedAt = firstPage ? nowMs(ctx) : body.exportedAt as number;
  if (!config.rateLimitSecret || config.rateLimitSecret.length < 32) throw new AuthError('auth_unavailable', 503);
  if (!firstPage && !await validExportToken(config.rateLimitSecret, user.id, exportedAt, body.exportToken, nowMs(ctx)))
    throw new AuthError('unauthorized', 401);
  const exportToken = firstPage ? await issueExportToken(config.rateLimitSecret, user.id, exportedAt) : body.exportToken;
  const cursor = firstPage ? { createdAt: -1, id: '' } : body.cursor as { createdAt: number; id: string };
  const categories = firstPage ? (await config.db.prepare(`SELECT id,name,sort_order,created_at,updated_at FROM favorite_categories
    WHERE user_id=? ORDER BY sort_order,created_at,id`).bind(user.id).all<{
    id: string; name: string; sort_order: number; created_at: number; updated_at: number }>()).results.map(row => ({
    id: row.id, name: row.name, sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at,
  })) : undefined;
  const rows = await config.db.prepare(`SELECT id,article_key,snapshot_version,snapshot_json,created_at,category_id
    FROM favorites WHERE user_id=? AND created_at<=?
      AND (created_at>? OR (created_at=? AND id>?))
      ORDER BY created_at,id LIMIT 101`).bind(user.id, exportedAt, cursor.createdAt, cursor.createdAt, cursor.id).all<{
    id: string; article_key: string; snapshot_version: number; snapshot_json: string;
    created_at: number; category_id: string | null }>();
  const page = rows.results.slice(0, 100);
  const last = page.at(-1);
  const favorites = page.map(row => ({ id: row.id, articleKey: row.article_key,
    snapshotVersion: row.snapshot_version, snapshot: JSON.parse(row.snapshot_json) as unknown,
    createdAt: row.created_at, categoryId: row.category_id }));
  return new Response(JSON.stringify({ schemaVersion: 1, exportedAt, exportToken,
    ...(firstPage ? { account: { email: user.email_normalized, verifiedAt: user.email_verified_at,
      createdAt: user.created_at, updatedAt: user.updated_at }, categories } : {}),
    favorites, nextCursor: rows.results.length > 100 && last ? { createdAt: last.created_at, id: last.id } : null }),
  { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } });
}
