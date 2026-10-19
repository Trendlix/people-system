import {
  becameOpenEnded,
  casualTooLong,
  ENDING_RULE_DEFAULTS,
  insuredWageDate,
  isTrainingType,
  payStage,
  traineeMonths,
  traineeStageOn,
  trainingNext,
  workPatternOf,
  type ContractForm,
  type ContractKind,
  type EndReason,
  type NoticeUnit,
  type PayBasis,
  type RaiseApproval,
  type RaiseReason,
  type RaiseRequestOrigin,
  type TraineeStage,
  type WorkNature,
} from '@trendlix/shared';
import { ALLOWANCE_ORDER, allowancesTotal, allowanceView } from '../allowances/rows.js';
import { addDays, addMonths, fromDateOnly, todayInCairo } from '../common/date-only.js';
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
  /** The employment's end, for the Art. 88 warning (becameOpenEnded); a current one's when not given. */
  employmentEndDate?: Date | null;
  /** The employment's casual work past six months (Art. 1(7)), shown with its contracts; false when not given. */
  casualTooLong?: boolean;
  /**
   * A trainee's or an intern's employment: the versions that are its agreements (agreementVersions), to tell the first
   * from its renewal; null or not given for another employment type.
   */
  agreements?: readonly number[] | null;
}

/**
 * An employment's agreements, by version (owner, 19 October 2026: a trainee's training agreement or an intern's
 * internship agreement, "renewed 1 time, after that it should be converted to a full time contract"): its whole
 * contracts (not salary amendments) other than a conversion to full-time, for a trainee's or an intern's employment;
 * null for another type. The first is agreement 1, its renewal agreement 2.
 */
export function agreementVersions(employmentType: string, contracts: readonly { version: number; kind: string; convertsTo: string | null }[]): number[] | null {
  if (!isTrainingType(employmentType)) return null;
  return contracts
    .filter((c) => c.kind === 'contract' && c.convertsTo === null)
    .map((c) => c.version)
    .sort((a, b) => a - b);
}

/** Which of its employment's agreements a version is (1: the first, 2: its renewal), 0 for one that isn't. */
export function agreementNumber(c: Pick<Contract, 'version' | 'kind' | 'convertsTo'>, agreements: readonly number[] | null | undefined): number {
  if (!agreements || c.kind !== 'contract' || c.convertsTo !== null) return 0;
  return agreements.filter((v) => v <= c.version).length;
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
  // and where it came from: asked for, or prepared directly by HR (19 October 2026)
  raiseRequest: { select: { id: true, status: true, origin: true } },
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

/** A contract's training stages (a trainee's training agreement, Labour Law Art. 29), as kept; null for none. */
export function traineeStagesOf(c: Pick<Contract, 'traineeStages'>): TraineeStage[] | null {
  const stages = c.traineeStages;
  if (!Array.isArray(stages) || !stages.length) return null;
  return stages.map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return { name: typeof o.name === 'string' ? o.name : '', months: Number(o.months), pay: Number(o.pay) };
  });
}

/**
 * Whether a signed fixed-term contract has become open-ended (owner, 18 October 2026; Labour Law 14/2025 Art. 88(3):
 * "إذا كان مبرما لمدة محددة واستمر الطرفان فى تنفيذه بعد انتهاء هذه المدة دون اتفاق مكتوب بينهما"): the contract in
 * force (signed: a signed renewal would have replaced it) is past its end date and the employment goes on. A warning
 * for HR to renew it in writing or end the employment; nothing changes on its own.
 */
export function contractBecameOpenEnded(c: Pick<Contract, 'form' | 'status' | 'endDate'>, employmentEndDate: Date | null | undefined, today = todayInCairo()): boolean {
  if (c.status !== 'active') return false;
  return becameOpenEnded({ form: c.form, endDate: fromDateOnly(c.endDate), renewedOrEnded: !!employmentEndDate }, today);
}

/**
 * Whether casual work has gone on past the law's six months (owner, 18 October 2026; Art. 1(7): casual work "لا يستغرق
 * إنجازه أكثر من ستة أشهر"): counted from the join date to today, or to the day the employment ended.
 */
export function employmentCasualTooLong(e: { workNature: string; joinDate: Date; endDate: Date | null }, today = todayInCairo()): boolean {
  if (e.workNature !== 'casual') return false;
  const end = fromDateOnly(e.endDate);
  return casualTooLong(fromDateOnly(e.joinDate), end && end < today ? end : today);
}

/** An employment's fields by the labour law (owner, 18 October 2026), as the views send them. */
export function lawFieldsOf(e: { workArrangement: string; paidByCommission: boolean; workNature: string; joinDate: Date; endDate: Date | null }) {
  return {
    paidByCommission: e.paidByCommission,
    workNature: e.workNature as WorkNature,
    workPattern: workPatternOf(e.workArrangement),
    casualTooLong: employmentCasualTooLong(e),
  };
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
  // a trainee's training stages (Art. 29): their pay is salary data, the names and months not
  const stages = traineeStagesOf(c);
  const today = todayInCairo();
  const inForce = stages && traineeStageOn(stages, fromDateOnly(c.startDate), today < fromDateOnly(c.startDate) ? fromDateOnly(c.startDate) : today);
  // a trainee's or an intern's agreement (owner, 19 October 2026): which one it is and what follows its end (renewed
  // once, then converted to full-time or ended), never due for renewal as a fixed term is: no non-renewal notice, and no
  // Art. 88 warning (an employment contract's)
  const agreement = agreementNumber(c, ctx.agreements);
  return {
    id: c.id,
    number: c.number,
    version: c.version,
    form: c.form as ContractForm,
    // for a specific job (Art. 155)
    jobToDo: c.jobToDo,
    traineeStages: stages && (ctx.seesSalary ? stages : stages.map((st) => ({ ...st, pay: null }))),
    traineeMonths: stages && traineeMonths(stages),
    // the stage in force today (the first before the start): its number from 1, name and pay
    traineeStage: inForce && { number: inForce.index + 1, name: inForce.name, pay: ctx.seesSalary ? inForce.pay : null },
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
    nonRenewalNoticeBy: agreement ? null : nonRenewalNoticeBy(c, ctx),
    // a fixed term past its end with the employment going on and no signed renewal (Art. 88(3)); the employment's
    // casual work past six months (Art. 1(7))
    becameOpenEnded: agreement ? false : contractBecameOpenEnded(c, ctx.employmentEndDate, today),
    // a trainee's or an intern's agreement converted to a full-time contract by this version (19 October 2026)
    convertsTo: c.convertsTo,
    training: agreement ? { agreement, next: trainingNext(agreement) } : null,
    casualTooLong: ctx.casualTooLong ?? false,
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
    // asked for, or prepared directly by HR (owner, 19 October 2026: every raise has its request on Raise Requests)
    requestOrigin: (c.raiseRequest?.origin as RaiseRequestOrigin | undefined) ?? null,
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
      paidByCommission: true,
      workNature: true,
      workArrangement: true,
      joinDate: true,
      endDate: true,
      employee: { select: { id: true, employeeCode: true, fullNameEn: true, fullNameAr: true } },
      jobTitle: { select: { titleEn: true } },
      department: { select: { nameEn: true, parent: { select: { nameEn: true } } } },
      shift: { select: { workingDays: true } },
      // its versions, to tell a trainee's or an intern's agreements apart (agreementVersions)
      contracts: { select: { version: true, kind: true, convertsTo: true } },
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
  const e = c.employment;
  const law = lawFieldsOf(e);
  const v = contractView(c, { ...ctx, employmentEndDate: e.endDate, casualTooLong: law.casualTooLong, agreements: agreementVersions(e.employmentType, e.contracts) });
  const signed = c.status !== 'draft';
  return {
    id: v.id,
    number: v.number,
    version: v.version,
    form: v.form,
    jobToDo: v.jobToDo,
    traineeMonths: v.traineeMonths,
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
    convertsTo: v.convertsTo,
    training: v.training,
    employee: { id: e.employee.id, employeeCode: e.employee.employeeCode, fullNameEn: e.employee.fullNameEn, fullNameAr: e.employee.fullNameAr },
    employmentId: e.id,
    employmentType: e.employmentType,
    // by the labour law (owner, 18 October 2026): paid by commission, the nature of the work, remote work, and the
    // warnings: the fixed term become open-ended (Art. 88(3)), casual work past 6 months (Art. 1(7))
    ...law,
    becameOpenEnded: v.becameOpenEnded,
    employmentCurrent: e.endDate === null,
    jobTitleEn: signed ? c.jobTitleEn : (e.jobTitle?.titleEn ?? null),
    departmentName: signed ? c.departmentName : departmentName(e.department),
  };
}

export type ContractListView = ReturnType<typeof contractListView>;

/**
 * What an ending's view reads of its employment: the end date once it ended; the join date and the last signed
 * contract's pay, for the Art. 154 estimate of a fixed term not renewed.
 */
export const ENDING_EMPLOYMENT = {
  endDate: true,
  joinDate: true,
  // a trainee's or an intern's: no Art. 154 note (19 October 2026)
  employmentType: true,
  contracts: {
    where: { status: { in: ['active', 'ended'] } },
    orderBy: { version: 'desc' },
    take: 1,
    select: { grossSalary: true, allowances: { select: { amount: true } } },
  },
} satisfies Prisma.EmploymentSelect;

/** What an ending is shown with: its rule, who approved it, and of its employment what the view reads (ENDING_EMPLOYMENT). */
export const ENDING_INCLUDE = {
  rule: { select: { label: true, endReason: true } },
  hrApprovedBy: { select: { email: true } },
  ceoDecidedBy: { select: { email: true } },
  employment: { select: ENDING_EMPLOYMENT },
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
 * A fixed term the company doesn't renew (owner, 18 October 2026): Labour Law 14/2025 Art. 154 ends a fixed-term
 * contract when its term runs out ("ينتهى عقد العمل محدد المدة بانقضاء مدته"), and adds "فإذا كان الإنهاء من جانب صاحب
 * العمل استحق العامل مكافأة تعادل أجر شهر عن كل سنة من سنوات الخدمة". Whether that applies to a term of five years or
 * less is for the company's lawyer: the ending says so, with an estimate, and moves no money.
 */
export const ART_154_NOTE = "Under Art. 154 the employee may be owed one month's wage for each year of service — check with your lawyer";

/** Whole months from one date to the next: 1 January to 31 December is 11, to 1 January next year 12. */
function fullMonths(from: string, to: string): number {
  let months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
  if (addMonths(from, months) > to) months--;
  return Math.max(0, months);
}

/**
 * Art. 154's estimate for a fixed term the company doesn't renew: the years of service, from the join date to the last
 * working day (in whole months, as years to two decimals), × the last monthly wage (the last signed contract's gross and
 * allowances). The wage and the amount are salary data: null for those who don't see salaries. Information only.
 */
export function art154Estimate(e: Pick<EndingRow, 'lastWorkingDay'> & { employment: Pick<EndingRow['employment'], 'joinDate' | 'contracts'> }, seesSalary: boolean) {
  const months = fullMonths(fromDateOnly(e.employment.joinDate), addDays(fromDateOnly(e.lastWorkingDay), 1));
  const serviceYears = Math.round((months / 12) * 100) / 100;
  const [last] = e.employment.contracts;
  const wageCents = last ? Math.round(last.grossSalary.toNumber() * 100) + last.allowances.reduce((sum, a) => sum + Math.round(a.amount.toNumber() * 100), 0) : null;
  const amount = wageCents === null ? null : Math.round((wageCents * months) / 12) / 100;
  return { serviceYears, lastMonthlyWage: seesSalary && wageCents !== null ? wageCents / 100 : null, amount: seesSalary ? amount : null };
}

/**
 * An ending. Once completed it has its deadlines: the final dues within 7 days of the end (Art. 108), and the filing
 * at the labour office within 15 days (Decree 214/2025). A fixed term the company doesn't renew carries Art. 154's note
 * and estimate (the amounts for those who see salaries).
 */
export function endingView(e: EndingRow, seesSalary = false) {
  const endDate = fromDateOnly(e.employment.endDate ?? e.lastWorkingDay);
  // not for a trainee's or an intern's agreement, which isn't an employment contract (owner, 19 October 2026)
  const nonRenewal = e.ruleKey === 'non_renewal' && !isTrainingType(e.employment.employmentType);
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
    art154Note: nonRenewal ? ART_154_NOTE : null,
    art154Estimate: nonRenewal ? art154Estimate(e, seesSalary) : null,
  };
}

export type EndingView = ReturnType<typeof endingView>;
