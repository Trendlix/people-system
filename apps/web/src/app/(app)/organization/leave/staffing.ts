import { fewestAtWork, hasStaffingLimit, STAFFING_MAX_OFF_LIMIT, staffingLimitProblems, staffingLimitText, type StaffingLimit, type StaffingUnitView } from '@trendlix/shared';
import { wholeFrom } from './setup';

// Organization → Leave → Staffing (owner, 25 October 2026: "if there are leaves applied by an employee and another
// employee in the same department is on a leave, how can we manage it without affecting the workflow?"; asked, "Warn and
// need HR"): each team's limit for annual leave (a department's without teams), "At most N people on annual leave at
// once" and/or "At least P% at work", either or none, which HR and a Super Admin set. A request of annual (or unpaid)
// leave that breaks it on any day is still sent, with a warning, and HR approves it too; sick and casual leave are never
// limited (the law: they can't be refused). Pure code, tested: the departments with their teams, the words of each row,
// and the row's form read into what PUT /leave/staffing/:departmentId takes, with the shared checks.

/** The section's anchor (the audit log opens a staffing change there). */
export const STAFFING_ID = 'staffing';
export const STAFFING_HREF = `/organization/leave#${STAFFING_ID}`;

/** A department and its teams, as the section lists them. */
export interface StaffingGroup {
  department: StaffingUnitView;
  teams: StaffingUnitView[];
}

/**
 * The departments, each with its teams under it, in the API's order (a department, then its teams). A team whose
 * department isn't listed is shown on its own.
 */
export function staffingGroups(units: readonly StaffingUnitView[]): StaffingGroup[] {
  const groups: StaffingGroup[] = [];
  const byId = new Map<string, StaffingGroup>();
  for (const u of units) {
    if (!u.team) {
      const g = { department: u, teams: [] };
      groups.push(g);
      byId.set(u.id, g);
    }
  }
  for (const u of units) {
    if (!u.team) continue;
    const g = u.parent ? byId.get(u.parent.id) : undefined;
    if (g) g.teams.push(u);
    else groups.push({ department: u, teams: [] });
  }
  return groups;
}

/** Its people now: "4 people", "1 person", "Nobody yet". */
export const peopleNowText = (n: number): string => (n === 0 ? 'Nobody yet' : `${n} ${n === 1 ? 'person' : 'people'}`);

/** Whether a limit can be set on it: a team, or a department without teams (a department with teams has its teams'). */
export const takesLimit = (u: Pick<StaffingUnitView, 'team' | 'hasTeams'>): boolean => u.team || !u.hasTeams;

/** Its limit in words: "At most 2 people on annual leave at once · At least 50% at work", "No limit", "Set on its teams". */
export const unitLimitText = (u: Pick<StaffingUnitView, 'team' | 'hasTeams' | 'limit'>): string => (takesLimit(u) ? staffingLimitText(u.limit) : 'Set on its teams');

/**
 * What the limit means with its people now: "With 4 people now, at least 2 are at work on any day." Null without a
 * limit, or with nobody in it.
 */
export function limitNowText(u: Pick<StaffingUnitView, 'team' | 'hasTeams' | 'limit' | 'members'>): string | null {
  if (!takesLimit(u)) return null;
  const fewest = fewestAtWork(u.limit, u.members);
  if (fewest === null) return null;
  return `With ${peopleNowText(u.members).toLowerCase()} now, at least ${fewest} ${fewest === 1 ? 'is' : 'are'} at work on any day.`;
}

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/**
 * A row's form as PUT /leave/staffing/:departmentId takes it: the most on annual leave at once (0 to 500) and the least
 * share at work (1 to 100%), each a whole number or empty (none); both empty removes the limit. What is wrong, in the
 * shared checks' words.
 */
export function staffingBody(fd: FormData): { body: StaffingLimit; errors: string[] } {
  const body: StaffingLimit = {
    maxOff: wholeFrom(text(fd, 'maxOff'), 0, STAFFING_MAX_OFF_LIMIT),
    minAtWorkPercent: wholeFrom(text(fd, 'minAtWorkPercent').replace(/%$/, ''), 1, 100),
  };
  return { body, errors: staffingLimitProblems(body) };
}

/** What a save says: "Saved: Video, at most 2 people on annual leave at once."; removed, "Video has no staffing limit now." */
export function staffingSavedText(name: string, limit: StaffingLimit): string {
  if (!hasStaffingLimit(limit)) return `${name} has no staffing limit now.`;
  const words = staffingLimitText(limit);
  return `Saved: ${name}, ${words.charAt(0).toLowerCase()}${words.slice(1).replace(' · At', ' · at')}.`;
}
