import { AuthError, hashToken, nowMs, readSessionToken, type AuthConfig, type AuthContext } from '../auth/runtime.js';

const IDLE_MS = 7 * 24 * 60 * 60 * 1000;

export async function requireFavoriteUser(ctx: AuthContext, config: AuthConfig): Promise<string> {
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

export async function readFavoriteJson(request: Request, maxBytes = 4096): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new AuthError('invalid_request', 400);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError('invalid_request', 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.length;
    if (size > maxBytes) { await reader.cancel(); throw new AuthError('request_too_large', 413); }
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

export function onlyFavoriteKeys(body: Record<string, unknown>, allowed: string[], required = allowed): void {
  if (Object.keys(body).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(body, key))) {
    throw new AuthError('invalid_request', 400);
  }
}

export const validId = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
