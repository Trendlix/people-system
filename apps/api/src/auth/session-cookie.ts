import type { Response } from 'express';
import { SESSION_COOKIE } from './session-user.js';

/** Sets the session cookie, as signing in does, for `maxAgeMs` (the session's time left). */
export function setSessionCookie(res: Response, token: string, maxAgeMs: number): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeMs,
  });
}
