import { describe, expect, it } from 'vitest';
import type { LeaveBalances, LeaveRequestView, LeaveTypeView } from '../../../lib/types';
import { EDIT_NOTE_MAX, editBody, editChanged, editHint, editPreview, editPreviewText, editStart, editTypes, typedEditValues, type TypedEdit } from './edit';

// A Super Admin edits a leave (owner, 26 October 2026: "as a superadmin i need to edit the leaves"). Invented types and balances.

const type = (t: Partial<LeaveTypeView>): LeaveTypeView => ({
  id: 'annual',
  key: 'annual',
  kind: 'annual',
  nameEn: 'Annual leave',
  nameAr: 'إجازة سنوية',
  paid: 'paid',
  payPercent: null,
  balance: 'annual',
  daysPerYear: null,
  maxPerRequest: null,
  maxTimesInService: null,
  minServiceMonths: null,
  noticeDays: null,
  documentRequired: false,
  gender: null,
  calendarDays: false,
  halfDays: true,
  active: true,
  sortOrder: 1,
  ...t,
});
const ANNUAL = type({});
const CASUAL = type({ id: 'casual', key: 'casual', kind: 'casual', nameEn: 'Casual leave', balance: 'from_annual', sortOrder: 2 });
const UNPAID = type({ id: 'unpaid', key: 'unpaid', kind: 'unpaid', nameEn: 'Unpaid leave', paid: 'unpaid', balance: 'none', sortOrder: 3 });

const balances: LeaveBalances = {
  year: 2026,
  annual: { entitlement: 21, usableFrom: '2026-01-01', carriedIn: 0, adjustments: 0, taken: 3, booked: 2, pending: 0, available: 16 },
  types: [],
};

// an approved annual leave of two days, Thursday 5 and Sunday 8 November 2026 (Friday and Saturday are rest days)
const leave: Pick<LeaveRequestView, 'status' | 'type' | 'startDate' | 'endDate' | 'halfDay' | 'reason' | 'cover' | 'days' | 'imported'> = {
  status: 'approved',
  type: { id: 'annual', key: 'annual', nameEn: 'Annual leave', nameAr: 'إجازة سنوية', paid: 'paid' },
  startDate: '2026-11-05',
  endDate: '2026-11-08',
  halfDay: false,
  reason: 'Family visit',
  cover: { id: 'mona', fullNameEn: 'Mona Adel' },
  days: 2,
  imported: true,
};
const ctx = { workingDays: [0, 1, 2, 3, 4], holidays: [], balances };

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
};
const typed = (t: Partial<TypedEdit> = {}): TypedEdit => ({ ...editStart(leave), ...t });

describe('the form as it opens', () => {
  it('has the leave’s own values, its dates as DD/MM/YYYY, and one day with no last day', () => {
    expect(editStart(leave)).toEqual({ typeId: 'annual', startDate: '05/11/2026', endDate: '08/11/2026', halfDay: false, reason: 'Family visit', coverId: 'mona', note: '' });
    expect(editStart({ ...leave, endDate: '2026-11-05', reason: null, cover: null })).toMatchObject({ endDate: '', reason: '', coverId: '' });
  });

  it('is changed by a type, a day, the half day, the reason or the cover; not by the note alone nor the same values', () => {
    expect(editChanged(typed(), leave)).toBe(false);
    expect(editChanged(typed({ note: 'why' }), leave)).toBe(false);
    expect(editChanged(typed({ reason: '  Family visit ' }), leave)).toBe(false);
    expect(editChanged(typed({ typeId: 'casual' }), leave)).toBe(true);
    expect(editChanged(typed({ startDate: '06/11/2026' }), leave)).toBe(true);
    expect(editChanged(typed({ endDate: '' }), leave)).toBe(true);
    expect(editChanged(typed({ halfDay: true }), leave)).toBe(true);
    expect(editChanged(typed({ reason: '' }), leave)).toBe(true);
    expect(editChanged(typed({ coverId: '' }), leave)).toBe(true);
  });
});

describe('the types it offers', () => {
  it('the active ones in order and the leave’s own even when off, without the other gender’s', () => {
    const off = type({ id: 'old', nameEn: 'Old', active: false, sortOrder: 0 });
    const women = type({ id: 'maternity', nameEn: 'Maternity', gender: 'female', sortOrder: 9 });
    expect(editTypes([UNPAID, CASUAL, ANNUAL, off, women], 'annual', 'male').map((t) => t.id)).toEqual(['annual', 'casual', 'unpaid']);
    expect(editTypes([UNPAID, ANNUAL, off], 'old', null).map((t) => t.id)).toEqual(['old', 'annual', 'unpaid']);
    expect(editTypes([ANNUAL, women], 'annual', null).map((t) => t.id)).toEqual(['annual', 'maternity']);
  });
});

describe('the days and the balance after it', () => {
  it('counts the days as the law does and gives the leave’s own days back before taking the new', () => {
    // the same two days: 16 available already counts them, so 16 after
    expect(editPreview(typed(), ANNUAL, ctx, leave, ANNUAL)).toEqual({ days: 2, after: 16, counted: false });
    // one day more
    expect(editPreview(typed({ endDate: '09/11/2026' }), ANNUAL, ctx, leave, ANNUAL)).toEqual({ days: 3, after: 15, counted: false });
    // to casual leave, also from the annual balance
    expect(editPreview(typed({ typeId: 'casual' }), CASUAL, ctx, leave, ANNUAL).after).toBe(16);
  });

  it('is the balance of the type it becomes: none for a type not from it, the days back for the type it was', () => {
    expect(editPreview(typed({ typeId: 'unpaid' }), UNPAID, ctx, leave, ANNUAL)).toEqual({ days: 2, after: null, counted: false });
    // an unpaid leave edited into annual leave: nothing to give back, two to take
    const unpaid = { ...leave, type: { ...leave.type, id: 'unpaid', key: 'unpaid' } };
    expect(editPreview(typed({ typeId: 'annual' }), ANNUAL, ctx, unpaid, UNPAID).after).toBe(14);
  });

  it('gives nothing back for a rejected or cancelled leave, which counts for nothing', () => {
    expect(editPreview(typed(), ANNUAL, ctx, { ...leave, status: 'cancelled' }, ANNUAL).after).toBe(14);
    expect(editPreview(typed(), ANNUAL, ctx, { ...leave, status: 'rejected' }, ANNUAL).after).toBe(14);
    expect(editPreview(typed(), ANNUAL, ctx, { ...leave, status: 'with_hr' }, ANNUAL).after).toBe(16);
  });

  it('is counted on save without the balance of the first day’s year, or for dates not typed yet', () => {
    expect(editPreview(typed({ startDate: '05/01/2027', endDate: '' }), ANNUAL, ctx, leave, ANNUAL)).toEqual({ days: 1, after: null, counted: true });
    expect(editPreview(typed(), ANNUAL, { ...ctx, balances: null }, leave, ANNUAL)).toEqual({ days: 2, after: null, counted: true });
    expect(editPreview(typed({ startDate: 'soon' }), ANNUAL, ctx, leave, ANNUAL).days).toBe(0);
  });

  it('counts the half day and the holidays', () => {
    expect(editPreview(typed({ endDate: '', halfDay: true }), ANNUAL, ctx, leave, ANNUAL).days).toBe(0.5);
    expect(editPreview(typed(), ANNUAL, { ...ctx, holidays: [{ date: '2026-11-05' }] }, leave, ANNUAL).days).toBe(1);
  });

  it('says it in words', () => {
    expect(editPreviewText({ days: 2, after: 16, counted: false })).toBe('2 days · annual balance after it: 16');
    expect(editPreviewText({ days: 1, after: 15.5, counted: false })).toBe('1 day · annual balance after it: 15.5');
    expect(editPreviewText({ days: 2, after: null, counted: false })).toBe('2 days');
    expect(editPreviewText({ days: 2, after: null, counted: true })).toBe('2 days · the annual balance is counted on save');
    expect(editPreviewText({ days: 0, after: null, counted: false })).toBe('No days yet: choose the first and last day.');
  });
});

describe('what the form sends', () => {
  const ok = { typeId: 'casual', startDate: '06/11/2026', endDate: '', halfDay: 'false', reason: ' Moved ', coverId: '', note: ' Wrong day ' };

  it('every field as the API takes it: dates as YYYY-MM-DD, the last the first when empty, nothing as null', () => {
    expect(editBody(form(ok))).toEqual({
      body: { typeId: 'casual', startDate: '2026-11-06', endDate: '2026-11-06', halfDay: false, reason: 'Moved', coverId: null, note: 'Wrong day' },
      errors: [],
    });
    expect(editBody(form({ ...ok, endDate: '08/11/2026', halfDay: 'true', reason: '', coverId: '0b6f2f5e-8d0e-4c9a-9a39-6f0f5a1d2c3e', note: '' })).body).toMatchObject({
      endDate: '2026-11-08',
      halfDay: true,
      reason: null,
      coverId: '0b6f2f5e-8d0e-4c9a-9a39-6f0f5a1d2c3e',
      note: null,
    });
  });

  it('says what is wrong, all at once', () => {
    expect(editBody(form({ ...ok, typeId: '', startDate: 'soon' })).errors).toEqual(['Choose the type of leave.', 'Enter the first day as DD/MM/YYYY, e.g. 25/10/2026.']);
    expect(editBody(form({ ...ok, endDate: '05/11/2026' })).errors).toEqual(["The last day can't be before the first."]);
    expect(editBody(form({ ...ok, endDate: 'later' })).errors).toEqual(['Enter the last day as DD/MM/YYYY, e.g. 27/10/2026.']);
    expect(editBody(form({ ...ok, coverId: 'mona' })).errors).toEqual(['Choose the colleague who covers from the list.']);
    expect(editBody(form({ ...ok, reason: 'x'.repeat(501) })).errors).toEqual(['Keep the reason to 500 characters; it has 501.']);
    expect(editBody(form({ ...ok, note: 'x'.repeat(EDIT_NOTE_MAX + 1) })).errors).toEqual([`Keep the note to ${EDIT_NOTE_MAX} characters; it has ${EDIT_NOTE_MAX + 1}.`]);
    expect(editBody(form({ ...ok, startDate: '', typeId: '' })).body).toBeNull();
  });

  it('keeps what was typed for the form to show again', () => {
    expect(typedEditValues(form(ok))).toEqual({ typeId: 'casual', startDate: '06/11/2026', endDate: '', halfDay: 'false', reason: ' Moved ', coverId: '', note: ' Wrong day ' });
  });
});

describe('the hint', () => {
  it('says what an edit does for the leave’s status, and the import', () => {
    expect(editHint({ status: 'approved', imported: false })).toMatch(/^The balance and the month’s draft payroll follow it/);
    expect(editHint({ status: 'with_hr', imported: false })).toMatch(/^It stays with the same approver at the same step/);
    expect(editHint({ status: 'cancelled', imported: false })).toMatch(/^Only its fields change: no balance, no payroll\./);
    expect(editHint({ status: 'approved', imported: true })).toMatch(/ Undoing its import removes it, edits too\.$/);
    expect(editHint({ status: 'approved', imported: false })).not.toMatch(/import/);
  });
});
