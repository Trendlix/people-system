import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { todayInCairo } from '../common/date-only.js';
import { monthsLater } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RecountDaysDto } from './recount-days.dto.js';
import { HoursByPairsService, type RecountResult } from './hours-by-pairs.service.js';

/** The most months one recount takes. */
export const RECOUNT_MONTHS_MAX = 12;

/** What the preview and the run answer: the pass's counts for the months and shift asked. */
export interface RecountDaysView {
  from: string;
  to: string;
  shiftId: string | null;
  /** The months recounted (draft or no payroll yet), and those skipped with the status of their payroll. */
  months: string[];
  skipped: { month: string; status: string }[];
  days: number;
  people: number;
  zohoDays: number;
  /** The days that would change / changed, by any field; and those whose hours changed. */
  daysChanged: number;
  hoursChanged: number;
  peopleChanged: number;
  hoursBefore: number;
  hoursAfter: number;
  correctedDays: number;
  linesRefilled: number;
}

// Recount past days (owner, 26 October 2026, after changing the MORNING shift to 8:00 AM–8:00 PM, 9 hours, grace 0,
// counting until 8:00 PM: "i want to recount previous payrolls on the new shift run"; asked earlier, "Months not yet
// paid"): Organization → Shifts, for HR and a Super Admin (developers never: they only see). From and To months (at
// most 12, up to this month), optionally one shift; a preview counts what would change, the run changes it. Every
// kept day with times in a month whose payroll isn't with the CEO, approved or paid is made again on the shift of the
// employment it falls in, as now (shifts keep no history): the system's days from their presses, Zoho People's from their
// pairs or, Excel's, their first and last (HoursByPairsService with `zoho`); the corrected days over them made again; the
// draft runs refilled for the people whose days changed. The times are never changed. A month with the CEO, approved or
// paid is listed and left as it is. One audit entry for the run with its scope and counts; run again, nothing changes.
// Run in the request: a day is one update and only the days that change are written (measured in the tests, not
// minutes), under the pass's own lock and a transaction of up to two minutes.
@Injectable()
export class RecountDaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pairs: HoursByPairsService,
    private readonly audit: AuditService,
  ) {}

  /** What a recount of these months and shift would do; nothing is written. */
  async preview(dto: RecountDaysDto): Promise<RecountDaysView> {
    const scope = await this.scopeOf(dto);
    const result = await this.pairs.recount({ months: scope.months, shiftId: scope.shiftId, zoho: true, dryRun: true });
    return this.view(dto, scope.shiftId, result!);
  }

  /** The recount, audited. */
  async run(dto: RecountDaysDto, user: SessionUser): Promise<RecountDaysView> {
    const scope = await this.scopeOf(dto);
    const result = await this.pairs.recount({ months: scope.months, shiftId: scope.shiftId, zoho: true }, user);
    if (!result) throw new ConflictException('Another recount is running. Try again in a moment.');
    const view = this.view(dto, scope.shiftId, result);
    await this.audit.record({
      userId: user.id,
      action: 'recount_past_days',
      entityType: 'attendance_day',
      entityId: scope.shiftId,
      diff: {
        from: dto.from,
        to: dto.to,
        shiftId: scope.shiftId,
        months: view.months,
        monthsSkipped: view.skipped,
        daysRecounted: result.daysRecounted,
        zohoDays: result.zohoDays,
        daysWritten: result.daysWritten,
        daysChanged: result.daysChanged,
        peopleChanged: result.peopleChanged,
        hoursBefore: result.hoursBefore,
        hoursAfter: result.hoursAfter,
        correctedDays: result.correctedDays,
        correctedDaysChanged: result.correctedDaysChanged,
        linesRefilled: result.linesRefilled,
      },
    });
    return view;
  }

  private async scopeOf(dto: RecountDaysDto) {
    const thisMonth = todayInCairo().slice(0, 7);
    if (dto.to > thisMonth) throw new BadRequestException(['Choose months up to this month.']);
    if (dto.from > dto.to) throw new BadRequestException(['The first month can’t be after the last.']);
    const months: string[] = [];
    for (let m = dto.from; m <= dto.to; m = monthsLater(m, 1)) months.push(m);
    if (months.length > RECOUNT_MONTHS_MAX) throw new BadRequestException([`Recount at most ${RECOUNT_MONTHS_MAX} months at a time.`]);
    const shiftId = dto.shiftId ?? null;
    if (shiftId && !(await this.prisma.shift.findUnique({ where: { id: shiftId }, select: { id: true } }))) throw new NotFoundException('Shift not found.');
    return { months, shiftId };
  }

  private view(dto: RecountDaysDto, shiftId: string | null, r: RecountResult): RecountDaysView {
    return {
      from: dto.from,
      to: dto.to,
      shiftId,
      months: r.months,
      skipped: r.monthsLocked.map((month) => ({ month, status: r.lockedStatus[month] ?? 'approved' })),
      days: r.daysRecounted,
      people: r.people,
      zohoDays: r.zohoDays,
      daysChanged: r.daysWritten,
      hoursChanged: r.daysChanged,
      peopleChanged: r.peopleChanged,
      hoursBefore: r.hoursBefore,
      hoursAfter: r.hoursAfter,
      correctedDays: r.correctedDays,
      linesRefilled: r.linesRefilled,
    };
  }
}
