import { CHECK_IN_FLAG_LABELS, DAY_SOURCE_CHOICE_LABELS, cairoClock, isCheckInFlag, type DaySourceChoice, type RecordSource } from '@trendlix/shared';

// A person's attendance records on the website (owner, 31 October 2026: "is there a way to check the checkin records?
// even if imported from zoho and delete one of them?" — "as a super admin"; "zoho or system"): the day's records page
// (GET /attendance/employees/:id/records?date=), its links from the month's rows, and its words. Pure, tested.

/** A record of a day. */
export interface DayRecord {
  id: string;
  source: RecordSource;
  kind: 'in' | 'out';
  at: string;
  place: string | null;
  locationName: string | null;
  flags: string[];
}

/** A record removed (a Super Admin's view). */
export interface RemovedRecord {
  id: string;
  source: RecordSource;
  kind: 'in' | 'out';
  at: string;
  reason: string;
  removedBy: string | null;
  removedAt: string;
}

export interface DayRecordsView {
  employee: { id: string; fullNameEn: string; employeeCode: string };
  date: string;
  system: { kept: boolean; hoursCounted: number | null; records: DayRecord[] };
  zoho: { kept: boolean; hoursCounted: number | null; records: DayRecord[] };
  removed: RemovedRecord[];
  counts: 'correction' | DaySourceChoice | null;
  usual: DaySourceChoice | null;
  chosen: { source: DaySourceChoice; reason: string; by: string | null; at: string } | null;
  canChange: boolean;
  locked: string | null;
}

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const isDay = (v: string) => DAY.test(v);

/** A person's day's records, from their month (HR, the CEO, Finance, a Super Admin). */
export const recordsHref = (employeeId: string, date: string) => `/attendance/${encodeURIComponent(employeeId)}/records/${date}`;

/** One's own day's records, from My Attendance. */
export const myRecordsHref = (date: string) => `/my-attendance/records/${date}`;

/** "Check-in 9:05 AM". */
export const recordWords = (r: Pick<DayRecord, 'kind' | 'at'>) => `${r.kind === 'in' ? 'Check-in' : 'Check-out'} ${cairoClock(r.at)}`;

const PLACES: Record<string, string> = { office: 'Office', home: 'Home', remote: 'Remote', unknown: 'Location unknown' };

/** Where a system record was, with its flags: "Office · Studio · Checked in outside the office on an office day". */
export function recordWhere(r: Pick<DayRecord, 'place' | 'locationName' | 'flags'>): string | null {
  const parts = [r.place ? (PLACES[r.place] ?? r.place) : null, r.locationName, ...r.flags.filter(isCheckInFlag).map((f) => CHECK_IN_FLAG_LABELS[f])];
  const shown = parts.filter((p): p is string => !!p);
  return shown.length ? shown.join(' · ') : null;
}

/** The sources as the page heads them. */
export const SOURCE_HEADS: Record<RecordSource, string> = { system: DAY_SOURCE_CHOICE_LABELS.system, zoho: DAY_SOURCE_CHOICE_LABELS.zoho };

/** Which records the day uses, in words. */
export function countsWords(v: Pick<DayRecordsView, 'counts' | 'chosen' | 'usual'>): string {
  if (v.counts === 'correction') return 'An approved correction counts for this day, over its records.';
  if (!v.counts) return 'No records kept for this day.';
  const name = DAY_SOURCE_CHOICE_LABELS[v.counts];
  if (v.chosen) return `${name} counts for this day: chosen${v.chosen.by ? ` by ${v.chosen.by}` : ''}, “${v.chosen.reason}”.`;
  return `${name} counts for this day${v.usual === 'system' ? ': the system’s check-ins come before Zoho’s.' : '.'}`;
}

/** Hours as the page says them: 8.5 → "8:30". */
export function hoursWords(h: number | null): string | null {
  if (h === null) return null;
  const minutes = Math.round(h * 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
