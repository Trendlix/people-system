import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ZohoPeopleSyncService } from './zoho-people-sync.service.js';

// Zoho People's clock (owner, 25 October 2026: "every night it pulls yesterday's check-ins and check-outs for everyone
// automatically"): every minute the API takes on a fetch going with no process (the API restarted: it goes on from where
// it got to), and from 02:00 Cairo starts the night's fetch of yesterday once (the run's nightly_for keeps it to one a
// day, whichever process starts it). Started by main.ts, so the tests' apps don't run it by themselves: they call tick
// with a moment of their own.

/** How often the API looks, in minutes. */
export const ZOHO_PEOPLE_TICK_MINUTES = 1;

@Injectable()
export class ZohoPeopleSchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger('ZohoPeopleScheduler');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly sync: ZohoPeopleSyncService) {}

  /** Starts looking every minute (main.ts, once the API listens). The timer never keeps the process alive. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), ZOHO_PEOPLE_TICK_MINUTES * 60_000);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One round, unless the last is still going: the runs left without a process taken on, the night's run started. Never throws. */
  async tick(now: Date = new Date()): Promise<{ resumed: string[]; nightly: string | null } | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const resumed = await this.sync.resumeStale(now);
      const nightly = await this.sync.nightlyIfDue(now);
      if (resumed.length || nightly) this.logger.log(`Zoho People: ${resumed.length} fetch(es) taken on again${nightly ? ', the night’s fetch started' : ''}.`);
      return { resumed, nightly };
    } catch (err) {
      this.logger.error(`Zoho People's round could not run: ${(err as Error).message}`);
      return null;
    } finally {
      this.running = false;
    }
  }
}
