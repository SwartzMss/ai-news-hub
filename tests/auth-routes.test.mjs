import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixture, NOW } from './fixtures/auth.mjs';
import { onRequest } from '../dist/functions/api/auth/[[path]].js';

const EMAIL = 'reader@example.com';
const PASSWORD = 'correct horse battery staple';
const HOUR = 3600000;
const request = (f, action, options) => onRequest(f.context(action, options));
const tokenFrom = f => new URL(f.messages.at(-1).payload.text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
const codeFrom = f => f.messages.at(-1).payload.text.match(/验证码：([0-9]{6})/)[1];
const cookieFrom = response => response.headers.get('set-cookie')?.match(/__Host-anh_session=([^;]+)/)?.[1];
const confirmRegistration = (f, password = PASSWORD, options = {}) => request(f, 'verify-email-code', {
  body: { email: EMAIL, code: codeFrom(f), password }, ...options,
});
function seedLegacyLink(f) {
  const token = 'A'.repeat(43);
  const hash = createHash('sha256').update(token).digest('hex');
  f.db.prepare(`INSERT INTO users(id,email_normalized,password_hash,email_verified_at,status,created_at,updated_at)
    VALUES ('old-user',?,'!pending',NULL,'active',?,?)`).run(EMAIL, NOW, NOW);
  f.db.prepare(`INSERT INTO auth_email_tokens(id,user_id,token_hash,purpose,created_at,expires_at,consumed_at)
    VALUES ('old-token','old-user',?,'verify_email',?,?,NULL)`).run(hash, NOW, NOW + 24 * HOUR);
  return token;
}

test('registration emails a six-digit code and creates the password only after code confirmation', async t => {
  const f = fixture(); t.after(() => f.close());
  assert.equal((await request(f, 'register', { body: { email: EMAIL } })).status, 202);
  assert.equal(f.messages.length, 1);
  assert.doesNotMatch(f.messages[0].payload.text, /https:\/\//);
  const code = codeFrom(f);
  const user = f.db.prepare('SELECT * FROM users').get();
  assert.equal(user.email_verified_at, null);
  assert.equal(user.password_hash, '!pending');
  assert.notEqual(f.db.prepare('SELECT token_hash FROM auth_email_tokens').get().token_hash, code);
  assert.equal(f.db.prepare('SELECT expires_at FROM auth_email_tokens').get().expires_at, NOW + 10 * 60000);
  assert.equal((await request(f, 'verify-email-code', { body: { email: EMAIL, code, password: PASSWORD } })).status, 200);
  assert.equal((await request(f, 'verify-email-code', { body: { email: EMAIL, code, password: PASSWORD } })).status, 400);
  assert.equal((await request(f, 'login', { body: { email: EMAIL, password: PASSWORD } })).status, 200);
});

test('registration sends at most one code per email every 60 seconds and only the newest code works', async t => {
  const f = fixture(); t.after(() => f.close());
  const body = { email: EMAIL };
  await request(f, 'register', { body });
  const first = codeFrom(f);
  assert.equal((await request(f, 'register', { body, now: () => new Date(NOW + 59000) })).status, 202);
  assert.equal(f.messages.length, 1);
  assert.equal((await request(f, 'register', { body, now: () => new Date(NOW + 60000) })).status, 202);
  assert.equal(f.messages.length, 2);
  const second = codeFrom(f);
  if (first !== second) assert.equal((await request(f, 'verify-email-code', { body: { email: EMAIL, code: first, password: PASSWORD }, now: () => new Date(NOW + 60000) })).status, 400);
  assert.equal((await request(f, 'verify-email-code', { body: { email: EMAIL, code: second, password: PASSWORD }, now: () => new Date(NOW + 60000) })).status, 200);
});

test('incorrect or expired email codes cannot verify an account', async t => {
  const f = fixture(); t.after(() => f.close());
  await request(f, 'register', { body: { email: EMAIL } });
  const code = codeFrom(f);
  const wrong = code === '000000' ? '111111' : '000000';
  assert.equal((await request(f, 'verify-email-code', { body: { email: EMAIL, code: wrong, password: PASSWORD } })).status, 400);
  assert.equal((await request(f, 'verify-email-code', { body: { email: EMAIL, code, password: PASSWORD }, now: () => new Date(NOW + 10 * 60000) })).status, 400);
  assert.equal(f.db.prepare('SELECT email_verified_at FROM users').get().email_verified_at, null);
});

test('wrong-code attempts are capped for one code and a new code can still be used', async t => {
  const f = fixture(); t.after(() => f.close());
  await request(f, 'register', { body: { email: EMAIL } });
  const wrong = codeFrom(f) === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    assert.equal((await request(f, 'verify-email-code', { body: { email: EMAIL, code: wrong, password: PASSWORD } })).status, 400);
  }
  assert.equal((await confirmRegistration(f)).status, 429);
  await request(f, 'register', { body: { email: EMAIL }, now: () => new Date(NOW + 60000) });
  assert.equal((await confirmRegistration(f, PASSWORD, { now: () => new Date(NOW + 60000) })).status, 200);
});

test('verification links issued before the code flow still work until expiry', async t => {
  const f = fixture(); t.after(() => f.close());
  const token = seedLegacyLink(f);
  const preview = await request(f, `verify-email?token=${token}`, { method: 'GET', headers: { accept: 'text/html' } });
  assert.equal(preview.status, 200);
  assert.match(await preview.text(), /<form[^>]+method="post"/);
  assert.equal(f.db.prepare('SELECT email_verified_at FROM users').get().email_verified_at, null);
  assert.equal((await request(f, 'verify-email', { body: { token, password: PASSWORD } })).status, 200);
  assert.equal(f.db.prepare('SELECT email_verified_at FROM users').get().email_verified_at, NOW);
  assert.match(f.db.prepare('SELECT password_hash FROM users').get().password_hash, /^\$pbkdf2-sha256-chain\$/);
  assert.equal((await request(f, 'verify-email', { body: { token, password: 'replayed attacker password' } })).status, 400);
  assert.equal((await request(f, 'login', { body: { email: EMAIL, password: PASSWORD } })).status, 200);
  assert.equal((await request(f, 'login', { body: { email: EMAIL, password: 'replayed attacker password' } })).status, 401);
});

test('unverified and missing accounts cannot login; verified session authenticates me and logout revokes it', async t => {
  const f = fixture(); t.after(() => f.close());
  await request(f, 'register', { body: { email: EMAIL } });
  const login = body => request(f, 'login', { body });
  assert.equal((await login({ email: EMAIL, password: PASSWORD })).status, 401);
  assert.equal((await login({ email: 'missing@example.com', password: PASSWORD })).status, 401);
  assert.equal((await request(f, 'me', { method: 'GET' })).status, 401);
  await confirmRegistration(f);
  const response = await login({ email: EMAIL, password: PASSWORD });
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys((await response.clone().json()).user).sort(), ['email', 'id']);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^__Host-anh_session=[^;]+; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/);
  const token = cookieFrom(response);
  assert.notEqual(f.db.prepare('SELECT token_hash FROM auth_sessions').get().token_hash, token);
  const authHeader = { cookie: `__Host-anh_session=${token}` };
  assert.equal((await request(f, 'me', { method: 'GET', headers: authHeader })).status, 200);
  const logout = await request(f, 'logout', { headers: authHeader });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await request(f, 'me', { method: 'GET', headers: authHeader })).status, 401);
});

test('registration is generic for duplicate addresses, and expired or wrong-purpose tokens fail', async t => {
  const f = fixture(); t.after(() => f.close());
  const body = { email: EMAIL };
  const first = await request(f, 'register', { body });
  const second = await request(f, 'register', { body });
  assert.equal(second.status, first.status);
  assert.deepEqual(await second.json(), await first.json());
  assert.equal(f.messages.length, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  const code = codeFrom(f);
  assert.equal((await request(f, 'verify-email-code', { body: { email: EMAIL, code, password: PASSWORD }, now: () => new Date(NOW + 10 * 60000) })).status, 400);
  f.db.prepare("UPDATE auth_email_tokens SET purpose='reset_password'").run();
  assert.equal((await request(f, 'verify-email-code', { body: { email: EMAIL, code, password: PASSWORD } })).status, 400);
});

test('origin, canonical host, payload limit, disabled config and unknown routes fail closed', async t => {
  const f = fixture(); t.after(() => f.close());
  const body = { email: EMAIL };
  assert.equal((await request(f, 'register', { body, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request(f, 'register', { body: 'x'.repeat(4097) })).status, 413);
  assert.equal((await request(f, 'register', { body: { ...body, user_id: 'someone-else' } })).status, 400);
  assert.equal((await request(f, 'register', { body: { email: 'bad' } })).status, 400);
  assert.equal((await request(f, 'register', { body: { email: EMAIL, password: PASSWORD } })).status, 400);
  const preview = f.context('register', { body });
  preview.request = new Request('https://preview.example/api/auth/register', preview.request);
  assert.equal((await onRequest(preview)).status, 503);
  f.env.AUTH_ENABLED = '0';
  assert.equal((await request(f, 'register', { body })).status, 503);
  f.env.AUTH_ENABLED = '1';
  assert.equal((await request(f, 'missing', { body })).status, 404);
});

test('sessions expire, disabled users lose access, and logging in again revokes the old cookie', async t => {
  const f = fixture(); t.after(() => f.close());
  await request(f, 'register', { body: { email: EMAIL } });
  await confirmRegistration(f);
  const first = cookieFrom(await request(f, 'login', { body: { email: EMAIL, password: PASSWORD } }));
  const oldHeader = { cookie: `__Host-anh_session=${first}` };
  const second = cookieFrom(await request(f, 'login', { body: { email: EMAIL, password: PASSWORD }, headers: oldHeader }));
  assert.notEqual(first, second);
  assert.equal((await request(f, 'me', { method: 'GET', headers: oldHeader })).status, 401);
  const newHeader = { cookie: `__Host-anh_session=${second}` };
  assert.equal((await request(f, 'me', { method: 'GET', headers: newHeader })).status, 200);
  assert.equal((await request(f, 'me', { method: 'GET', headers: newHeader, now: () => new Date(NOW + 30 * 24 * HOUR) })).status, 401);
  f.db.prepare("UPDATE users SET status='disabled'").run();
  assert.equal((await request(f, 'me', { method: 'GET', headers: newHeader })).status, 401);
  assert.equal((await request(f, 'login', { body: { email: EMAIL, password: PASSWORD } })).status, 401);
});

test('verification can be resent after cooldown; auth mail setup is independent of Newsletter settings', async t => {
  const f = fixture(); t.after(() => f.close());
  f.env.NEWSLETTER_ENABLED = '0';
  f.env.NEWSLETTER_TOKEN_SECRET = undefined;
  const body = { email: EMAIL };
  assert.equal((await request(f, 'register', { body })).status, 202);
  assert.equal(f.messages.length, 1);
  assert.equal((await request(f, 'register', { body, now: () => new Date(NOW + HOUR + 1) })).status, 202);
  assert.equal(f.messages.length, 2);
  f.env.AUTH_FROM = undefined;
  assert.equal((await request(f, 'register', { body })).status, 503);
  assert.equal((await confirmRegistration(f, PASSWORD, { now: () => new Date(NOW + HOUR + 1) })).status, 200);
  assert.equal((await request(f, 'login', { body: { ...body, password: PASSWORD } })).status, 200);
});

test('registration defers outbound mail when Pages waitUntil is available', async t => {
  const f = fixture(); t.after(() => f.close());
  const pending = [];
  let mailFinished = false;
  const fetcher = async () => {
    await new Promise(resolve => setTimeout(resolve, 30));
    mailFinished = true;
    return Response.json({ id: 'mail-1' });
  };
  const response = await request(f, 'register', {
    body: { email: EMAIL }, fetcher, waitUntil: promise => pending.push(promise),
  });
  assert.equal(response.status, 202);
  assert.equal(pending.length, 1);
  assert.equal(mailFinished, false);
  await pending[0];
  assert.equal(mailFinished, true);
});

test('registration gives verified addresses the same response and background scheduling', async t => {
  const f = fixture(); t.after(() => f.close());
  const body = { email: EMAIL };
  const first = await request(f, 'register', { body });
  await confirmRegistration(f);
  const pending = [];
  const existing = await request(f, 'register', { body, waitUntil: promise => pending.push(promise) });
  assert.equal(existing.status, 202);
  assert.deepEqual(await existing.json(), await first.json());
  assert.equal(pending.length, 1);
  await pending[0];
  assert.equal(f.messages.length, 1);
});

test('email owner chooses the final password when confirming a pre-registered address', async t => {
  const f = fixture(); t.after(() => f.close());
  const attackerPassword = 'attacker chooses this password';
  await request(f, 'register', { body: { email: EMAIL } });
  assert.equal((await confirmRegistration(f)).status, 200);
  assert.equal((await request(f, 'login', { body: { email: EMAIL, password: attackerPassword } })).status, 401);
  assert.equal((await request(f, 'login', { body: { email: EMAIL, password: PASSWORD } })).status, 200);
});

test('failed mail delivery releases the verification cooldown for retry', async t => {
  const f = fixture(); t.after(() => f.close());
  const body = { email: EMAIL };
  const pending = [];
  const failed = await request(f, 'register', {
    body, fetcher: async () => Response.json({ message: 'temporary failure' }, { status: 503 }),
    waitUntil: promise => pending.push(promise),
  });
  assert.equal(failed.status, 202);
  await pending[0];
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM auth_email_tokens').get().n, 0);
  assert.equal((await request(f, 'register', { body })).status, 202);
  assert.equal(f.messages.length, 1);
});

test('registration requires server-verified Turnstile proof', async t => {
  const f = fixture(); t.after(() => f.close());
  const body = { email: EMAIL };
  assert.equal((await request(f, 'register', { body, noTurnstile: true })).status, 403);
  assert.equal((await request(f, 'register', { body, turnstileResult: { success: false } })).status, 403);
  assert.equal((await request(f, 'register', { body, turnstileResult: { success: true, hostname: 'evil.example', action: 'register' } })).status, 403);
  assert.equal((await request(f, 'register', { body: { ...body, email: 'other@example.com' }, turnstileResult: { success: true, hostname: 'news.example', action: 'forgot_password' } })).status, 403);
  assert.equal((await request(f, 'register', { body })).status, 202);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
});

test('a Turnstile token cannot authorize two registration requests', async t => {
  const f = fixture(); t.after(() => f.close());
  const first = { email: EMAIL, turnstileToken: 'same-widget-token' };
  const second = { ...first, email: 'other@example.com' };
  assert.equal((await request(f, 'register', { body: first })).status, 202);
  assert.equal((await request(f, 'register', { body: second })).status, 403);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
});

test('registration limits repeated requests for the same email before sending more mail', async t => {
  const f = fixture(); t.after(() => f.close());
  const body = { email: EMAIL };
  for (let i = 0; i < 3; i++) assert.equal((await request(f, 'register', { body })).status, 202);
  assert.equal((await request(f, 'register', { body })).status, 429);
  assert.equal(f.messages.length, 1);
});

test('registration IP limit ignores user-supplied forwarding headers', async t => {
  const f = fixture(); t.after(() => f.close());
  for (let i = 0; i < 10; i++) {
    const response = await request(f, 'register', {
      body: { email: `reader${i}@example.com` },
      headers: { 'x-forwarded-for': `192.0.2.${i + 1}` },
    });
    assert.equal(response.status, 202);
  }
  assert.equal((await request(f, 'register', {
    body: { email: 'last@example.com' },
    headers: { 'x-forwarded-for': '192.0.2.200' },
  })).status, 429);
});

test('auth mutations fail closed when the trusted Cloudflare client IP is missing', async t => {
  const f = fixture(); t.after(() => f.close());
  const response = await request(f, 'register', {
    body: { email: EMAIL },
    headers: { 'cf-connecting-ip': '', 'x-forwarded-for': '192.0.2.99' },
  });
  assert.equal(response.status, 503);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('repeated login attempts require a fresh server-verified challenge', async t => {
  const f = fixture(); t.after(() => f.close());
  await request(f, 'register', { body: { email: EMAIL } });
  await confirmRegistration(f);
  for (let i = 0; i < 6; i++) {
    assert.equal((await request(f, 'login', { body: { email: EMAIL, password: 'a wrong password here' } })).status, 401);
  }
  assert.equal((await request(f, 'login', { body: { email: EMAIL, password: PASSWORD } })).status, 403);
  assert.equal((await request(f, 'login', { body: { email: EMAIL, password: PASSWORD, turnstileToken: 'fresh-token' }, turnstileAction: 'login' })).status, 200);
});

test('session expires after seven idle days and activity refreshes its idle window', async t => {
  const f = fixture(); t.after(() => f.close());
  await request(f, 'register', { body: { email: EMAIL } });
  await confirmRegistration(f);
  const session = cookieFrom(await request(f, 'login', { body: { email: EMAIL, password: PASSWORD } }));
  const headers = { cookie: `__Host-anh_session=${session}` };
  assert.equal((await request(f, 'me', { method: 'GET', headers, now: () => new Date(NOW + 6 * 24 * HOUR) })).status, 200);
  assert.equal((await request(f, 'me', { method: 'GET', headers, now: () => new Date(NOW + 8 * 24 * HOUR) })).status, 200);
  assert.equal((await request(f, 'me', { method: 'GET', headers, now: () => new Date(NOW + 16 * 24 * HOUR) })).status, 401);
});

test('password reset requires email proof, changes password, and revokes old sessions', async t => {
  const f = fixture(); t.after(() => f.close());
  await request(f, 'register', { body: { email: EMAIL } });
  await confirmRegistration(f);
  const login = await request(f, 'login', { body: { email: EMAIL, password: PASSWORD } });
  const headers = { cookie: `__Host-anh_session=${cookieFrom(login)}` };
  const forgot = await request(f, 'forgot-password', { body: { email: EMAIL, turnstileToken: 'test-token' }, turnstileAction: 'forgot_password' });
  assert.equal(forgot.status, 202);
  const token = tokenFrom(f);
  assert.equal((await request(f, `reset-password?token=${token}`, { method: 'GET', headers: { accept: 'text/html' } })).status, 200);
  assert.equal((await request(f, 'me', { method: 'GET', headers })).status, 200);
  const newPassword = 'a new correct horse battery staple';
  assert.equal((await request(f, 'reset-password', { body: { token, password: newPassword } })).status, 200);
  assert.equal((await request(f, 'me', { method: 'GET', headers })).status, 401);
  assert.equal((await request(f, 'login', { body: { email: EMAIL, password: PASSWORD } })).status, 401);
  assert.equal((await request(f, 'login', { body: { email: EMAIL, password: newPassword } })).status, 200);
  assert.equal((await request(f, 'reset-password', { body: { token, password: 'replayed attacker password' } })).status, 400);
  assert.equal((await request(f, 'login', { body: { email: EMAIL, password: 'replayed attacker password' } })).status, 401);
});

test('password change requires the current password and revokes every session', async t => {
  const f = fixture(); t.after(() => f.close());
  await request(f, 'register', { body: { email: EMAIL } });
  await confirmRegistration(f);
  const login = await request(f, 'login', { body: { email: EMAIL, password: PASSWORD } });
  const headers = { cookie: `__Host-anh_session=${cookieFrom(login)}` };
  const newPassword = 'another secure password phrase';
  assert.equal((await request(f, 'change-password', { headers, body: { currentPassword: 'wrong current password', newPassword } })).status, 401);
  assert.equal((await request(f, 'change-password', { headers, body: { currentPassword: PASSWORD, newPassword } })).status, 200);
  assert.equal((await request(f, 'me', { method: 'GET', headers })).status, 401);
  assert.equal((await request(f, 'login', { body: { email: EMAIL, password: PASSWORD } })).status, 401);
  assert.equal((await request(f, 'login', { body: { email: EMAIL, password: newPassword } })).status, 200);
});

test('forgot-password gives unknown and known emails the same response without leaking mail', async t => {
  const f = fixture(); t.after(() => f.close());
  await request(f, 'register', { body: { email: EMAIL } });
  await confirmRegistration(f);
  const unknown = await request(f, 'forgot-password', { body: { email: 'missing@example.com', turnstileToken: 'fresh' }, turnstileAction: 'forgot_password' });
  const known = await request(f, 'forgot-password', { body: { email: EMAIL, turnstileToken: 'fresh-2' }, turnstileAction: 'forgot_password' });
  assert.equal(known.status, 202);
  assert.equal(unknown.status, 202);
  assert.deepEqual(await known.json(), await unknown.json());
  assert.equal(f.messages.length, 2);
});

test('expired and wrong-purpose password reset links do not change credentials', async t => {
  const f = fixture(); t.after(() => f.close());
  await request(f, 'register', { body: { email: EMAIL } });
  await confirmRegistration(f);
  await request(f, 'forgot-password', { body: { email: EMAIL, turnstileToken: 'fresh' }, turnstileAction: 'forgot_password' });
  const token = tokenFrom(f);
  assert.equal((await request(f, 'reset-password', { body: { token, password: 'new strong password phrase' }, now: () => new Date(NOW + 30 * 60000) })).status, 400);
  f.db.prepare("UPDATE auth_email_tokens SET purpose='verify_email' WHERE purpose='reset_password'").run();
  assert.equal((await request(f, 'reset-password', { body: { token, password: 'new strong password phrase' } })).status, 400);
  assert.equal((await request(f, 'login', { body: { email: EMAIL, password: PASSWORD } })).status, 200);
});

test('password reset can be requested again after its short-lived link expires', async t => {
  const f = fixture(); t.after(() => f.close());
  await request(f, 'register', { body: { email: EMAIL } });
  await confirmRegistration(f);
  assert.equal((await request(f, 'forgot-password', { body: { email: EMAIL, turnstileToken: 'reset-one' }, turnstileAction: 'forgot_password' })).status, 202);
  const first = tokenFrom(f);
  assert.equal((await request(f, 'forgot-password', {
    body: { email: EMAIL, turnstileToken: 'reset-two' }, turnstileAction: 'forgot_password',
    now: () => new Date(NOW + 30 * 60000 + 1),
  })).status, 202);
  assert.equal(f.messages.length, 3);
  assert.notEqual(tokenFrom(f), first);
});

test('public auth configuration exposes only the Turnstile site key', async t => {
  const f = fixture(); t.after(() => f.close());
  const response = await request(f, 'config', { method: 'GET' });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data, { turnstileSiteKey: 'site-test' });
  assert.equal(JSON.stringify(data).includes('secret-test'), false);
});

test('cross-site subresource requests cannot use auth APIs while email link navigation remains possible', async t => {
  const f = fixture(); t.after(() => f.close());
  const subresource = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' };
  assert.equal((await request(f, 'me', { method: 'GET', headers: subresource })).status, 403);
  const token = seedLegacyLink(f);
  const navigation = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
  assert.equal((await request(f, `verify-email?token=${token}`, { method: 'GET', headers: navigation })).status, 200);
});

test('mail link previews cannot exhaust the token budget for confirmation submits', async t => {
  const f = fixture(); t.after(() => f.close());
  await request(f, 'register', { body: { email: EMAIL } });
  assert.equal((await confirmRegistration(f)).status, 200);
  await request(f, 'forgot-password', { body: { email: EMAIL, turnstileToken: 'reset-preview' }, turnstileAction: 'forgot_password' });
  const reset = tokenFrom(f);
  for (let i = 0; i < 6; i++) assert.equal((await request(f, `reset-password?token=${reset}`, { method: 'GET' })).status, 200);
  assert.equal((await request(f, 'reset-password', { body: { token: reset, password: 'another secure password phrase' } })).status, 200);
});

test('verification and reset submissions have independent token attempt limits', async t => {
  const f = fixture(); t.after(() => f.close());
  const token = 'A'.repeat(43);
  for (const action of ['verify-email', 'reset-password']) {
    for (let i = 0; i < 5; i++) {
      assert.equal((await request(f, action, { body: { token, password: PASSWORD } })).status, 400);
    }
    assert.equal((await request(f, action, { body: { token, password: PASSWORD } })).status, 429);
  }
});
