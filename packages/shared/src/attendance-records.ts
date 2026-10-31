// A person's attendance records, seen and put right by a Super Admin (owner, 31 October 2026: "is there a way to check
// the checkin records? even if imported from zoho and delete one of them?" — "as a super admin"; asked, "Stays removed"
// and "Block locked months"; then "Pick a record to remove" and "Pick which source counts": "zoho or system"):
// - a day's records: each check-in and check-out, the system's presses and Zoho's (its pairs and an open last check-in,
//   or the Excel import's first check-in and last check-out);
// - one removed, with a reason: a system press set aside whole (put back as it was on Restore), a Zoho record left out
//   by the nightly fetch and an import while removed (withoutRemovedPresses), the day worked out again without it;
// - which source a day uses when it has both Zoho's and the system's (DAY_SOURCE_CHOICES), over the usual order
//   (check-in.ts SOURCE_PRECEDENCE) for that day; a correction still applies over the day chosen (dropsForChoice);
// - none in a month whose payroll is with the CEO, approved or paid (attendance-corrections.ts correctionApplyRefusal).
// Pure: the API keeps these and the website shows the same words.

import { pairPresses, pressPairsOf, readPressPairs } from './attendance.js';
import type { ImportedDay } from './attendance-import.js';
import { cairoClock } from './check-in.js';

/** The sources a day can be chosen from, and how they are said. */
export const DAY_SOURCE_CHOICES = ['zoho', 'system'] as const;
export type DaySourceChoice = (typeof DAY_SOURCE_CHOICES)[number];
export const isDaySourceChoice = (v: unknown): v is DaySourceChoice => (DAY_SOURCE_CHOICES as readonly unknown[]).includes(v);
export const DAY_SOURCE_CHOICE_LABELS: Record<DaySourceChoice, string> = { zoho: 'Zoho People', system: 'Checked in on the system' };

/** Where a record came from. */
export const RECORD_SOURCES = ['system', 'zoho'] as const;
export type RecordSource = (typeof RECORD_SOURCES)[number];
export const isRecordSource = (v: unknown): v is RecordSource => (RECORD_SOURCES as readonly unknown[]).includes(v);

export const RECORD_REASON_MAX = 500;

/**
 * Whether a day of `source` is left out on a date chosen to use `choice`: Zoho's chosen, the system's and a device's
 * days out; the system's chosen, Zoho's out. A correction is never left out (it applies over the day chosen).
 */
export function dropsForChoice(source: string, choice: DaySourceChoice | null | undefined): boolean {
  if (!choice) return false;
  return choice === 'zoho' ? source === 'system' || source === 'device' : source === 'zoho';
}

/** A check-in or a check-out of a day: its kind and moment (ISO). */
export interface DayPress {
  kind: 'in' | 'out';
  at: string;
}

/** Two moments the same to the millisecond. */
const sameMoment = (a: string, b: string) => Date.parse(a) === Date.parse(b);

/**
 * A Zoho day's records, in time order: each pair's check-in and check-out and an open last check-in when it was kept with
 * its pairs (the fetch's), else its first check-in and last check-out (the Excel import's).
 */
export function zohoDayPresses(day: { checkIn: string | null; checkOut: string | null; pairs?: unknown; openAt?: string | null }): DayPress[] {
  const pairs = readPressPairs(day.pairs ?? null);
  const out: DayPress[] = [];
  if (pairs?.length || day.openAt) {
    for (const p of pairs ?? []) out.push({ kind: 'in', at: p.in }, { kind: 'out', at: p.out });
    if (day.openAt) out.push({ kind: 'in', at: day.openAt });
  } else {
    if (day.checkIn) out.push({ kind: 'in', at: day.checkIn });
    if (day.checkOut) out.push({ kind: 'out', at: day.checkOut });
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * A Zoho day without the records removed from it (owner, 31 October 2026: "Stays removed"): the day worked out again from
 * the records left as Zoho's are (zoho-people-api.ts zohoDayOf): its first check-in, its last check-out after it, its
 * pairs and open last check-in; a day kept by its first check-in and last check-out alone (the Excel import's) keeps them
 * without the one removed. None removed: the day as it was.
 */
export function withoutRemovedPresses(day: ImportedDay, openAt: string | null, removed: readonly DayPress[]): { day: ImportedDay; openAt: string | null } {
  if (!removed.length) return { day, openAt };
  const gone = (p: DayPress) => removed.some((r) => r.kind === p.kind && sameMoment(r.at, p.at));
  const presses = zohoDayPresses({ ...day, openAt }).filter((p) => !gone(p));
  return zohoDayFromPresses(day, presses, !!day.pairs?.length || !!openAt);
}

/** Whether a removal (its kind and moment) is a press of the day. */
export const removesPress = (removed: DayPress, press: DayPress) => removed.kind === press.kind && sameMoment(removed.at, press.at);

/** "Check-in 9:05 AM", as a record is said. */
export const recordText = (p: DayPress) => `${p.kind === 'in' ? 'Check-in' : 'Check-out'} ${cairoClock(p.at)}`;

/** Why a record can't be removed, or a source chosen (none: it can): a reason, at most 500 characters. */
export function recordReasonProblem(reason: unknown): string | null {
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (!r) return 'Write why, e.g. A double press at the door.';
  if (r.length > RECORD_REASON_MAX) return `Keep the reason to ${RECORD_REASON_MAX} characters; it has ${r.length}.`;
  return null;
}

/** "Removed by Mona on 31/10/2026: A double press at the door." */
export function removedText(r: { removedBy: string | null; removedAt: string; reason: string }): string {
  const d = r.removedAt.slice(0, 10).split('-').reverse().join('/');
  return `Removed${r.removedBy ? ` by ${r.removedBy}` : ''} on ${d}: ${r.reason}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Why a day's records can't change now (owner, 31 October 2026: "Block locked months"): its month's payroll with the CEO,
 * approved or paid, as a correction can't apply then (attendance-corrections.ts correctionApplyRefusal). Null: they can.
 */
export function recordLockRefusal(date: string, runStatus: string | null): string | null {
  const month = `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
  if (runStatus === 'approved' || runStatus === 'paid') return `The ${month} payroll is ${runStatus === 'paid' ? 'paid' : 'approved'}, so its days can't change any more.`;
  if (runStatus === 'pending_ceo') return `The ${month} payroll is with the CEO, so a change would miss it: ask the CEO to return it to HR first.`;
  return null;
}

/**
 * A Zoho day made from its records (zoho-people-api.ts zohoDayOf): kept by its pairs (`byPairs`: fetched from Zoho
 * People), its first check-in, its last check-out after it, its pairs and open last check-in; else (the Excel import's)
 * its first check-in and last check-out alone.
 */
export function zohoDayFromPresses(day: ImportedDay, presses: readonly DayPress[], byPairs: boolean): { day: ImportedDay; openAt: string | null } {
  const sorted = [...presses].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!byPairs) {
    return { day: { ...day, checkIn: sorted.find((p) => p.kind === 'in')?.at ?? null, checkOut: sorted.filter((p) => p.kind === 'out').at(-1)?.at ?? null, pairs: null }, openAt: null };
  }
  const firstIn = sorted.find((p) => p.kind === 'in') ?? null;
  const lastOut = sorted.filter((p) => p.kind === 'out' && (!firstIn || Date.parse(p.at) > Date.parse(firstIn.at))).at(-1) ?? null;
  const { pairs, open } = pairPresses(sorted);
  return {
    day: { ...day, checkIn: firstIn?.at ?? null, checkOut: lastOut?.at ?? null, pairs: sorted.length ? pressPairsOf(pairs) : null },
    openAt: open === null ? null : new Date(open).toISOString(),
  };
}
