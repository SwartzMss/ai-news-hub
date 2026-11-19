import { AuthError, hashToken, nowMs, type AuthConfig, type AuthContext } from './runtime.js';

export async function verifyTurnstile(ctx: AuthContext, config: AuthConfig, token: unknown, action: string): Promise<void> {
  if (!config.turnstileSecret || !config.turnstileSiteKey) throw new AuthError('auth_unavailable', 503);
  if (typeof token !== 'string' || token.length < 1 || token.length > 2048) throw new AuthError('turnstile_failed', 403);
  const body = new FormData();
  body.set('secret', config.turnstileSecret);
  body.set('response', token);
  body.set('idempotency_key', crypto.randomUUID());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await (ctx.fetcher ?? fetch)('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', redirect: 'manual', body, signal: controller.signal,
    });
    if (!response.ok) throw new AuthError('turnstile_unavailable', 503);
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object') throw new AuthError('turnstile_unavailable', 503);
    const result = data as { success?: unknown; hostname?: unknown; action?: unknown };
    if (result.success !== true || result.hostname !== new URL(config.origin).hostname || result.action !== action) {
      throw new AuthError('turnstile_failed', 403);
    }
    const now = nowMs(ctx);
    const used = await config.db.prepare(`INSERT INTO auth_rate_limits (key_hash,window_start,expires_at,attempts)
      VALUES (?,?,?,1) ON CONFLICT(key_hash) DO NOTHING`)
      .bind(await hashToken(`turnstile:${token}`), now, now + 5 * 60000).run();
    if (used.meta.changes !== 1) throw new AuthError('turnstile_failed', 403);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError('turnstile_unavailable', 503);
  } finally { clearTimeout(timer); }
}
