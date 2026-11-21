import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { hashPassword, verifyPassword } from '../dist/auth/password.js';

const password = 'correct horse battery staple';
const b64url = bytes => Buffer.from(bytes).toString('base64url');

test('new password hashes work when PBKDF2 calls are capped at 100,000 iterations', async () => {
  const prototype = Object.getPrototypeOf(crypto.subtle);
  const original = prototype.deriveBits;
  const iterations = [];
  prototype.deriveBits = function (algorithm, key, length) {
    iterations.push(algorithm.iterations);
    if (algorithm.iterations > 100000) throw new DOMException('iteration counts above 100000 are not supported', 'NotSupportedError');
    return original.call(this, algorithm, key, length);
  };
  try {
    const hash = await hashPassword(password);
    assert.match(hash, /^\$pbkdf2-sha256-chain\$r=6,i=100000\$/);
    assert.equal(await verifyPassword(password, hash), true);
    assert.equal(await verifyPassword('incorrect password', hash), false);
    assert.equal(iterations.length, 18);
    assert.ok(iterations.every(value => value === 100000));
  } finally {
    prototype.deriveBits = original;
  }
});

test('legacy 600,000 iteration hashes remain verifiable under the Workers cap', async () => {
  const salt = Buffer.alloc(16, 7);
  const old = `$pbkdf2-sha256$i=600000$${b64url(salt)}$${b64url(pbkdf2Sync(password, salt, 600000, 32, 'sha256'))}`;
  const prototype = Object.getPrototypeOf(crypto.subtle);
  const original = prototype.deriveBits;
  prototype.deriveBits = function (algorithm, key, length) {
    if (algorithm.iterations > 100000) throw new DOMException('iteration counts above 100000 are not supported', 'NotSupportedError');
    return original.call(this, algorithm, key, length);
  };
  try {
    assert.equal(await verifyPassword(password, old), true);
    assert.equal(await verifyPassword('incorrect password', old), false);
  } finally {
    prototype.deriveBits = original;
  }
});
