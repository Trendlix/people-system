import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { CUSTODY_UNSIGNED_DAYS } from '@trendlix/shared';
import { dayInCairo, toDateOnly } from '../common/date-only.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CustodyNoticesService } from './custody-notices.service.js';

// The custody's daily check (Assets step 3, the brief: "overdue shoot returns: a daily check that tells the employee and
// the custodians (one notice a day per record), using the existing scheduler pattern with an advisory lock; not signed
// after 3 days: tell the custodians"). Every few minutes the API looks for the shoots past their return date and not
// closed whose notice hasn't gone today, and the records still without their signed copy 3 days after the handover whose
// notice never went; each is claimed on its record (overdue_notice_on, the day; unsigned_notice_at, once) in the
// transaction that finds it, so it never goes twice whichever process sends it. One process at a time: a Postgres
// advisory lock held for the transaction; another process finding it held does nothing that round, as the reminders
// and the KPI clock do. Started by main.ts, so the tests' apps don't run it by themselves: they call runOnce.

/** The advisory lock's name: hashtext() of it is the key every process takes. */
const LOCK_NAME = 'people-system custody checks';

/** How often the API looks, in minutes. */
export const CUSTODY_TICK_MINUTES = 15;

const DAY_MS = 86_400_000;

/** What a round sent: the records told of overdue, and of not signed. */
export interface CustodyRound {
  overdue: string[];
  unsigned: string[];
}

@Injectable()
export class CustodySchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger('CustodyChecks');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notices: CustodyNoticesService,
  ) {}

  /** Starts looking every few minutes (main.ts, once the API listens). The timer never keeps the process alive. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), CUSTODY_TICK_MINUTES * 60_000);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One round, unless the last is still going. Never throws. */
  async tick(now = new Date()): Promise<CustodyRound | null> {
    if (this.running) return null;
    this.running = true;
    try {
      return await this.runOnce(now);
    } catch (err) {
      this.logger.error(`The custody checks could not run: ${(err as Error).message}`);
      return null;
    } finally {
      this.running = false;
    }
  }

  /** One round at `now`: the notices due claimed, then sent. Null when another process holds the lock. */
  async runOnce(now: Date): Promise<CustodyRound | null> {
    const today = toDateOnly(dayInCairo(now));
    const claimed = await this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_NAME})) AS locked`;
        if (!lock?.locked) return null;
        const notToday = { OR: [{ overdueNoticeOn: null }, { overdueNoticeOn: { lt: today } }] };
        const late = await tx.custodyRecord.findMany({ where: { kind: 'shoot', status: { in: ['open', 'partial'] }, dueDate: { lt: today }, ...notToday }, select: { id: true } });
        const overdue: string[] = [];
        for (const r of late) {
          const { count } = await tx.custodyRecord.updateMany({ where: { id: r.id, ...notToday }, data: { overdueNoticeOn: today } });
          if (count) overdue.push(r.id);
        }
        const before = new Date(now.getTime() - CUSTODY_UNSIGNED_DAYS * DAY_MS);
        const notSigned = await tx.custodyRecord.findMany({ where: { unsignedNoticeAt: null, outAt: { lte: before }, files: { none: {} } }, select: { id: true } });
        const unsigned: string[] = [];
        for (const r of notSigned) {
          const { count } = await tx.custodyRecord.updateMany({ where: { id: r.id, unsignedNoticeAt: null, files: { none: {} } }, data: { unsignedNoticeAt: now } });
          if (count) unsigned.push(r.id);
        }
        return { overdue, unsigned };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    if (!claimed) return null;
    for (const id of claimed.overdue) await this.notices.overdue(id);
    for (const id of claimed.unsigned) await this.notices.unsigned(id);
    if (claimed.overdue.length || claimed.unsigned.length) this.logger.log(`Custody: ${claimed.overdue.length} overdue, ${claimed.unsigned.length} not signed told.`);
    return claimed;
  }
}
