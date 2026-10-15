import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, changes } from '../../audit/audit.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { gradeRange } from '../grades/grade-range.js';
import type { CreateJobTitleDto, UpdateJobTitleDto } from './job-title.dto.js';

const ENTITY = 'job_title';
const GRADE = { select: { id: true, code: true, rank: true, levelEn: true, levelAr: true } } as const;
/** The range of grades the job title takes: its lowest and highest grade, either or both empty. */
const RANGE = { minGrade: GRADE, maxGrade: GRADE } as const;
const DEPARTMENT = { select: { id: true, nameEn: true, nameAr: true, parent: { select: { id: true, nameEn: true, nameAr: true } } } } as const;

/** An end of a job title's range of grades; null when open. */
type RangeEnd = { code: string; rank: number } | null;

@Injectable()
export class JobTitlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(departmentId?: string) {
    return this.prisma.jobTitle.findMany({
      where: departmentId ? { departmentId } : undefined,
      orderBy: [{ department: { nameEn: 'asc' } }, { titleEn: 'asc' }],
      include: { department: DEPARTMENT, ...RANGE, _count: { select: { duties: true } } },
    });
  }

  async get(id: string) {
    const job = await this.prisma.jobTitle.findUnique({
      where: { id },
      include: { department: DEPARTMENT, ...RANGE, duties: { orderBy: { position: 'asc' } } },
    });
    if (!job) throw new NotFoundException('Job title not found.');
    return job;
  }

  async create(dto: CreateJobTitleDto, userId: string) {
    await this.ensureTeam(dto.departmentId);
    await this.checkedRange(dto.minGradeId ?? null, dto.maxGradeId ?? null);
    const duties = dto.duties ?? [];
    const job = await this.prisma.jobTitle.create({
      data: {
        departmentId: dto.departmentId,
        titleEn: dto.titleEn,
        titleAr: dto.titleAr ?? null,
        minGradeId: dto.minGradeId ?? null,
        maxGradeId: dto.maxGradeId ?? null,
        jdPurpose: dto.jdPurpose ?? null,
        jdRequirements: dto.jdRequirements ?? null,
        duties: { create: duties.map((duty, i) => ({ duty, position: i + 1 })) },
      },
    });
    const { departmentId, titleEn, titleAr, minGradeId, maxGradeId, jdPurpose, jdRequirements } = dto;
    await this.audit.record({
      userId,
      action: 'create',
      entityType: ENTITY,
      entityId: job.id,
      diff: { departmentId, titleEn, titleAr, minGradeId, maxGradeId, jdPurpose, jdRequirements, duties },
    });
    return this.get(job.id);
  }

  async update(id: string, dto: UpdateJobTitleDto, userId: string) {
    const before = await this.get(id);
    // also when it stays: a job title still held directly by a department (from before teams) must move into a team
    if (dto.departmentId) await this.ensureTeam(dto.departmentId);
    // the range as it will be: what was sent, the rest as saved
    if (dto.minGradeId !== undefined || dto.maxGradeId !== undefined) {
      const minGradeId = dto.minGradeId !== undefined ? dto.minGradeId : before.minGradeId;
      const maxGradeId = dto.maxGradeId !== undefined ? dto.maxGradeId : before.maxGradeId;
      const range = await this.checkedRange(minGradeId, maxGradeId);
      if (minGradeId !== before.minGradeId || maxGradeId !== before.maxGradeId) await this.assertHoldersFit(id, range);
    }

    const oldDuties = before.duties.map((d) => d.duty);
    const dutiesChanged = dto.duties !== undefined && JSON.stringify(dto.duties) !== JSON.stringify(oldDuties);
    const jdChanged =
      dutiesChanged ||
      (dto.jdPurpose !== undefined && dto.jdPurpose !== before.jdPurpose) ||
      (dto.jdRequirements !== undefined && dto.jdRequirements !== before.jdRequirements);

    await this.prisma.$transaction(async (tx) => {
      if (dutiesChanged) {
        await tx.jobTitleDuty.deleteMany({ where: { jobTitleId: id } });
        await tx.jobTitleDuty.createMany({
          data: dto.duties!.map((duty, i) => ({ jobTitleId: id, duty, position: i + 1 })),
        });
      }
      await tx.jobTitle.update({
        where: { id },
        data: {
          departmentId: dto.departmentId,
          titleEn: dto.titleEn,
          titleAr: dto.titleAr,
          minGradeId: dto.minGradeId,
          maxGradeId: dto.maxGradeId,
          jdPurpose: dto.jdPurpose,
          jdRequirements: dto.jdRequirements,
          jdVersion: jdChanged ? { increment: 1 } : undefined,
        },
      });
    });

    const { duties, ...fields } = dto;
    const diff: Record<string, unknown> = changes(before, fields);
    if (dutiesChanged) diff.duties = { from: oldDuties, to: duties };
    if (jdChanged) diff.jdVersion = { from: before.jdVersion, to: before.jdVersion + 1 };
    if (Object.keys(diff).length) {
      await this.audit.record({ userId, action: 'update', entityType: ENTITY, entityId: id, diff });
    }
    return this.get(id);
  }

  async remove(id: string, userId: string) {
    const job = await this.get(id);
    // employments that ended keep their job title in the history
    const now = await this.prisma.employment.count({ where: { jobTitleId: id, endDate: null } });
    if (now > 0) throw new ConflictException(`${now} employee(s) have this job title. Give them another one before deleting it.`);
    const before = await this.prisma.employment.count({ where: { jobTitleId: id } });
    if (before > 0) throw new ConflictException(`This job title is in the history of ${before} past employment(s), so it is kept.`);
    await this.prisma.jobTitle.delete({ where: { id } });
    await this.audit.record({ userId, action: 'delete', entityType: ENTITY, entityId: id, diff: { titleEn: job.titleEn } });
  }

  /** Both ends of a range must be grades on the list, the lowest at or below the highest. Answers the two grades. */
  private async checkedRange(minGradeId: string | null, maxGradeId: string | null): Promise<{ min: RangeEnd; max: RangeEnd }> {
    const [min, max] = await Promise.all([this.grade(minGradeId), this.grade(maxGradeId)]);
    if (min && max && min.rank > max.rank) throw new BadRequestException('The lowest grade must be at or below the highest.');
    return { min, max };
  }

  private async grade(id: string | null): Promise<RangeEnd> {
    if (!id) return null;
    const grade = await this.prisma.grade.findUnique({ where: { id }, select: { code: true, rank: true } });
    if (!grade) throw new NotFoundException('Grade not found. Choose one from the list.');
    return grade;
  }

  /**
   * A range is not narrowed past the people who hold the job title now: their grades are changed first (employments
   * that ended keep the grade they had).
   */
  private async assertHoldersFit(id: string, { min, max }: { min: RangeEnd; max: RangeEnd }) {
    const outside = [...(min ? [{ rank: { lt: min.rank } }] : []), ...(max ? [{ rank: { gt: max.rank } }] : [])];
    if (!outside.length) return;
    const count = await this.prisma.employment.count({ where: { jobTitleId: id, endDate: null, grade: { is: { OR: outside } } } });
    if (count === 0) return;
    const where = min && max ? `outside ${gradeRange(min, max)}` : min ? `below ${min.code}` : `above ${max!.code}`;
    throw new ConflictException(
      count === 1
        ? `1 current employee with this title has a grade ${where}. Change their grade first, or widen the range.`
        : `${count} current employees with this title have grades ${where}. Change their grades first, or widen the range.`,
    );
  }

  /** Job titles belong to teams only (Department → Team → Job title; owner's rule, 14 October 2026). */
  private async ensureTeam(id: string) {
    const team = await this.prisma.department.findUnique({ where: { id }, select: { parentId: true, nameEn: true } });
    if (!team) throw new NotFoundException('Team not found.');
    if (!team.parentId) {
      throw new BadRequestException(
        `Job titles belong to a team, not directly to a department. Choose one of the teams of ${team.nameEn}, or add a team to it first.`,
      );
    }
  }
}
