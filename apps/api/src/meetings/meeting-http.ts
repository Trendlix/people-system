import { Injectable } from '@nestjs/common';
import type { HttpAnswer, HttpRequest } from './meeting-providers.js';

// How the system calls the meeting providers (owner, 24 October 2026: "Google Meet, Microsoft Teams, Zoom"): one request
// at a time, 15 seconds at most, never following a redirect, the answer read as JSON. No request or answer is ever
// logged: their headers and bodies carry the apps' secrets and the connections' tokens. The tests replace `fetch` with a
// fake provider (meetings.e2e-spec.ts), so no test ever calls Google, Microsoft or Zoom.

/** How long a provider may take to answer. */
export const MEETING_HTTP_TIMEOUT_MS = 15_000;

/** The fetch the requests go through: the real one, or a test's fake. */
export type MeetingFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; redirect: 'error'; signal: AbortSignal }) => Promise<Response>;

@Injectable()
export class MeetingHttp {
  /** Replaced by the end-to-end tests with a fake provider; the real fetch otherwise. */
  fetch: MeetingFetch = (url, init) => fetch(url, init);

  /** The provider's answer, or null when it couldn't be reached (a network failure or no answer within 15 seconds). */
  async send(req: HttpRequest): Promise<HttpAnswer | null> {
    let res: Response;
    try {
      res = await this.fetch(req.url, { method: req.method, headers: req.headers, body: req.body, redirect: 'error', signal: AbortSignal.timeout(MEETING_HTTP_TIMEOUT_MS) });
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
