import 'server-only';
import { cache } from 'react';
import type { EmployeeProfile, EmployeeSummary, SessionUser } from '@/lib/types';
import { getOrNull } from './approvals/data';

/**
 * The signed-in user's own profile: the employee whose work email is their sign-in email, as the API links them; null
 * when they have none, or when it can't be read. GET /auth/me names it (`employeeId`), so it is one read, or none. Read
 * once a request (the layout's banner and the employee's dashboard both need it): `user` is getCurrentUser's, the same
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
