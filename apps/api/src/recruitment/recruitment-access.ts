import { seesConfidential, type Role } from '@trendlix/shared';
import type { SessionUser } from '../auth/session-user.js';
import type { Prisma } from '../generated/prisma/client.js';

// Who does what in recruitment (owner, 22 October 2026: "HR creates a vacancy and the CEO approves it"; packages/shared
// recruitment.ts). HR (and a Super Admin) drafts, changes, publishes on approval, holds, closes vacancies and moves the
// applicants; the CEO (and a Super Admin) approves or sends back a vacancy and reads everything. A C-level vacancy (a
// C-level grade, or a job title whose range starts at one) and its applicants are only the CEO's and a Super Admin's
// (owner, 19 October 2026: "make C level Employees details not visible to HR"): 404 for anyone else.

/** Read vacancies and applicants. */
export const READS: Role[] = ['hr', 'ceo', 'super_admin'];
/** Draft, change and move vacancies (but approving), and move applicants. */
export const MANAGES: Role[] = ['hr', 'super_admin'];
/** Approve a vacancy or send it back. */
export const APPROVES: Role[] = ['ceo', 'super_admin'];
/**
 * Add, invite or dismiss a vacancy's suggested CVs (owner, 25 October 2026: the CEO "Yes, the CEO too"): HR, the CEO
 * and a Super Admin.
 */
export const DECIDES_SUGGESTIONS: Role[] = ['hr', 'ceo', 'super_admin'];

const has = (user: Pick<SessionUser, 'roles'>, roles: readonly Role[]) => user.roles.some((r) => roles.includes(r));

export const managesRecruitment = (user: Pick<SessionUser, 'roles'>): boolean => has(user, MANAGES);
export const decidesSuggestions = (user: Pick<SessionUser, 'roles'>): boolean => has(user, DECIDES_SUGGESTIONS);
export const approvesVacancies = (user: Pick<SessionUser, 'roles'>): boolean => has(user, APPROVES);

/** The vacancies hidden from those who don't see C-level people: a C-level grade, or a job title only for one. */
export const CONFIDENTIAL_VACANCY: Prisma.VacancyWhereInput = {
  OR: [{ grade: { confidential: true } }, { jobTitle: { minGrade: { confidential: true } } }],
};

/** The vacancies the caller may see: all for the CEO and a Super Admin, none of the C-level ones for anyone else. */
export function vacancyWhere(user: Pick<SessionUser, 'roles'>): Prisma.VacancyWhereInput {
  return seesConfidential(user) ? {} : { NOT: CONFIDENTIAL_VACANCY };
}

/** Whether a vacancy (with its grade's and job title's lowest grade's confidential flags) is C-level. */
export const isConfidentialVacancy = (v: { grade: { confidential: boolean } | null; jobTitle: { minGrade: { confidential: boolean } | null } }): boolean =>
  v.grade?.confidential === true || v.jobTitle.minGrade?.confidential === true;
