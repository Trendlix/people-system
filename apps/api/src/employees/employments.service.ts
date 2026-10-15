import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PROBATION_MONTHS } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { addDays, addMonths, fromDateOnly, toDateOnly, todayInCairo } from '../common/date-only.js';
import type { Employment, Prisma } from '../generated/prisma/client.js';
import { gradeRange, inGradeRange } from '../organisation/grades/grade-range.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateEmploymentDto, EndEmploymentDto, UpdateEmploymentDto } from './employment.dto.js';
import { EmployeesService } from './employees.service.js';

const ENTITY = 'employment';
/** The database, or a transaction in it. */
type Db = PrismaService | Prisma.TransactionClient;
const DATE_FIELDS = ['joinDate', 'probationEnd', 'jdAcknowledgedAt', 'endDate'] as const;
/** An end of the range of grades a job title takes. */
const RANGE_END = { select: { code: true, rank: true } } as const;

/** An employment's own columns as the API sends them, for comparing and the audit log. */
function fields(e: Employment) {
  return {
    ...e,
    joinDate: fromDateOnly(e.joinDate),
    probationEnd: fromDateOnly(e.probationEnd),
    jdAcknowledgedAt: fromDateOnly(e.jdAcknowledgedAt),
    endDate: fromDateOnly(e.endDate),
    officeDays: [...e.officeDays].sort((a, b) => a - b),
  };
}

/** What Prisma writes: YYYY-MM-DD strings become dates. */
function toData<T extends Record<string, unknown>>(values: T): T {
  const data: Record<string, unknown> = { ...values };
  for (const key of DATE_FIELDS) if (typeof data[key] === 'string') data[key] = toDateOnly(data[key]);
  return data as T;
}

// Employments: hiring someone whose profile exists, changing the employment, ending it (resignation, termination …)
// and keeping the earlier ones as history. One employment per person is current at a time: the one without an end.
@Injectable()
export class EmploymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
  ) {}

  /**
   * Hires someone: a new current employment. Not while they have one, nor starting before their last one ended. The
   * status is the system's (owner's decision, 16 October 2026): Probation while the worked-out probation runs, else
   * Active (a rehire, no probation in the contract settings, a hire back-dated past its probation).
   */
  async create(employeeId: string, dto: CreateEmploymentDto, user: SessionUser) {
    const person = await this.person(employeeId);
    const current = await this.prisma.employment.findFirst({ where: { employeeId, endDate: null }, select: { joinDate: true } });
    if (current) {
      throw new ConflictException(`${person.fullNameEn} already has a current employment, since ${fromDateOnly(current.joinDate)}. End it before adding a new one.`);
    }
    const last = await this.prisma.employment.findFirst({ where: { employeeId }, orderBy: { endDate: 'desc' }, select: { endDate: true } });
    const lastEnd = fromDateOnly(last?.endDate ?? null);
    if (lastEnd && dto.joinDate <= lastEnd) {
      throw new BadRequestException(`The last employment ended on ${lastEnd}: the new one must start after that.`);
    }
    const derived = await this.checked(employeeId, null, dto);
    const { employmentType, joinDate, ...rest } = dto;
    const status = derived.probationEnd && derived.probationEnd >= todayInCairo() ? ('probation' as const) : ('active' as const);
    const values = { employmentType, joinDate, ...rest, ...derived, status };

    const row = await this.prisma.employment.create({ data: toData({ ...values, employeeId }) });
    const { id: _id, createdAt: _c, updatedAt: _u, ...created } = fields(row);
    await this.audit.record({ userId: user.id, action: 'create', entityType: ENTITY, entityId: row.id, diff: created });
    return this.employees.get(employeeId, user);
  }

  /**
   * Changes an employment: the current one, or an ended one in the history (e.g. a wrong date, including how and
   * when it ended). An employment never overlaps another of the same person. HR moves a current one between Active and
   * On leave; Probation and Notice period are the system's (owner's decision, 16 October 2026).
   */
  async update(employeeId: string, employmentId: string, dto: UpdateEmploymentDto, user: SessionUser) {
    const before = await this.row(employeeId, employmentId);
    const ending = dto.endDate !== undefined || dto.endReason !== undefined || dto.endNote !== undefined;
    if (!before.endDate && ending) throw new BadRequestException('This employment is current: end it with End employment.');
    if (before.endDate && dto.status !== undefined) {
      throw new BadRequestException('This employment has ended: its status follows why it ended.');
    }
    if (dto.status !== undefined && dto.status !== before.status) await this.assertStatusChosen(employeeId, before);
    const derived = await this.checked(employeeId, before, dto);
    const { ...sent } = dto;
    // the status of an ended employment follows the reason it ended
    const status = dto.endReason ? { status: dto.endReason === 'resigned' ? ('resigned' as const) : ('terminated' as const) } : {};
    const values = { ...sent, ...derived, ...status };
    const joinDate = values.joinDate ?? fromDateOnly(before.joinDate)!;
    const endDate = values.endDate ?? fromDateOnly(before.endDate);
    if (endDate && joinDate > endDate) throw new BadRequestException('An employment must start on or before the day it ended.');
    await this.assertNoOverlap(employeeId, employmentId, joinDate, endDate);

    await this.prisma.employment.update({ where: { id: employmentId }, data: toData(values) });
    const diff = changes(fields(before), values);
    if (Object.keys(diff).length) {
      await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, entityId: employmentId, diff: { employeeId, ...diff } });
    }
    return this.employees.get(employeeId, user);
  }

  /**
   * Ends the current employment: the last working day and why. Resigned gives the status Resigned, anything else
   * Terminated. The profile stays. Not while people report to this person: they need another manager first.
   */
  async end(employeeId: string, employmentId: string, dto: EndEmploymentDto, user: SessionUser) {
    await this.close(employeeId, employmentId, dto, user);
    return this.employees.get(employeeId, user);
  }

  /**
   * What ending an employment does, by hand (End employment) or when HR completes an approved ending (the contracts
   * module): the checks, the end date, reason and status, and the signed contract marked ended (owner's decisions, 15
   * October 2026). `db` is the transaction to run in, when the caller has one.
   */
  async close(employeeId: string, employmentId: string, dto: EndEmploymentDto, user: SessionUser, db: Db = this.prisma) {
    const before = await this.row(employeeId, employmentId, db);
    if (before.endDate) throw new ConflictException(`This employment already ended on ${fromDateOnly(before.endDate)}.`);
    if (dto.endDate < fromDateOnly(before.joinDate)!) throw new BadRequestException('The last working day must be on or after the join date.');
    const reports = await db.employment.count({ where: { managerId: employeeId, endDate: null } });
    if (reports > 0) {
      throw new ConflictException(`${reports} employee(s) report to this person. Choose another manager for them before ending this employment.`);
    }
    const status = dto.endReason === 'resigned' ? 'resigned' : 'terminated';
    await db.employment.update({
      where: { id: employmentId },
      data: { endDate: toDateOnly(dto.endDate), endReason: dto.endReason, endNote: dto.endNote ?? null, status },
    });
    // the signed contract ends with the employment
    const contract = await db.contract.findFirst({ where: { employmentId, status: 'active' }, select: { id: true, number: true } });
    if (contract) await db.contract.update({ where: { id: contract.id }, data: { status: 'ended' } });
    await this.audit.record({
      userId: user.id,
      action: 'end',
      entityType: ENTITY,
      entityId: employmentId,
      diff: {
        employeeId,
        endDate: dto.endDate,
        endReason: dto.endReason,
        status: { from: before.status, to: status },
        ...(contract && { contract: { number: contract.number, status: { from: 'active', to: 'ended' } } }),
      },
    });
  }

  /** Confirms someone on probation: the status becomes Active. */
  async confirmProbation(employeeId: string, employmentId: string, user: SessionUser) {
    const before = await this.row(employeeId, employmentId);
    if (before.endDate || before.status !== 'probation') {
      const person = await this.person(employeeId);
      throw new ConflictException(`${person.fullNameEn} is not on probation, so there is nothing to confirm.`);
    }
    await this.prisma.employment.update({ where: { id: employmentId }, data: { status: 'active' } });
    await this.audit.record({
      userId: user.id,
      action: 'confirm_probation',
      entityType: ENTITY,
      entityId: employmentId,
      diff: { employeeId, status: { from: 'probation', to: 'active' }, probationEnd: fromDateOnly(before.probationEnd) },
    });
    return this.employees.get(employeeId, user);
  }

  /**
   * Deletes an employment added by mistake: a Super Admin only (owner's decision, 15 October 2026). A current one not
   * while people report to this person.
   */
  async remove(employeeId: string, employmentId: string, user: SessionUser) {
    assertDeletes(user);
    const e = await this.row(employeeId, employmentId);
    if (!e.endDate) {
      const reports = await this.prisma.employment.count({ where: { managerId: employeeId, endDate: null } });
      if (reports > 0) throw new ConflictException(`${reports} employee(s) report to this person. Choose another manager for them first.`);
    }
    await this.prisma.employment.delete({ where: { id: employmentId } });
    await this.audit.record({
      userId: user.id,
      action: 'delete',
      entityType: ENTITY,
      entityId: employmentId,
      diff: { employeeId, joinDate: fromDateOnly(e.joinDate), endDate: fromDateOnly(e.endDate) },
    });
  }

  // ---------- helpers ----------

  /**
   * HR changes the status of a current employment only while it is Active or On leave. Probation ends with Confirm
   * probation, and Notice period follows the approved ending, back as it was if the ending is withdrawn (owner's
   * decision, 16 October 2026).
   */
  private async assertStatusChosen(employeeId: string, before: Employment) {
    if (before.status !== 'probation' && before.status !== 'notice_period') return;
    const person = await this.person(employeeId);
    throw new BadRequestException(
      before.status === 'probation'
        ? `${person.fullNameEn} is on probation: the status becomes Active with Confirm probation.`
        : `${person.fullNameEn} is working out their notice: the status follows the approved ending (withdraw it to go back).`,
    );
  }

  /** The period from `joinDate` to `endDate` (open while current) must not overlap another employment of the person. */
  private async assertNoOverlap(employeeId: string, exceptId: string, joinDate: string, endDate: string | null) {
    const others = await this.prisma.employment.findMany({
      where: { employeeId, id: { not: exceptId } },
      select: { joinDate: true, endDate: true },
    });
    const FOREVER = '9999-12-31';
    for (const o of others) {
      const from = fromDateOnly(o.joinDate)!;
      const to = fromDateOnly(o.endDate);
      if (joinDate <= (to ?? FOREVER) && from <= (endDate ?? FOREVER)) {
        throw new BadRequestException(`These dates overlap the employment from ${from} to ${to ?? 'now'}. Employments of one person follow each other.`);
      }
    }
  }

  private async person(id: string) {
    const e = await this.prisma.employee.findUnique({ where: { id }, select: { id: true, fullNameEn: true } });
    if (!e) throw new NotFoundException('Employee not found.');
    return e;
  }

  private async row(employeeId: string, employmentId: string, db: Db = this.prisma): Promise<Employment> {
    const e = await db.employment.findFirst({ where: { id: employmentId, employeeId } });
    if (!e) throw new NotFoundException('Employment not found.');
    return e;
  }

  /**
   * Checks that span several fields or other records, and the values that follow from them: the department or team
   * of the chosen job title, a grade the job title takes, office days only for Hybrid, the default probation end.
   * Returns the values to write as well.
   */
  private async checked(employeeId: string, before: Employment | null, dto: CreateEmploymentDto | UpdateEmploymentDto) {
    const derived: { departmentId?: string | null; officeDays?: number[]; probationEnd?: string | null } = {};
    const current = before ? fields(before) : null;

    // the department or team follows the job title: the one it belongs to, a department itself (e.g. Head of
    // Marketing, in Marketing) or one of its teams (owner's decision, 15 October 2026)
    if (dto.jobTitleId !== undefined || dto.departmentId !== undefined) {
      const jobTitleId = dto.jobTitleId !== undefined ? dto.jobTitleId : (before?.jobTitleId ?? null);
      if (jobTitleId) {
        const job = await this.prisma.jobTitle.findUnique({
          where: { id: jobTitleId },
          select: { titleEn: true, departmentId: true, department: { select: { nameEn: true, parentId: true } } },
        });
        if (!job) throw new BadRequestException('Job title not found. Choose one from the list.');
        if (dto.departmentId && dto.departmentId !== job.departmentId) {
          const place = job.department.parentId ? 'that team' : 'that department';
          throw new BadRequestException(`The job title "${job.titleEn}" belongs to ${job.department.nameEn}. Choose ${place}, or another job title.`);
        }
        derived.departmentId = job.departmentId;
      } else if (dto.departmentId) {
        const exists = await this.prisma.department.count({ where: { id: dto.departmentId } });
        if (!exists) throw new BadRequestException('Department or team not found. Choose one from the list.');
      }
    }

    await this.assertGradeFits(before, dto);

    if (dto.managerId) {
      if (dto.managerId === employeeId) throw new BadRequestException('An employee cannot be their own manager.');
      const manager = await this.prisma.employee.findUnique({ where: { id: dto.managerId }, select: { id: true } });
      if (!manager) throw new BadRequestException('Manager not found. Choose one from the list.');
      await this.assertNoLoop(employeeId, dto.managerId);
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

    // the probation end is never typed (owner, 15 October 2026): worked out again at every save
    const joinDate = dto.joinDate ?? current!.joinDate!;
    derived.probationEnd = await this.probationEnd(employeeId, before, joinDate);

    return derived;
  }

  /**
   * When probation ends (Labour Law Art. 90: at most 3 months, once per employer): the first contract's probation once
   * there is one, drafted or signed (a draft made from a job offer has the offer's, which the employment was given
   * when it was made); before that the contract settings' months from the join date, to the day before (as the
   * contract will have it); none for someone who already worked for the company.
   */
  private async probationEnd(employeeId: string, before: Employment | null, joinDate: string): Promise<string | null> {
    if (before) {
      const first = await this.prisma.contract.findFirst({ where: { employmentId: before.id, version: 1 }, select: { probationEnd: true } });
      if (first) return fromDateOnly(first.probationEnd);
    }
    const earlier = await this.prisma.employment.count({ where: { employeeId, ...(before && { id: { not: before.id } }), joinDate: { lt: toDateOnly(joinDate) } } });
    if (earlier) return null;
    const settings = await this.prisma.contractSettings.findUnique({ where: { id: 1 }, select: { probationMonths: true } });
    const months = settings?.probationMonths ?? PROBATION_MONTHS;
    return months > 0 ? addDays(addMonths(joinDate, months), -1) : null;
  }

  /**
   * The grade must be one the job title takes, when it has a range (owner's decision, 15 October 2026). Checked when
   * either is chosen or changed, against the other as saved; a range narrowed since leaves the history as it was.
   */
  private async assertGradeFits(before: Employment | null, dto: CreateEmploymentDto | UpdateEmploymentDto) {
    const jobTitleChanged = dto.jobTitleId !== undefined && dto.jobTitleId !== (before?.jobTitleId ?? null);
    const gradeChanged = dto.gradeId !== undefined && dto.gradeId !== (before?.gradeId ?? null);
    if (!jobTitleChanged && !gradeChanged) return;
    const jobTitleId = dto.jobTitleId !== undefined ? dto.jobTitleId : (before?.jobTitleId ?? null);
    const gradeId = dto.gradeId !== undefined ? dto.gradeId : (before?.gradeId ?? null);
    if (!gradeId) return;

    const grade = await this.prisma.grade.findUnique({ where: { id: gradeId }, select: { rank: true } });
    if (!grade) throw new BadRequestException('Grade not found. Choose one from the list.');
    if (!jobTitleId) return;
    const job = await this.prisma.jobTitle.findUnique({
      where: { id: jobTitleId },
      select: { titleEn: true, minGrade: RANGE_END, maxGrade: RANGE_END },
    });
    if (!job || inGradeRange(grade.rank, job.minGrade, job.maxGrade)) return; // an unknown job title is refused above
    const only = job.minGrade && job.maxGrade && job.minGrade.rank === job.maxGrade.rank ? job.minGrade.code : null;
    throw new BadRequestException(
      only
        ? `${job.titleEn} takes grade ${only} only. Choose that grade, or widen the job title's grades.`
        : `${job.titleEn} takes grades ${gradeRange(job.minGrade, job.maxGrade)}. Choose a grade in that range.`,
    );
  }

  /** The chosen manager must not report to this person, directly or through others (by current employments). */
  private async assertNoLoop(employeeId: string, managerId: string) {
    let current: string | null = managerId;
    for (let steps = 0; current && steps < 1000; steps++) {
      if (current === employeeId) {
        throw new BadRequestException('That manager reports to this employee, directly or through others. Choose someone else.');
      }
      const next: { managerId: string | null } | null = await this.prisma.employment.findFirst({
        where: { employeeId: current, endDate: null },
        select: { managerId: true },
      });
      current = next?.managerId ?? null;
    }
  }
}
