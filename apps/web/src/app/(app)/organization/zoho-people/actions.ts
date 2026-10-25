'use server';

// Organization → Zoho People (owner, 25 October 2026: "can i fetch checkin and out transactions from zoho people through
// api?"; asked, "Yes, daily + backfill"; then "but can it fetch historical data?"): the page's forms, each forwarded to
// the API, which checks the session, who may (a Super Admin in their own session connects, tests and disconnects; HR and
// a Super Admin fetch and cancel) and every value again, so calling these directly bypasses nothing. The Zoho app's
// credentials are the calendars' (Organization → Calendars' saveZohoApp, shared). No token or secret ever comes back.
import type { ZohoPeopleTestView, ZohoPeopleView, ZohoRunView } from '@trendlix/shared';
import { headers } from 'next/headers';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import { originFromHeaders } from '@/lib/connector/site';
import type { FormState } from '@/lib/types';
import { zohoFetchBody, zohoTestBody } from '@/lib/zoho-people';
import { todayInCairo } from '@/lib/date-picker';

/** What the test form's action answers: its result, or why it couldn't run. */
export interface ZohoTestState extends FormState {
  test?: ZohoPeopleTestView;
}

/** The request's answer, or the API's refusal as the form's errors. */
async function refused<S extends FormState>(prev: S, request: () => Promise<S>): Promise<S> {
  try {
    return await request();
  } catch (err) {
    if (err instanceof ApiError) {
      return { ...prev, errors: err.status === 404 && err.messages.every((m) => /^Cannot /.test(m)) ? ['Not available yet: the server doesn’t fetch from Zoho People yet. Please try again after its next update.'] : err.messages, message: undefined };
    }
    throw err;
  }
}

/** POST /zoho-people/oauth/start: off to Zoho's sign-in (the API seals the state to this person and this site). */
export async function startZohoPeopleConnect(): Promise<FormState> {
  const origin = originFromHeaders(await headers());
  if (!origin) return { errors: ['The site’s address could not be read from the request. Please try again.'] };
  let start: { url: string } | undefined;
  try {
    start = await apiSend<{ url: string }>('POST', '/zoho-people/oauth/start', { origin });
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.status === 404 ? ['Not available yet: the server doesn’t fetch from Zoho People yet. Please try again after its next update.'] : err.messages };
    throw err;
  }
  // only Zoho's https sign-in page
  if (!start?.url || !/^https:\/\/[^\s]+$/i.test(start.url)) return { errors: ['The server didn’t say where to sign in. Please try again.'] };
  redirect(start.url);
}

/** POST /zoho-people/disconnect. */
export async function disconnectZohoPeople(prev: FormState): Promise<FormState> {
  return refused(prev, async () => {
    await apiSend<ZohoPeopleView>('POST', '/zoho-people/disconnect');
    refresh();
    return { message: 'Disconnected.' };
  });
}

/** POST /zoho-people/test: today's attendance read for the connected account (and a colleague), in counts. */
export async function testZohoPeople(prev: ZohoTestState, fd: FormData): Promise<ZohoTestState> {
  const { body, errors } = zohoTestBody(fd);
  if (!body) return { errors };
  return refused(prev, async () => {
    const test = await apiSend<ZohoPeopleTestView>('POST', '/zoho-people/test', body);
    refresh();
    return { test };
  });
}

/** POST /zoho-people/runs: a Fetch from Zoho for the days chosen, everyone or the people chosen; it runs in the background. */
export async function fetchFromZoho(prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = zohoFetchBody(fd, todayInCairo());
  const values = { from: String(fd.get('from') ?? ''), to: String(fd.get('to') ?? '') };
  if (!body) return { errors, values };
  const result = await refused<FormState>({ ...prev, values }, async () => {
    await apiSend<ZohoRunView>('POST', '/zoho-people/runs', body);
    refresh();
    return { message: 'Fetching from Zoho People: it goes on in the background, its progress below.' };
  });
  return result.errors ? { ...result, values } : result;
}

/** POST /zoho-people/runs/:id/cancel: the run stops after the call it is making. */
export async function cancelZohoRun(id: string, prev: FormState): Promise<FormState> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { errors: ['This fetch can’t be found. Reload the page.'] };
  return refused(prev, async () => {
    await apiSend<ZohoRunView>('POST', `/zoho-people/runs/${id}/cancel`);
    refresh();
    return { message: 'Cancelling: it stops after the call it is making.' };
  });
}
