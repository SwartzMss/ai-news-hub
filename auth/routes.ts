import { MailError, sendMail } from '../mail/transport.js';
import { hashPassword, verifyPassword } from './password.js';
import {
  AuthError, type AuthContext, type AuthConfig, empty, hashToken, json, normalizeEmail,
  nowMs, onlyKeys, page, randomToken, readBody, readSessionToken, requireMailConfig,
  requireSameOrigin, sessionCookie,
} from './runtime.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const SESSION_SECONDS = 30 * 24 * 3600;
const ACCEPTED = { message: '如果可以注册，我们会发送邮箱验证邮件。' };
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface UserRecord { id: string; email_normalized: string; password_hash: string; email_verified_at: number | null; status: string }

function validPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128 || new TextEncoder().encode(value).length > 256) throw new AuthError('invalid_request');
  return value;
}

function verifyReply(ctx: AuthContext, ok: boolean): Response {
  if (ctx.request.headers.get('accept')?.includes('text/html')) return page(ok ? '邮箱已验证' : '链接已失效', ok ? '现在可以登录。' : '链接无效、已使用或已过期。', undefined, ok ? 200 : 400);
  return ok ? json({ verified: true }) : json({ error: 'invalid_token' }, 400);
}

export async function register(ctx: AuthContext, config: AuthConfig): Promise<Response> {
  requireSameOrigin(ctx, config);
  const mail = requireMailConfig(config);
  const body = await readBody(ctx.request);
  onlyKeys(body, ['email', 'password']);
  const email = normalizeEmail(body.email);
  const password = validPassword(body.password);
  const now = nowMs(ctx);
  const passwordHash = await hashPassword(password);
  await config.db.prepare(`INSERT INTO users (id,email_normalized,password_hash,email_verified_at,status,created_at,updated_at)
    VALUES (?,?,?,NULL,'active',?,?) ON CONFLICT(email_normalized) DO NOTHING`)
    .bind(crypto.randomUUID(), email, passwordHash, now, now).run();
  const user = await config.db.prepare('SELECT id FROM users WHERE email_normalized=?')
    .bind(email).first<Pick<UserRecord, 'id'>>();
  const token = randomToken();
  const tokenHash = await hashToken(token);
  const reserved = await config.db.prepare(`INSERT INTO auth_email_tokens (id,user_id,token_hash,purpose,created_at,expires_at,consumed_at)
    SELECT ?,id,?,'verify_email',?,?,NULL FROM users
    WHERE id=? AND status='active' AND email_verified_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM auth_email_tokens WHERE user_id=users.id AND purpose='verify_email'
      AND consumed_at IS NULL AND created_at>?)`)
    .bind(crypto.randomUUID(), tokenHash, now, now + DAY, user?.id ?? '', now - HOUR).run();
  const delivery = Promise.resolve().then(async () => {
    if (!user || !reserved.meta.changes) return;
    const url = `${config.origin}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
    try {
      await sendMail(mail, {
        from: mail.from, to: [email], subject: '验证 AI News Hub 账户邮箱',
        text: `请打开以下链接，设置账户密码并确认邮箱。链接 24 小时内有效。\n\n${url}\n\n如果不是你申请的账户，请忽略此邮件。`,
        html: `<p>请设置 AI News Hub 账户密码并确认邮箱。链接 24 小时内有效。</p><p><a href="${url}">设置密码并确认邮箱</a></p><p>如果不是你申请的账户，请忽略此邮件。</p>`,
      }, `auth/verify/${user.id}/${now}`, ctx.fetcher);
    } catch (error) {
      try {
        await config.db.prepare('DELETE FROM auth_email_tokens WHERE token_hash=? AND consumed_at IS NULL')
          .bind(tokenHash).run();
      } catch {
        console.warn(JSON.stringify({ event: 'auth_verification_token_cleanup_failed' }));
      }
      console.warn(JSON.stringify({ event: 'auth_verification_mail_failed', code: error instanceof MailError ? error.code : 'mail_unavailable' }));
    }
  });
  if (ctx.waitUntil) ctx.waitUntil(delivery);
  else await delivery;
  return json(ACCEPTED, 202);
}

export async function verifyEmail(ctx: AuthContext, config: AuthConfig): Promise<Response> {
  const method = ctx.request.method;
  if (method === 'GET') {
    const token = new URL(ctx.request.url).searchParams.get('token');
    if (!token || !TOKEN_PATTERN.test(token)) return page('链接已失效', '链接无效、已使用或已过期。', undefined, 400);
    const tokenHash = await hashToken(token);
    const row = await config.db.prepare(`SELECT t.id FROM auth_email_tokens t JOIN users u ON u.id=t.user_id
      WHERE t.token_hash=? AND t.purpose='verify_email' AND t.consumed_at IS NULL
      AND t.expires_at>? AND u.status='active' AND u.email_verified_at IS NULL`)
      .bind(tokenHash, nowMs(ctx)).first();
    return row ? page('确认邮箱', '请设置登录密码并确认邮箱。', token) : page('链接已失效', '链接无效、已使用或已过期。', undefined, 400);
  }
  requireSameOrigin(ctx, config);
  const body = await readBody(ctx.request);
  onlyKeys(body, ['token', 'password']);
  if (typeof body.token !== 'string' || !TOKEN_PATTERN.test(body.token)) return verifyReply(ctx, false);
  const password = validPassword(body.password);
  const tokenHash = await hashToken(body.token);
  const now = nowMs(ctx);
  const passwordHash = await hashPassword(password);
  const results = await config.db.batch([
    config.db.prepare(`UPDATE auth_email_tokens SET consumed_at=? WHERE token_hash=?
      AND purpose='verify_email' AND consumed_at IS NULL AND expires_at>?
      AND user_id IN (SELECT id FROM users WHERE status='active' AND email_verified_at IS NULL)`).bind(now, tokenHash, now),
    config.db.prepare(`UPDATE users SET password_hash=?,email_verified_at=?,updated_at=? WHERE email_verified_at IS NULL
      AND status='active' AND id=(SELECT user_id FROM auth_email_tokens
        WHERE token_hash=? AND purpose='verify_email' AND consumed_at=?)`).bind(passwordHash, now, now, tokenHash, now),
  ]);
  return verifyReply(ctx, results[0].meta.changes === 1 && results[1].meta.changes === 1);
}

export async function login(ctx: AuthContext, config: AuthConfig): Promise<Response> {
  requireSameOrigin(ctx, config);
  const body = await readBody(ctx.request);
  onlyKeys(body, ['email', 'password']);
  const email = normalizeEmail(body.email);
  const password = validPassword(body.password);
  const user = await config.db.prepare('SELECT id,email_normalized,password_hash,email_verified_at,status FROM users WHERE email_normalized=?')
    .bind(email).first<UserRecord>();
  const valid = user ? await verifyPassword(password, user.password_hash) : (await hashPassword(password), false);
  if (!valid || !user || user.status !== 'active' || user.email_verified_at === null) throw new AuthError('invalid_credentials', 401);
  const now = nowMs(ctx);
  const token = randomToken();
  const tokenHash = await hashToken(token);
  const old = readSessionToken(ctx.request);
  const statements = [];
  if (old) statements.push(config.db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').bind(now, await hashToken(old)));
  statements.push(config.db.prepare(`INSERT INTO auth_sessions (id,user_id,token_hash,created_at,expires_at,revoked_at)
    SELECT ?,id,?,?,?,NULL FROM users WHERE id=? AND status='active' AND email_verified_at IS NOT NULL`)
    .bind(crypto.randomUUID(), tokenHash, now, now + SESSION_SECONDS * 1000, user.id));
  const results = await config.db.batch(statements);
  if (results.at(-1)?.meta.changes !== 1) throw new AuthError('invalid_credentials', 401);
  return json({ user: { id: user.id, email: user.email_normalized } }, 200, { 'set-cookie': sessionCookie(token, SESSION_SECONDS) });
}

export async function me(ctx: AuthContext, config: AuthConfig): Promise<Response> {
  const token = readSessionToken(ctx.request);
  if (!token) throw new AuthError('unauthorized', 401);
  const user = await config.db.prepare(`SELECT u.id,u.email_normalized FROM auth_sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL
    AND s.expires_at>? AND u.status='active' AND u.email_verified_at IS NOT NULL`)
    .bind(await hashToken(token), nowMs(ctx)).first<{ id: string; email_normalized: string }>();
  if (!user) throw new AuthError('unauthorized', 401);
  return json({ user: { id: user.id, email: user.email_normalized } });
}

export async function logout(ctx: AuthContext, config: AuthConfig): Promise<Response> {
  requireSameOrigin(ctx, config);
  const token = readSessionToken(ctx.request);
  if (token) await config.db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL')
    .bind(nowMs(ctx), await hashToken(token)).run();
  return empty(204, { 'set-cookie': sessionCookie('', 0) });
}
