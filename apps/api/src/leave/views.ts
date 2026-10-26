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
  type LeaveRequestStepKind,
  type LeaveTypeRules,
} from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import type { LeaveSettings, LeaveType, Prisma } from '../generated/prisma/client.js';
import type { UserRef } from '../payroll/adjustments/people.js';
import { hrMayCancel, hiddenRequest, isConfidentialRequest, isRequester, mayEditLeave, seesEveryRequest, standingInFor, waitsFor, type Caller } from './access.js';

// Leave types, the Leave Setup and requests as the API sends them (owner, 18 October 2026): dates YYYY-MM-DD, moments as
// ISO strings, days as numbers (half days allowed).

export const TYPE_ENTITY = 'leave_type';
export const SETTINGS_ENTITY = 'leave_settings';
export const REQUEST_ENTITY = 'leave_request';
export const DOCUMENT_ENTITY = 'leave_document';
export const ADJUSTMENT_ENTITY = 'leave_adjustment';
export const CLOSING_ENTITY = 'leave_year_closing';
export const STAFFING_ENTITY = 'leave_staffing_limit';

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

/**
 * The Leave Setup as the API sends it: the annual leave's numbers, and the permission hours a month and the most a day
 * (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day", "Yes, in Leave Setup").
 */
export const settingsView = (s: LeaveSettings) => ({
  ...settingsRules(s),
  permissionHoursPerMonth: s.permissionHoursPerMonth.toNumber(),
  permissionMaxHoursPerDay: s.permissionMaxHoursPerDay.toNumber(),
  updatedAt: s.updatedAt.toISOString(),
});

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
  // a stand-in's decision: the approver they stood in for (25 October 2026)
  steps: { orderBy: { id: 'asc' }, include: { actor: { select: { id: true, email: true } }, onBehalfOf: { select: { id: true, fullNameEn: true } } } },
  // leave coverage (25 October 2026): the colleague who covers, and the approver's stand-in
  cover: { select: { id: true, fullNameEn: true } },
  standIn: { select: { id: true, fullNameEn: true } },
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
  const endDate = fromDateOnly(r.endDate);
  const requester = isRequester(parties, caller);
  return {
    id: r.id,
    employee: { id: r.employee.id, fullNameEn: r.employee.fullNameEn, fullNameAr: r.employee.fullNameAr, ...placeOf(r.employment.department) },
    type: { id: r.type.id, key: r.type.key, nameEn: r.type.nameEn, nameAr: r.type.nameAr, paid: r.type.paid as LeavePay },
    startDate,
    endDate,
    halfDay: r.halfDay,
    days: r.days.toNumber(),
    reason: r.reason,
    status,
    stage: leaveStage(status),
    waitingForYou: waitsFor({ ...parties, status }, caller),
    // the approver the caller decides it for, standing in (owner, 25 October 2026: "To a stand-in")
    standingInFor: standingInFor(parties, caller),
    // a C-level person's (owner, 19 October 2026): its HR stage is the CEO's
    confidential: isConfidentialRequest(parties, caller),
    canCancel: requester && employeeMayCancelLeave({ status, startDate }, today),
    hrCanCancel: hrMayCancel({ ...parties, status }, caller),
    // a Super Admin edits it, in any status (owner, 26 October 2026)
    canEdit: mayEditLeave(caller.user),
    // imported with Zoho People's or the template's leave: undoing its import removes it, edits too (owner, 26 October 2026)
    imported: r.importId !== null,
    // who decides (or decided) the manager stage, and as what (owner, 19 October 2026: "the person in charge"):
    // APPROVER_ROLES, the direct manager, or for someone without one their team lead, else their department's head
    manager: r.manager && { id: r.manager.id, fullNameEn: r.manager.fullNameEn, role: (r.approverRole as ApproverRole | null) ?? 'direct_manager' },
    rejectedStage: r.rejectedStage as LeaveStage | null,
    rejectReason: r.rejectReason,
    recordedByHr: r.recordedByHr,
    documents: r.documents.map((d) => ({ id: d.id, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes })),
    // leave coverage (owner, 25 October 2026): the colleague who covers and the employee's handover note to them; whether
    // it broke the team's staffing limit when sent (HR approves it too); the approver's stand-in for its days (a person or
    // HR), shown to its employee, HR and the CEO; and whether its employee may change the cover now (being decided, or
    // approved and not ended)
    cover: r.cover && { id: r.cover.id, fullNameEn: r.cover.fullNameEn },
    handoverNote: r.handoverNote,
    overStaffingLimit: r.overStaffingLimit,
    standIn:
      (r.standIn || r.standInHr) && (requester || (seesEveryRequest(caller.user) && !hiddenRequest(parties, caller)))
        ? { employee: r.standIn && { id: r.standIn.id, fullNameEn: r.standIn.fullNameEn }, hr: r.standInHr }
        : null,
    canChangeCover: requester && (status === 'with_manager' || status === 'with_hr' || (status === 'approved' && endDate >= today)),
    steps: r.steps.map((s) => ({
      id: s.id.toString(),
      kind: s.kind as LeaveRequestStepKind,
      decision: s.decision as LeaveDecision | null,
      comment: s.comment,
      actor: s.actor ? (names.get(s.actor.id)?.name ?? s.actor.email) : null,
      onBehalfOf: s.onBehalfOf ? { id: s.onBehalfOf.id, fullNameEn: s.onBehalfOf.fullNameEn } : null,
      at: s.at.toISOString(),
    })),
    balanceAfter,
    createdAt: r.createdAt.toISOString(),
  };
}

export type LeaveRequestView = ReturnType<typeof requestView>;
