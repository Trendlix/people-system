'use server';

// Company profile actions. The API checks the session and the HR/Admin role on each call (a Super Admin only for removing
// the logo or the thumbnail).
import { refresh, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend, apiUpload } from '@/lib/api';
import { TAB_ICON_TAG } from '@/lib/brand';
import { deleteRefusal } from '@/lib/session';
import type { FormState } from '@/lib/types';

const FIELDS = [
  'nameEn',
  'nameAr',
  'activity',
  'commercialRegNo',
  'taxRegNo',
  'insuranceEmployerNo',
  'addressAr',
  'addressEn',
  'city',
  'phone',
  'email',
  'website',
  'emailDomain',
  'repName',
  'repNameEn',
  'repTitle',
  'repTitleEn',
] as const;

const IMAGE_MAX_BYTES = 1024 * 1024;

/** The company's two images: the logo, and the thumbnail beside it, a square brand mark (owner's request, 15 October 2026). */
type CompanyImage = 'logo' | 'thumbnail';

export async function updateCompany(_prev: FormState, fd: FormData): Promise<FormState> {
  const body: Record<string, string> = {};
  for (const f of FIELDS) body[f] = String(fd.get(f) ?? '');
  // The national ID is never sent back to the browser, so an empty box means "keep the current one".
  const nationalId = String(fd.get('repNationalId') ?? '').trim();
  if (nationalId) body.repNationalId = nationalId;

  try {
    await apiSend('PATCH', '/company', body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values: { ...body, repNationalId: nationalId } };
    throw err;
  }
  redirect('/organization/company');
}

async function uploadImage(image: CompanyImage, fd: FormData): Promise<FormState> {
  const file = fd.get(image);
  if (!(file instanceof File) || file.size === 0) return { errors: ['Choose an image file to upload.'] };
  if (file.size > IMAGE_MAX_BYTES) return { errors: [`The ${image} must be 1 MB or smaller.`] };

  const form = new FormData();
  form.append('file', file, file.name);
  try {
    await apiUpload('PUT', `/company/${image}`, form);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  if (image === 'thumbnail') updateTag(TAB_ICON_TAG); // the browser tab icon is cached (components/brand.tsx)
  refresh();
  return { message: image === 'logo' ? 'Logo updated.' : 'Thumbnail updated.' };
}

/** Removes an image: a Super Admin only, like every deletion (owner's decision, 15 October 2026). Replacing it is HR's and Admin's. */
async function removeImage(image: CompanyImage): Promise<FormState> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  try {
    await apiSend('DELETE', `/company/${image}`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  if (image === 'thumbnail') updateTag(TAB_ICON_TAG);
  refresh();
  return { message: image === 'logo' ? 'Logo removed.' : 'Thumbnail removed.' };
}

export async function uploadLogo(_prev: FormState, fd: FormData): Promise<FormState> {
  return uploadImage('logo', fd);
}

export async function removeLogo(): Promise<FormState> {
  return removeImage('logo');
}

export async function uploadThumbnail(_prev: FormState, fd: FormData): Promise<FormState> {
  return uploadImage('thumbnail', fd);
}

export async function removeThumbnail(): Promise<FormState> {
  return removeImage('thumbnail');
}
