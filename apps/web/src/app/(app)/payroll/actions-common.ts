import { refresh } from 'next/cache';
import { ApiError } from '@/lib/api';
import type { FormState } from '@/lib/types';

// What the Payroll pages' forms share (owner, 17 October 2026: Unsettled, Additions / Deductions): the API's messages
// with its dates as the screens show them, and a request whose change is shown in place.

export const UUID = /^[0-9a-f-]{36}$/i;

/** The API's messages, with its dates (YYYY-MM-DD) as the screens show them (DD/MM/YYYY). */
export function apiMessages(err: ApiError): string[] {
  // an API from before these pages answers "Cannot POST /api/…" for their addresses
  if (err.status === 404 && err.messages.some((m) => /^Cannot (GET|POST|PUT|PATCH|DELETE) /.test(m))) {
    return ['Not available yet: the server does not have this yet. Please try again after its next update.'];
  }
  return err.messages.map((m) => m.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1'));
}

/** Sends the request and shows the change in place (the page is rendered again). */
export async function sendAndRefresh(request: () => Promise<unknown>, message: string, values?: Record<string, string>): Promise<FormState> {
  try {
    await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: apiMessages(err), values };
    throw err;
  }
  refresh();
  return { message };
}

/** What was typed in a form, to keep it when the save is refused. */
export const typedValues = (fd: FormData, keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, String(fd.get(k) ?? '')]));
