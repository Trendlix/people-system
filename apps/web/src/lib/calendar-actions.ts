'use server';

// Starting a calendar connection for busy times (owner, 25 October 2026: "Hours + calendar"; "its zoho mails": the
// company's Zoho account, connected once by a Super Admin on Organization → Calendars, and each person's own Zoho,
// Google or Microsoft calendar on Your Interview Hours). The API checks who may start it, seals the state (bound to this
// person, the provider and the website's return address) and answers the provider's sign-in page; the browser goes
// there, and comes back to /calendars/oauth/<provider>. The website's own origin is read from the request, as the
// meetings' is, so the return address is this site's.
import { isCalendarProvider, isMeetingOwner, type CalendarConnectStart } from '@trendlix/shared';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from './api';
import { originFromHeaders } from './connector/site';
import type { FormState } from './types';

/** Bound to a provider and whose (the company's or one's own), as a form's action: its errors, or off to the sign-in. */
export async function startCalendarConnect(provider: string, owner: string): Promise<FormState> {
  if (!isCalendarProvider(provider) || !isMeetingOwner(owner)) return { errors: ['Choose what to connect.'] };
  const origin = originFromHeaders(await headers());
  if (!origin) return { errors: ['The site’s address could not be read from the request. Please try again.'] };
  let start: CalendarConnectStart | undefined;
  try {
    start = await apiSend<CalendarConnectStart>('POST', '/calendars/oauth/start', { provider, owner, origin });
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.status === 404 ? ['Not available yet: the server doesn’t read calendars yet. Please try again after its next update.'] : err.messages };
    throw err;
  }
  // only a provider's https sign-in page
  if (!start?.url || !/^https:\/\/[^\s]+$/i.test(start.url)) return { errors: ['The server didn’t say where to sign in. Please try again.'] };
  redirect(start.url);
}
