import 'server-only';
import { cache } from 'react';
import type { EmployeeProfile } from '@/lib/types';
import { getOrNull } from '../approvals/data';
import { loadEmployeeRaiseRequests, type EmployeeRaiseRequestsLoad } from '../raise-requests/data';

// A direct manager's team, for the dashboard's My Team card, the My Team page and the requests the manager asked for on
// My Requests (owner's decisions, 17 October 2026). Read as the manager may see it: each direct report's profile (the
// API lets a manager open their direct reports') for their employment, and their raise requests (the API sends a
// manager every one, without a figure).

export interface TeamMember {
  /** As the manager's profile lists them (`reports`): their code, name, job title and status. */
  report: EmployeeProfile['reports'][number];
  /** Their profile, for the probation end; null when it can't be read. */
  profile: EmployeeProfile | null;
  raises: EmployeeRaiseRequestsLoad;
}

/** The manager's direct reports, in the profile's order (by name). Read once a request: `manager` is loadOwnProfile's. */
export const loadTeam = cache(
  (manager: EmployeeProfile): Promise<TeamMember[]> =>
    Promise.all(
      manager.reports.map(async (report) => {
        const [profile, raises] = await Promise.all([getOrNull<EmployeeProfile>(`/employees/${report.id}`), loadEmployeeRaiseRequests(report.id)]);
        return { report, profile, raises };
      }),
    ),
);
