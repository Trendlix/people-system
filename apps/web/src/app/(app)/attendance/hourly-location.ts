import { cairoClock, flaggedPing, NO_PING_REASON_LABELS, type DayPingsPerson, type DayPingsView, type PingView } from '@trendlix/shared';

// The hourly location on Daily Attendance (owner, 10 November 2026: "the hourly ping is not working too, i cant find it
// in the system", then "can it be embeded in the attendance page?"): one day of the month shown (today in this month,
// else its last day; ?day= for another), everyone checked in on the system that day with their pings, the flagged
// first, and for someone with none, why (an iPhone doesn't send it yet, the website can't, under an hour, none came).
// The page's filters (a department or team, a person, a search) keep to the people they list.

/** The day shown: the one asked when it is in the month and not to come; else today in this month, or the month's last day; none for a month to come. */
export function hourlyDayOf(month: string, asked: string | null | undefined, today: string): string | null {
  const last = lastDayOf(month);
  const first = `${month}-01`;
  if (first > today) return null;
  if (asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked >= first && asked <= last && asked <= today) return asked;
  return today <= last ? today : last;
}

/** The day before and after the one shown, within the month and never to come (null: none). */
export function hourlyDayNav(month: string, day: string, today: string): { prev: string | null; next: string | null } {
  const prev = shift(day, -1);
  const next = shift(day, 1);
  return { prev: prev.startsWith(month) ? prev : null, next: next.startsWith(month) && next <= today ? next : null };
}

/** The people shown: everyone's, or only those the page's filters list (their ids; null: no filter). */
export const hourlyPeople = (view: DayPingsView, listed: ReadonlySet<string> | null): DayPingsPerson[] =>
  listed ? view.people.filter((p) => listed.has(p.employee.id)) : view.people;

/** The section's line while closed: "14 checked in · 3 flagged · 9 without pings". */
export function hourlySummary(people: readonly DayPingsPerson[]): string {
  if (!people.length) return 'Nobody checked in on the system';
  const flagged = people.filter((p) => p.flagged > 0).length;
  const none = people.filter((p) => !p.pings.length).length;
  return [`${people.length} checked in`, flagged > 0 ? `${flagged} flagged` : 'none flagged', none > 0 && `${none} without pings`].filter(Boolean).join(' · ');
}

/** "5.2 km", "120 m". */
const far = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

/** One ping in a few words, with its tone: "11:03 · Away 1.2 km" (warn), "10:02 · At the place" (ok). */
export function pingChip(p: PingView): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  const at = cairoClock(p.at);
  switch (p.status) {
    case 'at_place':
      return { text: `${at} · At the place`, tone: 'ok' };
    case 'away':
      return { text: `${at} · Away${p.distanceMetres !== null ? ` ${far(p.distanceMetres)}` : ''}`, tone: 'warn' };
    case 'off':
      return { text: `${at} · ${p.placeText}`, tone: 'warn' };
    default:
      return { text: `${at} · Can’t tell`, tone: 'muted' };
  }
}

/** Their day in a line: "In 9:02 · Office · Out 17:10", "In 9:02 · Office · still in". */
export function stayText(p: Pick<DayPingsPerson, 'checkIn' | 'checkOut' | 'checkInPlace'>): string {
  if (!p.checkIn) return '';
  return [`In ${cairoClock(p.checkIn)}`, p.checkInPlace, p.checkOut ? `Out ${cairoClock(p.checkOut)}` : 'still in'].filter(Boolean).join(' · ');
}

/** Why someone has no pings, in words. */
export const noPingsText = (p: Pick<DayPingsPerson, 'noPings'>): string => (p.noPings ? NO_PING_REASON_LABELS[p.noPings] : '');

/** Whether the section opens by itself: something flagged that day. */
export const opensFlagged = (people: readonly DayPingsPerson[]): boolean => people.some((p) => p.flagged > 0 || p.pings.some((x) => flaggedPing(x.status)));

function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

function shift(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
