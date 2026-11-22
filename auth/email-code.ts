const encoder = new TextEncoder();
const MAX_RANDOM = 0x100000000;
const CODE_COUNT = 1000000;
const UNBIASED_LIMIT = Math.floor(MAX_RANDOM / CODE_COUNT) * CODE_COUNT;

export function createEmailCode(): string {
  let value: number;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= UNBIASED_LIMIT);
  return String(value % CODE_COUNT).padStart(6, '0');
}

export async function hashEmailCode(secret: string, userId: string, tokenId: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`verify-email-code|${userId}|${tokenId}|${code}`)));
  return `otp:${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
