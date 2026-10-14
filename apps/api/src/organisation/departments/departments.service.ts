import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, changes } from '../../audit/audit.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateDepartmentDto, UpdateDepartmentDto } from './department.dto.js';

const ENTITY = 'department';
const PARENT = { select: { id: true, nameEn: true, nameAr: true } } as const;
const COUNTS = { select: { jobTitles: true, children: true } } as const;
const ORDER = [{ sortOrder: 'asc' }, { nameEn: 'asc' }] as const;

// Departments and their teams (e.g. Marketing → Content Team). One level only: a team has no teams of its own.
// In the database a team is a department with a parent (parent_id).
@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every department and team in one list, in the order an Admin set; each team says which department it belongs to. */
  list() {
    return this.prisma.department.findMany({
      orderBy: [...ORDER],
      include: { parent: PARENT, _count: COUNTS },
    });
  }

  async get(id: string) {
    const dept = await this.prisma.department.findUnique({
      where: { id },
      include: {
        parent: PARENT,
        _count: COUNTS,
        children: {
          orderBy: [...ORDER],
          select: { id: true, nameEn: true, nameAr: true, sortOrder: true, _count: { select: { jobTitles: true } } },
        },
      },
    });
    if (!dept) throw new NotFoundException('Department not found.');
    return dept;
  }

  async create(dto: CreateDepartmentDto, userId: string) {
    const parentId = dto.parentId ?? null;
    await this.checkPlace(null, parentId, dto.nameEn);
    const sortOrder = await this.nextPosition(parentId);
    const dept = await this.prisma.department.create({ data: { nameEn: dto.nameEn, nameAr: dto.nameAr ?? null, parentId, sortOrder } });
    await this.audit.record({
      userId,
      action: 'create',
      entityType: ENTITY,
      entityId: dept.id,
      diff: { nameEn: dept.nameEn, nameAr: dept.nameAr, parentId },
    });
    return this.get(dept.id);
  }

  async update(id: string, dto: UpdateDepartmentDto, userId: string) {
    const before = await this.get(id);
    if (dto.parentId !== undefined || dto.nameEn !== undefined) {
      await this.checkPlace(before, dto.parentId !== undefined ? dto.parentId : before.parentId, dto.nameEn ?? before.nameEn);
    }
    // a department or team that moves goes to the end of its new list
    const moved = dto.parentId !== undefined && dto.parentId !== before.parentId;
    const sortOrder = moved ? await this.nextPosition(dto.parentId ?? null) : undefined;
    await this.prisma.department.update({ where: { id }, data: { nameEn: dto.nameEn, nameAr: dto.nameAr, parentId: dto.parentId, sortOrder } });
    const diff = changes(before, { nameEn: dto.nameEn, nameAr: dto.nameAr, parentId: dto.parentId });
    if (Object.keys(diff).length) await this.audit.record({ userId, action: 'update', entityType: ENTITY, entityId: id, diff });
    return this.get(id);
  }

  async remove(id: string, userId: string) {
    const dept = await this.get(id);
    if (dept._count.children > 0) {
      throw new ConflictException(
        `This department has ${dept._count.children} team(s). Move or delete them before deleting the department.`,
      );
    }
    if (dept._count.jobTitles > 0) {
      throw new ConflictException(
        `This department has ${dept._count.jobTitles} job title(s). Move or delete them before deleting the department.`,
      );
    }
    const employees = await this.prisma.employee.count({ where: { departmentId: id } });
    if (employees > 0) {
      throw new ConflictException(`${employees} employee(s) work in this department. Move them before deleting the department.`);
    }
    await this.prisma.department.delete({ where: { id } });
    await this.audit.record({ userId, action: 'delete', entityType: ENTITY, entityId: id, diff: { nameEn: dept.nameEn } });
  }

  /**
   * Puts all departments (parentId null), or all the teams of one department, in the given order. The list must hold
   * exactly the ones there are now, so an order saved from an outdated page can't drop or misplace one.
   */
  async reorder(parentId: string | null, ids: string[], userId: string) {
    if (parentId) await this.get(parentId);
    const current = await this.prisma.department.findMany({ where: { parentId }, select: { id: true, nameEn: true } });
    const names = new Map(current.map((d) => [d.id, d.nameEn]));
    if (ids.length !== current.length || ids.some((id) => !names.has(id))) {
      throw new BadRequestException(
        `The list doesn't match the current ${parentId ? 'teams' : 'departments'}: one was added or removed meanwhile. Reload the page and try again.`,
      );
    }
    await this.prisma.$transaction(ids.map((id, i) => this.prisma.department.update({ where: { id }, data: { sortOrder: i + 1 } })));
    await this.audit.record({ userId, action: 'reorder', entityType: ENTITY, entityId: parentId, diff: { order: ids.map((id) => names.get(id)) } });
  }

  /** One past the last position among departments (parentId null) or among one department's teams. */
  private async nextPosition(parentId: string | null): Promise<number> {
    const { _max } = await this.prisma.department.aggregate({ where: { parentId }, _max: { sortOrder: true } });
    return (_max.sortOrder ?? 0) + 1;
  }

  /**
   * Where a department may go: into a department as a team (never into itself or into a team), and only if it has
   * no teams of its own; and its English name must be free among the departments, or among the teams of the same
   * department.
   */
  private async checkPlace(
    self: { id: string; parentId: string | null; _count: { children: number; jobTitles: number } } | null,
    parentId: string | null,
    nameEn: string,
  ) {
    if (parentId) {
      if (self && parentId === self.id) throw new BadRequestException('A department cannot be a team of itself.');
      const parent = await this.prisma.department.findUnique({ where: { id: parentId }, select: { parentId: true, nameEn: true } });
      if (!parent) throw new BadRequestException('Department not found. Choose one from the list.');
      if (parent.parentId) {
        throw new BadRequestException(`${parent.nameEn} is itself a team. Teams go one level deep: choose a department.`);
      }
      if (self && self._count.children > 0) {
        throw new BadRequestException('This department has teams, so it cannot become a team itself. Move its teams first.');
      }
    } else if (self?.parentId && self._count.jobTitles > 0) {
      // taking a team out of its department would leave its job titles directly in a department
      throw new BadRequestException(
        `This team has ${self._count.jobTitles} job title(s), and job titles belong to teams. Move them to another team first.`,
      );
    }
    const twin = await this.prisma.department.findFirst({
      where: { parentId, nameEn: { equals: nameEn, mode: 'insensitive' }, ...(self && { id: { not: self.id } }) },
      select: { id: true },
    });
    if (twin) {
      throw new ConflictException(
        parentId ? `There is already a team named "${nameEn}" in this department.` : `There is already a department named "${nameEn}".`,
      );
    }
  }
}
