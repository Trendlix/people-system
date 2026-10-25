import { Injectable } from '@nestjs/common';

// How the system calls LinkedIn for "Fill in with LinkedIn" (owner, 25 October 2026: "can i use linkedin to complete the
// data?"): only LinkedIn's own two addresses (the code traded for tokens, then /v2/userinfo), one request at a time, 10
// seconds at most, never following a redirect, the answer read as JSON. No request or answer is ever logged: they carry
// the app's secret and the person's tokens. Never an address a person typed. The tests replace `fetch` with a fake
// LinkedIn (careers-prefill.e2e-spec.ts), so no test ever calls LinkedIn.

export const LINKEDIN_HTTP_TIMEOUT_MS = 10_000;

/** The fetch the requests go through: the real one, or a test's fake. */
export type LinkedInFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; redirect: 'error'; signal: AbortSignal }) => Promise<Response>;

/** LinkedIn's answer: its status and its body read as JSON (null when it isn't JSON). */
export interface LinkedInAnswer {
  status: number;
  body: unknown;
}

@Injectable()
export class LinkedInHttp {
  /** Replaced by the end-to-end tests with a fake LinkedIn; the real fetch otherwise. */
  fetch: LinkedInFetch = (url, init) => fetch(url, init);

  /** LinkedIn's answer, or null when it couldn't be reached (a network failure, or no answer within 10 seconds). */
  async send(req: { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }): Promise<LinkedInAnswer | null> {
    let res: Response;
    try {
      res = await this.fetch(req.url, { method: req.method, headers: req.headers, body: req.body, redirect: 'error', signal: AbortSignal.timeout(LINKEDIN_HTTP_TIMEOUT_MS) });
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
