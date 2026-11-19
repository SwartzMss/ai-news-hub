import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, NOW } from './fixtures/auth.mjs';
import { onRequest } from '../dist/functions/api/auth/[[path]].js';

const EMAIL = 'reader@example.com';
const PASSWORD = 'correct horse battery staple';
const HOUR = 3600000;
const request = (f, action, options) => onRequest(f.context(action, options));
const tokenFrom = f => new URL(f.messages.at(-1).payload.text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
const cookieFrom = response => response.headers.get('set-cookie')?.match(/__Host-anh_session=([^;]+)/)?.[1];

test('registration stores password and verification token hashes; GET does not verify; POST consumes once', async t => {
  const f = fixture(); t.after(() => f.close());
  const response = await request(f, 'register', { body: { email: ' Reader@Example.com ', password: PASSWORD } });
  assert.equal(response.status, 202);
  assert.equal(f.messages.length, 1);
  const user = f.db.prepare('SELECT * FROM users').get();
  assert.equal(user.email_normalized, EMAIL);
  assert.equal(user.email_verified_at, null);
  assert.notEqual(user.password_hash, PASSWORD);
  assert.match(user.password_hash, /^\$pbkdf2-sha256\$i=600000\$/);
  const token = tokenFrom(f);
  const saved = f.db.prepare('SELECT * FROM auth_email_tokens').get();
  assert.equal(saved.purpose, 'verify_email');
  assert.notEqual(saved.token_hash, token);
  assert.equal(saved.expires_at, NOW + 24 * HOUR);
  const preview = await request(f, `verify-email?token=${token}`, { method: 'GET', headers: { accept: 'text/html' } });
  assert.equal(preview.status, 200);
  assert.match(await preview.text(), /<form[^>]+method="post"/);
  assert.equal(f.db.prepare('SELECT email_verified_at FROM users').get().email_verified_at, null);
  assert.equal((await request(f, 'verify-email', { body: { token } })).status, 200);
  assert.equal(f.db.prepare('SELECT email_verified_at FROM users').get().email_verified_at, NOW);
  assert.equal((await request(f, 'verify-email', { body: { token } })).status, 400);
});

test('unverified and missing accounts cannot login; verified session authenticates me and logout revokes it', async t => {
  const f = fixture(); t.after(() => f.close());
  await request(f, 'register', { body: { email: EMAIL, password: PASSWORD } });
  const login = body => request(f, 'login', { body });
  assert.equal((await login({ email: EMAIL, password: PASSWORD })).status, 401);
  assert.equal((await login({ email: 'missing@example.com', password: PASSWORD })).status, 401);
  assert.equal((await request(f, 'me', { method: 'GET' })).status, 401);
  await request(f, 'verify-email', { body: { token: tokenFrom(f) } });
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
  const body = { email: EMAIL, password: PASSWORD };
  const first = await request(f, 'register', { body });
  const second = await request(f, 'register', { body });
  assert.equal(second.status, first.status);
  assert.deepEqual(await second.json(), await first.json());
  assert.equal(f.messages.length, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  const token = tokenFrom(f);
  assert.equal((await request(f, 'verify-email', { body: { token }, now: () => new Date(NOW + 24 * HOUR) })).status, 400);
  f.db.prepare("UPDATE auth_email_tokens SET purpose='reset_password'").run();
  assert.equal((await request(f, 'verify-email', { body: { token } })).status, 400);
});

test('origin, canonical host, payload limit, disabled config and unknown routes fail closed', async t => {
  const f = fixture(); t.after(() => f.close());
  const body = { email: EMAIL, password: PASSWORD };
  assert.equal((await request(f, 'register', { body, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request(f, 'register', { body: 'x'.repeat(4097) })).status, 413);
  assert.equal((await request(f, 'register', { body: { ...body, user_id: 'someone-else' } })).status, 400);
  assert.equal((await request(f, 'register', { body: { email: 'bad', password: PASSWORD } })).status, 400);
  assert.equal((await request(f, 'register', { body: { email: EMAIL, password: 'short' } })).status, 400);
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
  await request(f, 'register', { body: { email: EMAIL, password: PASSWORD } });
  await request(f, 'verify-email', { body: { token: tokenFrom(f) } });
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
  const body = { email: EMAIL, password: PASSWORD };
  assert.equal((await request(f, 'register', { body })).status, 202);
  assert.equal(f.messages.length, 1);
  assert.equal((await request(f, 'register', { body, now: () => new Date(NOW + HOUR + 1) })).status, 202);
  assert.equal(f.messages.length, 2);
  f.env.AUTH_FROM = undefined;
  assert.equal((await request(f, 'register', { body })).status, 503);
  const token = tokenFrom(f);
  assert.equal((await request(f, 'verify-email', { body: { token }, now: () => new Date(NOW + HOUR + 1) })).status, 200);
  assert.equal((await request(f, 'login', { body })).status, 200);
});
