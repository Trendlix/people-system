import type { PhotoCrop } from '@trendlix/shared';
import type { Prisma } from '../generated/prisma/client.js';

// The square of a personal photo shown in the circle beside the name (owner's request, 16 October 2026), kept on the
// photo's paper (photo_crop). The check of a crop is shared with the web app (packages/shared photo-crop.ts).

/** The papers that are a picture beside the name: a personal photo kept as an image (never a PDF, nor any other paper). */
export const PHOTO_PAPER = { kind: 'personal_photo', mimeType: { in: ['image/jpeg', 'image/png', 'image/webp'] } } satisfies Prisma.PaperworkItemWhereInput;

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A crop as stored, or null when there is none (the whole photo, centred). Only its four values, whatever else is there. */
export function storedCrop(value: Prisma.JsonValue | null): PhotoCrop | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { x, y, w, h } = value;
  return isNumber(x) && isNumber(y) && isNumber(w) && isNumber(h) ? { x, y, w, h } : null;
}
