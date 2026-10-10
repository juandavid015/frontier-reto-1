import { DES_BLOCK_LENGTH, encryptDesBlock } from './des.ts';
import { VNC_CHALLENGE_LENGTH } from './rfb-protocol.ts';

// VNC Authentication, RFC 6143 section 7.2.2: the client DES-encrypts the server's 16-byte challenge with the
// password as key. The RFC does not say so, but every real server (and noVNC) reverses the bits of each key byte
// first, because the original implementation fed DES its key in the opposite bit order. The password is cut or
// zero-padded to 8 bytes, as VNC passwords have always been.

export function vncAuthResponse(challenge: Buffer, password: string): Buffer {
  if (challenge.length !== VNC_CHALLENGE_LENGTH) {
    throw new Error(`VNC challenge must be ${VNC_CHALLENGE_LENGTH} bytes, got ${challenge.length}`);
  }
  const key = vncKeyFromPassword(password);
  const firstHalf = encryptDesBlock(key, challenge.subarray(0, DES_BLOCK_LENGTH));
  const secondHalf = encryptDesBlock(key, challenge.subarray(DES_BLOCK_LENGTH));
  return Buffer.concat([firstHalf, secondHalf]);
}

// Example: "pword" is 70 77 6F 72 64, and its key is 0E EE F6 4E 26 00 00 00.
export function vncKeyFromPassword(password: string): Buffer {
  const key = Buffer.alloc(DES_BLOCK_LENGTH);
  // latin1 keeps one byte per character, like noVNC does with charCodeAt.
  Buffer.from(password, 'latin1').copy(key, 0, 0, DES_BLOCK_LENGTH);
  return Buffer.from(key.map(reverseBits));
}

function reverseBits(byte: number): number {
  let reversed = 0;
  for (let bit = 0; bit < 8; bit++) {
    reversed = (reversed << 1) | ((byte >> bit) & 1);
  }
  return reversed;
}
