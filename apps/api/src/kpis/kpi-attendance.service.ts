import { Injectable } from '@nestjs/common';
import {
  attendanceLineInputs,
  EMPTY_PAYROLL_INPUTS,
  PAYROLL_RULE_DEFAULTS,
  payrollLine,
  PERMISSION_RULE_DEFAULTS,
  type PayrollResult,
} from '@trendlix/shared';
import { AttendanceDaysService } from '../attendance/attendance-days.service.js';
import { toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { LawRatesService } from '../payroll/law-rates/law-rates.service.js';
import { firstDay, lastDay } from '../payroll/months.js';
import { rulesOf } from '../payroll/payroll-settings.service.js';
import { rosterEmployment, rosterSelect } from '../payroll/payroll.service.js';
import { roster } from '../payroll/roster.js';
import { PrismaService } from '../prisma/prisma.service.js';

// The month's attendance score for the KPI scorecards' automatic Attendance metric (owner, 21 October 2026: "Attendance:
// Yes, as the sheet"; the brief: "worked ÷ expected hours as payroll computes it for that person and month"): the score
// payroll works out, 1 at or above the attendance grace (90%), else worked ÷ expected hours. Read from the month's
// payroll line when it has one that counts attendance (any status: the figures payroll has, HR's typed hours and the
// imports included); else worked out the same way from the month's attendance days (the system's check-ins, Zoho's
// imported days): the roster's terms for the month (the shift's expected hours less the holidays, leave and permission)
// and the hours the days count, through payrollLine. With neither (no attendance kept, no shift, paid by the hour) none:
// payroll counts the attendance as full then, and so does the metric. Read while attendance is out of the KPI too
// (owner, 25 October 2026: "Fixed cut only"): kept on the scorecard, it counts once the setting is switched on again.

type Db = PrismaService | Prisma.TransactionClient;

/** A person's month as the Attendance metric reads it. */
export interface KpiAttendanceRead {
  /** Worked ÷ expected hours; null when attendance isn't counted for the month. */
  ratio: number | null;
  /** The attendance score payroll counts (1 at or above the grace); null with no ratio. */
  score: number | null;
  source: 'payroll' | 'attendance' | 'none';
}

const NONE: KpiAttendanceRead = { ratio: null, score: null, source: 'none' };

@Injectable()
export class KpiAttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly days: AttendanceDaysService,
    private readonly lawRates: LawRatesService,
  ) {}

  /** The month's (YYYY-MM) attendance score of each person, by employee id (every id given has one). */
  async readMonth(month: string, employeeIds: readonly string[], db: Db = this.prisma): Promise<Map<string, KpiAttendanceRead>> {
    const out = new Map<string, KpiAttendanceRead>();
    const ids = [...new Set(employeeIds)];
    if (!ids.length) return out;
    const from = toDateOnly(firstDay(month));
    const to = toDateOnly(lastDay(month));

    // the month's payroll line, when it counts attendance
    const run = await db.payrollRun.findUnique({ where: { month: from }, select: { lines: { where: { employeeId: { in: ids } }, select: { employeeId: true, result: true } } } });
    for (const line of run?.lines ?? []) {
      const r = line.result as unknown as Partial<PayrollResult> | null;
      if (r && typeof r.attendanceRatio === 'number' && typeof r.attendanceScore === 'number') {
        out.set(line.employeeId, { ratio: r.attendanceRatio, score: r.attendanceScore, source: 'payroll' });
      }
    }
    const rest = ids.filter((id) => !out.has(id));
    if (!rest.length) return out;

    // else as payroll would work it out from the month's attendance days
    const [rows, holidays, settings, leaveSetup, people, permissions] = await Promise.all([
      db.employment.findMany({ where: { employeeId: { in: rest }, joinDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] }, select: rosterSelect(from, to) }),
      db.holiday.findMany({ where: { date: { gte: from, lte: to } }, select: { date: true } }),
      db.payrollSettings.findUnique({ where: { id: 1 } }),
      db.leaveSettings.findUnique({ where: { id: 1 }, select: { permissionHoursPerMonth: true } }),
      this.days.monthOf(month, rest, undefined, db),
      db.permissionRequest.groupBy({ by: ['employeeId'], where: { employeeId: { in: rest }, status: 'approved', date: { gte: from, lte: to } }, _sum: { hours: true } }),
    ]);
    const rules = settings ? rulesOf(settings) : PAYROLL_RULE_DEFAULTS;
    const law = await this.lawRates.forYear(Number(month.slice(0, 4)));
    const allowance = leaveSetup?.permissionHoursPerMonth.toNumber() ?? PERMISSION_RULE_DEFAULTS.hoursPerMonth;
    const holidayDays = holidays.map((h) => h.date.toISOString().slice(0, 10));
    const { lines } = roster(month, rows.map(rosterEmployment), rules, holidayDays, law, allowance);
    for (const line of lines) {
      const person = people.get(line.employeeId);
      if (!person?.days.length) continue;
      const filled = attendanceLineInputs(person.days, {
        systemPermissionHours: permissions.find((p) => p.employeeId === line.employeeId)?._sum.hours?.toNumber() ?? 0,
        permissionHoursPerMonth: allowance,
        hourly: line.payBasis === 'hourly',
        // as payroll fills it: a day missing its check-out the shift's hours a day until corrected (25 October 2026)
        hoursADay: person.hoursADay,
      });
      const result = payrollLine(line.terms, { ...EMPTY_PAYROLL_INPUTS, ...filled }, rules, law);
      if (result.attendanceRatio !== null) out.set(line.employeeId, { ratio: result.attendanceRatio, score: result.attendanceScore, source: 'attendance' });
    }
    for (const id of rest) if (!out.has(id)) out.set(id, NONE);
    return out;
  }
}
