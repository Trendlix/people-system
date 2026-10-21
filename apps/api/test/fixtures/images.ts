import { deflateSync } from 'node:zlib';

// Pictures for the product image tests (owner, 21 October 2026: "let the mcp connector fetch the product photo and add
// it"): a real PNG of any size (a plain colour, deflated), the first bytes of a JPEG and of each WebP kind with their
// sizes, an SVG, and a GIF.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A real PNG, `width` × `height`, one colour (RGB). */
export function pngOf(width: number, height: number, rgb: [number, number, number] = [200, 30, 40]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** A JPEG's first bytes (JFIF, then the frame header with its size), enough to read its kind and size. */
export function jpegOf(width: number, height: number): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ]);
}

/** A WebP's first bytes: lossy (VP8), lossless (VP8L) or extended (VP8X), with its size. */
export function webpOf(kind: 'VP8 ' | 'VP8L' | 'VP8X', width: number, height: number): Buffer {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(22, 4);
  b.write('WEBP', 8, 'ascii');
  b.write(kind, 12, 'ascii');
  b.writeUInt32LE(10, 16);
  if (kind === 'VP8 ') {
    b.set([0x9d, 0x01, 0x2a], 23);
    b.writeUInt16LE(width & 0x3fff, 26);
    b.writeUInt16LE(height & 0x3fff, 28);
  } else if (kind === 'VP8L') {
    b[20] = 0x2f;
    b.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 21);
  } else {
    b.writeUIntLE(width - 1, 24, 3);
    b.writeUIntLE(height - 1, 27, 3);
  }
  return b;
}

export const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><script>alert(1)</script></svg>');

export const GIF = Buffer.from('GIF89a\x90\x01\x90\x01\x00\x00\x00', 'latin1');
