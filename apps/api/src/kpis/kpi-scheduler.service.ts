import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { cairoDay, kpiDeadlines, kpiDueChange, kpiReminderDue, kpiScorecardMonthOn, type KpiReminder, type KpiSettings } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { shownDate } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { KpiNoticesService } from './kpi-notices.service.js';
import { KpiOpeningService, type OpenedScorecard } from './kpi-opening.service.js';
import { KpiSettingsService } from './kpi-settings.service.js';
import { monthOfCard, SCORECARD_ENTITY } from './kpi-views.js';

// The KPI scorecards' clock (owner, 21 October 2026: "Last month's KPI, this pay"; the brief: "created on the 1st …
// A scheduler tick (like reminders.service) with an advisory lock, plus a "Open this month's scorecards now" for HR";
// "A missed self-rating doesn't block the manager; it's noted"; "If the employee doesn't sign by the 10th, it's final
// anyway, noted"; "one reminder the day before each deadline"). Every few minutes the API opens last month's scorecards
// still missing (on the 1st, all of them; later, someone whose job title's template came into force or who was added
// since), moves on the self-ratings not sent by their day (noted, the scorer told) and makes final the scorecards not
// signed by the sign-off day (noted), and sends each step's reminder the day before its deadline, once (claimed on the
// scorecard's reminders_sent). One process at a time: a Postgres advisory lock held for the transaction; another
// process finding it held does nothing that round. HR's "Open now" waits for it, then opens the same way. Started by
// main.ts, so the tests' apps don't run it by themselves: they call runOnce with a moment of their own.

/** The advisory lock's name: hashtext() of it is the key every process takes. */
const LOCK_NAME = 'people-system kpi scorecards';

/** How often the API looks, in minutes. */
export const KPI_TICK_MINUTES = 5;

type Tx = Prisma.TransactionClient;

/** What a round did. */
export interface KpiRound {
  month: string;
  opened: number;
  selfMissed: number;
  finalized: number;
  reminders: number;
}

@Injectable()
export class KpiSchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger('KpiScheduler');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly opening: KpiOpeningService,
    private readonly settings: KpiSettingsService,
    private readonly notices: KpiNoticesService,
  ) {}

  /** Starts looking every few minutes (main.ts, once the API listens). The timer never keeps the process alive. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), KPI_TICK_MINUTES * 60_000);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One round, unless the last is still going. Never throws. */
  async tick(now = new Date()): Promise<KpiRound | null> {
    if (this.running) return null;
    this.running = true;
    try {
      return await this.runOnce(now);
    } catch (err) {
      this.logger.error(`The KPI scorecards could not be looked at: ${(err as Error).message}`);
      return null;
    } finally {
      this.running = false;
    }
  }

  /**
   * One round at `now`: last month's missing scorecards opened, the deadlines gone by applied, the reminders due sent.
   * Null when another process holds the lock.
   */
  async runOnce(now: Date): Promise<KpiRound | null> {
    const today = cairoDay(now);
    const month = kpiScorecardMonthOn(today);
    const settings = await this.settings.read();
    const done = await this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_NAME})) AS locked`;
        if (!lock?.locked) return null;
        const opened = await this.opening.openMonth(month, tx);
        const { missed, finalized } = await this.deadlines(tx, settings, today, now);
        const reminders = await this.claimReminders(tx, settings, today);
        return { opened, missed, finalized, reminders };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    if (!done) return null;
    await this.recordOpened(month, done.opened, null);
    for (const m of done.missed) {
      await this.audit.record({ userId: null, action: 'update', entityType: SCORECARD_ENTITY, entityId: m.id, diff: { month: m.month, employeeCode: m.employeeCode, status: { from: 'self_rating', to: 'manager' }, selfMissed: true } });
    }
    for (const f of done.finalized) {
      await this.audit.record({ userId: null, action: 'finalize', entityType: SCORECARD_ENTITY, entityId: f.id, diff: { month: f.month, employeeCode: f.employeeCode, status: { from: 'sign_off', to: 'final' }, unsigned: f.unsigned } });
    }
    await this.notices.opened(done.opened.map((o) => o.id), settings);
    for (const m of done.missed) await this.notices.toScorer(m.id);
    const reminders = await this.notices.remind(done.reminders, settings);
    const round = { month, opened: done.opened.length, selfMissed: done.missed.length, finalized: done.finalized.length, reminders };
    if (round.opened || round.selfMissed || round.finalized || round.reminders) this.logger.log(`KPIs: ${JSON.stringify(round)}`);
    return round;
  }

  /**
   * HR's "Open this month's scorecards now" (the brief): last month's missing scorecards opened at once, waiting for a
   * round of the clock holding the lock to finish first.
   */
  async openNow(user: SessionUser, now = new Date()): Promise<{ month: string; opened: number }> {
    const month = kpiScorecardMonthOn(cairoDay(now));
    const settings = await this.settings.read();
    const opened = await this.prisma.$transaction(
      async (tx) => {
        // waits for a round holding it (a function returning nothing: executed, not read)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_NAME}))`;
        return this.opening.openMonth(month, tx);
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
    await this.recordOpened(month, opened, user);
    await this.audit.record({ userId: user.id, action: 'open', entityType: SCORECARD_ENTITY, diff: { month, opened: opened.length } });
    await this.notices.opened(opened.map((o) => o.id), settings);
    return { month, opened: opened.length };
  }

  private async recordOpened(month: string, opened: readonly OpenedScorecard[], user: SessionUser | null) {
    for (const o of opened) {
      await this.audit.record({
        userId: user?.id ?? null,
        action: 'create',
        entityType: SCORECARD_ENTITY,
        entityId: o.id,
        diff: { month, employeeCode: o.employeeCode, templateId: o.templateId, scorer: o.scorer, status: 'self_rating' },
      });
    }
  }

  /** The self-ratings not sent by their day, moved on to the scorer (noted); the sign-offs not done by theirs, final (noted). */
  private async deadlines(tx: Tx, settings: KpiSettings, today: string, now: Date) {
    const open = await tx.kpiScorecard.findMany({
      where: { status: { in: ['self_rating', 'sign_off'] } },
      select: { id: true, month: true, status: true, employeeSignedAt: true, managerSignedAt: true, employee: { select: { employeeCode: true } } },
    });
    const missed: { id: string; month: string; employeeCode: string }[] = [];
    const finalized: { id: string; month: string; employeeCode: string; unsigned: string[] }[] = [];
    for (const c of open) {
      const month = monthOfCard(c);
      const change = kpiDueChange(c.status, kpiDeadlines(month, settings), today);
      if (change === 'self_missed') {
        const { count } = await tx.kpiScorecard.updateMany({ where: { id: c.id, status: 'self_rating' }, data: { status: 'manager', selfMissed: true } });
        if (!count) continue;
        await tx.kpiScorecardStep.create({ data: { scorecardId: c.id, kind: 'self_missed', comment: `Not sent by ${shownDate(kpiDeadlines(month, settings).selfRating)}` } });
        missed.push({ id: c.id, month, employeeCode: c.employee.employeeCode });
      } else if (change === 'final_unsigned') {
        const unsigned = [...(c.employeeSignedAt ? [] : ['employee']), ...(c.managerSignedAt ? [] : ['manager'])];
        const { count } = await tx.kpiScorecard.updateMany({ where: { id: c.id, status: 'sign_off' }, data: { status: 'final', finalAt: now } });
        if (!count) continue;
        const who = unsigned.map((u) => (u === 'employee' ? 'the employee' : 'the manager')).join(' or ');
        await tx.kpiScorecardStep.create({ data: { scorecardId: c.id, kind: 'final_unsigned', comment: `Not signed by ${who} by ${shownDate(kpiDeadlines(month, settings).signOff)}` } });
        finalized.push({ id: c.id, month, employeeCode: c.employee.employeeCode, unsigned });
      }
    }
    return { missed, finalized };
  }

  /** The reminders due today, each claimed on its scorecard so it goes once. */
  private async claimReminders(tx: Tx, settings: KpiSettings, today: string): Promise<{ id: string; step: KpiReminder }[]> {
    const open = await tx.kpiScorecard.findMany({ where: { status: { not: 'final' } }, select: { id: true, month: true, status: true, remindersSent: true } });
    const out: { id: string; step: KpiReminder }[] = [];
    for (const c of open) {
      const step = kpiReminderDue(c.status, kpiDeadlines(monthOfCard(c), settings), today, c.remindersSent);
      if (!step) continue;
      const claimed = await tx.$executeRaw`
        UPDATE kpi_scorecards SET reminders_sent = array_append(COALESCE(reminders_sent, ARRAY[]::TEXT[]), ${step}::text)
        WHERE id = ${c.id}::uuid AND status = ${c.status} AND NOT (${step}::text = ANY(COALESCE(reminders_sent, ARRAY[]::TEXT[])))`;
      if (claimed) out.push({ id: c.id, step });
    }
    return out;
  }
}
