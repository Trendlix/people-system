import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { DEFAULT_NOTIFICATION_SETTINGS, REMINDER_TICK_MINUTES, type PunchKind } from '@trendlix/shared';
import { fromDateOnly, toDateOnly } from '../common/date-only.js';
import { fromTimeOfDay } from '../common/time-of-day.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REQUEST_LINKS } from './notices.service.js';
import { NotificationsService } from './notifications.service.js';
import { dayKey, reminderDays, remindersDue, sentKey, type DueReminder, type ReminderFacts, type ReminderPerson } from './reminder-rules.js';
import { checkInReminderText, checkOutReminderText } from './texts.js';

// The check-in reminders (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a
// check-in reminder)"; apps/mobile/README.md, Phase 4), sent by the API itself: every 5 minutes it reads who should be
// reminded now (reminder-rules.ts) and sends each reminder once a person, day and kind (the reminders_sent row, made in
// the same transaction). Only one of the API's processes looks at a time: a Postgres advisory lock held for the
// transaction; another process finding it held does nothing that round. Started by main.ts, so the tests' apps don't run
// it by themselves: they call runOnce with a moment of their own.

type Db = PrismaService | Prisma.TransactionClient;

/** The advisory lock's name: hashtext() of it is the key every process takes. */
const LOCK_NAME = 'people-system notification reminders';

@Injectable()
export class RemindersService implements OnModuleDestroy {
  private readonly logger = new Logger('Reminders');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Starts looking every 5 minutes (main.ts, once the API listens). The timer never keeps the process alive. */
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
   * Sends the reminders due at `now` that weren't sent yet, and answers how many: none when another process holds the
   * lock. Each is kept as sent before it goes, in the transaction holding the lock; then it is sent to the inbox and the
   * phones, after the transaction.
   */
  async runOnce(now: Date): Promise<number> {
    const due = await this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_NAME})) AS locked`;
        if (!lock?.locked) return [];
        const days = reminderDays(now);
        const people = await this.people(tx, days);
        if (!people.length) return [];
        const reminders = remindersDue(people, await this.facts(tx, people, days), now);
        const kept: DueReminder[] = [];
        for (const r of reminders) {
          const { count } = await tx.reminderSent.createMany({ data: [{ userId: r.userId, day: toDateOnly(r.day), kind: r.kind, sentAt: now }], skipDuplicates: true });
          if (count) kept.push(r);
        }
        return kept;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    for (const r of due) {
      await this.notifications.notify(
        [r.userId],
        r.kind === 'check_in_reminder' ? checkInReminderText(r.shiftStart, REQUEST_LINKS.myAttendance) : checkOutReminderText(r.checkedInAt, REQUEST_LINKS.myAttendance),
      );
    }
    if (due.length) this.logger.log(`Sent ${due.length} reminder${due.length === 1 ? '' : 's'}.`);
    return due.length;
  }

  /**
   * Those who may be reminded on the days looked at: an employee with a work email that an active user signs in with,
   * and an employment under a shift covering one of the days, with their switches (none kept: both on).
   */
  private async people(db: Db, days: readonly string[]): Promise<ReminderPerson[]> {
    const [first, last] = [days[0], days[days.length - 1]];
    const covering = { joinDate: { lte: toDateOnly(last) }, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(first) } }], shiftId: { not: null } } satisfies Prisma.EmploymentWhereInput;
    const employees = await db.employee.findMany({
      where: { workEmail: { not: null }, employments: { some: covering } },
      select: {
        id: true,
        workEmail: true,
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
    const users = await db.user.findMany({
      where: { isActive: true, email: { in: employees.map((e) => e.workEmail!.toLowerCase()) } },
      select: { id: true, email: true, notificationSettings: { select: { checkInReminder: true, checkOutReminder: true } } },
    });
    const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
    const out: ReminderPerson[] = [];
    for (const e of employees) {
      const user = byEmail.get(e.workEmail!.toLowerCase());
      if (!user) continue;
      out.push({
        userId: user.id,
        employeeId: e.id,
        settings: user.notificationSettings ?? { ...DEFAULT_NOTIFICATION_SETTINGS },
        employments: e.employments.map((m) => ({
          joinDate: fromDateOnly(m.joinDate),
          endDate: m.endDate ? fromDateOnly(m.endDate) : null,
          employmentType: m.employmentType,
          shift: m.shift && {
            startTime: fromTimeOfDay(m.shift.startTime),
            endTime: fromTimeOfDay(m.shift.endTime),
            graceMinutes: m.shift.graceMinutes,
            countUntil: m.shift.countUntil ? fromTimeOfDay(m.shift.countUntil) : null,
            workingDays: m.shift.workingDays,
          },
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
    const [holidays, leave, permission, zoho, punches, sent] = await Promise.all([
      db.holiday.findMany({ where: { date: { in: dates } }, select: { date: true } }),
      db.leaveRequest.findMany({ where: { employeeId: { in: employeeIds }, status: 'approved', startDate: { lte: last }, endDate: { gte: first } }, select: { employeeId: true, startDate: true, endDate: true } }),
      db.permissionRequest.findMany({ where: { employeeId: { in: employeeIds }, status: 'approved', date: { in: dates } }, select: { employeeId: true, date: true } }),
      db.attendanceDay.findMany({ where: { employeeId: { in: employeeIds }, date: { in: dates }, source: 'zoho' }, select: { employeeId: true, date: true } }),
      db.attendancePunch.findMany({ where: { employeeId: { in: employeeIds }, date: { in: dates } }, orderBy: { at: 'asc' }, select: { employeeId: true, date: true, kind: true, at: true } }),
      db.reminderSent.findMany({ where: { userId: { in: userIds }, day: { in: dates } }, select: { userId: true, day: true, kind: true } }),
    ]);
    const leaveDays = new Set<string>();
    for (const l of leave) {
      for (const day of days) if (fromDateOnly(l.startDate) <= day && fromDateOnly(l.endDate) >= day) leaveDays.add(dayKey(l.employeeId, day));
    }
    const punched = new Map<string, { kind: PunchKind; at: Date }[]>();
    for (const p of punches) {
      const key = dayKey(p.employeeId, fromDateOnly(p.date));
      punched.set(key, [...(punched.get(key) ?? []), { kind: p.kind as PunchKind, at: p.at }]);
    }
    return {
      holidays: new Set(holidays.map((h) => fromDateOnly(h.date))),
      leave: leaveDays,
      permission: new Set(permission.map((p) => dayKey(p.employeeId, fromDateOnly(p.date)))),
      zoho: new Set(zoho.map((z) => dayKey(z.employeeId, fromDateOnly(z.date)))),
      punches: punched,
      sent: new Set(sent.map((s) => sentKey(s.userId, fromDateOnly(s.day), s.kind as DueReminder['kind']))),
    };
  }
}
