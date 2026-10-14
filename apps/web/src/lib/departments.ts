import type { Department } from './types';

// Departments and their teams (owner's words: Department → Team → Job title, e.g. Marketing → Content Team → Senior
// Content Creator). One level only: a team belongs to a department and has no teams of its own. GET /departments
// returns departments and teams in one list, sorted by name; these helpers put each team under its department.

/** "Marketing › Content Team" for a team, "Marketing" for a department. */
export function departmentName(d: { nameEn: string; parent?: { nameEn: string } | null }): string {
  return d.parent ? `${d.parent.nameEn} › ${d.nameEn}` : d.nameEn;
}

/** Each department, in the API's order (by name), with its teams (by name). */
export function groupDepartments<D extends Pick<Department, 'id' | 'parentId'>>(departments: D[]): { department: D; teams: D[] }[] {
  const groups = new Map<string, { department: D; teams: D[] }>();
  for (const d of departments) if (!d.parentId) groups.set(d.id, { department: d, teams: [] });
  for (const d of departments) {
    if (!d.parentId) continue;
    const group = groups.get(d.parentId);
    if (group) group.teams.push(d);
    else groups.set(d.id, { department: d, teams: [] }); // its department is missing from the list: still shown
  }
  return [...groups.values()];
}

/** The options of a department picker: each department, then its teams as "Marketing › Content Team". */
export function departmentOptions(departments: Department[]): { id: string; label: string }[] {
  return groupDepartments(departments).flatMap(({ department, teams }) => [department, ...teams].map((d) => ({ id: d.id, label: departmentName(d) })));
}

/** The department and its teams' ids: choosing a department also covers the people and job titles in its teams. */
export function withTeams(departments: Department[], id: string): Set<string> {
  return new Set([id, ...departments.filter((d) => d.parentId === id).map((d) => d.id)]);
}
