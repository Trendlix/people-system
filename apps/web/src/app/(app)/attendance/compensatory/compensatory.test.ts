import { describe, expect, it } from 'vitest';
import type { CompensatoryCalendarItem, CompensatoryForm, CompensatoryRequestView } from '../../../../lib/compensatory-types';
import { calendarPeople, cellLabel } from '../../leave/calendar';
import { exemptBadge, compensatoryDaysText } from '../attendance';
import {
  compensatoryBack,
  compensatoryCancelBody,
  compensatoryDecisionBody,
  compensatoryDecisionButton,
  compensatoryDoneHref,
  compensatoryDoneText,
  compensatoryForm,
  compensatoryFormProblems,
  compensatoryFormWarning,
  compensatoryListHref,
  compensatoryListPath,
  compensatoryProgressText,
  compensatoryRecordForm,
  compensatoryReadyText,
  compensatoryDaysLine,
  hasCompensatoryFilters,
  readCompensatoryQuery,
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
