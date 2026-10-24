'use server';

// The custody forms' actions (Assets step 3, owner, 21 October 2026): a handover, receiving items back, attaching the
// signed copy, an asset sent to repair and back or marked lost and found, and the terms the forms print (an Assets
// manager's). Each forwards to the API, which checks the caller's Assets access, the C-level rule, the statuses and
// every field again, so calling these directly can't get round them; its refusals show on the forms.

import type { HandoverResult, KitSkip } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { ApiError, apiSend, apiUpload } from '@/lib/api';
import { CUSTODY_API } from '@/lib/asset-paths';
import type { FormState } from '@/lib/types';
import { apiMessages } from '../payroll/actions-common';
import { todayInCairo } from '../employees/ui';
import { readReturnForm, repairBody, termsBody } from './custody';

const messages = (err: unknown): string[] => {
  if (err instanceof ApiError) return apiMessages(err);
  throw err;
};

/** A handover sent (the form built its body: custody.ts handoverBody): the record's code, and the kits' assets skipped. */
export async function handOverAssets(body: Record<string, unknown>): Promise<{ code?: string; skipped?: KitSkip[]; errors?: string[] }> {
  try {
    const result = await apiSend<HandoverResult>('POST', CUSTODY_API.handOver, body);
    if (!result?.record) return { errors: ['The handover could not be saved. Please try again.'] };
    return { code: result.record.code, skipped: result.skipped };
  } catch (err) {
    return { errors: messages(err) };
  }
}

/**
 * Items received back (`items`: those still out, each with its condition and notes on the form, and since step 4 the
 * accessories that went out with it, ticked again).
 */
export async function receiveBack(code: string, items: (string | { id: string; accessoriesOut?: { quantity: number }[] })[], _prev: FormState, fd: FormData): Promise<FormState> {
  const { lines, problems } = readReturnForm(fd, items);
  const values = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, String(v)]));
  if (problems.length) return { errors: problems, values };
  try {
    await apiSend('POST', CUSTODY_API.receive(code), { lines });
  } catch (err) {
    return { errors: messages(err), values };
  }
  refresh();
  return { message: `${lines.length} ${lines.length === 1 ? 'item' : 'items'} received back.` };
}

/** A signed copy sent (`file` in the form, a photo made smaller in the browser, or a PDF): one a request. */
export async function attachSignedCopy(code: string, fd: FormData): Promise<{ error?: string }> {
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose the photo or the PDF of the signed form.' };
  const form = new FormData();
  form.append('file', file, file.name || 'signed-form.jpg');
  try {
    await apiUpload('POST', CUSTODY_API.signed(code), form);
  } catch (err) {
    return { error: messages(err).join(' ') };
  }
  return {};
}

/** After the signed copies were sent: the record's page again. */
export async function signedCopiesSent(): Promise<void> {
  refresh();
}

/** What each of an asset's page actions does, and what it says once done. */
const ACTIONS = {
  repair: { path: CUSTODY_API.repair, repair: true, done: 'Sent to repair.' },
  back: { path: CUSTODY_API.repairBack, repair: true, done: 'Back from repair: available again.' },
  lost: { path: CUSTODY_API.lost, repair: false, done: 'Marked lost.' },
  found: { path: CUSTODY_API.found, repair: false, done: 'Marked found: available again.' },
} as const;

export type AssetPageAction = keyof typeof ACTIONS;

/**
 * An asset sent to repair or back (its date, vendor and notes; back, the cost from those who see the values), or marked
 * lost or found (notes): a maintenance entry kept for a repair.
 */
export async function assetPageAction(code: string, action: AssetPageAction, values: boolean, _prev: FormState, fd: FormData): Promise<FormState> {
  const a = ACTIONS[action];
  if (!a) return { errors: ['Choose what to do.'] };
  const typed = Object.fromEntries(['on', 'vendor', 'notes', 'cost'].map((k) => [k, String(fd.get(k) ?? '')]));
  const { body, problems } = repairBody(fd, { repair: a.repair, values: values && action === 'back', today: todayInCairo() });
  if (problems.length) return { errors: problems, values: typed };
  try {
    await apiSend('POST', a.path(code), body);
  } catch (err) {
    return { errors: messages(err), values: typed };
  }
  refresh();
  return { message: a.done };
}

/**
 * The custody terms, one a line (an Assets manager's), and the Arabic beside them (24 October 2026: "Arabic and
 * English"); records already made keep the terms they were printed with.
 */
export async function saveCustodyTerms(_prev: FormState, fd: FormData): Promise<FormState> {
  const text = String(fd.get('terms') ?? '');
  const arText = fd.has('termsAr') ? String(fd.get('termsAr') ?? '') : undefined;
  const typed = { terms: text, ...(arText !== undefined && { termsAr: arText }) };
  const { terms, termsAr, problems } = termsBody(text, arText);
  if (problems.length) return { errors: problems, values: typed };
  try {
    await apiSend('PATCH', CUSTODY_API.terms, { terms, ...(termsAr && { termsAr }) });
  } catch (err) {
    return { errors: messages(err), values: typed };
  }
  refresh();
  return { message: 'Saved. New custody forms print these terms; records already made keep theirs.' };
}

/** Back to the standard wording. */
export async function restoreStandardTerms(): Promise<FormState> {
  try {
    await apiSend('PATCH', CUSTODY_API.terms, { standard: true });
  } catch (err) {
    return { errors: messages(err) };
  }
  refresh();
  return { message: 'The standard wording is printed again, in English and Arabic.' };
}
