import type { CoverageAway, CoverageDay, CoverageOff, CoverageViewer, CoverCandidate, CoveringClash, LeaveCoverageGroup } from '@trendlix/shared';

// Who else is off (owner, 25 October 2026: "if there are leaves applied by an employee and another employee in the same
// department is on a leave, how can we manage it without affecting the workflow?"; asked, "Names, no leave types", "Warn
// and need HR", "Required over 2 days"): the coverage the API works out for a request's days (packages/shared
// leave-coverage.ts), in words. The employee and their colleagues read names only ("Omar and Sara are off on 12 Nov"),
// an approver names and "leave" ("Omar is on leave on 12 Nov"), HR and the CEO the leave's type too ("Omar (Annual
// leave) is off on 12 Nov"); still being decided is "waiting". Working from home and official duty are at work, said
// apart. "N of M at work" each day; the staffing limit's warning ("This would leave Video with 1 of 4 at work on 12 Nov
// (the limit is 2): HR will need to approve it too."); and the colleagues covered on those days, a warning that never
// blocks. Pure code, tested; relative imports, as vitest doesn't know the @/ paths. Dates are YYYY-MM-DD.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dayOf = (ymd: string) => Number(ymd.slice(8, 10));
const monthOf = (ymd: string) => MONTHS[Number(ymd.slice(5, 7)) - 1] ?? '';
const yearOf = (ymd: string) => ymd.slice(0, 4);

/** A day as the coverage says it: "12 Nov". */
export const shortDay = (ymd: string): string => `${dayOf(ymd)} ${monthOf(ymd)}`;

/** Days from one to another: "12 Nov", "12–14 Nov", "30 Nov–2 Dec", "30 Dec 2026–2 Jan 2027". */
export function dayRange(from: string, to: string): string {
  if (from === to) return shortDay(from);
  if (yearOf(from) !== yearOf(to)) return `${shortDay(from)} ${yearOf(from)}–${shortDay(to)} ${yearOf(to)}`;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${dayOf(from)}–${dayOf(to)} ${monthOf(to)}`;
  return `${shortDay(from)}–${shortDay(to)}`;
}

/** Names as a sentence lists them: "Omar", "Omar and Sara", "Omar, Sara and Ali". */
export function namesText(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** What is said of someone off, beside their name: the type (HR and the CEO), half a day, still waiting. */
function offParts(o: CoverageOff, viewer: CoverageViewer): string[] {
  return [viewer === 'hr' && o.type ? o.type : null, o.halfDay ? 'half a day' : null, o.waiting ? 'waiting' : null].filter((p): p is string => !!p);
}

/** One line of people on some days, with what is said of each: "(waiting)" at the end when it is said of all of them alike. */
function line(people: { name: string; parts: string[] }[], verb: { one: string; many: string }, when: string): string {
  const same = people.every((p) => p.parts.join() === people[0].parts.join());
  const names = namesText(people.map((p) => (same || !p.parts.length ? p.name : `${p.name} (${p.parts.join(', ')})`)));
  const tail = same && people[0].parts.length ? ` (${people[0].parts.join(', ')})` : '';
  return `${names} ${people.length === 1 ? verb.one : verb.many} on ${when}${tail}`;
}

/** Runs of days (in their list, rest days left out of it) on which the same is said: a line each. */
function runs<T>(days: readonly CoverageDay[], of: (d: CoverageDay) => T[], key: (x: T) => string): { from: string; to: string; items: T[] }[] {
  const out: { from: string; to: string; items: T[]; key: string }[] = [];
  for (const d of days) {
    const items = of(d);
    if (!items.length) {
      out.push({ from: d.date, to: d.date, items, key: '' });
      continue;
    }
    const k = items.map(key).sort().join('|');
    const last = out[out.length - 1];
    if (last && last.key === k) last.to = d.date;
    else out.push({ from: d.date, to: d.date, items, key: k });
  }
  return out.filter((r) => r.items.length).map(({ from, to, items }) => ({ from, to, items }));
}

/**
 * Who of the team is off on the request's days, a line for each run of days with the same people: the employee's
 * ("Omar and Sara are off on 12 Nov", "Sara is off on 13–14 Nov (waiting)"), an approver's ("Omar is on leave on 12
 * Nov"), HR's and the CEO's ("Omar (Annual leave) is off on 12 Nov"). None: nobody else is off.
 */
export function offLines(days: readonly CoverageDay[], viewer: CoverageViewer): string[] {
  const verb = viewer === 'approver' ? { one: 'is on leave', many: 'are on leave' } : { one: 'is off', many: 'are off' };
  return runs(days, (d) => d.off, (o) => `${o.id}:${offParts(o, viewer).join(',')}`).map((r) =>
    line(
      r.items.map((o) => ({ name: o.fullNameEn, parts: offParts(o, viewer) })),
      verb,
      dayRange(r.from, r.to),
    ),
  );
}

/** Who works elsewhere on the days, at work: "Mona is working remotely on 12 Nov", "Ali is on duty on 13–14 Nov (waiting)". */
export function elsewhereLines(days: readonly CoverageDay[]): string[] {
  const parts = (a: CoverageAway) => (a.waiting ? ['waiting'] : []);
  const of = (pick: (d: CoverageDay) => CoverageAway[], verb: { one: string; many: string }) =>
    runs(days, pick, (a) => `${a.id}:${a.waiting}`).map((r) => line(r.items.map((a) => ({ name: a.fullNameEn, parts: parts(a) })), verb, dayRange(r.from, r.to)));
  return [
    ...of((d) => d.remote, { one: 'is working remotely', many: 'are working remotely' }),
    ...of((d) => d.onDuty, { one: 'is on duty', many: 'are on duty' }),
  ];
}

/** "3 of 4 at work". */
export const atWorkText = (d: Pick<CoverageDay, 'atWork' | 'members'>): string => `${d.atWork} of ${d.members} at work`;

/** The days worth a row of their own: someone else off, working elsewhere, or the limit broken. */
export const busyDays = (days: readonly CoverageDay[]): CoverageDay[] => days.filter((d) => d.off.length || d.remote.length || d.onDuty.length || d.over);

/** The days the request breaks its team's limit on. */
export const overDays = (days: readonly CoverageDay[]): CoverageDay[] => days.filter((d) => d.over);

/** "on 12 Nov", "on 12 Nov and 2 more days": the first day over the limit, and how many more. */
function overWhen(over: readonly CoverageDay[]): string {
  const more = over.length - 1;
  return `on ${shortDay(over[0].date)}${more > 0 ? ` and ${more} more ${more === 1 ? 'day' : 'days'}` : ''}`;
}

/**
 * The employee's warning (owner: "Warn and need HR"; the request can still be sent): "This would leave Video with 1 of 4
 * at work on 12 Nov (the limit is 2): HR will need to approve it too." The CEO for a C-level person's (`toCeo`), whose
 * HR stage is the CEO's. Null when it breaks no limit.
 */
export function overLimitText(group: Pick<LeaveCoverageGroup, 'nameEn'> | null, days: readonly CoverageDay[], toCeo = false): string | null {
  const over = overDays(days);
  if (!group || !over.length) return null;
  const d = over[0];
  return `This would leave ${group.nameEn} with ${d.atWork} of ${d.members} at work ${overWhen(over)} (the limit is ${d.fewestAtWork ?? d.members}): ${toCeo ? 'the CEO' : 'HR'} will need to approve it too.`;
}

/** The clash as the approvers read it: "Over the staffing limit: Video would have 1 of 4 at work on 12 Nov (the limit is 2)." */
export function clashText(group: Pick<LeaveCoverageGroup, 'nameEn'> | null, days: readonly CoverageDay[]): string | null {
  const over = overDays(days);
  if (!group || !over.length) return null;
  const d = over[0];
  return `Over the staffing limit: ${group.nameEn} would have ${d.atWork} of ${d.members} at work ${overWhen(over)} (the limit is ${d.fewestAtWork ?? d.members}).`;
}

/** The employee covers a colleague on some of the days (a warning, never a block): "You're covering Omar on 12–14 Nov". */
export const coveringText = (c: Pick<CoveringClash, 'employee' | 'startDate' | 'endDate' | 'waiting'>): string =>
  `You’re covering ${c.employee.fullNameEn} on ${dayRange(c.startDate, c.endDate)}${c.waiting ? ' (waiting)' : ''}`;

/** The same, for HR and the approvers: "Sara is covering Omar on 12–14 Nov". */
export const coversText = (name: string, c: Pick<CoveringClash, 'employee' | 'startDate' | 'endDate' | 'waiting'>): string =>
  `${name} is covering ${c.employee.fullNameEn} on ${dayRange(c.startDate, c.endDate)}${c.waiting ? ' (waiting)' : ''}`;

/** The colleagues who may cover, the requester's team first (owner's brief: "preferably from the same team"). */
export function coverGroups(candidates: readonly CoverCandidate[]): { team: CoverCandidate[]; others: CoverCandidate[] } {
  return { team: candidates.filter((c) => c.sameTeam), others: candidates.filter((c) => !c.sameTeam) };
}

/** Where a colleague works, beside their name in the lists: "Video · Production", "Finance". */
export const placeText = (p: { department: string | null; team: string | null }): string | null => [p.team, p.department].filter(Boolean).join(' · ') || null;

/** The stand-in as a request names it: the person, or HR. */
export const standInText = (s: { employee: { fullNameEn: string } | null; hr: boolean } | null | undefined): string | null =>
  !s ? null : s.hr || !s.employee ? 'HR' : s.employee.fullNameEn;

/** A stand-in chosen on the form: "hr", an employee's id, or "" for the default. */
export const standInValue = (s: { employee: { id: string } | null; hr: boolean } | null | undefined): string => (!s ? '' : s.hr || !s.employee ? 'hr' : s.employee.id);
