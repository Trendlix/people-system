import { Injectable, Logger } from '@nestjs/common';
import { APP_RELEASES_URL, latestFromRelease, UNKNOWN_APP, type LatestApp } from './app-releases.js';

/** How long an answer from GitHub is kept: every phone asks on opening, GitHub allows 60 asks an hour without a key. */
const KEEP_MS = 5 * 60_000;
/** After GitHub couldn't be reached, how long before asking again (the last answer known is given meanwhile). */
const RETRY_MS = 60_000;
const TIMEOUT_MS = 5_000;

/**
 * The app's newest build (app-releases.ts), read from the repository's latest release and kept a few minutes. When
 * GitHub can't be reached, the last answer known, or none: a phone is never held back by GitHub being down.
 */
@Injectable()
export class AppReleasesService {
  private readonly log = new Logger(AppReleasesService.name);
  private kept: { value: LatestApp; until: number } | null = null;
  private asking: Promise<LatestApp> | null = null;

  async latest(now = Date.now()): Promise<LatestApp> {
    if (this.kept && now < this.kept.until) return this.kept.value;
    this.asking ??= this.ask(now).finally(() => (this.asking = null));
    return this.asking;
  }

  private async ask(now: number): Promise<LatestApp> {
    const before = this.kept?.value ?? UNKNOWN_APP;
    try {
      const res = await fetch(APP_RELEASES_URL, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'trendlix-people-api' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // 404: no release yet
      if (res.status === 404) return this.keep(UNKNOWN_APP, now + KEEP_MS);
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      const latest = latestFromRelease(await res.json());
      return this.keep(latest ?? before, now + KEEP_MS);
    } catch (e) {
      this.log.warn(`The app's latest release could not be read: ${e instanceof Error ? e.message : String(e)}`);
      return this.keep(before, now + RETRY_MS);
    }
  }

  private keep(value: LatestApp, until: number): LatestApp {
    this.kept = { value, until };
    return value;
  }
}
