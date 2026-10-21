import { Injectable, Logger } from '@nestjs/common';
import { kpiDeadlines, type KpiReminder, type KpiSettings } from '@trendlix/shared';
import { actsAs } from '../auth/roles.js';
import { NoticesService } from '../notifications/notices.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { kpiManagerSignText, kpiOpenText, kpiReadyToSignText, kpiReminderText, kpiWaitingText } from '../notifications/texts.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { monthOfCard } from './kpi-views.js';

// Who is told what as a KPI scorecard takes its steps (owner's brief, 21 October 2026: "scorecard open → the employee;
// self-rating done → the manager; manager done → HR (the CEO for C-level); ready to sign → both; one reminder the day
// before each deadline"; "The texts are short: no scores in the push"). Each is called once its step has committed, reads
// the scorecard as it is now, and never throws into the flow. The scorer's side: the manager in charge, every HR user
// for one HR scores, the CEO for a C-level person's, a Super Admin for the CEO's own, never the person themself; HR's
// calibration: those NoticesService.stageDeciders names (HR; never told of a C-level person's, which has no such step).

/** Where a scorecard opens on the site (the phone pages open their own page for it: lib/surface.ts). */
export const scorecardLink = (id: string) => `/kpis/scorecards/${id}`;

const CARD = { id: true, month: true, status: true, employeeId: true, scorer: true, managerId: true, employeeSignedAt: true, managerSignedAt: true, employee: { select: { fullNameEn: true } } } as const;

@Injectable()
export class KpiNoticesService {
  private readonly logger = new Logger('KpiNotices');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notices: NoticesService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Scorecards opened: each employee is told theirs is open for their self-rating. */
  async opened(ids: readonly string[], settings: KpiSettings): Promise<void> {
    await this.safely('opened', async () => {
      if (!ids.length) return;
      const cards = await this.prisma.kpiScorecard.findMany({ where: { id: { in: [...ids] } }, select: CARD });
      const users = await this.notices.usersOf(cards.map((c) => c.employeeId));
      for (const c of cards) {
        const month = monthOfCard(c);
        const userId = users.get(c.employeeId);
        if (userId) await this.notifications.notify([userId], kpiOpenText(month, kpiDeadlines(month, settings).selfRating, scorecardLink(c.id)));
      }
    });
  }

  /** The scoring waits for its scorer (the self-rating sent, or missed). */
  async toScorer(id: string): Promise<void> {
    await this.safely('scoring', async () => {
      const c = await this.prisma.kpiScorecard.findUnique({ where: { id }, select: CARD });
      if (!c || c.status !== 'manager') return;
      await this.notifications.notify(await this.scorerUsers(c), kpiWaitingText(c.employee.fullNameEn, monthOfCard(c), scorecardLink(c.id)));
    });
  }

  /** HR's calibration waits (after a manager's scoring). */
  async toHr(id: string): Promise<void> {
    await this.safely('calibration', async () => {
      const c = await this.prisma.kpiScorecard.findUnique({ where: { id }, select: CARD });
      if (!c || c.status !== 'hr') return;
      await this.notifications.notify(await this.notices.stageDeciders('hr', c.employeeId), kpiWaitingText(c.employee.fullNameEn, monthOfCard(c), scorecardLink(c.id)));
    });
  }

  /** Ready to sign: the employee and the scorer's side are both told. */
  async readyToSign(id: string, settings: KpiSettings): Promise<void> {
    await this.safely('sign-off', async () => {
      const c = await this.prisma.kpiScorecard.findUnique({ where: { id }, select: CARD });
      if (!c || c.status !== 'sign_off') return;
      const month = monthOfCard(c);
      const link = scorecardLink(c.id);
      const own = (await this.notices.usersOf([c.employeeId])).get(c.employeeId);
      if (own) await this.notifications.notify([own], kpiReadyToSignText(month, kpiDeadlines(month, settings).signOff, link));
      await this.notifications.notify(await this.scorerUsers(c), kpiManagerSignText(c.employee.fullNameEn, month, link));
    });
  }

  /**
   * The reminders due (the day before each step's deadline), one a person and step: the employee's own, or how many wait
   * for them; a single one links to its scorecard, several to the list they are on.
   */
  async remind(due: readonly { id: string; step: KpiReminder }[], settings: KpiSettings): Promise<number> {
    let sent = 0;
    await this.safely('reminder', async () => {
      if (!due.length) return;
      const cards = new Map((await this.prisma.kpiScorecard.findMany({ where: { id: { in: due.map((d) => d.id) } }, select: CARD })).map((c) => [c.id, c]));
      const own = await this.notices.usersOf([...cards.values()].map((c) => c.employeeId));
      // the employee's own reminders, and each other person's scorecards by step
      const theirs = new Map<string, { step: KpiReminder; ids: string[]; deadline: string }>();
      for (const d of due) {
        const c = cards.get(d.id);
        if (!c) continue;
        const month = monthOfCard(c);
        const deadlines = kpiDeadlines(month, settings);
        const deadline = d.step === 'self_rating' ? deadlines.selfRating : d.step === 'manager' ? deadlines.manager : d.step === 'hr' ? deadlines.hr : deadlines.signOff;
        const employeeUser = own.get(c.employeeId);
        const toEmployee = d.step === 'self_rating' || (d.step === 'sign_off' && !c.employeeSignedAt);
        if (toEmployee && employeeUser) {
          await this.notifications.notify([employeeUser], kpiReminderText(d.step, { own: true, month }, deadline, scorecardLink(c.id)));
          sent++;
        }
        const others =
          d.step === 'manager' || (d.step === 'sign_off' && !c.managerSignedAt) ? await this.scorerUsers(c) : d.step === 'hr' ? await this.notices.stageDeciders('hr', c.employeeId) : [];
        for (const userId of others) {
          const key = `${userId}:${d.step}`;
          const entry = theirs.get(key) ?? { step: d.step, ids: [], deadline };
          entry.ids.push(c.id);
          theirs.set(key, entry);
        }
      }
      for (const [key, entry] of theirs) {
        const userId = key.slice(0, key.indexOf(':'));
        const link = entry.ids.length === 1 ? scorecardLink(entry.ids[0]) : entry.step === 'hr' ? '/approvals' : '/kpis/team';
        await this.notifications.notify([userId], kpiReminderText(entry.step, { own: false, count: entry.ids.length }, entry.deadline, link));
        sent++;
      }
    });
    return sent;
  }

  /** Those who score the scorecard (and sign it as the manager): never the person themself. */
  private async scorerUsers(c: { employeeId: string; scorer: string; managerId: string | null }): Promise<string[]> {
    const self = (await this.notices.usersOf([c.employeeId])).get(c.employeeId);
    let ids: string[] = [];
    if (c.scorer === 'manager' && c.managerId) {
      const manager = (await this.notices.usersOf([c.managerId])).get(c.managerId);
      ids = manager ? [manager] : [];
    } else if (c.scorer === 'hr') ids = await this.notices.usersWith((roles) => actsAs(roles, ['hr']));
    else if (c.scorer === 'ceo') ids = await this.notices.usersWith((roles) => roles.includes('ceo'));
    else if (c.scorer === 'super_admin') ids = await this.notices.usersWith((roles) => roles.includes('super_admin'));
    return ids.filter((id) => id !== self);
  }

  private async safely(what: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      this.logger.error(`The KPI ${what} notification could not be sent: ${(err as Error).message}`);
    }
  }
}

