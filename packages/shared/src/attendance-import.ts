// Importing attendance from Zoho People (owner, 19 October 2026: attendance today runs in Zoho People, "Import Zoho now,
// replace it later"): its daily "attendance entries" export, a row per person and day with the first check-in and the
// last check-out, read on a draft payroll run and applied to its lines. The owner's answers, the same day:
// - "one file with everyone, or many files at once": each file's rows are grouped by person (attendance-import in the API).
// - Hours by the system's shift rule, not Zoho's shift: a day counts the time between check-in and check-out within the
//   shift's window, at most its hours to work (attendance.ts hoursCountedForDay: the MORNING shift's 9 hours within
//   9:00–19:00, its end moved by the shift's grace minutes: 19:15, owner, 19 October 2026: "if the employee checked in
//   10:15 he can check out till 7:15 and the 9 hours are counted"), never Zoho's "Morning Shift (10:00 AM - 07:00 PM)".
//   A shift that counts hours until a time (owner, 20 October 2026: "no working hours to be counted after 8 PM even if
//   the check out was 11 PM"; attendance.ts countUntilOf) counts each day until then, not capped at the hours to work.
// - People matched by name: Zoho's Employee Name against the profile's English name, written alike (case, spaces,
//   punctuation, and the Arabic names' English spellings, Gerges and Girgis, Mohammed and Mohamed); the same name is a
//   match, a close one is HR's to confirm ("Did you mean …?"), none is HR's to pick or skip; a link HR confirms is
//   remembered by Zoho's Employee Id and matched by it next time (matchPerson).
// - Office or remote: office when the check-in is at Al Doctor Al Mahrouqi Street 13, 15 or 17, or names "Trendlix" ("13
//   and 17 al mahrouki is also in office"), remote anywhere else; only that is kept, never the address. The office
//   addresses are a setting HR edits (Payroll Setup → Your Rules), these to start with (placeOf).
// - Leave stays in the system ("In the system, stop it in Zoho"): the approved leave comes from the Leave module; a day
//   Zoho marks as leave with no leave in the system isn't absent: it is listed for HR to record in the system.
// - Absent days: a working day of the person's shift (not a rest day, not an official holiday, not on leave in the
//   system, not a leave in Zoho) with no check-in is a whole absent day: the payroll's no-show days (charged ×2, as the
//   run does). Short hours on a day worked count in the attendance % only.
// - Permission: the approved permission requests in the system (permissions.ts); for a month with none, Zoho's
//   Permission column counts, within the month's allowance, never both.
// Pure: the API reads the files and applies these, and the web shows the same words.

import { hoursCountedForDay, mostHoursCountedADay, shiftWindowOn, spanHours, spansOfPairs, type PressPair } from './attendance.js';
import { openCheckInHours, openHalfDayOn, type KeptDay } from './attendance-days.js';
import type { ShiftTimes } from './payroll.js';

// ---------- office or remote ----------

/**
 * The office's addresses as Zoho writes the check-in location (owner, 19 October 2026: office "if in 15 almahrouki", then
 * "13 and 17 al mahrouki is also in office"; the company's own name, as Zoho names the place): a check-in whose location
 * has one of them is at the office. HR changes them on Payroll Setup.
 */
export const OFFICE_ADDRESS_DEFAULTS: readonly string[] = [
  'Trendlix',
  '13, Al Doctor Al Mahrouqi Street',
  '15, Al Doctor Al Mahrouqi Street',
  '17, Al Doctor Al Mahrouqi Street',
];

/** Where someone worked a day: at the office or remote (the address itself is never kept). */
export const WORK_PLACES = ['office', 'remote'] as const;
export type WorkPlace = (typeof WORK_PLACES)[number];

export const WORK_PLACE_LABELS: Record<WorkPlace, string> = { office: 'Office', remote: 'Remote' };

/** Text as addresses are compared: lower case, letters and digits only, one space between words. */
const addressWords = (text: string) => ` ${text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/**
 * Where a day was worked, from its check-in location (else its check-out location): office when it has one of the
 * office addresses (whole words, whatever the case, commas and spaces, so "115, Al Doctor…" isn't "15, Al Doctor…"),
 * remote for any other place; null when neither location says anything ("-" or empty).
 */
export function placeOf(checkInLocation: string | null | undefined, checkOutLocation: string | null | undefined, officeAddresses: readonly string[]): WorkPlace | null {
  const location = [checkInLocation, checkOutLocation].map((l) => (l ?? '').trim()).find((l) => addressWords(l).trim() !== '');
  if (!location) return null;
  const words = addressWords(location);
  return officeAddresses.some((a) => addressWords(a).trim() !== '' && words.includes(addressWords(a))) ? 'office' : 'remote';
}

/** Why the office addresses can't be saved (none: they can): each 2 to 120 characters, at most 20, none twice. */
export function officeAddressesProblems(addresses: readonly string[]): string[] {
  const problems: string[] = [];
  if (addresses.length > 20) problems.push('Enter at most 20 office addresses.');
  if (addresses.some((a) => a.trim().length < 2 || a.trim().length > 120)) problems.push('Enter each office address as 2 to 120 characters, e.g. 15, Al Doctor Al Mahrouqi Street.');
  const seen = new Set<string>();
  for (const a of addresses) {
    const key = addressWords(a);
    if (seen.has(key)) {
      problems.push(`"${a.trim()}" is there twice: keep it once.`);
      break;
    }
    seen.add(key);
  }
  return problems;
}

// ---------- matching people by name ----------

/**
 * The Arabic names' common English spellings, each to one (owner, 19 October 2026: "Gerges vs Girgis",
 * "Mohammed/Mohamed"): what makes two spellings of a name the same name.
 */
const NAME_SPELLINGS: Readonly<Record<string, readonly string[]>> = {
  mohamed: ['mohammed', 'mohammad', 'muhammad', 'muhammed', 'mohamad', 'mohamd', 'mhmd', 'mohammd', 'muhamed'],
  ahmed: ['ahmad', 'ahmd'],
  mahmoud: ['mahmud', 'mahmood', 'mahmod'],
  mostafa: ['mustafa', 'moustafa', 'mostapha', 'mustapha'],
  youssef: ['yousef', 'yousif', 'youssif', 'yusuf', 'yosef', 'youcef', 'yussef'],
  gerges: ['girgis', 'guirguis', 'gerjis', 'girgess', 'gergis', 'guergues'],
  hussein: ['hossein', 'hussien', 'husein', 'hosein', 'hossain', 'husain', 'hussain'],
  hassan: ['hasan'],
  hossam: ['husam', 'hosam', 'hussam'],
  ibrahim: ['ebrahim', 'ibraheem'],
  ismail: ['esmail', 'ismael', 'esmaeil'],
  khaled: ['khalid'],
  walid: ['waleed'],
  said: ['saeed', 'saied', 'saeid'],
  magdy: ['magdi'],
  fathy: ['fathi'],
  hany: ['hani'],
  ramy: ['rami'],
  samy: ['sami'],
  shady: ['shadi'],
  tamer: ['tamir'],
  osama: ['ossama', 'usama', 'oussama'],
  omar: ['omer', 'umar'],
  amr: ['amro', 'amru'],
  essam: ['issam', 'esam'],
  abdelrahman: ['abdulrahman', 'abdalrahman', 'abdurrahman', 'abderrahman'],
  abdallah: ['abdullah', 'abdella', 'abdalla', 'abdulla', 'abdelallah', 'abdelalla'],
  mina: ['meena', 'minaa'],
  mariam: ['maryam', 'meriam', 'miriam'],
  nourhan: ['norhan'],
  nour: ['noor', 'nur'],
  yasmine: ['yasmin', 'yasmeen'],
  eman: ['iman', 'emaan'],
  aya: ['ayah'],
  heba: ['hiba'],
  rana: ['ranaa'],
  sara: ['sarah'],
  fatma: ['fatima', 'fatmah'],
  marwa: ['marwah'],
  salma: ['salmaa'],
  amira: ['ameera'],
  karim: ['kareem'],
  youssria: ['yousria', 'yusria'],
  elsayed: ['alsayed', 'elsaied', 'elsaeed'],
};

const CANONICAL = new Map<string, string>(Object.entries(NAME_SPELLINGS).flatMap(([canon, spellings]) => [[canon, canon] as const, ...spellings.map((s) => [s, canon] as const)]));

/**
 * A name's words as they are compared: lower case, without accents, punctuation or extra spaces; "Abd El Rahman",
 * "Abdel-Rahman" and "Abdulrahman" as one word, "El Sayed" and "Al-Sayed" as one; each spelling of a common Arabic name
 * as one (NAME_SPELLINGS).
 */
export function nameWords(name: string): string[] {
  let text = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s'-]+/g, ' ')
    .replace(/['-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // "abd el rahman", "abdel rahman", "abdul rahman", "abd al rahman" → one word; "el sayed", "al sayed" → one word
  text = text.replace(/\babd(?:\s?(?:el|al|ul|ol|l))?\s+(?=[a-z])/g, 'abdel').replace(/\b(?:el|al)\s+(?=[a-z]{2,})/g, 'el');
  return text
    .split(' ')
    .filter(Boolean)
    .map((w) => CANONICAL.get(w) ?? w);
}

/** A name as an exact match takes it: its words (nameWords), one space between. */
export const nameKey = (name: string): string => nameWords(name).join(' ');

/**
 * A word's sound as a close match takes it: its first letter and its consonants, without the vowels (and y, w, h after
 * the first letter) and doubled letters, gu as g, q as k, ph as f: "girgis" and "gerges" are both "grgs".
 */
export function wordSound(word: string): string {
  const w = word.replace(/ph/g, 'f').replace(/q/g, 'k').replace(/gu(?=[aeiouy])/g, 'g').replace(/ou/g, 'u');
  return ((w[0] ?? '') + w.slice(1).replace(/[aeiouyhw]/g, '')).replace(/(.)\1+/g, '$1');
}

/**
 * How alike two names are, 0 to 1: the share of their words that sound alike (wordSound), both names' words counted
 * (2 × the words alike ÷ all the words), so "Rania Samir Gerges" and "Rania Samir Fawzy Botros Girgis" are 0.75.
 * 0 unless the first names sound alike: someone else's surname is no match.
 */
export function nameSimilarity(a: string, b: string): number {
  const [x, y] = [nameWords(a).map(wordSound), nameWords(b).map(wordSound)];
  if (!x.length || !y.length || x[0] !== y[0]) return 0;
  const left = [...y];
  let alike = 0;
  for (const s of x) {
    const i = left.indexOf(s);
    if (i >= 0) {
      alike++;
      left.splice(i, 1);
    }
  }
  return Math.round(((2 * alike) / (x.length + y.length)) * 100) / 100;
}

/** A close match from this alike on (nameSimilarity): HR confirms it. */
export const CLOSE_NAME_SIMILARITY = 0.6;

/** How a Zoho person was matched to an employee. */
export const MATCH_KINDS = ['linked', 'exact', 'close', 'none'] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

export const MATCH_KIND_LABELS: Record<MatchKind, string> = {
  linked: 'Matched by their Zoho ID',
  exact: 'Matched by name',
  close: 'Did you mean …?',
  none: 'Not found',
};

/** An employee as the matching compares them. */
export interface MatchCandidate {
  id: string;
  fullNameEn: string;
  /** The Zoho Employee Id remembered for them, once HR confirmed a link. */
  zohoPeopleId?: string | null;
}

/**
 * Who a Zoho person is (owner, 19 October 2026): the employee whose remembered Zoho Employee Id is theirs (`linked`);
 * else the one employee whose English name is theirs written alike (`exact`; two such: both close, for HR to choose);
 * else those whose names are close enough (`close`, the closest first, at most 3: "Did you mean …?"); else `none`.
 */
export function matchPerson(person: { zohoId: string | null; name: string }, employees: readonly MatchCandidate[]): { kind: MatchKind; employeeId: string | null; candidates: { id: string; similarity: number }[] } {
  const id = person.zohoId?.trim();
  if (id) {
    const linked = employees.find((e) => e.zohoPeopleId?.trim() === id);
    if (linked) return { kind: 'linked', employeeId: linked.id, candidates: [] };
  }
  const key = nameKey(person.name);
  const same = key ? employees.filter((e) => nameKey(e.fullNameEn) === key) : [];
  if (same.length === 1) return { kind: 'exact', employeeId: same[0].id, candidates: [] };
  const close = employees
    .map((e) => ({ id: e.id, similarity: same.some((s) => s.id === e.id) ? 1 : nameSimilarity(person.name, e.fullNameEn) }))
    .filter((c) => c.similarity >= CLOSE_NAME_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id))
    .slice(0, 3);
  return close.length ? { kind: 'close', employeeId: null, candidates: close } : { kind: 'none', employeeId: null, candidates: [] };
}

// ---------- Zoho's day statuses ----------

/** What Zoho's Status says of a day, as the import reads it. */
export type ZohoStatusKind = 'present' | 'leave' | 'weekend' | 'holiday' | 'absent' | 'other';

/**
 * Zoho's Status, read: Present, Present / Regularized and On Duty are days present (On Duty: working away from the
 * office); any "… Leave" a leave (Annual Leave, Sick Leave …); Weekend; Holiday; Absent; anything else other.
 */
export function zohoStatusKind(status: string | null | undefined): ZohoStatusKind {
  const s = (status ?? '').trim().toLowerCase();
  if (!s) return 'other';
  if (/\bleave\b/.test(s)) return 'leave';
  if (/\bpresent\b|on\s*duty|regulari[sz]ed/.test(s)) return 'present';
  if (/weekend|week off|weekly off/.test(s)) return 'weekend';
  if (/holiday/.test(s)) return 'holiday';
  if (/absent/.test(s)) return 'absent';
  return 'other';
}

// ---------- a person's month ----------

/** A day as the import read it: its check-in and check-out (moments, ISO), where, Zoho's status and permission hours. */
export interface ImportedDay {
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  place: WorkPlace | null;
  zohoStatus: string | null;
  /** Zoho's Permission column that day, in hours (0: none). */
  permissionHours: number;
  /**
   * Its check-in → check-out pairs when Zoho gave each one (its API, 25 October 2026: "fetch checkin and out
   * transactions from zoho people"): the hours are theirs (owner, 25 October 2026: "the working hours to be calculated
   * between the checkin and out only, not the first and last"); none (the Excel export's first and last): from
   * check-in to check-out as before.
   */
  pairs?: PressPair[] | null;
}

/**
 * What a day is, by the owner's rules (19 October 2026): worked (a check-in), absent (a working day with none), a rest
 * day, an official holiday, leave in the system, leave in Zoho not in the system (not absent; for HR to record), or no
 * check-in on a day Zoho says present or on duty (not absent; for HR to check).
 */
export const ATTENDANCE_DAY_STATUSES = ['worked', 'absent', 'rest', 'holiday', 'leave', 'zoho_leave', 'no_check_in'] as const;
export type AttendanceDayStatus = (typeof ATTENDANCE_DAY_STATUSES)[number];

export const ATTENDANCE_DAY_STATUS_LABELS: Record<AttendanceDayStatus, string> = {
  worked: 'Worked',
  absent: 'Absent',
  rest: 'Rest day',
  holiday: 'Official holiday',
  leave: 'On leave',
  zoho_leave: 'Leave in Zoho only',
  no_check_in: 'No check-in, not absent',
};

/** A day worked out: its status and the hours it counts. */
export interface AttendanceDayResult extends ImportedDay {
  status: AttendanceDayStatus;
  hoursCounted: number;
}

/** What a person's month is worked out from. */
export interface AttendanceMonthInput {
  /** YYYY-MM. */
  month: string;
  days: readonly ImportedDay[];
  /**
   * Their employment's shift: its window, hours to work, grace minutes (the window's end moves by them), the time it
   * counts hours until (20 October 2026; none: its end and grace) and working days; null without one.
   */
  shift: (ShiftTimes & { workingDays: readonly number[]; graceMinutes?: number | null; countUntil?: string | null }) | null;
  /** The official holidays of the month (YYYY-MM-DD). */
  holidays: readonly string[];
  /** The days of the month they have approved leave in the system (YYYY-MM-DD). */
  leaveDays: readonly string[];
  /** Their employment's first day, and its last (null: current). */
  employedFrom: string;
  employedTo: string | null;
  /** The approved permission hours in the system this month (0: none). */
  systemPermissionHours: number;
  /** The Leave Setup's permission hours a month. */
  permissionHoursPerMonth: number;
}

/** A person's month as the review shows it and the run's line takes it. */
export interface AttendanceMonthResult {
  /** Their days within the month and the employment, in date order. */
  days: AttendanceDayResult[];
  daysWorked: number;
  officeDays: number;
  remoteDays: number;
  /** The hours counted, by the shift's rule, to the minute. */
  hoursCounted: number;
  /** Whole absent days: the run's no-show days. */
  absentDays: number;
  /**
   * The permission hours the line takes: null when the system's approved permission requests count (the line has them
   * already) or there are none; else Zoho's, within the month's allowance.
   */
  permissionHours: number | null;
  /** Where the month's permission hours come from: the system's requests, Zoho's column, or none. */
  permissionFrom: 'system' | 'zoho' | null;
  /** Days Zoho marks as leave that have no leave in the system: listed for HR to record there. */
  zohoLeaveDays: string[];
  /** Working days of the month in the employment that have no row in the files. */
  missingDays: string[];
  /** Rows outside the month (another month's): left out. */
  outside: number;
  /** Plain-English notes for HR. */
  warnings: string[];
}

/** The 7 weekdays from a Date's UTC day: 0 = Sunday … 6 = Saturday. */
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const minutes = (hours: number) => Math.round(hours * 60) / 60;
const halfHours = (n: number) => Math.round(n * 2) / 2 + 0;
const SUN_TO_THU = [0, 1, 2, 3, 4];

/**
 * A person's month from their imported days (owner, 19 October 2026): each day of the month within the employment
 * worked out (a check-in: worked, its hours by the shift's rule; none: a holiday, a rest day, leave in the system, leave
 * in Zoho, "no check-in" on a day Zoho says present, else absent), and what the run's line takes: the hours counted,
 * the absent days, and the permission hours (the system's requests, else Zoho's within the allowance).
 */
export function attendanceMonth(input: AttendanceMonthInput): AttendanceMonthResult {
  const { month, shift } = input;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const from = input.employedFrom > `${month}-01` ? input.employedFrom : `${month}-01`;
  const to = input.employedTo !== null && input.employedTo < last ? input.employedTo : last;
  const working = new Set(shift?.workingDays ?? SUN_TO_THU);
  const holidays = new Set(input.holidays);
  const leave = new Set(input.leaveDays);
  // a day's cap: the hours to work, none on a shift counting until a time (20 October 2026)
  const most = shift ? mostHoursCountedADay(shift) : null;
  const warnings: string[] = [];
  if (!shift) warnings.push('No shift on the employment: the hours are counted from check-in to check-out, Sunday to Thursday taken as the working days.');

  // the same day twice (two files, or Zoho's twice): the later one kept
  const byDate = new Map<string, ImportedDay>();
  let outside = 0;
  for (const d of input.days) {
    if (d.date.slice(0, 7) !== month) {
      outside++;
      continue;
    }
    if (d.date < from || d.date > to) continue;
    byDate.set(d.date, d);
  }
  if (outside) warnings.push(`${outside} ${outside === 1 ? 'day is' : 'days are'} of another month than this payroll's: left out.`);

  const days: AttendanceDayResult[] = [];
  let noCheckOut = 0;
  for (const d of [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    let status: AttendanceDayStatus;
    let hours = 0;
    if (d.checkIn) {
      status = 'worked';
      const window = shift ? shiftWindowOn(d.date, shift) : null;
      // by its pairs when Zoho gave them (its API), each within the window, together at most the hours to work
      if (d.pairs?.length) hours = spanHours(spansOfPairs(d.pairs), window, most);
      else if (d.checkOut && !d.pairs) hours = hoursCountedForDay(d.checkIn, d.checkOut, most, window);
      else noCheckOut++;
    } else if (holidays.has(d.date)) status = 'holiday';
    else if (!working.has(weekdayOf(d.date))) status = 'rest';
    else if (leave.has(d.date)) status = 'leave';
    else {
      const kind = zohoStatusKind(d.zohoStatus);
      status = kind === 'leave' ? 'zoho_leave' : kind === 'present' ? 'no_check_in' : 'absent';
    }
    days.push({ ...d, status, hoursCounted: minutes(hours) });
  }
  if (noCheckOut) warnings.push(`${noCheckOut} ${noCheckOut === 1 ? 'day has' : 'days have'} a check-in without a check-out: no hours counted for ${noCheckOut === 1 ? 'it' : 'them'}.`);
  const unchecked = days.filter((d) => d.status === 'no_check_in').length;
  if (unchecked) warnings.push(`${unchecked} ${unchecked === 1 ? 'day' : 'days'} Zoho says present or on duty without a check-in: not counted as absent, nor any hours.`);

  // the working days with no row at all: not absent (the files may not cover them), said
  const missingDays: string[] = [];
  for (let day = from; day <= to; day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
    if (!byDate.has(day) && working.has(weekdayOf(day)) && !holidays.has(day) && !leave.has(day)) missingDays.push(day);
  }
  if (missingDays.length) warnings.push(`${missingDays.length} working ${missingDays.length === 1 ? 'day has' : 'days have'} no row in the files: not counted as absent.`);

  const worked = days.filter((d) => d.status === 'worked');
  const zohoPermission = halfHoursOrMinutes(days.reduce((sum, d) => sum + (d.permissionHours > 0 ? d.permissionHours : 0), 0));
  const fromSystem = input.systemPermissionHours > 0;
  const permissionHours = fromSystem || zohoPermission <= 0 ? null : Math.min(zohoPermission, Math.max(0, input.permissionHoursPerMonth));
  if (!fromSystem && zohoPermission > input.permissionHoursPerMonth) {
    warnings.push(`Zoho has ${clock(zohoPermission)} of permission this month: ${clock(Math.max(0, input.permissionHoursPerMonth))} counted, the month's allowance.`);
  }
  if (fromSystem && zohoPermission > 0) warnings.push("The permission requests approved in the system count this month, not Zoho's permission column.");
  return {
    days,
    daysWorked: worked.length,
    officeDays: worked.filter((d) => d.place === 'office').length,
    remoteDays: worked.filter((d) => d.place === 'remote').length,
    hoursCounted: minutes(worked.reduce((sum, d) => sum + d.hoursCounted, 0)),
    absentDays: days.filter((d) => d.status === 'absent').length,
    permissionHours: permissionHours !== null && permissionHours > 0 ? permissionHours : null,
    permissionFrom: fromSystem ? 'system' : permissionHours !== null && permissionHours > 0 ? 'zoho' : null,
    zohoLeaveDays: days.filter((d) => d.status === 'zoho_leave').map((d) => d.date),
    missingDays,
    outside,
    warnings,
  };
}

/** Zoho's permission minutes as hours, to the minute (its column isn't in half hours). */
const halfHoursOrMinutes = (n: number) => (Math.abs(n * 2 - Math.round(n * 2)) < 1e-9 ? halfHours(n) : minutes(n));

/** 4 → "4:00". */
function clock(hours: number): string {
  const m = Math.round(hours * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

// ---------- the run's lines ----------

/** The inputs an import fills on a payroll line (owner's brief, 19 October 2026): worked hours, no-show days, permission hours. */
export const IMPORTED_INPUTS = ['workedHours', 'noShowDays', 'permissionHours'] as const;
export type ImportedInput = (typeof IMPORTED_INPUTS)[number];

/** The inputs as the screens and messages name them. */
export const IMPORTED_INPUT_LABELS: Record<ImportedInput, string> = {
  workedHours: 'Worked hours',
  noShowDays: 'No-show days',
  permissionHours: 'Permission hours',
};

/**
 * What a payroll line keeps of the import that filled it, for the grid to show those inputs "from Zoho" and keep them
 * from being typed over (owner, 19 October 2026: "imported data shouldn't be editable"): the import, when it was applied,
 * the inputs it filled, and what they were before (`before`: HR's typed figures, none when empty or filled by an earlier
 * import), which Undo this import puts back. A mark from before Undo has no `before`: undone, those inputs are emptied.
 */
export interface AttendanceImportMark {
  /**
   * 'zoho': filled by a Zoho import (importId); 'attendance': filled from the month's attendance days (owner's brief, 19
   * October 2026: "a draft run's lines are filled from the month's attendance days … marked 'from attendance', read-only
   * like the Zoho cells"), for someone who checks in on the system or whose day was corrected (`sources`: the days'
   * sources).
   */
  source: 'zoho' | 'attendance';
  /** The Zoho import, for 'zoho'. */
  importId?: string;
  at: string;
  fields: ImportedInput[];
  before?: Partial<Record<ImportedInput, number | null>>;
  /** The sources of the days an 'attendance' fill took (check-in.ts ATTENDANCE_SOURCES). */
  sources?: string[];
  /**
   * The days an 'attendance' fill counted as half a day for an open check-in (owner, 27 October 2026: "open check ins
   * with half day"; openCheckInDates), YYYY-MM-DD in date order: the line's warning lists them (payroll.ts
   * openCheckInWarning) and Send to the CEO asks about them, until they are corrected and the line filled again. Missing
   * when none.
   */
  openCheckIns?: string[];
}

/**
 * What the inputs a new import fills were before it (`before` of its mark): those an earlier import filled keep what
 * they were before that one (its own `before`), so undoing either never brings back a figure from Zoho as if HR typed
 * it; the others are what the line has (HR's typed figures, or none).
 */
export function figuresBefore(
  fields: readonly ImportedInput[],
  inputs: Partial<Record<ImportedInput, number | null | undefined>>,
  earlier: AttendanceImportMark | null | undefined,
): Partial<Record<ImportedInput, number | null>> {
  const out: Partial<Record<ImportedInput, number | null>> = {};
  for (const f of fields) out[f] = earlier?.fields.includes(f) ? (earlier.before?.[f] ?? null) : (inputs[f] ?? null);
  return out;
}

/**
 * The imported inputs a change would alter (owner, 19 October 2026: "imported data shouldn't be editable"): those
 * among `changed` (the inputs whose value changes) that the line's mark holds. None: the change may go ahead.
 */
export function importedInputsChanged(mark: Pick<AttendanceImportMark, 'fields'> | null | undefined, changed: readonly string[]): ImportedInput[] {
  if (!mark) return [];
  return mark.fields.filter((f) => changed.includes(f));
}

const CAIRO_DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * Why an imported input can't be typed over (409): "Worked hours for Rania Girgis came from the Zoho import of
 * 19/10/2026: import the month again to change them, or undo that import on its review." `at`: when it was applied.
 */
export function importedInputRefusal(field: ImportedInput, name: string, at: string, source: AttendanceImportMark['source'] = 'zoho'): string {
  const moment = new Date(at);
  const day = Number.isNaN(moment.getTime()) ? at : CAIRO_DAY.format(moment);
  if (source === 'attendance') {
    return `${IMPORTED_INPUT_LABELS[field]} for ${name} come from the attendance days (filled ${day}): they change with the attendance itself, by a correction approved or Refresh from attendance.`;
  }
  return `${IMPORTED_INPUT_LABELS[field]} for ${name} came from the Zoho import of ${day}: import the month again to change them, or undo that import on its review.`;
}

/**
 * A day as a line's figures are taken from it: what it was, the hours it counts, its permission and source; and (since
 * 25 October 2026) its presses as far as a missing check-out is told from them.
 */
export interface LineDay extends Partial<Pick<KeptDay, 'checkIn' | 'checkOut' | 'openAt' | 'od' | 'exempt' | 'compensated'>> {
  status: AttendanceDayStatus;
  hoursCounted: number;
  permissionHours: number;
  source?: string;
}

/** A day's presses as the half-day rule reads them (attendance-days.ts openHalfDayOn). */
const pressesOf = (d: LineDay) => ({ status: d.status, checkIn: d.checkIn ?? null, checkOut: d.checkOut ?? null, openAt: d.openAt ?? null, od: d.od ?? null, exempt: d.exempt, source: d.source });

/**
 * The hours a day gives a payroll line: the hours it counts; a day on the system's own attendance (not Zoho's) missing
 * its check-out counts its closed pairs' hours plus half the shift's hours a day (`hoursADay`), never more than the
 * shift's hours a day, until it is corrected (owner, 27 October 2026: "open check ins with half day"; asked, "Half the
 * shift (4.5 h) until corrected"; attendance-days.ts openCheckInHours, as the Attendance pages show the day); without
 * the shift's hours (pay by the hour too), its pairs' hours alone. Until then such a day counted the whole shift (25
 * October 2026: "Not short until corrected").
 */
export function lineDayHours(d: LineDay, hoursADay: number | null | undefined): number {
  const hours = d.hoursCounted > 0 ? d.hoursCounted : 0;
  return openHalfDayOn(pressesOf(d)) ? openCheckInHours(hours, hoursADay) : hours;
}

/**
 * The dates (YYYY-MM-DD, in date order) of the days a monthly-paid line counts as half a day for an open check-in
 * (lineDayHours; owner, 27 October 2026): what its warning lists and Send to the CEO asks about. None by the hour (only
 * the pairs' hours are paid), without the shift's hours a day, or for a day whose hours the month leaves out (one
 * compensated).
 */
export function openCheckInDates(days: readonly (LineDay & { date: string })[], opts: { hourly: boolean; hoursADay?: number | null }): string[] {
  if (opts.hourly || typeof opts.hoursADay !== 'number' || !(opts.hoursADay > 0)) return [];
  return days
    .filter((d) => !d.compensated && openHalfDayOn(pressesOf(d)))
    .map((d) => d.date)
    .sort();
}

/**
 * What a payroll line takes from a month's attendance days (owner's brief, 19 October 2026: "a draft run's lines are
 * filled from the month's attendance days (source 'system' first; for a person with none, the Zoho days if imported)"):
 * the hours counted (to the minute), the absent days as no-show days, and the permission hours: none when the system's
 * approved permission requests count (`systemPermissionHours` > 0: the line has them from its terms) or there are none,
 * else Zoho's column of its days within the month's allowance, as an import fills them. Pay by the hour: the hours only.
 * A day on the system missing its check-out counts its pairs' hours and half the shift's hours a day (`hoursADay`),
 * within the shift's hours a day, until corrected (lineDayHours; owner, 27 October 2026: "open check ins with half
 * day"), on a monthly salary: paid by the hour, only the hours its closed pairs counted are paid (no time is paid that no
 * press shows). An exempt day counts its full hours already (check-in-exemptions.ts).
 */
export function attendanceLineInputs(
  days: readonly LineDay[],
  opts: { systemPermissionHours: number; permissionHoursPerMonth: number; hourly: boolean; hoursADay?: number | null },
): Partial<Record<ImportedInput, number | null>> {
  // the day worked of a compensatory request adds no hours (owner, 26 October 2026: "if the day is compensated with a day, we pay nothing")
  const worked = days.filter((d) => d.status === 'worked' && !d.compensated);
  const workedHours = minutes(worked.reduce((sum, d) => sum + lineDayHours(d, opts.hourly ? null : opts.hoursADay), 0));
  if (opts.hourly) return { workedHours };
  // Zoho's column: its days', and a corrected day's over one of Zoho's (which carries it)
  const zoho = halfHoursOrMinutes(days.filter((d) => ['zoho', 'correction'].includes(d.source ?? 'zoho')).reduce((sum, d) => sum + (d.permissionHours > 0 ? d.permissionHours : 0), 0));
  const permission = opts.systemPermissionHours > 0 || zoho <= 0 ? null : Math.min(zoho, Math.max(0, opts.permissionHoursPerMonth));
  return { workedHours, noShowDays: days.filter((d) => d.status === 'absent').length, permissionHours: permission !== null && permission > 0 ? permission : null };
}
