import {
  DEFAULT_WORKING_DAYS,
  HANDOVER_NOTE_MAX,
  isLeaveKind,
  LEAVE_DOCUMENT_MAX_MB,
  LEAVE_DOCUMENT_TYPES,
  LEAVE_DOCUMENTS_MAX,
  leaveDaysBetween,
  leaveRequestProblems,
  takesFromAnnual,
  type LeaveGender,
  type LeaveHistory,
  type LeaveTypeRules,
} from '@trendlix/shared';
import { parseDate } from '../../../lib/format';
import type { EmployeeProfile, Holiday, LeaveBalances, LeaveTypeView } from '../../../lib/types';
import { daysNumber, daysText } from './list';

// A new leave request (owner, 18 October 2026: "can you apply the leaves according to the law?"): the type, among the
// active ones HR set up on Organization → Leave, with its rules in words; the first and last day; a half day where the
// type allows it; the reason; and the documents a type needs (a medical certificate, proof of sitting the exam). Its days
// are counted live as the law counts them (leaveDaysBetween: the shift's working days, the official holidays and rest
// days not counted, Art. 124; calendar days for Hajj and maternity), with what is left of the annual balance once taken,
// and the shared checks (leaveRequestProblems) show as it is filled in; nothing is sent while any is left. The API checks
// them all again, and finds an overlap with another request. An employee asks for themself, from My Requests; HR records
// leave on someone's behalf, approved at once, with no notice needed (e.g. sick leave reported afterwards). Pure code,
// tested; relative imports, as vitest doesn't know the @/ paths.

/** What the documents box takes. Listing the types (not image/*) makes an iPhone hand over a JPEG instead of a HEIC photo. */
export const DOCUMENT_ACCEPT = LEAVE_DOCUMENT_TYPES.join(',');

/** The API takes each document up to this size. */
export const DOCUMENT_MAX_BYTES = LEAVE_DOCUMENT_MAX_MB * 1024 * 1024;

/**
 * All the documents go in one upload, which passes through the web app on Vercel, at most 4.5 MB a request: together they
 * must stay under this, as a claim's receipts. Photos are made smaller in the browser first.
 */
export const DOCUMENTS_SEND_MAX_BYTES = 4 * 1024 * 1024;

/** The longest reason the API takes. */
export const REASON_MAX = 500;

/** A type's rules as the shared checks take them. */
export const rulesOf = (t: LeaveTypeView): LeaveTypeRules => ({
  kind: isLeaveKind(t.kind) ? t.kind : 'custom',
  nameEn: t.nameEn,
  paid: t.paid,
  payPercent: t.payPercent,
  balance: t.balance,
  daysPerYear: t.daysPerYear,
  maxPerRequest: t.maxPerRequest,
  maxTimesInService: t.maxTimesInService,
  minServiceMonths: t.minServiceMonths,
  noticeDays: t.noticeDays,
  documentRequired: t.documentRequired,
  gender: t.gender,
  calendarDays: t.calendarDays,
  halfDays: t.halfDays,
});

// ---------- the documents ----------

/** A document as chosen: its name, size and kind (File has them). */
export interface LeaveFile {
  name: string;
  size: number;
  type: string;
}

/** Why the documents can't be sent: too many, of another kind, one too large, or too large together. None: they can. */
export function documentProblems(files: readonly LeaveFile[]): string[] {
  const problems: string[] = [];
  if (files.length > LEAVE_DOCUMENTS_MAX) problems.push(`Attach at most ${LEAVE_DOCUMENTS_MAX} documents; remove ${files.length - LEAVE_DOCUMENTS_MAX}.`);
  for (const f of files) {
    if (!(LEAVE_DOCUMENT_TYPES as readonly string[]).includes(f.type)) problems.push(`${f.name || 'A file'} can't be attached: a document is a photo (JPG, PNG or WebP) or a PDF.`);
  }
  if (files.some((f) => f.size > DOCUMENT_MAX_BYTES)) problems.push(`Each document must be ${LEAVE_DOCUMENT_MAX_MB} MB or smaller.`);
  else if (files.reduce((n, f) => n + f.size, 0) > DOCUMENTS_SEND_MAX_BYTES) {
    problems.push('Together the documents are too large to send: at most 4 MB. Take the photos again, or scan a PDF at a lower resolution (150–200 dpi is enough).');
  }
  return problems;
}

// ---------- the request as typed ----------

/** The form as typed: the type chosen, the first and last day (DD/MM/YYYY), a half day, and the reason. */
export interface TypedLeave {
  typeId: string;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  reason: string;
}

/** The first and last day as YYYY-MM-DD ("" while empty or not a date); the last is the first when left empty. */
export function readDates(t: Pick<TypedLeave, 'startDate' | 'endDate'>): { startDate: string; endDate: string } {
  const startDate = parseDate(t.startDate) || '';
  const endDate = t.endDate.trim() === '' ? startDate : parseDate(t.endDate) || '';
  return { startDate, endDate };
}

/** Who the leave is for, and what it is counted with. */
export interface LeaveContext {
  /** Their shift's working days (0 = Sunday … 6 = Saturday); none: Sunday to Thursday, as a shift's default. */
  workingDays: readonly number[] | null | undefined;
  /** The official holidays of the years the dates are in. */
  holidays: readonly Pick<Holiday, 'date'>[];
  /** Their balances of the request's year; null while they couldn't be read (the API checks them). */
  balances: LeaveBalances | null;
  /** Their current employment's join date, for the service a type needs (Hajj: 5 years). */
  joinDate: string | null;
  gender: LeaveGender | null;
  /** Today, YYYY-MM-DD (Cairo). */
  today: string;
  /** HR recording it on their behalf: no notice is needed. */
  byHr: boolean;
}

/** The working days a leave is counted in: the shift's, else Sunday to Thursday. */
export const workingDaysOf = (days: readonly number[] | null | undefined) => (days && days.length ? days : DEFAULT_WORKING_DAYS);

/**
 * The leave's days as the law counts them (Art. 124: "لا يدخل فى حسابها أيام عطلات الأعياد والمناسبات الرسمية والراحة
 * الأسبوعية"): the shift's working days from the first to the last day, the official holidays left out, or the calendar
 * days for a type counted so; half a day less for a half day. 0 while the dates aren't dates yet.
 */
export function countLeaveDays(typed: TypedLeave, type: LeaveTypeView | null, ctx: Pick<LeaveContext, 'workingDays' | 'holidays'>): number {
  const { startDate, endDate } = readDates(typed);
  if (!startDate || !endDate) return 0;
  return leaveDaysBetween(startDate, endDate, {
    workingDays: workingDaysOf(ctx.workingDays),
    holidays: ctx.holidays.map((h) => h.date),
    calendarDays: type?.calendarDays ?? false,
    halfDay: typed.halfDay && (type?.halfDays ?? false),
  });
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The full months from one date (YYYY-MM-DD) to another: 15 March to 14 April is 0, to 15 April 1; 0 when either isn't a date. */
export function fullMonths(from: string | null, to: string): number {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (!from || !date.test(from) || !date.test(to) || to < from) return 0;
  let months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
  const plus = (n: number) => {
    const index = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)) - 1 + n;
    const [y, m] = [Math.floor(index / 12), (index % 12) + 1];
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${pad(m)}-${pad(Math.min(Number(from.slice(8, 10)), last))}`;
  };
  if (plus(months) > to) months--;
  return Math.max(0, months);
}

/** What the employee has taken of the type, from their balances (the requests approved or being decided). */
export function historyOf(type: Pick<LeaveTypeView, 'id'>, ctx: Pick<LeaveContext, 'balances' | 'joinDate' | 'gender'>, startDate: string): LeaveHistory {
  const mine = ctx.balances?.types.find((t) => t.typeId === type.id);
  return { usedInYear: mine?.used ?? 0, timesInService: mine?.timesInService ?? 0, serviceMonths: fullMonths(ctx.joinDate, startDate), gender: ctx.gender };
}

/**
 * Why the request can't be sent yet, in the order to fix them (none: it can): the type, then the shared checks (the
 * dates, the half day, the days, who may take it, the times in service, the days a request and a year, the annual
 * balance and when it may be used, the notice and the document), the reason's length, and the documents' limits. Without
 * the balances (they couldn't be read) the balance isn't checked here: the API checks it.
 */
export function leaveFormProblems(typed: TypedLeave, type: LeaveTypeView | null, documents: readonly LeaveFile[], ctx: LeaveContext): string[] {
  const problems: string[] = [];
  if (!type) problems.push('Choose the type of leave.');
  const { startDate, endDate } = readDates(typed);
  if (typed.startDate.trim() === '') problems.push('Enter the first day of the leave.');
  else if (!startDate) problems.push('Enter the first day as DD/MM/YYYY, e.g. 25/10/2026.');
  if (typed.endDate.trim() !== '' && !parseDate(typed.endDate)) problems.push('Enter the last day as DD/MM/YYYY, e.g. 27/10/2026.');
  if (type && startDate && endDate) {
    const days = countLeaveDays(typed, type, ctx);
    // without the balances (they couldn't be read) the annual balance isn't checked here: the API checks it
    const balance = ctx.balances ? { available: ctx.balances.annual.available, usableFrom: ctx.balances.annual.usableFrom } : { available: Infinity, usableFrom: '' };
    const found = leaveRequestProblems(
      { startDate, endDate, halfDay: typed.halfDay, days, documents: documents.length, today: ctx.today, byHr: ctx.byHr },
      rulesOf(type),
      balance,
      historyOf(type, ctx, startDate),
    );
    // its dates as the screens show them (DD/MM/YYYY)
    problems.push(...found.map(asShown));
  }
  if (typed.reason.trim().length > REASON_MAX) problems.push(`Keep the reason to ${REASON_MAX} characters; it has ${typed.reason.trim().length}.`);
  problems.push(...documentProblems(documents));
  return problems;
}

/** The dates in a message (YYYY-MM-DD) as the screens show them (DD/MM/YYYY). */
export const asShown = (message: string) => message.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1');

/**
 * What is left of the annual balance once this leave is taken, for a type from it (annual, casual); null for the others,
 * or without the balances.
 */
export function balanceAfter(type: Pick<LeaveTypeView, 'balance'> | null, balances: LeaveBalances | null, days: number): number | null {
  if (!type || !balances || !takesFromAnnual(type.balance)) return null;
  return Math.round((balances.annual.available - days) * 10) / 10 + 0;
}

/** "3 days, from your annual balance: 18 left after it." and the like, for the line under the dates. */
export function countText(days: number, after: number | null, byHr: boolean): string {
  if (days <= 0) return 'No days yet: choose the first and last day.';
  const counted = daysText(days);
  if (after === null) return `${counted}.`;
  return `${counted}, from the annual balance: ${daysNumber(after)} left after it${byHr ? '' : ', as far as is approved'}.`;
}

/** The year the request's balances are read for: its first day's, else this year. */
export const requestYear = (typed: Pick<TypedLeave, 'startDate'>, today: string) => Number((parseDate(typed.startDate) || today).slice(0, 4));

// ---------- the form as the server action reads it ----------

/**
 * What POST /me/leave/requests (and HR's POST /leave/requests) take besides the documents. Leave coverage (owner, 25
 * October 2026: "Required over 2 days", "To a stand-in"): the colleague who covers ("" none), the handover note to them,
 * and the stand-in of someone who approves ("hr", an employee's id, or "" for the default).
 */
export interface LeaveFields {
  typeId: string;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  reason: string;
  coverId: string;
  handoverNote: string;
  standIn: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/**
 * The request sent: its fields as the API takes them (the dates as YYYY-MM-DD, the last the first when left empty) and
 * the documents (`documents`, the files the form added), or what is wrong with them, checked again here before the
 * upload. The type's rules are the API's to check: it answers what is wrong.
 */
export function leaveForm(fd: FormData): { fields: LeaveFields | null; documents: File[]; errors: string[] } {
  const errors: string[] = [];
  const typeId = text(fd, 'typeId');
  if (!typeId) errors.push('Choose the type of leave.');
  const startDate = parseDate(text(fd, 'startDate'));
  if (!startDate) errors.push('Enter the first day as DD/MM/YYYY, e.g. 25/10/2026.');
  const typedEnd = text(fd, 'endDate');
  const endDate = typedEnd === '' ? startDate : parseDate(typedEnd);
  if (typedEnd !== '' && !endDate) errors.push('Enter the last day as DD/MM/YYYY, e.g. 27/10/2026.');
  if (startDate && endDate && endDate < startDate) errors.push("The last day can't be before the first.");
  const reason = text(fd, 'reason');
  if (reason.length > REASON_MAX) errors.push(`Keep the reason to ${REASON_MAX} characters; it has ${reason.length}.`);
  // who covers, the note to them and the stand-in (25 October 2026): the API checks who may, and when one is required
  const coverId = text(fd, 'coverId');
  if (coverId && !UUID.test(coverId)) errors.push('Choose the colleague who covers from the list.');
  const handoverNote = text(fd, 'handoverNote');
  if (handoverNote.length > HANDOVER_NOTE_MAX) errors.push(`Keep the handover note to ${HANDOVER_NOTE_MAX} characters; it has ${handoverNote.length}.`);
  const standIn = text(fd, 'standIn');
  if (standIn && standIn !== 'hr' && !UUID.test(standIn)) errors.push('Choose your stand-in from the list, or HR.');
  const documents = fd.getAll('documents').filter((v): v is File => typeof v === 'object' && v !== null && 'size' in v && (v as File).size > 0);
  errors.push(...documentProblems(documents));
  if (errors.length) return { fields: null, documents, errors };
  return { fields: { typeId, startDate: startDate!, endDate: endDate!, halfDay: fd.get('halfDay') === 'true', reason, coverId, handoverNote, standIn }, documents, errors };
}

/** The fields as the form shows them again after a refusal (not the documents: a file box can't be refilled). */
export const typedLeaveValues = (fd: FormData): Record<string, string> =>
  Object.fromEntries(['typeId', 'startDate', 'endDate', 'halfDay', 'reason', 'employeeId', 'coverId', 'handoverNote', 'standIn'].map((k) => [k, String(fd.get(k) ?? '')]));

/**
 * Why the request can't be sent yet for its coverage (owner, 25 October 2026: "Required over 2 days"): annual (or unpaid)
 * leave of more than 2 working days names a colleague who covers; the handover note within its length. None: it can.
 * `required`: the API's answer for the days typed (GET /me/leave/coverage).
 */
export function coverProblems(required: boolean, coverId: string, handoverNote: string): string[] {
  const problems: string[] = [];
  if (required && !coverId) problems.push('Choose the colleague who covers your work: leave of more than 2 working days needs one.');
  if (handoverNote.trim().length > HANDOVER_NOTE_MAX) problems.push(`Keep the handover note to ${HANDOVER_NOTE_MAX} characters; it has ${handoverNote.trim().length}.`);
  return problems;
}

// ---------- who it is for ----------

/** Who the leave is for, as the form counts and checks it: their shift's days, their join date and gender. */
export interface LeavePersonFacts {
  name: string;
  workingDays: readonly number[] | null;
  joinDate: string | null;
  gender: LeaveGender | null;
}

/** The facts of a profile the form needs: its current employment's shift days and join date, and the gender. */
export function personFacts(p: Pick<EmployeeProfile, 'fullNameEn' | 'gender' | 'employment'>): LeavePersonFacts {
  return {
    name: p.fullNameEn,
    workingDays: p.employment?.shift?.workingDays ?? null,
    joinDate: p.employment?.joinDate ?? null,
    gender: p.gender,
  };
}

/**
 * The types the form offers someone: the active ones, in their order, without those for the other gender (Art. 128's
 * day of a child's birth for a father, maternity for a mother; offered to all while the gender isn't recorded, when the
 * check says so).
 */
export function offeredTypes(types: readonly LeaveTypeView[], gender: LeaveGender | null): LeaveTypeView[] {
  return types.filter((t) => t.active && (t.gender === null || gender === null || t.gender === gender)).sort((a, b) => a.sortOrder - b.sortOrder);
}
