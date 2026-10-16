import 'server-only';
import { refresh } from 'next/cache';
import { ApiError } from '@/lib/api';
import type { FormState } from '@/lib/types';

// What Payroll Setup's and the Holidays tab's form actions answer with: the API's refusal as the form's errors, with
// what was typed, or a message once saved (and the page refreshed).

/** The submitted values, so the form can be refilled after an error. */
export function submitted(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of fd) if (!key.startsWith('$ACTION') && typeof value === 'string') out[key] = value;
  return out;
}

/** The API's messages, with its dates (YYYY-MM-DD) as the screens show them (DD/MM/YYYY). */
export const shown = (messages: readonly string[]) => messages.map((m) => m.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1'));

/** Sends one request; the API's refusal comes back as the form's errors, with what was typed. */
export async function send(request: () => Promise<unknown>, fd: FormData | null, message: string): Promise<FormState> {
  try {
    await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values: fd ? submitted(fd) : undefined };
    throw err;
  }
  refresh();
  return { message };
}
