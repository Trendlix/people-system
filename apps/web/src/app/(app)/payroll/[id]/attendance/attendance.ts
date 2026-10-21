import {
  ATTENDANCE_DAY_STATUS_LABELS,
  CHECK_IN_PLACE_LABELS,
  formatHours,
  WORK_PLACE_LABELS,
  type AttendanceDayStatus,
  type AttendanceMonthResult,
  type DayPlace,
  type PayrollStatus,
  type Role,
} from '@trendlix/shared';
import type { AttendanceImportFile, AttendanceImportKept, AttendanceImportView, AttendancePersonView, PersonMatch } from '../../../../../lib/attendance-types';
import { formatTime } from '../../../../../lib/format';
import { hasRole } from '../../../../../lib/roles';
import { monthName } from '../../list';

// Importing attendance from Zoho People on a draft payroll run (owner, 19 October 2026: attendance runs in Zoho People
// today, "Import Zoho now, replace it later"): HR uploads Zoho's attendance entries (one file with everyone, or many at
// once), reviews who each person is and their month by the system's rules, confirms a close name ("Did you mean …?"),
// picks someone not found or skips them, and applies it: the lines' worked hours, no-show days (the absent ones) and
// permission hours are filled from Zoho, what was typed on them replaced. A day Zoho marks as leave without leave in the
// system is listed for HR to record in the system (owner: "In the system, stop it in Zoho"). The C-level people's lines
// are the CEO's to fill (owner, 19 October 2026). The API decides all of it; these helpers word what it sent and group the
// review. Pure code, tested; relative imports, as vitest doesn't know the "@/" paths.

/**
 * Who presses Refresh from attendance (owner, 19 October 2026: "Check-in through the system (phone or web with the office
 * location check, or a device) to replace Zoho"): HR and the CEO, on a draft (the API refuses any other run).
 */
export const refreshesFromAttendance = (user: { roles: readonly Role[] }, status: PayrollStatus): boolean => status === 'draft' && hasRole(user, 'hr', 'ceo');

/** What Refresh from attendance does, said beside it. */
export const REFRESH_FROM_ATTENDANCE_HINT =
  "Fills the worked hours, no-show days and permission hours again from the month's attendance days, for those who check in on the system or whose days were corrected. Each check-in and each correction approved does it by itself; refresh after a shift, a leave or a holiday changes.";

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

/** The confirmation Undo this import asks first. */
export function undoConfirmText(view: Pick<AttendanceImportView, 'undoable'>): string {
  const n = view.undoable ?? 0;
  return `Undo this import on ${n} ${n === 1 ? 'line' : 'lines'}? The worked hours, no-show days and permission hours go back to what was typed before it was applied (empty if nothing was), and the days it kept are removed.`;
}

// ---------- deleting an import (asked, 21 October 2026: "how to delete previous imports"; a Super Admin only, like
// every deletion: owner's decision, 15 October 2026) ----------

/** An import as Delete words it: its month, its files, whether it is applied and what of it is still on its run. */
export interface ImportToDelete {
  month: string;
  files: readonly { name: string }[];
  appliedAt: string | null;
  /** Left out by an API from before Delete: applied then means undone first. */
  kept?: AttendanceImportKept | null;
}

/** Whether Delete undoes the import first: a line of its run still filled from it, or a day still kept from it. */
export const undoesBeforeDelete = (i: Pick<ImportToDelete, 'appliedAt' | 'kept'>): boolean => (i.kept ? i.kept.lines > 0 || i.kept.days > 0 : i.appliedAt !== null);

/** The button: Delete, or Undo and delete for an import applied. */
export const deleteImportLabel = (i: Pick<ImportToDelete, 'appliedAt' | 'kept'>): string => (undoesBeforeDelete(i) ? 'Undo and delete' : 'Delete');

/** The API's address: `?undo=1` to undo it first (the API refuses an applied import without it). */
export const deleteImportPath = (runId: string, importId: string, undo: boolean) => `${importPath(runId, importId)}${undo ? '?undo=1' : ''}`;

const filesText = (files: readonly { name: string }[]) => (files.length === 1 ? files[0].name : `${files.length} files`);

/** The confirmation Delete asks first, saying what happens to the payroll. */
export function deleteImportConfirmText(i: ImportToDelete): string {
  const what = `the ${monthName(i.month)} import (${filesText(i.files)})`;
  if (!undoesBeforeDelete(i)) return `Delete ${what}? It isn't applied, so nothing on the payroll changes. This can't be undone.`;
  const k = i.kept;
  const parts: string[] = [];
  if (!k || k.lines) {
    const lines = !k ? 'The lines it filled, whoever fills them, go' : k.lines === 1 ? 'The line it filled, whoever fills it, goes' : `The ${k.lines} lines it filled, whoever fills them, go`;
    parts.push(`${lines} back to the worked hours, no-show days and permission hours typed before it (empty if none were).`);
  }
  if (!k || k.days) {
    const days = !k ? 'The days' : k.days === 1 ? 'The day' : `The ${k.days} days`;
    parts.push(`${days} of attendance it kept ${k?.days === 1 ? 'is' : 'are'} removed, and the lines filled from the attendance days are filled again without them.`);
  }
  return `Undo and delete ${what}? ${parts.join(' ')} Then the import is deleted. This can't be undone.`;
}

/** Why an import can't be deleted now (the API refuses it): its payroll isn't a draft any more. Null on a draft. */
export const deleteImportBlocked = (status: PayrollStatus): string | null => (status === 'draft' ? null : "Kept: its payroll isn't a draft any more.");

/**
 * What the review says of someone who checks in on the system this month (owner, 19 October 2026: "Check-in through the
 * system (phone or web with the office location check, or a device) to replace Zoho"): applying keeps their Zoho days,
 * counted before their first check-in, and their line is filled from their attendance days instead of Zoho's month.
 */
export const CHECKS_IN_NOTE = "Checks in on the system this month: Zoho's days count before their first check-in, and their line is filled from their attendance days.";

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
/**
 * Where a day was worked: the office, remote, or (a check-in on the system, 19 October 2026) location unknown, or home
 * (the person's approved home, 20 October 2026: "Label Home, flag elsewhere").
 */
export const placeText = (place: DayPlace | null | undefined) =>
  !place ? '—' : place === 'unknown' || place === 'home' ? CHECK_IN_PLACE_LABELS[place] : (WORK_PLACE_LABELS[place] ?? place);

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
