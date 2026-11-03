import { EnvHttpProxyAgent, fetch, type Response } from 'undici';
import { AppError } from '../errors.js';
import type { FeedSource } from './source.js';

export type FeedFetch = typeof fetch;
export function feedHttpClient(): { fetcher: FeedFetch; close: () => Promise<void> } {
  let dispatcher: EnvHttpProxyAgent | undefined;
  return { fetcher: (url, init) => {
    dispatcher ??= new EnvHttpProxyAgent();
    return fetch(url, { ...init, dispatcher });
  }, close: async () => { await dispatcher?.close(); } };
}
export async function fetchFeed(fetcher: FeedFetch, source: FeedSource, headers: Record<string, string>, signal: AbortSignal): Promise<Response> {
  const origin = new URL(source.feedUrl).origin;
  let url = source.feedUrl;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.username || parsed.password) throw new AppError('feed_redirect_forbidden');
    const response = await fetcher(url, { method: 'GET', headers, redirect: 'manual', signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new AppError('feed_redirect_forbidden');
    url = new URL(location, url).href;
  }
  throw new AppError('feed_redirect_limit');
}
export async function feedText(response: Response): Promise<string> {
  const limit = 2 * 1024 * 1024;
  if (Number(response.headers.get('content-length') ?? 0) > limit) {
    await response.body?.cancel(); throw new AppError('feed_too_large');
  }
  if (!response.body) throw new AppError('feed_empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) throw new AppError('feed_too_large');
      chunks.push(part.value);
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
    catch { throw new AppError('feed_invalid_encoding'); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
