import { Injectable } from '@nestjs/common';
import type { GraphAnswer, GraphRequest } from './graph.js';

// How the system calls Meta's Graph API (owner, 24 October 2026: "Directly to Meta"): one request at a time, 15 seconds
// at most, never following a redirect, the answer read as JSON. No request or answer is ever logged: the headers carry
// the access token, the bodies people's numbers. The end-to-end tests replace `fetch` with a fake Graph API
// (test/fake-whatsapp.ts), as the meetings' do: no test ever calls Meta.

/** How long Meta may take to answer. */
export const WHATSAPP_HTTP_TIMEOUT_MS = 15_000;

/** The fetch the requests go through: the real one, or a test's fake. */
export type WhatsAppFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; redirect: 'error'; signal: AbortSignal }) => Promise<Response>;

@Injectable()
export class WhatsAppHttp {
  /** Replaced by the end-to-end tests with a fake Graph API; the real fetch otherwise. */
  fetch: WhatsAppFetch = (url, init) => fetch(url, init);

  /** Meta's answer, or null when it couldn't be reached (a network failure, or no answer within 15 seconds). */
  async send(req: GraphRequest): Promise<GraphAnswer | null> {
    let res: Response;
    try {
      res = await this.fetch(req.url, { method: req.method, headers: req.headers, body: req.body, redirect: 'error', signal: AbortSignal.timeout(WHATSAPP_HTTP_TIMEOUT_MS) });
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
