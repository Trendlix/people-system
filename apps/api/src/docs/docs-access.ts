import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AuthService } from '../auth/auth.service.js';

// The API documentation behind a sign-in (owner, 31 October 2026: "Password-protected"): /api/docs and its pages ask
// the browser for a People email and password (HTTP Basic), of a Super Admin or a developer (AuthService.docsSignIn:
// the sign-in's own check and lockout, no session opened). A pair accepted is remembered for 10 minutes, by its hash
// only, so the page's files don't check the password again each; anything else is asked again.

const REMEMBER_MS = 10 * 60 * 1000;
const REALM = 'People System API docs (your People email and password: Super Admins and developers)';

/** The email and password a request's Basic header carries; null without one. */
export function basicCredentials(header: string | undefined): { email: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon <= 0) return null;
  return { email: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

/** The middleware in front of /api/docs. */
export function docsAccess(auth: Pick<AuthService, 'docsSignIn'>, now: () => number = Date.now) {
  const accepted = new Map<string, number>();
  const ask = (res: Response, message: string) => {
    res.setHeader('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(401).type('text').send(message);
  };
  return async (req: Request, res: Response, next: NextFunction) => {
    const given = basicCredentials(req.headers.authorization);
    if (!given) return ask(res, 'Sign in with your People email and password (Super Admins and developers).');
    const key = createHash('sha256').update(`${given.email.trim().toLowerCase()}\u0000${given.password}`).digest('hex');
    const until = accepted.get(key);
    if (until && until > now()) {
      res.setHeader('Cache-Control', 'no-store');
      return next();
    }
    accepted.delete(key);
    try {
      const user = await auth.docsSignIn(given.email, given.password);
      if (!user) return ask(res, 'That email and password aren’t a Super Admin’s or a developer’s.');
      accepted.set(key, now() + REMEMBER_MS);
      res.setHeader('Cache-Control', 'no-store');
      return next();
    } catch (e) {
      const status = (e as { getStatus?: () => number }).getStatus?.() ?? 500;
      return status === 429 ? res.status(429).type('text').send((e as Error).message) : ask(res, 'Sign in again.');
    }
  };
}
