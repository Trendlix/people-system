import 'server-only';
import { ApiError, apiFetch } from '@/lib/api';
import type { SessionUser } from '@/lib/types';

// Who follows endings and contracts, who decides employees' change requests, and reading what may fail quietly. Used by
// Approvals, the home page's contract and probation cards, and the count beside Approvals in the sidebar.

/** HR and the CEO see the endings waiting for the CEO, and contracts and probation ending soon. The API checks this again. */
export function followsEndings(user: Pick<SessionUser, 'roles'>): boolean {
  return user.roles.some((r) => r === 'hr' || r === 'ceo');
}

/** Only the CEO approves or rejects an ending, after HR has recorded and approved it. The API checks this again. */
export function decidesEndings(user: Pick<SessionUser, 'roles'>): boolean {
  return user.roles.includes('ceo');
}

/** The endings HR has recorded and approved, waiting for the CEO. */
export const PENDING_ENDINGS = '/endings?status=pending_ceo';

/**
 * HR and Admin approve or reject employees' requests to change their details (owner's decision, 15 October 2026); the
 * CEO doesn't. The API checks this again.
 */
export function decidesChangeRequests(user: Pick<SessionUser, 'roles'>): boolean {
  return user.roles.some((r) => r === 'hr' || r === 'admin');
}

/** The employees' change requests waiting for HR or an Admin, newest first. */
export const PENDING_CHANGE_REQUESTS = '/change-requests?status=pending';

/**
 * A GET whose failure must not take the page down (the home page's cards, the sidebar's count): null when the API
 * refuses, can't be reached or doesn't have the endpoint yet, where `apiGet` would show the error or 404 page.
 */
export async function getOrNull<T>(path: string): Promise<T | null> {
  try {
    const res = await apiFetch(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError || err instanceof SyntaxError) return null;
    throw err;
  }
}
