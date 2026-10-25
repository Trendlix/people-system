'use server';

// Organization → Calendars (owner, 25 October 2026: "its zoho mails"): the page's forms, each forwarded to the API, which
// checks the session, that it is a Super Admin in their own session, and every value again, so calling these directly
// bypasses nothing. A secret typed is sent on to the API once and never comes back: the answers carry whether one is
// saved, never its value. Connecting the company's Zoho account is lib/calendar-actions.ts startCalendarConnect.
import type { CalendarSettingsView, CalendarTestView } from '@trendlix/shared';
import { refresh } from 'next/cache';
import type { CalendarTestState } from '@/components/calendar-connections';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { testBody, zohoAppBody, type CalendarAppState } from './setup';

/** The request's answer, or the API's refusal as the form's errors. */
async function refused<S extends FormState>(prev: S, request: () => Promise<S>): Promise<S> {
  try {
    return await request();
  } catch (err) {
    if (err instanceof ApiError) return { ...prev, errors: err.messages, message: undefined };
    throw err;
  }
}

/** PUT /calendars/apps/zoho: an empty secret box keeps the saved secret. */
export async function saveZohoApp(prev: CalendarAppState, fd: FormData): Promise<CalendarAppState> {
  const { body, errors } = zohoAppBody(fd);
  if (errors.length) return { errors, saved: prev.saved };
  return refused(prev, async () => {
    await apiSend<CalendarSettingsView>('PUT', '/calendars/apps/zoho', body);
    refresh();
    return { message: 'Saved.', saved: (prev.saved ?? 0) + 1 };
  });
}

/** POST /calendars/company/zoho/disconnect. */
export async function disconnectCompanyZoho(prev: FormState): Promise<FormState> {
  return refused(prev, async () => {
    await apiSend<CalendarSettingsView>('POST', '/calendars/company/zoho/disconnect');
    refresh();
    return { message: 'Disconnected.' };
  });
}

/** POST /calendars/company/zoho/test: busy times read now (the account's own, or a colleague's), how many said. */
export async function testCompanyZoho(prev: CalendarTestState, fd: FormData): Promise<CalendarTestState> {
  const { body, errors } = testBody(fd);
  if (!body) return { errors };
  return refused(prev, async () => {
    const test = await apiSend<CalendarTestView>('POST', '/calendars/company/zoho/test', body);
    refresh();
    return { test };
  });
}
