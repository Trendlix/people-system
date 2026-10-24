'use server';

// Checking in on the system (owner, 19 October 2026: "Check-in through the system (phone or web with the office location
// check, or a device) to replace Zoho"): a press of Check in or Check out, passed on to the API with the caller's
// session (POST /me/attendance/punches): in or out, and the point the browser read or why there is none, never a time
// (the server's is the punch's). The API decides who checks in, reads the point against the office's and keeps it with
// the press (owner, 20 October 2026: "Yes, keep the spot"), and says what was kept; the page's data is read again after it, so My Attendance's days and the Dashboard follow. Inside
// the employee app the press also says whether the point is a mock one (fake GPS, Phase 2, 20 October 2026); an API
// from before it refuses that word, so the press goes again without it rather than not at all (the web and the API
// are deployed apart). The press carries the visitor's address as this website saw it, signed for the API (owner, 20
// October 2026: check-ins locked to the office network; lib/signed-ip.ts); refused off the network, `offNetwork` says
// so, and refused for having no location (the same day: "Company switch + exceptions"), `noLocation`, for the panel's
// link to ask for a correction.
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { PunchResultView } from '@/lib/attendance-types';
import { mockRefused, punchBodyFrom, punchErrors, withoutMock, type PunchBody } from './check-in';
import { locationLockRefused, noLocationRefused, offNetworkRefused, placeRefused } from './network-lock';

// The GPS lock (owner, 24 October 2026: "Yes, add a GPS lock too"): refused outside the check-in locations or on a reading
// too rough, `locationLock` says so for the correction's link; refused for where it was with a reading sent (outside them,
// or off the office network), `placeRefused` for "Request this place".
export async function punchAttendance(
  input: unknown,
): Promise<{ view: PunchResultView } | { errors: string[]; offNetwork?: boolean; noLocation?: boolean; locationLock?: boolean; placeRefused?: boolean }> {
  const body = punchBodyFrom(input);
  if (!body) return { errors: ['Choose to check in or check out.'] };
  const send = (b: PunchBody) => apiSend<PunchResultView>('POST', '/me/attendance/punches', b, { signIp: true });
  let view: PunchResultView | undefined;
  try {
    view = await send(body).catch((err: unknown) => {
      if (err instanceof ApiError && mockRefused(body, err.status, err.messages)) return send(withoutMock(body));
      throw err;
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return {
        errors: punchErrors(err.status, err.messages),
        ...(offNetworkRefused(err.status, err.messages) && { offNetwork: true }),
        ...(noLocationRefused(err.status, err.messages) && { noLocation: true }),
        ...(locationLockRefused(err.status, err.messages) && { locationLock: true }),
        ...(placeRefused(err.status, err.messages, 'latitude' in body) && { placeRefused: true }),
      };
    }
    throw err;
  }
  if (!view) return { errors: ['The server sent an answer that could not be read.'] };
  refresh();
  return { view };
}
