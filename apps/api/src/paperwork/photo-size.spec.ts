import { photoSize } from './photo-size.js';

// Made with sharp: a 4 × 2 JPEG without metadata, a 5 × 3 lossy WebP, a 6 × 7 lossless WebP and a 9 × 4 WebP with
// transparency (extended format, VP8X).
const JPEG_4X2 = Buffer.from(
  '/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKABiz//2Q==',
  'base64',
);
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const WEBP_5X3 = Buffer.from('UklGRjYAAABXRUJQVlA4ICoAAACwAQCdASoFAAMAAsBMJaACdLoABdQAAP3HH/hWuYfmHtb/3BmfV1/gAAA=', 'base64');
const WEBP_6X7 = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvBYABAAdQvCIXpf+BiOh/AAA=', 'base64');
const WEBP_9X4 = Buffer.from(
  'UklGRkgAAABXRUJQVlA4WAoAAAAQAAAACAAAAwAAQUxQSAoAAAABB1DAiAhERP8DVlA4IBgAAAAwAQCdASoJAAQAAsBMJaQAA3AA/vfggAA=',
  'base64',
);

/** The JPEG with an EXIF segment (APP1) right after its start, giving only the orientation. */
function withOrientation(jpeg: Buffer, orientation: number, order: 'II' | 'MM' = 'II'): Buffer {
  const tiff = Buffer.alloc(26);
  const little = order === 'II';
  const u16 = (v: number, at: number) => (little ? tiff.writeUInt16LE(v, at) : tiff.writeUInt16BE(v, at));
  const u32 = (v: number, at: number) => (little ? tiff.writeUInt32LE(v, at) : tiff.writeUInt32BE(v, at));
  tiff.write(order, 0, 'latin1');
  u16(42, 2);
  u32(8, 4); // the first IFD
  u16(1, 8); // one entry: orientation, a SHORT
  u16(0x0112, 10);
  u16(3, 12);
  u32(1, 14);
  u16(orientation, 18);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const header = Buffer.from([0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)]);
}

describe('photo sizes', () => {
  it('reads a JPEG’s size from its frame header', () => {
    expect(photoSize(JPEG_4X2, 'image/jpeg')).toEqual({ width: 4, height: 2 });
  });

  it('gives a JPEG’s size as shown, turned upright by its EXIF orientation', () => {
    expect(photoSize(withOrientation(JPEG_4X2, 6), 'image/jpeg')).toEqual({ width: 2, height: 4 }); // a quarter turn
    expect(photoSize(withOrientation(JPEG_4X2, 8, 'MM'), 'image/jpeg')).toEqual({ width: 2, height: 4 });
    expect(photoSize(withOrientation(JPEG_4X2, 3), 'image/jpeg')).toEqual({ width: 4, height: 2 }); // upside down
    expect(photoSize(withOrientation(JPEG_4X2, 1), 'image/jpeg')).toEqual({ width: 4, height: 2 });
    expect(photoSize(withOrientation(JPEG_4X2, 42), 'image/jpeg')).toEqual({ width: 4, height: 2 }); // not an orientation
  });

  it('reads PNG and WebP sizes (lossy, lossless and extended)', () => {
    expect(photoSize(PNG_1X1, 'image/png')).toEqual({ width: 1, height: 1 });
    expect(photoSize(WEBP_5X3, 'image/webp')).toEqual({ width: 5, height: 3 });
    expect(photoSize(WEBP_6X7, 'image/webp')).toEqual({ width: 6, height: 7 });
    expect(photoSize(WEBP_9X4, 'image/webp')).toEqual({ width: 9, height: 4 });
  });

  it('gives nothing for a header it cannot read', () => {
    expect(photoSize(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from('MARK:X')]), 'image/jpeg')).toBeNull();
    expect(photoSize(JPEG_4X2.subarray(0, 150), 'image/jpeg')).toBeNull(); // cut off before the frame header
    expect(photoSize(PNG_1X1.subarray(0, 20), 'image/png')).toBeNull();
    expect(photoSize(Buffer.from('RIFF\0\0\0\0WEBPVP8 '), 'image/webp')).toBeNull();
    expect(photoSize(Buffer.from('%PDF-1.4\n'), 'application/pdf')).toBeNull();
  });
});
