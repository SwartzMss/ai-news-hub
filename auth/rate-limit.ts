import { AuthError, nowMs, type AuthConfig, type AuthContext } from './runtime.js';

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const policies: Record<string, { ip: [number, number]; subject: [number, number] }> = {
  register: { ip: [10, HOUR], subject: [3, DAY] },
  login: { ip: [30, 15 * MINUTE], subject: [12, 15 * MINUTE] },
  verify_email: { ip: [30, HOUR], subject: [5, HOUR] },
  forgot_password: { ip: [10, DAY], subject: [3, DAY] },
  reset_password: { ip: [20, HOUR], subject: [5, HOUR] },
  change_password: { ip: [20, HOUR], subject: [5, HOUR] },
};

async function keyFor(secret: string, action: string, scope: string, value: string, windowStart: number): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${action}|${scope}|${value}|${windowStart}`)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function limitRequest(ctx: AuthContext, config: AuthConfig, action: keyof typeof policies,
  subject: string, scope: 'ip' | 'subject' | 'both' = 'both'): Promise<number> {
  if (!config.rateLimitSecret || config.rateLimitSecret.length < 32) throw new AuthError('auth_unavailable', 503);
  const policy = policies[action];
  if (!policy) throw new AuthError('auth_unavailable', 503);
  const now = nowMs(ctx);
  const incomingIp = ctx.request.headers.get('cf-connecting-ip') ?? '';
  if (!/^[0-9a-f:.]{3,45}$/i.test(incomingIp)) throw new AuthError('auth_unavailable', 503);
  const ip = incomingIp.toLowerCase();
  const buckets = [
    ...(scope !== 'subject' ? [{ scope: 'ip', value: ip, limit: policy.ip[0], duration: policy.ip[1] }] : []),
    ...(scope !== 'ip' ? [{ scope: 'subject', value: subject, limit: policy.subject[0], duration: policy.subject[1] }] : []),
  ];
  let denied = false;
  let maximum = 0;
  for (const bucket of buckets) {
    const start = Math.floor(now / bucket.duration) * bucket.duration;
    const key = await keyFor(config.rateLimitSecret, action, bucket.scope, bucket.value, start);
    const result = await config.db.prepare(`INSERT INTO auth_rate_limits (key_hash,window_start,expires_at,attempts)
      VALUES (?,?,?,1) ON CONFLICT(key_hash) DO UPDATE SET attempts=attempts+1
      WHERE attempts<?`).bind(key, start, start + bucket.duration, bucket.limit).run();
    if (!result.meta.changes) denied = true;
    const row = await config.db.prepare('SELECT attempts FROM auth_rate_limits WHERE key_hash=?')
      .bind(key).first<{ attempts: number }>();
    maximum = Math.max(maximum, row?.attempts ?? 0);
  }
  await config.db.prepare(`DELETE FROM auth_rate_limits WHERE key_hash IN
    (SELECT key_hash FROM auth_rate_limits WHERE expires_at<=? LIMIT 100)`).bind(now).run();
  if (denied) throw new AuthError('rate_limited', 429);
  return maximum;
}
