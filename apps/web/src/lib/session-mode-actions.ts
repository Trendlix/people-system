'use server';

// A developer who is also an employee chooses how to use the system (owner, 22 October 2026: "when a developer signin,
// give hin a switched to use the account as the main role assigned to him or as a developer, to not confuse him"): the
// choice page's Continue and the top bar's switch. Each forwards to the API, which keeps the mode on the session (the
// same session: no new sign-in) and writes it to the audit log; then the home page opens, as that mode shows it.
import type { SessionMode } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from './api';
import { modeFrom } from './session-mode';

export type ModeResult = { error?: string };

async function send(mode: SessionMode): Promise<ModeResult> {
  try {
    await apiSend('POST', '/auth/mode', { mode });
  } catch (err) {
    if (err instanceof ApiError) return { error: err.messages.join(' ') };
    throw err;
  }
  return {};
}

/** The choice page: the mode chosen (one of the two cards), then the home page. */
export async function chooseMode(_prev: ModeResult, formData: FormData): Promise<ModeResult> {
  const mode = modeFrom(formData.get('mode'));
  if (!mode) return { error: 'Choose how you want to use the system.' };
  const result = await send(mode);
  if (result.error) return result;
  refresh();
  redirect('/');
}

/** The top bar's switch: the other mode at once, then its home page. */
export async function switchMode(mode: SessionMode): Promise<ModeResult> {
  if (!modeFrom(mode)) return { error: 'Choose how you want to use the system.' };
  const result = await send(mode);
  if (result.error) return result;
  refresh();
  redirect('/');
}
