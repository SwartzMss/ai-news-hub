import {renderNewsletterPage} from './page.js';
export {escapeHtml} from './page.js';

export interface D1Result { meta: { changes: number }; results?: Record<string, unknown>[] }
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<D1Result>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface D1Database {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<D1Result[]>;
}
export interface NewsletterEnv {
  NEWSLETTER_DB?: D1Database;
  NEWSLETTER_ENABLED?: string;
  SITE_URL?: string;
  NEWSLETTER_FROM?: string;
  RESEND_API_KEY?: string;
  NEWSLETTER_TOKEN_SECRET?: string;
  NEWSLETTER_SEND_SECRET?: string;
  NEWSLETTER_TOPIC_IDS?: string;
}
export interface NewsletterContext { request: Request; env: NewsletterEnv; fetcher?: typeof fetch; now?: () => Date; pause?: (ms: number) => Promise<void> }
export interface NewsletterConfig { db: D1Database; origin: string; from: string; apiKey: string; tokenSecret: string; sendSecret: string; topicIds?: string[] }
export class NewsletterError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export const nowMs = (ctx: NewsletterContext) => (ctx.now?.() ?? new Date()).getTime();
export function normalizeEmail(input: unknown): string {
  if (typeof input !== 'string') throw new NewsletterError('invalid_email');
  const value = input.trim().toLowerCase();
  if (value.length > 254 || !/^[a-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(value) || value.includes('..') || value.startsWith('.') || value.split('@')[0].endsWith('.')) throw new NewsletterError('invalid_email');
  return value;
}
export function getConfig(env: NewsletterEnv): NewsletterConfig {
  if (env.NEWSLETTER_ENABLED !== '1' || !env.NEWSLETTER_DB || !env.SITE_URL || !env.NEWSLETTER_FROM || !env.RESEND_API_KEY || !env.NEWSLETTER_TOKEN_SECRET || !env.NEWSLETTER_SEND_SECRET) throw new NewsletterError('newsletter_unavailable', 503);
  try {
    const url = new URL(env.SITE_URL);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password || env.NEWSLETTER_TOKEN_SECRET.length < 32 || env.NEWSLETTER_SEND_SECRET.length < 32 || /[\r\n]/.test(env.NEWSLETTER_FROM)) throw Error();
    normalizeEmail(env.NEWSLETTER_FROM.match(/<([^<>]+)>$/)?.[1] ?? env.NEWSLETTER_FROM);
    const ids = env.NEWSLETTER_TOPIC_IDS?.split(',').map(id => id.trim()).filter(Boolean);
    if (ids?.some(id => !/^t-[a-f0-9]{24}$/.test(id) && id !== 'legacy') || ids && new Set(ids).size !== ids.length) throw Error();
    return {db:env.NEWSLETTER_DB,origin:url.origin,from:env.NEWSLETTER_FROM,apiKey:env.RESEND_API_KEY,tokenSecret:env.NEWSLETTER_TOKEN_SECRET,sendSecret:env.NEWSLETTER_SEND_SECRET,...(ids?.length ? {topicIds:ids}: {})};
  } catch { throw new NewsletterError('newsletter_unavailable', 503); }
}
export function requireCanonical(ctx: NewsletterContext, config: NewsletterConfig): void {
  if (new URL(ctx.request.url).origin !== config.origin) throw new NewsletterError('newsletter_unavailable', 503);
}
export function requireSameOrigin(request: Request, config: NewsletterConfig): void {
  if (request.headers.get('origin') !== config.origin) throw new NewsletterError('invalid_origin',403);
}
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader(); let total = 0; const chunks: Uint8Array[] = [];
  if (reader) for (;;) { const {value,done} = await reader.read(); if (done) break; total += value.length; if (total > 2048) { await reader.cancel(); throw new NewsletterError('request_too_large',413); } chunks.push(value); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  const text = new TextDecoder().decode(bytes);
  try {
    if (request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw Error();
    const value: unknown = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value as Record<string, unknown>;
  } catch { throw new NewsletterError('invalid_request'); }
}
const responseHeaders = { 'cache-control':'no-store', 'referrer-policy':'no-referrer', 'x-content-type-options':'nosniff', 'x-robots-tag':'noindex, nofollow' };
export function json(data: unknown, status = 200): Response { return Response.json(data,{status,headers:responseHeaders}); }
export function page(title: string, message: string, form?: {action: string; token: string}, status = 200, outcome: 'notice' | 'success' | 'unsubscribed' = 'notice'): Response {
  // Preserve Origin on native form POSTs without sending token URLs as Referer.
  const nonce=randomToken();
  const state = status >= 400 ? 'error' : form ? form.action.endsWith('/unsubscribe') ? 'unsubscribe' : 'confirm' : outcome;
  return new Response(renderNewsletterPage({title,message,nonce,form,status,state}),{status,headers:{...responseHeaders,'referrer-policy':'strict-origin','content-type':'text/html; charset=utf-8','content-security-policy':`default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`}});
}
export const randomToken = () => { const bytes = crypto.getRandomValues(new Uint8Array(32)); return toBase64(bytes); };
function toBase64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''); }
function fromBase64(text: string): Uint8Array<ArrayBuffer> { if (!/^[A-Za-z0-9_-]+$/.test(text)) throw Error(); return Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0)); }
export async function hash(value: string): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join(''); }
export async function unsubscribeToken(id: string, secret: string): Promise<string> {
  const body=toBase64(new TextEncoder().encode(JSON.stringify({type:'unsubscribe',id})));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return body+'.'+toBase64(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))));
}
export async function verifyUnsubscribeToken(token: string, secret: string): Promise<string> {
  try {
    if (token.length>1024) throw Error(); const [body,signature,...extra]=token.split('.'); if(extra.length) throw Error();
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    if (!await crypto.subtle.verify('HMAC',key,fromBase64(signature),new TextEncoder().encode(body))) throw Error();
    const value=JSON.parse(new TextDecoder().decode(fromBase64(body)));if(value.type!=='unsubscribe'||typeof value.id!=='string'||!/^[a-f0-9-]{36}$/.test(value.id)) throw Error(); return value.id;
  } catch { throw new NewsletterError('invalid_token'); }
}
export interface MailPayload { from: string; to: string[]; subject: string; html: string; text: string; headers?: Record<string,string> }
export async function sendMail(config: NewsletterConfig, payload: MailPayload, idempotencyKey: string, fetcher: typeof fetch = fetch): Promise<string> {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try {
    // Workers supports manual/follow only. Reject non-2xx responses below without following redirects.
    const response=await fetcher('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:controller.signal,headers:{authorization:'Bearer '+config.apiKey,'content-type':'application/json','idempotency-key':idempotencyKey},body:JSON.stringify(payload)});
    if(!response.ok){await response.body?.cancel();throw new NewsletterError('mail_http_'+response.status,502);}
    const reader=response.body?.getReader();let text='';if(reader)for(;;){const item=await reader.read();if(item.done)break;text+=new TextDecoder().decode(item.value);if(text.length>8192){await reader.cancel();throw Error();}}
    const value=JSON.parse(text);if(typeof value.id!=='string'||value.id.length>128||!value.id)throw Error();return value.id;
  } catch(error){if(error instanceof NewsletterError)throw error;throw new NewsletterError(controller.signal.aborted?'mail_timeout':'mail_unavailable',502);}finally{clearTimeout(timer);}
}
