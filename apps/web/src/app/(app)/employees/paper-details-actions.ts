'use server';

// The number printed on a paper in the employee file, when it expires, and its kind (PATCH /paperwork/:itemId, HR only;
// the API checks this again). The expiry is typed as DD/MM/YYYY and sent as YYYY-MM-DD; an empty field clears it. The
// kind is sent only when the form has one (not for every paper) and moves the file to that document.
import { PAPERWORK_LABELS, type PaperworkKind } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import { dateFrom } from '@/lib/form-data';
import type { FormState } from '@/lib/types';

export async function describePaperwork(itemId: string, kindBefore: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const kind = fd.get('kind') === null ? undefined : String(fd.get('kind'));
  const values = { documentNo: String(fd.get('documentNo') ?? ''), expiresOn: String(fd.get('expiresOn') ?? ''), ...(kind !== undefined && { kind }) };
  const errors: string[] = [];
  const body = { documentNo: values.documentNo, expiresOn: dateFrom(fd, 'expiresOn', 'expiry date', errors), ...(kind !== undefined && { kind }) };
  if (errors.length) return { errors, values };
  try {
    await apiSend('PATCH', `/paperwork/${itemId}`, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values };
    throw err;
  }
  refresh();
  const moved = kind !== undefined && kind !== kindBefore ? PAPERWORK_LABELS[kind as PaperworkKind] : null;
  return { message: moved ? `Details saved. Moved to ${moved}.` : 'Details saved.' };
}
