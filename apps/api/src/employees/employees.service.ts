import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PROBATION_MONTHS } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { addMonths, fromDateOnly, toDateOnly, todayInCairo } from '../common/date-only.js';
import { fromTimeOfDay } from '../common/time-of-day.js';
import type { Employee, EmployeeBank, EmployeeIdentity, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { editsEmployees, seesBank, seesEveryone, seesIdentity } from './access.js';
import { birthDateFromNationalId, maskTail } from './checks.js';
import type { CreateEmployeeDto, UpdateBankDto, UpdateEmployeeDto, UpdateIdentityDto } from './employee.dto.js';

const ENTITY = 'employee';
const DATE_FIELDS = ['dateOfBirth', 'joinDate', 'probationEnd', 'jdAcknowledgedAt'] as const;

const SUMMARY = {
  id: true,
  employeeCode: true,
  fullNameEn: true,
  fullNameAr: true,
  workEmail: true,
  status: true,
  employmentType: true,
  joinDate: true,
  department: { select: { id: true, nameEn: true, parent: { select: { id: true, nameEn: true, nameAr: true } } } },
  jobTitle: { select: { id: true, titleEn: true } },
  manager: { select: { id: true, fullNameEn: true } },
} satisfies Prisma.EmployeeSelect;

const PROFILE = {
  department: { select: { id: true, nameEn: true, nameAr: true, parent: { select: { id: true, nameEn: true, nameAr: true } } } },
  jobTitle: { select: { id: true, titleEn: true, titleAr: true, grade: true, jdVersion: true } },
  manager: { select: { id: true, employeeCode: true, fullNameEn: true } },
  shift: { select: { id: true, code: true, startTime: true, endTime: true } },
  reports: {
    select: { id: true, employeeCode: true, fullNameEn: true, status: true, jobTitle: { select: { titleEn: true } } },
    orderBy: { fullNameEn: 'asc' },
  },
} satisfies Prisma.EmployeeInclude;

type DateField = (typeof DATE_FIELDS)[number];
type EmployeeFields = Omit<Employee, DateField> & Record<DateField, string | null>;

/** The employee's own columns as the API sends them: dates as YYYY-MM-DD, office days in order. */
function fields(e: Employee): EmployeeFields {
  return {
    ...e,
    dateOfBirth: fromDateOnly(e.dateOfBirth),
    joinDate: fromDateOnly(e.joinDate),
    probationEnd: fromDateOnly(e.probationEnd),
    jdAcknowledgedAt: fromDateOnly(e.jdAcknowledgedAt),
    officeDays: [...e.officeDays].sort((a, b) => a - b),
  };
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
    issuingOffice: row?.issuingOffice ?? null,
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
    issuingOffice: dto.issuingOffice,
  };
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: SessionUser) {
    const rows = await this.prisma.employee.findMany({
      where: await this.visibleTo(user),
      select: SUMMARY,
      orderBy: { employeeCode: 'asc' },
    });
    return rows.map((e) => ({ ...e, joinDate: fromDateOnly(e.joinDate) }));
  }

  async get(id: string, user: SessionUser) {
    const identity = seesIdentity(user);
    const bank = seesBank(user);
    const e = await this.prisma.employee.findFirst({
      where: { AND: [{ id }, await this.visibleTo(user)] },
      include: { ...PROFILE, identity, bank },
    });
    if (!e) throw new NotFoundException('Employee not found.');

    const { department, jobTitle, manager, shift, reports, identity: idRow, bank: bankRow, ...own } = e;
    return {
      ...fields(own),
      department,
      jobTitle,
      manager,
      shift: shift && { ...shift, startTime: fromTimeOfDay(shift.startTime), endTime: fromTimeOfDay(shift.endTime) },
      reports,
      ...(identity && { identity: maskedIdentity(idRow ?? null) }),
      ...(bank && { bank: maskedBank(bankRow ?? null) }),
      access: { edit: editsEmployees(user), identity, bank },
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
   * Adds an employee, with their national ID details when sent (e.g. read from the ID card first): everything is
   * checked before anything is saved, and the employee and the national ID are saved together or not at all.
   */
  async create(dto: CreateEmployeeDto, user: SessionUser) {
    const { employeeCode: code, identity: sentIdentity, ...given } = dto;
    const employeeCode = code ?? (await this.nextCode());
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
    await this.assertFree(
      {
        employeeCode: employeeCode !== before.employeeCode ? employeeCode : undefined,
        workEmail: dto.workEmail !== before.workEmail ? dto.workEmail : undefined,
      },
      id,
    );
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

  async remove(id: string, user: SessionUser) {
    const e = await this.row(id);
    const reports = await this.prisma.employee.count({ where: { managerId: id } });
    if (reports > 0) {
      throw new ConflictException(`${reports} employee(s) report to ${e.fullNameEn}. Choose another manager for them before deleting.`);
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
    return user.roles.includes('manager') ? { OR: [{ id: me.id }, { managerId: me.id }] } : { id: me.id };
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

  /**
   * Checks that span several fields or other records, and the values that follow from them: the department of the
   * chosen job title, office days only for Hybrid, the default probation end. Returns the values to write as well.
   */
  private async checked(before: Employee | null, dto: CreateEmployeeDto | UpdateEmployeeDto) {
    const derived: { departmentId?: string | null; officeDays?: number[]; probationEnd?: string | null; militaryStatus?: string } = {};
    const current = before ? fields(before) : null;

    // department follows the job title
    if (dto.jobTitleId !== undefined || dto.departmentId !== undefined) {
      const jobTitleId = dto.jobTitleId !== undefined ? dto.jobTitleId : (before?.jobTitleId ?? null);
      if (jobTitleId) {
        const job = await this.prisma.jobTitle.findUnique({
          where: { id: jobTitleId },
          select: { titleEn: true, departmentId: true, department: { select: { nameEn: true } } },
        });
        if (!job) throw new BadRequestException('Job title not found. Choose one from the list.');
        if (dto.departmentId && dto.departmentId !== job.departmentId) {
          throw new BadRequestException(`The job title "${job.titleEn}" belongs to ${job.department.nameEn}. Choose that department, or another job title.`);
        }
        derived.departmentId = job.departmentId;
      } else if (dto.departmentId) {
        const exists = await this.prisma.department.count({ where: { id: dto.departmentId } });
        if (!exists) throw new BadRequestException('Department not found. Choose one from the list.');
      }
    }

    if (dto.managerId) {
      if (before && dto.managerId === before.id) throw new BadRequestException('An employee cannot be their own manager.');
      const manager = await this.prisma.employee.findUnique({ where: { id: dto.managerId }, select: { id: true } });
      if (!manager) throw new BadRequestException('Manager not found. Choose one from the list.');
      if (before) await this.assertNoLoop(before.id, dto.managerId);
    }

    if (dto.shiftId) {
      const exists = await this.prisma.shift.count({ where: { id: dto.shiftId } });
      if (!exists) throw new BadRequestException('Shift not found. Choose one from the list.');
    }

    // office days are kept for Hybrid only
    if (!before || dto.workArrangement !== undefined || dto.officeDays !== undefined) {
      const arrangement = dto.workArrangement ?? before?.workArrangement ?? 'office';
      const days = [...(dto.officeDays ?? before?.officeDays ?? [])].sort((a, b) => a - b);
      if (arrangement === 'hybrid' && days.length === 0) throw new BadRequestException('Choose the office days for a Hybrid work arrangement.');
      derived.officeDays = arrangement === 'hybrid' ? days : [];
    }

    // Probation ends PROBATION_MONTHS after joining unless HR sets another date (left empty: the default).
    // A default end date moves with the join date.
    const joinDate = dto.joinDate ?? current!.joinDate!;
    const wasDefault = current !== null && current.probationEnd === addMonths(current.joinDate!, PROBATION_MONTHS);
    if (dto.probationEnd === null || (dto.probationEnd === undefined && (!current || (dto.joinDate && wasDefault)))) {
      derived.probationEnd = addMonths(joinDate, PROBATION_MONTHS);
    }
    const probationEnd = derived.probationEnd ?? dto.probationEnd ?? current?.probationEnd ?? null;
    if (probationEnd && probationEnd < joinDate) throw new BadRequestException('Probation must end on or after the join date.');

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

  /** The chosen manager must not report to this employee, directly or through others. */
  private async assertNoLoop(employeeId: string, managerId: string) {
    let current: string | null = managerId;
    for (let steps = 0; current && steps < 1000; steps++) {
      if (current === employeeId) {
        throw new BadRequestException('That manager reports to this employee, directly or through others. Choose someone else.');
      }
      const next: { managerId: string | null } | null = await this.prisma.employee.findUnique({ where: { id: current }, select: { managerId: true } });
      current = next?.managerId ?? null;
    }
  }
}
