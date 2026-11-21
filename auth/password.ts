import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

const ITERATIONS = 100000;
const ROUNDS = 6;
const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));

async function derive(password: Uint8Array, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations }, key, 256));
}

async function deriveChained(password: string, salt: Uint8Array): Promise<Uint8Array> {
  let value: Uint8Array = encoder.encode(password);
  for (let round = 0; round < ROUNDS; round++) {
    const roundSalt = new Uint8Array(salt.length + 1);
    roundSalt.set(salt);
    roundSalt[salt.length] = round;
    value = await derive(value, roundSalt, ITERATIONS);
  }
  return value;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `$pbkdf2-sha256-chain$r=${ROUNDS},i=${ITERATIONS}$${encode(salt)}$${encode(await deriveChained(password, salt))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const chained = /^\$pbkdf2-sha256-chain\$r=6,i=100000\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(stored);
  const legacy = /^\$pbkdf2-sha256\$i=(\d{6,7})\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(stored);
  if (!chained && !legacy) return false;
  if (legacy && (Number(legacy[1]) < 600000 || Number(legacy[1]) > 1200000)) return false;
  const expected = decode((chained ?? legacy)![chained ? 2 : 3]);
  let actual: Uint8Array;
  if (chained) actual = await deriveChained(password, decode(chained[1]));
  else {
    const iterations = Number(legacy![1]);
    const salt = decode(legacy![2]);
    try {
      actual = await derive(encoder.encode(password), salt, iterations);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotSupportedError') throw error;
      actual = pbkdf2(sha256, password, salt, { c: iterations, dkLen: 32 });
    }
  }
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}
