import { describe, expect, it } from 'vitest';
import { COMPENSATORY_RULE_DEFAULTS } from '@trendlix/shared';
import type { CompensatoryCalendarItem, CompensatoryForm, CompensatoryRequestView } from '../../../../lib/compensatory-types';
import { calendarPeople, cellLabel } from '../../leave/calendar';
import { exemptBadge, compensatoryDaysText, compensatoryHoursText } from '../attendance';
import {
  COMPENSATORY_SETUP_PATH,
  compensatoryBack,
  compensatoryCancelBody,
  compensatoryCashAddedText,
  compensatoryDayOffField,
  compensatoryDecisionBody,
  compensatoryDecisionButton,
  compensatoryDoneHref,
  compensatoryDoneText,
  compensatoryEarnsText,
  compensatoryForm,
  compensatoryFormProblems,
  compensatoryFormWarning,
  compensatoryHoursFact,
  compensatoryListHref,
  compensatoryListPath,
  compensatoryOdHref,
  compensatoryOdText,
  compensatoryOutcomeHint,
  compensatoryProgressText,
  compensatoryRecordCashText,
  compensatoryRecordForm,
  compensatoryReadyText,
  compensatoryRulesOf,
  compensatoryRulesText,
  compensatorySetupRows,
  compensatoryDaysLine,
  compensatoryWindowText,
  editsCompensatorySetup,
  hasCompensatoryFilters,
  readCompensatoryQuery,
  readCompensatorySetup,
  readHoursWorked,
  typedCompensatorySetup,
  typedSetupOf,
} from './compensatory';

// Compensatory days (owner, 26 October 2026: "my compensatory is a compensation with another day in the same month. and
// rarely to be compensated in cash"; "if paid in cash make it 1.5"). 2026-11-01 is a Sunday; the form's shift rests on
// Friday (11-06) and Saturday (11-07).

const ID = '11111111-2222-4333-8444-555555555555';
const DEPT = '66666666-7777-4888-8999-000000000000';

const fields = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
};

const FORM: CompensatoryForm = {
  refusal: null,
  offered: true,
  hasShift: true,
  today: '2026-11-12',
  cashDays: 1.5,
  workingDays: [0, 1, 2, 3, 4],
  holidays: [
    { date: '2026-11-10', nameEn: 'Test Day' },
    { date: '2026-11-24', nameEn: 'Later Day' },
  ],
  leave: [{ date: '2026-11-17', type: 'Annual leave', status: 'approved' }],
  other: [{ date: '2026-11-18', what: 'a work from home day' }],
  claimed: ['2026-11-07'],
  checkedIn: ['2026-11-06'],
  from: '2026-09-01',
  to: '2027-01-31',
};

const typed = (dayWorked: string, dayOff: string, reason = '') => ({ dayWorked, dayOff, reason });

describe('the request form’s live checks', () => {
  it('asks for both days first, as typed', () => {
    expect(compensatoryFormProblems(typed('', ''), FORM)).toEqual(['Enter the day you worked.', 'Enter the day off you ask for.']);
    expect(compensatoryFormProblems(typed('6/11', '16/11/2026'), FORM)).toEqual(['Enter the day worked as DD/MM/YYYY, e.g. 06/11/2026.']);
  });

  it('passes a rest day worked with a working day off a day ahead in the same month', () => {
    expect(compensatoryFormProblems(typed('06/11/2026', '16/11/2026'), FORM)).toEqual([]);
  });

  it('refuses a plain working day as the day worked', () => {
    expect(compensatoryFormProblems(typed('04/11/2026', '16/11/2026'), FORM)).toEqual([
      '04/11/2026 is a working day of your shift, not a rest day or an official holiday: there is nothing to compensate.',
    ]);
  });

  it('takes an official holiday as the day worked, and refuses one as the day off', () => {
    expect(compensatoryFormProblems(typed('10/11/2026', '16/11/2026'), FORM)).toEqual([]);
    expect(compensatoryFormProblems(typed('06/11/2026', '24/11/2026'), FORM)).toEqual(['24/11/2026 is an official holiday (Later Day): the day off must be a working day.']);
  });

  it('refuses a rest day, leave, another day off or an already claimed day', () => {
    expect(compensatoryFormProblems(typed('06/11/2026', '13/11/2026'), FORM)).toEqual(['13/11/2026 is a rest day of your shift: the day off must be a working day.']);
    expect(compensatoryFormProblems(typed('06/11/2026', '17/11/2026'), FORM)).toEqual(['You have Annual leave on 17/11/2026 (approved): it is a day off already.']);
    expect(compensatoryFormProblems(typed('06/11/2026', '18/11/2026'), FORM)).toEqual(['You have a work from home day on 18/11/2026 already.']);
    expect(compensatoryFormProblems(typed('07/11/2026', '16/11/2026'), FORM)).toEqual(['You have asked to compensate 07/11/2026 already.']);
  });

  it('keeps both days in one month', () => {
    expect(compensatoryFormProblems(typed('06/11/2026', '01/12/2026'), FORM)).toEqual([
      'The day off must be in the same month as the day worked: 06/11/2026 is in November 2026, 01/12/2026 in December 2026.',
    ]);
  });

  it('asks a day before at the latest: today and a past day off are refused', () => {
    expect(compensatoryFormProblems(typed('06/11/2026', '12/11/2026'), FORM)).toEqual(['12/11/2026 is today: ask for a compensatory day a day before the day off at the latest.']);
    expect(compensatoryFormProblems(typed('06/11/2026', '09/11/2026'), FORM)).toEqual(['09/11/2026 has gone by: only HR records a day off that is past.']);
  });

  it('says what refuses them at all, and leaves the rest to the API while the form couldn’t be read', () => {
    expect(compensatoryFormProblems(typed('06/11/2026', '16/11/2026'), { ...FORM, refusal: 'You work freelance.' })).toEqual(['You work freelance.']);
    expect(compensatoryFormProblems(typed('06/11/2026', '16/11/2026'), null)).toEqual([]);
  });

  it('warns, not refuses, a day worked with no check-in kept', () => {
    expect(compensatoryFormWarning(typed('06/11/2026', '16/11/2026'), FORM)).toBeNull();
    expect(compensatoryFormWarning(typed('10/11/2026', '16/11/2026'), FORM)).toBe('No check-in is kept on 10/11/2026: HR will ask to confirm you worked that day.');
    expect(compensatoryFormWarning(typed('', ''), FORM)).toBeNull();
  });

  it('says where the request goes once it is ready', () => {
    expect(compensatoryReadyText(typed('06/11/2026', '16/11/2026'))).toBe(
      'Ready to send: a compensatory day for Friday 06/11/2026, with a day off on Monday 16/11/2026, to your direct manager (without one, your lead), then HR.',
    );
    expect(compensatoryReadyText(typed('06/11/2026', '16/11/2026'), true)).toContain('then the CEO');
  });
});

describe('the forms sent', () => {
  it('sends the days as YYYY-MM-DD with the reason when there is one', () => {
    expect(compensatoryForm(fields({ dayWorked: '06/11/2026', dayOff: '16/11/2026' })).body).toEqual({ dayWorked: '2026-11-06', dayOff: '2026-11-16' });
    expect(compensatoryForm(fields({ dayWorked: '06/11/2026', dayOff: '16/11/2026', reason: ' Shoot ' })).body).toEqual({ dayWorked: '2026-11-06', dayOff: '2026-11-16', reason: 'Shoot' });
    expect(compensatoryForm(fields({ dayWorked: '', dayOff: '' })).errors).toEqual(['Enter the day you worked.', 'Enter the day off you ask for.']);
  });

  it('records for HR with the outcome, a reason required, a cash one without a day off', () => {
    expect(compensatoryRecordForm(fields({ employeeId: ID, dayWorked: '06/11/2026', dayOff: '16/11/2026', reason: 'By phone' })).body).toEqual({
      employeeId: ID,
      dayWorked: '2026-11-06',
      dayOff: '2026-11-16',
      outcome: 'day_off',
      reason: 'By phone',
    });
    expect(compensatoryRecordForm(fields({ employeeId: ID, dayWorked: '06/11/2026', outcome: 'cash', reason: 'Cash' })).body).toEqual({ employeeId: ID, dayWorked: '2026-11-06', outcome: 'cash', reason: 'Cash' });
    expect(compensatoryRecordForm(fields({ employeeId: ID, dayWorked: '06/11/2026', dayOff: '16/11/2026' })).errors).toEqual(['Write why HR records this compensatory day.']);
    expect(compensatoryRecordForm(fields({ dayWorked: '06/11/2026', dayOff: '16/11/2026', reason: 'x' })).errors).toEqual(['Choose the employee whose day it is.']);
  });

  it('decides: HR’s approval is a day off by default or cash, confirming a day with no check-in; a rejection needs a comment', () => {
    expect(compensatoryDecisionBody(fields({ decision: 'approve' }), 'manager').body).toEqual({ decision: 'approve' });
    expect(compensatoryDecisionBody(fields({ decision: 'approve' }), 'hr').body).toEqual({ decision: 'approve', outcome: 'day_off' });
    expect(compensatoryDecisionBody(fields({ decision: 'approve', outcome: 'cash', confirmNoCheckIn: 'on', comment: ' ok ' }), 'hr').body).toEqual({
      decision: 'approve',
      comment: 'ok',
      outcome: 'cash',
      confirmNoCheckIn: true,
    });
    expect(compensatoryDecisionBody(fields({ decision: 'reject' }), 'hr').errors).toEqual(['Write your comment: why the request is rejected.']);
    expect(compensatoryDecisionBody(fields({}), 'hr').errors).toEqual(['Choose your decision: approve or reject.']);
  });

  it('words the decision button by the stage and the outcome', () => {
    expect(compensatoryDecisionButton('approve', 'hr', 'day_off').label).toBe('Approve as a day off');
    expect(compensatoryDecisionButton('approve', 'hr', 'cash').label).toBe('Approve as cash instead');
    expect(compensatoryDecisionButton('approve', 'manager', 'day_off', true).label).toBe('Approve and send to the CEO');
    expect(compensatoryDecisionButton('reject', 'hr', 'day_off').label).toBe('Reject the request');
  });

  it('needs HR’s cancel comment', () => {
    expect(compensatoryCancelBody(fields({ comment: ' ' })).errors).toEqual(['Write why the compensatory day is cancelled: the employee sees it.']);
    expect(compensatoryCancelBody(fields({ comment: 'By mistake' })).body).toEqual({ comment: 'By mistake' });
  });
});

describe('the list and the addresses', () => {
  it('reads and writes the filters', () => {
    const q = readCompensatoryQuery({ status: 'approved', from: '01/11/2026', to: '2026-11-30', department: DEPT, employee: ID });
    expect(q).toEqual({ filter: 'approved', from: '2026-11-01', to: '2026-11-30', departmentId: DEPT, employeeId: ID });
    expect(compensatoryListHref(q)).toBe(`/attendance/compensatory?status=approved&from=2026-11-01&to=2026-11-30&department=${DEPT}&employee=${ID}`);
    expect(compensatoryListPath(q)).toBe(`/compensatory?status=approved&from=2026-11-01&to=2026-11-30&departmentId=${DEPT}&employeeId=${ID}`);
    expect(compensatoryListPath({})).toBe('/compensatory?status=waiting');
    expect(compensatoryListPath({ filter: 'all' })).toBe('/compensatory');
    expect(hasCompensatoryFilters(q)).toBe(true);
    expect(hasCompensatoryFilters(readCompensatoryQuery({}))).toBe(false);
  });

  it('swaps a From after the To and reads a month', () => {
    expect(readCompensatoryQuery({ from: '2026-11-30', to: '2026-11-01' })).toMatchObject({ from: '2026-11-01', to: '2026-11-30' });
    expect(readCompensatoryQuery({ month: '2026-11' })).toMatchObject({ from: '2026-11-01', to: '2026-11-30' });
  });

  it('goes back to the right list', () => {
    const r = { employee: { id: ID } } as Pick<CompensatoryRequestView, 'employee'>;
    expect(compensatoryBack({ roles: ['employee'], employeeId: ID }, r).label).toBe('My Requests');
    expect(compensatoryBack({ roles: ['hr'], employeeId: null }, r).label).toBe('Compensatory Days');
    expect(compensatoryBack({ roles: ['employee'], employeeId: null }, r).label).toBe('My Team');
  });

  it('says the days of a request and what was done', () => {
    expect(compensatoryDaysLine({ dayWorked: '2026-11-06', dayOff: '2026-11-16', outcome: null })).toBe('Worked Friday 06/11/2026 · day off Monday 16/11/2026');
    expect(compensatoryDaysLine({ dayWorked: '2026-11-06', dayOff: null, outcome: 'cash' })).toBe('Worked Friday 06/11/2026 · paid in cash instead');
    expect(compensatoryDoneHref(ID, 'hr_approve')).toBe(`/attendance/compensatory/${ID}?done=hr_approve`);
    expect(compensatoryDoneText({ done: 'hr_approve' }, 'approved', null, false, 'cash')?.text).toContain('cash instead');
    expect(compensatoryDoneText({ done: 'hr_approve' }, 'approved')?.text).toContain('day off');
    expect(compensatoryDoneText({ done: 'moved' }, 'approved')?.tone).toBe('warn');
    expect(compensatoryDoneText({ done: 'nonsense' }, 'approved')).toBeNull();
  });

  it('says where a request stands', () => {
    const base = { manager: null, rejectedStage: null, rejectReason: null, recordedByHr: false, confidential: false, steps: [] };
    expect(compensatoryProgressText({ ...base, status: 'with_hr' }).text).toBe('Waiting for HR');
  });
});

describe('the attendance and the calendar', () => {
  it('badges a compensatory day off apart from an exempt day', () => {
    expect(exemptBadge({ exempt: true, compensatory: true })?.label).toBe('Compensatory day off');
    expect(exemptBadge({ exempt: true })?.label).toBe('Exempt');
    expect(compensatoryDaysText({ compensatoryDays: 2 })).toBe('2 compensatory days off');
    expect(compensatoryDaysText({ compensatoryDays: 1 })).toBe('1 compensatory day off');
    expect(compensatoryDaysText({ compensatoryDays: 0 })).toBeNull();
  });

  it('shows the day off on the leave calendar as a day off, opening its request', () => {
    const item: CompensatoryCalendarItem = {
      id: ID,
      kind: 'compensatory',
      employee: { id: 'e1', fullNameEn: 'Nour Adel', department: 'Studio', team: null },
      type: { id: 'compensatory', nameEn: 'Compensatory day off', nameAr: 'يوم تعويضي' },
      startDate: '2026-11-16',
      endDate: '2026-11-16',
      halfDay: false,
      status: 'approved',
    };
    const days = ['2026-11-15', '2026-11-16', '2026-11-17'].map((date) => ({ date }));
    const [person] = calendarPeople([item as never], days);
    expect(person.daysOff).toBe(1);
    expect(person.cells[1]).toMatchObject({ typeName: 'Compensatory day off', requestId: ID, compensatory: true });
    expect(cellLabel(person.cells[1]!, 'Nour Adel', { date: '2026-11-16', weekdayName: 'Monday' })).toBe('Nour Adel: Compensatory day off, Monday 16/11/2026');
  });
});

// ---------- part of a day worked (owner, 27 October 2026: "Hours off for hours worked"; "up to 4 hours to be compensated
// by hours - minimum 6 hours can be compensated by a day", between them "Capped at 4 hours"; the minimum 2 hours) ----------

const partOf = (dayWorked: string, dayOff: string, hours: string) => ({ dayWorked, dayOff, reason: '', part: 'part' as const, hours });

describe('the hours worked', () => {
  it('reads the whole day as none, and part of it as its hours, a comma for the point too', () => {
    expect(readHoursWorked('whole', '4')).toEqual({ hoursWorked: null, error: null });
    expect(readHoursWorked(undefined, '')).toEqual({ hoursWorked: null, error: null });
    expect(readHoursWorked('part', '4')).toEqual({ hoursWorked: 4, error: null });
    expect(readHoursWorked('part', ' 3,5 ')).toEqual({ hoursWorked: 3.5, error: null });
    expect(readHoursWorked('part', '').error).toBe('Enter the hours worked, e.g. 4 or 3.5.');
    for (const bad of ['0', '25', 'four', '3.333', '-2']) expect(readHoursWorked('part', bad).error).toBe('Enter the hours worked as a number above 0, up to 24, e.g. 4 or 3.5.');
  });

  it('says live what they earn by the Setup', () => {
    const r = COMPENSATORY_RULE_DEFAULTS;
    expect(compensatoryEarnsText(null, r)).toBe('Earns a whole day off');
    expect(compensatoryEarnsText(1.5, r)).toBe('Earns nothing: fewer than 2 hours worked');
    expect(compensatoryEarnsText(2, r)).toBe('Earns 2 hours off');
    expect(compensatoryEarnsText(3.5, r)).toBe('Earns 3.5 hours off');
    expect(compensatoryEarnsText(4, r)).toBe('Earns 4 hours off');
    expect(compensatoryEarnsText(5, r)).toBe('Earns 4 hours off (capped at 4)');
    expect(compensatoryEarnsText(6, r)).toBe('Earns a whole day off (6 hours or more)');
    expect(compensatoryEarnsText(5, { minHours: 1, hoursCap: 3, fullDayHours: 8 })).toBe('Earns 3 hours off (capped at 3)');
    expect(compensatoryRulesText(r)).toBe('Under 2 hours earn nothing; from 2 hours, the same hours off, at most 4; 6 hours or more, a whole day (Compensatory Setup).');
    expect(compensatoryRulesText({ minHours: 6, hoursCap: 6, fullDayHours: 6 })).toBe('Under 6 hours earn nothing; 6 hours or more, a whole day (Compensatory Setup).');
  });

  it('names the day off by what is earned, its window the Setup’s', () => {
    expect(compensatoryDayOffField({ kind: 'day' }, { offWithinDays: null }, 'employee')).toEqual({
      label: 'Day off',
      hint: 'A working day in the same month as the day worked, tomorrow or later: not leave, work from home or an official holiday.',
    });
    const hours = compensatoryDayOffField({ kind: 'hours', hours: 4 }, { offWithinDays: 10 }, 'employee');
    expect(hours.label).toBe('Day for the hours off');
    expect(hours.hint).toBe(
      'A working day within 10 days after the day worked, tomorrow or later: not leave, work from home or an official holiday. The 4 hours off are counted as worked that day, with no deduction; you work the rest of it.',
    );
    expect(compensatoryDayOffField({ kind: 'hours', hours: 1 }, { offWithinDays: null }, 'hr').hint).toContain('The 1 hour off is counted as worked that day, with no deduction; they work the rest of it.');
    expect(compensatoryDayOffField(null, { offWithinDays: null }, 'hr').label).toBe('Day off');
    expect(compensatoryWindowText(1)).toBe('within 1 day after the day worked');
  });

  it('checks the hours live: to be read, and the Setup’s minimum', () => {
    expect(compensatoryFormProblems(partOf('06/11/2026', '16/11/2026', ''), FORM)).toEqual(['Enter the hours worked, e.g. 4 or 3.5.']);
    expect(compensatoryFormProblems(partOf('06/11/2026', '16/11/2026', '1.5'), FORM)).toEqual(['You worked 1.5 hours: fewer than the 2 hours that earn a compensation (Compensatory Setup).']);
    expect(compensatoryFormProblems(partOf('06/11/2026', '16/11/2026', '4'), FORM)).toEqual([]);
    // the form's own Setup: a minimum of 1 hour
    expect(compensatoryFormProblems(partOf('06/11/2026', '16/11/2026', '1.5'), { ...FORM, rules: { ...COMPENSATORY_RULE_DEFAULTS, minHours: 1 } })).toEqual([]);
  });

  it('checks the day off in the Setup’s window: within N days after the day worked, across months too', () => {
    const within = { ...FORM, rules: { ...COMPENSATORY_RULE_DEFAULTS, offWithinDays: 30 } };
    // Tuesday 01/12/2026, 25 days after: in the window though in another month
    expect(compensatoryFormProblems(typed('06/11/2026', '01/12/2026'), within)).toEqual([]);
    const ten = { ...FORM, rules: { ...COMPENSATORY_RULE_DEFAULTS, offWithinDays: 10 } };
    expect(compensatoryFormProblems(typed('06/11/2026', '16/11/2026'), ten)).toEqual([]);
    expect(compensatoryFormProblems(typed('06/11/2026', '19/11/2026'), ten)).toEqual(['The day off must be within 10 days after the day worked: from 07/11/2026 to 16/11/2026.']);
  });

  it('says what is sent: the hours worked and the hours off', () => {
    expect(compensatoryReadyText(partOf('06/11/2026', '16/11/2026', '5'))).toBe(
      'Ready to send: a compensatory day for 5 hours worked on Friday 06/11/2026, with 4 hours off on Monday 16/11/2026, to your direct manager (without one, your lead), then HR.',
    );
    expect(compensatoryReadyText(partOf('06/11/2026', '16/11/2026', '7'))).toContain('for Friday 06/11/2026, with a day off on Monday 16/11/2026');
  });

  it('sends the hours worked only for part of the day', () => {
    expect(compensatoryForm(fields({ dayWorked: '06/11/2026', dayOff: '16/11/2026', part: 'part', hoursWorked: '3,5' })).body).toEqual({ dayWorked: '2026-11-06', dayOff: '2026-11-16', hoursWorked: 3.5 });
    expect(compensatoryForm(fields({ dayWorked: '06/11/2026', dayOff: '16/11/2026', part: 'whole', hoursWorked: '4' })).body).toEqual({ dayWorked: '2026-11-06', dayOff: '2026-11-16' });
    expect(compensatoryForm(fields({ dayWorked: '06/11/2026', dayOff: '16/11/2026', part: 'part' })).errors).toEqual(['Enter the hours worked, e.g. 4 or 3.5.']);
    expect(compensatoryRecordForm(fields({ employeeId: ID, dayWorked: '06/11/2026', part: 'part', hoursWorked: '4', outcome: 'cash', reason: 'Shoot' })).body).toEqual({
      employeeId: ID,
      dayWorked: '2026-11-06',
      hoursWorked: 4,
      outcome: 'cash',
      reason: 'Shoot',
    });
  });

  it('words HR’s cash instead by what is earned: the check’s days’ pay for hours', () => {
    const r = COMPENSATORY_RULE_DEFAULTS;
    expect(compensatoryRecordCashText({ kind: 'day' }, r, null)).toMatch(/^Cash instead: an addition of 1.5 days' pay on the month's draft payroll, and no day off\./);
    expect(compensatoryRecordCashText({ kind: 'hours', hours: 4 }, r, 0.75)).toBe("Cash instead: 0.75 days' pay (4 hours at 1.5×) on the month's draft payroll, and no hours off.");
    expect(compensatoryRecordCashText({ kind: 'hours', hours: 4 }, r, null)).toBe("Cash instead: 4 hours' pay at 1.5× (in days' pay by their shift's hours a day) on the month's draft payroll, and no hours off.");
    expect(compensatoryRecordCashText({ kind: 'none', hours: 1 }, r, 0)).toBe('Nothing to pay: fewer than 2 hours worked earn nothing.');
  });
});

describe('a request with hours, and one with an official duty', () => {
  it('says the hours in its days', () => {
    expect(compensatoryDaysLine({ dayWorked: '2026-11-06', dayOff: '2026-11-10', outcome: null, hoursWorked: 4, hoursOff: 4 })).toBe('Worked Friday 06/11/2026 (4 hours) · 4 hours off Tuesday 10/11/2026');
    expect(compensatoryDaysLine({ dayWorked: '2026-11-06', dayOff: null, outcome: 'cash', hoursWorked: 4, hoursOff: 4 })).toBe('Worked Friday 06/11/2026 (4 hours) · paid in cash instead');
    expect(compensatoryDaysLine({ dayWorked: '2026-11-06', dayOff: '2026-11-10', outcome: 'day_off', hoursWorked: 7, hoursOff: null })).toBe('Worked Friday 06/11/2026 (7 hours) · day off Tuesday 10/11/2026');
    expect(compensatoryHoursFact({ hoursWorked: 5, hoursOff: 4 })).toBe('5 hours: earned 4 hours off (capped at 4)');
    expect(compensatoryHoursFact({ hoursWorked: 3, hoursOff: 3 })).toBe('3 hours: earned 3 hours off');
    expect(compensatoryHoursFact({ hoursWorked: 7, hoursOff: null })).toBe('7 hours: earned a whole day off');
    expect(compensatoryHoursFact({})).toBeNull();
    expect(compensatoryCashAddedText({ cashDays: 1.5, hoursOff: null })).toBe("An addition of 1.5 days' pay on the month's payroll.");
    expect(compensatoryCashAddedText({ cashDays: 1.5, hoursOff: 4 })).toBe("An addition of 4 hours' pay at 1.5× on the month's payroll.");
  });

  it('words HR’s decision in hours: hours off on the day, or the hours’ pay at the rate', () => {
    expect(compensatoryOutcomeHint('cash', { dayOff: '2026-11-10', hoursOff: 4 }, 1.5)).toMatch(/^Cash instead: 4 hours' pay at 1.5×, an addition on the draft payroll of the month, and no hours off\./);
    expect(compensatoryOutcomeHint('day_off', { dayOff: '2026-11-10', hoursOff: 4 }, 1.5)).toBe('4 hours off on Tuesday 10/11/2026: counted as worked hours that day, and nothing is paid for the hours worked.');
    expect(compensatoryOutcomeHint('day_off', { dayOff: '2026-11-10' }, 1.5)).toBe('A day off (the default): a full paid day, and nothing is paid for the day worked.');
    expect(compensatoryOutcomeHint('cash', { dayOff: null }, 1.5)).toMatch(/^Cash instead \(rarely\): an addition of 1.5 days' pay/);
    expect(compensatoryDecisionButton('approve', 'hr', 'day_off', false, true).label).toBe('Approve as hours off');
    expect(compensatoryDecisionButton('approve', 'hr', 'cash', false, true).label).toBe('Approve as cash instead');
  });

  it('says what was done in hours', () => {
    expect(compensatoryDoneText({ done: 'sent' }, 'with_manager', null, false, null, 4)?.text).toBe('Request sent for 4 hours off. It goes to your direct manager, then HR; each step shows on the request.');
    expect(compensatoryDoneText({ done: 'recorded' }, 'approved', null, false, 'day_off', 4)?.text).toBe('Compensatory hours recorded, approved at once: 4 hours off.');
    expect(compensatoryDoneText({ done: 'recorded' }, 'approved', null, false, 'cash', 1)?.text).toBe("Compensatory hours recorded, approved at once: 1 hour's pay in cash instead.");
    expect(compensatoryDoneText({ done: 'hr_approve' }, 'approved', null, false, 'day_off', 4)?.text).toBe('Approved as 4 hours off: they count as worked hours on the day off.');
    expect(compensatoryDoneText({ done: 'hr_approve' }, 'approved', null, false, 'cash', 4)?.text).toContain("the addition for 4 hours' pay is on the month’s draft payroll");
    expect(compensatoryDoneText({ done: 'recorded' }, 'approved')?.text).toBe('Compensatory day recorded, approved at once.');
  });

  it('links one an official duty carries to the duty, on the site and the phone pages', () => {
    expect(compensatoryOdText({ startDate: '2026-11-06' })).toBe('With the official duty on 06/11/2026');
    expect(compensatoryOdHref({ id: ID })).toBe(`/attendance/official-duty/${ID}`);
    expect(compensatoryOdHref({ id: ID }, 'approve')).toBe(`/app/approve/od/${ID}`);
    expect(compensatoryOdHref({ id: ID }, 'requests')).toBe(`/app/requests/od/${ID}`);
  });

  it('marks hours off on a day of the attendance', () => {
    expect(compensatoryHoursText({ compensatoryHours: 4 })).toBe('Compensatory hours off: 4 h');
    expect(compensatoryHoursText({ compensatoryHours: 2.5 })).toBe('Compensatory hours off: 2.5 h');
    expect(compensatoryHoursText({ compensatoryHours: 0 })).toBeNull();
    expect(compensatoryHoursText({})).toBeNull();
  });
});

// ---------- the Compensatory Setup (owner, 27 October 2026: "i need a setup dashboard for the compensatory leaves") ----------

describe('the Compensatory Setup', () => {
  it('is HR’s to change, under Compensatory Days', () => {
    expect(COMPENSATORY_SETUP_PATH).toBe('/attendance/compensatory/setup');
    expect(editsCompensatorySetup({ roles: ['hr'] })).toBe(true);
    for (const role of ['ceo', 'finance', 'admin', 'employee'] as const) expect(editsCompensatorySetup({ roles: [role] })).toBe(false);
  });

  it('reads the rules sent, the owner’s numbers for any an API from before them left out', () => {
    expect(compensatoryRulesOf(null)).toEqual({ cashRate: 1.5, minHours: 2, hoursCap: 4, fullDayHours: 6, offWithinDays: null });
    expect(compensatoryRulesOf({ cashRate: 2 })).toEqual({ cashRate: 2, minHours: 2, hoursCap: 4, fullDayHours: 6, offWithinDays: null });
    expect(compensatoryRulesOf({ cashRate: 1.5, minHours: 1, hoursCap: 3, fullDayHours: 5, offWithinDays: 14 })).toEqual({ cashRate: 1.5, minHours: 1, hoursCap: 3, fullDayHours: 5, offWithinDays: 14 });
  });

  it('fills the form from the rules and reads it back', () => {
    expect(typedSetupOf(COMPENSATORY_RULE_DEFAULTS)).toEqual({ cashRate: '1.5', minHours: '2', hoursCap: '4', fullDayHours: '6', window: 'month', offWithinDays: '' });
    expect(readCompensatorySetup(typedSetupOf(COMPENSATORY_RULE_DEFAULTS))).toEqual({ rules: COMPENSATORY_RULE_DEFAULTS, errors: [] });
    const sent = typedCompensatorySetup(fields({ cashRate: '2', minHours: '1,5', hoursCap: '4', fullDayHours: '6.5', window: 'days', offWithinDays: '14' }));
    expect(readCompensatorySetup(sent)).toEqual({ rules: { cashRate: 2, minHours: 1.5, hoursCap: 4, fullDayHours: 6.5, offWithinDays: 14 }, errors: [] });
    // the same month: the days typed are left out
    expect(readCompensatorySetup({ ...sent, window: 'month' }).rules?.offWithinDays).toBeNull();
  });

  it('refuses what the API refuses, in its words', () => {
    const ok = typedSetupOf(COMPENSATORY_RULE_DEFAULTS);
    expect(readCompensatorySetup({ ...ok, minHours: '' }).errors).toEqual(['Enter the minimum hours to qualify in whole or half hours from 0.5 to 24, e.g. 2.']);
    expect(readCompensatorySetup({ ...ok, cashRate: '1.25' }).errors).toEqual(["Enter the days' pay for cash instead in whole or half days from 0.5 to 5, e.g. 1.5."]);
    expect(readCompensatorySetup({ ...ok, hoursCap: '1' }).errors).toEqual(['The most hours off can’t be fewer than the minimum hours to qualify.']);
    expect(readCompensatorySetup({ ...ok, fullDayHours: '3' }).errors).toEqual(['The hours for a whole day can’t be fewer than the most hours off.']);
    expect(readCompensatorySetup({ ...ok, window: 'days', offWithinDays: '' }).errors).toEqual(['Enter the days after the day worked as a whole number from 1 to 60, or choose the same month.']);
    expect(readCompensatorySetup({ ...ok, window: 'days', offWithinDays: '61' }).rules).toBeNull();
  });

  it('explains the result with the current numbers (owner: "Capped at 4 hours")', () => {
    expect(compensatorySetupRows(COMPENSATORY_RULE_DEFAULTS)).toEqual([
      { worked: 'Under 2 h', earns: 'Nothing', example: '1.5 h → nothing', cash: '—' },
      { worked: '2 h to 4 h', earns: 'The same hours off', example: '3 h → 3 h off', cash: "0.56 days' pay (3 h at 1.5×, a shift of 8 h a day)" },
      { worked: 'Over 4 h, under 6 h', earns: '4 h off, the most', example: '5 h → 4 h off', cash: "0.75 days' pay (4 h at 1.5×, a shift of 8 h a day)" },
      { worked: '6 h or more, or the whole day', earns: 'A whole day off', example: '6 h+ → a whole day', cash: "1.5 days' pay" },
    ]);
  });

  it('leaves out a range the numbers leave empty', () => {
    // the cap at a whole day's hours: nothing is capped
    expect(compensatorySetupRows({ ...COMPENSATORY_RULE_DEFAULTS, hoursCap: 6 }).map((r) => [r.worked, r.example])).toEqual([
      ['Under 2 h', '1.5 h → nothing'],
      ['2 h to under 6 h', '4 h → 4 h off'],
      ['6 h or more, or the whole day', '6 h+ → a whole day'],
    ]);
    // all at 6: a whole day or nothing
    expect(compensatorySetupRows({ cashRate: 2, minHours: 6, hoursCap: 6, fullDayHours: 6, offWithinDays: null }).map((r) => r.worked)).toEqual(['Under 6 h', '6 h or more, or the whole day']);
    // the minimum at the cap; a half hour minimum; a cap half an hour under a whole day
    expect(compensatorySetupRows({ ...COMPENSATORY_RULE_DEFAULTS, minHours: 2, hoursCap: 2 })[1]).toMatchObject({ worked: '2 h', example: '2 h → 2 h off' });
    expect(compensatorySetupRows({ ...COMPENSATORY_RULE_DEFAULTS, minHours: 0.5 })[0].example).toBe('0.25 h → nothing');
    expect(compensatorySetupRows({ ...COMPENSATORY_RULE_DEFAULTS, hoursCap: 4, fullDayHours: 4.5 })[2]).toMatchObject({ worked: 'Over 4 h, under 4.5 h', example: '4.25 h → 4 h off' });
  });
});
