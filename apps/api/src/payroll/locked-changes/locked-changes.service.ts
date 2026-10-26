import { Injectable, NotFoundException } from '@nestjs/common';
import type { PayrollStatus } from '@trendlix/shared';
import { AuditService } from '../../audit/audit.service.js';
import type { SessionUser } from '../../auth/session-user.js';
import { fromDateOnly, shownDate, toDateOnly } from '../../common/date-only.js';
import { ConfidentialService } from '../../employees/confidential.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { NoticesService } from '../../notifications/notices.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { placeName, refOf, userNames, type UserRef } from '../adjustments/people.js';
import { personOf, type PersonRef } from '../adjustments/views.js';
import { firstDay } from '../months.js';
import {
  LOCKED_CHANGE_ACTION_LABELS,
  LOCKED_CHANGE_KIND_LABELS,
  LOCKED_PAYROLL_STATUSES,
  lockedChangeWarning,
  lockedMonthsOf,
  type LockedChangeAction,
  type LockedChangeHandling,
  type LockedChangeKind,
  type LockedMonth,
} from './locked-changes.js';
import type { HandleLockedChangeDto } from './locked-changes.dto.js';

const ENTITY = 'payroll_locked_change';

/** A change to flag: whose, which request, what was done to it (`change`), and the days it covers (YYYY-MM-DD). */
export interface LockedChangeInput {
  employeeId: string;
  kind: LockedChangeKind;
  requestId: string;
  change: LockedChangeAction;
  from: string;
  to: string;
}

/** A flagged change as Unsettled lists it (GET /payroll/unsettled, lockedChanges). */
export interface LockedChangeView {
  id: string;
  employee: PersonRef;
  department: string | null;
  /** YYYY-MM, and the run's status when the change was made. */
  month: string;
  runStatus: PayrollStatus;
  kind: LockedChangeKind;
  kindLabel: string;
  requestId: string;
  action: LockedChangeAction;
  actionLabel: string;
  fromDate: string;
  toDate: string;
  /** The request in a few words: "Annual leave, 03/07/2026–04/07/2026". */
  summary: string;
  createdAt: Date;
  createdBy: UserRef | null;
  handled: { at: Date; by: UserRef | null; how: LockedChangeHandling; note: string | null } | null;
}

const ROW = {
  id: true,
  month: true,
  runStatus: true,
  requestKind: true,
  requestId: true,
  action: true,
  fromDate: true,
  toDate: true,
  summary: true,
  createdAt: true,
  handledAt: true,
  handledHow: true,
  handledNote: true,
  employee: { select: { id: true, employeeCode: true, fullNameEn: true, employments: { orderBy: { joinDate: 'desc' }, take: 1, select: { department: { select: { nameEn: true, parent: { select: { nameEn: true } } } } } } } },
  createdBy: { select: { id: true, email: true } },
  handledBy: { select: { id: true, email: true } },
} satisfies Prisma.PayrollLockedChangeSelect;

type Row = Prisma.PayrollLockedChangeGetPayload<{ select: typeof ROW }>;

// Leave and attendance changes in a month whose payroll has moved on (owner's brief, 27 October 2026, after the proof of
// the night before: with July's run with the CEO, HR recording leave in July answered 201 approved with no warning, and
// the line was unchanged; the same for cancelling, deciding, and permissions). A run with the CEO, approved or paid keeps
// its lines for good, so such a change is allowed but never silent: a row a month here (payroll_locked_changes), in the
// audit log; HR and Finance told (the CEO for a C-level person); the API's view answers with the warning, and the
// request's view carries the months (payrollLocked) so its page says "Not in July 2026's payroll". Unsettled lists the
// rows until HR marks one handled (corrected by hand on a later payroll), or the month's run returns to draft and is
// refilled (PayrollService.refresh, LeavePayrollService.syncDrafts), which handles them as refilled. A table of its own
// rather than a flag on each request: one query lists every kind, the handling is explicit (who, when, how), and a refill
// clears a month without touching the requests. Never the request's reason: its kind, days and type alone.
@Injectable()
export class PayrollLockedChangesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notices: NoticesService,
    private readonly confidential: ConfidentialService,
  ) {}

  /** The months among the days' whose payroll keeps its lines, from the runs as they are now. */
  async lockedMonths(from: string, to: string): Promise<LockedMonth[]> {
    const runs = await this.prisma.payrollRun.findMany({
      where: { status: { in: [...LOCKED_PAYROLL_STATUSES] }, month: { gte: toDateOnly(firstDay(from.slice(0, 7))), lte: toDateOnly(firstDay(to.slice(0, 7))) } },
      select: { month: true, status: true },
    });
    return lockedMonthsOf([{ from, to }], runs.map((r) => ({ month: fromDateOnly(r.month).slice(0, 7), status: r.status })));
  }

  /**
   * Flags a change whose days fall in a month whose payroll has moved on: a row a month, in the audit log, HR and Finance
   * told. Answers the warnings for the API's view, one a month; none when every month touched is still open, and then
   * nothing is written. `user`: who made the change (null: the system).
   */
  async flag(input: LockedChangeInput, user: SessionUser | null): Promise<string[]> {
    const months = await this.lockedMonths(input.from, input.to);
    if (!months.length) return [];
    const [summary, person] = await Promise.all([
      this.summaryOf(input.kind, input.requestId),
      this.prisma.employee.findUnique({ where: { id: input.employeeId }, select: { fullNameEn: true } }),
    ]);
    for (const m of months) {
      const row = await this.prisma.payrollLockedChange.create({
        data: {
          employeeId: input.employeeId,
          month: toDateOnly(firstDay(m.month)),
          runStatus: m.status,
          requestKind: input.kind,
          requestId: input.requestId,
          action: input.change,
          fromDate: toDateOnly(input.from),
          toDate: toDateOnly(input.to),
          summary,
          createdById: user?.id ?? null,
        },
        select: { id: true },
      });
      await this.audit.record({
        userId: user?.id ?? null,
        action: 'create',
        entityType: ENTITY,
        entityId: row.id,
        diff: { employeeId: input.employeeId, month: m.month, runStatus: m.status, requestKind: input.kind, requestId: input.requestId, change: input.change, days: { from: input.from, to: input.to }, summary },
      });
      await this.notices.payrollLockedChange(input.employeeId, {
        name: person?.fullNameEn ?? 'An employee',
        kindLabel: LOCKED_CHANGE_KIND_LABELS[input.kind],
        action: LOCKED_CHANGE_ACTION_LABELS[input.change],
        month: m.month,
        status: m.status,
      });
    }
    return months.map(lockedChangeWarning);
  }

  /** The months (YYYY-MM) still to handle, by request id, for the requests' views: "Not in July 2026's payroll". */
  async openMonthsOf(kind: LockedChangeKind, requestIds: readonly string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (!requestIds.length) return out;
    const rows = await this.prisma.payrollLockedChange.findMany({
      where: { requestKind: kind, requestId: { in: [...requestIds] }, handledAt: null },
      orderBy: { month: 'asc' },
      select: { requestId: true, month: true },
    });
    for (const r of rows) {
      const month = fromDateOnly(r.month).slice(0, 7);
      const months = out.get(r.requestId) ?? [];
      if (!months.includes(month)) out.set(r.requestId, [...months, month]);
    }
    return out;
  }

  /** The changes still to handle, the oldest month first then the oldest change, without `hidden`'s (a C-level person's, 19 October 2026). */
  async open(hidden: readonly string[] = []): Promise<LockedChangeView[]> {
    const rows = await this.prisma.payrollLockedChange.findMany({
      where: { handledAt: null, ...(hidden.length && { employeeId: { notIn: [...hidden] } }) },
      orderBy: [{ month: 'asc' }, { createdAt: 'asc' }],
      select: ROW,
    });
    return this.views(rows);
  }

  /** HR marks a change handled, by hand on a later payroll, with a note; one handled already stays as it is. */
  async handle(id: string, dto: HandleLockedChangeDto, user: SessionUser): Promise<LockedChangeView> {
    const row = await this.prisma.payrollLockedChange.findUnique({ where: { id }, select: ROW });
    if (!row || (await this.confidential.hiddenFrom(user)).includes(row.employee.id)) throw new NotFoundException('This change was not found.');
    if (row.handledAt) return (await this.views([row]))[0];
    const note = dto.note ?? null;
    const after = await this.prisma.payrollLockedChange.update({
      where: { id },
      data: { handledAt: new Date(), handledById: user.id, handledHow: 'by_hand', handledNote: note },
      select: ROW,
    });
    await this.audit.record({
      userId: user.id,
      action: 'handled',
      entityType: ENTITY,
      entityId: id,
      diff: { employeeId: row.employee.id, month: fromDateOnly(row.month).slice(0, 7), requestKind: row.requestKind, requestId: row.requestId, how: 'by_hand', ...(note && { note }) },
    });
    return (await this.views([after]))[0];
  }

  /**
   * The month's changes still to handle are handled by a refill: the run returned to draft and worked out again with the
   * requests as they are now (PayrollService.refresh: everyone's; LeavePayrollService.syncDrafts: `employeeIds`'). `user`:
   * who refilled (null: the system).
   */
  async refilled(month: string, employeeIds: readonly string[] | null, user: SessionUser | null): Promise<void> {
    const rows = await this.prisma.payrollLockedChange.findMany({
      where: { month: toDateOnly(firstDay(month)), handledAt: null, ...(employeeIds && { employeeId: { in: [...employeeIds] } }) },
      select: { id: true, employeeId: true, requestKind: true, requestId: true },
    });
    if (!rows.length) return;
    await this.prisma.payrollLockedChange.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { handledAt: new Date(), handledById: user?.id ?? null, handledHow: 'refilled' } });
    for (const r of rows) {
      await this.audit.record({
        userId: user?.id ?? null,
        action: 'refilled',
        entityType: ENTITY,
        entityId: r.id,
        diff: { employeeId: r.employeeId, month, requestKind: r.requestKind, requestId: r.requestId, how: 'refilled' },
      });
    }
  }

  // ---------- helpers ----------

  /** The request in a few words, for the row and the notices: its type and days, never its reason. */
  private async summaryOf(kind: LockedChangeKind, requestId: string): Promise<string> {
    const span = (from: Date, to: Date) => (fromDateOnly(from) === fromDateOnly(to) ? shownDate(fromDateOnly(from)) : `${shownDate(fromDateOnly(from))}–${shownDate(fromDateOnly(to))}`);
    switch (kind) {
      case 'leave': {
        const r = await this.prisma.leaveRequest.findUnique({ where: { id: requestId }, select: { startDate: true, endDate: true, halfDay: true, type: { select: { nameEn: true } } } });
        return r ? `${r.type.nameEn}, ${span(r.startDate, r.endDate)}${r.halfDay ? ' (half a day)' : ''}` : 'Leave';
      }
      case 'permission': {
        const r = await this.prisma.permissionRequest.findUnique({ where: { id: requestId }, select: { date: true, hours: true } });
        return r ? `Permission, ${shownDate(fromDateOnly(r.date))}, ${r.hours.toNumber()} h` : 'Permission';
      }
      case 'wfh': {
        const r = await this.prisma.wfhRequest.findUnique({ where: { id: requestId }, select: { date: true } });
        return r ? `Work from home, ${shownDate(fromDateOnly(r.date))}` : 'Work from home';
      }
      case 'od': {
        const r = await this.prisma.odRequest.findUnique({ where: { id: requestId }, select: { startDate: true, endDate: true, fullDay: true } });
        return r ? `Official duty, ${span(r.startDate, r.endDate)}${r.fullDay ? '' : ' (part of the day)'}` : 'Official duty';
      }
    }
  }

  private async views(rows: readonly Row[]): Promise<LockedChangeView[]> {
    const names = await userNames(this.prisma, rows.flatMap((r) => [r.createdBy, r.handledBy]));
    return rows.map((r) => ({
      id: r.id,
      employee: personOf(r.employee),
      department: placeName(r.employee.employments[0]?.department ?? null),
      month: fromDateOnly(r.month).slice(0, 7),
      runStatus: r.runStatus as PayrollStatus,
      kind: r.requestKind as LockedChangeKind,
      kindLabel: LOCKED_CHANGE_KIND_LABELS[r.requestKind as LockedChangeKind] ?? r.requestKind,
      requestId: r.requestId,
      action: r.action as LockedChangeAction,
      actionLabel: LOCKED_CHANGE_ACTION_LABELS[r.action as LockedChangeAction] ?? r.action,
      fromDate: fromDateOnly(r.fromDate),
      toDate: fromDateOnly(r.toDate),
      summary: r.summary,
      createdAt: r.createdAt,
      createdBy: refOf(names, r.createdBy),
      handled: r.handledAt ? { at: r.handledAt, by: refOf(names, r.handledBy), how: r.handledHow as LockedChangeHandling, note: r.handledNote } : null,
    }));
  }
}
