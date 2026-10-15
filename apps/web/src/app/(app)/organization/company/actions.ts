'use server';

// Company profile actions. The API checks the session and the HR/Admin role on each call (a Super Admin only for removing
// the logo).
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend, apiUpload } from '@/lib/api';
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
  'repTitle',
] as const;

const LOGO_MAX_BYTES = 1024 * 1024;

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

export async function uploadLogo(_prev: FormState, fd: FormData): Promise<FormState> {
  const file = fd.get('logo');
  if (!(file instanceof File) || file.size === 0) return { errors: ['Choose an image file to upload.'] };
  if (file.size > LOGO_MAX_BYTES) return { errors: ['The logo must be 1 MB or smaller.'] };

  const form = new FormData();
  form.append('file', file, file.name);
  try {
    await apiUpload('PUT', '/company/logo', form);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  return { message: 'Logo updated.' };
}

/** Removes the logo: a Super Admin only, like every deletion (owner's decision, 15 October 2026). Replacing it is HR's and Admin's. */
export async function removeLogo(): Promise<FormState> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  try {
    await apiSend('DELETE', '/company/logo');
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  return { message: 'Logo removed.' };
}
