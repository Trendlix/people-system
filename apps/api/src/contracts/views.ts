import {
  ENDING_RULE_DEFAULTS,
  insuredWageDate,
  payStage,
  type ContractKind,
  type EndReason,
  type NoticeUnit,
  type PayBasis,
  type RaiseApproval,
  type RaiseReason,
} from '@trendlix/shared';
import { ALLOWANCE_ORDER, allowancesTotal, allowanceView } from '../allowances/rows.js';
import { addDays, fromDateOnly } from '../common/date-only.js';
import type { Contract, Prisma } from '../generated/prisma/client.js';
import { latestNoticeDay } from './notice.js';

// Contracts and endings as the API sends them (dates as YYYY-MM-DD, money as numbers). Used by the contracts module
// and by the employee profile, whose employments show their signed contract and their ending.

/** The non-renewal rule's notice: how long before a fixed term ends the company must say it won't be renewed. */
export interface NonRenewalNotice {
  noticeAmount: number;
  noticeUnit: string;
}

/** What a contract is shown with, besides its own row. */
export interface ContractContext {
  /** HR, Finance and the CEO see salaries (like bank details); everyone else gets null. */
  seesSalary: boolean;
  /** The employment's shift's working days; Sunday to Thursday without a shift. */
  workingDays: readonly number[] | null;
  /** The non-renewal rule's notice (seeded: 45 working days, contract clause 2). */
  nonRenewal: NonRenewalNotice | null;
}

/** An amount of money as a number, to the piastre. */
const money = (value: Prisma.Decimal | null): number | null => (value === null ? null : value.toNumber());

/**
 * What a contract is always loaded with: its allowances, in the kinds' order; for a version that changes the pay (a
 * raise, or a renewal with new pay), who approved it, its promotion and the request it was prepared from.
 */
export const CONTRACT_INCLUDE = {
  allowances: { orderBy: ALLOWANCE_ORDER },
  approvedBy: { select: { email: true } },
  newJobTitle: { select: { id: true, titleEn: true, titleAr: true } },
  newGrade: { select: { id: true, code: true } },
  raiseRequest: { select: { id: true, status: true } },
} satisfies Prisma.ContractInclude;

/** A contract with its allowances. */
export type ContractRow = Prisma.ContractGetPayload<{ include: typeof CONTRACT_INCLUDE }>;

/**
 * The last day to give notice that a fixed term won't be renewed: the non-renewal rule's notice counted back from the
 * end date (45 working days, by the employment's shift). Signed (active) fixed-term contracts only, else null.
 */
export function nonRenewalNoticeBy(c: Pick<Contract, 'form' | 'status' | 'endDate'>, ctx: Omit<ContractContext, 'seesSalary'>): string | null {
  if (c.form !== 'fixed' || c.status !== 'active' || !c.endDate) return null;
  const notice = ctx.nonRenewal ?? ENDING_RULE_DEFAULTS.non_renewal;
  return latestNoticeDay(fromDateOnly(c.endDate), notice.noticeAmount, notice.noticeUnit as NoticeUnit, ctx.workingDays);
}

/**
 * A contract version. The basic salary is `basic_percent` of the gross, the variable salary the rest; the allowances
 * are paid on top of the gross, and the total salary is the two together. By the hour, the gross is the monthly
 * estimate (rate × hours a week × 52 ÷ 12). Salary fields (the hourly rate and the allowances too) are null for anyone
 * but HR, Finance and the CEO, with `salaryHidden: true`.
 */
export function contractView(c: ContractRow, ctx: ContractContext) {
  const grossCents = Math.round(c.grossSalary.toNumber() * 100);
  const basicCents = Math.round((grossCents * c.basicPercent) / 100);
  const allowances = c.allowances.map(allowanceView);
  const allowancesCents = Math.round(allowancesTotal(allowances) * 100);
  const salary = ctx.seesSalary
    ? {
        grossSalary: grossCents / 100,
        basicPercent: c.basicPercent,
        basicSalary: basicCents / 100,
        variableSalary: (grossCents - basicCents) / 100,
        netSalary: money(c.netSalary),
        insuredSalary: money(c.insuredSalary),
        hourlyRate: money(c.hourlyRate),
        allowances,
        allowancesTotal: allowancesCents / 100,
        totalSalary: (grossCents + allowancesCents) / 100,
      }
    : {
        grossSalary: null,
        basicPercent: c.basicPercent,
        basicSalary: null,
        variableSalary: null,
        netSalary: null,
        insuredSalary: null,
        hourlyRate: null,
        allowances: null,
        allowancesTotal: null,
        totalSalary: null,
      };
  return {
    id: c.id,
    number: c.number,
    version: c.version,
    form: c.form,
    startDate: fromDateOnly(c.startDate),
    endDate: fromDateOnly(c.endDate),
    durationMonths: c.durationMonths,
    probationMonths: c.probationMonths,
    probationEnd: fromDateOnly(c.probationEnd),
    payBasis: c.payBasis as PayBasis,
    hoursPerWeek: money(c.hoursPerWeek),
    daysPerWeek: c.daysPerWeek,
    ...salary,
    jobTitleEn: c.jobTitleEn,
    jobTitleAr: c.jobTitleAr,
    gradeCode: c.gradeCode,
    departmentName: c.departmentName,
    shiftCode: c.shiftCode,
    status: c.status,
    signedOn: fromDateOnly(c.signedOn),
    insuranceFiledOn: fromDateOnly(c.insuranceFiledOn),
    labourOfficeFiledOn: fromDateOnly(c.labourOfficeFiledOn),
    note: c.note,
    nonRenewalNoticeBy: nonRenewalNoticeBy(c, ctx),
    salaryHidden: !ctx.seesSalary,
    kind: c.kind as ContractKind,
    stage: payStage(c),
    raise: raiseView(c, ctx.seesSalary),
  };
}

export type ContractView = ReturnType<typeof contractView>;

/**
 * A version that changes the pay (a raise, or a renewal with new pay; owner's decisions, 16 October 2026): why, the
 * CEO's step, the promotion with it, Form 2 and from when the insured wage follows it. Null for one that doesn't. The
 * CEO's reason for returning it may name amounts: only for those who see salaries.
 */
export function raiseView(c: ContractRow, seesSalary: boolean) {
  if (c.approval === null) return null;
  const startDate = fromDateOnly(c.startDate)!;
  const form2From = fromDateOnly(c.form2From);
  return {
    reason: c.raiseReason as RaiseReason,
    approval: c.approval as RaiseApproval,
    sentAt: c.sentAt,
    approvedBy: c.approvedBy && { email: c.approvedBy.email },
    approvedAt: c.approvedAt,
    returnedReason: seesSalary ? c.returnedReason : null,
    newJobTitle: c.newJobTitle && { id: c.newJobTitle.id, titleEn: c.newJobTitle.titleEn, titleAr: c.newJobTitle.titleAr },
    newGrade: c.newGrade && { id: c.newGrade.id, code: c.newGrade.code },
    form2From,
    insuredWageFrom: insuredWageDate(startDate, form2From),
    requestId: c.raiseRequest?.id ?? null,
  };
}

/** The department as a contract names it: a team as "Department › Team", as the screens show it. */
export function departmentName(d: { nameEn: string; parent: { nameEn: string } | null } | null): string | null {
  if (!d) return null;
  return d.parent ? `${d.parent.nameEn} › ${d.nameEn}` : d.nameEn;
}

/**
 * What the company-wide contracts list loads with each contract: its allowances, and its employment, person, job title,
 * department and shift.
 */
export const CONTRACT_LIST_INCLUDE = {
  ...CONTRACT_INCLUDE,
  employment: {
    select: {
      id: true,
      employmentType: true,
      endDate: true,
      employee: { select: { id: true, employeeCode: true, fullNameEn: true, fullNameAr: true } },
      jobTitle: { select: { titleEn: true } },
      department: { select: { nameEn: true, parent: { select: { nameEn: true } } } },
      shift: { select: { workingDays: true } },
    },
  },
} satisfies Prisma.ContractInclude;

export type ContractListRow = Prisma.ContractGetPayload<{ include: typeof CONTRACT_LIST_INCLUDE }>;

/**
 * A contract in the company-wide list (GET /contracts), with its person and employment. The job title and department
 * are what was signed (the contract's snapshot); a draft, not signed yet, shows the employment's current ones. The
 * salary follows contractView's rule.
 */
export function contractListView(c: ContractListRow, ctx: ContractContext) {
  const v = contractView(c, ctx);
  const e = c.employment;
  const signed = c.status !== 'draft';
  return {
    id: v.id,
    number: v.number,
    version: v.version,
    form: v.form,
    status: v.status,
    startDate: v.startDate,
    endDate: v.endDate,
    probationMonths: v.probationMonths,
    probationEnd: v.probationEnd,
    signedOn: v.signedOn,
    insuranceFiledOn: v.insuranceFiledOn,
    labourOfficeFiledOn: v.labourOfficeFiledOn,
    nonRenewalNoticeBy: v.nonRenewalNoticeBy,
    payBasis: v.payBasis,
    hoursPerWeek: v.hoursPerWeek,
    daysPerWeek: v.daysPerWeek,
    grossSalary: v.grossSalary,
    hourlyRate: v.hourlyRate,
    allowances: v.allowances,
    allowancesTotal: v.allowancesTotal,
    totalSalary: v.totalSalary,
    insuredSalary: v.insuredSalary,
    salaryHidden: v.salaryHidden,
    kind: v.kind,
    stage: v.stage,
    employee: { id: e.employee.id, employeeCode: e.employee.employeeCode, fullNameEn: e.employee.fullNameEn, fullNameAr: e.employee.fullNameAr },
    employmentId: e.id,
    employmentType: e.employmentType,
    employmentCurrent: e.endDate === null,
    jobTitleEn: signed ? c.jobTitleEn : (e.jobTitle?.titleEn ?? null),
    departmentName: signed ? c.departmentName : departmentName(e.department),
  };
}

export type ContractListView = ReturnType<typeof contractListView>;

/** What an ending is shown with: its rule, who approved it, and the end date of its employment once it ended. */
export const ENDING_INCLUDE = {
  rule: { select: { label: true, endReason: true } },
  hrApprovedBy: { select: { email: true } },
  ceoDecidedBy: { select: { email: true } },
  employment: { select: { endDate: true } },
} satisfies Prisma.EmploymentEndingInclude;

export type EndingRow = Prisma.EmploymentEndingGetPayload<{ include: typeof ENDING_INCLUDE }>;

/**
 * How an ending ends the employment: its rule's end reason, except an ending during probation, which is a resignation
 * when the employee ends it and a termination when the company does.
 */
export function endReasonOf(ruleKey: string, ruleEndReason: string, initiator: string | null): EndReason {
  if (ruleKey === 'probation') return initiator === 'employee' ? 'resigned' : 'terminated';
  return ruleEndReason as EndReason;
}

/**
 * An ending. Once completed it has its deadlines: the final dues within 7 days of the end (Art. 108), and the filing
 * at the labour office within 15 days (Decree 214/2025).
 */
export function endingView(e: EndingRow) {
  const endDate = fromDateOnly(e.employment.endDate ?? e.lastWorkingDay);
  return {
    id: e.id,
    ruleKey: e.ruleKey,
    ruleLabel: e.rule.label,
    initiator: e.initiator,
    noticeGivenOn: fromDateOnly(e.noticeGivenOn),
    payInLieu: e.payInLieu,
    lastWorkingDay: fromDateOnly(e.lastWorkingDay),
    certifiedOffice: e.certifiedOffice,
    certifiedSerial: e.certifiedSerial,
    certifiedOn: fromDateOnly(e.certifiedOn),
    decisionDueOn: fromDateOnly(e.decisionDueOn),
    reason: e.reason,
    note: e.note,
    status: e.status,
    hrApprovedBy: e.hrApprovedBy && { email: e.hrApprovedBy.email },
    hrApprovedAt: e.hrApprovedAt,
    ceoDecidedBy: e.ceoDecidedBy && { email: e.ceoDecidedBy.email },
    ceoDecidedAt: e.ceoDecidedAt,
    ceoNote: e.ceoNote,
    completedAt: e.completedAt,
    endReason: endReasonOf(e.ruleKey, e.rule.endReason, e.initiator),
    deadlines: e.status === 'completed' ? { finalDuesBy: addDays(endDate, 7), labourOfficeFilingBy: addDays(endDate, 15) } : null,
  };
}

export type EndingView = ReturnType<typeof endingView>;
