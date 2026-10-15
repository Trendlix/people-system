import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, changes } from '../../audit/audit.service.js';
import { assertDeletes } from '../../auth/roles.js';
import type { SessionUser } from '../../auth/session-user.js';
import type { Grade } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateGradeDto, UpdateGradeDto } from './grade.dto.js';

const ENTITY = 'grade';

/** "1 employment", "5 employments". */
const howMany = (n: number, thing: string) => `${n} ${thing}${n === 1 ? '' : 's'}`;

// The grading system: G1 Entry Level … G9 Executive, lowest rank first. A job title takes a range of grades and each
// employment has one (owner's decision, 15 October 2026).
@Injectable()
export class GradesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const grades = await this.prisma.grade.findMany({ orderBy: { rank: 'asc' } });
    return Promise.all(grades.map((g) => this.withCounts(g)));
  }

  async get(id: string) {
    const grade = await this.prisma.grade.findUnique({ where: { id } });
    if (!grade) throw new NotFoundException('Grade not found.');
    return this.withCounts(grade);
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

  async remove(id: string, user: SessionUser) {
    assertDeletes(user);
    const grade = await this.get(id);
    const { jobTitles, employments } = grade._count;
    if (jobTitles > 0 || employments > 0) {
      const uses = [jobTitles > 0 && howMany(jobTitles, 'job title range'), employments > 0 && howMany(employments, 'employment')];
      throw new ConflictException(`${grade.code} is used by ${uses.filter(Boolean).join(' and ')}. Give them another grade before deleting it.`);
    }
    await this.prisma.grade.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'delete', entityType: ENTITY, entityId: id, diff: { code: grade.code, levelEn: grade.levelEn } });
  }

  /**
   * Where the grade is used: job titles whose range starts or ends at it (each title once), and employments with it,
   * ended ones included.
   */
  private async withCounts(grade: Grade) {
    const [jobTitles, employments] = await Promise.all([
      this.prisma.jobTitle.count({ where: { OR: [{ minGradeId: grade.id }, { maxGradeId: grade.id }] } }),
      this.prisma.employment.count({ where: { gradeId: grade.id } }),
    ]);
    return { ...grade, _count: { jobTitles, employments } };
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
