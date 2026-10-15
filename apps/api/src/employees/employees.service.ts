import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PAPERWORK_LABELS, requiredPaperwork, type EmploymentType, type Gender, type Standing } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly, todayInCairo } from '../common/date-only.js';
import { fromTimeOfDay } from '../common/time-of-day.js';
import type { Employee, EmployeeBank, EmployeeIdentity, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { deletesEmployees, editsEmployees, seesBank, seesEveryone, seesIdentity } from './access.js';
import { birthDateFromNationalId, maskTail } from './checks.js';
import type { CreateEmployeeDto, UpdateBankDto, UpdateEmployeeDto, UpdateIdentityDto } from './employee.dto.js';

const ENTITY = 'employee';
const DATE_FIELDS = ['dateOfBirth'] as const;

/** A grade as employments name it. */
const GRADE = { select: { id: true, code: true, rank: true, levelEn: true, levelAr: true } } as const;

/**
 * Where an employment places someone: their team (or department) with its department, their job title, and their own
 * grade (owner's decision, 15 October 2026: no longer the job title's).
 */
const PLACE = {
  department: { select: { id: true, nameEn: true, nameAr: true, parent: { select: { id: true, nameEn: true, nameAr: true } } } },
  jobTitle: { select: { id: true, titleEn: true, titleAr: true, jdVersion: true } },
  grade: GRADE,
} satisfies Prisma.EmploymentInclude;

const EMPLOYMENT = {
  ...PLACE,
  manager: { select: { id: true, employeeCode: true, fullNameEn: true } },
  shift: { select: { id: true, code: true, startTime: true, endTime: true } },
} satisfies Prisma.EmploymentInclude;

/** Newest first, the current employment (no end date) before all ended ones. */
const NEWEST_FIRST = [{ endDate: { sort: 'desc', nulls: 'first' } }, { joinDate: 'desc' }] satisfies Prisma.EmploymentOrderByWithRelationInput[];

type EmploymentRow = Prisma.EmploymentGetPayload<{ include: typeof EMPLOYMENT }>;

/** An employment as the API sends it: dates as YYYY-MM-DD, office days in order, shift times as HH:mm. */
export function employmentView(e: EmploymentRow) {
  const { shift, joinDate, probationEnd, jdAcknowledgedAt, endDate, officeDays, ...rest } = e;
  return {
    ...rest,
    joinDate: fromDateOnly(joinDate),
    probationEnd: fromDateOnly(probationEnd),
    jdAcknowledgedAt: fromDateOnly(jdAcknowledgedAt),
    endDate: fromDateOnly(endDate),
    officeDays: [...officeDays].sort((a, b) => a - b),
    shift: shift && { ...shift, startTime: fromTimeOfDay(shift.startTime), endTime: fromTimeOfDay(shift.endTime) },
  };
}

type DateField = (typeof DATE_FIELDS)[number];
type EmployeeFields = Omit<Employee, DateField> & Record<DateField, string | null>;

/** The profile's own columns as the API sends them: dates as YYYY-MM-DD. */
function fields(e: Employee): EmployeeFields {
  return { ...e, dateOfBirth: fromDateOnly(e.dateOfBirth) };
}

/** What Prisma writes: YYYY-MM-DD strings become dates. */
function toData<T extends Record<string, unknown>>(values: T): T {
  const data: Record<string, unknown> = { ...values };
  for (const key of DATE_FIELDS) {
    if (typeof data[key] === 'string') data[key] = toDateOnly(data[key]);
  }
  return data as T;
}

function identityView(row: EmployeeIdentity | null) {
  return {
    nationalId: row?.nationalId ?? null,
    printedNo: row?.printedNo ?? null,
    issueDate: fromDateOnly(row?.issueDate ?? null),
    expiryDate: fromDateOnly(row?.expiryDate ?? null),
  };
}

function bankView(row: EmployeeBank | null) {
  return {
    bankName: row?.bankName ?? null,
    branch: row?.branch ?? null,
    accountNo: row?.accountNo ?? null,
    iban: row?.iban ?? null,
    holderName: row?.holderName ?? null,
  };
}

/** The identity with its numbers masked, as the profile shows it. Null when nothing is recorded. */
function maskedIdentity(row: EmployeeIdentity | null) {
  if (!row) return null;
  const { nationalId, printedNo, ...rest } = identityView(row);
  return { nationalIdMasked: maskTail(nationalId), printedNoMasked: maskTail(printedNo), ...rest };
}

function maskedBank(row: EmployeeBank | null) {
  if (!row) return null;
  const { accountNo, iban, ...rest } = bankView(row);
  return { ...rest, accountNoMasked: maskTail(accountNo), ibanMasked: maskTail(iban) };
}

/** The fields that were sent (undefined means "leave as it is"), as a plain object. */
function withoutUndefined(dto: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
}

/** Restricted values never go to the audit log: only the fact that they changed. */
function restrictedChanges(diff: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (key in diff) diff[key] = 'changed';
  return diff;
}

/** What changed in the national ID details, for the audit log: the numbers themselves only as 'changed'. */
function identityChanges(before: EmployeeIdentity | null, dto: UpdateIdentityDto): Record<string, unknown> {
  return restrictedChanges(changes(identityView(before), dto as Record<string, unknown>), ['nationalId', 'printedNo']);
}

/** The national ID columns Prisma writes: YYYY-MM-DD strings become dates; undefined leaves a column as it is. */
function identityData(dto: UpdateIdentityDto) {
  const date = (v: string | null | undefined) => (typeof v === 'string' ? toDateOnly(v) : v);
  return {
    nationalId: dto.nationalId,
    printedNo: dto.printedNo,
    issueDate: date(dto.issueDate),
    expiryDate: date(dto.expiryDate),
  };
}

/** One thing the profile still lacks, and the tab of the profile where it is filled in. */
export interface Missing {
  key: string;
  label: string;
  tab: 'basic' | 'education' | 'documents';
}

/**
 * How complete a profile is: the fields HR fills in and the papers the employee file needs (by the current
 * employment; see requiredPaperwork). Only whether each is there counts, so restricted values are never read here
 * for the result.
 */
function completeness(
  e: Employee,
  identity: EmployeeIdentity | null,
  bank: EmployeeBank | null,
  employmentType: EmploymentType | null,
  papers: string[],
): { percent: number; missing: Missing[] } {
  const checks: [boolean, Missing][] = [
    [!!e.fullNameEn, { key: 'fullNameEn', label: 'Full name (English)', tab: 'basic' }],
    [!!e.fullNameAr, { key: 'fullNameAr', label: 'Full name (Arabic)', tab: 'basic' }],
    [!!e.dateOfBirth, { key: 'dateOfBirth', label: 'Date of birth', tab: 'basic' }],
    [!!e.gender, { key: 'gender', label: 'Gender', tab: 'basic' }],
    [!!e.nationality, { key: 'nationality', label: 'Nationality', tab: 'basic' }],
    [!!e.maritalStatus, { key: 'maritalStatus', label: 'Marital status', tab: 'basic' }],
    [!!e.militaryStatus, { key: 'militaryStatus', label: 'Military status', tab: 'basic' }],
    [!!e.mobile, { key: 'mobile', label: 'Mobile', tab: 'basic' }],
    [!!e.addressAr, { key: 'addressAr', label: 'Address (Arabic)', tab: 'basic' }],
    [!!e.governorate, { key: 'governorate', label: 'Governorate', tab: 'basic' }],
    [!!e.emergencyName && !!e.emergencyMobile, { key: 'emergency', label: 'Emergency contact', tab: 'basic' }],
    [!!identity?.nationalId, { key: 'nationalId', label: 'National ID number', tab: 'basic' }],
    [!!identity?.expiryDate, { key: 'idExpiry', label: 'National ID expiry date', tab: 'basic' }],
    [!!bank?.iban, { key: 'iban', label: 'IBAN', tab: 'basic' }],
    [!!e.degree, { key: 'degree', label: 'Degree', tab: 'education' }],
    [!!e.university, { key: 'university', label: 'University', tab: 'education' }],
    [!!e.graduationYear, { key: 'graduationYear', label: 'Graduation year', tab: 'education' }],
    [!!e.qualificationAr, { key: 'qualificationAr', label: 'Qualification (Arabic)', tab: 'education' }],
    ...requiredPaperwork(employmentType, (e.gender as Gender | null) ?? null).map(
      (kind): [boolean, Missing] => [papers.includes(kind), { key: kind, label: PAPERWORK_LABELS[kind], tab: 'documents' }],
    ),
  ];
  const done = checks.filter(([ok]) => ok).length;
  return { percent: Math.round((done / checks.length) * 100), missing: checks.filter(([ok]) => !ok).map(([, m]) => m) };
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The people this user may see, each with their current employment, or how their last one ended. */
  async list(user: SessionUser) {
    const rows = await this.prisma.employee.findMany({
      where: await this.visibleTo(user),
      select: {
        id: true,
        employeeCode: true,
        fullNameEn: true,
        fullNameAr: true,
        workEmail: true,
        employments: {
          orderBy: NEWEST_FIRST,
          take: 1,
          select: {
            id: true,
            status: true,
            employmentType: true,
            joinDate: true,
            endDate: true,
            endReason: true,
            department: PLACE.department,
            jobTitle: { select: { id: true, titleEn: true } },
            gradeId: true,
            grade: GRADE,
            manager: { select: { id: true, fullNameEn: true } },
          },
        },
      },
      orderBy: { employeeCode: 'asc' },
    });
    return rows.map(({ employments: [latest], ...e }) => {
      const current = latest && !latest.endDate ? latest : null;
      const ended = latest?.endDate ? latest : null;
      return {
        ...e,
        standing: (current?.status ?? (ended ? 'former' : 'not_employed')) as Standing,
        employment: current && {
          id: current.id,
          status: current.status,
          employmentType: current.employmentType,
          joinDate: fromDateOnly(current.joinDate),
          department: current.department,
          jobTitle: current.jobTitle,
          gradeId: current.gradeId,
          grade: current.grade,
          manager: current.manager,
        },
        lastEnded: ended && { endDate: fromDateOnly(ended.endDate), endReason: ended.endReason },
      };
    });
  }

  /**
   * A profile: personal details, the national ID and bank (masked, for those who may see them), the current
   * employment and the history of employments, the people who report to this person now, and how complete it is.
   */
  async get(id: string, user: SessionUser) {
    const identity = seesIdentity(user);
    const bank = seesBank(user);
    const e = await this.prisma.employee.findFirst({
      where: { AND: [{ id }, await this.visibleTo(user)] },
      include: {
        identity: true,
        bank: true,
        employments: { include: EMPLOYMENT, orderBy: NEWEST_FIRST },
        managing: {
          where: { endDate: null },
          select: {
            status: true,
            employee: { select: { id: true, employeeCode: true, fullNameEn: true } },
            jobTitle: { select: { titleEn: true } },
          },
          orderBy: { employee: { fullNameEn: 'asc' } },
        },
      },
    });
    if (!e) throw new NotFoundException('Employee not found.');

    const { identity: idRow, bank: bankRow, employments, managing, ...own } = e;
    const history = employments.map(employmentView);
    const current = history.find((x) => x.endDate === null) ?? null;
    const papers = await this.prisma.paperworkItem.findMany({ where: { employeeId: id }, select: { kind: true }, distinct: ['kind'] });
    return {
      ...fields(own),
      employment: current,
      employments: history,
      reports: managing.map((m) => ({ ...m.employee, status: m.status, jobTitle: m.jobTitle })),
      ...(identity && { identity: maskedIdentity(idRow) }),
      ...(bank && { bank: maskedBank(bankRow) }),
      completeness: completeness(own, idRow, bankRow, current?.employmentType ?? null, papers.map((x) => x.kind)),
      access: { edit: editsEmployees(user), delete: deletesEmployees(user), identity, bank },
    };
  }

  /** The full national ID (restricted): every call is written to the audit log. */
  async identity(id: string, user: SessionUser) {
    await this.row(id);
    const row = await this.prisma.employeeIdentity.findUnique({ where: { employeeId: id } });
    await this.audit.record({ userId: user.id, action: 'view_restricted', entityType: ENTITY, entityId: id, diff: { fields: ['nationalId', 'printedNo'] } });
    return identityView(row);
  }

  /** The full bank details (restricted): every call is written to the audit log. */
  async bank(id: string, user: SessionUser) {
    await this.row(id);
    const row = await this.prisma.employeeBank.findUnique({ where: { employeeId: id } });
    await this.audit.record({ userId: user.id, action: 'view_restricted', entityType: ENTITY, entityId: id, diff: { fields: ['accountNo', 'iban'] } });
    return bankView(row);
  }

  /**
   * Adds a profile, with the national ID details when sent (e.g. read from the ID card first): everything is checked
   * before anything is saved, and the profile and the national ID are saved together or not at all. Employment is
   * added afterwards (EmploymentsService), so a profile can exist before a hire and stays after one ends.
   */
  async create(dto: CreateEmployeeDto, user: SessionUser) {
    const { employeeCode: code, identity: sentIdentity, ...given } = dto;
    const employeeCode = code ?? (await this.nextCode());
    await this.assertCompanyDomain(dto.workEmail);
    await this.assertFree({ employeeCode, workEmail: dto.workEmail });
    const derived = await this.checked(null, dto);
    // national ID details with nothing filled in are not saved at all
    const identity = sentIdentity && Object.values(sentIdentity).some((v) => v !== null && v !== undefined) ? sentIdentity : null;
    const dateOfBirth = identity ? await this.checkedIdentity({ id: null, dateOfBirth: dto.dateOfBirth ?? null }, null, identity) : undefined;
    const values = { ...given, employeeCode, ...derived, ...(dateOfBirth && { dateOfBirth }) };

    const e = await this.prisma.$transaction(async (tx) => {
      const row = await tx.employee.create({ data: toData(values) });
      if (identity) await tx.employeeIdentity.create({ data: { employeeId: row.id, ...identityData(identity) } });
      return row;
    });
    const { id: _id, createdAt: _c, updatedAt: _u, ...created } = fields(e);
    const diff = identity ? { ...created, identity: identityChanges(null, identity) } : created;
    await this.audit.record({ userId: user.id, action: 'create', entityType: ENTITY, entityId: e.id, diff });
    return this.get(e.id, user);
  }

  async update(id: string, dto: UpdateEmployeeDto, user: SessionUser) {
    const before = await this.row(id);
    const { employeeCode, ...rest } = dto;
    // only a new work email is checked: one on file that is not changed never stops other fields being saved
    const workEmail = dto.workEmail !== before.workEmail ? dto.workEmail : undefined;
    await this.assertCompanyDomain(workEmail);
    await this.assertFree({ employeeCode: employeeCode !== before.employeeCode ? employeeCode : undefined, workEmail }, id);
    const derived = await this.checked(before, dto);
    const values = { ...rest, ...(employeeCode ? { employeeCode } : {}), ...derived }; // the code cannot be emptied

    await this.prisma.employee.update({ where: { id }, data: toData(values) });
    const diff = changes(fields(before), values);
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, entityId: id, diff });
    return this.get(id, user);
  }

  async updateIdentity(id: string, dto: UpdateIdentityDto, user: SessionUser) {
    const employee = await this.row(id);
    const before = await this.prisma.employeeIdentity.findUnique({ where: { employeeId: id } });
    const dateOfBirth = await this.checkedIdentity({ id, dateOfBirth: fromDateOnly(employee.dateOfBirth) }, before, dto);

    const data = identityData(dto);
    const row = await this.prisma.$transaction(async (tx) => {
      if (dateOfBirth) await tx.employee.update({ where: { id }, data: { dateOfBirth: toDateOnly(dateOfBirth) } });
      return tx.employeeIdentity.upsert({ where: { employeeId: id }, update: data, create: { employeeId: id, ...data } });
    });

    const diff = identityChanges(before, dto);
    if (dateOfBirth) diff.dateOfBirth = { from: null, to: dateOfBirth };
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, entityId: id, diff: { identity: diff } });
    return maskedIdentity(row);
  }

  async updateBank(id: string, dto: UpdateBankDto, user: SessionUser) {
    await this.row(id);
    const before = await this.prisma.employeeBank.findUnique({ where: { employeeId: id } });
    const data = { bankName: dto.bankName, branch: dto.branch, accountNo: dto.accountNo, iban: dto.iban, holderName: dto.holderName };
    const row = await this.prisma.employeeBank.upsert({ where: { employeeId: id }, update: data, create: { employeeId: id, ...data } });

    const diff = restrictedChanges(changes(bankView(before), dto as Record<string, unknown>), ['accountNo', 'iban']);
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, entityId: id, diff: { bank: diff } });
    return maskedBank(row);
  }

  /** Deletes a profile added by mistake, with its employments. Not while it is anyone's manager on record. */
  async remove(id: string, user: SessionUser) {
    const e = await this.row(id);
    const now = await this.prisma.employment.count({ where: { managerId: id, endDate: null } });
    if (now > 0) {
      throw new ConflictException(`${now} employee(s) report to ${e.fullNameEn}. Choose another manager for them before deleting.`);
    }
    const before = await this.prisma.employment.count({ where: { managerId: id } });
    if (before > 0) {
      throw new ConflictException(`${e.fullNameEn} is the manager on record of ${before} past employment(s), so the profile is kept.`);
    }
    await this.prisma.employee.delete({ where: { id } });
    await this.audit.record({
      userId: user.id,
      action: 'delete',
      entityType: ENTITY,
      entityId: id,
      diff: { employeeCode: e.employeeCode, fullNameEn: e.fullNameEn },
    });
  }

  // ---------- helpers ----------

  /** Which employees this user may see (spec §1: row-level access). */
  private async visibleTo(user: SessionUser): Promise<Prisma.EmployeeWhereInput> {
    if (seesEveryone(user)) return {};
    const me = await this.prisma.employee.findUnique({ where: { workEmail: user.email.toLowerCase() }, select: { id: true } });
    if (!me) return { id: { in: [] } };
    if (!user.roles.includes('manager')) return { id: me.id };
    // a manager sees themself and the people whose current employment reports to them
    return { OR: [{ id: me.id }, { employments: { some: { managerId: me.id, endDate: null } } }] };
  }

  private async row(id: string): Promise<Employee> {
    const e = await this.prisma.employee.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Employee not found.');
    return e;
  }

  /** The next free EMP-#### code: one more than the highest number in use. */
  private async nextCode(): Promise<string> {
    const [{ max }] = await this.prisma.$queryRaw<{ max: number | null }[]>`
      SELECT max(substring(employee_code from 5)::int) AS max FROM employees WHERE employee_code ~ '^EMP-[0-9]+$'`;
    return `EMP-${String((max ?? 0) + 1).padStart(4, '0')}`;
  }

  private async assertFree(values: { employeeCode?: string | null; workEmail?: string | null }, exceptId?: string) {
    const not = exceptId ? { id: { not: exceptId } } : {};
    if (values.employeeCode) {
      const taken = await this.prisma.employee.findFirst({ where: { employeeCode: values.employeeCode, ...not }, select: { fullNameEn: true } });
      if (taken) throw new ConflictException(`The code ${values.employeeCode} already belongs to ${taken.fullNameEn}.`);
    }
    if (values.workEmail) {
      const taken = await this.prisma.employee.findFirst({ where: { workEmail: values.workEmail, ...not }, select: { employeeCode: true } });
      if (taken) throw new ConflictException(`The work email ${values.workEmail} already belongs to ${taken.employeeCode}.`);
    }
  }

  /** A work email must use the company's email domain (e.g. @trendlix.com), when the company profile sets one. */
  private async assertCompanyDomain(workEmail: string | null | undefined) {
    if (!workEmail) return;
    // the company profile is the one row with id 1; no row or no domain: any domain is accepted
    const company = await this.prisma.company.findUnique({ where: { id: 1 }, select: { emailDomain: true } });
    const domain = company?.emailDomain;
    if (domain && !workEmail.endsWith(`@${domain}`)) throw new BadRequestException(`The work email must end in @${domain}.`);
  }

  /** Checks of the profile that span several fields or records, and the values that follow from them. */
  private async checked(before: Employee | null, dto: CreateEmployeeDto | UpdateEmployeeDto) {
    const derived: { militaryStatus?: string } = {};
    const current = before ? fields(before) : null;

    // a woman's military status is always Not applicable, so no military papers are needed (owner's rule)
    const gender = dto.gender !== undefined ? dto.gender : (before?.gender ?? null);
    if (gender === 'female') {
      if (dto.militaryStatus && dto.militaryStatus !== 'not_applicable') {
        throw new BadRequestException('Military status applies to men only. For a woman it is Not applicable.');
      }
      if ((dto.militaryStatus ?? before?.militaryStatus ?? null) !== 'not_applicable') derived.militaryStatus = 'not_applicable';
    }

    const dateOfBirth = dto.dateOfBirth !== undefined ? dto.dateOfBirth : current?.dateOfBirth;
    if (dateOfBirth && dateOfBirth > todayInCairo()) throw new BadRequestException('The date of birth cannot be in the future.');
    if (before && dto.dateOfBirth && dto.dateOfBirth !== current!.dateOfBirth) {
      const identity = await this.prisma.employeeIdentity.findUnique({ where: { employeeId: before.id }, select: { nationalId: true } });
      const born = identity?.nationalId ? birthDateFromNationalId(identity.nationalId) : null;
      if (born && born !== dto.dateOfBirth) {
        throw new BadRequestException(`The national ID on file gives a birth date of ${born}. Check the date of birth, or correct the national ID first.`);
      }
    }

    return derived;
  }

  /**
   * The national ID checks, for a new employee (`id` null) or one on file: the ID holds a real birth date, which must
   * match the date of birth on the profile; no other employee has the same ID; and the card expires after it was
   * issued. Returns the date of birth to fill in from the ID when the profile has none.
   */
  private async checkedIdentity(
    employee: { id: string | null; dateOfBirth: string | null },
    before: EmployeeIdentity | null,
    dto: UpdateIdentityDto,
  ): Promise<string | undefined> {
    const { issueDate, expiryDate } = { ...identityView(before), ...withoutUndefined(dto) };
    let dateOfBirth: string | undefined;

    if (dto.nationalId) {
      const born = birthDateFromNationalId(dto.nationalId);
      if (!born) throw new BadRequestException('This national ID holds no real birth date (digits 2–7 are YYMMDD). Check it against the card.');
      if (employee.dateOfBirth && employee.dateOfBirth !== born) {
        throw new BadRequestException(`The national ID gives a birth date of ${born}, but the profile says ${employee.dateOfBirth}. Check both.`);
      }
      if (!employee.dateOfBirth) dateOfBirth = born; // filled in from the ID
      const other = await this.prisma.employeeIdentity.findFirst({
        where: { nationalId: dto.nationalId, ...(employee.id && { employeeId: { not: employee.id } }) },
        select: { employee: { select: { employeeCode: true } } },
      });
      if (other) throw new ConflictException(`Another employee (${other.employee.employeeCode}) already has this national ID.`);
    }
    if (issueDate && expiryDate && expiryDate <= issueDate) {
      throw new BadRequestException('The ID must expire after it was issued.');
    }
    return dateOfBirth;
  }
}
