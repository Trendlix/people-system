// People grouped by department, then by team (owner's requests, 16 October 2026: "Group by Departments, then
// Teams" for a payroll run's inputs grid and pay table, and the same for the Employees list). Where someone works is
// a department, or a team as "Department › Team" (as payroll lines keep it). Pure code, tested.

/** A team's people, or the department's own (team null), in the order they came. */
export interface TeamGroup<T> {
  team: string | null;
  rows: T[];
}

/** A department's people: its own first, then each team's; department null for those without one. */
export interface DepartmentGroup<T> {
  department: string | null;
  teams: TeamGroup<T>[];
  /** How many people, in all its teams. */
  count: number;
}

const SEPARATOR = ' › ';

/** "Marketing Department › Content Team" → its department and team; a department alone has no team. */
export function placeOf(department: string | null): { department: string | null; team: string | null } {
  const text = department?.trim();
  if (!text) return { department: null, team: null };
  const at = text.indexOf(SEPARATOR);
  return at < 0 ? { department: text, team: null } : { department: text.slice(0, at), team: text.slice(at + SEPARATOR.length) };
}

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

/**
 * The rows grouped by where each works (`place`: its department, or "Department › Team"): departments by name, those
 * without one last; in each, the department's own people first, then its teams by name. The rows keep their order
 * within a group.
 */
export function groupByPlace<T>(rows: readonly T[], place: (row: T) => string | null): DepartmentGroup<T>[] {
  const departments = new Map<string | null, Map<string | null, T[]>>();
  for (const row of rows) {
    const { department, team } = placeOf(place(row));
    const teams = departments.get(department) ?? new Map<string | null, T[]>();
    departments.set(department, teams);
    teams.set(team, [...(teams.get(team) ?? []), row]);
  }
  return [...departments.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : byName(a, b)))
    .map(([department, teams]) => {
      const sorted = [...teams.entries()]
        .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : byName(a, b)))
        .map(([team, list]) => ({ team, rows: list }));
      return { department, teams: sorted, count: sorted.reduce((n, t) => n + t.rows.length, 0) };
    });
}

/** Whether a department's heading is shown: always, but for "No Department" when nobody in the table has one. */
export const showsDepartment = (groups: readonly DepartmentGroup<unknown>[], group: DepartmentGroup<unknown>) => group.department !== null || groups.length > 1;

/** "4 employees", "1 employee". */
export const peopleCount = (n: number) => `${n} ${n === 1 ? 'employee' : 'employees'}`;
