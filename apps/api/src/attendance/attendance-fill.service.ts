import { Injectable } from '@nestjs/common';
import {
  attendanceLineInputs,
  EMPTY_PAYROLL_INPUTS,
  figuresBefore,
  PERMISSION_RULE_DEFAULTS,
  type AttendanceImportMark,
  type ImportedInput,
  type PayrollInputs,
  type PayrollRules,
  type PayrollTerms,
} from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly } from '../common/date-only.js';
import { Prisma } from '../generated/prisma/client.js';
import { json, savedInputs, worked } from '../payroll/line-work.js';
import { firstDay, lastDay } from '../payroll/months.js';
import { runLawRates } from '../payroll/views.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AttendanceDaysService } from './attendance-days.service.js';

const LINE = 'payroll_line';

/**
 * What a fill of a run did: the lines filled from the attendance days, those put back (no days left), and the lines Zoho's
 * import filled whose no-show days changed with the leave approved since (21 October 2026).
 */
export interface AttendanceFillResult {
  filled: number;
  cleared: number;
  leaveCounted: number;
}

// A draft payroll run's lines filled from the month's attendance days (owner's brief, 19 October 2026: "a draft run's
// lines are filled from the month's attendance days (source 'system' first; for a person with none, the Zoho days if
// imported) — marked 'from attendance', read-only like the Zoho cells; a 'Refresh from attendance' on the run recomputes
// them"). For each line of someone whose month has days of the system's own (their check-ins on the system, the working
// days gone by since their first one, a correction approved: AttendanceDaysService), the worked hours (the hours
// counted), the no-show days (the absent days) and the permission hours (Zoho's within the allowance for a month without
// the system's requests, else left to the requests on the line's terms) are replaced, the line worked out again and
// marked from attendance (its figures before kept, HR's typed ones or an import's before them, as an import keeps them);
// someone with only Zoho's days keeps what Zoho's import filled (undone on its review), but for its no-show days, counted
// again from its days as they are now: a day of approved leave is never a no-show (owner, 21 October 2026, after
// importing leave: "whatever the source, Zoho attendance included"; packages/shared withLeaveNow). A line marked from attendance
// whose days are gone gets back what it had before. Done when a run is made or refreshed, on Refresh from attendance,
// after each check-in on the system and each correction approved (the month's draft only: a run sent to the CEO never
// changes). Since 25 October 2026 (owner: "Yes, daily + backfill") someone whose month has Zoho days fetched from Zoho
// People's API (not an Excel import) is filled from their days too, as someone who checks in on the system: the fetch
// keeps their days each night, so their line follows. Every line changed is in the audit log. C-level lines too: the
// figures are the attendance's, nobody types them, and HR's views keep hiding them (owner, 19 October 2026: "make C level Employees details not visible to HR").
@Injectable()
export class AttendanceFillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly days: AttendanceDaysService,
  ) {}

  /** Fills the person's line on the month's draft run (YYYY-MM), if there is one. */
  async fillMonth(employeeId: string, month: string, user: SessionUser | null): Promise<AttendanceFillResult> {
    const run = await this.prisma.payrollRun.findUnique({ where: { month: toDateOnly(firstDay(month)) }, select: { id: true, status: true } });
    if (!run || run.status !== 'draft') return { filled: 0, cleared: 0, leaveCounted: 0 };
    return this.fillRun(run.id, user, [employeeId]);
  }

  /**
   * Fills a draft run's lines from the month's attendance days: everyone's, or `only` these people's. A run that isn't a
   * draft is left as it is.
   */
  async fillRun(runId: string, user: SessionUser | null, only?: readonly string[]): Promise<AttendanceFillResult> {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        month: true,
        status: true,
        rules: true,
        lawRates: true,
        lines: {
          where: only ? { employeeId: { in: [...only] } } : {},
          select: { id: true, employeeId: true, employeeCode: true, payBasis: true, terms: true, inputs: true, attendanceImport: true },
        },
      },
    });
    if (!run || run.status !== 'draft' || !run.lines.length) return { filled: 0, cleared: 0, leaveCounted: 0 };
    const month = fromDateOnly(run.month).slice(0, 7);
    const ids = run.lines.map((l) => l.employeeId);
    const [people, permissions, setup, fetched] = await Promise.all([
      this.days.monthOf(month, ids),
      this.prisma.permissionRequest.groupBy({
        by: ['employeeId'],
        where: { employeeId: { in: ids }, status: 'approved', date: { gte: toDateOnly(firstDay(month)), lte: toDateOnly(lastDay(month)) } },
        _sum: { hours: true },
      }),
      this.prisma.leaveSettings.findUnique({ where: { id: 1 }, select: { permissionHoursPerMonth: true } }),
      // those with days kept by Zoho People's fetch this month (25 October 2026: "Yes, daily + backfill")
      this.prisma.attendanceDay.findMany({
        where: { employeeId: { in: ids }, source: 'zoho', zohoRunId: { not: null }, date: { gte: toDateOnly(firstDay(month)), lte: toDateOnly(lastDay(month)) } },
        distinct: ['employeeId'],
        select: { employeeId: true },
      }),
    ]);
    const fromZohoFetch = new Set(fetched.map((f) => f.employeeId));
    const allowance = setup?.permissionHoursPerMonth.toNumber() ?? PERMISSION_RULE_DEFAULTS.hoursPerMonth;
    const rules = run.rules as unknown as PayrollRules;
    const law = runLawRates(run);
    const at = new Date().toISOString();
    const result: AttendanceFillResult = { filled: 0, cleared: 0, leaveCounted: 0 };

    for (const line of run.lines) {
      const mark = line.attendanceImport as unknown as AttendanceImportMark | null;
      const person = people.get(line.employeeId);
      const was = savedInputs(line.inputs);
      let inputs: PayrollInputs;
      let next: AttendanceImportMark | null;
      // the system's own days, or Zoho People's fetched each night (owner, 25 October 2026: "Yes, daily + backfill":
      // "Draft payroll runs for those months are refilled for the people changed"): filled from the month's days
      if (person && (person.own || fromZohoFetch.has(line.employeeId))) {
        const filled = attendanceLineInputs(person.days, {
          systemPermissionHours: permissions.find((p) => p.employeeId === line.employeeId)?._sum.hours?.toNumber() ?? 0,
          permissionHoursPerMonth: allowance,
          hourly: line.payBasis === 'hourly',
          // a day missing its check-out taken as the shift's hours a day until corrected (owner, 25 October 2026: "Not short until corrected")
          hoursADay: person.hoursADay,
        });
        const fields = Object.keys(filled) as ImportedInput[];
        inputs = { ...EMPTY_PAYROLL_INPUTS, ...was, ...(filled as Partial<PayrollInputs>) };
        const same = mark?.source === 'attendance' && sameFields(mark.fields, fields) && sameSources(mark.sources, person.sources) && unchanged(was, inputs);
        if (same) continue;
        // what they were before: HR's figures, or what they were before an earlier fill or import
        next = { source: 'attendance', at, fields, before: figuresBefore(fields, was, mark), sources: person.sources };
        result.filled++;
      } else if (mark?.source === 'attendance') {
        // no days of the system's own left (e.g. Zoho's import undone): what it had before
        const back = Object.fromEntries(mark.fields.map((f) => [f, mark.before?.[f] ?? null])) as Partial<PayrollInputs>;
        inputs = { ...EMPTY_PAYROLL_INPUTS, ...was, ...back };
        next = null;
        result.cleared++;
      } else if (mark?.source === 'zoho' && mark.fields.includes('noShowDays') && person) {
        // a line Zoho's import filled (owner, 21 October 2026, after importing leave: "A day covered by an approved leave
        // … is never a no-show, whatever the source, Zoho attendance included"): its no-show days are its kept days absent
        // as they are now, a day of approved leave read as leave (withLeaveNow), the leave on the line's terms
        const noShowDays = person.days.filter((d) => d.status === 'absent').length;
        if ((was.noShowDays ?? 0) === noShowDays) continue;
        inputs = { ...EMPTY_PAYROLL_INPUTS, ...was, noShowDays };
        next = mark;
        result.leaveCounted++;
      } else continue;

      await this.prisma.payrollLine.update({
        where: { id: line.id },
        data: { inputs: json(inputs), attendanceImport: next ? json(next) : Prisma.DbNull, ...worked(line.terms as unknown as PayrollTerms, inputs, rules, law) },
      });
      await this.audit.record({
        userId: user?.id ?? null,
        action: 'update',
        entityType: LINE,
        entityId: line.id,
        diff: {
          runId: run.id,
          month,
          employeeCode: line.employeeCode,
          ...changes(was as unknown as Record<string, unknown>, inputs as unknown as Record<string, unknown>),
          source: next?.source ?? 'attendance',
          ...(next?.source === 'zoho' ? { importId: next.importId, leaveCounted: true } : next ? { sources: next.sources } : { cleared: true }),
        },
      });
    }
    return result;
  }
}

const sameFields = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((f) => b.includes(f));
const sameSources = (a: readonly string[] | undefined, b: readonly string[]) => !!a && a.length === b.length && a.every((s) => b.includes(s));
const unchanged = (a: PayrollInputs, b: PayrollInputs) => Object.keys(changes(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>)).length === 0;
