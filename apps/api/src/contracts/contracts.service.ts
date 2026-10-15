import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { insuredSalary, type ContractForm, type ContractStatus } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { assertDeletes, isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { addDays, addMonths, fromDateOnly, shownDate, toDateOnly, todayInCairo } from '../common/date-only.js';
import { seesSalary } from '../employees/access.js';
import { EmployeesService } from '../employees/employees.service.js';
import type { Contract, EmployeeStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ContractSettingsService } from './contract-settings.service.js';
import { PROBATION_CAP_MESSAGE, type CreateContractDto, type ListContractsDto, type SignContractDto, type UpdateContractDto } from './contracts.dto.js';
import {
  CONTRACT_LIST_INCLUDE,
  contractListView,
  contractView,
  departmentName,
  nonRenewalNoticeBy,
  type ContractContext,
  type NonRenewalNotice,
} from './views.js';

const ENTITY = 'contract';
/** Undoing a signing is for a Super Admin only, like deleting (owner's decision, 15 October 2026). */
export const ONLY_SUPER_ADMIN_UNSIGNS = 'Only a Super Admin can undo a signing.';
const DATE_FIELDS = ['startDate', 'endDate', 'probationEnd', 'signedOn', 'insuranceFiledOn', 'labourOfficeFiledOn'] as const;
/** Restricted (HR, Finance, CEO): the audit log only says they changed, as for bank details. */
const SALARY_FIELDS = ['grossSalary', 'netSalary', 'insuredSalary'];
/** A contract's terms: a draft takes them, a signed contract never changes them. */
const TERMS = ['form', 'startDate', 'durationMonths', 'probationMonths', 'grossSalary', 'basicPercent', 'netSalary'] as const;

/** An employee as the alert lists name them. */
const EMPLOYEE_REF = { select: { id: true, employeeCode: true, fullNameEn: true } } as const;

/** The employment a contract belongs to: its dates and status, its person, and what a contract copies when signed. */
const EMPLOYMENT = {
  id: true,
  employeeId: true,
  joinDate: true,
  endDate: true,
  status: true,
  probationEnd: true,
  employee: { select: { fullNameEn: true } },
  jobTitle: { select: { titleEn: true, titleAr: true } },
  grade: { select: { code: true } },
  department: { select: { nameEn: true, parent: { select: { nameEn: true } } } },
  shift: { select: { code: true, workingDays: true } },
} satisfies Prisma.EmploymentSelect;

type EmploymentRow = Prisma.EmploymentGetPayload<{ select: typeof EMPLOYMENT }>;

/** At most this many contracts in the company-wide list. */
const LIST_CAP = 500;

/**
 * The company-wide list's order, a group at a time: signed contracts by end date, soonest first (open-ended last),
 * then drafts, newest first, then the rest (ended, superseded) by start date, newest first.
 */
const LIST_GROUPS: { statuses: readonly ContractStatus[]; orderBy: Prisma.ContractOrderByWithRelationInput[] }[] = [
  { statuses: ['active'], orderBy: [{ endDate: { sort: 'asc', nulls: 'last' } }, { number: 'asc' }] },
  { statuses: ['draft'], orderBy: [{ createdAt: 'desc' }, { number: 'desc' }] },
  { statuses: ['ended', 'superseded'], orderBy: [{ startDate: 'desc' }, { number: 'desc' }] },
];

/** The terms to work out a contract from: as sent, or as the draft has them. */
interface TermsInput {
  form?: ContractForm;
  startDate?: string;
  durationMonths?: number | null;
  probationMonths?: number;
  grossSalary: number;
  basicPercent?: number;
  netSalary?: number | null;
}

/** A contract's own columns as the API sends them (dates as YYYY-MM-DD, money as numbers), for comparing and the audit log. */
function fields(c: Contract) {
  return {
    number: c.number,
    form: c.form as ContractForm,
    startDate: fromDateOnly(c.startDate),
    endDate: fromDateOnly(c.endDate),
    durationMonths: c.durationMonths,
    probationMonths: c.probationMonths,
    probationEnd: fromDateOnly(c.probationEnd),
    grossSalary: c.grossSalary.toNumber(),
    basicPercent: c.basicPercent,
    netSalary: c.netSalary?.toNumber() ?? null,
    insuredSalary: c.insuredSalary.toNumber(),
    status: c.status,
    signedOn: fromDateOnly(c.signedOn),
    insuranceFiledOn: fromDateOnly(c.insuranceFiledOn),
    labourOfficeFiledOn: fromDateOnly(c.labourOfficeFiledOn),
    note: c.note,
  };
}

/** What Prisma writes: YYYY-MM-DD strings become dates. */
function toData<T extends Record<string, unknown>>(values: T): T {
  const data: Record<string, unknown> = { ...values };
  for (const key of DATE_FIELDS) if (typeof data[key] === 'string') data[key] = toDateOnly(data[key]);
  return data as T;
}

/** Salary values never go to the audit log: only the fact that they were set or changed. */
function salaryMasked<T extends Record<string, unknown>>(diff: T): T {
  const out: Record<string, unknown> = { ...diff };
  for (const key of SALARY_FIELDS) if (key in out) out[key] = 'changed';
  return out as T;
}

function assertCurrent(e: EmploymentRow) {
  if (e.endDate) {
    throw new ConflictException(`This employment ended on ${shownDate(fromDateOnly(e.endDate))}: contracts are only added and signed for a current employment.`);
  }
}

function assertNotFuture(date: string | null | undefined, what: string) {
  if (date && date > todayInCairo()) throw new BadRequestException(`The ${what} date can't be in the future.`);
}

// Contracts (owner's decisions, 15 October 2026, checked against Labour Law 14/2025): every employment type has a
// fixed-term contract of 12 months, renewed in writing before it expires. Version 1 starts on the join date with 3
// months of probation, once per employer (Art. 90): none for someone who already had one with the company. A renewal
// is a new version, starting the day after the one before ends, with no probation; signing it supersedes the one
// before. The insured salary is the gross, capped at the start year's maximum insurable wage. HR adds, changes and
// signs contracts; anyone who may see the employment reads them, the salary only HR, Finance and the CEO.
@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
    private readonly settings: ContractSettingsService,
  ) {}

  /** An employment's contract versions, newest first. */
  async list(employeeId: string, employmentId: string, user: SessionUser) {
    const employment = await this.employment(employeeId, employmentId, user);
    const rows = await this.prisma.contract.findMany({ where: { employmentId }, orderBy: { version: 'desc' } });
    const ctx = await this.context(user, employment);
    return rows.map((c) => contractView(c, ctx));
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

  /** A new version: the first contract, or a renewal of the signed one. One draft at a time. */
  async create(employeeId: string, employmentId: string, dto: CreateContractDto, user: SessionUser) {
    const employment = await this.employment(employeeId, employmentId, user);
    assertCurrent(employment);
    const versions = await this.prisma.contract.findMany({ where: { employmentId }, orderBy: { version: 'desc' } });
    const draft = versions.find((v) => v.status === 'draft');
    if (draft) throw new ConflictException(`Version ${draft.version} (${draft.number}) is still a draft. Sign or delete it before adding another.`);
    const previous = versions[0] ?? null;
    if (previous && previous.status !== 'active') throw new ConflictException(`Sign version ${previous.version} first: a renewal follows a signed contract.`);

    const terms = await this.terms(employment, previous, dto);
    const values = { ...terms, number: await this.nextNumber(terms.startDate), version: (previous?.version ?? 0) + 1, note: dto.note ?? null };
    const row = await this.prisma.contract.create({ data: toData({ ...values, employmentId }) });
    await this.audit.record({ userId: user.id, action: 'create', entityType: ENTITY, entityId: row.id, diff: salaryMasked({ employeeId, employmentId, ...values }) });
    return contractView(row, await this.context(user, employment));
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

    if (before.status === 'draft') {
      if (dto.signedOn !== undefined || dto.insuranceFiledOn !== undefined || dto.labourOfficeFiledOn !== undefined) {
        throw new BadRequestException('Sign the contract first: the signing and filing dates are recorded on a signed contract.');
      }
      assertCurrent(employment);
      const previous = await this.prisma.contract.findFirst({
        where: { employmentId: before.employmentId, version: { lt: before.version } },
        orderBy: { version: 'desc' },
      });
      const terms = await this.terms(employment, previous, {
        form: dto.form ?? was.form,
        startDate: dto.startDate ?? was.startDate,
        durationMonths: dto.durationMonths ?? was.durationMonths,
        probationMonths: dto.probationMonths ?? was.probationMonths,
        grossSalary: dto.grossSalary ?? was.grossSalary,
        basicPercent: dto.basicPercent ?? was.basicPercent,
        netSalary: dto.netSalary !== undefined ? dto.netSalary : was.netSalary,
      });
      // numbered by the start year: a draft moved to another year takes that year's next number
      const number = terms.startDate.slice(0, 4) === was.startDate.slice(0, 4) ? before.number : await this.nextNumber(terms.startDate);
      values = { ...terms, number, note: dto.note };
    } else {
      if (TERMS.some((key) => dto[key] !== undefined)) {
        throw new BadRequestException('This contract is signed: only the signing and filing dates and the note can be changed. For other changes, add a new version.');
      }
      assertNotFuture(dto.signedOn, 'signing');
      assertNotFuture(dto.insuranceFiledOn, 'social insurance filing');
      assertNotFuture(dto.labourOfficeFiledOn, 'labour office filing');
      values = { signedOn: dto.signedOn, insuranceFiledOn: dto.insuranceFiledOn, labourOfficeFiledOn: dto.labourOfficeFiledOn, note: dto.note };
    }

    const row = await this.prisma.contract.update({ where: { id }, data: toData(values) });
    const diff = salaryMasked(changes(was, values));
    if (Object.keys(diff).length) {
      await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, entityId: id, diff: { employmentId: before.employmentId, number: before.number, ...diff } });
    }
    return contractView(row, await this.context(user, employment));
  }

  /** Deletes a draft (a Super Admin only, owner's decision, 15 October 2026). A signed contract stays on record. */
  async remove(id: string, user: SessionUser) {
    assertDeletes(user);
    const c = await this.row(id);
    if (c.status !== 'draft') throw new ConflictException(`${c.number} is signed: only a draft can be deleted, and a signed contract stays on record.`);
    await this.prisma.contract.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'delete', entityType: ENTITY, entityId: id, diff: { employmentId: c.employmentId, number: c.number, version: c.version } });
  }

  /**
   * Signs a draft: it becomes the employment's contract, with the job title, grade, department and shift copied from
   * the employment. Version 1 sets the employment's probation end, and its status: Probation while the probation runs,
   * else Active (a contract signed for someone already past it does not put them back on probation). A later version
   * supersedes the one before.
   */
  async sign(id: string, dto: SignContractDto, user: SessionUser) {
    const before = await this.row(id);
    if (before.status !== 'draft') throw new ConflictException(`${before.number} is already signed.`);
    const employment = await this.employmentOf(before);
    assertCurrent(employment);
    assertNotFuture(dto.signedOn, 'signing');

    const snapshot = {
      jobTitleEn: employment.jobTitle?.titleEn ?? null,
      jobTitleAr: employment.jobTitle?.titleAr ?? null,
      gradeCode: employment.grade?.code ?? null,
      departmentName: departmentName(employment.department),
      shiftCode: employment.shift?.code ?? null,
    };
    const probationEnd = fromDateOnly(before.probationEnd);
    // On leave or Notice period stay as they are; only Probation and Active follow the contract's probation.
    const followsProbation = employment.status === 'probation' || employment.status === 'active';
    const employmentChange =
      before.version === 1
        ? {
            probationEnd,
            ...(followsProbation && { status: probationEnd && probationEnd >= todayInCairo() ? ('probation' as const) : ('active' as const) }),
          }
        : null;
    const superseded =
      before.version === 1
        ? []
        : await this.prisma.contract.findMany({ where: { employmentId: before.employmentId, status: 'active' }, select: { id: true, number: true } });

    const row = await this.prisma.$transaction(async (tx) => {
      const signed = await tx.contract.update({ where: { id }, data: { status: 'active', signedOn: toDateOnly(dto.signedOn), ...snapshot } });
      if (superseded.length) await tx.contract.updateMany({ where: { id: { in: superseded.map((s) => s.id) } }, data: { status: 'superseded' } });
      if (employmentChange) {
        await tx.employment.update({
          where: { id: employment.id },
          data: { probationEnd: probationEnd ? toDateOnly(probationEnd) : null, status: employmentChange.status },
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
      const diff = changes({ probationEnd: fromDateOnly(employment.probationEnd), status: employment.status }, employmentChange);
      if (Object.keys(diff).length) {
        await this.audit.record({ userId: user.id, action: 'update', entityType: 'employment', entityId: employment.id, diff: { employeeId: employment.employeeId, contract: before.number, ...diff } });
      }
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
    const employmentChange = before.version === 1 ? await this.beforeSigning(employment, before.number) : null;

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
      });
      if (restored) await tx.contract.update({ where: { id: restored.id }, data: { status: 'active' } });
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
      const diff = changes({ probationEnd: fromDateOnly(employment.probationEnd), status: employment.status }, employmentChange);
      await this.audit.record({ userId: user.id, action: 'update', entityType: 'employment', entityId: employment.id, diff: { employeeId: employment.employeeId, signingUndone: before.number, ...diff } });
    }
    return contractView(row, await this.context(user, employment));
  }

  /**
   * Signed fixed-term contracts of current employments that end within `within` days, soonest first, with the last
   * day to give non-renewal notice and whether a renewal is drafted. Contracts already past their end, with the
   * employment still current, are listed too: they need a renewal (or an ending) most of all.
   */
  async expiring(within: number) {
    const until = addDays(todayInCairo(), within);
    const rows = await this.prisma.contract.findMany({
      where: { status: 'active', form: 'fixed', endDate: { lte: toDateOnly(until) }, employment: { endDate: null } },
      orderBy: [{ endDate: 'asc' }, { number: 'asc' }],
      include: {
        employment: {
          select: { id: true, employee: EMPLOYEE_REF, shift: { select: { workingDays: true } }, contracts: { where: { status: 'draft' }, select: { id: true } } },
        },
      },
    });
    const nonRenewal = await this.nonRenewal();
    return rows.map((c) => ({
      id: c.id,
      number: c.number,
      employee: c.employment.employee,
      employmentId: c.employment.id,
      endDate: fromDateOnly(c.endDate),
      nonRenewalNoticeBy: nonRenewalNoticeBy(c, { workingDays: c.employment.shift?.workingDays ?? null, nonRenewal }),
      renewalDraft: c.employment.contracts.length > 0,
    }));
  }

  /**
   * Current employments on probation whose probation ends within `within` days, soonest first; those already past it
   * (not confirmed yet) too.
   */
  async probationEnding(within: number) {
    const until = addDays(todayInCairo(), within);
    const rows = await this.prisma.employment.findMany({
      where: { endDate: null, status: 'probation', probationEnd: { not: null, lte: toDateOnly(until) } },
      orderBy: [{ probationEnd: 'asc' }, { joinDate: 'asc' }],
      select: { id: true, probationEnd: true, employee: EMPLOYEE_REF },
    });
    return rows.map((e) => ({ employee: e.employee, employmentId: e.id, probationEnd: fromDateOnly(e.probationEnd) }));
  }

  // ---------- helpers ----------

  /**
   * A contract's terms and what follows from them: the start (version 1: the join date; a renewal: the day after the
   * version before ends), the duration and end of a fixed term, the probation and its end, and the insured salary.
   */
  private async terms(employment: EmploymentRow, previous: Contract | null, input: TermsInput) {
    const settings = await this.settings.get();
    const form = input.form ?? 'fixed';
    const joinDate = fromDateOnly(employment.joinDate);
    let startDate: string;
    let probationMonths: number;

    if (previous) {
      // a renewal (or a change of terms): after the version before, and no probation (once per employer, Art. 90)
      const previousStart = fromDateOnly(previous.startDate);
      const previousEnd = fromDateOnly(previous.endDate);
      if (input.startDate) startDate = input.startDate;
      else if (previousEnd) startDate = addDays(previousEnd, 1);
      else throw new BadRequestException(`Enter the start date: version ${previous.version} is open-ended, so the next version has no default start.`);
      if (startDate <= previousStart) {
        throw new BadRequestException(`Version ${previous.version + 1} must start after version ${previous.version} started, on ${shownDate(previousStart)}.`);
      }
      if (input.probationMonths) throw new BadRequestException('A renewal has no probation: the law allows it once per employer (Art. 90).');
      probationMonths = 0;
    } else {
      startDate = input.startDate ?? joinDate;
      if (startDate < joinDate) throw new BadRequestException(`The contract can't start before the join date, ${shownDate(joinDate)}.`);
      const hadProbation = await this.hadProbation(employment);
      if (hadProbation && input.probationMonths) {
        throw new BadRequestException(`${employment.employee.fullNameEn} already had a probation with the company; the law allows it once (Art. 90).`);
      }
      probationMonths = input.probationMonths ?? (hadProbation ? 0 : settings.probationMonths);
    }
    if (probationMonths > 3) throw new BadRequestException(PROBATION_CAP_MESSAGE); // the DTO refuses it first

    const durationMonths = form === 'fixed' ? (input.durationMonths ?? settings.durationMonths) : null;
    const endDate = durationMonths ? addDays(addMonths(startDate, durationMonths), -1) : null;
    const probationEnd = probationMonths > 0 ? addDays(addMonths(startDate, probationMonths), -1) : null;
    if (endDate && probationEnd && probationEnd > endDate) {
      throw new BadRequestException(`The probation would end after the contract, on ${shownDate(probationEnd)}. Shorten the probation or lengthen the contract.`);
    }
    const netSalary = input.netSalary ?? null;
    if (netSalary !== null && netSalary > input.grossSalary) throw new BadRequestException("The net salary can't be more than the gross salary.");
    return {
      form,
      startDate,
      durationMonths,
      endDate,
      probationMonths,
      probationEnd,
      grossSalary: input.grossSalary,
      basicPercent: input.basicPercent ?? 80,
      netSalary,
      insuredSalary: insuredSalary(input.grossSalary, Number(startDate.slice(0, 4))),
    };
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
  private async beforeSigning(e: EmploymentRow, number: string): Promise<{ probationEnd?: string | null; status?: EmployeeStatus } | null> {
    const entry = await this.prisma.auditLog.findFirst({
      where: { entityType: 'employment', entityId: e.id, action: 'update', diff: { path: ['contract'], equals: number } },
      orderBy: { id: 'desc' },
      select: { diff: true },
    });
    const diff = (entry?.diff ?? {}) as Record<string, { from: unknown; to: unknown } | undefined>;
    const now: Record<string, unknown> = { probationEnd: fromDateOnly(e.probationEnd), status: e.status };
    const out: { probationEnd?: string | null; status?: EmployeeStatus } = {};
    for (const key of ['probationEnd', 'status'] as const) {
      const change = diff[key];
      if (change && now[key] === change.to) out[key] = change.from as never;
    }
    return Object.keys(out).length ? out : null;
  }

  /** The next free number for a contract starting that year: CON-2026-0001, CON-2026-0002 … */
  private async nextNumber(startDate: string): Promise<string> {
    const year = startDate.slice(0, 4);
    const [{ max }] = await this.prisma.$queryRaw<{ max: number | null }[]>`
      SELECT max(substring(number from 10)::int) AS max FROM contracts WHERE number ~ ${`^CON-${year}-[0-9]+$`}`;
    return `CON-${year}-${String((max ?? 0) + 1).padStart(4, '0')}`;
  }

  /** How contracts are shown to this user: the salary or not, and the dates that follow from the employment's shift. */
  private async context(user: SessionUser, employment: EmploymentRow): Promise<ContractContext> {
    return { seesSalary: seesSalary(user), workingDays: employment.shift?.workingDays ?? null, nonRenewal: await this.nonRenewal() };
  }

  private nonRenewal(): Promise<NonRenewalNotice | null> {
    return this.prisma.endingRule.findUnique({ where: { key: 'non_renewal' }, select: { noticeAmount: true, noticeUnit: true } });
  }

  /** An employment of this employee that the user may see (see EmployeesService.visibleTo). */
  private async employment(employeeId: string, employmentId: string, user: SessionUser): Promise<EmploymentRow> {
    const e = await this.prisma.employment.findFirst({
      where: { id: employmentId, employeeId, employee: await this.employees.visibleTo(user) },
      select: EMPLOYMENT,
    });
    if (!e) throw new NotFoundException('Employment not found.');
    return e;
  }

  private employmentOf(c: Contract): Promise<EmploymentRow> {
    return this.prisma.employment.findUniqueOrThrow({ where: { id: c.employmentId }, select: EMPLOYMENT });
  }

  private async row(id: string): Promise<Contract> {
    const c = await this.prisma.contract.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Contract not found.');
    return c;
  }
}
