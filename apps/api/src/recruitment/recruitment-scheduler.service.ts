import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { InterviewsService } from './interviews.service.js';

// Recruitment's round (Phase 2, owner, 22 October 2026; the brief: "a reminder notification the day after an interview
// without feedback"): every hour the API reminds each interviewer of a scorecard not given the day after their interview
// (once each: InterviewsService.remindFeedback claims each row). One process at a time: a Postgres advisory lock held to
// start the round, as offboarding's and the custody checks do. Started by main.ts, so the tests' apps don't run it by
// themselves: they call runOnce.

const LOCK_NAME = 'people-system recruitment round';

/** How often the API looks, in minutes. */
export const RECRUITMENT_TICK_MINUTES = 60;

@Injectable()
export class RecruitmentSchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger('RecruitmentRound');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly interviews: InterviewsService,
  ) {}

  /** Starts looking every hour (main.ts, once the API listens). The timer never keeps the process alive. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), RECRUITMENT_TICK_MINUTES * 60_000);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One round, unless the last is still going. Never throws. */
  async tick(now = new Date()): Promise<number | null> {
    if (this.running) return null;
    this.running = true;
    try {
      return await this.runOnce(now);
    } catch (err) {
      this.logger.error(`The recruitment round could not run: ${(err as Error).message}`);
      return null;
    } finally {
      this.running = false;
    }
  }

  /** One round at `now`: how many interviewers were reminded; null when another process is starting one. */
  async runOnce(now = new Date()): Promise<number | null> {
    const started = await this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_NAME})) AS locked`;
      return !!lock?.locked;
    });
    if (!started) return null;
    const told = await this.interviews.remindFeedback(now);
    if (told) this.logger.log(`Recruitment: ${told} interviewer(s) reminded of their scorecard.`);
    return told;
  }
}
