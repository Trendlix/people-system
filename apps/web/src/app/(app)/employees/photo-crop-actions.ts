'use server';

// The crop of the picture beside the name (owner's request, 16 October 2026: "allow me to crop the photo beside the name
// to make the face bigger without affecting the uploaded full photo"): PUT /paperwork/:itemId/photo-crop, HR only. The
// API checks the session, the role and the square again; the uploaded photo is never changed. The profile and the list
// of employees then show the new crop.
import type { PhotoCrop } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';

const UUID = /^[0-9a-f-]{36}$/i;
const NOT_FOUND = 'This photo is no longer in the employee file. Reload the page.';

/** Saves the square of the personal photo shown in the circle, or null for the whole photo. */
export async function cropPhoto(itemId: string, crop: PhotoCrop | null): Promise<FormState> {
  if (!UUID.test(itemId)) return { errors: [NOT_FOUND] };
  // its four values only, whatever else came with it
  const body = { crop: crop && { x: crop.x, y: crop.y, w: crop.w, h: crop.h } };
  try {
    await apiSend('PUT', `/paperwork/${itemId}/photo-crop`, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.status === 404 ? [NOT_FOUND] : err.messages };
    throw err;
  }
  refresh();
  return { message: crop ? 'The picture beside the name is cropped.' : 'The picture beside the name shows the whole photo again.' };
}
