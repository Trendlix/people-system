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
 * The order an Admin set on Organization → Departments & Job Titles (Reorder), so lists follow it (owner, 19 October
 * 2026: "sort the employees as the department sorting in the organization"): each department's place, and each team's
 * place within its department, by the names places show (as GET /departments lists them: in that order, a team naming
 * its department by `parentId`).
 */
export interface PlaceOrder {
  departments: Map<string, number>;
  teams: Map<string, Map<string, number>>;
}

/** A department or team as GET /departments lists it, enough to order places (and to pass to a client component). */
export type PlaceRef = { id: string; nameEn: string; parentId: string | null };

export function placeOrder(list: readonly PlaceRef[]): PlaceOrder {
  const tops = list.filter((d) => d.parentId === null);
  return {
    departments: new Map(tops.map((d, i) => [d.nameEn, i])),
    teams: new Map(tops.map((d) => [d.nameEn, new Map(list.filter((t) => t.parentId === d.id).map((t, i) => [t.nameEn, i]))])),
  };
}

/** Those the order knows first, in its order; then the others by name. */
function byOrder(order: ReadonlyMap<string, number> | undefined) {
  return (a: string, b: string) => {
    const [x, y] = [order?.get(a), order?.get(b)];
    if (x !== undefined && y !== undefined) return x - y;
    if (x !== undefined) return -1;
    if (y !== undefined) return 1;
    return byName(a, b);
  };
}

/**
 * The rows grouped by where each works (`place`: its department, or "Department › Team"): departments in Organization's
 * order when `order` is given (else by name), those without one last; in each, the department's own people first, then
 * its teams in the same way. The rows keep their order within a group.
 */
export function groupByPlace<T>(rows: readonly T[], place: (row: T) => string | null, order?: PlaceOrder): DepartmentGroup<T>[] {
  const departments = new Map<string | null, Map<string | null, T[]>>();
  for (const row of rows) {
    const { department, team } = placeOf(place(row));
    const teams = departments.get(department) ?? new Map<string | null, T[]>();
    departments.set(department, teams);
    teams.set(team, [...(teams.get(team) ?? []), row]);
  }
  const departmentOrder = byOrder(order?.departments);
  return [...departments.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : departmentOrder(a, b)))
    .map(([department, teams]) => {
      const teamOrder = byOrder(department === null ? undefined : order?.teams.get(department));
      const sorted = [...teams.entries()]
        .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : teamOrder(a, b)))
        .map(([team, list]) => ({ team, rows: list }));
      return { department, teams: sorted, count: sorted.reduce((n, t) => n + t.rows.length, 0) };
    });
}

/** Whether a department's heading is shown: always, but for "No Department" when nobody in the table has one. */
export const showsDepartment = (groups: readonly DepartmentGroup<unknown>[], group: DepartmentGroup<unknown>) => group.department !== null || groups.length > 1;

/** "4 employees", "1 employee". */
export const peopleCount = (n: number) => `${n} ${n === 1 ? 'employee' : 'employees'}`;
