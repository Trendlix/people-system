'use server';

// Checking in on the system (owner, 19 October 2026: "Check-in through the system (phone or web with the office location
// check, or a device) to replace Zoho"): a press of Check in or Check out, passed on to the API with the caller's
// session (POST /me/attendance/punches): in or out, and the point the browser read or why there is none, never a time
// (the server's is the punch's). The API decides who checks in, reads the point against the office's and drops it, and
// says what was kept; the page's data is read again after it, so My Attendance's days and the Dashboard follow. Inside
// the employee app the press also says whether the point is a mock one (fake GPS, Phase 2, 20 October 2026); an API
// from before it refuses that word, so the press goes again without it rather than not at all (the web and the API
// are deployed apart).
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { PunchResultView } from '@/lib/attendance-types';
import { mockRefused, punchBodyFrom, punchErrors, withoutMock, type PunchBody } from './check-in';

export async function punchAttendance(input: unknown): Promise<{ view: PunchResultView } | { errors: string[] }> {
  const body = punchBodyFrom(input);
  if (!body) return { errors: ['Choose to check in or check out.'] };
  const send = (b: PunchBody) => apiSend<PunchResultView>('POST', '/me/attendance/punches', b);
  let view: PunchResultView | undefined;
  try {
    view = await send(body).catch((err: unknown) => {
      if (err instanceof ApiError && mockRefused(body, err.status, err.messages)) return send(withoutMock(body));
      throw err;
    });
  } catch (err) {
    if (err instanceof ApiError) return { errors: punchErrors(err.status, err.messages) };
    throw err;
  }
  if (!view) return { errors: ['The server sent an answer that could not be read.'] };
  refresh();
  return { view };
}
