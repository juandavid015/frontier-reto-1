import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encryptDesBlock } from './des.ts';

const hex = (value: string) => Buffer.from(value, 'hex');

// The worked example used across DES references (key 133457799BBCDFF1), and a known-answer pair whose output is all
// zeros. Any wrong entry in a permutation or S-box table changes these outputs.
test('DES matches the standard worked example', () => {
  assert.deepEqual(encryptDesBlock(hex('133457799BBCDFF1'), hex('0123456789ABCDEF')), hex('85E813540F0AB405'));
});

test('DES matches a known answer with an all-zero output', () => {
  assert.deepEqual(encryptDesBlock(hex('0E329232EA6D0D73'), hex('8787878787878787')), hex('0000000000000000'));
});

test('DES refuses a key or block that is not 8 bytes', () => {
  assert.throws(() => encryptDesBlock(hex('00'), hex('0000000000000000')), /8-byte key/);
  assert.throws(() => encryptDesBlock(hex('0000000000000000'), hex('')), /8-byte block/);
});
