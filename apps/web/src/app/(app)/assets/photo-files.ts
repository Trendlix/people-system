// An asset's photos made smaller in the browser before they are sent (owner's brief, 21 October 2026: up to 6 photos an
// asset; the spec: "resized client-side to 1600 px, JPEG 85%"): at most 1600 pixels on the long side, as JPEG, turned
// the right way up from its EXIF data. Each goes in a request of its own (uploads pass through the website on Vercel,
// which takes at most 4.5 MB a request). The API checks each file's kind and size again.

import { ASSET_PHOTO_QUALITY, ASSET_PHOTO_SIDE } from '@trendlix/shared';

/** The photos the boxes take: JPEG, PNG and WebP (as the API keeps them; never HEIC, which most browsers can't show). */
export const ASSET_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';

/** A small photo already at most this big is sent as it is, unless it is larger than the side. */
const SMALL_ENOUGH = 600 * 1024;

/** Whether a file is a photo the asset can have. */
export const isAssetPhoto = (file: Pick<File, 'type'>): boolean => /^image\/(jpeg|png|webp)$/.test(file.type);

/** The size a photo is drawn at: its long side at most `side` pixels, never larger than it is. */
export function photoTarget(width: number, height: number, side = ASSET_PHOTO_SIDE): { width: number; height: number } {
  const scale = Math.min(1, side / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The photo made smaller, as JPEG; a small one, or one the browser can't open, as it is (the API checks it). */
export async function shrinkAssetPhoto(file: File): Promise<File> {
  if (!isAssetPhoto(file)) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const target = photoTarget(bitmap.width, bitmap.height);
    if (file.size <= SMALL_ENOUGH && target.width === bitmap.width && target.height === bitmap.height) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#ffffff'; // a transparent PNG would otherwise turn black as JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', ASSET_PHOTO_QUALITY));
    if (!blob) return file;
    return new File([blob], `${file.name.replace(/\.[^.]*$/, '') || 'photo'}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
