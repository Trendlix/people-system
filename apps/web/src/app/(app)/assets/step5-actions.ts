'use server';

// Assets step 5's form actions (owner, 22 October 2026: "Assets step 5 (stock counts, label sheets, the Assets
// dashboard, exports) … work on this"): saving a count (then its page, on the site or the phone), marking a missing
// asset of a count lost, and marking the labels printed. Each forwards to the API, which checks the caller's Assets
// access and every code again, so calling these directly can't get round them; its refusals show on the forms.

import type { AssetCountView } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import { APP_ASSET_PATHS, ASSET_PATHS, ASSET_STEP5_API, type CountScopeQuery } from '@/lib/asset-paths';
import type { FormState } from '@/lib/types';

const messages = (err: unknown): string[] => {
  if (err instanceof ApiError) return err.messages;
  throw err;
};

/** The codes a form sends as JSON (`found`, `codes`): a list of text, else none. */
function codesOf(fd: FormData, name: string): string[] {
  try {
    const value: unknown = JSON.parse(String(fd.get(name) ?? '[]'));
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

const textOrNull = (v: FormDataEntryValue | null): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Saves a count of `scope`: the codes ticked and the notes; then its page, on the phone (`phone`) or the site. */
export async function saveCount(scope: CountScopeQuery, phone: boolean, _prev: FormState, fd: FormData): Promise<FormState> {
  let made: AssetCountView | undefined;
  try {
    made = await apiSend<AssetCountView>('POST', ASSET_STEP5_API.count, {
      kind: scope.kind,
      ...(scope.kind === 'group' && { group: scope.group }),
      ...(scope.kind === 'room' && { roomId: scope.roomId }),
      ...(scope.kind === 'kit' && { kitId: scope.kitId }),
      found: codesOf(fd, 'found'),
      notes: textOrNull(fd.get('notes')),
    });
  } catch (err) {
    return { errors: messages(err) };
  }
  if (!made) return { errors: ['The count could not be saved. Please try again.'] };
  redirect(phone ? APP_ASSET_PATHS.count(made.id) : ASSET_PATHS.count(made.id));
}

/** Marks a missing asset of a count lost (spec §6.5: a deliberate step of its own). */
export async function markLostFromCount(countId: string, code: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    await apiSend('POST', ASSET_STEP5_API.markLost(countId, code), { notes: textOrNull(fd.get('notes')) });
  } catch (err) {
    return { errors: messages(err) };
  }
  refresh();
  return { message: `${code} marked lost.` };
}

/** Marks the labels printed as stuck on, once the sheets came out right. */
export async function markLabelsPrinted(_prev: FormState, fd: FormData): Promise<FormState> {
  const codes = codesOf(fd, 'codes');
  if (!codes.length) return { errors: ['Choose the labels printed.'] };
  try {
    const done = await apiSend<{ labelled: string[] }>('POST', ASSET_STEP5_API.labelled, { codes });
    refresh();
    const n = done?.labelled.length ?? codes.length;
    return { message: `${n} ${n === 1 ? 'label' : 'labels'} marked as printed.` };
  } catch (err) {
    return { errors: messages(err) };
  }
}
