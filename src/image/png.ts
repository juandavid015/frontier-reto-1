import { crc32, deflateSync } from 'node:zlib';
import { RGB_BYTES_PER_PIXEL, type Frame } from '../vnc/framebuffer.ts';

// Minimal PNG writer, W3C PNG specification (third edition): 8-bit RGB, no interlace, filter type 0 on every row.
// Layout: signature, IHDR (size and format), IDAT (compressed rows), IEND.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BIT_DEPTH = 8;
const COLOUR_TYPE_RGB = 2;
const FILTER_NONE = 0;

export function encodePng(frame: Frame): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(frame.width, 0);
  header.writeUInt32BE(frame.height, 4);
  header.writeUInt8(BIT_DEPTH, 8);
  header.writeUInt8(COLOUR_TYPE_RGB, 9);
  // Bytes 10 to 12 stay 0: deflate compression, adaptive filtering, no interlace.
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rowsWithFilterBytes(frame))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Each row starts with a byte that names its filter: [0, r, g, b, r, g, b, ...].
function rowsWithFilterBytes(frame: Frame): Buffer {
  const rowLength = frame.width * RGB_BYTES_PER_PIXEL;
  const rows = Buffer.alloc((rowLength + 1) * frame.height);
  for (let row = 0; row < frame.height; row++) {
    const target = row * (rowLength + 1);
    rows[target] = FILTER_NONE;
    frame.rgb.copy(rows, target + 1, row * rowLength, (row + 1) * rowLength);
  }
  return rows;
}

// A chunk is: data length, type, data, then a CRC-32 over type and data.
function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(data, crc32(typeBytes)));
  return Buffer.concat([length, typeBytes, data, checksum]);
}
