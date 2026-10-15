import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { occupationName } from '@trendlix/shared';
import { AuditService, changes } from '../../audit/audit.service.js';
import { assertDeletes } from '../../auth/roles.js';
import type { SessionUser } from '../../auth/session-user.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { gradeRange } from '../grades/grade-range.js';
import type { CreateJobTitleDto, UpdateJobTitleDto } from './job-title.dto.js';
import { dutiesFromHtml, dutyRow, htmlFromLines, sameJdHtml, sanitizeJdHtml } from './jd-html.js';

const ENTITY = 'job_title';
const GRADE = { select: { id: true, code: true, rank: true, levelEn: true, levelAr: true } } as const;
/** The range of grades the job title takes: its lowest and highest grade, either or both empty. */
const RANGE = { minGrade: GRADE, maxGrade: GRADE } as const;
const DEPARTMENT = { select: { id: true, nameEn: true, nameAr: true, parent: { select: { id: true, nameEn: true, nameAr: true } } } } as const;

/** The job description fields saved as HTML (owner's request, 15 October 2026). */
const JD_FIELDS = ['jdPurpose', 'jdDuties', 'jdRequirements'] as const;

/**
 * A job title as the API sends it: with its occupation's name in the social insurance table beside its code (owner, 15
 * October 2026), read from the table (occupations.ts), never stored.
 */
function withOccupation<T extends { occupationCode: string | null }>(job: T): T & { occupationName: string | null } {
  return { ...job, occupationName: occupationName(job.occupationCode) };
}

/** An end of a job title's range of grades; null when open. */
type RangeEnd = { code: string; rank: number } | null;

@Injectable()
export class JobTitlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(departmentId?: string) {
    const rows = await this.prisma.jobTitle.findMany({
      where: departmentId ? { departmentId } : undefined,
      orderBy: [{ department: { nameEn: 'asc' } }, { titleEn: 'asc' }],
      include: { department: DEPARTMENT, ...RANGE, _count: { select: { duties: true } } },
    });
    return rows.map(withOccupation);
  }

  async get(id: string) {
    const job = await this.prisma.jobTitle.findUnique({
      where: { id },
      include: { department: DEPARTMENT, ...RANGE, duties: { orderBy: { position: 'asc' } } },
    });
    if (!job) throw new NotFoundException('Job title not found.');
    return withOccupation(job);
  }

  async create(dto: CreateJobTitleDto, userId: string) {
    await this.ensurePlace(dto.departmentId);
    await this.checkedRange(dto.minGradeId ?? null, dto.maxGradeId ?? null);
    const jd = {
      jdPurpose: dto.jdPurpose ?? null,
      jdDuties: sentDutiesHtml(dto) ?? null,
      jdRequirements: dto.jdRequirements ?? null,
    };
    const duties = dutiesFromHtml(jd.jdDuties);
    const job = await this.prisma.jobTitle.create({
      data: {
        departmentId: dto.departmentId,
        titleEn: dto.titleEn,
        titleAr: dto.titleAr ?? null,
        minGradeId: dto.minGradeId ?? null,
        maxGradeId: dto.maxGradeId ?? null,
        occupationCode: dto.occupationCode ?? null,
        ...jd,
        duties: { create: duties.map((duty, i) => ({ duty, position: i + 1 })) },
      },
    });
    const { departmentId, titleEn, titleAr, minGradeId, maxGradeId, occupationCode } = dto;
    // the job description's HTML is long: only which of its fields were filled in, and the duty rows
    const filled = Object.fromEntries(JD_FIELDS.filter((f) => jd[f] !== null).map((f) => [f, 'changed']));
    await this.audit.record({
      userId,
      action: 'create',
      entityType: ENTITY,
      entityId: job.id,
      diff: { departmentId, titleEn, titleAr, minGradeId, maxGradeId, occupationCode, ...filled, duties },
    });
    return this.get(job.id);
  }

  async update(id: string, dto: UpdateJobTitleDto, userId: string) {
    const before = await this.get(id);
    // to a department or to one of its teams (owner's decision, 15 October 2026): a job title held directly by a
    // department is where it belongs, and no longer has to move into a team
    if (dto.departmentId) await this.ensurePlace(dto.departmentId);
    // the range as it will be: what was sent, the rest as saved
    if (dto.minGradeId !== undefined || dto.maxGradeId !== undefined) {
      const minGradeId = dto.minGradeId !== undefined ? dto.minGradeId : before.minGradeId;
      const maxGradeId = dto.maxGradeId !== undefined ? dto.maxGradeId : before.maxGradeId;
      const range = await this.checkedRange(minGradeId, maxGradeId);
      if (minGradeId !== before.minGradeId || maxGradeId !== before.maxGradeId) await this.assertHoldersFit(id, range);
    }

    // The job description as sent (undefined: leave as it is), against what is saved, both cleaned the same way, so
    // sending the same text again changes nothing. The duty rows follow the duties' HTML.
    const sent = { jdPurpose: dto.jdPurpose, jdDuties: sentDutiesHtml(dto), jdRequirements: dto.jdRequirements };
    const edited = JD_FIELDS.filter((f) => sent[f] !== undefined && !sameJdHtml(sent[f], sanitizeJdHtml(before[f])));
    const oldDuties = before.duties.map((d) => d.duty);
    const duties = sent.jdDuties === undefined ? undefined : dutiesFromHtml(sent.jdDuties);
    const dutiesChanged = duties !== undefined && !sameList(duties, oldDuties);
    // rows saved before 15 October 2026 may still start with the bullets typed in; read the same way, they are the same
    // duties, so rewriting them without their bullets is not a new version of the job description
    const sameDuties = duties === undefined || sameList(duties, oldDuties.map(dutyRow).filter((d) => d !== null));
    const jdChanged = edited.length > 0 || !sameDuties;

    const moved = dto.departmentId !== undefined && dto.departmentId !== before.departmentId;
    let holdersMoved = 0;
    await this.prisma.$transaction(async (tx) => {
      // the people who hold the title now move with it, so their department or team stays the title's own; ended
      // employments keep where they were, as history
      if (moved) {
        holdersMoved = (await tx.employment.updateMany({ where: { jobTitleId: id, endDate: null }, data: { departmentId: dto.departmentId } })).count;
      }
      if (dutiesChanged) {
        await tx.jobTitleDuty.deleteMany({ where: { jobTitleId: id } });
        await tx.jobTitleDuty.createMany({
          data: duties.map((duty, i) => ({ jobTitleId: id, duty, position: i + 1 })),
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
          occupationCode: dto.occupationCode,
          ...sent,
          jdVersion: jdChanged ? { increment: 1 } : undefined,
        },
      });
    });

    const { duties: _lines, jdPurpose: _p, jdDuties: _d, jdRequirements: _r, ...fields } = dto;
    const diff: Record<string, unknown> = changes(before, fields);
    for (const field of edited) diff[field] = 'changed'; // the HTML is long: only the fact that it changed
    if (dutiesChanged) diff.duties = { from: oldDuties, to: duties };
    if (jdChanged) diff.jdVersion = { from: before.jdVersion, to: before.jdVersion + 1 };
    if (holdersMoved) diff.holdersMoved = holdersMoved;
    if (Object.keys(diff).length) {
      await this.audit.record({ userId, action: 'update', entityType: ENTITY, entityId: id, diff });
    }
    return this.get(id);
  }

  async remove(id: string, user: SessionUser) {
    assertDeletes(user);
    const job = await this.get(id);
    // employments that ended keep their job title in the history
    const now = await this.prisma.employment.count({ where: { jobTitleId: id, endDate: null } });
    if (now > 0) throw new ConflictException(`${now} employee(s) have this job title. Give them another one before deleting it.`);
    const before = await this.prisma.employment.count({ where: { jobTitleId: id } });
    if (before > 0) throw new ConflictException(`This job title is in the history of ${before} past employment(s), so it is kept.`);
    await this.prisma.jobTitle.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'delete', entityType: ENTITY, entityId: id, diff: { titleEn: job.titleEn } });
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

  /**
   * A job title belongs to a department itself (e.g. Head of Marketing, under Marketing) or to one of its teams (e.g.
   * Senior Content Creator, under Marketing → Content Team): owner's decision, 15 October 2026, replacing the rule of
   * 14 October that job titles belong to teams only. Either way the place must exist; its English title is unique there.
   */
  private async ensurePlace(id: string) {
    const place = await this.prisma.department.count({ where: { id } });
    if (!place) throw new NotFoundException('Department or team not found.');
  }
}

/**
 * The duties' HTML that was sent: `jdDuties` (null clears it), which wins over `duties`; else made from the lines of
 * `duties`, as sent before 15 October 2026; undefined when neither was sent.
 */
function sentDutiesHtml(dto: { jdDuties?: string | null; duties?: string[] }): string | null | undefined {
  if (dto.jdDuties !== undefined) return dto.jdDuties;
  if (dto.duties !== undefined) return htmlFromLines(dto.duties);
  return undefined;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
