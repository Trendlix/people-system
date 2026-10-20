import { cookies } from 'next/headers';
import { ApiError, apiFetch } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/constants';
import { reasonOf, signedOutNotice } from '@/lib/signed-out';

/**
 * Why the person was signed out (owner, 20 October 2026: sessions kept on the server): "You were signed out after 15
 * minutes without activity.", "… because you signed in on another device.", or "Your session ended.". From the page's
 * ?reason= when a request sent them here with it; else, when the browser still holds the session that was refused, the
 * API says why it ended (asked as a background request, so it never counts as activity). Nothing for a plain visit.
 */
export async function SignedOutNotice({ searchParams }: { searchParams: Promise<{ reason?: string | string[] }> }) {
  const { reason } = await searchParams;
  let notice = signedOutNotice(reason);
  if (!notice && (await cookies()).has(SESSION_COOKIE)) notice = await whyEnded();
  if (!notice) return null;
  return (
    <p role="status" className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
      {notice}
    </p>
  );
}

/** What the API says of the session the browser holds: why it ended, or null while it is still open. */
async function whyEnded(): Promise<string | null> {
  try {
    const res = await apiFetch('/auth/session', undefined, { background: true });
    if (res.status !== 401) return null;
    return signedOutNotice(reasonOf(await res.json().catch(() => null)));
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}
