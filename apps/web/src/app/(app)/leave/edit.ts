import { takesFromAnnual } from '@trendlix/shared';
import { formatDate, parseDate } from '../../../lib/format';
import type { LeaveBalances, LeaveRequestView, LeaveTypeView } from '../../../lib/types';
import { daysNumber, daysText } from './list';
import { countLeaveDays, readDates, REASON_MAX, type LeaveContext, type TypedLeave } from './request';

// A Super Admin edits a leave (owner, 26 October 2026, on an imported approved annual leave's page: "as a superadmin i
// need to edit the leaves"; asked, "All four": the dates, the leave type, the reason and who covers it; in any status;
// Super Admin only, in their own session): the form on the leave's page, with the days counted as the leave form counts
// them and the annual balance after it, and what it sends (PATCH /leave/requests/:id). The API checks everything again,
// and answers what is wrong. Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

/** The longest note the API takes (why it is edited). */
export const EDIT_NOTE_MAX = 500;

/** The form as typed: the leave's fields, the colleague who covers ("" none) and why it is edited. */
export interface TypedEdit extends TypedLeave {
  coverId: string;
  note: string;
}

/** The form as it opens: the leave as it is now, its dates as DD/MM/YYYY. */
export function editStart(r: Pick<LeaveRequestView, 'type' | 'startDate' | 'endDate' | 'halfDay' | 'reason' | 'cover'>): TypedEdit {
  return {
    typeId: r.type.id,
    startDate: formatDate(r.startDate),
    // one day: the last day left empty, as the leave form has it
    endDate: r.endDate === r.startDate ? '' : formatDate(r.endDate),
    halfDay: r.halfDay,
    reason: r.reason ?? '',
    coverId: r.cover?.id ?? '',
    note: '',
  };
}

/** Whether the form differs from the leave: what the API takes as a change (the note alone is not one). */
export function editChanged(typed: TypedEdit, r: Pick<LeaveRequestView, 'type' | 'startDate' | 'endDate' | 'halfDay' | 'reason' | 'cover'>): boolean {
  const { startDate, endDate } = readDates(typed);
  return (
    typed.typeId !== r.type.id ||
    startDate !== r.startDate ||
    endDate !== r.endDate ||
    typed.halfDay !== r.halfDay ||
    typed.reason.trim() !== (r.reason ?? '') ||
    typed.coverId !== (r.cover?.id ?? '')
  );
}

/**
 * The types the form offers: the active ones in their order, and the leave's own even when it is turned off now (so the
 * form can keep it), without those for the other gender (offeredTypes' rule; the API checks it).
 */
export function editTypes(types: readonly LeaveTypeView[], currentId: string, gender: 'male' | 'female' | null): LeaveTypeView[] {
  return types.filter((t) => t.id === currentId || (t.active && (t.gender === null || gender === null || t.gender === gender))).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** What the days and the balance are counted with. */
export interface EditContext extends Pick<LeaveContext, 'workingDays' | 'holidays'> {
  /** The balances of `year`, whose annual balance already counts this leave if it is being decided or approved; null: not read. */
  balances: LeaveBalances | null;
}

/**
 * The days the dates have as the law counts them, and the annual balance left after the leave is edited (null: the type is
 * not from the annual balance, or the balance of the year of the first day is not at hand: it is counted on save). The
 * leave's own days are given back first when it counts against that balance now (being decided or approved, from the
 * annual balance, in that year).
 */
export function editPreview(
  typed: TypedEdit,
  type: LeaveTypeView | null,
  ctx: EditContext,
  request: Pick<LeaveRequestView, 'status' | 'startDate' | 'days' | 'type'>,
  currentType: Pick<LeaveTypeView, 'balance'> | null,
): { days: number; after: number | null; counted: boolean } {
  const days = countLeaveDays(typed, type, ctx);
  const { startDate } = readDates(typed);
  const year = ctx.balances?.year;
  if (!type || days <= 0 || !ctx.balances || !startDate || Number(startDate.slice(0, 4)) !== year || !takesFromAnnual(type.balance)) {
    return { days, after: null, counted: !!type && takesFromAnnual(type.balance) && days > 0 };
  }
  const counting = (request.status === 'with_manager' || request.status === 'with_hr' || request.status === 'approved') && !!currentType && takesFromAnnual(currentType.balance) && Number(request.startDate.slice(0, 4)) === year;
  const free = ctx.balances.annual.available + (counting ? request.days : 0);
  return { days, after: Math.round((free - days) * 10) / 10 + 0, counted: false };
}

/** "2 days · annual balance after it: 16", "3 days", or "2 days · the annual balance is counted on save". */
export function editPreviewText(preview: { days: number; after: number | null; counted: boolean }): string {
  if (preview.days <= 0) return 'No days yet: choose the first and last day.';
  if (preview.after !== null) return `${daysText(preview.days)} · annual balance after it: ${daysNumber(preview.after)}`;
  return preview.counted ? `${daysText(preview.days)} · the annual balance is counted on save` : daysText(preview.days);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/** What PATCH /leave/requests/:id takes: every field as the form has it, the API finds what changed. */
export interface EditBody {
  typeId: string;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  reason: string | null;
  coverId: string | null;
  note: string | null;
}

/** The form as the server action reads it: the body, or what is wrong with it, checked again before it is sent. */
export function editBody(fd: FormData): { body: EditBody | null; errors: string[] } {
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
  const coverId = text(fd, 'coverId');
  if (coverId && !UUID.test(coverId)) errors.push('Choose the colleague who covers from the list.');
  const note = text(fd, 'note');
  if (note.length > EDIT_NOTE_MAX) errors.push(`Keep the note to ${EDIT_NOTE_MAX} characters; it has ${note.length}.`);
  if (errors.length) return { body: null, errors };
  return { body: { typeId, startDate: startDate!, endDate: endDate!, halfDay: fd.get('halfDay') === 'true', reason: reason || null, coverId: coverId || null, note: note || null }, errors };
}

/** The fields as the form shows them again after a refusal. */
export const typedEditValues = (fd: FormData): Record<string, string> =>
  Object.fromEntries(['typeId', 'startDate', 'endDate', 'halfDay', 'reason', 'coverId', 'note'].map((k) => [k, String(fd.get(k) ?? '')]));

/** The hint under the form: what an edit does to the balance and the payroll, and the import's. */
export function editHint(r: Pick<LeaveRequestView, 'status' | 'imported'>): string {
  const effect =
    r.status === 'approved'
      ? 'The balance and the month’s draft payroll follow it, a month with the CEO, approved or paid refuses it, and the employee is told.'
      : r.status === 'with_manager' || r.status === 'with_hr'
        ? 'It stays with the same approver at the same step, who sees the new values.'
        : 'Only its fields change: no balance, no payroll.';
  return `${effect} Every edit is a step of the leave and in the audit log.${r.imported ? ' Undoing its import removes it, edits too.' : ''}`;
}
