import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, changes } from '../../audit/audit.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateJobTitleDto, UpdateJobTitleDto } from './job-title.dto.js';

const ENTITY = 'job_title';
const GRADE = { select: { id: true, code: true, rank: true, levelEn: true, levelAr: true } } as const;
const DEPARTMENT = { select: { id: true, nameEn: true, nameAr: true, parent: { select: { id: true, nameEn: true, nameAr: true } } } } as const;

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
      include: { department: DEPARTMENT, grade: GRADE, _count: { select: { duties: true } } },
    });
  }

  async get(id: string) {
    const job = await this.prisma.jobTitle.findUnique({
      where: { id },
      include: { department: DEPARTMENT, grade: GRADE, duties: { orderBy: { position: 'asc' } } },
    });
    if (!job) throw new NotFoundException('Job title not found.');
    return job;
  }

  async create(dto: CreateJobTitleDto, userId: string) {
    await this.ensureTeam(dto.departmentId);
    if (dto.gradeId) await this.ensureGrade(dto.gradeId);
    const duties = dto.duties ?? [];
    const job = await this.prisma.jobTitle.create({
      data: {
        departmentId: dto.departmentId,
        titleEn: dto.titleEn,
        titleAr: dto.titleAr ?? null,
        gradeId: dto.gradeId ?? null,
        jdPurpose: dto.jdPurpose ?? null,
        jdRequirements: dto.jdRequirements ?? null,
        duties: { create: duties.map((duty, i) => ({ duty, position: i + 1 })) },
      },
    });
    const { departmentId, titleEn, titleAr, gradeId, jdPurpose, jdRequirements } = dto;
    await this.audit.record({
      userId,
      action: 'create',
      entityType: ENTITY,
      entityId: job.id,
      diff: { departmentId, titleEn, titleAr, gradeId, jdPurpose, jdRequirements, duties },
    });
    return this.get(job.id);
  }

  async update(id: string, dto: UpdateJobTitleDto, userId: string) {
    const before = await this.get(id);
    // also when it stays: a job title still held directly by a department (from before teams) must move into a team
    if (dto.departmentId) await this.ensureTeam(dto.departmentId);
    if (dto.gradeId && dto.gradeId !== before.gradeId) await this.ensureGrade(dto.gradeId);

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
          gradeId: dto.gradeId,
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
    const employees = await this.prisma.employee.count({ where: { jobTitleId: id } });
    if (employees > 0) {
      throw new ConflictException(`${employees} employee(s) have this job title. Give them another one before deleting it.`);
    }
    await this.prisma.jobTitle.delete({ where: { id } });
    await this.audit.record({ userId, action: 'delete', entityType: ENTITY, entityId: id, diff: { titleEn: job.titleEn } });
  }

  private async ensureGrade(id: string) {
    const exists = await this.prisma.grade.count({ where: { id } });
    if (!exists) throw new NotFoundException('Grade not found. Choose one from the list.');
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
