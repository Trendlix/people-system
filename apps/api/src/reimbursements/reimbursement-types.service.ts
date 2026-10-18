import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, changes } from '../audit/audit.service.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateReimbursementTypeDto, UpdateReimbursementTypeDto } from './reimbursements.dto.js';
import { capsProblem } from './rules.js';
import { COUNT_CLAIMS, TYPE_ENTITY, typeView, type ReimbursementTypeView } from './views.js';

/** The conditions a type is checked and logged with. */
interface TypeConditions {
  nameEn: string;
  nameAr: string;
  description: string | null;
  receiptRequired: boolean;
  capPerClaim: number | null;
  capPerMonth: number | null;
  capPerYear: number | null;
  claimWithinDays: number | null;
  departmentIds: string[];
  gradeIds: string[];
  employmentTypes: string[];
  active: boolean;
}

// Reimbursement types (owner, 18 October 2026: "allow the employee to add reimbursement request … for specific preset up
// conditions", and "in the setup i need to enter for it a cap"): Payroll Setup's Reimbursement Types. HR adds and
// changes them, each with its conditions (packages/shared reimbursements.ts); Finance and the CEO read them. A change
// applies to the claims sent after it: a claim sent is never checked again. HR turns one off rather than deleting it;
// only a Super Admin deletes one, and only one without claims (owner's decision, 15 October 2026). Every change is in
// the audit log.
@Injectable()
export class ReimbursementTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every type: the ones on first, then by name. */
  async list(): Promise<ReimbursementTypeView[]> {
    const rows = await this.prisma.reimbursementType.findMany({ orderBy: [{ active: 'desc' }, { nameEn: 'asc' }], include: COUNT_CLAIMS });
    return rows.map(typeView);
  }

  async create(dto: CreateReimbursementTypeDto, user: SessionUser): Promise<ReimbursementTypeView> {
    const after: TypeConditions = {
      nameEn: dto.nameEn,
      nameAr: dto.nameAr,
      description: dto.description ?? null,
      receiptRequired: dto.receiptRequired ?? true,
      capPerClaim: dto.capPerClaim ?? null,
      capPerMonth: dto.capPerMonth ?? null,
      capPerYear: dto.capPerYear ?? null,
      claimWithinDays: dto.claimWithinDays ?? null,
      departmentIds: unique(dto.departmentIds ?? []),
      gradeIds: unique(dto.gradeIds ?? []),
      employmentTypes: unique(dto.employmentTypes ?? []),
      active: dto.active ?? true,
    };
    await this.check(after);
    const row = await this.prisma.reimbursementType.create({ data: after, include: COUNT_CLAIMS });
    await this.audit.record({ userId: user.id, action: 'create', entityType: TYPE_ENTITY, entityId: row.id, diff: after });
    return typeView(row);
  }

  /** Changes a type: each field sent. The claims sent before keep what they were checked with. */
  async update(id: string, dto: UpdateReimbursementTypeDto, user: SessionUser): Promise<ReimbursementTypeView> {
    const before = await this.get(id);
    const was: TypeConditions = {
      nameEn: before.nameEn,
      nameAr: before.nameAr,
      description: before.description,
      receiptRequired: before.receiptRequired,
      capPerClaim: before.capPerClaim,
      capPerMonth: before.capPerMonth,
      capPerYear: before.capPerYear,
      claimWithinDays: before.claimWithinDays,
      departmentIds: [...before.departmentIds],
      gradeIds: [...before.gradeIds],
      employmentTypes: [...before.employmentTypes],
      active: before.active,
    };
    const sent = <T>(value: T | undefined, current: T) => (value === undefined ? current : value);
    const after: TypeConditions = {
      nameEn: dto.nameEn ?? was.nameEn,
      nameAr: dto.nameAr ?? was.nameAr,
      description: sent(dto.description, was.description),
      receiptRequired: dto.receiptRequired ?? was.receiptRequired,
      capPerClaim: sent(dto.capPerClaim, was.capPerClaim),
      capPerMonth: sent(dto.capPerMonth, was.capPerMonth),
      capPerYear: sent(dto.capPerYear, was.capPerYear),
      claimWithinDays: sent(dto.claimWithinDays, was.claimWithinDays),
      departmentIds: dto.departmentIds ? unique(dto.departmentIds) : was.departmentIds,
      gradeIds: dto.gradeIds ? unique(dto.gradeIds) : was.gradeIds,
      employmentTypes: dto.employmentTypes ? unique(dto.employmentTypes) : was.employmentTypes,
      active: dto.active ?? was.active,
    };
    const diff = changes({ ...was }, { ...after });
    if (!Object.keys(diff).length) return before;
    await this.check(after, id);
    const row = await this.prisma.reimbursementType.update({ where: { id }, data: after, include: COUNT_CLAIMS });
    await this.audit.record({ userId: user.id, action: 'update', entityType: TYPE_ENTITY, entityId: id, diff: { nameEn: was.nameEn, ...diff } });
    return typeView(row);
  }

  /** Deletes a type without claims: a Super Admin only (owner's decision, 15 October 2026). */
  async remove(id: string, user: SessionUser): Promise<void> {
    assertDeletes(user);
    const type = await this.get(id);
    if (type.claims > 0) throw new ConflictException(`${type.nameEn} has ${type.claims} claim${type.claims === 1 ? '' : 's'}, so it can't be deleted. Turn it off instead.`);
    await this.prisma.reimbursementType.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'delete', entityType: TYPE_ENTITY, entityId: id, diff: { nameEn: type.nameEn, nameAr: type.nameAr } });
  }

  // ---------- helpers ----------

  private async get(id: string): Promise<ReimbursementTypeView> {
    const row = await this.prisma.reimbursementType.findUnique({ where: { id }, include: COUNT_CLAIMS });
    if (!row) throw new NotFoundException('Reimbursement type not found.');
    return typeView(row);
  }

  /** The English name free (whatever the case), the caps fitting together, the departments and grades on the lists. */
  private async check(c: TypeConditions, exceptId?: string): Promise<void> {
    const taken = await this.prisma.reimbursementType.findFirst({
      where: { nameEn: { equals: c.nameEn, mode: 'insensitive' }, ...(exceptId && { id: { not: exceptId } }) },
      select: { nameEn: true },
    });
    if (taken) throw new ConflictException(`There is already a reimbursement type called ${taken.nameEn}. Choose another name.`);
    const caps = capsProblem(c);
    if (caps) throw new BadRequestException(caps);
    if (c.departmentIds.length && (await this.prisma.department.count({ where: { id: { in: c.departmentIds } } })) !== c.departmentIds.length) {
      throw new BadRequestException('One of the departments chosen is no longer on the list. Reload the page and choose again.');
    }
    if (c.gradeIds.length && (await this.prisma.grade.count({ where: { id: { in: c.gradeIds } } })) !== c.gradeIds.length) {
      throw new BadRequestException('One of the grades chosen is no longer on the list. Reload the page and choose again.');
    }
  }
}

const unique = <T>(list: readonly T[]): T[] => [...new Set(list)];
