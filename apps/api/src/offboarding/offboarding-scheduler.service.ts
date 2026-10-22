import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { toDateOnly, todayInCairo } from '../common/date-only.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OffboardingService } from './offboarding.service.js';

// Offboarding's round (owner, 22 October 2026: the full module): every few minutes the API disables the sign-in of those
// whose last working day has passed (once per ending: OffboardingService.closeSignIn), and tells HR of the open cases
// whose every item is now cleared, the two the system ticks included (once). One process at a time: a Postgres
// advisory lock held for the round, as the custody checks and the KPI clock do. Started by main.ts, so the tests' apps
// don't run it by themselves: they call runOnce.

const LOCK_NAME = 'people-system offboarding round';

/** How often the API looks, in minutes. */
export const OFFBOARDING_TICK_MINUTES = 15;

/** What a round did: the employments whose sign-in it disabled, and the cases HR was told are cleared. */
export interface OffboardingRound {
  signInsClosed: number;
  cleared: string[];
}

@Injectable()
export class OffboardingSchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger('OffboardingRound');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly offboarding: OffboardingService,
  ) {}

  /** Starts looking every few minutes (main.ts, once the API listens). The timer never keeps the process alive. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), OFFBOARDING_TICK_MINUTES * 60_000);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One round, unless the last is still going. Never throws. */
  async tick(now = new Date()): Promise<OffboardingRound | null> {
    if (this.running) return null;
    this.running = true;
    try {
      return await this.runOnce(now);
    } catch (err) {
      this.logger.error(`The offboarding round could not run: ${(err as Error).message}`);
      return null;
    } finally {
      this.running = false;
    }
  }

  /**
   * One round at `now`; null when another process is starting one. The lock only keeps two rounds from starting
   * together: each step claims its row itself (closeSignIn and tellClearedIfDone change a row only while it is
   * unclaimed), so nothing goes twice whichever process sends it.
   */
  async runOnce(now = new Date()): Promise<OffboardingRound | null> {
    const today = todayInCairo();
    const ended = await this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_NAME})) AS locked`;
      if (!lock?.locked) return null;
      return tx.employment.findMany({ where: { signInClosedAt: null, endDate: { lt: toDateOnly(today) } }, select: { id: true } });
    });
    if (!ended) return null;
    let signInsClosed = 0;
    for (const e of ended) if (await this.offboarding.closeSignIn(e.id, now)) signInsClosed++;
    const cleared: string[] = [];
    for (const id of await this.offboarding.openIds()) if (await this.offboarding.tellClearedIfDone(id)) cleared.push(id);
    if (signInsClosed || cleared.length) this.logger.log(`Offboarding: ${signInsClosed} sign-in(s) disabled, ${cleared.length} case(s) cleared.`);
    return { signInsClosed, cleared };
  }
}
