import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  agreementName,
  CASUAL_MAX_MONTHS,
  INTERN_DEFAULT_MONTHS,
  INTERN_MAX_MONTHS,
  INTERN_NO_WAGE_MESSAGE,
  INTERN_TERM_MESSAGE,
  insuredWageOf,
  isTrainingType,
  monthlyFromHourly,
  noProbationMessage,
  renewedOnceMessage,
  samePay,
  traineeMonths,
  traineeProblems,
  TRAINING_RENEWALS,
  trainingEndsText,
  trainingNext,
  type ContractForm,
  type ContractStatus,
  type PayBasis,
  type PayTerms,
  type RaiseReason,
  type EmploymentType,
  type TraineeStage,
} from '@trendlix/shared';
import { AllowancesService } from '../allowances/allowances.service.js';
import { allowanceData, allowancesTotal, allowanceView, type AllowanceSnapshot } from '../allowances/rows.js';
import { AuditService, changes, type AuditEntry } from '../audit/audit.service.js';
import { assertDeletes, isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { addDays, addMonths, fromDateOnly, shownDate, toDateOnly, todayInCairo } from '../common/date-only.js';
import { seesSalary } from '../employees/access.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { EmployeesService } from '../employees/employees.service.js';
import { Prisma, type EmployeeStatus } from '../generated/prisma/client.js';
import { LawRatesService } from '../payroll/law-rates/law-rates.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ContractSettingsService } from './contract-settings.service.js';
import { dropDirectRequest, openDirectRequest, syncDirectRequest } from './direct-requests.js';
import { checkedPromotion } from './promotion.js';
import { recordStep } from './raise-request-steps.js';
import {
  MAX_MONEY,
  PROBATION_CAP_MESSAGE,
  type CreateContractDto,
  type ListContractsDto,
  type SignContractDto,
  type UpdateContractDto,
} from './contracts.dto.js';
import {
  agreementNumber,
  agreementVersions,
  CONTRACT_INCLUDE,
  CONTRACT_LIST_INCLUDE,
  contractBecameOpenEnded,
  contractListView,
  contractView,
  departmentName,
  employmentCasualTooLong,
  nonRenewalNoticeBy,
  traineeStagesOf,
  type ContractContext,
  type ContractRow,
  type NonRenewalNotice,
} from './views.js';

const ENTITY = 'contract';
/** The database, or a transaction in it. */
type Db = PrismaService | Prisma.TransactionClient;
/** Undoing a signing is for a Super Admin only, like deleting (owner's decision, 15 October 2026). */
export const ONLY_SUPER_ADMIN_UNSIGNS = 'Only a Super Admin can undo a signing.';
const DATE_FIELDS = ['startDate', 'endDate', 'probationEnd', 'signedOn', 'insuranceFiledOn', 'labourOfficeFiledOn', 'form2From'] as const;
/**
 * Restricted (HR, Finance, CEO): the audit log only says they changed, as for bank details. A trainee's training stages
 * too, as each has its pay (18 October 2026).
 */
export const SALARY_FIELDS = ['grossSalary', 'netSalary', 'insuredSalary', 'hourlyRate', 'allowances', 'traineeStages'];
/** A contract's terms: a draft takes them, a signed contract never changes them. */
const TERMS = [
  'form',
  'jobToDo',
  'endDate',
  'traineeStages',
  'startDate',
  'durationMonths',
  'probationMonths',
  'grossSalary',
  'basicPercent',
  'netSalary',
  'payBasis',
  'hourlyRate',
  'hoursPerWeek',
  'daysPerWeek',
  'allowances',
  'raiseReason',
] as const;
const GROSS_MESSAGE = 'Enter the gross salary as an amount, e.g. 12000 or 12000.50.';

/** An employee as the alert lists name them. */
const EMPLOYEE_REF = { select: { id: true, employeeCode: true, fullNameEn: true } } as const;

/** The employment a contract belongs to: its dates and status, its person, and what a contract copies when signed. */
const EMPLOYMENT = {
  id: true,
  employeeId: true,
  // a trainee's contract is the training agreement (owner, 18 October 2026; Labour Law 14/2025 Arts. 28–29)
  employmentType: true,
  workNature: true, // for the casual work warning on its contracts (Art. 1(7))
  joinDate: true,
  endDate: true,
  status: true,
  probationEnd: true,
  jobTitleId: true,
  departmentId: true,
  gradeId: true,
  employee: { select: { fullNameEn: true, dateOfBirth: true } },
  jobTitle: { select: { titleEn: true, titleAr: true } },
  grade: { select: { code: true } },
  department: { select: { nameEn: true, parent: { select: { nameEn: true } } } },
  shift: { select: { code: true, workingDays: true } },
} satisfies Prisma.EmploymentSelect;

export type EmploymentRow = Prisma.EmploymentGetPayload<{ select: typeof EMPLOYMENT }>;

/** Adding a version takes a dozen queries or more, in one transaction: more than the default 5 seconds on a busy server. */
const TX_TIMEOUT_MS = 20_000;

/** At most this many contracts in the company-wide list. */
const LIST_CAP = 500;

/**
 * The company-wide list's order, a group at a time: signed contracts by end date, soonest first, then drafts, newest
 * first, then the rest (ended, superseded) by start date, newest first.
 */
const LIST_GROUPS: { statuses: readonly ContractStatus[]; orderBy: Prisma.ContractOrderByWithRelationInput[] }[] = [
  { statuses: ['active'], orderBy: [{ endDate: { sort: 'asc', nulls: 'last' } }, { number: 'asc' }] },
  { statuses: ['draft'], orderBy: [{ createdAt: 'desc' }, { number: 'desc' }] },
  { statuses: ['ended', 'superseded'], orderBy: [{ startDate: 'desc' }, { number: 'desc' }] },
];

/** The terms to work out a contract from: as sent, or as the draft has them. */
export interface TermsInput {
  /** Its length (CONTRACT_FORMS): fixed unless sent. */
  form?: ContractForm;
  /** For a specific job: the job (required), and the day it is expected to be done (optional). */
  jobToDo?: string | null;
  endDate?: string | null;
  /** A trainee's training agreement: its stages (required then). */
  traineeStages?: readonly TraineeStage[] | null;
  /**
   * A trainee's or an intern's agreement converted to a full-time contract by this version (19 October 2026): its terms
   * are that type's, and it takes an employment contract's probation; null or left out for the others.
   */
  convertsTo?: EmploymentType | null;
  startDate?: string;
  durationMonths?: number | null;
  probationMonths?: number;
  basicPercent?: number;
  netSalary?: number | null;
  payBasis: PayBasis;
  /** A monthly salary's gross; by the hour it is worked out from the next two. */
  grossSalary?: number | null;
  hourlyRate?: number | null;
  hoursPerWeek?: number | null;
  daysPerWeek?: number | null;
  /** With their kinds' names and treatment (see AllowancesService.snapshot). */
  allowances: readonly AllowanceSnapshot[];
}

/** A contract's allowances in one order (by kind), to compare them. */
export function comparable(rows: readonly AllowanceSnapshot[]) {
  return [...rows]
    .sort((a, b) => a.allowanceTypeId.localeCompare(b.allowanceTypeId))
    .map(({ allowanceTypeId, nameEn, nameAr, taxable, insured, amount }) => ({ allowanceTypeId, nameEn, nameAr, taxable, insured, amount }));
}

/** A contract's own columns as the API sends them (dates as YYYY-MM-DD, money as numbers), for comparing and the audit log. */
export function fields(c: ContractRow) {
  return {
    number: c.number,
    form: c.form as ContractForm,
    jobToDo: c.jobToDo,
    traineeStages: traineeStagesOf(c),
    startDate: fromDateOnly(c.startDate),
    endDate: fromDateOnly(c.endDate),
    durationMonths: c.durationMonths,
    probationMonths: c.probationMonths,
    probationEnd: fromDateOnly(c.probationEnd),
    payBasis: c.payBasis as PayBasis,
    grossSalary: c.grossSalary.toNumber(),
    hourlyRate: c.hourlyRate?.toNumber() ?? null,
    hoursPerWeek: c.hoursPerWeek?.toNumber() ?? null,
    daysPerWeek: c.daysPerWeek,
    basicPercent: c.basicPercent,
    netSalary: c.netSalary?.toNumber() ?? null,
    insuredSalary: c.insuredSalary.toNumber(),
    allowances: comparable(c.allowances.map(allowanceView)),
    status: c.status,
    signedOn: fromDateOnly(c.signedOn),
    insuranceFiledOn: fromDateOnly(c.insuranceFiledOn),
    labourOfficeFiledOn: fromDateOnly(c.labourOfficeFiledOn),
    note: c.note,
    kind: c.kind,
    raiseReason: c.raiseReason,
    approval: c.approval,
    newJobTitleId: c.newJobTitleId,
    newGradeId: c.newGradeId,
    form2From: fromDateOnly(c.form2From),
    convertsTo: c.convertsTo,
    sentAt: c.sentAt?.toISOString() ?? null,
    approvedById: c.approvedById,
    approvedAt: c.approvedAt?.toISOString() ?? null,
    returnedReason: c.returnedReason,
  };
}

/**
 * The CEO's step after HR changes a draft: none once its pay is the version before's again; an approved one stays
 * approved while only its note changes, and goes back to a draft for HR to send again once its terms change.
 */
function approvalAfterChange(before: ContractRow, step: { raiseReason: RaiseReason | null; approval: 'draft' | null }, termsChanged: boolean): Record<string, unknown> {
  if (step.approval === null) return { raiseReason: null, approval: null, sentAt: null, approvedById: null, approvedAt: null, returnedReason: null };
  if (before.approval === 'approved' && !termsChanged) return {};
  return { raiseReason: step.raiseReason, approval: 'draft', approvedById: null, approvedAt: null };
}

/** A version's pay, to compare with another's (samePay). */
export function payTermsOf(c: { payBasis: string; grossSalary: number | Prisma.Decimal; hourlyRate: number | Prisma.Decimal | null; hoursPerWeek: number | Prisma.Decimal | null; basicPercent: number; allowances: readonly { allowanceTypeId: string; amount: number | Prisma.Decimal }[] }): PayTerms {
  const n = (v: number | Prisma.Decimal) => (typeof v === 'number' ? v : v.toNumber());
  return {
    payBasis: c.payBasis,
    grossSalary: n(c.grossSalary),
    hourlyRate: c.hourlyRate === null ? null : n(c.hourlyRate),
    hoursPerWeek: c.hoursPerWeek === null ? null : n(c.hoursPerWeek),
    basicPercent: c.basicPercent,
    allowances: c.allowances.map((a) => ({ allowanceTypeId: a.allowanceTypeId, amount: n(a.amount) })),
  };
}

/** A version with no CEO step: its pay is the one before's, or it is the first. */
export const NO_PAY_CHANGE = { raiseReason: null, approval: null } as const;

/**
 * The CEO's step a new version takes (owner's decisions, 16 October 2026: "HR, then the CEO"; a renewal with new pay
 * counts as a raise): none when its pay is the version before's; else it needs a reason, and is a draft for HR to send
 * to the CEO, who approves it before it is signed.
 */
export function payChangeStep(previous: { version: number } & Parameters<typeof payTermsOf>[0], pay: PayTerms, reason: RaiseReason | null | undefined) {
  if (samePay(payTermsOf(previous), pay)) return NO_PAY_CHANGE;
  if (!reason) {
    throw new BadRequestException(
      `The pay changes from version ${previous.version}: choose why (annual raise, performance raise, counter-offer raise, promotion, market adjustment, cost of living or other). The CEO approves a change of pay before it is signed.`,
    );
  }
  return { raiseReason: reason, approval: 'draft' as const };
}

/** The values as Prisma writes them: no training stages is the database's null (a JSON column). */
type Written<T> = { [K in keyof T]: K extends 'traineeStages' ? Exclude<T[K], null> | typeof Prisma.DbNull : T[K] };

/** What Prisma writes: YYYY-MM-DD strings become dates; no training stages, the database's null. */
export function toData<T extends Record<string, unknown>>(values: T): Written<T> {
  const data: Record<string, unknown> = { ...values };
  for (const key of DATE_FIELDS) if (typeof data[key] === 'string') data[key] = toDateOnly(data[key]);
  if (data.traineeStages === null) data.traineeStages = Prisma.DbNull;
  return data as Written<T>;
}

/**
 * Salary values (the hourly rate and the allowances too) never go to the audit log: only the fact that they were set or
 * changed. One left empty says nothing, so it stays as it is.
 */
export function salaryMasked<T extends Record<string, unknown>>(diff: T): T {
  const out: Record<string, unknown> = { ...diff };
  for (const key of SALARY_FIELDS) {
    const value = out[key];
    if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) out[key] = 'changed';
  }
  return out as T;
}

export function assertCurrent(e: Pick<EmploymentRow, 'endDate'>) {
  if (e.endDate) {
    throw new ConflictException(`This employment ended on ${shownDate(fromDateOnly(e.endDate))}: contracts are only added and signed for a current employment.`);
  }
}

function assertNotFuture(date: string | null | undefined, what: string) {
  if (date && date > todayInCairo()) throw new BadRequestException(`The ${what} date can't be in the future.`);
}

// Contracts (owner's decisions, 15 October 2026, checked against Labour Law 14/2025): every employment type has a
// fixed-term contract of 12 months, renewed in writing before it expires. Since 18 October 2026 ("can we update the
// employment types based on the labour law?") a contract may instead be open-ended (no end, no renewal: it ends by
// notice, Art. 156) or for a specific job (Art. 155), fixed-term staying the default; a trainee's is the written training
// agreement (Arts. 28–29), its stages' pay rising to at least the minimum wage, the gross the first stage's pay.
// Version 1 starts on the join date with 3 months of probation, once per employer (Art. 90): none for someone who
// already had one with the company. A renewal is a new version, starting the day after the one before ends, with no
// probation; signing it supersedes the one before. The pay is a monthly gross, or by the hour (part-time), when the
// gross is the monthly estimate, rate × hours a week × 52 ÷ 12; allowances are paid on top of it, each kind taxed or not
// and insured or not (owner's requests, 15 October 2026). The insured salary is the gross and the insured allowances,
// capped at the start year's maximum insurable wage. HR adds, changes and signs contracts; anyone who may see the
// employment reads them, the salary only HR, Finance and the CEO.
// A trainee's training agreement and an intern's internship agreement (owner, 19 October 2026: "interns to be labeled
// trainees instead of probation and their contracts are never renewed", then "or can be only renewed 1 time, after that
// it should be converted to a full time contract"): no probation; renewed once at most; then converted to a full-time
// contract, the employment's next version (convertsTo), whose signing makes the employment full-time with a first
// contract's probation, or ended (Training completed). An intern's ("we are not paying them salary, its just
// transportation allowance") pays no wage: the gross is 0, the allowances on top, a short fixed term (3 months, 12 at
// most), nothing insured.
@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
    private readonly settings: ContractSettingsService,
    private readonly allowances: AllowancesService,
    private readonly lawRates: LawRatesService,
    private readonly confidential: ConfidentialService,
  ) {}

  /** An employment's contract versions, newest first. */
  async list(employeeId: string, employmentId: string, user: SessionUser) {
    const employment = await this.employment(employeeId, employmentId, user);
    const rows = await this.prisma.contract.findMany({ where: { employmentId }, orderBy: { version: 'desc' }, include: CONTRACT_INCLUDE });
    const ctx = await this.context(user, employment, rows);
    // a change of pay not signed yet stays with those who see salaries until it is (as an ending waiting for the CEO
    // never reaches the employee first)
    return rows.filter((c) => ctx.seesSalary || c.status !== 'draft' || c.approval === null).map((c) => contractView(c, ctx));
  }

  /**
   * Every contract in the company (HR, Finance and the CEO), with its person and employment: draft and active ones
   * unless a status is asked for, filtered by form, employment type and a search on the person's name, code or the
   * contract number. `endingWithin` keeps signed contracts ending within that many days, those already past their
   * end included. At most 500, in the order of LIST_GROUPS.
   */
  async listAll(query: ListContractsDto, user: SessionUser) {
    const wanted: readonly ContractStatus[] = query.status ? [query.status] : ['draft', 'active'];
    const statuses = query.endingWithin === undefined ? wanted : wanted.filter((s) => s === 'active');
    const text = query.q ? { contains: query.q, mode: 'insensitive' as const } : null;
    const where: Prisma.ContractWhereInput = {
      // not a C-level person's, for anyone but the CEO and a Super Admin (owner, 19 October 2026)
      AND: [{ employment: await this.confidential.ownedWhere(user) }],
      ...(query.form && { form: query.form }),
      ...(query.type && { employment: { employmentType: query.type } }),
      ...(query.endingWithin !== undefined && { endDate: { lte: toDateOnly(addDays(todayInCairo(), query.endingWithin)) } }),
      ...(text && {
        OR: [{ number: text }, { employment: { employee: { OR: [{ fullNameEn: text }, { fullNameAr: text }, { employeeCode: text }] } } }],
      }),
    };
    const [groups, nonRenewal] = await Promise.all([
      Promise.all(
        LIST_GROUPS.map(({ statuses: group, orderBy }) => {
          const these = group.filter((s) => statuses.includes(s));
          if (!these.length) return Promise.resolve([]);
          return this.prisma.contract.findMany({ where: { ...where, status: { in: these } }, orderBy, take: LIST_CAP, include: CONTRACT_LIST_INCLUDE });
        }),
      ),
      this.nonRenewal(),
    ]);
    const sees = seesSalary(user);
    return groups
      .flat()
      .slice(0, LIST_CAP)
      .map((c) => contractListView(c, { seesSalary: sees, workingDays: c.employment.shift?.workingDays ?? null, nonRenewal }));
  }

  /**
   * A new version: the first contract, or a renewal of the signed one. One draft at a time. A renewal copies the
   * version before's allowances as they are unless others are sent; its pay is sent afresh.
   */
  async create(employeeId: string, employmentId: string, dto: CreateContractDto, user: SessionUser) {
    // in one transaction: a renewal with new pay gets its raise request with it (19 October 2026)
    const { row, employment, audit, requestAudit } = await this.prisma.$transaction((tx) => this.draft(employeeId, employmentId, dto, user, tx), { timeout: TX_TIMEOUT_MS });
    await this.audit.record(audit);
    if (requestAudit) await this.audit.record(requestAudit);
    return contractView(row, await this.context(user, employment));
  }

  /**
   * What adding a version writes, in `db`: a transaction when hiring drafts the first contract with the employment, all
   * or nothing (HiringService: hiring in one form, owner's decision, 16 October 2026), or a renewal (create). Answers the
   * new row, its employment and the audit entries, which the caller records once the row is saved: the version's, and
   * for a renewal with new pay its raise request's, prepared directly by HR (owner, 19 October 2026: every raise on Raise
   * Requests), made in `db` with it.
   */
  async draft(employeeId: string, employmentId: string, dto: CreateContractDto, user: SessionUser, db: Db = this.prisma) {
    const employment = await this.employment(employeeId, employmentId, user, db);
    assertCurrent(employment);
    const versions = await db.contract.findMany({ where: { employmentId }, orderBy: { version: 'desc' }, include: CONTRACT_INCLUDE });
    const draft = versions.find((v) => v.status === 'draft');
    if (draft) throw new ConflictException(`Version ${draft.version} (${draft.number}) is still a draft. Sign or delete it before adding another.`);
    const previous = versions[0] ?? null;
    if (previous && previous.status !== 'active') throw new ConflictException(`Sign version ${previous.version} first: a renewal follows a signed contract.`);
    // an open-ended contract runs until it is ended by notice (Labour Law Art. 156: "إذا كان عقد العمل غير محدد المدة،
    // جاز لأى من طرفيه إنهاؤه بشرط أن يخطر الطرف الآخر كتابة قبل الإنهاء بثلاثة أشهر"): nothing to renew
    if (previous?.form === 'open_ended') {
      throw new ConflictException(`${previous.number} is open-ended: it isn't renewed, it runs until it is ended by notice (Labour Law Art. 156). To change its pay, add a raise.`);
    }
    // a trainee's training agreement or an intern's internship agreement (owner, 19 October 2026: "or can be only renewed
    // 1 time, after that it should be converted to a full time contract"): renewed once at most; then converted to a
    // full-time contract, this employment's next version (the service counting on), or ended
    const converting = dto.convertsTo ?? null;
    if (converting) {
      if (!isTrainingType(employment.employmentType)) {
        throw new BadRequestException('Only a trainee’s training agreement or an intern’s internship agreement is converted to a full-time contract.');
      }
      if (!previous) throw new ConflictException(`Sign the ${agreementName(employment.employmentType)} first: the full-time contract follows it.`);
    } else if (previous && (agreementVersions(employment.employmentType, versions)?.length ?? 0) > TRAINING_RENEWALS) {
      throw new ConflictException(renewedOnceMessage(employment.employmentType));
    }

    // a kind made inactive since stays allowed on the renewal of a version that has it
    const previousAllowances = previous?.allowances.map(allowanceView) ?? [];
    const allowances =
      dto.allowances !== undefined
        ? await this.allowances.snapshot(dto.allowances, { allowInactive: previousAllowances.map((a) => a.allowanceTypeId) })
        : previousAllowances;
    const { allowances: rows, ...terms } = await this.terms(employment, previous, {
      // a renewal keeps the length of the version before unless another is sent
      form: dto.form ?? (previous?.form as ContractForm | undefined),
      jobToDo: dto.jobToDo ?? (dto.form === undefined && previous?.form === 'specific_job' ? previous.jobToDo : null),
      endDate: dto.endDate,
      traineeStages: dto.traineeStages,
      convertsTo: converting,
      startDate: dto.startDate,
      durationMonths: dto.durationMonths,
      probationMonths: dto.probationMonths,
      basicPercent: dto.basicPercent,
      netSalary: dto.netSalary,
      payBasis: dto.payBasis ?? 'monthly',
      grossSalary: dto.grossSalary,
      hourlyRate: dto.hourlyRate,
      hoursPerWeek: dto.hoursPerWeek,
      daysPerWeek: dto.daysPerWeek,
      allowances,
    });
    // a version with new pay (a renewal with a raise) goes to the CEO first (owner's decisions, 16 October 2026); a
    // conversion to full-time is the new employment contract a hire would sign, with no CEO step (19 October 2026)
    const step = previous && !converting ? payChangeStep(previous, payTermsOf({ ...terms, allowances: rows }), dto.raiseReason) : NO_PAY_CHANGE;
    const values = {
      ...terms,
      ...step,
      ...(converting && { convertsTo: converting }),
      number: await this.nextNumber(terms.startDate, db),
      version: (previous?.version ?? 0) + 1,
      note: dto.note ?? null,
    };
    let row = await db.contract.create({
      data: { ...toData({ ...values, employmentId }), allowances: { create: allowanceData(rows) } },
      include: CONTRACT_INCLUDE,
    });
    // a renewal with new pay: its raise request, prepared directly by HR, so it is on Raise Requests with the raises
    let requestAudit: AuditEntry | null = null;
    if (previous && row.approval !== null) {
      const direct = await openDirectRequest(db, { ...row, employeeId }, previous.grossSalary.toNumber(), user.id);
      requestAudit = direct.audit;
      row = await db.contract.findUniqueOrThrow({ where: { id: row.id }, include: CONTRACT_INCLUDE });
    }
    const audit: AuditEntry = {
      userId: user.id,
      action: 'create',
      entityType: ENTITY,
      entityId: row.id,
      diff: salaryMasked({ employeeId, employmentId, ...values, allowances: comparable(rows), ...(requestAudit && { request: requestAudit.entityId }) }),
    };
    return { row, employment, audit, requestAudit };
  }

  /**
   * Changes a contract. A draft: any of its terms, and what follows from them is worked out again. A signed one: only
   * the dates it was signed and filed, and its note; other changes are a new version.
   */
  async update(id: string, dto: UpdateContractDto, user: SessionUser) {
    const before = await this.row(id);
    const employment = await this.employmentOf(before);
    const was = fields(before);
    let values: Record<string, unknown>;
    /** The draft's new set of allowances, when sent. */
    let allowances: AllowanceSnapshot[] | undefined;
    /** A draft's version before it, which a change of pay is weighed against. */
    let previous: ContractRow | null = null;

    if (before.status === 'draft') {
      if (dto.signedOn !== undefined || dto.insuranceFiledOn !== undefined || dto.labourOfficeFiledOn !== undefined) {
        throw new BadRequestException('Sign the contract first: the signing and filing dates are recorded on a signed contract.');
      }
      if (before.kind === 'amendment') throw new BadRequestException(`${before.number} is a salary amendment: change it as a raise (Edit raise).`);
      if (before.approval === 'pending_ceo') throw new ConflictException(`${before.number} is with the CEO: it can't be changed unless the CEO returns it.`);
      assertCurrent(employment);
      previous = await this.prisma.contract.findFirst({
        where: { employmentId: before.employmentId, version: { lt: before.version } },
        orderBy: { version: 'desc' },
        include: CONTRACT_INCLUDE,
      });
      // sent: the whole set, with the kinds' names and treatment as they are now; a kind the draft already has may be
      // inactive since
      if (dto.allowances !== undefined) {
        allowances = await this.allowances.snapshot(dto.allowances, { allowInactive: before.allowances.map((a) => a.allowanceTypeId) });
      }
      // switched to a monthly salary: the hourly terms go, and the monthly estimate stays the gross unless one is sent
      const payBasis = dto.payBasis ?? was.payBasis;
      const hourly = payBasis === 'hourly';
      // another length: what belonged to the one before goes (a fixed term's duration, a specific job's job and end)
      const form = dto.form ?? was.form;
      const sameForm = form === was.form;
      const { allowances: _rows, ...terms } = await this.terms(employment, previous, {
        form,
        jobToDo: dto.jobToDo !== undefined ? dto.jobToDo : sameForm ? was.jobToDo : null,
        endDate: dto.endDate !== undefined ? dto.endDate : sameForm && form === 'specific_job' ? was.endDate : null,
        traineeStages: dto.traineeStages !== undefined ? dto.traineeStages : was.traineeStages,
        convertsTo: before.convertsTo,
        startDate: dto.startDate ?? was.startDate,
        durationMonths: dto.durationMonths ?? (sameForm ? was.durationMonths : undefined),
        probationMonths: dto.probationMonths ?? was.probationMonths,
        basicPercent: dto.basicPercent ?? was.basicPercent,
        netSalary: dto.netSalary !== undefined ? dto.netSalary : was.netSalary,
        payBasis,
        grossSalary: dto.grossSalary ?? was.grossSalary,
        hourlyRate: dto.hourlyRate !== undefined ? dto.hourlyRate : hourly ? was.hourlyRate : null,
        hoursPerWeek: dto.hoursPerWeek !== undefined ? dto.hoursPerWeek : hourly ? was.hoursPerWeek : null,
        daysPerWeek: dto.daysPerWeek !== undefined ? dto.daysPerWeek : was.daysPerWeek,
        allowances: allowances ?? before.allowances.map(allowanceView),
      });
      // numbered by the start year: a draft moved to another year takes that year's next number
      const number = terms.startDate.slice(0, 4) === was.startDate.slice(0, 4) ? before.number : await this.nextNumber(terms.startDate);
      const pay = payTermsOf({ ...terms, allowances: allowances ?? before.allowances.map(allowanceView) });
      // a conversion to full-time takes no CEO step, as when it was drafted (19 October 2026)
      const step = previous && !before.convertsTo ? payChangeStep(previous, pay, dto.raiseReason ?? (before.raiseReason as RaiseReason | null)) : NO_PAY_CHANGE;
      const termsChanged = Object.keys(changes(was, { ...terms, allowances: allowances && comparable(allowances), raiseReason: step.raiseReason })).length > 0;
      values = { ...terms, number, note: dto.note, ...approvalAfterChange(before, step, termsChanged) };
    } else {
      if (TERMS.some((key) => dto[key] !== undefined)) {
        throw new BadRequestException('This contract is signed: only the signing and filing dates and the note can be changed. For other changes, add a new version.');
      }
      assertNotFuture(dto.signedOn, 'signing');
      assertNotFuture(dto.insuranceFiledOn, 'social insurance filing');
      assertNotFuture(dto.labourOfficeFiledOn, 'labour office filing');
      values = { signedOn: dto.signedOn, insuranceFiledOn: dto.insuranceFiledOn, labourOfficeFiledOn: dto.labourOfficeFiledOn, note: dto.note };
    }

    const { row, requestAudit } = await this.prisma.$transaction(async (tx) => {
      let saved = await tx.contract.update({
        where: { id },
        data: { ...toData(values), ...(allowances && { allowances: { deleteMany: {}, create: allowanceData(allowances) } }) },
        include: CONTRACT_INCLUDE,
      });
      // an approved one changed goes back to HR to send again, and so does the request it was prepared from
      if (before.raiseRequest && before.approval === 'approved' && values.approval === 'draft') {
        await tx.raiseRequest.update({ where: { id: before.raiseRequest.id }, data: { status: 'with_hr' } });
        await recordStep(tx, before.raiseRequest.id, user.id, { kind: 'changed', gross: saved.grossSalary.toNumber(), contractNumber: saved.number });
      }
      // a draft's change of pay and its request prepared directly by HR (owner, 19 October 2026): one comes with new pay
      // (a renewal now changing the pay), follows the draft as HR changes it, and goes once the pay is the same again
      let audit: AuditEntry | null = null;
      const direct = { ...saved, employeeId: employment.employeeId };
      if (previous && saved.status === 'draft') {
        if (saved.approval !== null && !before.raiseRequest) {
          audit = (await openDirectRequest(tx, direct, previous.grossSalary.toNumber(), user.id)).audit;
          saved = await tx.contract.findUniqueOrThrow({ where: { id }, include: CONTRACT_INCLUDE });
        } else if (before.raiseRequest?.origin === 'direct' && saved.approval === null) {
          audit = await dropDirectRequest(tx, before.raiseRequest.id, direct, user.id, 'no_pay_change');
          saved = await tx.contract.findUniqueOrThrow({ where: { id }, include: CONTRACT_INCLUDE });
        } else if (before.raiseRequest?.origin === 'direct') {
          await syncDirectRequest(tx, before.raiseRequest.id, direct, previous.grossSalary.toNumber());
        }
      }
      return { row: saved, requestAudit: audit };
    });
    const diff = salaryMasked(changes(was, { ...values, ...(allowances && { allowances: comparable(allowances) }) }));
    if (Object.keys(diff).length) {
      await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, entityId: id, diff: { employmentId: before.employmentId, number: before.number, ...diff } });
    }
    if (requestAudit) await this.audit.record(requestAudit);
    return contractView(row, await this.context(user, employment));
  }

  /**
   * Deletes a draft (a Super Admin only, owner's decision, 15 October 2026). A signed contract stays on record. A raise
   * request it was prepared from is HR's again; one prepared directly by HR goes with it (19 October 2026: nobody asked
   * for it, so nothing is left to decide).
   */
  async remove(id: string, user: SessionUser) {
    assertDeletes(user);
    const c = await this.row(id);
    if (c.status !== 'draft') throw new ConflictException(`${c.number} is signed: only a draft can be deleted, and a signed contract stays on record.`);
    const direct = c.raiseRequest?.origin === 'direct' ? c.raiseRequest : null;
    const employeeId = direct ? (await this.employmentOf(c)).employeeId : null;
    const requestAudit = await this.prisma.$transaction(async (tx) => {
      const dropped = direct ? await dropDirectRequest(tx, direct.id, { employeeId: employeeId!, number: c.number }, user.id, 'raise_deleted') : null;
      await tx.contract.delete({ where: { id } });
      // the request it was prepared from is HR's again, to prepare anew or decline
      if (c.raiseRequest && !direct) {
        await tx.raiseRequest.update({ where: { id: c.raiseRequest.id }, data: { status: 'with_hr' } });
        await recordStep(tx, c.raiseRequest.id, user.id, { kind: 'raise_deleted', contractNumber: c.number });
      }
      return dropped;
    });
    await this.audit.record({ userId: user.id, action: 'delete', entityType: ENTITY, entityId: id, diff: { employmentId: c.employmentId, number: c.number, version: c.version } });
    if (requestAudit) await this.audit.record(requestAudit);
  }

  /**
   * Signs a draft: it becomes the employment's contract, with the job title, grade, department and shift copied from
   * the employment. Version 1 sets the employment's probation end, and its status: Probation while the probation runs,
   * else Active (a contract signed for someone already past it does not put them back on probation); a trainee's or an
   * intern's has none, so Active. A later version supersedes the one before. A conversion of a trainee's or an intern's
   * agreement to a full-time contract (19 October 2026) makes the employment full-time, with its probation as version 1
   * would set it.
   */
  async sign(id: string, dto: SignContractDto, user: SessionUser) {
    const before = await this.row(id);
    if (before.status !== 'draft') throw new ConflictException(`${before.number} is already signed.`);
    // a change of pay is signed once the CEO approved it (owner's decision, 16 October 2026: "HR, then the CEO")
    if (before.approval && before.approval !== 'approved') {
      throw new ConflictException(
        before.approval === 'pending_ceo'
          ? `${before.number} is with the CEO: it is signed once the CEO approves it.`
          : `${before.number} changes the pay: send it to the CEO, and sign it once approved.`,
      );
    }
    const employment = await this.employmentOf(before);
    assertCurrent(employment);
    assertNotFuture(dto.signedOn, 'signing');
    // a trainee's training agreement is signed with its stages, checked again (the minimum wage may have been set since):
    // a written agreement setting them (Labour Law Art. 29)
    if (employment.employmentType === 'trainee' && before.kind === 'contract' && !before.convertsTo) {
      const startDate = fromDateOnly(before.startDate)!;
      const law = await this.lawRates.forYear(Number(startDate.slice(0, 4)));
      const problems = traineeProblems({
        stages: traineeStagesOf(before) ?? [],
        minimumWage: law.minimumWage ?? null,
        dateOfBirth: fromDateOnly(employment.employee.dateOfBirth),
        startDate,
      });
      if (problems.length) throw new BadRequestException(problems.map((p) => `${before.number} can't be signed yet: ${p.charAt(0).toLowerCase()}${p.slice(1)}`));
    }
    // a promotion with a raise is applied when it is signed, checked again (the job title's grades may have changed)
    const promotion = await checkedPromotion(this.prisma, employment, { newJobTitleId: before.newJobTitleId, newGradeId: before.newGradeId });

    const snapshot = {
      jobTitleEn: promotion.jobTitle?.titleEn ?? employment.jobTitle?.titleEn ?? null,
      jobTitleAr: promotion.jobTitle ? promotion.jobTitle.titleAr : (employment.jobTitle?.titleAr ?? null),
      gradeCode: promotion.grade?.code ?? employment.grade?.code ?? null,
      departmentName: promotion.jobTitle?.departmentName ?? departmentName(employment.department),
      shiftCode: employment.shift?.code ?? null,
    };
    const probationEnd = fromDateOnly(before.probationEnd);
    // On leave or Notice period stay as they are; only Probation and Active follow the contract's probation.
    const followsProbation = employment.status === 'probation' || employment.status === 'active';
    const promoted = {
      ...(promotion.jobTitle && { jobTitleId: promotion.jobTitle.id, departmentId: promotion.jobTitle.departmentId }),
      ...(promotion.grade && { gradeId: promotion.grade.id }),
    };
    // the first contract, or the full-time contract a trainee's or an intern's agreement is converted to: the
    // employment's probation (and type) follow it
    const converting = before.convertsTo;
    const setsProbation = before.version === 1 || converting !== null;
    const employmentChange = setsProbation
      ? {
          probationEnd,
          ...(followsProbation && { status: probationEnd && probationEnd >= todayInCairo() ? ('probation' as const) : ('active' as const) }),
          ...(converting && { employmentType: converting }),
        }
      : Object.keys(promoted).length
        ? promoted
        : null;
    const superseded =
      before.version === 1
        ? []
        : await this.prisma.contract.findMany({ where: { employmentId: before.employmentId, status: 'active' }, select: { id: true, number: true } });

    const row = await this.prisma.$transaction(async (tx) => {
      const signed = await tx.contract.update({ where: { id }, data: { status: 'active', signedOn: toDateOnly(dto.signedOn), ...snapshot }, include: CONTRACT_INCLUDE });
      if (superseded.length) await tx.contract.updateMany({ where: { id: { in: superseded.map((s) => s.id) } }, data: { status: 'superseded' } });
      if (setsProbation && employmentChange) {
        await tx.employment.update({
          where: { id: employment.id },
          data: {
            probationEnd: probationEnd ? toDateOnly(probationEnd) : null,
            status: (employmentChange as { status?: EmployeeStatus }).status,
            ...(converting && { employmentType: converting }),
          },
        });
      } else if (employmentChange) {
        await tx.employment.update({ where: { id: employment.id }, data: promoted });
      }
      // the raise request it was prepared from is done
      if (before.raiseRequest) {
        await tx.raiseRequest.update({ where: { id: before.raiseRequest.id }, data: { status: 'done', doneAt: new Date() } });
        await recordStep(tx, before.raiseRequest.id, user.id, {
          kind: 'signed',
          gross: signed.grossSalary.toNumber(),
          effectiveDate: fromDateOnly(signed.startDate),
          contractNumber: signed.number,
        });
      }
      return signed;
    });

    await this.audit.record({
      userId: user.id,
      action: 'sign',
      entityType: ENTITY,
      entityId: id,
      diff: {
        employmentId: before.employmentId,
        number: before.number,
        version: before.version,
        status: { from: 'draft', to: 'active' },
        signedOn: dto.signedOn,
        ...snapshot,
        ...(superseded.length && { superseded: superseded.map((s) => s.number) }),
      },
    });
    if (employmentChange) {
      const was = {
        probationEnd: fromDateOnly(employment.probationEnd),
        status: employment.status,
        jobTitleId: employment.jobTitleId,
        departmentId: employment.departmentId,
        gradeId: employment.gradeId,
        employmentType: employment.employmentType,
      };
      const diff = changes(was, employmentChange);
      if (Object.keys(diff).length) {
        await this.audit.record({ userId: user.id, action: 'update', entityType: 'employment', entityId: employment.id, diff: { employeeId: employment.employeeId, contract: before.number, ...diff } });
      }
    }
    if (before.raiseRequest) {
      await this.audit.record({ userId: user.id, action: 'done', entityType: 'raise_request', entityId: before.raiseRequest.id, diff: { contract: before.number, status: { from: before.raiseRequest.status, to: 'done' } } });
    }
    return contractView(row, await this.context(user, employment));
  }

  /**
   * Undoes a signing recorded by mistake (a Super Admin only, owner's decision, 15 October 2026): the contract is a
   * draft again, to correct and sign again, or delete. What the signing did is undone: the version before it is the
   * employment's contract again, and for version 1 the employment's probation end and status go back to what they were
   * (each unless changed since). Refused once a signed copy of one of its documents is uploaded, which shows it was
   * really signed; for a version already replaced or ended; with the next version drafted; or while an ending is open.
   */
  async unsign(id: string, user: SessionUser) {
    if (!isSuperAdmin(user)) throw new ForbiddenException(ONLY_SUPER_ADMIN_UNSIGNS);
    const before = await this.row(id);
    if (before.status === 'draft') throw new ConflictException(`${before.number} is not signed.`);
    if (before.status === 'superseded') throw new ConflictException(`${before.number} was replaced by a later version. Undo that version's signing first.`);
    if (before.status !== 'active') throw new ConflictException(`${before.number} has ended, so its signing stays on record.`);
    const employment = await this.employmentOf(before);
    assertCurrent(employment);

    const [next, ending, signedCopies] = await Promise.all([
      this.prisma.contract.findFirst({ where: { employmentId: before.employmentId, version: { gt: before.version } }, orderBy: { version: 'asc' } }),
      this.prisma.employmentEnding.findFirst({ where: { employmentId: before.employmentId, status: { in: ['pending_ceo', 'approved'] } }, select: { id: true } }),
      this.prisma.generatedDocument.count({ where: { contractId: id, status: { in: ['signed', 'verified'] } } }),
    ]);
    if (next) throw new ConflictException(`Version ${next.version} (${next.number}) follows it as a draft. Delete that draft first.`);
    if (ending) throw new ConflictException('An ending of this employment is in progress. Withdraw it first, or keep the contract signed.');
    if (signedCopies) {
      throw new ConflictException(`A signed copy of ${before.number}'s documents is uploaded, which shows it was signed, so its signing stays on record. For other terms, add a new version.`);
    }

    const restored =
      before.version > 1
        ? await this.prisma.contract.findFirst({ where: { employmentId: before.employmentId, version: before.version - 1, status: 'superseded' }, select: { id: true, number: true } })
        : null;
    // version 1's probation and status, a raise's promotion, a conversion's type (back to trainee or intern): as before
    // the signing
    const employmentChange =
      before.version === 1 || before.newJobTitleId || before.newGradeId || before.convertsTo ? await this.beforeSigning(employment, before.number) : null;

    const row = await this.prisma.$transaction(async (tx) => {
      const draft = await tx.contract.update({
        where: { id },
        data: {
          status: 'draft',
          signedOn: null,
          insuranceFiledOn: null,
          labourOfficeFiledOn: null,
          jobTitleEn: null,
          jobTitleAr: null,
          gradeCode: null,
          departmentName: null,
          shiftCode: null,
        },
        include: CONTRACT_INCLUDE,
      });
      if (restored) await tx.contract.update({ where: { id: restored.id }, data: { status: 'active' } });
      // the raise request it was prepared from is approved again, waiting for the signing
      if (before.raiseRequest) {
        await tx.raiseRequest.update({ where: { id: before.raiseRequest.id }, data: { status: 'approved', doneAt: null } });
        await recordStep(tx, before.raiseRequest.id, user.id, { kind: 'unsigned', contractNumber: before.number });
      }
      if (employmentChange) {
        await tx.employment.update({
          where: { id: employment.id },
          data: toData({ ...employmentChange }),
        });
      }
      return draft;
    });

    const was = fields(before);
    await this.audit.record({
      userId: user.id,
      action: 'unsign',
      entityType: ENTITY,
      entityId: id,
      diff: {
        employmentId: before.employmentId,
        number: before.number,
        version: before.version,
        ...changes(was, { status: 'draft', signedOn: null, insuranceFiledOn: null, labourOfficeFiledOn: null }),
        ...(restored && { restored: restored.number }),
      },
    });
    if (employmentChange) {
      const was = {
        probationEnd: fromDateOnly(employment.probationEnd),
        status: employment.status,
        jobTitleId: employment.jobTitleId,
        departmentId: employment.departmentId,
        gradeId: employment.gradeId,
        employmentType: employment.employmentType,
      };
      const diff = changes(was, employmentChange);
      await this.audit.record({ userId: user.id, action: 'update', entityType: 'employment', entityId: employment.id, diff: { employeeId: employment.employeeId, signingUndone: before.number, ...diff } });
    }
    if (before.raiseRequest) {
      await this.audit.record({ userId: user.id, action: 'update', entityType: 'raise_request', entityId: before.raiseRequest.id, diff: { contract: before.number, signingUndone: true, status: { from: 'done', to: 'approved' } } });
    }
    return contractView(row, await this.context(user, employment));
  }

  /**
   * Signed fixed-term contracts of current employments that end within `within` days, soonest first, with the last
   * day to give non-renewal notice and whether a renewal is drafted. Contracts already past their end, with the
   * employment still current, are listed too: they need a renewal (or an ending) most of all. A trainee's or an
   * intern's agreement (owner, 19 October 2026) is never due for renewal as a fixed term is: it comes with which
   * agreement it is and what follows it (`training`: renewed once or converted to full-time, then converted or ended),
   * no non-renewal notice and no Art. 88 warning, and whether its conversion to full-time is drafted.
   */
  async expiring(within: number, user: SessionUser) {
    const until = addDays(todayInCairo(), within);
    const rows = await this.prisma.contract.findMany({
      where: { status: 'active', form: 'fixed', endDate: { lte: toDateOnly(until) }, employment: { endDate: null, ...(await this.confidential.ownedWhere(user)) } },
      orderBy: [{ endDate: 'asc' }, { number: 'asc' }],
      include: {
        employment: {
          select: {
            id: true,
            employmentType: true,
            employee: EMPLOYEE_REF,
            shift: { select: { workingDays: true } },
            contracts: { select: { version: true, kind: true, status: true, convertsTo: true } },
          },
        },
      },
    });
    const nonRenewal = await this.nonRenewal();
    return rows.map((c) => {
      const e = c.employment;
      // a whole contract drafted after it (a renewal, a raise's new contract, a conversion), not a salary amendment, which keeps its end
      const drafts = e.contracts.filter((v) => v.status === 'draft' && v.kind === 'contract');
      const agreement = agreementNumber(c, agreementVersions(e.employmentType, e.contracts));
      return {
        id: c.id,
        number: c.number,
        employee: e.employee,
        employmentId: e.id,
        endDate: fromDateOnly(c.endDate),
        nonRenewalNoticeBy: agreement ? null : nonRenewalNoticeBy(c, { workingDays: e.shift?.workingDays ?? null, nonRenewal }),
        renewalDraft: drafts.some((v) => v.convertsTo === null),
        conversionDraft: drafts.some((v) => v.convertsTo !== null),
        // past its end with the employment going on and no signed renewal: open-ended by the law (Art. 88(3)), a draft
        // renewal or not (only a signed one is the written agreement); not an agreement to learn, which isn't an
        // employment contract
        becameOpenEnded: agreement ? false : contractBecameOpenEnded(c, null),
        training: agreement ? { agreement, next: trainingNext(agreement) } : null,
      };
    });
  }

  /**
   * What the labour law warns HR of (owner, 18 October 2026: "can we update the employment types based on the labour
   * law?"), for the dashboard: signed fixed-term contracts past their end while the employment goes on without a signed
   * renewal, which the law makes open-ended (Labour Law 14/2025 Art. 88(3): "إذا كان مبرما لمدة محددة واستمر الطرفان فى
   * تنفيذه بعد انتهاء هذه المدة دون اتفاق مكتوب بينهما"), and current casual work past six months (Art. 1(7): casual
   * work "لا يستغرق إنجازه أكثر من ستة أشهر"). The contracts by end date, then the casual work by join date.
   */
  async lawWarnings(user: SessionUser) {
    const today = todayInCairo();
    // not a C-level person's, for anyone but the CEO and a Super Admin (owner, 19 October 2026)
    const owned = await this.confidential.ownedWhere(user);
    const [rows, casual] = await Promise.all([
      this.prisma.contract.findMany({
        where: { status: 'active', form: 'fixed', endDate: { lt: toDateOnly(today) }, employment: { endDate: null, ...owned } },
        orderBy: [{ endDate: 'asc' }, { number: 'asc' }],
        select: {
          id: true,
          number: true,
          form: true,
          status: true,
          endDate: true,
          version: true,
          kind: true,
          convertsTo: true,
          employment: { select: { id: true, employmentType: true, employee: EMPLOYEE_REF, contracts: { select: { version: true, kind: true, convertsTo: true } } } },
        },
      }),
      this.prisma.employment.findMany({
        where: { endDate: null, workNature: 'casual', ...owned },
        orderBy: [{ joinDate: 'asc' }],
        select: { id: true, workNature: true, joinDate: true, endDate: true, employee: EMPLOYEE_REF },
      }),
    ]);
    // a trainee's or an intern's agreement past its end isn't an employment contract become open-ended (19 October 2026):
    // it is renewed once, converted to full-time, or ended
    const withAgreement = rows.map((c) => ({ ...c, agreement: agreementNumber(c, agreementVersions(c.employment.employmentType, c.employment.contracts)) }));
    const contracts = withAgreement.filter((c) => !c.agreement);
    const agreements = withAgreement.filter((c) => c.agreement);
    return [
      ...contracts
        .filter((c) => contractBecameOpenEnded(c, null, today))
        .map((c) => ({
          kind: 'became_open_ended' as const,
          employee: c.employment.employee,
          employmentId: c.employment.id,
          contractId: c.id,
          contractNumber: c.number,
          // the fixed term's last day: open-ended from the day after
          since: fromDateOnly(c.endDate),
          message: `${c.number} ended on ${shownDate(fromDateOnly(c.endDate)!)} and the work goes on without a signed renewal: by Labour Law Art. 88 it is now open-ended. Renew it in writing, or end the employment.`,
        })),
      ...agreements.map((c) => ({
        kind: 'training_ended' as const,
        employee: c.employment.employee,
        employmentId: c.employment.id,
        contractId: c.id,
        contractNumber: c.number,
        since: fromDateOnly(c.endDate),
        message: `${c.number}: ${trainingEndsText(fromDateOnly(c.endDate)!, trainingNext(c.agreement), today)}`,
      })),
      ...casual
        .filter((e) => employmentCasualTooLong(e, today))
        .map((e) => ({
          kind: 'casual_too_long' as const,
          employee: e.employee,
          employmentId: e.id,
          contractId: null,
          contractNumber: null,
          // the day the six months were up
          since: addMonths(fromDateOnly(e.joinDate), CASUAL_MAX_MONTHS),
          message: `Casual work since ${shownDate(fromDateOnly(e.joinDate))}: past the 6 months casual work may last (Labour Law Art. 1(7)). Change the nature of the work, or end it.`,
        })),
    ];
  }

  /**
   * Current employments on probation whose probation ends within `within` days, soonest first; those already past it
   * (not confirmed yet) too. Never a trainee or an intern (owner, 19 October 2026: "interns to be labeled trainees
   * instead of probation"): their agreements have none.
   */
  async probationEnding(within: number, user: SessionUser) {
    const until = addDays(todayInCairo(), within);
    const rows = await this.prisma.employment.findMany({
      where: {
        endDate: null,
        status: 'probation',
        probationEnd: { not: null, lte: toDateOnly(until) },
        employmentType: { notIn: ['trainee', 'intern'] },
        // not a C-level person's, for anyone but the CEO and a Super Admin (owner, 19 October 2026)
        ...(await this.confidential.ownedWhere(user)),
      },
      orderBy: [{ probationEnd: 'asc' }, { joinDate: 'asc' }],
      select: { id: true, probationEnd: true, employee: EMPLOYEE_REF },
    });
    return rows.map((e) => ({ employee: e.employee, employmentId: e.id, probationEnd: fromDateOnly(e.probationEnd) }));
  }

  // ---------- helpers ----------

  /**
   * A contract's terms and what follows from them: the start (version 1: the join date; a renewal: the day after the
   * version before ends), the duration and end of the fixed term, the probation and its end, the pay (by the hour, the
   * gross), and the insured salary.
   */
  async terms(employment: EmploymentRow, previous: { version: number; startDate: Date; endDate: Date | null } | null, input: TermsInput) {
    const settings = await this.settings.get();
    const joinDate = fromDateOnly(employment.joinDate);
    // the type the version is for: the employment's, or full-time for a trainee's or an intern's agreement converted
    const type = input.convertsTo ?? employment.employmentType;
    let startDate: string;
    let probationMonths: number;

    if (previous) {
      // a renewal (or a change of terms): after the version before, and no probation (once per employer, Art. 90)
      const previousStart = fromDateOnly(previous.startDate);
      const previousEnd = fromDateOnly(previous.endDate);
      const start = input.startDate ?? (previousEnd && addDays(previousEnd, 1));
      if (!start) throw new BadRequestException('Enter the start date.');
      startDate = start;
      if (startDate <= previousStart) {
        throw new BadRequestException(`Version ${previous.version + 1} must start after version ${previous.version} started, on ${shownDate(previousStart)}.`);
      }
      if (input.convertsTo) {
        // the full-time contract a trainee's or an intern's agreement is converted to (19 October 2026): the first
        // employment contract, so its probation is a first contract's (the agreement before it had none)
        probationMonths = await this.firstProbation(employment, input.probationMonths, settings.probationMonths);
      } else {
        if (input.probationMonths) throw new BadRequestException('A renewal has no probation: the law allows it once per employer (Art. 90).');
        probationMonths = 0;
      }
    } else {
      startDate = input.startDate ?? joinDate;
      if (startDate < joinDate) throw new BadRequestException(`The contract can't start before the join date, ${shownDate(joinDate)}.`);
      if (isTrainingType(type)) {
        // a training or internship agreement isn't an employment contract (owner, 19 October 2026: "interns to be labeled
        // trainees instead of probation"): no probation
        if (input.probationMonths) throw new BadRequestException(noProbationMessage(type));
        probationMonths = 0;
      } else {
        probationMonths = await this.firstProbation(employment, input.probationMonths, settings.probationMonths);
      }
    }
    if (probationMonths > 3) throw new BadRequestException(PROBATION_CAP_MESSAGE); // the DTO refuses it first

    // its length: a fixed term (the settings' 12 months unless sent), open-ended or for a specific job (owner, 18
    // October 2026); a trainee's training agreement for its stages' months, the gross the first stage's pay; an intern's
    // internship agreement a short fixed term
    const length = await this.length({ ...employment, employmentType: type }, input, startDate, settings.durationMonths);
    const { durationMonths, endDate } = length;
    if (length.traineeStages) {
      if (input.payBasis === 'hourly') throw new BadRequestException('A trainee is paid by the training stages, a month each: choose a monthly salary.');
      input = { ...input, grossSalary: length.traineeStages[0].pay };
    }
    if (type === 'intern') {
      // no wage (owner, 19 October 2026: "we are not paying them salary, its just transportation allowance"): the gross
      // is 0, the allowances paid on top
      if (input.payBasis === 'hourly' || input.hourlyRate != null || input.hoursPerWeek != null) {
        throw new BadRequestException('An intern is paid no wage, so not by the hour: leave the pay monthly, the gross at 0.');
      }
      if (input.grossSalary) throw new BadRequestException(INTERN_NO_WAGE_MESSAGE);
      input = { ...input, grossSalary: 0 };
    }
    const probationEnd = probationMonths > 0 ? addDays(addMonths(startDate, probationMonths), -1) : null;
    if (probationEnd && endDate && probationEnd > endDate) {
      throw new BadRequestException(`The probation would end after the contract, on ${shownDate(probationEnd)}. Shorten the probation or lengthen the contract.`);
    }
    const pay = this.pay(input);
    const allowances = [...input.allowances];
    const total = allowancesTotal(allowances);
    const netSalary = input.netSalary ?? null;
    if (netSalary !== null && Math.round(netSalary * 100) > Math.round((pay.grossSalary + total) * 100)) {
      throw new BadRequestException(allowances.length ? "The net salary can't be more than the gross salary and the allowances together." : "The net salary can't be more than the gross salary.");
    }
    return {
      form: length.form,
      jobToDo: length.jobToDo,
      traineeStages: length.traineeStages,
      startDate,
      durationMonths,
      endDate,
      probationMonths,
      probationEnd,
      ...pay,
      // the company's default share unless HR sets another (Payroll Setup, 16 October 2026)
      basicPercent: input.basicPercent ?? settings.basicPercentDefault,
      netSalary,
      // within the insurable limits of the year the contract starts (its rates set by law); nothing for an intern, who
      // has no company social insurance (outside the labour law, 19 October 2026)
      insuredSalary: type === 'intern' ? 0 : insuredWageOf(pay.grossSalary, allowances, await this.lawRates.forYear(Number(startDate.slice(0, 4)))),
      allowances,
    };
  }

  /**
   * A contract's length and what goes with it (owner, 18 October 2026: "can we update the employment types based on the
   * labour law?"; Labour Law 14/2025 Art. 87: "يبرم عقد العمل الفردى لمدة غير محددة، أو لمدة محددة إذا كانت طبيعة العمل
   * تقتضى ذلك"). Fixed-term: its months (the settings' unless sent) and its end. Open-ended: no duration and no end, it
   * ends by notice (Art. 156). For a specific job (Art. 155: "إذا أبرم عقد العمل لإنجاز عمل معين، انتهى العقد بإنجاز هذا
   * العمل"): the job, and the day it is expected to be done when known; no duration. A trainee's training agreement (Art.
   * 29: "يجب أن يكون اتفاق التدرج مكتوبا، وتحدد فيه على الأخص مدة تعلم المهنة … ومراحلها المتتابعة والمكافأة التى يحصل
   * عليها المتدرج فى كل مرحلة بصورة تصاعدية"): fixed-term for its stages' months together, the stages checked with
   * traineeProblems, the minimum wage the start year's (Payroll Setup) and the age (Art. 28) the profile's date of birth.
   */
  private async length(employment: EmploymentRow, input: TermsInput, startDate: string, defaultMonths: number) {
    const form: ContractForm = input.form ?? 'fixed';
    const none = { jobToDo: null, traineeStages: null };
    if (form !== 'specific_job' && input.jobToDo) {
      throw new BadRequestException('Only a contract for a specific job names the job: choose For a specific job, or leave the job out.');
    }
    if (form !== 'specific_job' && input.endDate) {
      throw new BadRequestException(
        form === 'fixed'
          ? 'A fixed-term contract ends when its duration does: send its months (durationMonths), not an end date.'
          : 'An open-ended contract has no end date (Labour Law Art. 87): leave it out.',
      );
    }
    if (employment.employmentType === 'trainee') {
      if (form !== 'fixed') {
        throw new BadRequestException('A trainee’s training agreement runs for the training’s length, which its stages set (Labour Law Art. 29): leave the contract fixed-term.');
      }
      const stages = (input.traineeStages ?? []).map((s) => ({ name: s.name, months: s.months, pay: s.pay }));
      const law = await this.lawRates.forYear(Number(startDate.slice(0, 4)));
      const problems = traineeProblems({ stages, minimumWage: law.minimumWage ?? null, dateOfBirth: fromDateOnly(employment.employee.dateOfBirth), startDate });
      if (problems.length) throw new BadRequestException(problems);
      const durationMonths = traineeMonths(stages);
      return { form, durationMonths, endDate: addDays(addMonths(startDate, durationMonths), -1), jobToDo: null, traineeStages: stages };
    }
    if (input.traineeStages?.length) throw new BadRequestException('Training stages are for a trainee’s training agreement only.');
    if (employment.employmentType === 'intern') {
      // an intern's internship agreement (owner, 19 October 2026): a short fixed term, 3 months unless sent, 12 at most
      if (form !== 'fixed') throw new BadRequestException(`An intern’s internship agreement is a short fixed term: leave the contract fixed-term. ${INTERN_TERM_MESSAGE}`);
      const durationMonths = input.durationMonths ?? INTERN_DEFAULT_MONTHS;
      if (durationMonths > INTERN_MAX_MONTHS) throw new BadRequestException(INTERN_TERM_MESSAGE);
      return { form, durationMonths, endDate: addDays(addMonths(startDate, durationMonths), -1), ...none };
    }
    if (form === 'open_ended') {
      if (input.durationMonths != null) throw new BadRequestException('An open-ended contract has no duration or end date (Labour Law Art. 87): leave the months out.');
      return { form, durationMonths: null, endDate: null, ...none };
    }
    if (form === 'specific_job') {
      if (input.durationMonths != null) {
        throw new BadRequestException(
          'A contract for a specific job ends when the job is done (Labour Law Art. 155): leave the months out, and give the day it is expected to be done (endDate) if you know it.',
        );
      }
      const job = input.jobToDo?.trim();
      if (!job) throw new BadRequestException('Enter the job the contract is for (Labour Law Art. 155).');
      const endDate = input.endDate ?? null;
      if (endDate && endDate < startDate) throw new BadRequestException(`The job can't be expected to be done before the contract starts, on ${shownDate(startDate)}.`);
      return { form, durationMonths: null, endDate, jobToDo: job, traineeStages: null };
    }
    const durationMonths = input.durationMonths ?? defaultMonths;
    return { form, durationMonths, endDate: addDays(addMonths(startDate, durationMonths), -1), ...none };
  }

  /**
   * How the pay is set (owner's request, 15 October 2026). A monthly salary: the gross as sent, with no hourly terms. By
   * the hour: the rate and the hours a week, and the gross is the monthly estimate, rate × hours × 52 ÷ 12 (whatever
   * gross was sent). The working days a week go with either.
   */
  pay(input: TermsInput) {
    const daysPerWeek = input.daysPerWeek ?? null;
    if (input.payBasis === 'hourly') {
      if (input.hourlyRate == null || input.hoursPerWeek == null) {
        throw new BadRequestException('Enter the hourly rate and the hours a week: pay by the hour needs both.');
      }
      const grossSalary = monthlyFromHourly(input.hourlyRate, input.hoursPerWeek);
      if (grossSalary < 0.01) throw new BadRequestException('The hourly rate and the hours a week come to less than 0.01 a month. Check them.');
      if (grossSalary > MAX_MONEY) throw new BadRequestException('The hourly rate and the hours a week come to more than a monthly salary can be. Check them.');
      return { payBasis: 'hourly' as PayBasis, grossSalary, hourlyRate: input.hourlyRate, hoursPerWeek: input.hoursPerWeek, daysPerWeek };
    }
    if (input.hourlyRate != null || input.hoursPerWeek != null) {
      throw new BadRequestException('A monthly salary has no hourly rate or hours a week. Clear them, or choose pay by the hour.');
    }
    if (input.grossSalary == null) throw new BadRequestException(GROSS_MESSAGE);
    return { payBasis: 'monthly' as PayBasis, grossSalary: input.grossSalary, hourlyRate: null, hoursPerWeek: null, daysPerWeek };
  }

  /**
   * A first employment contract's probation: as sent, else the settings' months; none for someone who already had one
   * with the company (Art. 90), refused if sent.
   */
  private async firstProbation(employment: EmploymentRow, sent: number | undefined, settingsMonths: number): Promise<number> {
    const hadProbation = await this.hadProbation(employment);
    if (hadProbation && sent) {
      throw new BadRequestException(`${employment.employee.fullNameEn} already had a probation with the company; the law allows it once (Art. 90).`);
    }
    return sent ?? (hadProbation ? 0 : settingsMonths);
  }

  /**
   * Whether the person already had a probation with the company, which the law allows once per employer (Art. 90):
   * any earlier employment counts. (An earlier contract with probation always belongs to an earlier employment, since
   * a renewal has none.)
   */
  private async hadProbation(e: EmploymentRow): Promise<boolean> {
    const earlier = await this.prisma.employment.count({ where: { employeeId: e.employeeId, id: { not: e.id }, joinDate: { lt: e.joinDate } } });
    return earlier > 0;
  }

  /**
   * What signing version 1 changed on the employment, as it was before (from the audit entry the signing wrote), for
   * the fields still as the signing left them: a probation confirmed since, or a date changed by hand, stays. Null when
   * there is nothing to put back.
   */
  private async beforeSigning(e: EmploymentRow, number: string): Promise<Record<string, unknown> | null> {
    const entry = await this.prisma.auditLog.findFirst({
      where: { entityType: 'employment', entityId: e.id, action: 'update', diff: { path: ['contract'], equals: number } },
      orderBy: { id: 'desc' },
      select: { diff: true },
    });
    const diff = (entry?.diff ?? {}) as Record<string, { from: unknown; to: unknown } | undefined>;
    const now: Record<string, unknown> = {
      probationEnd: fromDateOnly(e.probationEnd),
      status: e.status,
      jobTitleId: e.jobTitleId,
      departmentId: e.departmentId,
      gradeId: e.gradeId,
      employmentType: e.employmentType,
    };
    const out: Record<string, unknown> = {};
    for (const key of ['probationEnd', 'status', 'jobTitleId', 'departmentId', 'gradeId', 'employmentType'] as const) {
      const change = diff[key];
      if (change && now[key] === change.to) out[key] = change.from as never;
    }
    return Object.keys(out).length ? out : null;
  }

  /** The next free number for a contract starting that year: CON-2026-0001, CON-2026-0002 … */
  async nextNumber(startDate: string, db: Db = this.prisma): Promise<string> {
    const year = startDate.slice(0, 4);
    const [{ max }] = await db.$queryRaw<{ max: number | null }[]>`
      SELECT max(substring(number from 10)::int) AS max FROM contracts WHERE number ~ ${`^CON-${year}-[0-9]+$`}`;
    return `CON-${year}-${String((max ?? 0) + 1).padStart(4, '0')}`;
  }

  /**
   * How contracts are shown to this user: the salary or not, the dates that follow from the employment's shift, and for
   * a trainee's or an intern's employment which versions are its agreements (`versions`: its contracts, when loaded).
   */
  async context(user: SessionUser, employment: EmploymentRow, versions?: readonly { version: number; kind: string; convertsTo: string | null }[]): Promise<ContractContext> {
    const agreements = isTrainingType(employment.employmentType)
      ? agreementVersions(
          employment.employmentType,
          versions ?? (await this.prisma.contract.findMany({ where: { employmentId: employment.id }, select: { version: true, kind: true, convertsTo: true } })),
        )
      : null;
    return {
      seesSalary: seesSalary(user),
      workingDays: employment.shift?.workingDays ?? null,
      nonRenewal: await this.nonRenewal(),
      employmentEndDate: employment.endDate,
      casualTooLong: employmentCasualTooLong(employment),
      agreements,
    };
  }

  private nonRenewal(): Promise<NonRenewalNotice | null> {
    return this.prisma.endingRule.findUnique({ where: { key: 'non_renewal' }, select: { noticeAmount: true, noticeUnit: true } });
  }

  /**
   * An employment of this employee that the user may see (see EmployeesService.visibleTo), and not a C-level person's
   * hidden from them (owner, 19 October 2026: "make C level Employees details not visible to HR").
   */
  async employment(employeeId: string, employmentId: string, user: SessionUser, db: Db = this.prisma): Promise<EmploymentRow> {
    const e = await db.employment.findFirst({
      where: { id: employmentId, employeeId, employee: { AND: [await this.employees.visibleTo(user), await this.confidential.employeeWhere(user)] } },
      select: EMPLOYMENT,
    });
    if (!e) throw new NotFoundException('Employment not found.');
    return e;
  }

  employmentOf(c: { employmentId: string }): Promise<EmploymentRow> {
    return this.prisma.employment.findUniqueOrThrow({ where: { id: c.employmentId }, select: EMPLOYMENT });
  }

  async row(id: string): Promise<ContractRow> {
    const c = await this.prisma.contract.findUnique({ where: { id }, include: CONTRACT_INCLUDE });
    if (!c) throw new NotFoundException('Contract not found.');
    return c;
  }
}
