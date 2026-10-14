'use server';

// Company profile actions. The API checks the session and the HR/Admin role on each call.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend, apiUpload } from '@/lib/api';
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
  redirect('/organisation/company');
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

export async function removeLogo(): Promise<FormState> {
  try {
    await apiSend('DELETE', '/company/logo');
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  return { message: 'Logo removed.' };
}
