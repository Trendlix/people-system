import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { LOCATION_ENDING_NOTICE_DAYS } from '@trendlix/shared';
import { actsAs } from '../auth/roles.js';
import { addDays, dayInCairo, fromDateOnly, toDateOnly } from '../common/date-only.js';
import { NoticesService } from '../notifications/notices.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { checkInLocationEndingText } from '../notifications/texts.js';
import { PrismaService } from '../prisma/prisma.service.js';

// The ends of requested check-in locations told ahead (owner, 24 October 2026: "allow the HR to add an end date or lik it
// to the contract date"; the brief: "The employee and HR are told 7 days before an end that isn't contract-linked").
// Every hour the API looks for the approved homes and remote sites lasting until a date within the next 7 days, and the
// client locations of Check-in Setup lasting until such a date (not ended by HR), whose notice hasn't gone: each is
// claimed on its row (ending_notice_on, the day) in the transaction that finds it, so it never goes twice whichever
// process sends it, then the employee and HR (a C-level person's: the CEO) are told of a home or a remote site, and HR of
// a client location. A date changed later clears the claim, so the new date is told too. One process at a time: a
// Postgres advisory lock held for the transaction, as custody's daily check does. Started by main.ts, so the tests' apps
// don't run it by themselves: they call runOnce. An end "until the contract ends" is never told: it follows the contract.

/** The advisory lock's name: hashtext() of it is the key every process takes. */
const LOCK_NAME = 'people-system check-in location endings';

/** How often the API looks, in minutes. */
export const LOCATION_ENDINGS_TICK_MINUTES = 60;

/** Where HR finds the client locations. */
const CHECK_IN_SETUP_LOCATIONS = '/organization/check-in-setup#check-in-locations';

/** What a round told: the requests (homes and remote sites), and the client locations. */
export interface LocationEndingsRound {
  requests: string[];
  clients: string[];
}

@Injectable()
export class CheckInLocationEndingsService implements OnModuleDestroy {
  private readonly logger = new Logger('CheckInLocationEndings');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notices: NoticesService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Starts looking every hour (main.ts, once the API listens). The timer never keeps the process alive. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), LOCATION_ENDINGS_TICK_MINUTES * 60_000);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One round, unless the last is still going. Never throws. */
  async tick(now = new Date()): Promise<LocationEndingsRound | null> {
    if (this.running) return null;
    this.running = true;
    try {
      return await this.runOnce(now);
    } catch (err) {
      this.logger.error(`The check-in location endings could not be told: ${(err as Error).message}`);
      return null;
    } finally {
      this.running = false;
    }
  }

  /** One round at `now`: the notices due claimed, then sent. Null when another process holds the lock. */
  async runOnce(now: Date): Promise<LocationEndingsRound | null> {
    const today = dayInCairo(now);
    const within = { gte: toDateOnly(today), lte: toDateOnly(addDays(today, LOCATION_ENDING_NOTICE_DAYS)) };
    const claimed = await this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_NAME})) AS locked`;
        if (!lock?.locked) return null;
        const due = await tx.homeLocationRequest.findMany({
          where: { status: 'approved', type: { in: ['home', 'remote_site'] }, validity: 'until_date', validUntil: within, endingNoticeOn: null },
          select: { id: true },
        });
        const requests: string[] = [];
        for (const r of due) {
          const { count } = await tx.homeLocationRequest.updateMany({ where: { id: r.id, endingNoticeOn: null }, data: { endingNoticeOn: toDateOnly(today) } });
          if (count) requests.push(r.id);
        }
        const ending = await tx.checkInLocation.findMany({ where: { kind: 'client', endedAt: null, validUntil: within, endingNoticeOn: null }, select: { id: true } });
        const clients: string[] = [];
        for (const l of ending) {
          const { count } = await tx.checkInLocation.updateMany({ where: { id: l.id, endingNoticeOn: null }, data: { endingNoticeOn: toDateOnly(today) } });
          if (count) clients.push(l.id);
        }
        return { requests, clients };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    if (!claimed) return null;
    for (const id of claimed.requests) await this.safely(() => this.requestEnding(id));
    for (const id of claimed.clients) await this.safely(() => this.clientEnding(id));
    return claimed;
  }

  /** A home's or a remote site's end coming: the employee, and HR (a C-level person's: the CEO). */
  private async requestEnding(id: string): Promise<void> {
    const r = await this.prisma.homeLocationRequest.findUnique({ where: { id }, select: { employeeId: true, type: true, validUntil: true, employee: { select: { fullNameEn: true } } } });
    if (!r?.validUntil) return;
    const end = fromDateOnly(r.validUntil);
    const link = `/home-locations/${id}`;
    const own = (await this.notices.usersOf([r.employeeId])).get(r.employeeId);
    if (own) await this.notifications.notify([own], checkInLocationEndingText(r.type, end, link));
    await this.notifications.notify(await this.notices.stageDeciders('hr', r.employeeId), checkInLocationEndingText(r.type, end, link, { person: r.employee.fullNameEn }));
  }

  /** A client location's end coming: HR, who keeps the company's check-in locations. */
  private async clientEnding(id: string): Promise<void> {
    const l = await this.prisma.checkInLocation.findUnique({ where: { id }, select: { name: true, validUntil: true } });
    if (!l?.validUntil) return;
    const hr = await this.notices.usersWith((roles) => actsAs(roles, ['hr']));
    await this.notifications.notify(hr, checkInLocationEndingText('client', fromDateOnly(l.validUntil), CHECK_IN_SETUP_LOCATIONS, { place: l.name }));
  }

  /** A notice that couldn't go is logged, never thrown into the round. */
  private async safely(run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      this.logger.error(`A check-in location's end could not be told: ${(err as Error).message}`);
    }
  }
}
