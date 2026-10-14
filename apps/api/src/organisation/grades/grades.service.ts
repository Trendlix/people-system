import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, changes } from '../../audit/audit.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateGradeDto, UpdateGradeDto } from './grade.dto.js';

const ENTITY = 'grade';
const COUNTS = { _count: { select: { jobTitles: true } } } as const;

// The grading system: G1 Entry Level … G9 Executive, lowest rank first. Each job title has one.
@Injectable()
export class GradesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.grade.findMany({ orderBy: { rank: 'asc' }, include: COUNTS });
  }

  async get(id: string) {
    const grade = await this.prisma.grade.findUnique({ where: { id }, include: COUNTS });
    if (!grade) throw new NotFoundException('Grade not found.');
    return grade;
  }

  async create(dto: CreateGradeDto, userId: string) {
    await this.assertFree(dto.code, dto.rank);
    const grade = await this.prisma.grade.create({
      data: { code: dto.code, rank: dto.rank, levelEn: dto.levelEn, levelAr: dto.levelAr ?? null, description: dto.description ?? null },
    });
    const { code, rank, levelEn, levelAr, description } = grade;
    await this.audit.record({ userId, action: 'create', entityType: ENTITY, entityId: grade.id, diff: { code, rank, levelEn, levelAr, description } });
    return this.get(grade.id);
  }

  async update(id: string, dto: UpdateGradeDto, userId: string) {
    const before = await this.get(id);
    await this.assertFree(dto.code !== before.code ? dto.code : undefined, dto.rank !== before.rank ? dto.rank : undefined);
    const fields = { code: dto.code, rank: dto.rank, levelEn: dto.levelEn, levelAr: dto.levelAr, description: dto.description };
    await this.prisma.grade.update({ where: { id }, data: fields });
    const diff = changes(before, fields);
    if (Object.keys(diff).length) await this.audit.record({ userId, action: 'update', entityType: ENTITY, entityId: id, diff });
    return this.get(id);
  }

  async remove(id: string, userId: string) {
    const grade = await this.get(id);
    if (grade._count.jobTitles > 0) {
      throw new ConflictException(`${grade._count.jobTitles} job title(s) have grade ${grade.code}. Give them another grade before deleting it.`);
    }
    await this.prisma.grade.delete({ where: { id } });
    await this.audit.record({ userId, action: 'delete', entityType: ENTITY, entityId: id, diff: { code: grade.code, levelEn: grade.levelEn } });
  }

  private async assertFree(code: string | undefined, rank: number | undefined) {
    if (code) {
      const taken = await this.prisma.grade.findUnique({ where: { code }, select: { levelEn: true } });
      if (taken) throw new ConflictException(`The code ${code} is already used by ${taken.levelEn}.`);
    }
    if (rank !== undefined) {
      const taken = await this.prisma.grade.findUnique({ where: { rank }, select: { code: true } });
      if (taken) throw new ConflictException(`Rank ${rank} is already ${taken.code}. Each grade has its own rank.`);
    }
  }
}
