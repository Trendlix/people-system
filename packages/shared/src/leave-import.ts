// Importing leave in bulk (owner, 21 October 2026: "how to import bulk leaves?"; asked, he chose "Both": the leave already
// taken, recorded as approved, and each person's current balance, so the system starts from the right numbers; and "Our
// Excel template": the system gives a template, HR fills it and uploads it). Zoho People's leave export is read as it is
// too (the owner's sample, 21 October 2026: its leave types mapped once each on the review, its pending leave carried on as
// requests in the system's own approval, its rejected and cancelled leave listed and not imported), and "while importing
// make sure there will be no duplicates from the previous imported files" (owner, 21 October 2026): a Zoho row's link id
// is kept on the leave it makes, a leave already in the system or imported before is a duplicate, the same file uploaded
// again is said and all its rows are duplicates, and a balance already at its figure changes nothing. These are the pure
// rules: reading a cell's text, the Zoho export's own columns, matching people, the checks of a row and the words the
// review says. The API reads the workbook and applies; the web app shows the review.

import { decidesConfidentialStage } from './confidential.js';
import { matchPerson, nameKey, type MatchCandidate } from './attendance-import.js';
import { takesFromAnnual, type LeaveGender, type LeaveTypeRules } from './leaves.js';
import type { Role } from './index.js';

// ---------- the file ----------

/** Where a file comes from: the system's template, or Zoho People's leave export (told by its headings). */
export const LEAVE_IMPORT_SOURCES = ['template', 'zoho'] as const;
export type LeaveImportSource = (typeof LEAVE_IMPORT_SOURCES)[number];

export const LEAVE_IMPORT_SOURCE_LABELS: Record<LeaveImportSource, string> = {
  template: 'The leave import template',
  zoho: 'Zoho People leave export',
};

/** The template's sheets, by the names the brief gave them. */
export const LEAVE_IMPORT_SHEETS = { leaves: 'Leaves taken', balances: 'Balances', help: 'How to fill' } as const;

/** The template's columns on Leaves taken, in order. Employee name is for reading; Days may be left empty. */
export const LEAVE_IMPORT_LEAVE_HEADINGS = ['Employee code', 'Employee name', 'Leave type', 'From', 'To', 'Days', 'Notes'] as const;

/** The template's columns on Balances, in order. */
export const LEAVE_IMPORT_BALANCE_HEADINGS = ['Employee code', 'Employee name', 'Leave type', 'Balance in days', 'As of'] as const;

/** The largest file, and the most rows a file may have (a few years of a few hundred people's leave). */
export const LEAVE_IMPORT_MAX_MB = 5;
export const LEAVE_IMPORT_MAX_ROWS = 5000;

/** The template's rows given a formula and a list to choose from (filled rows beyond them are read all the same). */
export const LEAVE_IMPORT_TEMPLATE_ROWS = 500;

/** A heading as it is compared: its letters and digits, lower case ("Days/Hours Taken" → "dayshourstaken"). */
export const headingKey = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Zoho People's leave export, by the headings of its columns (as headingKey has them). */
export const ZOHO_LEAVE_COLUMNS = {
  linkId: ['zoholinkid'],
  employee: ['employeeid', 'employee', 'employeename'],
  type: ['leavetype'],
  from: ['from', 'fromdate'],
  to: ['to', 'todate'],
  days: ['dayshourstaken', 'daystaken', 'days'],
  reason: ['reasonforleave', 'reason'],
  unit: ['unit'],
  status: ['approvalstatus'],
  details: ['datedurationandsession'],
} as const;

export type ZohoLeaveColumn = keyof typeof ZOHO_LEAVE_COLUMNS;

/** Whether a row of headings is Zoho People's leave export: its Leave type and Approval Status, and its link id or day details. */
export function isZohoLeaveHeadings(headings: readonly string[]): boolean {
  const keys = new Set(headings.map(headingKey));
  return keys.has('leavetype') && keys.has('approvalstatus') && (keys.has('zoholinkid') || keys.has('datedurationandsession'));
}

// ---------- a cell's text ----------

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number | string) => String(n).padStart(2, '0');

/** Western digits for Arabic-Indic and Persian ones. */
export const westernDigits = (text: string): string => text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** A real day as YYYY-MM-DD, or null. */
function realDay(y: number, m: number, d: number): string | null {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/**
 * A day typed as text: DD/MM/YYYY (as the screens show dates), YYYY-MM-DD, or Zoho's 21-Oct-2026; "-" and "." too,
 * Arabic digits too, a time after it left out. Null when it isn't a real day.
 */
export function importDate(text: string): string | null {
  const t = westernDigits(text).trim().replace(/[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?: ?[AaPp][Mm])?Z?$/, '');
  let m = /^(\d{1,2})[-\s/.]([A-Za-z]{3,4})[-\s/.,]+(\d{4})$/.exec(t);
  if (m) return MONTHS[m[2].toLowerCase()] ? realDay(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])) : null;
  m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) return realDay(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return realDay(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/** A number typed as text ("1.0 ", "7,5", "٢"), or null. */
export function importNumber(text: string): number | null {
  const t = westernDigits(text).trim().replace(/,/g, '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Whole or half days. */
export const isHalfDays = (n: number): boolean => Number.isFinite(n) && Math.abs(n * 2 - Math.round(n * 2)) < 1e-9;

// ---------- Zoho People's leave export ----------

/**
 * Zoho's Employee ID cell, "<name> <Zoho number>": the name, and the number when it ends the cell (the Zoho Employee Id,
 * as attendance imports remember it). A cell where text follows the number ("<name> 10023 - …") has none of its own:
 * its person is matched by name, the number kept as a hint.
 */
export function zohoEmployee(text: string): { name: string; zohoId: string | null; hint: string | null } {
  const t = westernDigits(text).replace(/\s+/g, ' ').trim();
  const trailing = /^(.*?)\s+(\d{1,10})$/.exec(t);
  if (trailing && trailing[1].trim()) return { name: trailing[1].trim(), zohoId: trailing[2], hint: null };
  const inner = /^(.*?)\s+(\d{1,10})\s*-\s*.*$/.exec(t);
  if (inner && inner[1].trim()) return { name: inner[1].trim(), zohoId: null, hint: inner[2] };
  return { name: t, zohoId: null, hint: null };
}

/** What Zoho says of a day of a leave: a full day, a half (first or second), or a holiday or weekend (not counted). */
export type ZohoDayKind = 'full' | 'half' | 'off';

export interface ZohoLeaveDay {
  date: string;
  kind: ZohoDayKind;
  /** The share of the day taken: 1, 0.5 or 0. */
  portion: number;
  /** "1st Half", "2nd Half" for a half day. */
  session: string | null;
}

/**
 * Zoho's "Date - Duration and Session": each day of the leave, "{Date:21-Oct-2026,Duration:Full Day}", "{Date:22-Jun-2026,
 * Duration:Half Day,Session:2nd Half}", "{Date:24-Oct-2026,Duration:Holiday/Weekend}", one after another. Null when the
 * cell is empty or a day of it can't be read.
 */
export function zohoLeaveDays(text: string): ZohoLeaveDay[] | null {
  const t = text.trim();
  if (!t) return null;
  const out: ZohoLeaveDay[] = [];
  const parts = [...t.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]);
  if (!parts.length) return null;
  for (const part of parts) {
    const fields = new Map<string, string>();
    for (const pair of part.split(',')) {
      const i = pair.indexOf(':');
      if (i > 0) fields.set(pair.slice(0, i).trim().toLowerCase(), pair.slice(i + 1).trim());
    }
    const date = importDate(fields.get('date') ?? '');
    const duration = (fields.get('duration') ?? '').toLowerCase();
    if (!date) return null;
    let kind: ZohoDayKind;
    if (/holiday|weekend/.test(duration)) kind = 'off';
    else if (/half/.test(duration)) kind = 'half';
    else if (/full/.test(duration)) kind = 'full';
    else return null;
    out.push({ date, kind, portion: kind === 'full' ? 1 : kind === 'half' ? 0.5 : 0, session: kind === 'half' ? (fields.get('session') ?? null) : null });
  }
  return out;
}

/** Zoho's Approval Status as the import reads it. */
export const ZOHO_APPROVALS = ['approved', 'pending', 'rejected', 'cancelled'] as const;
export type ZohoApproval = (typeof ZOHO_APPROVALS)[number];

/** "Approved" and "System Approved" are approved; Pending, Rejected and Cancelled are themselves; anything else null. */
export function zohoApproval(text: string): ZohoApproval | null {
  const k = headingKey(text);
  if (k === 'approved' || k === 'systemapproved' || k === 'autoapproved') return 'approved';
  if (k === 'pending' || k === 'pendingapproval' || k === 'waitingforapproval') return 'pending';
  if (k === 'rejected') return 'rejected';
  if (k === 'cancelled' || k === 'canceled') return 'cancelled';
  return null;
}

/** A leave type of the system as the defaults are chosen from it. */
export interface ImportLeaveType {
  id: string;
  key: string;
  kind: string;
  nameEn: string;
  active: boolean;
}

/** Why Working from home is skipped by default (owner's brief, 21 October 2026). */
export const ZOHO_WFH_NOTE =
  'Working from home isn’t leave: those are working days at home, covered by attendance and home locations. Skipped by default.';

/** Why Compensatory Off is skipped unless a type of the system matches it (21 October 2026). */
export const ZOHO_COMP_OFF_NOTE =
  'A compensatory day off is a day off in lieu of a holiday worked, and the system has no such type. Create a “Compensatory day off” type in Leave Setup (paid, no balance) to import these; skipped, they won’t show as leave.';

/** A Zoho type no type of the system matches. */
export const ZOHO_UNMATCHED_NOTE = 'No leave type of the system matches it: choose one, or leave it skipped.';

const LAW_TYPE_WORDS: readonly [RegExp, string][] = [
  [/annual/, 'annual'],
  [/sick|medical/, 'sick'],
  [/casual|emergency/, 'casual'],
  [/unpaid|withoutpay|lossofpay/, 'unpaid'],
  [/maternity/, 'maternity'],
  [/hajj|pilgrim/, 'hajj'],
  [/exam/, 'exam'],
  [/paternity|birth/, 'birth'],
  [/childcare/, 'childcare'],
];

/**
 * The system's type a Zoho leave type is imported as unless HR chooses another (owner's brief, 21 October 2026): Annual
 * Leave as annual leave, Sick Leave as sick leave, Casual leave (Exceptional) as the law's casual leave, and the law's
 * others by their names; Working from home skipped (not leave); Compensatory Off skipped unless a type of the system is
 * named for it (HR adds one in Leave Setup); any other the type of the same name, else skipped. Only types on.
 */
export function defaultZohoType(zohoType: string, types: readonly ImportLeaveType[]): { typeId: string | null; note: string | null } {
  const k = headingKey(zohoType);
  const on = types.filter((t) => t.active);
  if (/workingfromhome|workfromhome|wfh|remotework/.test(k)) return { typeId: null, note: ZOHO_WFH_NOTE };
  if (/compensatory|compoff/.test(k)) {
    const own = on.find((t) => /compensatory|compoff|inlieu/.test(headingKey(t.nameEn)));
    return own ? { typeId: own.id, note: null } : { typeId: null, note: ZOHO_COMP_OFF_NOTE };
  }
  const same = on.find((t) => headingKey(t.nameEn) === k);
  if (same) return { typeId: same.id, note: null };
  for (const [words, key] of LAW_TYPE_WORDS) {
    if (!words.test(k)) continue;
    const law = on.find((t) => t.key === key);
    if (law) return { typeId: law.id, note: null };
  }
  return { typeId: null, note: ZOHO_UNMATCHED_NOTE };
}

// ---------- the people ----------

/** An employee as the import matches people to them: their code, English name and remembered Zoho id. */
export interface ImportCandidate extends MatchCandidate {
  employeeCode: string;
}

/**
 * How a person of the file was found: by their employee code; by their remembered Zoho Employee Id (`linked`); by their
 * name written alike (`exact`); close to a name (`close`); or not at all.
 */
export type ImportMatchKind = 'code' | 'linked' | 'exact' | 'close' | 'none';

/** A person of the file as matched: who, and those they may be. */
export interface ImportMatch {
  kind: ImportMatchKind;
  employeeId: string | null;
  candidates: { id: string; similarity: number }[];
}

/**
 * Who a person of the file is (owner's brief, 21 October 2026): by their employee code first; else by their name, as the
 * attendance import matches Zoho's people (matchPerson: their remembered Zoho Employee Id, the name written alike with
 * its common spellings, a close name). A template's name alone is for HR to confirm; a Zoho row's name written alike is
 * matched, as attendance has it, a close one confirmed.
 */
export function matchImportPerson(person: { code: string | null; name: string; zohoId: string | null }, employees: readonly ImportCandidate[]): ImportMatch {
  const code = person.code?.trim().toUpperCase();
  if (code) {
    const byCode = employees.find((e) => e.employeeCode.trim().toUpperCase() === code);
    if (byCode) return { kind: 'code', employeeId: byCode.id, candidates: [] };
  }
  if (!person.name.trim() && !person.zohoId) return { kind: 'none', employeeId: null, candidates: [] };
  const m = matchPerson({ zohoId: person.zohoId, name: person.name }, employees);
  if (m.kind === 'exact') return { kind: 'exact', employeeId: m.employeeId, candidates: [{ id: m.employeeId!, similarity: 1 }] };
  return { kind: m.kind, employeeId: m.employeeId, candidates: m.candidates };
}

/** Whether a match is for HR to confirm first: a close name; and a template's name alone, without its code. */
export const matchNeedsConfirming = (kind: ImportMatchKind, source: LeaveImportSource): boolean => kind === 'close' || (kind === 'exact' && source === 'template');

/** A person of the file's key: their code, else their Zoho id, else their name as matched. */
export function importPersonKey(person: { code: string | null; name: string; zohoId: string | null }): string {
  const code = person.code?.trim().toUpperCase();
  if (code) return `code:${code}`;
  if (person.zohoId) return `zoho:${person.zohoId}`;
  return `name:${nameKey(person.name) || person.name.trim().toLowerCase()}`;
}

/**
 * Whether the caller imports a person's leave and balance: HR, a C-level person's the CEO (owner, 19 October 2026: "make
 * C level Employees details not visible to HR"), or HR who sees C-level people (with Super Admin).
 */
export function importsLeaveFor(user: { roles: readonly Role[] }, confidential: boolean): boolean {
  return confidential ? decidesConfidentialStage(user, ['hr']) : user.roles.includes('hr');
}

// ---------- a row's status ----------

/**
 * Where a row of the file stands on the review: ready to apply; applied by this import; waiting for HR to say who its
 * person is; with a problem (not applied until the file is put right); a duplicate (already in the system, imported
 * before, or in the file twice); or not imported (Zoho's rejected and cancelled leave, a type skipped, a person skipped).
 */
export const LEAVE_IMPORT_ROW_STATUSES = ['ready', 'applied', 'waiting', 'problem', 'duplicate', 'skipped'] as const;
export type LeaveImportRowStatus = (typeof LEAVE_IMPORT_ROW_STATUSES)[number];

export const LEAVE_IMPORT_ROW_STATUS_LABELS: Record<LeaveImportRowStatus, string> = {
  ready: 'Ready',
  applied: 'Applied',
  waiting: 'Choose who it is',
  problem: 'Problem',
  duplicate: 'Duplicate',
  skipped: 'Not imported',
};

export const ZOHO_APPROVAL_LABELS: Record<ZohoApproval, string> = { approved: 'Approved', pending: 'Pending', rejected: 'Rejected', cancelled: 'Cancelled' };

/** Zoho's rejected or cancelled leave: listed, not imported. */
export const zohoNotImportedText = (approval: 'rejected' | 'cancelled'): string => `${ZOHO_APPROVAL_LABELS[approval]} in Zoho People: not imported.`;

/** A leave pending in Zoho: carried on as a request in the system's own approval (Zoho's leave being stopped). */
export const ZOHO_PENDING_NOTE = 'Pending in Zoho People: imported as a request waiting for its decision here, the direct manager’s, then HR’s.';

// ---------- the checks of a leave row ----------

/** What a leave row is checked with: its dates, the days the system counts and the file's own figure. */
export interface ImportedLeaveInput {
  startDate: string;
  endDate: string;
  halfDay: boolean;
  /** The days as the system counts them (leaveDaysBetween), the half day taken off. */
  days: number;
  /** The days the file gives (the template's Days, Zoho's days); null when it gives none. */
  fileDays: number | null;
  /** The half day the file gives can't be kept (the type has no half days, or the leave is of several days). */
  halfDayRefused: string | null;
}

/** The person and what they have taken of the type, with this file's earlier rows. */
export interface ImportedLeaveHistory {
  usedInYear: number;
  timesInService: number;
  serviceMonths: number;
  gender: LeaveGender | null;
  /** The first day the year's annual leave may be used (annualEntitlement.usableFrom). */
  usableFrom: string;
}

/**
 * Why a leave row can't be imported (problems) and what is only said of it (warnings), as history (owner's brief, 21
 * October 2026; 21 October 2026: the casual limits and sick leave's documents "don't block imported HISTORY: warn, not
 * refuse"). Problems: days the system doesn't count (none, on rest days and holidays only), a leave counted by the year
 * running into the next one, a type for the other gender (or none recorded). Warnings: the days the file says that the
 * system counts otherwise (the system's figure is used), the half day not kept, the months of service, the times in
 * service, the days at a time and a year, annual leave before six months of service, the document.
 */
export function importedLeaveFindings(input: ImportedLeaveInput, type: LeaveTypeRules, history: ImportedLeaveHistory): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!(input.days > 0)) {
    problems.push(type.calendarDays ? 'Choose the days of the leave.' : 'These dates have no working days: rest days and official holidays aren’t counted as leave.');
  }
  const yearly = type.balance === 'annual' || type.balance === 'from_annual' || type.balance === 'yearly';
  if (yearly && input.startDate.slice(0, 4) !== input.endDate.slice(0, 4)) {
    problems.push(`A leave counted by the year can’t run into the next one: end it on 31/12/${input.startDate.slice(0, 4)} and put the rest on a row of its own.`);
  }
  if (type.gender !== null && history.gender !== type.gender) {
    problems.push(
      history.gender === null ? `${type.nameEn} is for ${type.gender} employees: record the employee’s gender on their profile first.` : `${type.nameEn} is for ${type.gender} employees only.`,
    );
  }
  if (input.halfDayRefused) warnings.push(input.halfDayRefused);
  if (input.fileDays !== null && input.days > 0 && Math.round(input.fileDays * 10) !== Math.round(input.days * 10)) {
    warnings.push(daysMismatchText(input.fileDays, input.days, type.calendarDays));
  }
  if (type.minServiceMonths !== null && history.serviceMonths < type.minServiceMonths) {
    warnings.push(`${type.nameEn} needs ${monthsText(type.minServiceMonths)} of service first; there were ${monthsText(history.serviceMonths)} by its first day.`);
  }
  if (type.maxTimesInService !== null && history.timesInService >= type.maxTimesInService) {
    warnings.push(`${type.nameEn} can be taken ${timesText(type.maxTimesInService)} in service: this is time ${history.timesInService + 1}.`);
  }
  if (type.maxPerRequest !== null && input.days > type.maxPerRequest) {
    warnings.push(`${type.nameEn} is at most ${daysText(type.maxPerRequest)} at a time; this is ${daysText(input.days)}.`);
  }
  if (yearly && type.daysPerYear !== null && type.balance !== 'annual' && history.usedInYear + input.days > type.daysPerYear) {
    warnings.push(`Takes ${type.nameEn.toLowerCase()} to ${daysText(tenth(history.usedInYear + input.days))} in ${input.startDate.slice(0, 4)}, over its ${daysText(type.daysPerYear)} a year.`);
  }
  if (type.balance === 'annual' && input.startDate < history.usableFrom) {
    warnings.push(`Annual leave can be used from ${shown(history.usableFrom)}, six months after joining; this was before.`);
  }
  if (type.documentRequired) warnings.push(`${type.nameEn} needs a document: imported as history without one.`);
  return { problems, warnings };
}

/** The file's days against the system's: the system's are used (owner's brief, 21 October 2026). */
export function daysMismatchText(fileDays: number, systemDays: number, calendarDays: boolean): string {
  const how = calendarDays ? 'in calendar days' : 'in working days, without rest days and official holidays';
  return `The file says ${daysText(fileDays)}; the system counts ${daysText(systemDays)} (${how}), and ${systemDays === 1 ? 'that is' : 'those are'} used.`;
}

/**
 * The days Zoho counts as a holiday or weekend that the system counts as working days, and the other way round, by the
 * shift's working days and the official holidays set (21 October 2026: "If a holiday isn't set there, the system counts
 * that day as a working day and takes it from the balance").
 */
export function zohoDayDifferences(days: readonly ZohoLeaveDay[], countsDay: (date: string) => boolean): { offInZoho: string[]; offHere: string[] } {
  const offInZoho: string[] = [];
  const offHere: string[] = [];
  for (const d of days) {
    const here = countsDay(d.date);
    if (d.kind === 'off' && here) offInZoho.push(d.date);
    if (d.kind !== 'off' && !here) offHere.push(d.date);
  }
  return { offInZoho, offHere };
}

/** What zohoDayDifferences found, in words; null when none. */
export function zohoDayDifferencesText(diff: { offInZoho: readonly string[]; offHere: readonly string[] }): string | null {
  const parts: string[] = [];
  if (diff.offInZoho.length) parts.push(`${listOf(diff.offInZoho.map(shown))} ${diff.offInZoho.length === 1 ? 'is a holiday or weekend' : 'are holidays or weekends'} in Zoho, ${diff.offInZoho.length === 1 ? 'a working day' : 'working days'} here`);
  if (diff.offHere.length) parts.push(`${listOf(diff.offHere.map(shown))} ${diff.offHere.length === 1 ? 'is taken in Zoho, a rest day or holiday' : 'are taken in Zoho, rest days or holidays'} here`);
  return parts.length ? `${capitalise(parts.join('; '))}.` : null;
}

/** The page's hint when a file counts days as holidays the system counts as working days (21 October 2026). */
export const holidaysHint = (years: readonly number[]): string =>
  `Check that ${listOf([...new Set(years)].sort().map(String))}’s official holidays are set in Organization → Holidays before applying: a holiday not set there is counted as a working day and taken from the balance.`;

/**
 * An annual balance brought below 0 by the leave imported (21 October 2026: "Warn, don't block … Apply it as history"):
 * "Brings annual leave to −6 days (entitlement 15)."
 */
export const belowZeroText = (typeName: string, balance: number, entitlement: number): string =>
  `Brings ${typeName.toLowerCase()} to ${signedDays(balance)} (entitlement ${entitlement}).`;

// ---------- duplicates ----------

/** A leave as duplicates are told: the person, the type, the first and the last day. */
export const leaveImportKey = (employeeId: string, typeId: string, from: string, to: string): string => `${employeeId}|${typeId}|${from}|${to}`;

/** A row the same as a leave imported before (owner, 21 October 2026: "no duplicates from the previous imported files"). */
export const alreadyImportedText = (fileName: string, at: string): string => `Already imported from ${fileName}, ${shown(at.slice(0, 10))}.`;

/** A row the same as a leave already in the system, recorded or asked for there. */
export const alreadyInSystemText = (typeName: string, from: string, to: string, status: string): string =>
  `Already in the system: ${typeName} ${whenText(from, to)} (${status}).`;

/** A row overlapping a leave already in the system: a problem, not a duplicate. */
export const overlapsSystemText = (typeName: string, from: string, to: string, status: string): string =>
  `Overlaps ${typeName} ${whenText(from, to)} already in the system (${status}).`;

/** A row the same as an earlier row of the file. */
export const sameRowText = (row: number): string => `In the file twice: the same as row ${row}.`;

/** A row overlapping an earlier row of the file. */
export const overlapsRowText = (row: number): string => `Overlaps row ${row} of the file: put right one of them.`;

/** The whole file uploaded before and applied: its rows are all duplicates (owner, 21 October 2026). */
export const sameFileText = (at: string, by: string | null): string => `This file was already imported on ${shown(at.slice(0, 10))}${by ? ` by ${by}` : ''}.`;

/** A balance row whose figure the balance is at already: nothing applied (21 October 2026). */
export const ALREADY_AT_BALANCE = 'Already at this balance: nothing to change.';

// ---------- balances ----------

/** A balance row as read: the figure and the day it is as of. */
export interface ImportedBalanceInput {
  balance: number | null;
  balanceText: string;
  asOf: string | null;
  asOfText: string;
}

/**
 * Why a balance row can't be imported (owner's brief, 21 October 2026): the figure 0 or more, in whole or half days; As of
 * a day of the current year, or of a year the file's leave is in.
 */
export function balanceRowProblems(input: ImportedBalanceInput, currentYear: number, leaveYears: readonly number[]): string[] {
  const problems: string[] = [];
  if (input.balance === null) problems.push(input.balanceText ? `“${input.balanceText}” isn’t a number of days: enter the balance, e.g. 12 or 7.5.` : 'Enter the balance in days, e.g. 12 or 7.5.');
  else if (input.balance < 0) problems.push('A balance can’t be below 0: enter 0 or more days.');
  else if (!isHalfDays(input.balance)) problems.push('Enter the balance in whole or half days, e.g. 7.5.');
  else if (input.balance > 366) problems.push('Enter a balance of at most 366 days.');
  if (!input.asOf) problems.push(input.asOfText ? `“${input.asOfText}” isn’t a date: enter As of as DD/MM/YYYY.` : 'Enter the day the balance is as of (As of), as DD/MM/YYYY.');
  else {
    const year = Number(input.asOf.slice(0, 4));
    const years = [...new Set([currentYear, ...leaveYears])].sort();
    if (!years.includes(year)) problems.push(`As of must be in ${listOf(years.map(String), 'or')}: the current year, or a year of the leave in the file.`);
  }
  return problems;
}

/** The days an opening balance adds (or takes, below 0): the figure less what the system has left, in half days. */
export const openingAdjustment = (figure: number, remaining: number): number => Math.round((figure - remaining) * 2) / 2 + 0;

/** "+2.5 days", "−1 day", "0 days". */
export function signedDays(n: number): string {
  const v = tenth(n);
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${daysText(Math.abs(v))}`;
}

/** The note an opening balance's adjustment carries. */
export const openingBalanceReason = (fileName: string): string => `Opening balance from ${fileName}`;

/** The note an imported leave carries, with the file's notes after it. */
export const importedLeaveReason = (fileName: string, by: string, notes: string | null): string => `Imported from ${fileName} by ${by}${notes ? `: ${notes}` : ''}`;

// ---------- payroll ----------

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "October 2026" for '2026-10'. */
export const importMonthName = (month: string): string => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** The months ('YYYY-MM') a leave's days are in. */
export function monthsOf(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const [ty, tm] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${pad(m)}`);
    m++;
    if (m > 12) [y, m] = [y + 1, 1];
  }
  return out;
}

/**
 * A leave in a month whose payroll is no longer a draft (owner's brief, 21 October 2026: imported leave "must NOT change
 * those runs"): "Counted in no payroll: the October 2026 payroll is already approved."
 */
export function notInPayrollText(month: string, status: string): string {
  const state = status === 'pending_ceo' ? 'with the CEO' : status === 'paid' ? 'paid' : 'approved';
  return `Counted in no payroll: the ${importMonthName(month)} payroll is already ${state}.`;
}

/**
 * The no-shows a leave import turns into leave (owner, 21 October 2026: Zoho's attendance counts a day absent when its
 * leave wasn't in it; "A day covered by an approved leave … is never a no-show"): the days a draft payroll has as no-shows
 * that the file's leave covers, and the people. Applying moves them, as a refresh of the payroll does.
 */
export const noShowsToLeaveText = (days: number, people: number): string =>
  `These days were no-shows on a draft payroll and will count as leave once applied (a refresh of the payroll does the same): ${days} ${days === 1 ? 'day' : 'days'}, ${people} ${people === 1 ? 'person' : 'people'}.`;

/** A row's days that are no-shows on its month's draft payroll now. */
export const rowNoShowsText = (days: number, month: string): string =>
  `${days} of its days ${days === 1 ? 'is a no-show' : 'are no-shows'} on the ${importMonthName(month)} draft payroll now: ${days === 1 ? 'it counts' : 'they count'} as leave once applied, not a no-show.`;

/** Unpaid leave in a month whose payroll is a draft: the draft takes it, a day of the gross cut each, as recorded leave. */
export const unpaidInDraftText = (month: string): string => `Its unpaid days are cut from the ${importMonthName(month)} draft payroll once applied, as recorded leave is.`;

// ---------- helpers ----------

const tenth = (n: number) => Math.round(n * 10) / 10 + 0;
/** A date as messages show it: DD/MM/YYYY. */
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const daysText = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const timesText = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const whenText = (from: string, to: string) => (from === to ? `on ${shown(from)}` : `from ${shown(from)} to ${shown(to)}`);
function monthsText(months: number): string {
  if (months > 0 && months % 12 === 0) return `${months / 12} ${months === 12 ? 'year' : 'years'}`;
  return `${months} ${months === 1 ? 'month' : 'months'}`;
}
/** "a", "a and b", "a, b and c". */
function listOf(items: readonly string[], last = 'and'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}`;
}

/** Whether a type's days come out of the annual balance (annual and casual leave), for the import's balance warnings. */
export const importTakesFromAnnual = (balance: string): boolean => takesFromAnnual(balance);
