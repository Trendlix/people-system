import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, SESSION_HOURS } from './constants';
import { sessionCookieFrom } from './view-as';

/**
 * Keeps the session an API response set, on the web domain, for as long as the API says: signing in, and the view-as
 * switcher (switching, Act as them, going back), whose sessions end when the one from signing in does. False when the
 * response set none.
 */
export async function keepSession(res: Response): Promise<boolean> {
  const set = sessionCookieFrom(res.headers.getSetCookie(), SESSION_COOKIE);
  if (!set) return false;
  (await cookies()).set(SESSION_COOKIE, set.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: set.maxAge ?? SESSION_HOURS * 60 * 60,
  });
  return true;
}
