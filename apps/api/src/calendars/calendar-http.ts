import { Injectable } from '@nestjs/common';
import { CALENDAR_CHECK_MS } from '@trendlix/shared';
import type { MeetingFetch } from '../meetings/meeting-http.js';
import type { HttpAnswer, HttpRequest } from '../meetings/meeting-providers.js';

// How the system calls the calendars (owner, 25 October 2026: "Hours + calendar"; "its zoho mails"): Zoho Calendar,
// Google Calendar and Microsoft Graph, one request at a time, never following a redirect, the answer read as JSON. A
// busy-times read waits 5 seconds at most (the brief: "Live, with a 5-second limit"); a sign-in's code a little longer.
// No request or answer is ever logged: their headers and bodies carry the apps' secrets and the connections' tokens. The
// tests replace `fetch` with fake calendars (test/fake-calendars.ts), so no test ever calls Zoho, Google or Microsoft.

/** How long a sign-in's token exchange may take (not a live check: the person waits on the return page). */
export const CALENDAR_SIGN_IN_TIMEOUT_MS = 15_000;

@Injectable()
export class CalendarHttp {
  /** Replaced by the end-to-end tests with fake calendars; the real fetch otherwise. */
  fetch: MeetingFetch = (url, init) => fetch(url, init);

  /** The provider's answer, or null when it couldn't be reached (a network failure, or no answer in `timeoutMs`). */
  async send(req: HttpRequest, timeoutMs: number = CALENDAR_CHECK_MS): Promise<HttpAnswer | null> {
    let res: Response;
    try {
      res = await this.fetch(req.url, { method: req.method, headers: req.headers, body: req.body, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      return null;
    }
    let body: unknown = null;
    try {
      const text = await res.text();
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }
}
