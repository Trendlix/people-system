import { CanActivate, ExecutionContext, HttpException, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { answeredWhenOutdated, APP_STORE_LOOKUP_URL, fromIphoneApp, iosLatestFromLookup, NO_IOS_LATEST, outdatedIphone, type IosLatest } from './app-store.js';

/** How long Apple's answer is kept: every iPhone request asks it. */
const KEEP_MS = 15 * 60_000;
/** After Apple couldn't be reached, how long before asking again (the last answer known is given meanwhile). */
const RETRY_MS = 60_000;
const TIMEOUT_MS = 5_000;

/**
 * The App Store's version of the app (app-store.ts), read from Apple's lookup and kept a few minutes. When Apple can't
 * be reached, the last answer known, or none: an iPhone is never held back by Apple being down.
 */
@Injectable()
export class AppStoreService {
  private readonly log = new Logger(AppStoreService.name);
  private kept: { value: IosLatest; until: number } | null = null;
  private asking: Promise<IosLatest> | null = null;

  async latest(now = Date.now()): Promise<IosLatest> {
    if (this.kept && now < this.kept.until) return this.kept.value;
    this.asking ??= this.ask(now).finally(() => (this.asking = null));
    return this.asking;
  }

  private async ask(now: number): Promise<IosLatest> {
    const before = this.kept?.value ?? NO_IOS_LATEST;
    try {
      const res = await fetch(APP_STORE_LOOKUP_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Apple answered ${res.status}`);
      return this.keep(iosLatestFromLookup(await res.json()), now + KEEP_MS);
    } catch (e) {
      this.log.warn(`The App Store's version could not be read: ${e instanceof Error ? e.message : String(e)}`);
      return this.keep(before, now + RETRY_MS);
    }
  }

  private keep(value: IosLatest, until: number): IosLatest {
    this.kept = { value, until };
    return value;
  }
}

/**
 * Every request from an iPhone build older than the App Store's refused (426) with words saying to update (owner, 10
 * November 2026: "make the update force to all builds"): a build without the app's own gate shows them on its start or
 * sign-in screen. Only the iPhone app's requests are looked at (Apple asked only for them); never this one's answers.
 */
@Injectable()
export class OutdatedIphoneGuard implements CanActivate {
  constructor(private readonly store: AppStoreService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    const userAgent = req.headers['user-agent'];
    if (!fromIphoneApp(userAgent) || answeredWhenOutdated(req.originalUrl ?? req.url)) return true;
    const why = outdatedIphone(userAgent, await this.store.latest());
    if (why) throw new HttpException({ statusCode: 426, message: [why], error: 'Upgrade Required' }, 426);
    return true;
  }
}
