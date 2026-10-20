'use server';

// The view-as switcher's actions (owner's decisions, 17 October 2026). Each forwards to the API, which alone decides:
// only a Super Admin in their own session switches, never to themself or a deactivated user; Act as them and going
// back only while switched. The new session the API signs is kept as the session cookie, as signing in does.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch, apiGet, messagesOf, signedOutPath } from './api';
import { keepSession } from './session-cookie';
import type { UserAccount } from './types';
import { viewAsChoices, type Session, type ViewAsChoice } from './view-as';

export type ViewAsResult = { error?: string };

/** Sends one of the switcher's requests and keeps the session it answers; the API's reasons when it refuses. */
async function send(path: string, body?: object): Promise<ViewAsResult> {
  let res: Response;
  try {
    res = await apiFetch(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (err) {
    if (err instanceof ApiError) return { error: err.messages.join(' ') };
    throw err;
  }
  if (res.status === 401) redirect(await signedOutPath(res));
  if (!res.ok) return { error: (await messagesOf(res)).join(' ') };
  if (!(await keepSession(res))) return { error: 'Switching failed. Please try again.' };
  return {};
}

/** The people the Super Admin can switch to: every active user but themself (GET /users, an Admin's list). */
export async function loadViewAsChoices(): Promise<{ choices?: ViewAsChoice[]; error?: string }> {
  try {
    const [me, users] = await Promise.all([apiGet<Session>('/auth/me'), apiGet<UserAccount[]>('/users')]);
    return { choices: viewAsChoices(users, me.id) };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.messages.join(' ') };
    throw err;
  }
}

/** Switches to the user, view only, and opens the home page: the page open may be one they can't see. */
export async function viewAs(userId: string): Promise<ViewAsResult> {
  const result = await send('/auth/view-as', { userId });
  if (result.error) return result;
  redirect('/');
}

/** Act as them on or off; the page stays, shown again as it now is. */
export async function setActing(act: boolean): Promise<ViewAsResult> {
  const result = await send('/auth/view-as/act', { act });
  if (!result.error) refresh();
  return result;
}

/** Back to the Super Admin's own account at once, on the home page. */
export async function backToMyAccount(): Promise<ViewAsResult> {
  const result = await send('/auth/view-as/stop');
  if (result.error) return result;
  redirect('/');
}
