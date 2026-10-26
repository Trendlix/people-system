'use server';

// Recount past days (owner, 26 October 2026): the preview and the run forward to the API, which checks the role (HR, a
// Super Admin), the months (at most 12, up to this month) and the shift again, so calling these directly can't bypass them.
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { RecountView } from '@/lib/recount';

export type RecountState = { errors?: string[]; preview?: RecountView; result?: RecountView };

async function call(path: '/preview' | '', from: string, to: string, shiftId: string): Promise<{ errors?: string[]; view?: RecountView }> {
  try {
    const view = await apiSend<RecountView>('POST', `/attendance/recount-days${path}`, { from, to, ...(shiftId && { shiftId }) });
    return { view };
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
}

/** What the recount would do (POST /attendance/recount-days/preview { from, to, shiftId? }). */
export async function previewRecount(from: string, to: string, shiftId: string): Promise<RecountState> {
  const { errors, view } = await call('/preview', from, to, shiftId);
  return errors ? { errors } : { preview: view };
}

/** The recount (POST /attendance/recount-days { from, to, shiftId? }). */
export async function runRecount(from: string, to: string, shiftId: string): Promise<RecountState> {
  const { errors, view } = await call('', from, to, shiftId);
  if (errors) return { errors };
  refresh();
  return { result: view };
}
