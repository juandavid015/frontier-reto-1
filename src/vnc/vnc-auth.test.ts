import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vncKeyFromPassword } from './vnc-auth.ts';

// The DES tests check DES itself. This checks the VNC-only step before it; the real check is logging in.
test('VNC key reverses the bits of each password byte and pads with zeros', () => {
  assert.deepEqual(vncKeyFromPassword('pword'), Buffer.from('0EEEF64E26000000', 'hex'));
});

test('VNC key uses only the first 8 characters of the password', () => {
  assert.deepEqual(vncKeyFromPassword('abcdefghXYZ'), vncKeyFromPassword('abcdefgh'));
});
