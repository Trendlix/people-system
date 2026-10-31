import {
  COMPENSATORY_CASH_RATE_DEFAULT,
  COMPENSATORY_DAY_OFF_LABEL,
  COMPENSATORY_LABEL_AR,
  compensatoryUpcoming,
  isOpenLeave,
  leaveStage,
  type ApproverRole,
  type CompensatoryEligibleDay,
  type CompensatoryOutcome,
  type CompensatoryRules,
  type LeaveDecision,
  type LeaveStage,
  type LeaveStatus,
} from '@trendlix/shared';
import { dayInCairo, fromDateOnly } from '../common/date-only.js';
import type { LeaveSettings, Prisma } from '../generated/prisma/client.js';
import { hrMayCancel, isConfidentialRequest, isRequester, standingInFor, waitsFor, type Caller } from '../leave/access.js';
import { placeOf } from '../leave/views.js';
import type { UserRef } from '../payroll/adjustments/people.js';

// Compensatory day requests as the API sends them (owner, 26 October 2026: "my compensatory is a compensation with
// another day in the same month. and rarely to be compensated in cash"; packages/shared compensatory.ts): shaped as a
// work from home request is (its employee, status, stage, who decides it, the steps), with `kind: 'compensatory'`, the
// day worked, the day off asked for (none for a cash one HR recorded) and HR's decision once approved. Never an amount:
// the cash is a payroll addition in days, seen only by those who see payroll.

export const COMPENSATORY_ENTITY = 'compensatory_request';

/** The Leave Setup's cash rate in days' pay (the owner's 1.5 should the row be missing). */
export const cashRateOf = (s: Pick<LeaveSettings, 'compensatoryCashRate'> | null): number => (s ? s.compensatoryCashRate.toNumber() : COMPENSATORY_CASH_RATE_DEFAULT);

/** A compensatory day off as the lists and the calendar name its "type": Compensatory day off. */
export const COMPENSATORY_TYPE = { id: 'compensatory', key: 'compensatory', nameEn: COMPENSATORY_DAY_OFF_LABEL, nameAr: COMPENSATORY_LABEL_AR } as const;

/** What a request is shown with: its employee and where they work under the employment it is under, its manager and steps. */
export const COMPENSATORY_INCLUDE = {
  employee: {
    select: { id: true, employeeCode: true, fullNameEn: true, fullNameAr: true, employments: { where: { endDate: null }, select: { managerId: true }, take: 1 } },
  },
  employment: { select: { department: { select: { id: true, nameEn: true, parent: { select: { id: true, nameEn: true } } } } } },
  manager: { select: { id: true, fullNameEn: true } },
  steps: { orderBy: { id: 'asc' }, include: { actor: { select: { id: true, email: true } }, onBehalfOf: { select: { id: true, fullNameEn: true } } } },
  // the official duty it goes with (27 October 2026)
  odRequest: { select: { id: true, startDate: true, status: true } },
} satisfies Prisma.CompensatoryRequestInclude;

export type CompensatoryRow = Prisma.CompensatoryRequestGetPayload<{ include: typeof COMPENSATORY_INCLUDE }>;

/** The parties of a request as leave/access.ts takes them, its employee's direct manager now included. */
export const compensatoryParties = (r: Pick<CompensatoryRow, 'employeeId' | 'managerId' | 'employee'>) => ({
  employeeId: r.employeeId,
  managerId: r.managerId,
  currentManagerId: r.employee.employments[0]?.managerId ?? null,
});

/**
 * A request as `caller` sees it: whether it waits for their decision, whether its employee may cancel it (while being
 * decided) and whether HR may (an approved one, not their own). `names`: who took each step, by user id; `noCheckIn`: no
 * check-in is kept on the day worked (HR confirms it on the decision); `cashDays`: the days' pay a cash decision pays now;
 * `today`: in Cairo, for a day worked still to come.
 */
export function compensatoryView(r: CompensatoryRow, caller: Caller, names: ReadonlyMap<string, UserRef>, extra: { noCheckIn: boolean | null; cashDays: number; today: string }) {
  const status = r.status as LeaveStatus;
  const parties = compensatoryParties(r);
  const dayWorked = fromDateOnly(r.dayWorked);
  const dayOff = fromDateOnly(r.dayOff);
  // asked ahead (owner, 31 October 2026: "or choose a future day in the same month only, for upcomming days"): the day
  // worked still to come now, and whether it was when asked; nothing to confirm about a check-in before it comes
  const upcoming = compensatoryUpcoming(dayWorked, extra.today);
  // one an official duty carries is decided and cancelled with it, never by itself (27 October 2026)
  const withOd = r.odRequest !== null;
  return {
    id: r.id,
    kind: 'compensatory' as const,
    employee: { id: r.employee.id, employeeCode: r.employee.employeeCode, fullNameEn: r.employee.fullNameEn, fullNameAr: r.employee.fullNameAr, ...placeOf(r.employment.department) },
    type: COMPENSATORY_TYPE,
    dayWorked,
    dayOff,
    startDate: dayOff ?? dayWorked,
    endDate: dayOff ?? dayWorked,
    reason: r.reason,
    status,
    stage: leaveStage(status),
    outcome: (r.outcome as CompensatoryOutcome | null) ?? null,
    cashDays: extra.cashDays,
    // part of a day worked (27 October 2026): its hours, and the hours off they earned (null: a whole day)
    hoursWorked: r.hoursWorked?.toNumber() ?? null,
    hoursOff: r.hoursOff?.toNumber() ?? null,
    // the official duty it goes with
    od: r.odRequest ? { id: r.odRequest.id, startDate: fromDateOnly(r.odRequest.startDate)!, status: r.odRequest.status as LeaveStatus } : null,
    noCheckIn: upcoming && extra.noCheckIn !== null ? false : extra.noCheckIn,
    upcoming,
    askedAhead: compensatoryUpcoming(dayWorked, dayInCairo(r.createdAt)),
    waitingForYou: !withOd && waitsFor({ ...parties, status }, caller),
    standingInFor: standingInFor(parties, caller),
    confidential: isConfidentialRequest(parties, caller),
    canCancel: !withOd && isRequester(parties, caller) && isOpenLeave(status),
    hrCanCancel: !withOd && hrMayCancel({ ...parties, status }, caller),
    manager: r.manager && { id: r.manager.id, fullNameEn: r.manager.fullNameEn, role: (r.approverRole as ApproverRole | null) ?? 'direct_manager' },
    rejectedStage: r.rejectedStage as LeaveStage | null,
    rejectReason: r.rejectReason,
    recordedByHr: r.recordedByHr,
    warnings: r.warnings,
    steps: r.steps.map((s) => ({
      id: s.id.toString(),
      kind: s.kind,
      decision: s.decision as LeaveDecision | null,
      comment: s.comment,
      actor: s.actor ? (names.get(s.actor.id)?.name ?? s.actor.email) : null,
      onBehalfOf: s.onBehalfOf ? { id: s.onBehalfOf.id, fullNameEn: s.onBehalfOf.fullNameEn } : null,
      at: s.at.toISOString(),
    })),
    createdAt: r.createdAt.toISOString(),
  };
}

export type CompensatoryRequestView = ReturnType<typeof compensatoryView>;

/** A compensatory day off on the leave calendar (GET /compensatory/calendar), shaped as its items are, kind 'compensatory'. */
export interface CompensatoryCalendarItem {
  id: string;
  kind: 'compensatory';
  employee: { id: string; fullNameEn: string; department: string | null; team: string | null };
  type: { id: string; nameEn: string; nameAr: string };
  startDate: string;
  endDate: string;
  halfDay: false;
  status: LeaveStatus;
}

/** The form an employee asks from (GET /me/compensatory/form): what the live checks read, around the month. */
export interface CompensatoryFormView {
  /** Why they can't ask at all (no employment, a freelancer); null: they can. */
  refusal: string | null;
  offered: boolean;
  hasShift: boolean;
  today: string;
  cashDays: number;
  /** The Compensatory Setup (27 October 2026), and the shift's hours a day (null: none), for what part of a day earns. */
  rules: CompensatoryRules;
  hoursADay: number | null;
  /** Their shift's working days (0 = Sunday); Sunday to Thursday without one. */
  workingDays: number[];
  /** The official holidays from the month before to the month after: date and name. */
  holidays: { date: string; nameEn: string }[];
  /** Days they have leave on (approved or being decided), and other days off or claimed: what is on each. */
  leave: { date: string; type: string; status: string }[];
  other: { date: string; what: string }[];
  /** The days worked they asked to compensate already (approved or being decided). */
  claimed: string[];
  /** Days with a check-in kept, in the window. */
  checkedIn: string[];
  /**
   * The days the day worked is picked from (owner, 31 October 2026: "let the employee pick from a drop menu the eligable
   * day, or choose a future day in the same month only, for upcomming days"): those gone by that qualify today, the latest
   * first, then those to come this month (packages/shared compensatoryEligibleDays); none when they can't ask.
   */
  eligibleDays: CompensatoryEligibleDay[];
  from: string;
  to: string;
}
