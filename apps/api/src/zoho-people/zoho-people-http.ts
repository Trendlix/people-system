import { Injectable } from '@nestjs/common';
import { ZOHO_PEOPLE_CALLS_PER_MINUTE } from '@trendlix/shared';
import type { MeetingFetch } from '../meetings/meeting-http.js';
import type { HttpAnswer, HttpRequest } from '../meetings/meeting-providers.js';

// How the system calls Zoho People (owner, 25 October 2026: "Yes, daily + backfill"; the brief: "respecting Zoho's rate
// limit"): one request at a time, never following a redirect, the answer read as JSON, 20 seconds at most. Every call
// to Zoho People's API takes its turn: one a second at most (60 a minute, well under Zoho's 100), whoever asks (the
// nightly run, HR's fetch, a Super Admin's test); a lock answer moves everyone's next turn past Zoho's lock. Zoho
// Accounts' sign-in and token calls don't take a turn (they aren't Zoho People's, and are few: a token lasts an hour).
// No request or answer is ever logged: their headers carry the connection's token. The clock is replaceable: the tests
// put a clock of their own in (its sleep moves its time on at once), so a test of the spacing and the lock takes no
// time, and replace `fetch` with a fake Zoho (test/fake-zoho-people.ts): no test ever calls Zoho.

/** How long one call may take. */
export const ZOHO_PEOPLE_TIMEOUT_MS = 20_000;

/** The time between two calls to Zoho People, in milliseconds. */
export const ZOHO_PEOPLE_SPACING_MS = Math.ceil(60_000 / ZOHO_PEOPLE_CALLS_PER_MINUTE);

/** The clock calls are spaced by: now in milliseconds, and a wait. */
export interface ZohoClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const REAL_CLOCK: ZohoClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)).unref()),
};

@Injectable()
export class ZohoPeopleHttp {
  /** Replaced by the end-to-end tests with a fake Zoho; the real fetch otherwise. */
  fetch: MeetingFetch = (url, init) => fetch(url, init);
  /** Replaced by the end-to-end tests with a clock of their own. */
  clock: ZohoClock = REAL_CLOCK;
  /** When the next call to Zoho People may go, on the clock. */
  private nextAt = 0;
  /** The calls in turn, one after another. */
  private queue: Promise<void> = Promise.resolve();

  /** The answer, or null when Zoho couldn't be reached (a network failure, or no answer in time). */
  async send(req: HttpRequest, timeoutMs: number = ZOHO_PEOPLE_TIMEOUT_MS): Promise<HttpAnswer | null> {
    let res: Response;
    try {
      res = await this.fetch(req.url, { method: req.method, headers: req.headers, body: req.body, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      return null;
    }
    let body: unknown = null;
    try {
      const raw = await res.text();
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  /** A call to Zoho People's API in its turn: at most one a second, after any lock Zoho asked for. */
  async call(req: HttpRequest): Promise<HttpAnswer | null> {
    const turn = this.queue.then(async () => {
      const now = this.clock.now();
      const at = Math.max(now, this.nextAt);
      this.nextAt = at + ZOHO_PEOPLE_SPACING_MS;
      if (at > now) await this.clock.sleep(at - now);
    });
    this.queue = turn.catch(() => undefined);
    await turn;
    return this.send(req);
  }

  /** Zoho asked to wait (its lock): no call goes before `until` (on the clock). */
  holdUntil(until: number): void {
    this.nextAt = Math.max(this.nextAt, until);
  }

  /** When the next call may go, on the clock (for the page's "going on at"). */
  get nextCallAt(): number {
    return this.nextAt;
  }

  /** Forgets the turns (the tests, between their cases). */
  reset(): void {
    this.nextAt = 0;
    this.queue = Promise.resolve();
  }
}
