import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { dayInCairo } from '../common/date-only.js';
import { NoticesService } from '../notifications/notices.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { standInsToTell } from './stand-ins.js';

// A stand-in told when the approver's leave starts (owner, 25 October 2026: "To a stand-in"; the brief: "the stand-in is
// told of waiting items when the leave starts and of new ones as they come"). Every 15 minutes the API looks for approved
// leave with a stand-in whose days include today (Cairo) and whose stand-in wasn't told yet; each is claimed on its row
// (stand_in_told_at) in the transaction that finds it, so it is told once whichever process looks, then the stand-in (a
// person, or HR) is told with how many wait now (NoticesService.standInStarted). The new ones as they come are told by the
// flows' own notices (NoticesService.deciders). Also run at once when such a leave is approved or recorded, so a leave
// that has started already is told then. One process at a time: a Postgres advisory lock held for the transaction.
// Started by main.ts, so the tests' apps don't run it by themselves: they call runOnce.

/** The advisory lock's name: hashtext() of it is the key every process takes. */
const LOCK_NAME = 'people-system stand-ins';

/** How often the API looks, in minutes. */
export const STAND_IN_TICK_MINUTES = 15;

@Injectable()
export class StandInSchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger('StandIns');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notices: NoticesService,
  ) {}

  /** Starts looking every 15 minutes (main.ts, once the API listens), and once now. The timer never keeps the process alive. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), STAND_IN_TICK_MINUTES * 60_000);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One round, unless the last is still going. Never throws. */
  async tick(now = new Date()): Promise<string[]> {
    if (this.running) return [];
    this.running = true;
    try {
      return await this.runOnce(now);
    } catch (err) {
      this.logger.error(`The stand-ins could not be told: ${(err as Error).message}`);
      return [];
    } finally {
      this.running = false;
    }
  }

  /** One round at `now`: the leave whose stand-in is due to be told, claimed, then told. Answers their ids (none: another process looks). */
  async runOnce(now: Date): Promise<string[]> {
    const today = dayInCairo(now);
    const claimed = await this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_NAME})) AS locked`;
        if (!lock?.locked) return [];
        const due = await standInsToTell(tx, today);
        const ids: string[] = [];
        for (const r of due) {
          const { count } = await tx.leaveRequest.updateMany({ where: { id: r.id, standInToldAt: null }, data: { standInToldAt: now } });
          if (count) ids.push(r.id);
        }
        return ids;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    for (const id of claimed) await this.notices.standInStarted(id);
    return claimed;
  }
}
