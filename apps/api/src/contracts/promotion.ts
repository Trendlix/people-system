import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { gradeRange, inGradeRange } from '../organisation/grades/grade-range.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { departmentName } from './views.js';

// The promotion that may come with a raise (owner's decision, 16 October 2026): a new job title and grade, the grade
// within the range the job title takes (as for an employment: owner's decision, 15 October 2026). Applied to the
// employment when the raise is signed, the department following the job title.

type Db = PrismaService | Prisma.TransactionClient;

const RANGE_END = { select: { code: true, rank: true } } as const;

/** A promotion checked: the new job title (with its department) and grade, each null when it stays as it is. */
export interface Promotion {
  jobTitle: { id: string; titleEn: string; titleAr: string | null; departmentId: string; departmentName: string | null } | null;
  grade: { id: string; code: string } | null;
}

/**
 * The promotion asked for, checked against the employment's job title and grade as they are: a job title or grade the
 * same as now is no change. Refused for one that doesn't exist, or a grade the job title (new, else as it is) doesn't
 * take.
 */
export async function checkedPromotion(
  db: Db,
  current: { jobTitleId: string | null; gradeId: string | null },
  wanted: { newJobTitleId: string | null; newGradeId: string | null },
): Promise<Promotion> {
  const jobTitleId = wanted.newJobTitleId && wanted.newJobTitleId !== current.jobTitleId ? wanted.newJobTitleId : null;
  const gradeId = wanted.newGradeId && wanted.newGradeId !== current.gradeId ? wanted.newGradeId : null;
  if (!jobTitleId && !gradeId) return { jobTitle: null, grade: null };

  const job = await db.jobTitle.findUnique({
    where: { id: jobTitleId ?? current.jobTitleId ?? '00000000-0000-0000-0000-000000000000' },
    select: { id: true, titleEn: true, titleAr: true, departmentId: true, department: { select: { nameEn: true, parent: { select: { nameEn: true } } } }, minGrade: RANGE_END, maxGrade: RANGE_END },
  });
  if (jobTitleId && !job) throw new BadRequestException('Job title not found. Choose one from the list.');
  const grade = await db.grade.findUnique({ where: { id: gradeId ?? current.gradeId ?? '00000000-0000-0000-0000-000000000000' }, select: { id: true, code: true, rank: true } });
  if (gradeId && !grade) throw new BadRequestException('Grade not found. Choose one from the list.');

  if (job && grade && !inGradeRange(grade.rank, job.minGrade, job.maxGrade)) {
    const only = job.minGrade && job.maxGrade && job.minGrade.rank === job.maxGrade.rank ? job.minGrade.code : null;
    throw new BadRequestException(
      only
        ? `${job.titleEn} takes grade ${only} only. Choose that grade, or widen the job title's grades.`
        : `${job.titleEn} takes grades ${gradeRange(job.minGrade, job.maxGrade)}. Choose a grade in that range.`,
    );
  }
  return {
    jobTitle: jobTitleId && job ? { id: job.id, titleEn: job.titleEn, titleAr: job.titleAr, departmentId: job.departmentId, departmentName: departmentName(job.department) } : null,
    grade: gradeId && grade ? { id: grade.id, code: grade.code } : null,
  };
}
