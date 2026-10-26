import { Injectable, Logger } from '@nestjs/common';
import { breakMinutesOf, dayFromPunches, locksMonth, readPressPairs, shiftWindowOn, spansOfPairs, type CheckInPlace, type ImportedDay, type PunchKind, type PunchLike } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly } from '../common/date-only.js';
import { fromTimeOfDay } from '../common/time-of-day.js';
import { Prisma } from '../generated/prisma/client.js';
import { firstDay, lastDay } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { shiftTimesOf } from './attendance-days.service.js';
import { AttendanceFillService } from './attendance-fill.service.js';
import { AttendanceImportsService } from './attendance-imports.service.js';
import { keptDayData } from './check-in.service.js';
import { CorrectionDaysService } from './correction-days.service.js';

// A day's hours as the sum of its check-in → check-out pairs (owner, 25 October 2026: "on checkin and out several ttimes,
// the working hours to be calculated between the checkin and out only, not the first and last"; asked, "Months not yet
// paid": "recalculate every day of months whose payroll isn't approved or paid (the draft payroll refills); approved and
// paid months never change"). Each press already keeps its day by its pairs (check-in.service.ts); this recounts the
// days kept before, once: every day of the system's check-ins (source 'system') with presses, in a month whose payroll
// isn't with the CEO, approved or paid (a run with the CEO never changes, so it would miss the change: Claude's choice,
// as corrections refuse such a month), is made again from its presses (packages/shared dayFromPunches: its hours, flags,
// pairs, break and open last check-in) under the shift of the employment it falls in. Zoho People's days are never
// touched (their hours stay as imported); a day kept without presses is left as it is. The corrected days of those
// months are made again over the days they correct (CorrectionDaysService), then the months' draft runs refill the
// lines of the people whose days changed (AttendanceFillService, each line in the audit log). The pass as one audit
// entry with its counts (the days recounted and changed, the hours before and after), written only when something
// changed. Idempotent: run again it finds the days as they are and changes nothing. On deploy (main.ts), under an
// advisory lock held for its transaction (another process finding it held does nothing), with the people's rows
// locked as a press locks them, so no press is lost meanwhile. People exempt from check-in (owner, 25 October 2026):
// adding or ending an exemption runs the same pass for its person and months (CheckInExemptionsService), every draft line
// of theirs refilled; their exempt days are read full wherever a month is read, never written.
//
// Recount past days (owner, 26 October 2026, on the MORNING shift changed to 8:00 AM–8:00 PM, 9 hours, grace 0, counting
// until 8:00 PM: "i want to recount previous payrolls on the new shift run"; asked before, "Months not yet paid"): the
// same pass on request for From–To months and optionally one shift (RecountDaysService, Organization → Shifts), with
// `zoho: true` also over Zoho People's days (source 'zoho') that have a check-in: their hours made again under the
// shift of the employment each falls in by the Zoho import's own rules (AttendanceImportsService.months: from their
// pairs when Zoho gave them, else from the first check-in to the last check-out), and their break by their pairs as the
// sync keeps it. Only the hours and the break change; the times, the status and Zoho's permission never. `dryRun` counts
// what would change and writes nothing (the preview).

/** The advisory lock's name: hashtext() of it is the key every process takes. */
const LOCK_NAME = 'people-system attendance recount';

/** What a pass did. */
export interface RecountResult {
  /** The months recounted, and those left as they are (with the CEO, approved or paid), with the status of each. */
  months: string[];
  monthsLocked: string[];
  lockedStatus: Record<string, string>;
  /** The people whose days were read, and those of them with a day changed (hours or any field). */
  people: number;
  peopleChanged: number;
  /** Of the days above, Zoho People's (a scope with `zoho`), and those of them whose hours or break changed. */
  zohoDays: number;
  zohoDaysChanged: number;
  /** The system's days read with presses, and of them those written again: any field, and those whose hours changed. */
  daysRecounted: number;
  daysWritten: number;
  daysChanged: number;
  /** The hours of the days recounted, before and after, together. */
  hoursBefore: number;
  hoursAfter: number;
  /** The corrected days made again, and those whose hours changed. */
  correctedDays: number;
  correctedDaysChanged: number;
  /** The draft lines refilled. */
  linesRefilled: number;
}

/** What to recount: these months (none: every month with a day of the system's), these people (none: everyone). */
export interface RecountScope {
  months?: readonly string[] | null;
  employeeIds?: readonly string[] | null;
  /** Refill the drafts of every month and person of the scope, not only those whose days changed (an exemption's change). */
  refillAll?: boolean;
  /** Write the pass's own audit entry (the deploy's); an exemption's change is audited by its own entry. */
  audit?: boolean;
  /** Also Zoho People's days with a check-in (Recount past days), not only the system's. */
  zoho?: boolean;
  /** Only the days whose employment is on this shift (Recount past days, one shift). */
  shiftId?: string | null;
  /** Count what would change, write nothing and refill nothing (the preview). */
  dryRun?: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class HoursByPairsService {
  private readonly logger = new Logger('HoursByPairs');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fill: AttendanceFillService,
    private readonly corrections: CorrectionDaysService,
    private readonly imports: AttendanceImportsService,
  ) {}

  /** The pass once, on deploy (main.ts, once the API listens; the tests run it themselves). Never throws. */
  start(): void {
    void this.recount({ audit: true })
      .then((r) => {
        if (r && (r.daysWritten || r.correctedDaysChanged)) {
          this.logger.log(`Recounted ${r.daysRecounted} days by their pairs (${r.daysChanged} changed), ${r.correctedDays} corrected days made again, ${r.linesRefilled} draft lines refilled.`);
        }
      })
      .catch((err: unknown) => this.logger.error(`The hours by pairs could not be recounted: ${(err as Error).message}`));
  }

  /**
   * Recounts the system's days of the scope by their pairs, the months whose payroll is with the CEO, approved or paid
   * left as they are; the corrected days made again; the drafts refilled. Null when another process holds the lock.
   */
  async recount(scope: RecountScope = {}, user: SessionUser | null = null): Promise<RecountResult | null> {
    const ids = scope.employeeIds ? [...new Set(scope.employeeIds)] : null;
    if (ids && !ids.length) return null;
    const asked = scope.months ? [...new Set(scope.months)].sort() : null;
    if (asked && !asked.length) return null;

    const pass = await this.prisma.$transaction(
      async (tx) => {
        if (!scope.dryRun) {
          const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_NAME})) AS locked`;
          if (!lock?.locked) return null;
        }
        const runs = await tx.payrollRun.findMany({ select: { month: true, status: true } });
        const lockedStatus: Record<string, string> = {};
        for (const r of runs) if (locksMonth(r.status)) lockedStatus[fromDateOnly(r.month).slice(0, 7)] = r.status;
        const locked = new Set(Object.keys(lockedStatus));
        const dateWhere = asked ? { OR: asked.map((m) => ({ date: { gte: toDateOnly(firstDay(m)), lte: toDateOnly(lastDay(m)) } })) } : {};
        const rows = await tx.attendanceDay.findMany({
          where: { source: scope.zoho ? { in: ['system', 'zoho'] } : 'system', ...(ids && { employeeId: { in: ids } }), ...dateWhere },
          orderBy: [{ employeeId: 'asc' }, { date: 'asc' }],
          select: { id: true, employeeId: true, date: true, source: true, checkIn: true, checkOut: true, place: true, flags: true, hoursCounted: true, pairs: true, breakMinutes: true, openAt: true, zohoStatus: true, permissionHours: true },
        });
        const monthRows = rows.filter((r) => !locked.has(fromDateOnly(r.date).slice(0, 7)));
        const monthsSeen = new Set([...(asked ?? []), ...rows.map((r) => fromDateOnly(r.date).slice(0, 7))]);
        const months = [...monthsSeen].filter((m) => !locked.has(m)).sort();
        const monthsLocked = [...monthsSeen].filter((m) => locked.has(m)).sort();
        const everyone = [...new Set(monthRows.map((r) => r.employeeId))].sort();
        // their rows locked as a press locks them (check-in.service.ts), one order for all
        if (everyone.length && !scope.dryRun) await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ANY(${everyone}::uuid[]) ORDER BY id FOR UPDATE`;
        const people = everyone;
        const dates = monthRows.filter((r) => r.source === 'system').map((r) => r.date);
        const [punches, employments] = people.length
          ? await Promise.all([
              tx.attendancePunch.findMany({
                where: { employeeId: { in: people }, date: { in: dates } },
                orderBy: { at: 'asc' },
                select: { employeeId: true, date: true, kind: true, at: true, place: true, flags: true },
              }),
              tx.employment.findMany({
                where: { employeeId: { in: people } },
                select: { id: true, employeeId: true, joinDate: true, endDate: true, shiftId: true, shift: { select: { startTime: true, endTime: true, hoursPerDay: true, graceMinutes: true, countUntil: true, workingDays: true } } },
              }),
            ])
          : [[], []];
        const pressed = new Map<string, PunchLike[]>();
        for (const p of punches) {
          const key = `${p.employeeId}:${fromDateOnly(p.date)}`;
          pressed.set(key, [...(pressed.get(key) ?? []), { kind: p.kind as PunchKind, at: p.at.toISOString(), place: p.place as CheckInPlace, flags: p.flags }]);
        }
        const out = { daysRecounted: 0, daysWritten: 0, daysChanged: 0, hoursBefore: 0, hoursAfter: 0, zohoDays: 0, zohoDaysChanged: 0 };
        const touched = new Map<string, Set<string>>();
        const read = new Set<string>();
        const jobOn = (employeeId: string, date: string) =>
          employments.find((e) => e.employeeId === employeeId && fromDateOnly(e.joinDate) <= date && (e.endDate === null || fromDateOnly(e.endDate) >= date));
        const touch = (employeeId: string, date: string) => {
          const month = date.slice(0, 7);
          touched.set(month, (touched.get(month) ?? new Set()).add(employeeId));
        };
        const changedPeople = new Set<string>();
        // Zoho People's days: by month, per employment, made again by the import's rules under the shift of that employment
        const zohoRows: Map<string, typeof monthRows> = new Map();
        for (const r of monthRows) {
          if (r.source !== 'zoho' || !r.checkIn) continue;
          const date = fromDateOnly(r.date);
          const job = jobOn(r.employeeId, date);
          if (scope.shiftId && job?.shiftId !== scope.shiftId) continue;
          zohoRows.set(date.slice(0, 7), [...(zohoRows.get(date.slice(0, 7)) ?? []), r]);
        }
        for (const [month, list] of zohoRows) {
          // one call of the import's rules a round: each person's first employment of the month, then the next
          const byJob = new Map<string, { employeeId: string; rows: typeof list }>();
          for (const r of list) {
            const job = jobOn(r.employeeId, fromDateOnly(r.date));
            if (!job) continue;
            const g = byJob.get(job.id) ?? { employeeId: r.employeeId, rows: [] };
            g.rows.push(r);
            byJob.set(job.id, g);
          }
          const rounds: { employmentId: string; employeeId: string; rows: typeof list }[][] = [];
          const seen = new Map<string, number>();
          for (const [employmentId, g] of byJob) {
            const n = seen.get(g.employeeId) ?? 0;
            seen.set(g.employeeId, n + 1);
            (rounds[n] ??= []).push({ employmentId, ...g });
          }
          for (const round of rounds) {
            const worked = await this.imports.months(
              month,
              round.map((g) => ({
                employeeId: g.employeeId,
                employmentId: g.employmentId,
                days: g.rows.map((r): ImportedDay => ({
                  date: fromDateOnly(r.date),
                  checkIn: r.checkIn!.toISOString(),
                  checkOut: r.checkOut?.toISOString() ?? null,
                  place: r.place === 'office' || r.place === 'remote' ? r.place : null,
                  zohoStatus: r.zohoStatus,
                  permissionHours: r.permissionHours?.toNumber() ?? 0,
                  // none (Excel's first and last): from check-in to check-out; the pairs when Zoho gave them
                  pairs: readPressPairs(r.pairs),
                })),
              })),
            );
            for (const g of round) {
              const result = worked.get(g.employeeId);
              const shift = employments.find((e) => e.id === g.employmentId)?.shift;
              const times = shift ? shiftTimesOf(shift) : null;
              for (const r of g.rows) {
                const date = fromDateOnly(r.date);
                const d = result?.days.find((x) => x.date === date);
                // outside the employment's dates, or no longer a worked day: left as it is
                if (!d || d.status !== 'worked') continue;
                const pairs = readPressPairs(r.pairs);
                const hoursCounted = round2(d.hoursCounted);
                const breakMinutes = pairs?.length ? breakMinutesOf(spansOfPairs(pairs), r.openAt ? r.openAt.getTime() : null, times ? shiftWindowOn(date, times) : null) : null;
                const before = r.hoursCounted.toNumber();
                out.daysRecounted++;
                out.zohoDays++;
                read.add(r.employeeId);
                out.hoursBefore += before;
                out.hoursAfter += hoursCounted;
                if (round2(before) === hoursCounted && r.breakMinutes === breakMinutes) continue;
                if (!scope.dryRun) await tx.attendanceDay.update({ where: { id: r.id }, data: { hoursCounted, breakMinutes } });
                out.daysWritten++;
                out.zohoDaysChanged++;
                if (round2(before) !== hoursCounted) out.daysChanged++;
                changedPeople.add(r.employeeId);
                touch(r.employeeId, date);
              }
            }
          }
        }
        for (const r of monthRows) {
          if (r.source !== 'system') continue;
          const date = fromDateOnly(r.date);
          const presses = pressed.get(`${r.employeeId}:${date}`);
          // a day kept without presses is left as it is
          if (!presses?.length) continue;
          const job = jobOn(r.employeeId, date);
          if (scope.shiftId && job?.shiftId !== scope.shiftId) continue;
          const s = job?.shift;
          const shift = s
            ? { startTime: fromTimeOfDay(s.startTime), endTime: fromTimeOfDay(s.endTime), hoursPerDay: s.hoursPerDay?.toNumber() ?? null, graceMinutes: s.graceMinutes, countUntil: s.countUntil ? fromTimeOfDay(s.countUntil) : null }
            : null;
          const day = dayFromPunches(date, presses, shift);
          const data = keptDayData(day);
          const before = r.hoursCounted.toNumber();
          out.daysRecounted++;
          read.add(r.employeeId);
          out.hoursBefore += before;
          out.hoursAfter += data.hoursCounted;
          if (sameDay(r, data)) continue;
          if (!scope.dryRun) await tx.attendanceDay.update({ where: { id: r.id }, data });
          out.daysWritten++;
          if (round2(before) !== data.hoursCounted) out.daysChanged++;
          changedPeople.add(r.employeeId);
          touch(r.employeeId, date);
        }
        return { months, monthsLocked, lockedStatus, touched, people: read.size, peopleChanged: changedPeople.size, ...out, hoursBefore: round2(out.hoursBefore), hoursAfter: round2(out.hoursAfter) };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    if (!pass) {
      // another process is recounting now: an exemption's change still refills its people's drafts (their days are
      // read with it whenever a month is read)
      if (scope.refillAll && ids && asked) await this.refill(asked, () => ids, user);
      return null;
    }

    if (scope.dryRun) {
      const { touched: _touched, ...counts } = pass;
      return { ...counts, correctedDays: 0, correctedDaysChanged: 0, linesRefilled: 0 };
    }

    // the corrected days of those months over the days they correct: those whose day changed, and those not kept by
    // their pairs yet (once each: made again by their pairs, they are left as they are after)
    let correctedDays = 0;
    let correctedDaysChanged = 0;
    for (const month of pass.months) {
      const corrected = await this.prisma.attendanceDay.findMany({
        where: { source: 'correction', date: { gte: toDateOnly(firstDay(month)), lte: toDateOnly(lastDay(month)) }, ...(ids && { employeeId: { in: ids } }) },
        select: { employeeId: true, date: true, hoursCounted: true, pairs: true },
      });
      for (const c of corrected) {
        // (one shift's recount makes again only the corrected days of the people it changed)
        if ((c.pairs !== null || scope.shiftId) && !pass.touched.get(month)?.has(c.employeeId)) continue;
        const change = await this.corrections.rebuild(c.employeeId, fromDateOnly(c.date), user);
        correctedDays++;
        if (round2(c.hoursCounted.toNumber()) !== round2(change.after?.hoursCounted ?? 0)) correctedDaysChanged++;
        pass.touched.set(month, (pass.touched.get(month) ?? new Set()).add(c.employeeId));
      }
    }

    // the drafts refilled: the people whose days changed, or (an exemption's change) every person of the scope
    const linesRefilled = await this.refill(pass.months, (month) => (scope.refillAll && ids ? ids : [...(pass.touched.get(month) ?? [])]), user);

    const result: RecountResult = {
      months: pass.months,
      monthsLocked: pass.monthsLocked,
      lockedStatus: pass.lockedStatus,
      people: pass.people,
      peopleChanged: pass.peopleChanged,
      zohoDays: pass.zohoDays,
      zohoDaysChanged: pass.zohoDaysChanged,
      daysRecounted: pass.daysRecounted,
      daysWritten: pass.daysWritten,
      daysChanged: pass.daysChanged,
      hoursBefore: pass.hoursBefore,
      hoursAfter: pass.hoursAfter,
      correctedDays,
      correctedDaysChanged,
      linesRefilled,
    };
    if (scope.audit && (result.daysWritten || correctedDays)) {
      await this.audit.record({ userId: user?.id ?? null, action: 'recount_hours', entityType: 'attendance_day', diff: { rule: 'hours_by_pairs', ...result } });
    }
    return result;
  }

  /** The draft runs of these months refilled for `people` of each (AttendanceFillService, each line audited): the lines refilled. */
  private async refill(months: readonly string[], people: (month: string) => readonly string[], user: SessionUser | null): Promise<number> {
    let lines = 0;
    for (const month of months) {
      const ids = people(month);
      if (!ids.length) continue;
      const run = await this.prisma.payrollRun.findUnique({ where: { month: toDateOnly(firstDay(month)) }, select: { id: true, status: true } });
      if (run?.status !== 'draft') continue;
      const filled = await this.fill.fillRun(run.id, user, ids);
      lines += filled.filled + filled.cleared + filled.leaveCounted;
    }
    return lines;
  }
}

type KeptDayData = ReturnType<typeof keptDayData>;

/** Whether a kept day is already what its presses make it (hours to the hundredth, as kept). */
function sameDay(
  r: { checkIn: Date | null; checkOut: Date | null; place: string | null; flags: string[]; hoursCounted: Prisma.Decimal; pairs: Prisma.JsonValue; breakMinutes: number | null; openAt: Date | null },
  d: KeptDayData,
): boolean {
  const pairs = readPressPairs(r.pairs);
  const samePairs =
    pairs !== null &&
    pairs.length === d.pairs.length &&
    pairs.every((p, i) => Date.parse(p.in) === Date.parse(d.pairs[i].in) && Date.parse(p.out) === Date.parse(d.pairs[i].out));
  return (
    samePairs &&
    (r.checkIn?.getTime() ?? null) === (d.checkIn?.getTime() ?? null) &&
    (r.checkOut?.getTime() ?? null) === (d.checkOut?.getTime() ?? null) &&
    (r.openAt?.getTime() ?? null) === (d.openAt?.getTime() ?? null) &&
    r.place === d.place &&
    r.flags.length === d.flags.length &&
    r.flags.every((f, i) => f === d.flags[i]) &&
    round2(r.hoursCounted.toNumber()) === d.hoursCounted &&
    r.breakMinutes === d.breakMinutes
  );
}
