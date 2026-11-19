const ITERATIONS = 600000;
const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations }, key, 256));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `$pbkdf2-sha256$i=${ITERATIONS}$${encode(salt)}$${encode(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = /^\$pbkdf2-sha256\$i=(\d{6,7})\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(stored);
  if (!match) return false;
  const iterations = Number(match[1]);
  if (iterations < 600000 || iterations > 1200000) return false;
  const expected = decode(match[3]);
  const actual = await derive(password, decode(match[2]), iterations);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}
