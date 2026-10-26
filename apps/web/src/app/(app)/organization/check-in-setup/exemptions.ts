import {
  EXEMPTION_PEOPLE_MAX,
  EXEMPTION_REASON_MAX,
  EXEMPTION_STATE_LABELS,
  exemptionInputProblems,
  exemptionState,
  exemptionWhenText,
  type ExemptionState,
  type Role,
  type SuggestedExemptionStart,
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
// The first day (owner, 26 October 2026: "when exempting someone from attendance auto fill his contract start date in
// the exempt from date"): "From" starts as the person's contract's start, else their join date, else today, as the API
// sends it (suggestedFrom), with a hint saying where it came from; HR may change it. Choosing several on Check-in Setup,
// each starts on their own (shown by their names) unless HR types a date, which is then everyone's; left empty, each
// their own (ownStart).

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
 * once, at most 100), the reason (required, at most 500 characters), the first day (DD/MM/YYYY; empty: each their own
 * when the form says `ownStart`, else today) and the last (empty: no end), on or after the first (`today`: YYYY-MM-DD,
 * Cairo; each one's own first day the API checks). Problems: what can't be sent, in words.
 */
export function exemptionBody(fd: FormData, today: string): { body: ExemptionBody | null; problems: string[] } {
  const employeeIds = [...new Set(fd.getAll('employeeId').map(String).filter(Boolean))];
  const reason = String(fd.get('reason') ?? '').trim();
  const fromTyped = String(fd.get('startDate') ?? '');
  const untilTyped = String(fd.get('endDate') ?? '');
  const ownStart = fd.get('ownStart') === '1';
  const from = parseDate(fromTyped);
  const until = parseDate(untilTyped);
  const problems: string[] = [];
  if (!employeeIds.length) problems.push('Choose at least one person to exempt.');
  else if (employeeIds.length > EXEMPTION_PEOPLE_MAX) problems.push(`Exempt at most ${EXEMPTION_PEOPLE_MAX} people at once: ${employeeIds.length} are chosen.`);
  if (from === null) problems.push(`Enter the first day as DD/MM/YYYY, e.g. 01/11/2026, or leave it empty for ${ownStart ? 'their own start date' : 'today'}.`);
  if (until === null) problems.push('Enter the last day as DD/MM/YYYY, e.g. 30/11/2026, or leave it empty for no end date.');
  const startDate = from || null;
  const endDate = until || null;
  const own = ownStart && startDate === null;
  // the reason, and the last day before the first (the shared rule the API applies too; each one's own, the API)
  problems.push(...exemptionInputProblems({ reason, startDate: startDate ?? today, endDate: from === null || until === null || own ? null : endDate }, today));
  if (problems.length) return { body: null, problems };
  return { body: { employeeIds, reason, startDate, endDate, ...(own && { ownStart: true as const }) }, problems };
}

/** Where a person's first day comes from, as the hint under "From" says: their contract's start, their join date, or today. */
export function startHint(s: SuggestedExemptionStart | null | undefined): string {
  if (s?.source === 'contract') return `Their contract’s start date (${joinShown([s.contractNumber, formatDate(s.date)], ', ')}).`;
  if (s?.source === 'join') return `Their join date (${formatDate(s.date)}).`;
  return 'Today unless changed.';
}

/** The hint before anyone is chosen, and with several chosen and "From" empty. */
export const FROM_NONE_HINT = 'Each person’s contract start date, else their join date, once chosen. A date typed here is for everyone.';
export const FROM_SEVERAL_HINT = 'Each from their own contract start date, else their join date, as shown by their names. A date typed here is for everyone.';
export const FROM_TYPED_HINT = 'For everyone chosen; empty: each from their own.';
/** What follows every hint under "From". */
export const FROM_LOCK_HINT = 'A day in a month whose payroll is with the CEO, approved or paid can’t be chosen.';

/**
 * What "From" holds and says for the people chosen (`starts`: each one's first day as the API sent it, in the order
 * chosen; the profile: their one), and whether each starts on their own (empty: shown by their names, sent as ownStart).
 * `typed`: what HR typed in it, null until they change it. Untouched: one person's own day (today without one);
 * several, or none yet, empty.
 */
export function fromField(starts: readonly (SuggestedExemptionStart | null | undefined)[], typed: string | null, today: string): { value: string; hint: string; own: boolean } {
  const one = starts.length === 1 ? starts[0] : undefined;
  const value = typed ?? (starts.length === 1 ? formatDate(one?.date ?? today) : '');
  const own = value.trim() === '';
  const hint = starts.length === 0 ? FROM_NONE_HINT : starts.length === 1 ? startHint(one) : own ? FROM_SEVERAL_HINT : FROM_TYPED_HINT;
  return { value, hint, own };
}

/** By a chosen person's name while each starts on their own: "from 30/07/2025"; nothing without a day sent. */
export const ownStartText = (s: SuggestedExemptionStart | null | undefined): string | null => (s ? `from ${formatDate(s.date)}` : null);

/** The reason's counter: "12/500". */
export const reasonCount = (typed: string): string => `${typed.trim().length}/${EXEMPTION_REASON_MAX}`;

/** "Add people"'s button: "Exempt 1 person", "Exempt 3 people". */
export const exemptButtonText = (count: number): string => (count === 1 ? 'Exempt 1 person' : `Exempt ${count} people`);

/** The most people saving names with their first days; the others are counted. */
const NAMED_MAX = 5;

/** What saving says: one person by name, with the period; several by number, and each one's first day when they differ. */
export function addedExemptionsText(made: readonly Pick<CheckInExemptionView, 'employee' | 'startDate' | 'endDate'>[]): string {
  if (made.length === 1) return `${made[0].employee.fullNameEn} is exempt from check-in: ${periodText(made[0]).replace(/^From/, 'from')}.`;
  if (new Set(made.map((m) => m.startDate)).size <= 1) return `Exempted ${made.length} people from check-in.`;
  const named = made.slice(0, NAMED_MAX).map((m) => `${m.employee.fullNameEn} from ${formatDate(m.startDate)}`);
  const more = made.length - named.length;
  return `Exempted ${made.length} people from check-in, each from their own first day: ${named.join(', ')}${more ? ` and ${more} more` : ''}.`;
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

/**
 * Whom "Add people" offers: everyone the caller may see who has no current or upcoming exemption, by name, each with the
 * first day theirs starts with (null: none sent).
 */
export function exemptionCandidates<C extends { id: string; fullNameEn: string; employeeCode: string; department: string | null; suggestedFrom?: SuggestedExemptionStart | null }>(
  candidates: readonly C[],
  listed: readonly Pick<CheckInExemptionView, 'employee' | 'state'>[],
): { value: string; label: string; from: SuggestedExemptionStart | null }[] {
  const exempt = new Set(listed.filter((e) => e.state !== 'ended').map((e) => e.employee.id));
  return candidates
    .filter((c) => !exempt.has(c.id))
    .map((c) => ({ value: c.id, label: joinShown([c.fullNameEn, c.employeeCode, c.department]), from: c.suggestedFrom ?? null }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));
}
