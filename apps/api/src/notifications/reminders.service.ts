import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { CHECK_IN_REMINDER_MAX, CHECK_IN_REMINDER_TAG, DEFAULT_NOTIFICATION_SETTINGS, exemptOn, REMINDER_TICK_MINUTES, type CheckInReminderView, type PunchKind } from '@trendlix/shared';
import { exemptionsOf } from '../attendance/exemption-days.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly } from '../common/date-only.js';
import { fromTimeOfDay } from '../common/time-of-day.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REQUEST_LINKS } from './notices.service.js';
import { NotificationsService } from './notifications.service.js';
import {
  checkInReminderNow,
  dayKey,
  liveShiftIds,
  reminderDays,
  remindersDue,
  sentKey,
  type DueReminder,
  type PermissionSpan,
  type ReminderFacts,
  type ReminderPerson,
  type ReminderShift,
  type SentReminder,
} from './reminder-rules.js';
import { checkInReminderText, checkOutReminderText } from './texts.js';

// The check-in reminders (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a
// check-in reminder)", then "a reminder for people that didn't checkin and not on a leave every 10 minutes. like a
// popup"; apps/mobile/README.md, Phase 4), sent by the API itself: every minute it reads who should be reminded now
// (reminder-rules.ts), only among the people of the shifts within their reminders' hours, and sends each 10-minute step
// of "You haven't checked in" once, and "Still checked in?" once a day. A step is claimed on the reminders_sent row (its
// count and last_sent_at), in the same transaction, only while the last one went before the step began, so it never
// goes twice whichever process sends it. Only one of the API's processes looks at a time anyway: a Postgres advisory
// lock held for the transaction; another process finding it held does nothing that round. The check-in reminder keeps
// one inbox row a day (refreshed at each step) and is pushed with its tag, so the phone shows the latest only. Also the
// popup's question (GET /me/check-in-reminder), by the same rule. Started by main.ts, so the tests' apps don't run it by
// themselves: they call runOnce with a moment of their own.

type Db = PrismaService | Prisma.TransactionClient;

/** The advisory lock's name: hashtext() of it is the key every process takes. */
const LOCK_NAME = 'people-system notification reminders';

/** A reminder claimed for sending: how many have gone that day with it, and the day's inbox row so far. */
type Claimed = DueReminder & { count: number; notificationId: string | null };

@Injectable()
export class RemindersService implements OnModuleDestroy {
  private readonly logger = new Logger('Reminders');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Starts looking every minute (main.ts, once the API listens). The timer never keeps the process alive. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), REMINDER_TICK_MINUTES * 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One round, unless the last is still going. Never throws. */
  async tick(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.runOnce(now);
    } catch (err) {
      this.logger.error(`The reminders could not be sent: ${(err as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /**
   * Sends the reminders due at `now` that weren't sent yet in their step, and answers how many: none when another
   * process holds the lock. Each is claimed before it goes, in the transaction holding the lock; then it is sent to the
   * inbox and the phones, after the transaction.
   */
  async runOnce(now: Date): Promise<number> {
    const due = await this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_NAME})) AS locked`;
        if (!lock?.locked) return [];
        // only the people of the shifts within their reminders' hours now: most rounds read the shifts and stop there
        const live = liveShiftIds(await this.shifts(tx), now);
        if (!live.size) return [];
        const days = reminderDays(now);
        const people = await this.people(tx, days, { shiftIds: [...live] });
        if (!people.length) return [];
        const reminders = remindersDue(people, await this.facts(tx, people, days), now);
        const claimed: Claimed[] = [];
        for (const r of reminders) {
          const row = await this.claim(tx, r, now);
          if (row) claimed.push({ ...r, ...row });
        }
        return claimed;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    for (const r of due) {
      // WhatsApp beside them for those who opted in (24 October 2026: "Check-in reminders"): once a kind a day, never in
      // quiet hours (WhatsAppService)
      if (r.kind === 'check_in_reminder') {
        const id = await this.notifications.remind(
          r.userId,
          { ...checkInReminderText(r.shiftStart, REQUEST_LINKS.myAttendance), whatsapp: { facts: { template: 'check_in_reminder', shiftStart: r.shiftStart } } },
          { rowId: r.notificationId, tag: CHECK_IN_REMINDER_TAG },
        );
        if (id && id !== r.notificationId) {
          await this.prisma.reminderSent.updateMany({ where: { userId: r.userId, day: toDateOnly(r.day), kind: r.kind }, data: { notificationId: id } });
        }
      } else {
        await this.notifications.notify([r.userId], {
          ...checkOutReminderText(r.checkedInAt, REQUEST_LINKS.myAttendance),
          whatsapp: { facts: { template: 'check_out_reminder', checkedInAt: new Date(r.checkedInAt).toISOString() } },
        });
      }
    }
    if (due.length) this.logger.log(`Sent ${due.length} reminder${due.length === 1 ? '' : 's'}.`);
    return due.length;
  }

  /**
   * The popup "You haven't checked in yet" (GET /me/check-in-reminder), for the signed-in person at `now`, by the same
   * rule as the push, whatever was sent: never while a Super Admin views as someone.
   */
  async checkInReminderFor(user: SessionUser, now = new Date()): Promise<CheckInReminderView> {
    const none: CheckInReminderView = { due: false, shiftStart: null, checkInPath: REQUEST_LINKS.myAttendance };
    if (user.viewAs) return none;
    const days = reminderDays(now);
    if (!user.employeeId) return none;
    const person = (await this.people(this.prisma, days, { employeeId: user.employeeId })).find((p) => p.userId === user.id);
    if (!person) return none;
    const due = checkInReminderNow(person, await this.facts(this.prisma, [person], days), now);
    return due ? { ...none, due: true, shiftStart: due.shiftStart } : none;
  }

  /**
   * Claims a reminder's step on its reminders_sent row: made for the day's first, or counted again while the last one
   * went before this step began (and fewer than 12 went). Answers the row's count and its inbox row; null when this step
   * was sent already (by this process or another). The moments go as Dates, as Prisma's own reads and writes of the row
   * send them (an ISO string would be read in the database's time zone otherwise).
   */
  private async claim(tx: Prisma.TransactionClient, r: DueReminder, now: Date): Promise<{ count: number; notificationId: string | null } | null> {
    const [row] = await tx.$queryRaw<{ count: number; notification_id: string | null }[]>`
      INSERT INTO reminders_sent (user_id, day, kind, count, last_sent_at)
      VALUES (${r.userId}::uuid, ${r.day}::date, ${r.kind}, 1, ${now}::timestamptz)
      ON CONFLICT (user_id, day, kind) DO UPDATE SET count = reminders_sent.count + 1, last_sent_at = EXCLUDED.last_sent_at
      WHERE reminders_sent.last_sent_at < ${r.stepAt}::timestamptz AND reminders_sent.count < ${CHECK_IN_REMINDER_MAX}
      RETURNING count, notification_id`;
    return row ? { count: Number(row.count), notificationId: row.notification_id } : null;
  }

  /** Every shift, as the reminders read it (a handful of rows). */
  private async shifts(db: Db): Promise<(ReminderShift & { id: string })[]> {
    const rows = await db.shift.findMany({ select: { id: true, startTime: true, endTime: true, graceMinutes: true, countUntil: true, workingDays: true } });
    return rows.map((s) => ({ id: s.id, ...shiftOf(s) }));
  }

  /**
   * Those who may be reminded on the days looked at: an employee whose account (users.employee_id, 22 October 2026) is
   * active, and an employment under a shift covering one of the days, with their switches (none kept: both on). Only
   * under `shiftIds` when given (a round), or only `employeeId` (the popup's question).
   */
  private async people(db: Db, days: readonly string[], only: { shiftIds?: string[]; employeeId?: string } = {}): Promise<ReminderPerson[]> {
    const [first, last] = [days[0], days[days.length - 1]];
    const covering = {
      joinDate: { lte: toDateOnly(last) },
      OR: [{ endDate: null }, { endDate: { gte: toDateOnly(first) } }],
      shiftId: only.shiftIds ? { in: only.shiftIds } : { not: null },
    } satisfies Prisma.EmploymentWhereInput;
    const employees = await db.employee.findMany({
      where: { ...(only.employeeId !== undefined && { id: only.employeeId }), account: { is: { isActive: true } }, employments: { some: covering } },
      select: {
        id: true,
        account: { select: { id: true, notificationSettings: { select: { checkInReminder: true, checkOutReminder: true } } } },
        employments: {
          where: covering,
          orderBy: { joinDate: 'desc' },
          select: {
            joinDate: true,
            endDate: true,
            employmentType: true,
            shift: { select: { startTime: true, endTime: true, graceMinutes: true, countUntil: true, workingDays: true } },
          },
        },
      },
    });
    if (!employees.length) return [];
    const out: ReminderPerson[] = [];
    for (const e of employees) {
      const user = e.account;
      if (!user) continue;
      out.push({
        userId: user.id,
        employeeId: e.id,
        settings: user.notificationSettings ?? { ...DEFAULT_NOTIFICATION_SETTINGS },
        employments: e.employments.map((m) => ({
          joinDate: fromDateOnly(m.joinDate),
          endDate: m.endDate ? fromDateOnly(m.endDate) : null,
          employmentType: m.employmentType,
          shift: m.shift && shiftOf(m.shift),
        })),
      });
    }
    return out;
  }

  /** The holidays, approved leave and permission, Zoho days, punches and reminders sent on the days, for these people. */
  private async facts(db: Db, people: readonly ReminderPerson[], days: readonly string[]): Promise<ReminderFacts> {
    const employeeIds = people.map((p) => p.employeeId);
    const userIds = people.map((p) => p.userId);
    const dates = days.map(toDateOnly);
    const [first, last] = [dates[0], dates[dates.length - 1]];
    const [holidays, leave, permission, zoho, punches, sent, exemptions] = await Promise.all([
      db.holiday.findMany({ where: { date: { in: dates } }, select: { date: true } }),
      db.leaveRequest.findMany({ where: { employeeId: { in: employeeIds }, status: 'approved', startDate: { lte: last }, endDate: { gte: first } }, select: { employeeId: true, startDate: true, endDate: true } }),
      db.permissionRequest.findMany({ where: { employeeId: { in: employeeIds }, status: 'approved', date: { in: dates } }, select: { employeeId: true, date: true, fromTime: true, toTime: true } }),
      db.attendanceDay.findMany({ where: { employeeId: { in: employeeIds }, date: { in: dates }, source: 'zoho' }, select: { employeeId: true, date: true } }),
      db.attendancePunch.findMany({ where: { employeeId: { in: employeeIds }, date: { in: dates } }, orderBy: { at: 'asc' }, select: { employeeId: true, date: true, kind: true, at: true } }),
      db.reminderSent.findMany({ where: { userId: { in: userIds }, day: { in: dates } }, select: { userId: true, day: true, kind: true, count: true, lastSentAt: true } }),
      // exempt from check-in (owner, 25 October 2026): no reminder those days
      exemptionsOf(db, employeeIds, days[0], days[days.length - 1]),
    ]);
    const leaveDays = new Set<string>();
    for (const l of leave) {
      for (const day of days) if (fromDateOnly(l.startDate) <= day && fromDateOnly(l.endDate) >= day) leaveDays.add(dayKey(l.employeeId, day));
    }
    const permitted = new Map<string, PermissionSpan[]>();
    for (const p of permission) {
      const key = dayKey(p.employeeId, fromDateOnly(p.date));
      permitted.set(key, [...(permitted.get(key) ?? []), { fromTime: p.fromTime ? fromTimeOfDay(p.fromTime) : null, toTime: p.toTime ? fromTimeOfDay(p.toTime) : null }]);
    }
    const punched = new Map<string, { kind: PunchKind; at: Date }[]>();
    for (const p of punches) {
      const key = dayKey(p.employeeId, fromDateOnly(p.date));
      punched.set(key, [...(punched.get(key) ?? []), { kind: p.kind as PunchKind, at: p.at }]);
    }
    return {
      holidays: new Set(holidays.map((h) => fromDateOnly(h.date))),
      leave: leaveDays,
      permission: permitted,
      zoho: new Set(zoho.map((z) => dayKey(z.employeeId, fromDateOnly(z.date)))),
      exempt: new Set(employeeIds.flatMap((id) => days.filter((day) => exemptOn(day, exemptions.get(id) ?? [])).map((day) => dayKey(id, day)))),
      punches: punched,
      sent: new Map<string, SentReminder>(sent.map((s) => [sentKey(s.userId, fromDateOnly(s.day), s.kind as DueReminder['kind']), { count: s.count, lastSentAt: s.lastSentAt }])),
    };
  }
}

/** A shift's row as the reminders read it: its times "HH:mm". */
function shiftOf(s: { startTime: Date; endTime: Date; graceMinutes: number | null; countUntil: Date | null; workingDays: number[] }): ReminderShift {
  return {
    startTime: fromTimeOfDay(s.startTime),
    endTime: fromTimeOfDay(s.endTime),
    graceMinutes: s.graceMinutes,
    countUntil: s.countUntil ? fromTimeOfDay(s.countUntil) : null,
    workingDays: s.workingDays,
  };
}
