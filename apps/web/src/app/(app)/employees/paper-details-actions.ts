'use server';

// The number printed on a paper in the employee file and when it expires (PATCH /paperwork/:itemId, HR only; the API
// checks this again). The expiry is typed as DD/MM/YYYY and sent as YYYY-MM-DD; an empty field clears it.
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import { dateFrom } from '@/lib/form-data';
import type { FormState } from '@/lib/types';

export async function describePaperwork(itemId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = { documentNo: String(fd.get('documentNo') ?? ''), expiresOn: String(fd.get('expiresOn') ?? '') };
  const errors: string[] = [];
  const body = { documentNo: values.documentNo, expiresOn: dateFrom(fd, 'expiresOn', 'expiry date', errors) };
  if (errors.length) return { errors, values };
  try {
    await apiSend('PATCH', `/paperwork/${itemId}`, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values };
    throw err;
  }
  refresh();
  return { message: 'Details saved.' };
}
