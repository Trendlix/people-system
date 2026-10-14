import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, changes } from '../../audit/audit.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateDepartmentDto, UpdateDepartmentDto } from './department.dto.js';

const ENTITY = 'department';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.department.findMany({
      orderBy: { nameEn: 'asc' },
      include: { _count: { select: { jobTitles: true } } },
    });
  }

  async get(id: string) {
    const dept = await this.prisma.department.findUnique({
      where: { id },
      include: { _count: { select: { jobTitles: true } } },
    });
    if (!dept) throw new NotFoundException('Department not found.');
    return dept;
  }

  async create(dto: CreateDepartmentDto, userId: string) {
    const dept = await this.prisma.department.create({ data: { nameEn: dto.nameEn, nameAr: dto.nameAr ?? null } });
    await this.audit.record({ userId, action: 'create', entityType: ENTITY, entityId: dept.id, diff: { nameEn: dept.nameEn, nameAr: dept.nameAr } });
    return dept;
  }

  async update(id: string, dto: UpdateDepartmentDto, userId: string) {
    const before = await this.get(id);
    const dept = await this.prisma.department.update({ where: { id }, data: { nameEn: dto.nameEn, nameAr: dto.nameAr } });
    const diff = changes(before, { nameEn: dto.nameEn, nameAr: dto.nameAr });
    if (Object.keys(diff).length) await this.audit.record({ userId, action: 'update', entityType: ENTITY, entityId: id, diff });
    return dept;
  }

  async remove(id: string, userId: string) {
    const dept = await this.get(id);
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
}
