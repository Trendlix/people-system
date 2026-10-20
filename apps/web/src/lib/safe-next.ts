// Where the sign-in page sends someone once signed in (with the password, or with the fingerprint in the app: owner,
// 20 October 2026, README: "Sign-in: Face ID / fingerprint after the first password sign-in"): back to the page they
// came from, `next`, when it is one of this site's own; else `home`. Its own module, as a "use server" file exports only
// async functions; pure code (no "@/" imports): tested.

/**
 * Only same-site paths, so the sign-in page can't be used to send people elsewhere: a path from the root, not one a
 * browser reads as another host ("//host", "/\host"), and not the sign-in page itself; else `home`.
 */
export function safeNext(value: unknown, home: string): string {
  const next = typeof value === 'string' ? value : '';
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') && !next.startsWith('/login') ? next : home;
}
