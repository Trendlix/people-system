'use server';

// Checking in on the system (owner, 19 October 2026: "Check-in through the system (phone or web with the office location
// check, or a device) to replace Zoho"): a press of Check in or Check out, passed on to the API with the caller's
// session (POST /me/attendance/punches): in or out, and the point the browser read or why there is none, never a time
// (the server's is the punch's). The API decides who checks in, reads the point against the office's and drops it, and
// says what was kept; the page's data is read again after it, so My Attendance's days and the Dashboard follow.
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { PunchResultView } from '@/lib/attendance-types';
import { punchBodyFrom, punchErrors } from './check-in';

export async function punchAttendance(input: unknown): Promise<{ view: PunchResultView } | { errors: string[] }> {
  const body = punchBodyFrom(input);
  if (!body) return { errors: ['Choose to check in or check out.'] };
  let view: PunchResultView | undefined;
  try {
    view = await apiSend<PunchResultView>('POST', '/me/attendance/punches', body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: punchErrors(err.status, err.messages) };
    throw err;
  }
  if (!view) return { errors: ['The server sent an answer that could not be read.'] };
  refresh();
  return { view };
}
