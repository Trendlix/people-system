import { HIRING_MANAGER_STAGES, type RecruitmentViewer } from '@trendlix/shared';
import type { SessionUser } from '../auth/session-user.js';
import type { Prisma } from '../generated/prisma/client.js';
import { managesRecruitment, READS, vacancyWhere } from './recruitment-access.js';

// Who sees which applicants (Phase 2, owner, 22 October 2026: "where will we include the ATS?"; the brief: "A vacancy's
// hiring manager sees its applicants from Shortlisted on … Interviewers see only the applicants they interview"). HR, the
// CEO and a Super Admin read every one (a C-level vacancy's only the CEO and a Super Admin: recruitment-access.ts); a
// hiring manager and an interviewer, through their own employee profile (its work email their sign-in), only theirs.
// Pure, but for the shapes Prisma reads; tested in recruitment-hiring.spec.ts.

/** The caller, for recruitment: whether they read all of it, manage it, and their own employee profile's id. */
export interface RecruitmentCaller {
  user: SessionUser;
  reads: boolean;
  manages: boolean;
  selfId: string | null;
}

export const recruitmentCaller = (user: SessionUser, selfId: string | null): RecruitmentCaller => ({
  user,
  reads: user.roles.some((r) => READS.includes(r)),
  manages: managesRecruitment(user),
  selfId,
});

/** Nothing: for a caller with no employee profile who doesn't read recruitment. */
const NONE: Prisma.JobApplicationWhereInput = { id: { in: [] } };

/** The applications a hiring manager sees on their vacancies: from Shortlisted on (or rejected from there), never one filtered out. */
export const hiringManagerApplications = (selfId: string): Prisma.JobApplicationWhereInput => ({
  vacancy: { hiringManagerId: selfId },
  filteredOut: false,
  OR: [{ stage: { in: [...HIRING_MANAGER_STAGES] } }, { stage: 'rejected', rejectedFrom: { in: [...HIRING_MANAGER_STAGES] } }],
});

/** The applications an interviewer sees: those with an interview they sit on. */
export const interviewerApplications = (selfId: string): Prisma.JobApplicationWhereInput => ({
  interviews: { some: { interviewers: { some: { employeeId: selfId } } } },
});

/** The applications the caller may open. */
export function visibleApplications(c: RecruitmentCaller): Prisma.JobApplicationWhereInput {
  if (c.reads) return { vacancy: vacancyWhere(c.user) };
  if (!c.selfId) return NONE;
  return { OR: [hiringManagerApplications(c.selfId), interviewerApplications(c.selfId)] };
}

/** How the caller sees an application: HR (or a Super Admin) manage, the CEO reads, else its hiring manager or an interviewer. */
export function viewerOf(c: RecruitmentCaller, a: { vacancy: { hiringManagerId: string | null } }): RecruitmentViewer {
  if (c.manages) return 'manages';
  if (c.reads) return 'reads';
  return c.selfId && a.vacancy.hiringManagerId === c.selfId ? 'hiring_manager' : 'interviewer';
}
