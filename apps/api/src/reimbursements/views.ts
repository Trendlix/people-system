import {
  isOpenReimbursement,
  reimbursementStage,
  type AdjustmentStatus,
  type ApproverRole,
  type ReimbursementDecision,
  type ReimbursementRules,
  type ReimbursementStage,
  type ReimbursementStatus,
  type ReimbursementStepKind,
  type ReimbursementUse,
} from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import type { Prisma, ReimbursementType } from '../generated/prisma/client.js';
import type { UserRef } from '../payroll/adjustments/people.js';
import { isClaimant, waitsFor, type Caller } from './access.js';

// Reimbursement types and claims as the API sends them (owner, 18 October 2026): dates YYYY-MM-DD, the moments as ISO
// strings, money as numbers to the piaster.

export const TYPE_ENTITY = 'reimbursement_type';
export const CLAIM_ENTITY = 'reimbursement_claim';
export const RECEIPT_ENTITY = 'reimbursement_receipt';

const money = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : d.toNumber());

/** A type's conditions as the shared rules take them. */
export function rulesOf(t: ReimbursementType): ReimbursementRules {
  return {
    receiptRequired: t.receiptRequired,
    capPerClaim: money(t.capPerClaim),
    capPerMonth: money(t.capPerMonth),
    capPerYear: money(t.capPerYear),
    claimWithinDays: t.claimWithinDays,
    departmentIds: t.departmentIds,
    gradeIds: t.gradeIds,
    employmentTypes: t.employmentTypes,
  };
}

/** A type as Payroll Setup lists it (HR, Finance and the CEO), with how many claims it has. */
export function typeView(t: ReimbursementType & { _count: { claims: number } }) {
  return {
    id: t.id,
    nameEn: t.nameEn,
    nameAr: t.nameAr,
    description: t.description,
    ...rulesOf(t),
    active: t.active,
    claims: t._count.claims,
  };
}

export type ReimbursementTypeView = ReturnType<typeof typeView>;

/** A type as the employee is offered it: its names and conditions, without who may claim it, and what their claims already take of its caps. */
export function myTypeView(t: ReimbursementType, use: ReimbursementUse) {
  const rules = rulesOf(t);
  return {
    id: t.id,
    nameEn: t.nameEn,
    nameAr: t.nameAr,
    description: t.description,
    receiptRequired: rules.receiptRequired,
    capPerClaim: rules.capPerClaim,
    capPerMonth: rules.capPerMonth,
    capPerYear: rules.capPerYear,
    claimWithinDays: rules.claimWithinDays,
    active: t.active,
    usedInMonth: use.usedInMonth,
    usedInYear: use.usedInYear,
  };
}

export const COUNT_CLAIMS = { _count: { select: { claims: true } } } as const;

/** What a claim is shown with: its person and where they work, its type, manager, payroll addition, receipts (never their files) and steps. */
export const CLAIM_INCLUDE = {
  employee: { select: { id: true, employeeCode: true, fullNameEn: true, fullNameAr: true } },
  employment: { select: { department: { select: { nameEn: true, parent: { select: { nameEn: true } } } } } },
  type: { select: { id: true, nameEn: true, nameAr: true, receiptRequired: true } },
  manager: { select: { id: true, fullNameEn: true } },
  adjustment: { select: { status: true, month: true } },
  receipts: { orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }], select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
  steps: { orderBy: { id: 'asc' }, include: { actor: { select: { id: true, email: true } } } },
} satisfies Prisma.ReimbursementClaimInclude;

export type ClaimRow = Prisma.ReimbursementClaimGetPayload<{ include: typeof CLAIM_INCLUDE }>;

/** Where the employee worked when they claimed it: a team as its department and the team. */
export function placeOf(d: { nameEn: string; parent: { nameEn: string } | null } | null): { department: string | null; team: string | null } {
  if (!d) return { department: null, team: null };
  return d.parent ? { department: d.parent.nameEn, team: d.nameEn } : { department: d.nameEn, team: null };
}

/**
 * A claim as `caller` sees it: whether it waits for their decision and whether they may cancel it (theirs, still
 * open). `names`: who took each step, by user id; `photos`: the picture beside the name, for HR and the CEO, who see the
 * employee file (otherwise none).
 */
export function claimView(r: ClaimRow, caller: Caller, names: ReadonlyMap<string, UserRef>, photos: ReadonlyMap<string, string> | null) {
  const status = r.status as ReimbursementStatus;
  return {
    id: r.id,
    employee: {
      id: r.employee.id,
      fullNameEn: r.employee.fullNameEn,
      fullNameAr: r.employee.fullNameAr,
      photoId: photos?.get(r.employee.id) ?? null,
      ...placeOf(r.employment.department),
    },
    type: { id: r.type.id, nameEn: r.type.nameEn, nameAr: r.type.nameAr, receiptRequired: r.type.receiptRequired },
    expenseDate: fromDateOnly(r.expenseDate),
    amount: r.amount.toNumber(),
    approvedAmount: money(r.approvedAmount),
    description: r.description,
    status,
    stage: reimbursementStage(status),
    waitingForYou: waitsFor(r, caller),
    canCancel: isClaimant(r, caller) && isOpenReimbursement(status),
    // who decides (or decided) the manager stage, and as what (owner, 19 October 2026: "the person in charge"):
    // APPROVER_ROLES, the direct manager, or for someone without one their team lead, else their department's head
    manager: r.manager && { id: r.manager.id, fullNameEn: r.manager.fullNameEn, role: (r.approverRole as ApproverRole | null) ?? 'direct_manager' },
    rejectedStage: r.rejectedStage as ReimbursementStage | null,
    rejectReason: r.rejectReason,
    payMonth: fromDateOnly(r.payMonth),
    // its Reimbursement addition, as Additions / Deductions has it now (HR may move it to a later month, or cancel it)
    payroll: r.adjustment && { status: r.adjustment.status as AdjustmentStatus, runMonth: fromDateOnly(r.adjustment.month) },
    receipts: r.receipts.map((x) => ({ id: x.id, fileName: x.fileName, mimeType: x.mimeType, sizeBytes: x.sizeBytes })),
    steps: r.steps.map((s) => ({
      id: s.id.toString(),
      kind: s.kind as ReimbursementStepKind,
      decision: s.decision as ReimbursementDecision | null,
      amount: money(s.amount),
      comment: s.comment,
      payMonth: fromDateOnly(s.payMonth),
      actor: s.actor ? (names.get(s.actor.id)?.name ?? s.actor.email) : null,
      at: s.at.toISOString(),
    })),
    createdAt: r.createdAt.toISOString(),
  };
}

export type ReimbursementClaimView = ReturnType<typeof claimView>;
