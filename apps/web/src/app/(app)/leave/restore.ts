import { overBalanceWarning } from '@trendlix/shared';
import type { LeaveRequestView } from '../../../lib/types';

// A Super Admin undoing a cancellation (owner, 26 October 2026: "allow superadmin to undo cancellation and go through the
// edit to prevent this mistake"). Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

/** The longest note the API takes. */
export const RESTORE_NOTE_MAX = 500;

/** What POST /leave/requests/:id/restore takes. */
export interface RestoreBody {
  note?: string;
}

/** The form as the API takes it, and what is wrong with it: only the note's length. */
export function restoreBody(fd: FormData): { body: RestoreBody | null; errors: string[] } {
  const note = String(fd.get('note') ?? '').trim();
  if (note.length > RESTORE_NOTE_MAX) return { body: null, errors: [`Keep the note to ${RESTORE_NOTE_MAX} characters; it has ${note.length}.`] };
  return { body: note ? { note } : {}, errors: [] };
}

/**
 * The warning before restoring a leave that takes from the annual balance when that leaves it below 0 ("This leaves the
 * annual balance at −2 days."); null when it fits, or when it isn't from the annual balance (the API sends no balance). A Super Admin may restore it anyway.
 */
export function restoreWarning(r: Pick<LeaveRequestView, 'days' | 'balanceBeforeRestore'>): string | null {
  if (r.balanceBeforeRestore === null || r.balanceBeforeRestore === undefined) return null;
  return r.balanceBeforeRestore - r.days < 0 ? overBalanceWarning(r.balanceBeforeRestore, r.days) : null;
}
