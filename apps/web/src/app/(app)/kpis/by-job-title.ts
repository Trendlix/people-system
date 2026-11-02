import type { KpiScorecardSummary } from '@trendlix/shared';

// All KPIs by job title under its team (owner, 2 November 2026: "i want KPI's Per Job Title under the team"; chose All
// KPIs): the month's scorecards by department, then team (none: the department's own), then job title, each job title
// with how many it has, how many are scored and their average final %. Pure, tested.

export interface JobTitleGroup {
  jobTitle: string | null;
  scorecards: KpiScorecardSummary[];
  scored: number;
  /** The scored ones' average final %, to one decimal; null with none scored. */
  average: number | null;
}

export interface TeamGroup {
  team: string | null;
  count: number;
  jobTitles: JobTitleGroup[];
}

export interface DepartmentGroup {
  department: string | null;
  count: number;
  teams: TeamGroup[];
}

/** "Web Development › Frontend" → its department and team; "Web Development" → no team. */
export function placeOf(department: string | null): { department: string | null; team: string | null } {
  if (!department) return { department: null, team: null };
  const [head, ...rest] = department.split(' › ');
  return { department: head, team: rest.length ? rest.join(' › ') : null };
}

const byName = (a: string | null, b: string | null) => (a === null ? (b === null ? 0 : -1) : b === null ? 1 : a.localeCompare(b));

/** The scorecards by department (by name, none last), team (the department's own first) and job title (by name, none last). */
export function byJobTitle(scorecards: readonly KpiScorecardSummary[]): DepartmentGroup[] {
  const tree = new Map<string | null, Map<string | null, Map<string | null, KpiScorecardSummary[]>>>();
  for (const s of scorecards) {
    const { department, team } = placeOf(s.department);
    const teams = tree.get(department) ?? new Map();
    tree.set(department, teams);
    const titles = teams.get(team) ?? new Map();
    teams.set(team, titles);
    const list = titles.get(s.jobTitle) ?? [];
    titles.set(s.jobTitle, list);
    list.push(s);
  }
  const lastNull = (a: string | null, b: string | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : a.localeCompare(b));
  return [...tree.entries()]
    .sort(([a], [b]) => lastNull(a, b))
    .map(([department, teams]) => {
      const teamGroups = [...teams.entries()]
        .sort(([a], [b]) => byName(a, b))
        .map(([team, titles]) => {
          const jobTitles = [...titles.entries()]
            .sort(([a], [b]) => lastNull(a, b))
            .map(([jobTitle, list]) => {
              const scored = list.filter((s) => s.finalPercent !== null);
              const average = scored.length ? Math.round((scored.reduce((sum, s) => sum + s.finalPercent!, 0) / scored.length) * 10) / 10 : null;
              return { jobTitle, scorecards: [...list].sort((a, b) => a.employee.fullNameEn.localeCompare(b.employee.fullNameEn)), scored: scored.length, average };
            });
          return { team, count: jobTitles.reduce((n, j) => n + j.scorecards.length, 0), jobTitles };
        });
      return { department, count: teamGroups.reduce((n, t) => n + t.count, 0), teams: teamGroups };
    });
}

/** "2 of 3 scored · average 86.5%", "None scored yet". */
export function jobTitleNote(g: Pick<JobTitleGroup, 'scorecards' | 'scored' | 'average'>): string {
  if (!g.scored) return 'None scored yet';
  return `${g.scored} of ${g.scorecards.length} scored · average ${g.average}%`;
}
