import { EnvHttpProxyAgent, fetch, type Response } from 'undici';
import { AppError } from '../errors.js';

export type GitHubFetch = typeof fetch;
export function githubHttpClient() {
  let dispatcher: EnvHttpProxyAgent | undefined;
  return { fetcher: ((url,init) => { dispatcher ??= new EnvHttpProxyAgent(); return fetch(url,{...init,dispatcher}); }) as GitHubFetch,
    close: async () => { await dispatcher?.close(); } };
}
export async function githubText(response: Response): Promise<string> {
  if (!response.body) throw new AppError('github_empty_response');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    if (Number(response.headers.get('content-length') ?? 0) > 2 * 1024 * 1024) throw new AppError('github_response_too_large');
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 2 * 1024 * 1024) throw new AppError('github_response_too_large');
      chunks.push(chunk);
    }
    return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  } finally { if (!response.body.locked) await response.body.cancel().catch(()=>{}); }
}
