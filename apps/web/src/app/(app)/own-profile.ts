import 'server-only';
import { cache } from 'react';
import { mustChoose } from '@/lib/session-mode';
import type { EmployeeProfile, EmployeeSummary, SessionUser } from '@/lib/types';
import type { Session } from '@/lib/view-as';
import { getOrNull } from './approvals/data';
import { mustReview } from './employees/confirmation';

/**
 * The signed-in user's own profile: the employee whose work email is their sign-in email, as the API links them; null
 * when they have none, or when it can't be read. GET /auth/me names it (`employeeId`), so it is one read, or none. Read
 * once a request (the layout's review and the employee's dashboard both need it): `user` is getCurrentUser's, the same
 * object all through a request.
 */
export const loadOwnProfile = cache(async (user: SessionUser): Promise<EmployeeProfile | null> => {
  if (user.employeeId !== undefined) return user.employeeId ? getOrNull<EmployeeProfile>(`/employees/${user.employeeId}`) : null;
  // An API from before 15 October 2026 doesn't name it: found among the people they may see (GET /employees: just
  // themself for an employee, their team too for a manager, everyone for HR and the CEO), then read.
  const email = user.email.toLowerCase();
  const own = (await getOrNull<EmployeeSummary[]>('/employees'))?.find((e) => e.workEmail?.toLowerCase() === email);
  return own ? getOrNull<EmployeeProfile>(`/employees/${own.id}`) : null;
});

/**
 * The review at sign-in (owner, 31 October 2026: "make the data review obligatory upon the signin for employees"): the
 * signed-in person's own profile id while they must review their details before anything else (employees/confirmation.ts
 * mustReview), else null. Only the person themself: never while a Super Admin views as them (the review is the
 * employee's own act), nor a developer's view, which changes nothing; and not before the Hold page or the developer's
 * choice, which come first. A profile that can't be read holds nobody back.
 */
export const reviewDueFor = cache(async (user: Session): Promise<string | null> => {
  if (user.viewAs || user.developer || user.hold || mustChoose(user)) return null;
  const own = await loadOwnProfile(user);
  return own && mustReview(own.confirmation, own.changeRequests) ? own.id : null;
});
