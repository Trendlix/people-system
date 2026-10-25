import {
  EXEMPTION_PEOPLE_MAX,
  EXEMPTION_REASON_MAX,
  EXEMPTION_STATE_LABELS,
  exemptionInputProblems,
  exemptionState,
  exemptionWhenText,
  type ExemptionState,
  type Role,
} from '@trendlix/shared';
import type { CheckInExemptionView, ExemptionBody } from '../../../../lib/exemption-types';
import { formatDate, parseDate } from '../../../../lib/format';
import { joinShown } from '../../../../lib/hidden';
import { hasRole } from '../../../../lib/roles';

// People exempt from check-in (owner, 25 October 2026: "allow me to select people that are not eligable for attendance
// checkins and outs, trat them as if they achived their full working hours"; asked, "Optional check-in" and "Profile + a
// list in Check-in Setup"): on a person's profile (the Employment tab, by their attendance details) and as Check-in
// Setup's list "Exempt From Check-in", where "Add people" exempts several at once with one reason and one from–until.
// An exempt working day counts as full hours, whatever was pressed; checking in stays optional (the presses are kept
// for reference), no reminder goes, and approved leave stays leave. Pure code, tested: who sees it, the form read into
// what the API takes, and what the rows, buttons and messages say. The API decides who may add or end one (HR, Admin,
// the Super Admin; a C-level person's only the CEO or a Super Admin) and checks every value again. Relative imports: the
// tests run without the "@/" alias.

type WithRoles = { roles: readonly Role[] };

/** The list's section on Check-in Setup, for links into it. */
export const EXEMPTIONS_ID = 'exempt-from-check-in';

/** What the list and the profile say an exempt day is. */
export const EXEMPTIONS_INTRO =
  'People who don’t need to check in: each working day of theirs counts as the shift’s full hours, never absent, late or short. They may still check in and out; their presses are kept for reference only, never counted, never refused by the office network’s or the GPS lock, and no reminder goes to them. Approved leave, unpaid leave included, still counts as leave, and holidays and rest days are as they are.';

/** Who reads a person's exemptions on their profile: HR, Admin (a Super Admin as an Admin), the CEO, and the person themself. */
export const seesExemptions = (user: WithRoles & { employeeId?: string | null }, employeeId: string): boolean =>
  hasRole(user, 'hr', 'admin', 'ceo') || user.employeeId === employeeId;

/** A state as its badge: its word and colour. */
export function stateBadge(state: ExemptionState): { label: string; tone: string } {
  const tone = state === 'current' ? 'bg-ok-soft text-ok' : state === 'upcoming' ? 'bg-accent-soft text-accent' : 'bg-line-soft text-muted';
  return { label: EXEMPTION_STATE_LABELS[state], tone };
}

/** The periods still to count (current, then upcoming by their first day) and those ended (newest first). */
export function splitPeriods<P extends Pick<CheckInExemptionView, 'state' | 'startDate'>>(periods: readonly P[]): { active: P[]; ended: P[] } {
  const active = periods.filter((p) => p.state !== 'ended').sort((a, b) => (a.state === b.state ? a.startDate.localeCompare(b.startDate) : a.state === 'current' ? -1 : 1));
  const ended = periods.filter((p) => p.state === 'ended').sort((a, b) => b.startDate.localeCompare(a.startDate));
  return { active, ended };
}

/** "From 01/11/2026 until 30/11/2026"; an ended one that ended early says so. */
export const periodText = (p: Pick<CheckInExemptionView, 'startDate' | 'endDate'>): string => exemptionWhenText(p);

/** Who added a period and when, and who ended it: "Added by Hazem Magdy on 25/10/2026 · ended by HR on 30/10/2026". */
export function periodByText(p: Pick<CheckInExemptionView, 'createdAt' | 'createdBy' | 'endedAt' | 'endedBy'>): string {
  const added = `Added${p.createdBy ? ` by ${p.createdBy}` : ''} on ${formatDate(p.createdAt)}`;
  const ended = p.endedAt ? `ended early${p.endedBy ? ` by ${p.endedBy}` : ''} on ${formatDate(p.endedAt)}` : null;
  return joinShown([added, ended], ' · ');
}

/** A row of the list: the person (name · code), their team, the reason, from and until in words. */
export function exemptionRowText(e: CheckInExemptionView): { person: string; team: string | null; from: string; until: string } {
  return {
    person: joinShown([e.employee.fullNameEn, e.employee.employeeCode]),
    team: e.employee.department,
    from: formatDate(e.startDate),
    until: e.endDate ? formatDate(e.endDate) : 'No end date',
  };
}

/**
 * The form read into what the API takes (POST /attendance/check-in-exemptions): the people chosen (`employeeId`, each
 * once, at most 100), the reason (required, at most 500 characters), the first day (DD/MM/YYYY; empty: today) and the last
 * (empty: no end), on or after the first (`today`: YYYY-MM-DD, Cairo). Problems: what can't be sent, in words.
 */
export function exemptionBody(fd: FormData, today: string): { body: ExemptionBody | null; problems: string[] } {
  const employeeIds = [...new Set(fd.getAll('employeeId').map(String).filter(Boolean))];
  const reason = String(fd.get('reason') ?? '').trim();
  const fromTyped = String(fd.get('startDate') ?? '');
  const untilTyped = String(fd.get('endDate') ?? '');
  const from = parseDate(fromTyped);
  const until = parseDate(untilTyped);
  const problems: string[] = [];
  if (!employeeIds.length) problems.push('Choose at least one person to exempt.');
  else if (employeeIds.length > EXEMPTION_PEOPLE_MAX) problems.push(`Exempt at most ${EXEMPTION_PEOPLE_MAX} people at once: ${employeeIds.length} are chosen.`);
  if (from === null) problems.push('Enter the first day as DD/MM/YYYY, e.g. 01/11/2026, or leave it empty for today.');
  if (until === null) problems.push('Enter the last day as DD/MM/YYYY, e.g. 30/11/2026, or leave it empty for no end date.');
  const startDate = from || null;
  const endDate = until || null;
  // the reason, and the last day before the first (the shared rule the API applies too)
  problems.push(...exemptionInputProblems({ reason, startDate: startDate ?? today, endDate: from === null || until === null ? null : endDate }, today));
  if (problems.length) return { body: null, problems };
  return { body: { employeeIds, reason, startDate, endDate }, problems };
}

/** The reason's counter: "12/500". */
export const reasonCount = (typed: string): string => `${typed.trim().length}/${EXEMPTION_REASON_MAX}`;

/** "Add people"'s button: "Exempt 1 person", "Exempt 3 people". */
export const exemptButtonText = (count: number): string => (count === 1 ? 'Exempt 1 person' : `Exempt ${count} people`);

/** What saving says: one person by name, with the period; several by number. */
export function addedExemptionsText(made: readonly Pick<CheckInExemptionView, 'employee' | 'startDate' | 'endDate'>[]): string {
  if (made.length === 1) return `${made[0].employee.fullNameEn} is exempt from check-in: ${periodText(made[0]).replace(/^From/, 'from')}.`;
  return `Exempted ${made.length} people from check-in.`;
}

/** What "End now" asks first: a period started ends today (today still full); one not started is removed. */
export function endExemptionConfirm(name: string, p: Pick<CheckInExemptionView, 'startDate' | 'endDate'>, today: string): string {
  return exemptionState(p, today) === 'upcoming'
    ? `Remove ${name}’s exemption from check-in? It hasn’t started yet, so it is removed.`
    : `End ${name}’s exemption from check-in now? Today still counts as full; from tomorrow their working days count from their check-ins again.`;
}

/** What ending says, as the API answered: ended today, or removed (not started). */
export const endedExemptionText = (name: string, removed: boolean): string =>
  removed ? `Removed ${name}’s exemption from check-in: it hadn’t started.` : `${name}’s exemption from check-in ends today: from tomorrow their check-ins count again.`;

/** Whom "Add people" offers: everyone the caller may see who has no current or upcoming exemption, by name. */
export function exemptionCandidates<C extends { id: string; fullNameEn: string; employeeCode: string; department: string | null }>(
  candidates: readonly C[],
  listed: readonly Pick<CheckInExemptionView, 'employee' | 'state'>[],
): { value: string; label: string }[] {
  const exempt = new Set(listed.filter((e) => e.state !== 'ended').map((e) => e.employee.id));
  return candidates
    .filter((c) => !exempt.has(c.id))
    .map((c) => ({ value: c.id, label: joinShown([c.fullNameEn, c.employeeCode, c.department]) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));
}
