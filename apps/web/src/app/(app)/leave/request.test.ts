import { describe, expect, it } from 'vitest';
import type { LeaveBalances, LeaveTypeView } from '../../../lib/types';
import {
  balanceAfter,
  countLeaveDays,
  countText,
  coverProblems,
  datesLine,
  documentProblems,
  endFollowingStart,
  fullMonths,
  leaveForm,
  leaveFormProblems,
  mayGoOverBalance,
  offeredTypes,
  overBalanceNote,
  personFacts,
  readDates,
  requestYear,
  workingDaysOf,
  type LeaveContext,
  type TypedLeave,
} from './request';

// invented types and balances, after the law's (Labour Law 14/2025, Arts. 124–131)
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
const CASUAL = type({ id: 'casual', key: 'casual', kind: 'casual', nameEn: 'Casual leave', balance: 'from_annual', daysPerYear: 7, maxPerRequest: 2, sortOrder: 2 });
const EXAM = type({ id: 'exam', key: 'exam', kind: 'exam', nameEn: 'Exam leave', balance: 'none', noticeDays: 10, documentRequired: true, halfDays: false, sortOrder: 5 });
const MATERNITY = type({ id: 'maternity', key: 'maternity', kind: 'maternity', nameEn: 'Maternity leave', balance: 'per_request', maxPerRequest: 120, gender: 'female', calendarDays: true, halfDays: false, sortOrder: 6 });
const BIRTH = type({ id: 'birth', key: 'birth', kind: 'birth', nameEn: 'Birth of a child', balance: 'per_request', maxPerRequest: 1, maxTimesInService: 3, gender: 'male', halfDays: false, sortOrder: 4 });

const balances: LeaveBalances = {
  year: 2026,
  annual: { entitlement: 21, usableFrom: '2026-01-01', carriedIn: 0, adjustments: 0, taken: 15, booked: 0, pending: 2, available: 4 },
  types: [{ typeId: 'casual', nameEn: 'Casual leave', nameAr: 'إجازة عارضة', used: 6, timesInService: 4, left: 1 }],
};

const ctx = (c: Partial<LeaveContext> = {}): LeaveContext => ({
  workingDays: [0, 1, 2, 3, 4],
  holidays: [{ date: '2026-10-06' }],
  balances,
  joinDate: '2020-03-01',
  gender: 'male',
  today: '2026-10-18',
  byHr: false,
  ...c,
});

const typed = (t: Partial<TypedLeave>): TypedLeave => ({ typeId: 'annual', startDate: '', endDate: '', halfDay: false, reason: '', ...t });

describe('the dates as typed', () => {
  it('are read as DD/MM/YYYY, the last day the first when left empty', () => {
    expect(readDates({ startDate: '25/10/2026', endDate: '' })).toEqual({ startDate: '2026-10-25', endDate: '2026-10-25' });
    expect(readDates({ startDate: '25/10/2026', endDate: '27/10/2026' })).toEqual({ startDate: '2026-10-25', endDate: '2026-10-27' });
    expect(readDates({ startDate: 'soon', endDate: '' })).toEqual({ startDate: '', endDate: '' });
    expect(requestYear({ startDate: '05/01/2027' }, '2026-10-18')).toBe(2027);
    expect(requestYear({ startDate: '' }, '2026-10-18')).toBe(2026);
  });
});

describe('the days counted as the law counts them (Art. 124)', () => {
  it('are the shift’s working days, the rest days and official holidays left out', () => {
    // Sunday 4 to Thursday 8 October 2026, with Armed Forces Day on Tuesday the 6th: 4 days
    expect(countLeaveDays(typed({ startDate: '04/10/2026', endDate: '08/10/2026' }), ANNUAL, ctx())).toBe(4);
    // Thursday 8 to Sunday 11: Friday and Saturday are rest days, 2 days
    expect(countLeaveDays(typed({ startDate: '08/10/2026', endDate: '11/10/2026' }), ANNUAL, ctx())).toBe(2);
    // a shift working Saturdays too
    expect(countLeaveDays(typed({ startDate: '08/10/2026', endDate: '11/10/2026' }), ANNUAL, ctx({ workingDays: [6, 0, 1, 2, 3, 4] }))).toBe(3);
  });

  it('are calendar days for a type counted so, and half a day less for a half day', () => {
    expect(countLeaveDays(typed({ startDate: '01/10/2026', endDate: '10/10/2026' }), MATERNITY, ctx())).toBe(10);
    expect(countLeaveDays(typed({ startDate: '25/10/2026', halfDay: true }), ANNUAL, ctx())).toBe(0.5);
    // a type without half days counts the whole day
    expect(countLeaveDays(typed({ startDate: '25/10/2026', halfDay: true }), EXAM, ctx())).toBe(1);
    expect(countLeaveDays(typed({ startDate: '' }), ANNUAL, ctx())).toBe(0);
  });

  it('take Sunday to Thursday without a shift', () => {
    expect(workingDaysOf(null)).toEqual([0, 1, 2, 3, 4]);
    expect(workingDaysOf([])).toEqual([0, 1, 2, 3, 4]);
    expect(workingDaysOf([6, 0])).toEqual([6, 0]);
  });
});

describe('the checks shown live, as the API checks them (leaveRequestProblems)', () => {
  it('ask for a type and the first day first', () => {
    expect(leaveFormProblems(typed({ typeId: '' }), null, [], ctx())).toEqual(['Choose the type of leave.', 'Enter the first day of the leave.']);
    expect(leaveFormProblems(typed({ startDate: '31/02/2026' }), ANNUAL, [], ctx())).toEqual(['Enter the first day as DD/MM/YYYY, e.g. 25/10/2026.']);
  });

  it('pass a request within the annual balance', () => {
    expect(leaveFormProblems(typed({ startDate: '25/10/2026', endDate: '27/10/2026' }), ANNUAL, [], ctx())).toEqual([]);
  });

  it('stop one over the annual balance, and casual leave over 2 days at a time or 7 a year (Art. 128)', () => {
    expect(leaveFormProblems(typed({ startDate: '25/10/2026', endDate: '29/10/2026' }), ANNUAL, [], ctx())).toEqual(['Only 4 days left of the annual balance.']);
    const casual = leaveFormProblems(typed({ typeId: 'casual', startDate: '25/10/2026', endDate: '27/10/2026' }), CASUAL, [], ctx());
    expect(casual).toContain('Casual leave is at most 2 days at a time; this is 3 days.');
    expect(casual).toContain("Only 1 day left of casual leave's 7 days a year.");
  });

  it('need the notice of an employee’s exam leave, but not when HR records it, and its document', () => {
    const asked = leaveFormProblems(typed({ typeId: 'exam', startDate: '20/10/2026' }), EXAM, [], ctx());
    expect(asked).toContain("Exam leave needs 10 days' notice: the first day can be 28/10/2026 at the earliest.");
    expect(asked).toContain('Attach a document: exam leave needs one.');
    const recorded = leaveFormProblems(typed({ typeId: 'exam', startDate: '20/10/2026' }), EXAM, [{ name: 'proof.pdf', size: 1000, type: 'application/pdf' }], ctx({ byHr: true }));
    expect(recorded).toEqual([]);
  });

  it('keep a type for one gender to it, and count the times in service', () => {
    expect(leaveFormProblems(typed({ typeId: 'maternity', startDate: '01/11/2026' }), MATERNITY, [], ctx())).toContain('Maternity leave is for female employees only.');
    const born = { ...balances, types: [{ typeId: 'birth', nameEn: 'Birth of a child', nameAr: 'إجازة مولود', used: 0, timesInService: 3, left: null }] };
    expect(leaveFormProblems(typed({ typeId: 'birth', startDate: '25/10/2026' }), BIRTH, [], ctx({ balances: born }))).toEqual([
      'Birth of a child can be taken 3 times in service, and it has been already.',
    ]);
  });

  it('leave the annual balance to the API when it couldn’t be read', () => {
    expect(leaveFormProblems(typed({ startDate: '25/10/2026', endDate: '29/10/2026' }), ANNUAL, [], ctx({ balances: null }))).toEqual([]);
  });

  it('check the reason’s length and the documents', () => {
    expect(leaveFormProblems(typed({ startDate: '25/10/2026', reason: 'x'.repeat(501) }), ANNUAL, [], ctx())).toEqual(['Keep the reason to 500 characters; it has 501.']);
    expect(documentProblems([{ name: 'a.docx', size: 10, type: 'application/msword' }])).toEqual(["a.docx can't be attached: a document is a photo (JPG, PNG or WebP) or a PDF."]);
    expect(documentProblems([1, 2, 3, 4].map((i) => ({ name: `${i}.jpg`, size: 10, type: 'image/jpeg' })))).toEqual(['Attach at most 3 documents; remove 1.']);
    expect(documentProblems([{ name: 'big.pdf', size: 11 * 1024 * 1024, type: 'application/pdf' }])).toEqual(['Each document must be 10 MB or smaller.']);
  });
});

describe('what the form says of the days', () => {
  it('says the annual balance left once taken, for a type from it', () => {
    expect(balanceAfter(ANNUAL, balances, 3)).toBe(1);
    expect(balanceAfter(CASUAL, balances, 1)).toBe(3);
    expect(balanceAfter(EXAM, balances, 1)).toBeNull();
    expect(balanceAfter(ANNUAL, null, 1)).toBeNull();
    expect(countText(3, 1, false)).toBe('3 days, from the annual balance: 1 left after it, as far as is approved.');
    expect(countText(3, 1, true)).toBe('3 days, from the annual balance: 1 left after it.');
    expect(countText(1, null, false)).toBe('1 day.');
    expect(countText(0, null, false)).toBe('No days yet: choose the first and last day.');
  });

  it('counts full months of service', () => {
    expect(fullMonths('2026-03-15', '2026-04-14')).toBe(0);
    expect(fullMonths('2026-03-15', '2026-04-15')).toBe(1);
    expect(fullMonths('2020-03-01', '2026-10-18')).toBe(79);
    expect(fullMonths(null, '2026-10-18')).toBe(0);
  });
});

describe('the types offered and who it is for', () => {
  it('offers the active types in their order, without those for the other gender', () => {
    const all = [MATERNITY, CASUAL, { ...EXAM, active: false }, ANNUAL, BIRTH];
    expect(offeredTypes(all, 'male').map((t) => t.id)).toEqual(['annual', 'casual', 'birth']);
    expect(offeredTypes(all, 'female').map((t) => t.id)).toEqual(['annual', 'casual', 'maternity']);
    expect(offeredTypes(all, null).map((t) => t.id)).toEqual(['annual', 'casual', 'birth', 'maternity']);
  });

  it('reads the shift days, the join date and the gender off a profile', () => {
    const facts = personFacts({
      fullNameEn: 'Nour Adel',
      gender: 'female',
      employment: { joinDate: '2024-02-01', shift: { id: 's', code: 'A', startTime: '09:00', endTime: '18:00', workingDays: [0, 1, 2, 3, 4] } } as never,
    });
    expect(facts).toEqual({ name: 'Nour Adel', workingDays: [0, 1, 2, 3, 4], joinDate: '2024-02-01', gender: 'female' });
    expect(personFacts({ fullNameEn: 'X', gender: null, employment: null })).toEqual({ name: 'X', workingDays: null, joinDate: null, gender: null });
  });
});

describe('the form as the server action reads it', () => {
  const form = (entries: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.append(k, v);
    return f;
  };

  it('sends the dates as YYYY-MM-DD, the half day as true or false, the reason', () => {
    expect(leaveForm(form({ typeId: 'annual', startDate: '25/10/2026', endDate: '', halfDay: 'true', reason: ' Family ' }))).toEqual({
      fields: { typeId: 'annual', startDate: '2026-10-25', endDate: '2026-10-25', halfDay: true, reason: 'Family', coverId: '', handoverNote: '', standIn: '' },
      documents: [],
      errors: [],
    });
  });

  it('sends the colleague who covers, the handover note and the stand-in (25 October 2026)', () => {
    const cover = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    const sent = leaveForm(form({ typeId: 'annual', startDate: '25/10/2026', endDate: '28/10/2026', coverId: cover, handoverNote: ' The client files ', standIn: 'hr' }));
    expect(sent.fields).toMatchObject({ coverId: cover, handoverNote: 'The client files', standIn: 'hr' });
    expect(leaveForm(form({ typeId: 'annual', startDate: '25/10/2026', endDate: '', coverId: 'x', standIn: 'y' })).errors).toEqual([
      'Choose the colleague who covers from the list.',
      'Choose your stand-in from the list, or HR.',
    ]);
    expect(leaveForm(form({ typeId: 'annual', startDate: '25/10/2026', endDate: '', handoverNote: 'x'.repeat(1001) })).errors).toEqual([
      'Keep the handover note to 1000 characters; it has 1001.',
    ]);
  });

  it('needs a cover when the API says so, and the note within its length', () => {
    expect(coverProblems(true, '', '')).toEqual(['Choose the colleague who covers your work: leave of more than 2 working days needs one.']);
    expect(coverProblems(true, 'c', '')).toEqual([]);
    expect(coverProblems(false, '', '')).toEqual([]);
    expect(coverProblems(false, '', 'x'.repeat(1001))).toEqual(['Keep the handover note to 1000 characters; it has 1001.']);
  });

  it('says what is wrong before the upload', () => {
    expect(leaveForm(form({ typeId: '', startDate: 'x', endDate: '' })).errors).toEqual(['Choose the type of leave.', 'Enter the first day as DD/MM/YYYY, e.g. 25/10/2026.']);
    expect(leaveForm(form({ typeId: 'a', startDate: '27/10/2026', endDate: '25/10/2026' })).errors).toEqual(["The last day can't be before the first."]);
  });
});

describe('the last day follows the first (owner, 26 October 2026)', () => {
  it('moves by the same number of days, so the leave keeps its length', () => {
    // a one-day leave moved from 05/11 to 04/11 stays one day
    expect(endFollowingStart('2026-11-05', '04/11/2026', '05/11/2026', false)).toBe('04/11/2026');
    // two days later, the last day two days later (over a month's end)
    expect(endFollowingStart('2026-11-05', '07/11/2026', '28/11/2026', false)).toBe('30/11/2026');
    expect(endFollowingStart('2026-11-29', '01/12/2026', '30/11/2026', false)).toBe('02/12/2026');
  });

  it('stays where it is when it was set by hand, is empty, or a date is still being typed', () => {
    expect(endFollowingStart('2026-11-05', '04/11/2026', '05/11/2026', true)).toBe('05/11/2026');
    expect(endFollowingStart('2026-11-05', '04/11/2026', '', false)).toBe('');
    expect(endFollowingStart('2026-11-05', '04/11/202', '05/11/2026', false)).toBe('05/11/2026');
    expect(endFollowingStart('', '04/11/2026', '05/11/2026', false)).toBe('05/11/2026');
    expect(endFollowingStart('2026-11-05', '05/11/2026', '06/11/2026', false)).toBe('06/11/2026');
  });
});

describe('the line above Save', () => {
  it('says the weekdays, the dates and the days', () => {
    expect(datesLine({ startDate: '05/11/2026', endDate: '06/11/2026' }, 2)).toBe('Thursday 05/11/2026 to Friday 06/11/2026 · 2 days');
    expect(datesLine({ startDate: '05/11/2026', endDate: '' }, 1)).toBe('Thursday 05/11/2026 · 1 day');
    expect(datesLine({ startDate: '06/11/2026', endDate: '05/11/2026' }, 0)).toBe("The last day can't be before the first.");
    expect(datesLine({ startDate: '', endDate: '' }, 0)).toBeNull();
  });
});

describe('leave beyond the balance is a Super Admin’s (owner, 26 October 2026)', () => {
  const dates = typed({ startDate: '25/10/2026', endDate: '29/10/2026' });

  it('HR is refused as before; a Super Admin’s record is let through', () => {
    expect(leaveFormProblems(dates, ANNUAL, [], ctx({ byHr: true }))).toEqual(['Only 4 days left of the annual balance.']);
    expect(leaveFormProblems(dates, ANNUAL, [], ctx({ byHr: true, allowNegative: true }))).toEqual([]);
  });

  it('warns a Super Admin of the balance it leaves', () => {
    expect(overBalanceNote(ANNUAL, balances, 5)).toBe('This leaves the annual balance at −1 day.');
    expect(overBalanceNote(ANNUAL, balances, 6)).toBe('This leaves the annual balance at −2 days.');
    expect(overBalanceNote(ANNUAL, balances, 4)).toBeNull();
    expect(overBalanceNote(type({ id: 'unpaid', balance: 'none' }), balances, 9)).toBeNull();
    expect(overBalanceNote(ANNUAL, null, 9)).toBeNull();
  });

  it('only a Super Admin in their own session may', () => {
    expect(mayGoOverBalance({ roles: ['super_admin'] })).toBe(true);
    expect(mayGoOverBalance({ roles: ['hr', 'ceo'] })).toBe(false);
    expect(mayGoOverBalance({ roles: ['super_admin'], developer: true })).toBe(false);
    expect(mayGoOverBalance({ roles: ['super_admin'], viewAs: { act: true } })).toBe(false);
  });
});

describe('casual leave’s days a year are a share in the year someone joins (owner, 26 October 2026: "Yes, a share")', () => {
  it('a joiner on 1 July has 3.5 of 7', () => {
    const joiner = ctx({ joinDate: '2026-07-01', balances: { ...balances, annual: { ...balances.annual, available: 10, usableFrom: '2026-01-01' }, types: [] } });
    const found = leaveFormProblems(typed({ typeId: 'casual', startDate: '25/10/2026' }), CASUAL, [], joiner);
    expect(found).toEqual([]);
    const withUsed = ctx({ joinDate: '2026-07-01', balances: { ...balances, annual: { ...balances.annual, available: 10 }, types: [{ typeId: 'casual', nameEn: 'Casual leave', nameAr: '', used: 3, timesInService: 2, left: 0.5 }] } });
    expect(leaveFormProblems(typed({ typeId: 'casual', startDate: '25/10/2026', endDate: '26/10/2026' }), CASUAL, [], withUsed)).toContain("Only 0.5 days left of casual leave's 3.5 days a year.");
  });

  it('a full year is 7', () => {
    expect(leaveFormProblems(typed({ typeId: 'casual', startDate: '25/10/2026' }), CASUAL, [], ctx())).toEqual([]);
  });
});
