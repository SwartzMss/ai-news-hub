import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { Agent, fetch } from 'undici';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { AppError } from '../errors.js';
import type { ArticleCandidate } from './types.js';

export type SourceFetch = typeof fetch;
export function publicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a,b,c] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127
      || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
      || a === 192 && (b === 168 || b === 0 || b === 2) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)
      || a === 203 && b === 0 && c === 113);
  }
  // Conservative public unicast only, excluding transition and mapped ranges.
  if (isIP(ip) === 6) return /^2[0-9a-f]{3}:/i.test(ip) && !/^200[12]:/i.test(ip) && !/^2001:(?:0*:|db8:)/i.test(ip);
  return false;
}
export function sourceUrl(raw: string): string {
  try {
    if (typeof raw !== 'string' || raw.length > 2048 || /[\s\\]/.test(raw) || [...raw].some(c=>c.charCodeAt(0)<=32 || c.charCodeAt(0)===127) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(raw)) throw Error();
    const url = new URL(raw), host = url.hostname.replace(/^\[|\]$/g,'');
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || isIP(host) && !publicAddress(host) || !isIP(host) && (!host.includes('.') || /(?:\.|^)(?:localhost|local|internal|invalid|test|onion)$/.test(host) || host.endsWith('.'))) throw Error();
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || ['fbclid','gclid'].includes(key.toLowerCase())) url.searchParams.delete(key);
    url.searchParams.sort(); return url.href;
  } catch { throw new AppError('invalid_source_url'); }
}
// Each verified origin gets a DNS-pinned connection, without proxy or credentials.
export function sourceHttpClient(): { fetcher: SourceFetch; close: () => Promise<void> } {
  const agents = new Set<Agent>();
  return { fetcher: async (raw, init) => {
    const url = new URL(sourceUrl(String(raw)));
    const address = await resolveSourceAddress(url.hostname.replace(/^\[|\]$/g,''),init?.signal ?? AbortSignal.timeout(15000));
    const agent = new Agent({ connect: { autoSelectFamily: false, lookup: (_host,_options,callback) => callback(null,address.address,address.family) } });
    agents.add(agent);
    try {
      const response = await fetch(url, { ...init, redirect: 'manual', dispatcher: agent });
      // Closing a pool waits for its active response; initiate now so it cannot
      // accumulate across Runs. Shutdown can still forcibly destroy it.
      void agent.close().catch(() => {}).finally(() => agents.delete(agent));
      return response;
    } catch (error) { await agent.destroy(); agents.delete(agent); throw error; }
  }, close: async () => { await Promise.all([...agents].map(a => a.destroy())); agents.clear(); } };
}
export async function resolveSourceAddress(host: string, signal: AbortSignal, resolve: (host: string) => Promise<LookupAddress[]> = h=>lookup(h,{all:true,verbatim:true})): Promise<LookupAddress> {
  signal.throwIfAborted();
  let abort = () => {};
  try {
    const cancelled = new Promise<never>((_accept,reject)=>{
      abort = ()=>reject(signal.reason);
      signal.addEventListener('abort',abort,{once:true});
    });
    const addresses = await Promise.race([resolve(host),cancelled]);
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(a=>!publicAddress(a.address))) throw new AppError('invalid_source_address');
    return addresses[0];
  } finally { signal.removeEventListener('abort',abort); }
}

export interface SourceFailureDiagnostic {
  url: string; code: string; httpStatus?: number; networkCode?: string; attempts: number;
}
export class SourceValidationError extends AppError {
  constructor(public readonly diagnostic: SourceFailureDiagnostic) { super(diagnostic.code); }
}
export function sourceFailureDiagnostic(error: unknown): SourceFailureDiagnostic | undefined {
  return error instanceof SourceValidationError ? {...error.diagnostic} : undefined;
}
const sourceErrorCodes = new Set(['source_http_failed','source_content_type','source_empty','source_too_large','source_html_too_complex','invalid_source_address','invalid_source_url','source_cancelled','source_timeout','source_fetch_failed']);
const transientNetwork = new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','ENETUNREACH','EHOSTUNREACH','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET']);
const diagnosticNetwork = new Set([...transientNetwork,'ENOTFOUND','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID']);
function networkCode(error: unknown): string | undefined {
  let value=error;
  for(let i=0;i<5&&value&&typeof value==='object';i++){
    const object=value as {code?:unknown;cause?:unknown};
    if(typeof object.code==='string'&&diagnosticNetwork.has(object.code))return object.code;
    value=object.cause;
  }
  return undefined;
}
function retryAfter(value:string|null,now:()=>Date):number|undefined {
  if(!value)return 250;
  const milliseconds=/^\d+$/.test(value.trim())?Number(value.trim())*1000:Date.parse(value)-now().getTime();
  // A long server backoff is not permission to exceed the bounded verification window.
  return Number.isFinite(milliseconds)&&milliseconds>=0&&milliseconds<=2000?Math.max(250,milliseconds):undefined;
}
async function retryDelay(milliseconds:number,signal:AbortSignal):Promise<void>{
  if(signal.aborted)return;
  await new Promise<void>(resolve=>{
    const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};
    const timer=setTimeout(finish,milliseconds);
    signal.addEventListener('abort',finish,{once:true});
  });
}
export async function verifySource(raw:string,fetcher:SourceFetch,signal:AbortSignal,now=()=>new Date()):Promise<ArticleCandidate>{
  const canonical=sourceUrl(raw);
  if(signal.aborted)throw new SourceValidationError({url:canonical,code:'source_cancelled',attempts:0});
  const overallDeadline=Date.now()+30500;
  for(let attempt=1;attempt<=2;attempt++){
    let retryMilliseconds:number|undefined;
    try{return await verifySourceAttempt(raw,canonical,fetcher,signal,now,attempt,Math.min(15000,Math.max(1,overallDeadline-Date.now())),delay=>{retryMilliseconds=delay;});}
    catch(error){
      const diagnostic=sourceFailureDiagnostic(error);
      if(signal.aborted)throw new SourceValidationError({url:canonical,code:'source_cancelled',attempts:attempt});
      const transient=diagnostic&&(diagnostic.code==='source_timeout'||diagnostic.networkCode&&transientNetwork.has(diagnostic.networkCode)||diagnostic.httpStatus!==undefined&&[429,502,503,504].includes(diagnostic.httpStatus));
      if(attempt===2||!transient||retryMilliseconds===undefined)throw error;
      await retryDelay(retryMilliseconds,signal);
      if(signal.aborted)throw new SourceValidationError({url:canonical,code:'source_cancelled',attempts:attempt});
    }
  }
  throw new AppError('source_fetch_failed');
}
async function verifySourceAttempt(raw: string, canonical:string, fetcher: SourceFetch, signal: AbortSignal, now: () => Date,attempt:number,timeoutMs:number,setRetry:(milliseconds:number|undefined)=>void): Promise<ArticleCandidate> {
  setRetry(250);
  if (signal.aborted) throw new AppError('source_cancelled');
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  let response;
  try {
    response = await fetcher(canonical, { method: 'GET', redirect: 'manual', signal: deadline, headers: { accept: 'text/html', 'user-agent': 'AI-News-Hub/0.1 source-verification' } });
    if (response.status !== 200) {setRetry(retryAfter(response.headers.get('retry-after'),now));throw new AppError('source_http_failed');}
    const contentType = response.headers.get('content-type') ?? '';
    if (!/^text\/html(?:;|$)/i.test(contentType) || /charset\s*=\s*(?!["']?utf-8(?:["']?(?:\s|;|$)))/i.test(contentType)) throw new AppError('source_content_type');
    if (!response.body) throw new AppError('source_empty');
    if (Number(response.headers.get('content-length') ?? 0) > 2 * 1024 * 1024) throw new AppError('source_too_large');
    const chunks: Uint8Array[] = []; let bytes = 0;
    for await (const chunk of response.body) {
      deadline.throwIfAborted(); bytes += chunk.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new AppError('source_too_large');
      chunks.push(chunk);
    }
    const html = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    const stack: { node: DefaultTreeAdapterTypes.Node; hidden: boolean; title: boolean; depth: number }[] = [{ node: parse(html), hidden: false, title: false, depth: 0 }];
    const text: string[] = [], titles: string[] = [], dates: string[] = [];
    let count = 0;
    while (stack.length) {
      const {node,hidden,title,depth} = stack.pop()!;
      if (++count > 40000 || depth > 128) throw new AppError('source_html_too_complex');
      if (node.nodeName === '#text') {
        const value = (node as DefaultTreeAdapterTypes.TextNode).value;
        if (title) titles.push(value); else if (!hidden) text.push(value);
      }
      const tag = 'tagName' in node ? node : undefined;
      const attrs = new Map(tag?.attrs.map(a => [a.name,a.value]) ?? []);
      if (tag?.tagName === 'meta' && ['article:published_time','datepublished'].includes((attrs.get('property') ?? attrs.get('name') ?? attrs.get('itemprop') ?? '').toLowerCase())) dates.push(attrs.get('content') ?? '');
      if ('childNodes' in node) for (const child of [...node.childNodes].reverse()) stack.push({ node: child,
        hidden: hidden || ['script','style','noscript','template','svg','head'].includes(tag?.tagName ?? '') || attrs.has('hidden') || attrs.get('aria-hidden') === 'true',
        title: title || tag?.tagName === 'title', depth: depth + 1 });
    }
    const normalize = (s: string) => s.replace(/\s+/g,' ').trim();
    const title = normalize(titles.join(' ')).slice(0,500), excerpt = normalize(text.join(' ')).slice(0,100000);
    if (!title || !excerpt) throw new AppError('source_empty');
    const published = dates.filter(d => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(d) && Number.isFinite(Date.parse(d)));
    const times = [...new Set(published.map(d => new Date(d).toISOString()))];
    return { id: createHash('sha256').update(canonical).digest('hex'), title, originalUrl: raw, canonicalUrl: canonical, sourceName: new URL(canonical).hostname,
      publishedAt: times.length === 1 ? times[0] : null, eventAt: null, fetchedAt: now().toISOString(), excerpt };
  } catch (error) {
    const code=deadline.aborted ? signal.aborted ? 'source_cancelled' : 'source_timeout' : error instanceof AppError && sourceErrorCodes.has(error.code) ? error.code : 'source_fetch_failed';
    const network=networkCode(error);
    throw new SourceValidationError({url:canonical,code,attempts:attempt,...(response?.status?{httpStatus:response.status}:{}),...(network?{networkCode:network}:{})});
  } finally { if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {}); }
}
