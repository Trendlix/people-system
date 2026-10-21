import { PRODUCT_IMAGE_RULES } from '@trendlix/shared';
import type { ImageFetchDeps } from './image-guard';

// A product image made smaller on the server (owner, 21 October 2026: "let the mcp connector fetch the product photo
// and add it"), with sharp, which Next.js installs with itself and keeps outside the bundle: at most 1600 px a side
// (never larger than it is), turned the right way up, as JPEG 85% on white (a transparent PNG would turn black
// otherwise), its metadata dropped, as the photos the browser sends are. Being the server's own encoding, nothing but
// the picture is kept. Null when the server has no sharp: the image is then kept as fetched (image-guard.ts says so).
// Pure code (no "@/" imports): tested with sharp itself.

export const shrinkWithSharp: NonNullable<ImageFetchDeps['shrink']> = async (bytes) => {
  let sharp: typeof import('sharp').default;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    return null;
  }
  const { side, maxSide } = PRODUCT_IMAGE_RULES;
  const out = await sharp(bytes, { limitInputPixels: maxSide * maxSide, failOn: 'error' })
    .rotate()
    .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  return { bytes: new Uint8Array(out.data), type: 'image/jpeg', width: out.info.width, height: out.info.height };
};
