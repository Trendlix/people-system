import { ATTENDANCE_DAY_STATUS_LABELS, formatHours, WORK_PLACE_LABELS, type AttendanceDayStatus, type AttendanceMonthResult, type WorkPlace } from '@trendlix/shared';
import type { AttendanceImportFile, AttendanceImportView, AttendancePersonView, PersonMatch } from '../../../../../lib/attendance-types';
import { formatTime } from '../../../../../lib/format';
import { monthName } from '../../list';

// Importing attendance from Zoho People on a draft payroll run (owner, 19 October 2026: attendance runs in Zoho People
// today, "Import Zoho now, replace it later"): HR uploads Zoho's attendance entries (one file with everyone, or many at
// once), reviews who each person is and their month by the system's rules, confirms a close name ("Did you mean …?"),
// picks someone not found or skips them, and applies it: the lines' worked hours, no-show days (the absent ones) and
// permission hours are filled from Zoho, what was typed on them replaced. A day Zoho marks as leave without leave in the
// system is listed for HR to record in the system (owner: "In the system, stop it in Zoho"). The C-level people's lines
// are the CEO's to fill (owner, 19 October 2026). The API decides all of it; these helpers word what it sent and group the
// review. Pure code, tested; relative imports, as vitest doesn't know the "@/" paths.

/** The upload page of a run, and an import's review. */
export const attendanceUploadHref = (runId: string) => `/payroll/${encodeURIComponent(runId)}/attendance`;
export const attendanceReviewHref = (runId: string, importId: string) => `${attendanceUploadHref(runId)}/${encodeURIComponent(importId)}`;

/** The API's addresses for a run's imports. */
export const importsPath = (runId: string) => `/payroll/runs/${encodeURIComponent(runId)}/attendance-imports`;
export const importPath = (runId: string, importId: string) => `${importsPath(runId)}/${encodeURIComponent(importId)}`;

/** The API's limits (the owner's brief: files of 5 MB each, up to 60), and what one upload through the web can carry. */
export const ZOHO_MAX_FILES = 60;
export const ZOHO_MAX_MB = 5;
/**
 * One upload carries at most this much: the web app's limit on a form's files (next.config.ts, 25 MB with the form's own
 * bytes). Zoho's exports are a few dozen kilobytes a person, so 60 of them fit many times over.
 */
export const UPLOAD_MAX_MB = 24;
export const UPLOAD_ACCEPT = '.xlsx';

/** What the form says of the chosen files before sending them; none: they can go. */
export function uploadProblems(files: readonly Pick<File, 'name' | 'size'>[]): string[] {
  if (!files.length) return ['Choose the attendance entries exported from Zoho People: one file with everyone, or a file per person (.xlsx).'];
  const problems: string[] = [];
  if (files.length > ZOHO_MAX_FILES) problems.push(`Upload at most ${ZOHO_MAX_FILES} files at once.`);
  for (const f of files) {
    if (!/\.xlsx$/i.test(f.name.trim())) problems.push(`${f.name} isn't an Excel workbook (.xlsx): export the attendance entries from Zoho People as XLSX.`);
    else if (f.size > ZOHO_MAX_MB * 1024 * 1024) problems.push(`${f.name} is larger than ${ZOHO_MAX_MB} MB.`);
  }
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (!problems.length && total > UPLOAD_MAX_MB * 1024 * 1024) problems.push(`These files come to more than ${UPLOAD_MAX_MB} MB together: upload them in two or more goes.`);
  return problems;
}

/**
 * What the review says of a file whose days aren't only of the run's month (owner's brief, 19 October 2026: month
 * mismatches warned): those of another month are left out; null for a file of the month alone.
 */
export function fileMonthsNote(file: Pick<AttendanceImportFile, 'months'>, runMonth: string): string | null {
  const others = file.months.filter((m) => m !== runMonth);
  if (!others.length) return null;
  const names = others.map(monthName).join(', ');
  return file.months.includes(runMonth) ? `Also has days of ${names}: left out.` : `Has days of ${names} only, none of ${monthName(runMonth)}: nothing from it counts.`;
}

/** Matched: by their Zoho ID, by name, or by HR. */
export const isMatched = (m: PersonMatch) => m === 'linked' || m === 'exact' || m === 'confirmed';

/** How someone was matched, in words. */
export const MATCH_TEXT: Record<PersonMatch, string> = {
  linked: 'By their Zoho ID',
  exact: 'By name',
  confirmed: 'Chosen by HR',
  close: 'Did you mean …?',
  none: 'Not found',
  skipped: 'Skipped',
};

/** The review's sections, in order: those to confirm, those not found, those matched, those skipped. */
export interface ReviewSections {
  toConfirm: AttendancePersonView[];
  notFound: AttendancePersonView[];
  matched: AttendancePersonView[];
  skipped: AttendancePersonView[];
}

const byName = (a: AttendancePersonView, b: AttendancePersonView) => a.zohoName.localeCompare(b.zohoName);

export function reviewSections(people: readonly AttendancePersonView[]): ReviewSections {
  return {
    toConfirm: people.filter((p) => p.match === 'close').sort(byName),
    notFound: people.filter((p) => p.match === 'none').sort(byName),
    matched: people.filter((p) => isMatched(p.match)).sort((a, b) => (a.employee?.fullNameEn ?? a.zohoName).localeCompare(b.employee?.fullNameEn ?? b.zohoName)),
    skipped: people.filter((p) => p.match === 'skipped').sort(byName),
  };
}

/** Whose lines Apply fills: matched (not twice), on the run, and the user's to fill. */
export const applicable = (people: readonly AttendancePersonView[]) => people.filter((p) => isMatched(p.match) && !p.duplicate && p.lineId !== null && p.editable && p.month !== null);

/** The confirmation Apply asks first. */
export function applyConfirmText(view: Pick<AttendanceImportView, 'people'>): string {
  const n = applicable(view.people).length;
  return `Fill the worked hours, no-show days and permission hours of ${n} ${n === 1 ? 'line' : 'lines'} from Zoho People? What was typed on ${n === 1 ? 'that line' : 'those lines'} is replaced.`;
}

/** Why someone matched isn't filled by Apply, when they aren't: null when they are. */
export function notAppliedReason(p: AttendancePersonView, hr: boolean): string | null {
  if (!isMatched(p.match)) return null;
  if (p.duplicate) return 'Matched twice: choose who is who before applying.';
  if (!p.lineId) return 'Not on this payroll: refresh the payroll once their contract is signed.';
  if (!p.editable) return p.confidential && hr ? 'C-level: the CEO fills their line.' : "Not yours to fill: HR fills this line, the CEO the C-level people's.";
  return null;
}

/** Where the month's permission hours come from, in words. */
export function permissionText(m: Pick<AttendanceMonthResult, 'permissionHours' | 'permissionFrom'>): string {
  if (m.permissionFrom === 'system') return "The requests approved in the system (the line has them)";
  if (m.permissionFrom === 'zoho' && m.permissionHours !== null) return `${formatHours(m.permissionHours)} from Zoho`;
  return 'None';
}

/** The count chips over the review: each with its number, in the sections' order. */
export function countChips(view: Pick<AttendanceImportView, 'counts' | 'hidden'>): { key: string; label: string; count: number }[] {
  const c = view.counts;
  return [
    { key: 'matched', label: 'Matched', count: c.matched + (view.hidden?.count ?? 0) },
    { key: 'confirm', label: 'To confirm', count: c.toConfirm },
    { key: 'none', label: 'Not found', count: c.notFound },
    { key: 'skipped', label: 'Skipped', count: c.skipped },
    { key: 'off', label: 'Not on this payroll', count: c.notOnRun },
  ];
}

const CAIRO_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** A moment's time in Cairo, 12-hour as the screens show it: "10:23 AM". */
export const cairoTime = (iso: string | null) => (iso ? formatTime(CAIRO_TIME.format(new Date(iso))) : '');

/** A day's check-in to check-out: "10:23 AM – 6:31 PM", "10:23 AM – no check-out", or "No check-in". */
export function checkTimesText(d: { checkIn: string | null; checkOut: string | null }): string {
  if (!d.checkIn) return 'No check-in';
  return `${cairoTime(d.checkIn)} – ${d.checkOut ? cairoTime(d.checkOut) : 'no check-out'}`;
}

export const dayStatusText = (status: AttendanceDayStatus) => ATTENDANCE_DAY_STATUS_LABELS[status] ?? status;
export const placeText = (place: WorkPlace | null) => (place ? WORK_PLACE_LABELS[place] : '—');

/** "3 days", "1 day". */
export const daysCount = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** A day's tone on the review's day list: absent in red, leave in Zoho only in amber, the others plain. */
export function dayTone(status: AttendanceDayStatus): 'danger' | 'warn' | null {
  if (status === 'absent') return 'danger';
  if (status === 'zoho_leave' || status === 'no_check_in') return 'warn';
  return null;
}

/** The PATCH a person's choice sends: an employee (confirm or pick), back to by name, or skip. */
export type PersonChoice = { key: string; employeeId: string } | { key: string; employeeId: null; skipped: false } | { key: string; skipped: true };

/** The choice a form sends, read: `employeeId` (a uuid), or `skip`, or `undo`; null for anything else. */
export function personChoice(fd: FormData): PersonChoice | null {
  const key = String(fd.get('key') ?? '');
  if (!key) return null;
  const choice = String(fd.get('choice') ?? '');
  if (choice === 'skip') return { key, skipped: true };
  if (choice === 'undo') return { key, employeeId: null, skipped: false };
  const employeeId = String(fd.get('employeeId') ?? '');
  return /^[0-9a-f-]{36}$/i.test(employeeId) ? { key, employeeId } : null;
}
