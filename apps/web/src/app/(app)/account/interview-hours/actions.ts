'use server';

// Your Interview Hours (owner, 25 October 2026: "Hours + calendar": each interviewer sets weekly interview hours once,
// on their own Account page, and may connect a calendar for its busy times): saving the hours, and Disconnect and Check
// the busy times of their own calendar, forwarded to the API, which checks it is their own session and every value
// again, so calling these directly bypasses nothing. Connecting is lib/calendar-actions.ts startCalendarConnect.
import { isCalendarProvider, type CalendarTestView, type MyCalendarsView, type MyInterviewHoursView } from '@trendlix/shared';
import { refresh } from 'next/cache';
import type { CalendarTestState } from '@/components/calendar-connections';
import { ApiError, apiSend } from '@/lib/api';
import { hoursFormBody, savedHoursText } from '@/lib/interview-hours';
import type { FormState } from '@/lib/types';

const OLDER_API = 'Not available yet: the server doesn’t keep interview hours yet. Please try again after its next update.';

/** PUT /me/interview-hours: an empty week and no one-off changes clears them. */
export async function saveMyInterviewHours(_prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = hoursFormBody(fd);
  if (!body) return { errors };
  let saved: MyInterviewHoursView | undefined;
  try {
    saved = await apiSend<MyInterviewHoursView>('PUT', '/me/interview-hours', body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.status === 404 && err.messages.every((m) => /^Cannot |^Request failed/.test(m)) ? [OLDER_API] : err.messages };
    throw err;
  }
  refresh();
  return { message: savedHoursText(saved ? saved.hours : body) };
}

/** POST /calendars/mine/:provider/disconnect. */
export async function disconnectMyCalendar(provider: string): Promise<FormState> {
  if (!isCalendarProvider(provider)) return { errors: ['Choose a calendar.'] };
  try {
    await apiSend<MyCalendarsView>('POST', `/calendars/mine/${encodeURIComponent(provider)}/disconnect`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  return { message: 'Disconnected.' };
}

/** POST /calendars/mine/:provider/test: their busy times read now, how many said (never what they are). */
export async function testMyCalendar(provider: string, prev: CalendarTestState): Promise<CalendarTestState> {
  if (!isCalendarProvider(provider)) return { errors: ['Choose a calendar.'] };
  try {
    const test = await apiSend<CalendarTestView>('POST', `/calendars/mine/${encodeURIComponent(provider)}/test`);
    refresh();
    return { test };
  } catch (err) {
    if (err instanceof ApiError) return { ...prev, errors: err.messages };
    throw err;
  }
}
