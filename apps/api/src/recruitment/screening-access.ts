import { hiringManagerSees, readerRoleOf, type ApplicationStage, type ScreeningAuthorRole } from '@trendlix/shared';
import type { SessionUser } from '../auth/session-user.js';
import type { Prisma } from '../generated/prisma/client.js';
import { isConfidentialVacancy, vacancyWhere } from './recruitment-access.js';
import { visibleApplications, type RecruitmentCaller } from './recruitment-scope.js';

// Who reads and writes which screening comments (owner, 24 October 2026: "HR + hiring manager & interviewers"; packages/
// shared screening.ts). HR, the CEO and a Super Admin: every comment of the candidates they see (one with an application
// on a vacancy they see, or a general CV), but a C-level vacancy's applications' comments, which stay the CEO's and a
// Super Admin's as the applications themselves; a general comment is seen by whoever sees the candidate. A vacancy's
// hiring manager and its interviewers: only the comments on the applications they open today (recruitment-scope.ts: the
// hiring manager from Shortlisted on, an interviewer those they interview), never a general comment or a general CV's.
// Writing follows reading. Pure, but for the shapes Prisma reads; tested in apps/api/src/common/screening.spec.ts.

/** The candidates HR, the CEO or a Super Admin see: with an application on a vacancy they see, or a general CV. */
export const readerCandidates = (user: Pick<SessionUser, 'roles'>): Prisma.CandidateWhereInput => ({
  OR: [{ applications: { some: { vacancy: vacancyWhere(user) } } }, { generalCvs: { some: {} } }],
});

/** Nothing: a caller with no employee profile who doesn't read recruitment. */
const NONE: Prisma.ScreeningCommentWhereInput = { id: { in: [] } };

/** The comments the caller may read (and so write beside). */
export function commentWhere(c: RecruitmentCaller): Prisma.ScreeningCommentWhereInput {
  if (c.reads) {
    return {
      OR: [
        { applicationId: { not: null }, application: { vacancy: vacancyWhere(c.user) } },
        { generalCvId: { not: null } },
        { applicationId: null, generalCvId: null, candidate: readerCandidates(c.user) },
      ],
    };
  }
  if (!c.selfId) return NONE;
  return { applicationId: { not: null }, application: visibleApplications(c) };
}

/** The role the caller writes as: theirs among HR, the CEO and a Super Admin; else the application's hiring manager or an interviewer. */
export function authorRoleOf(c: RecruitmentCaller, application: { vacancy: { hiringManagerId: string | null } } | null): ScreeningAuthorRole {
  if (c.reads) return readerRoleOf(c.user.roles) ?? 'hr';
  return c.selfId && application?.vacancy.hiringManagerId === c.selfId ? 'hiring_manager' : 'interviewer';
}

/** An application as who may read its comments is told: its vacancy (C-level or not, its hiring manager), its stage and its interviewers. */
export interface ApplicationReaders {
  stage: string;
  rejectedFrom: string | null;
  filteredOut: boolean;
  vacancy: { hiringManagerId: string | null; grade: { confidential: boolean } | null; jobTitle: { minGrade: { confidential: boolean } | null } };
  interviews: { interviewers: { employeeId: string }[] }[];
}

/** The users who read recruitment, by their roles: HR, the CEO and the Super Admins. */
export interface ReaderAccount {
  id: string;
  roles: readonly string[];
}

/**
 * Who may read a comment on an application, so may be mentioned on it: HR (not on a C-level vacancy), the CEO and the
 * Super Admins; the vacancy's hiring manager while they see it (from Shortlisted on, never filtered out); its
 * interviewers. `accountOf`: an employee's active account (none: left out).
 */
export function applicationReaders(a: ApplicationReaders, readers: readonly ReaderAccount[], accountOf: ReadonlyMap<string, string>): Set<string> {
  const confidential = isConfidentialVacancy(a.vacancy);
  const out = new Set(readers.filter((u) => u.roles.includes('ceo') || u.roles.includes('super_admin') || (!confidential && u.roles.includes('hr'))).map((u) => u.id));
  const hm = a.vacancy.hiringManagerId;
  if (hm && hiringManagerSees({ stage: a.stage as ApplicationStage, rejectedFrom: a.rejectedFrom, filteredOut: a.filteredOut }) && accountOf.has(hm)) out.add(accountOf.get(hm)!);
  for (const i of a.interviews) for (const x of i.interviewers) if (accountOf.has(x.employeeId)) out.add(accountOf.get(x.employeeId)!);
  return out;
}

/**
 * Who may read a general comment or a general CV's: the CEO and the Super Admins always; HR when they see the candidate
 * (`hrSees`: an application of theirs on a vacancy that isn't C-level, or a general CV).
 */
export function generalReaders(readers: readonly ReaderAccount[], hrSees: boolean): Set<string> {
  return new Set(readers.filter((u) => u.roles.includes('ceo') || u.roles.includes('super_admin') || (hrSees && u.roles.includes('hr'))).map((u) => u.id));
}
