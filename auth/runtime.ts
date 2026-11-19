import type { D1Database } from '../cloudflare/d1.js';

export interface AuthEnv {
  USER_DB?: D1Database;
  AUTH_ENABLED?: string;
  AUTH_SITE_URL?: string;
  AUTH_FROM?: string;
  RESEND_API_KEY?: string;
}

export interface AuthContext {
  request: Request;
  env: AuthEnv;
  fetcher?: typeof fetch;
  now?: () => Date;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export interface AuthConfig {
  db: D1Database;
  origin: string;
  from?: string;
  apiKey?: string;
}

export class AuthError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

export function normalizeEmail(input: unknown): string {
  if (typeof input !== 'string') throw new AuthError('invalid_request');
  const value = input.trim().toLowerCase();
  if (value.length > 254 || !/^[a-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(value)
    || value.includes('..') || value.startsWith('.') || value.split('@')[0].endsWith('.')) throw new AuthError('invalid_request');
  return value;
}

export function getConfig(env: AuthEnv): AuthConfig {
  if (env.AUTH_ENABLED !== '1' || !env.USER_DB || !env.AUTH_SITE_URL) throw new AuthError('auth_unavailable', 503);
  try {
    const url = new URL(env.AUTH_SITE_URL);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw Error();
    if (env.AUTH_FROM) {
      if (/[\r\n]/.test(env.AUTH_FROM)) throw Error();
      normalizeEmail(env.AUTH_FROM.match(/<([^<>]+)>$/)?.[1] ?? env.AUTH_FROM);
    }
    return { db: env.USER_DB, origin: url.origin, from: env.AUTH_FROM, apiKey: env.RESEND_API_KEY };
  } catch { throw new AuthError('auth_unavailable', 503); }
}

export function requireMailConfig(config: AuthConfig): { apiKey: string; from: string } {
  if (!config.apiKey || !config.from) throw new AuthError('auth_unavailable', 503);
  return { apiKey: config.apiKey, from: config.from };
}

export function requireOrigin(ctx: AuthContext, config: AuthConfig): void {
  if (new URL(ctx.request.url).origin !== config.origin) throw new AuthError('auth_unavailable', 503);
}

export function requireSameOrigin(ctx: AuthContext, config: AuthConfig): void {
  if (ctx.request.headers.get('origin') !== config.origin) throw new AuthError('invalid_origin', 403);
}

export function nowMs(ctx: AuthContext): number { return (ctx.now?.() ?? new Date()).getTime(); }

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader) for (;;) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.length;
    if (size > 4096) { await reader.cancel(); throw new AuthError('request_too_large', 413); }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const text = new TextDecoder().decode(bytes);
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.startsWith('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(text);
      const result: Record<string, unknown> = {};
      for (const [key, value] of params) { if (key in result) throw Error(); result[key] = value; }
      return result;
    }
    if (!contentType.startsWith('application/json')) throw Error();
    const result: unknown = JSON.parse(text);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error();
    return result as Record<string, unknown>;
  } catch { throw new AuthError('invalid_request'); }
}

export function onlyKeys(body: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(body).some(key => !keys.includes(key))) throw new AuthError('invalid_request');
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function hashToken(token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

const COOKIE = '__Host-anh_session';
export const sessionCookie = (token: string, ageSeconds: number) => `${COOKIE}=${token}; Path=/; Max-Age=${ageSeconds}; HttpOnly; Secure; SameSite=Lax`;
export function readSessionToken(request: Request): string | null {
  const tokens = (request.headers.get('cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${COOKIE}=`));
  if (tokens.length !== 1) return null;
  const token = tokens[0].slice(COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'cross-origin-resource-policy': 'same-origin' };
export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { ...headers, ...extra } });
}
export function empty(status: number, extra: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...headers, ...extra } });
}
export function page(title: string, message: string, token?: string, status = 200): Response {
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const form = token ? `<form method="post" action="/api/auth/verify-email"><input type="hidden" name="token" value="${escape(token)}"><label>账户密码 <input type="password" name="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><button type="submit">设置密码并确认邮箱</button></form>` : '';
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><main><h1>${escape(title)}</h1><p>${escape(message)}</p>${form}</main></html>`, {
    status, headers: { ...headers, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" },
  });
}
