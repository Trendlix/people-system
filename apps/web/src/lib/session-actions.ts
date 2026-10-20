'use server';

// The session's own actions (owner, 20 October 2026: sessions kept on the server; HR, Admin and Super Admin signed out
// after 15 minutes without activity; one session on the website and one in the app a user). The idle warning asks how
// long the session has left without counting as activity, and Stay signed in asks the same as a real request; once the
// API says the session has ended, the cookie goes and the sign-in page says why. Your Sessions signs out another of
// one's sessions. The API alone decides; these only forward.
import { refresh } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect, RedirectType } from 'next/navigation';
import { ApiError, apiFetch, apiSend } from './api';
import { SESSION_COOKIE } from './constants';
import type { SessionCheck } from './idle-watch';
import { reasonOf, signInPath } from './signed-out';

/** GET /auth/session: as a background request (the warning's checks) or one that counts (Stay signed in). */
async function askSession(background: boolean): Promise<SessionCheck> {
  let res: Response;
  try {
    res = await apiFetch('/auth/session', undefined, { background });
  } catch (err) {
    if (err instanceof ApiError) return { status: 'unknown' };
    throw err;
  }
  if (res.status === 401) {
    const reason = reasonOf(await res.json().catch(() => null)) ?? 'ended';
    (await cookies()).delete(SESSION_COOKIE);
    redirect(signInPath(reason), RedirectType.replace);
  }
  if (!res.ok) return { status: 'unknown' };
  try {
    const body = (await res.json()) as { idleMsLeft?: number | null };
    return { status: 'active', idleMsLeft: typeof body.idleMsLeft === 'number' ? body.idleMsLeft : null };
  } catch {
    return { status: 'unknown' };
  }
}

/** The idle warning's check: how long is left, not counted as activity; the sign-in page once the session has ended. */
export async function checkSession(): Promise<SessionCheck> {
  return askSession(true);
}

/** Stay signed in: a request that counts as activity, so the 15 minutes start again. */
export async function staySignedIn(): Promise<SessionCheck> {
  return askSession(false);
}

/** Your Sessions: Sign out beside another of one's own sessions (the website or the app on another device). */
export async function signOutSession(id: string): Promise<{ error?: string }> {
  try {
    await apiSend('POST', `/auth/sessions/${encodeURIComponent(id)}/end`);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.messages.join(' ') };
    throw err;
  }
  refresh();
  return {};
}
