import type { PaperworkType } from './paperwork-file.js';

// The size of a photo, read from its header, as a browser shows it: a JPEG turned the right way up by its EXIF
// orientation (as every current browser does, for a picture on screen and drawn on a canvas). Nothing is decoded.

export interface PhotoSize {
  width: number;
  height: number;
}

/** The photo's width and height as shown; null when its header cannot be read (a damaged or unusual file). */
export function photoSize(data: Buffer, type: PaperworkType): PhotoSize | null {
  switch (type) {
    case 'image/jpeg':
      return jpegSize(data);
    case 'image/png':
      return pngSize(data);
    case 'image/webp':
      return webpSize(data);
    default:
      return null;
  }
}

const size = (width: number, height: number): PhotoSize | null => (width > 0 && height > 0 ? { width, height } : null);

/** From the frame header (SOFn); width and height swapped for the EXIF orientations that turn it a quarter (5 to 8). */
function jpegSize(d: Buffer): PhotoSize | null {
  let orientation = 1;
  let i = 2; // after the start of image (FF D8)
  while (i + 4 <= d.length) {
    if (d[i] !== 0xff) return null;
    const marker = d[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    i += 2;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue; // markers without a length
    if (marker === 0xd9 || marker === 0xda) return null; // the image ends, or its data starts, before any frame header
    const length = d.readUInt16BE(i);
    if (length < 2 || i + length > d.length) return null;
    if (marker === 0xe1 && length >= 8 && d.toString('latin1', i + 2, i + 8) === 'Exif\0\0') {
      orientation = exifOrientation(d.subarray(i + 8, i + length)) ?? orientation;
    }
    const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (frame) {
      if (length < 7) return null;
      const height = d.readUInt16BE(i + 3);
      const width = d.readUInt16BE(i + 5);
      return orientation >= 5 ? size(height, width) : size(width, height);
    }
    i += length;
  }
  return null;
}

/** Tag 0x0112 of the first IFD of the EXIF data (a TIFF structure), 1 to 8. */
function exifOrientation(tiff: Buffer): number | null {
  if (tiff.length < 8) return null;
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const entries = u16(ifd);
  for (let k = 0; k < entries; k++) {
    const at = ifd + 2 + k * 12;
    if (at + 12 > tiff.length) return null;
    if (u16(at) === 0x0112) {
      const value = u16(at + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** From the IHDR chunk, which comes first. */
function pngSize(d: Buffer): PhotoSize | null {
  if (d.length < 24 || d.toString('latin1', 12, 16) !== 'IHDR') return null;
  return size(d.readUInt32BE(16), d.readUInt32BE(20));
}

/** From the first chunk: VP8X (extended: the canvas), VP8 (lossy) or VP8L (lossless). */
function webpSize(d: Buffer): PhotoSize | null {
  if (d.length < 30) return null;
  switch (d.toString('latin1', 12, 16)) {
    case 'VP8X':
      return size(1 + d.readUIntLE(24, 3), 1 + d.readUIntLE(27, 3));
    case 'VP8 ':
      if (d[23] !== 0x9d || d[24] !== 0x01 || d[25] !== 0x2a) return null;
      return size(d.readUInt16LE(26) & 0x3fff, d.readUInt16LE(28) & 0x3fff);
    case 'VP8L': {
      if (d[20] !== 0x2f) return null;
      const bits = d.readUInt32LE(21);
      return size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    default:
      return null;
  }
}
