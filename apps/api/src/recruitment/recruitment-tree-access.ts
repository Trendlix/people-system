import { isSuperAdmin } from '../auth/roles.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RecruitmentCaller } from './recruitment-scope.js';
import type { TreeCaller, TreeReviewers } from '@trendlix/shared';

// Who takes the recruitment tree's steps on a vacancy (owner, 3 November 2026: "HR1 (Recruter) - HR2 (Her MAnager if
// there is) - then Manager"; 5 November 2026; packages/shared recruitment-tree.ts): its recruiter (Applicants), the
// recruiter's direct manager now (the Final Review), its hiring manager (from HR Screening on), each only with an active
// sign-in (else nobody is named and
// HR takes it, so nobody waits for no one). One read of the recruiter's employment and of the accounts.

/** The people named on a vacancy for its reviews, by employee id (null: none, or nobody who can sign in). */
export interface VacancyReviewers {
  recruiterId: string | null;
  recruiterManagerId: string | null;
  hiringManagerId: string | null;
  /** Their sign-in accounts, to tell them (user ids). */
  accounts: Map<string, { id: string; email: string; workEmail: string | null }>;
}

/** Who is named for a vacancy's reviews, those without an active account left out. */
export async function reviewersOf(prisma: PrismaService, v: { recruiterId: string | null; hiringManagerId: string | null }): Promise<VacancyReviewers> {
  const job = v.recruiterId
    ? await prisma.employment.findFirst({ where: { employeeId: v.recruiterId, endDate: null }, orderBy: { joinDate: 'desc' }, select: { managerId: true } })
    : null;
  const ids = [v.recruiterId, job?.managerId ?? null, v.hiringManagerId].filter((x): x is string => !!x);
  const users = ids.length
    ? await prisma.user.findMany({ where: { employeeId: { in: ids }, isActive: true }, select: { id: true, email: true, employeeId: true, employee: { select: { workEmail: true } } } })
    : [];
  const accounts = new Map(users.map((u) => [u.employeeId!, { id: u.id, email: u.email, workEmail: u.employee?.workEmail ?? null }]));
  const named = (id: string | null | undefined) => (id && accounts.has(id) ? id : null);
  return { recruiterId: named(v.recruiterId), recruiterManagerId: named(job?.managerId), hiringManagerId: named(v.hiringManagerId), accounts };
}

/** Whether the vacancy's Final Review has its person: the recruiter's manager (5 November 2026). */
export const treeReviewers = (r: VacancyReviewers): TreeReviewers => ({ hasRecruiterManager: !!r.recruiterManagerId });

/** The caller as the tree's rules read them on the vacancy. */
export function treeCaller(c: RecruitmentCaller, r: VacancyReviewers): TreeCaller {
  const me = c.selfId;
  return {
    manages: c.manages,
    superAdmin: isSuperAdmin(c.user) && !c.user.developer,
    isRecruiter: !!me && me === r.recruiterId,
    isRecruiterManager: !!me && me === r.recruiterManagerId,
    hasRecruiter: !!r.recruiterId,
    hasRecruiterManager: !!r.recruiterManagerId,
  };
}
