import {
  employeeMayCancelLeave,
  leaveStage,
  type ApproverRole,
  type LeaveBalanceKind,
  type LeaveDecision,
  type LeaveGender,
  type LeaveKind,
  type LeavePay,
  type LeaveRules,
  type LeaveStage,
  type LeaveStatus,
  type LeaveStepKind,
  type LeaveTypeRules,
} from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import type { LeaveSettings, LeaveType, Prisma } from '../generated/prisma/client.js';
import type { UserRef } from '../payroll/adjustments/people.js';
import { hrMayCancel, isConfidentialRequest, isRequester, waitsFor, type Caller } from './access.js';

// Leave types, the Leave Setup and requests as the API sends them (owner, 18 October 2026): dates YYYY-MM-DD, moments as
// ISO strings, days as numbers (half days allowed).

export const TYPE_ENTITY = 'leave_type';
export const SETTINGS_ENTITY = 'leave_settings';
export const REQUEST_ENTITY = 'leave_request';
export const DOCUMENT_ENTITY = 'leave_document';
export const ADJUSTMENT_ENTITY = 'leave_adjustment';
export const CLOSING_ENTITY = 'leave_year_closing';

const num = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : d.toNumber());

/** A type's rules as the shared rules take them. */
export function rulesOf(t: LeaveType): LeaveTypeRules {
  return {
    kind: t.kind as LeaveKind,
    nameEn: t.nameEn,
    paid: t.paid as LeavePay,
    payPercent: num(t.payPercent),
    balance: t.balance as LeaveBalanceKind,
    daysPerYear: t.daysPerYear,
    maxPerRequest: t.maxPerRequest,
    maxTimesInService: t.maxTimesInService,
    minServiceMonths: t.minServiceMonths,
    noticeDays: t.noticeDays,
    documentRequired: t.documentRequired,
    gender: t.gender as LeaveGender | null,
    calendarDays: t.calendarDays,
    halfDays: t.halfDays,
  };
}

/** A type as Leave Setup lists it: its key, names and rules, whether it is on, and (for HR, the CEO and Admins) how many requests it has. */
export function typeView(t: LeaveType & { _count?: { requests: number } }) {
  return {
    id: t.id,
    key: t.key,
    ...rulesOf(t),
    nameAr: t.nameAr,
    active: t.active,
    sortOrder: t.sortOrder,
    ...(t._count && { requests: t._count.requests }),
  };
}

export type LeaveTypeView = ReturnType<typeof typeView>;

export const COUNT_REQUESTS = { _count: { select: { requests: true } } } as const;

/** The Leave Setup's annual leave numbers as the shared rules take them. */
export function settingsRules(s: LeaveSettings): LeaveRules {
  return {
    firstYearDays: s.firstYearDays,
    standardDays: s.standardDays,
    longServiceDays: s.longServiceDays,
    longServiceYears: s.longServiceYears,
    longServiceAge: s.longServiceAge,
    disabilityDays: s.disabilityDays,
    hazardousExtraDays: s.hazardousExtraDays,
    firstYearMinMonths: s.firstYearMinMonths,
    settleWithinYears: s.settleWithinYears,
  };
}

export const settingsView = (s: LeaveSettings) => ({ ...settingsRules(s), updatedAt: s.updatedAt.toISOString() });

/**
 * What a request is shown with: its employee and where they work under the employment it is under, their direct manager
 * now (who sees it too), its type, the manager it was sent to, its documents (never their files) and steps.
 */
export const REQUEST_INCLUDE = {
  employee: {
    select: { id: true, employeeCode: true, fullNameEn: true, fullNameAr: true, employments: { where: { endDate: null }, select: { managerId: true }, take: 1 } },
  },
  employment: { select: { department: { select: { id: true, nameEn: true, parent: { select: { id: true, nameEn: true } } } } } },
  type: true,
  manager: { select: { id: true, fullNameEn: true } },
  documents: { orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }], select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
  steps: { orderBy: { id: 'asc' }, include: { actor: { select: { id: true, email: true } } } },
} satisfies Prisma.LeaveRequestInclude;

export type RequestRow = Prisma.LeaveRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

/** Where the employee works: a team as its department and the team. */
export function placeOf(d: { nameEn: string; parent: { nameEn: string } | null } | null): { department: string | null; team: string | null } {
  if (!d) return { department: null, team: null };
  return d.parent ? { department: d.parent.nameEn, team: d.nameEn } : { department: d.nameEn, team: null };
}

/** The parties of a request as access.ts takes them, its employee's direct manager now included. */
export const partiesOf = (r: Pick<RequestRow, 'employeeId' | 'managerId' | 'employee'>) => ({
  employeeId: r.employeeId,
  managerId: r.managerId,
  currentManagerId: r.employee.employments[0]?.managerId ?? null,
});

/**
 * A request as `caller` sees it: whether it waits for their decision, whether its employee may cancel it (theirs, being
 * decided or approved and not started: canCancel) and whether HR may (an approved one, not their own: hrCanCancel).
 * `names`: who took each step, by user id; `balanceAfter`: the annual balance left once it is taken (a type from the
 * annual balance, being decided or approved), else null.
 */
export function requestView(r: RequestRow, caller: Caller, names: ReadonlyMap<string, UserRef>, balanceAfter: number | null, today: string) {
  const status = r.status as LeaveStatus;
  const parties = partiesOf(r);
  const startDate = fromDateOnly(r.startDate);
  return {
    id: r.id,
    employee: { id: r.employee.id, fullNameEn: r.employee.fullNameEn, fullNameAr: r.employee.fullNameAr, ...placeOf(r.employment.department) },
    type: { id: r.type.id, key: r.type.key, nameEn: r.type.nameEn, nameAr: r.type.nameAr, paid: r.type.paid as LeavePay },
    startDate,
    endDate: fromDateOnly(r.endDate),
    halfDay: r.halfDay,
    days: r.days.toNumber(),
    reason: r.reason,
    status,
    stage: leaveStage(status),
    waitingForYou: waitsFor({ ...parties, status }, caller),
    // a C-level person's (owner, 19 October 2026): its HR stage is the CEO's
    confidential: isConfidentialRequest(parties, caller),
    canCancel: isRequester(parties, caller) && employeeMayCancelLeave({ status, startDate }, today),
    hrCanCancel: hrMayCancel({ ...parties, status }, caller),
    // who decides (or decided) the manager stage, and as what (owner, 19 October 2026: "the person in charge"):
    // APPROVER_ROLES, the direct manager, or for someone without one their team lead, else their department's head
    manager: r.manager && { id: r.manager.id, fullNameEn: r.manager.fullNameEn, role: (r.approverRole as ApproverRole | null) ?? 'direct_manager' },
    rejectedStage: r.rejectedStage as LeaveStage | null,
    rejectReason: r.rejectReason,
    recordedByHr: r.recordedByHr,
    documents: r.documents.map((d) => ({ id: d.id, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes })),
    steps: r.steps.map((s) => ({
      id: s.id.toString(),
      kind: s.kind as LeaveStepKind,
      decision: s.decision as LeaveDecision | null,
      comment: s.comment,
      actor: s.actor ? (names.get(s.actor.id)?.name ?? s.actor.email) : null,
      at: s.at.toISOString(),
    })),
    balanceAfter,
    createdAt: r.createdAt.toISOString(),
  };
}

export type LeaveRequestView = ReturnType<typeof requestView>;
