'use server';

// Starting a meetings connection (owner, 24 October 2026: "make it both": the company's Google account, connected once by
// a Super Admin on Organization → Meetings, and each HR person's own on Your Meetings). The API checks who may start it,
// seals the state (bound to this person, the provider and the website's return address) and answers the provider's
// sign-in page; the browser goes there, and comes back to /meetings/oauth/<provider>. The website's own origin is read
// from the request, as the Claude connector's is, so the return address is this site's.
import { isMeetingOwner, isMeetingProvider, type MeetingConnectStart } from '@trendlix/shared';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from './api';
import { originFromHeaders } from './connector/site';
import type { FormState } from './types';

/** Bound to a provider and whose (the company's or one's own), as a form's action: its errors, or off to the sign-in. */
export async function startMeetingConnect(provider: string, owner: string): Promise<FormState> {
  if (!isMeetingProvider(provider) || !isMeetingOwner(owner)) return { errors: ['Choose what to connect.'] };
  const origin = originFromHeaders(await headers());
  if (!origin) return { errors: ['The site’s address could not be read from the request. Please try again.'] };
  let start: MeetingConnectStart | undefined;
  try {
    start = await apiSend<MeetingConnectStart>('POST', '/meetings/oauth/start', { provider, owner, origin });
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.status === 404 ? ['Not available yet: the server doesn’t make meetings yet. Please try again after its next update.'] : err.messages };
    throw err;
  }
  // only a provider's https sign-in page
  if (!start?.url || !/^https:\/\/[^\s]+$/i.test(start.url)) return { errors: ['The server didn’t say where to sign in. Please try again.'] };
  redirect(start.url);
}
