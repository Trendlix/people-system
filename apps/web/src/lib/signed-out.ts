import { isSignedOutReason, signedOutMessage, type SignedOutReason } from '@trendlix/shared';

// Why someone was signed out, on the sign-in page (owner, 20 October 2026: sessions kept on the server; HR, Admin and
// Super Admin signed out after 15 minutes without activity; a second sign-in of the same kind ends the older one). The
// API refuses a request whose session has ended with a 401 that says why (`reason`); the web goes to the sign-in page
// with it, which says it in words. Pure code (no server-only, no "@/" imports): tested.

/** The reason a 401's body gives (the API's `reason`), or null for any other refusal (no session, a token not its own). */
export function reasonOf(body: unknown): SignedOutReason | null {
  const reason = body && typeof body === 'object' ? (body as { reason?: unknown }).reason : undefined;
  return isSignedOutReason(reason) ? reason : null;
}

/** The sign-in page, saying why when there is a reason. */
export function signInPath(reason: SignedOutReason | null): string {
  return reason ? `/login?reason=${reason}` : '/login';
}

/** The sign-in page's notice for its ?reason= (only the API's reasons: anything else shows nothing). */
export function signedOutNotice(reason: unknown): string | null {
  return isSignedOutReason(reason) ? signedOutMessage(reason) : null;
}
