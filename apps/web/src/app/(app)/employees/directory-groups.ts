import { HIDDEN } from '@trendlix/shared';
import { departmentName } from '../../../lib/departments';
import { groupByPlace, type DepartmentGroup, type PlaceOrder } from '../../../lib/place-groups';
import type { EmployeeSummary } from '../../../lib/types';

// The Employees list grouped (owner's request, 16 October 2026: "group active and inactive, then department, then
// team"): Active, everyone employed now (on probation, active, interns, on notice or on leave), then Inactive, those not
// employed yet and those who left; each by department, then by team. Pure code, tested.

export interface DirectorySection<T> {
  key: 'active' | 'inactive';
  label: string;
  /** Who is in it, under its heading. */
  note: string;
  count: number;
  groups: DepartmentGroup<T>[];
}

/** Where someone works now, as "Department › Team"; null without a current employment or a department. */
const placeNow = (e: Pick<EmployeeSummary, 'employment'>) => (e.employment?.department ? departmentName(e.employment.department) : null);

/**
 * Where someone works, for a developer, who isn't shown it (owner, 22 October 2026: "Hide per-person details"): hidden
 * for everyone employed, so they are in one group, with no teams, and the grouping says nothing of who is where.
 */
export const hiddenPlace = (e: Pick<EmployeeSummary, 'employment'>): string | null => (e.employment ? HIDDEN : null);

/**
 * The sections that have someone in them, Active first, each grouped by department and team, in Organization's order
 * when `order` is given (owner, 19 October 2026: "sort the employees as the department sorting in the organization").
 */
export function directorySections<T extends Pick<EmployeeSummary, 'employment'>>(
  rows: readonly T[],
  order?: PlaceOrder,
  place: (row: T) => string | null = placeNow,
): DirectorySection<T>[] {
  const sections = [
    { key: 'active' as const, label: 'Active', note: 'Employed now: on probation, active, interns, on notice or on leave', rows: rows.filter((e) => e.employment !== null) },
    { key: 'inactive' as const, label: 'Inactive', note: 'Not employed yet, or left', rows: rows.filter((e) => e.employment === null) },
  ];
  return sections
    .filter((s) => s.rows.length > 0)
    .map(({ rows: people, ...s }) => ({ ...s, count: people.length, groups: groupByPlace(people, place, order) }));
}
