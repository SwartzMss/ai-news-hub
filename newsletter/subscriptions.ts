import {
  type NewsletterContext, NewsletterError, escapeHtml, getConfig, hash, json, normalizeEmail, nowMs, page,
  randomToken, readBody, requireCanonical, requireSameOrigin, sendMail, verifyUnsubscribeToken,
} from './runtime.js';

const HOUR = 60 * 60 * 1000;
const ACCEPTED = { message: '如果可以订阅，我们会发送确认邮件。请检查收件箱。' };
const accepted = (ctx: NewsletterContext) => ctx.request.headers.get('accept')?.includes('text/html') ? page('请检查确认邮件',ACCEPTED.message,undefined,202) : json(ACCEPTED,202);

/** Reserve the email before contacting Resend; concurrent submissions cannot send twice. */
export async function handleSubscribe(ctx: NewsletterContext): Promise<Response> {
  const config = getConfig(ctx.env);
  requireCanonical(ctx, config);
  requireSameOrigin(ctx.request, config);
  if (ctx.request.method !== 'POST') throw new NewsletterError('method_not_allowed', 405);
  const body = await readBody(ctx.request);
  // Bots receive the same answer as successful and already subscribed readers.
  if (body.website) return accepted(ctx);
  const email = normalizeEmail(body.email);
  const now = nowMs(ctx);
  const rateKey = await hash(config.tokenSecret + '\0' + (ctx.request.headers.get('cf-connecting-ip') ?? 'unknown'));
  await config.db.prepare('DELETE FROM newsletter_rate_limits WHERE expires_at <= ?').bind(now).run();
  const rate = await config.db.prepare(`INSERT INTO newsletter_rate_limits(key,hits,expires_at)
    SELECT ?,1,? WHERE EXISTS (SELECT 1 FROM newsletter_rate_limits WHERE key=?)
      OR (SELECT COUNT(*) FROM newsletter_rate_limits) < 10000
    ON CONFLICT(key) DO UPDATE SET hits=hits+1 WHERE hits<5`).bind(rateKey, now + HOUR, rateKey).run();
  if (!rate.meta.changes) return accepted(ctx);

  const token = randomToken();
  const tokenHash = await hash(token);
  const id = crypto.randomUUID();
  const reserved = await config.db.prepare(`INSERT INTO newsletter_subscribers
    (id,email,status,confirmation_hash,confirmation_expires_at,confirmation_sent_at,created_at,confirmed_at,updated_at)
    SELECT ?,?,'pending',?,?,?,?,NULL,?
    WHERE EXISTS (SELECT 1 FROM newsletter_subscribers WHERE email=?)
      OR (SELECT COUNT(*) FROM newsletter_subscribers) < 5000
    ON CONFLICT(email) DO UPDATE SET
      status='pending',confirmation_hash=excluded.confirmation_hash,
      confirmation_expires_at=excluded.confirmation_expires_at,
      confirmation_sent_at=excluded.confirmation_sent_at,confirmed_at=NULL,updated_at=excluded.updated_at
    WHERE newsletter_subscribers.status != 'active'
      AND (newsletter_subscribers.confirmation_sent_at IS NULL OR newsletter_subscribers.confirmation_sent_at <= ?)`)
    .bind(id, email, tokenHash, now + 24 * HOUR, now, now, now, email, now - HOUR).run();
  if (!reserved.meta.changes) return accepted(ctx);
  const row = await config.db.prepare('SELECT id FROM newsletter_subscribers WHERE email=? AND confirmation_hash=?')
    .bind(email, tokenHash).first<{ id: string }>();
  // An unsubscribe arriving after reservation clears the token and prevents this send.
  if (!row) return accepted(ctx);
  const url = `${config.origin}/api/newsletter/confirm?token=${encodeURIComponent(token)}`;
  try {
    await sendMail(config, {
      from: config.from, to: [email], subject: '确认订阅 AI News Hub 每日简报',
      text: `请打开以下链接并确认订阅 AI News Hub 每日简报（包含全部话题）。链接 24 小时内有效。\n\n${url}\n\n如果不是你申请的订阅，请忽略此邮件。`,
      html: `<p>请确认订阅 AI News Hub 每日简报（包含全部话题）。链接 24 小时内有效。</p><p><a href="${escapeHtml(url)}">确认订阅</a></p><p>如果不是你申请的订阅，请忽略此邮件。</p>`,
    }, `confirmation/${row.id}/${now}`, ctx.fetcher);
  } catch (error) {
    console.warn(JSON.stringify({event:'newsletter_confirmation_failed',code:error instanceof NewsletterError ? error.code : 'mail_unavailable'}));
    // Do not expose provider errors, credentials or subscriber existence. The reservation
    // remains subject to the one-hour cooldown, including ambiguous network failures.
  }
  return accepted(ctx);
}

export async function handleConfirm(ctx: NewsletterContext): Promise<Response> {
  const config = getConfig(ctx.env);
  requireCanonical(ctx, config);
  let token: unknown;
  if (ctx.request.method === 'GET') token = new URL(ctx.request.url).searchParams.get('token');
  else if (ctx.request.method === 'POST') {
    requireSameOrigin(ctx.request, config);
    token = (await readBody(ctx.request)).token;
  } else throw new NewsletterError('method_not_allowed', 405);
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new NewsletterError('invalid_token');
  const tokenHash = await hash(token);
  const now = nowMs(ctx);
  if (ctx.request.method === 'GET') {
    const row = await config.db.prepare(`SELECT id FROM newsletter_subscribers
      WHERE status='pending' AND confirmation_hash=? AND confirmation_expires_at>?`).bind(tokenHash, now).first();
    if (!row) return page('链接已失效', '确认链接无效、已使用或已过期。请重新申请订阅。', undefined, 400);
    return page('确认订阅', '确认后，你将每天收到一封包含全部话题的 AI 新闻简报。', {action:'/api/newsletter/confirm',token});
  }
  const result = await config.db.prepare(`UPDATE newsletter_subscribers SET status='active',
    confirmation_hash=NULL,confirmation_expires_at=NULL,confirmed_at=?,updated_at=?
    WHERE status='pending' AND confirmation_hash=? AND confirmation_expires_at>?`).bind(now, now, tokenHash, now).run();
  return result.meta.changes
    ? page('订阅已确认', '你将开始收到 AI News Hub 每日简报。可随时通过邮件中的链接退订。')
    : page('链接已失效', '确认链接无效、已使用或已过期。请重新申请订阅。', undefined, 400);
}

export async function handleUnsubscribe(ctx: NewsletterContext): Promise<Response> {
  const config = getConfig(ctx.env);
  requireCanonical(ctx, config);
  let token: unknown = new URL(ctx.request.url).searchParams.get('token');
  if (ctx.request.method === 'POST') {
    // RFC 8058 one-click requests have no Origin. A supplied Origin must still match.
    if (ctx.request.headers.has('origin')) requireSameOrigin(ctx.request, config);
    const body = await readBody(ctx.request);
    token = body.token ?? token;
  } else if (ctx.request.method !== 'GET') throw new NewsletterError('method_not_allowed', 405);
  if (typeof token !== 'string') throw new NewsletterError('invalid_token');
  const id = await verifyUnsubscribeToken(token, config.tokenSecret);
  if (ctx.request.method === 'GET') return page('确认退订', '确认后，你将不再收到 AI News Hub 每日简报。', {action:'/api/newsletter/unsubscribe',token});
  const now = nowMs(ctx);
  await config.db.prepare(`UPDATE newsletter_subscribers SET status='unsubscribed',
    confirmation_hash=NULL,confirmation_expires_at=NULL,updated_at=? WHERE id=? AND status!='unsubscribed'`).bind(now,id).run();
  return page('已退订', '你将不再收到 AI News Hub 每日简报。');
}
