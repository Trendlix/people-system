import { formatDate } from './format';

// Stand-ins on the web's side (owner, 25 October 2026: "if there are leaves applied by an employee and another employee
// in the same department is on a leave, how can we manage it without affecting the workflow?"; asked, "To a stand-in"):
// while an approver is on approved leave with a stand-in, what waits at their step is the stand-in's to decide. The
// dashboard says so to the stand-in, and a request's page says whom they decide it for. Pure code, tested; relative
// imports, as vitest's tests read them.

/** An approver on leave the signed-in person stands in for today (GET /auth/me's standingInFor). */
export interface StandingFor {
  id: string;
  fullNameEn: string;
  /** Their leave's last day, YYYY-MM-DD. */
  until: string;
}

/**
 * The dashboard's line while they stand in for someone: "You’re standing in for Ahmed Ali until 14/11/2026: their team’s
 * requests come to you."; for two or more, each with their last day, and "their teams’". Null when they stand in for nobody.
 */
export function standingInBannerText(list: readonly StandingFor[] | null | undefined): string | null {
  const people = (list ?? []).filter((p) => p.fullNameEn.trim() !== '');
  if (!people.length) return null;
  const parts = people.map((p) => `${p.fullNameEn} until ${formatDate(p.until)}`);
  const who = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `You’re standing in for ${who}: their ${people.length === 1 ? 'team’s' : 'teams’'} requests come to you.`;
}

/**
 * A request's page while the caller decides it standing in (its standingInFor): "Standing in for Ahmed Ali, who is on
 * leave: you decide this at their step until they are back." Null when they decide it as themself.
 */
export function standingInNoteText(person: { fullNameEn: string } | null | undefined): string | null {
  if (!person?.fullNameEn.trim()) return null;
  return `Standing in for ${person.fullNameEn}, who is on leave: you decide this at their step until they are back.`;
}
