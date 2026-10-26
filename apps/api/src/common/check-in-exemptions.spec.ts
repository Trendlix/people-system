import {
  attendanceDayView,
  attendanceFigures,
  attendanceLineInputs,
  exemptDays,
  exemptionInputProblems,
  exemptionLockProblem,
  exemptionMonths,
  exemptionOverlapProblem,
  exemptionState,
  exemptionWhenText,
  exemptOn,
  historyDay,
  suggestedExemptionStart,
  zonedMoment,
  type ExemptionStartContract,
  type SourcedDay,
} from '@trendlix/shared';
import { remindersDue, type ReminderFacts, type ReminderPerson } from '../notifications/reminder-rules.js';

// People exempt from check-in (owner, 25 October 2026: "allow me to select people that are not eligable for attendance
// checkins and outs, trat them as if they achived their full working hours"; asked, "Optional check-in"):
// packages/shared check-in-exemptions.ts, what an exempt day counts in the pages (attendance-days.ts), the history
// (attendance-history.ts) and the payroll (attendance-import.ts), and the reminders (notifications/reminder-rules.ts).

const MONTH = '2026-10';
const at = (day: string, time: string) => new Date(zonedMoment(day, time)).toISOString();
const ctx = (over: Partial<Parameters<typeof exemptDays>[2]> = {}) => ({
  month: MONTH,
  today: '2026-10-25',
  workingDays: [0, 1, 2, 3, 4],
  holidays: ['2026-10-06'],
  leaveDays: ['2026-10-13'],
  employedFrom: '2026-01-01',
  employedTo: null,
  hoursADay: 9,
  ...over,
});
const kept = (date: string, over: Partial<SourcedDay> = {}): SourcedDay => ({
  date,
  status: 'worked',
  checkIn: null,
  checkOut: null,
  place: null,
  zohoStatus: null,
  permissionHours: 0,
  hoursCounted: 0,
  source: 'system',
  flags: [],
  ...over,
});
const OCTOBER = [{ startDate: '2026-10-01', endDate: '2026-10-31' }];

describe('an exemption period', () => {
  it('covers its days from the first to the last, or with no end; is upcoming, current or ended', () => {
    const p = { startDate: '2026-10-05', endDate: '2026-10-10' };
    expect([exemptOn('2026-10-04', [p]), exemptOn('2026-10-05', [p]), exemptOn('2026-10-10', [p]), exemptOn('2026-10-11', [p])]).toEqual([false, true, true, false]);
    expect(exemptOn('2030-01-01', [{ startDate: '2026-10-05', endDate: null }])).toBe(true);
    expect([exemptionState(p, '2026-10-01'), exemptionState(p, '2026-10-07'), exemptionState(p, '2026-10-11')]).toEqual(['upcoming', 'current', 'ended']);
    expect(exemptionWhenText(p)).toBe('From 05/10/2026 until 10/10/2026');
    expect(exemptionWhenText({ startDate: '2026-10-05', endDate: null })).toBe('From 05/10/2026, no end date');
  });

  it('needs a reason and its dates in order; today when no first day is given', () => {
    expect(exemptionInputProblems({ reason: ' ' }, '2026-10-25')).toEqual(['Write why they are exempt from check-in, e.g. works at the client’s site all month.']);
    expect(exemptionInputProblems({ reason: 'x'.repeat(501) }, '2026-10-25')).toEqual(['Keep the reason to 500 characters; it has 501.']);
    expect(exemptionInputProblems({ reason: 'Works at the client', startDate: '2026-10-25', endDate: '2026-10-24' }, '2026-10-25')).toEqual(["The last day can't be before the first."]);
    expect(exemptionInputProblems({ reason: 'Works at the client', endDate: '2026-10-24' }, '2026-10-25')).toEqual(["The last day can't be before the first."]);
    expect(exemptionInputProblems({ reason: 'Works at the client', startDate: '2026-02-30' }, '2026-10-25')).toEqual(['Enter the first day of the exemption, e.g. 2026-11-01.']);
    expect(exemptionInputProblems({ reason: 'Works at the client', startDate: null, endDate: '' }, '2026-10-25')).toEqual([]);
  });

  it('never overlaps another of the person’s', () => {
    const others = [{ startDate: '2026-10-01', endDate: '2026-10-15' }];
    expect(exemptionOverlapProblem({ startDate: '2026-10-15', endDate: null }, others, 'Rania Invented')).toBe(
      'Rania Invented is exempt from check-in already, from 01/10/2026 until 15/10/2026: end that one first, or start this one after it.',
    );
    expect(exemptionOverlapProblem({ startDate: '2026-10-16', endDate: null }, others, 'Rania Invented')).toBeNull();
    expect(exemptionOverlapProblem({ startDate: '2026-09-01', endDate: '2026-09-30' }, [{ startDate: '2026-10-01', endDate: null }], 'Rania Invented')).toBeNull();
  });

  it('never changes a month whose payroll is with the CEO, approved or paid', () => {
    const locked = [
      { month: '2026-09', status: 'paid' },
      { month: '2026-10', status: 'draft' },
    ];
    expect(exemptionLockProblem('2026-09-20', null, locked, 'start')).toBe("The September 2026 payroll is paid, so its days can't change: start the exemption from 01/10/2026 or later.");
    expect(exemptionLockProblem('2026-10-01', null, locked, 'start')).toBeNull();
    expect(exemptionLockProblem('2026-08-01', '2026-08-31', locked, 'start')).toBeNull();
    expect(exemptionLockProblem('2026-10-26', null, [{ month: '2026-10', status: 'pending_ceo' }], 'end')).toBe(
      "The October 2026 payroll is with the CEO, so its days can't change: the exemption can't end before 31/10/2026.",
    );
    expect(exemptionMonths('2026-11-15', '2027-01-02')).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

// The owner, 26 October 2026: "when exempting someone from attendance auto fill his contract start date in the exempt
// from date". Their contract's start, else their join date, else today.
describe('the first day a new exemption starts with', () => {
  const TODAY = '2026-10-26';
  const v = (over: Partial<ExemptionStartContract>): ExemptionStartContract => ({ number: 'CON-2025-0012', version: 1, kind: 'contract', status: 'active', startDate: '2025-07-30', ...over });

  it('is the start of the contract in force, with its number', () => {
    expect(suggestedExemptionStart({ joinDate: '2025-07-01', contracts: [v({})] }, TODAY)).toEqual({ date: '2025-07-30', source: 'contract', contractNumber: 'CON-2025-0012' });
    // a renewal in force: its own start, not the first contract's
    expect(
      suggestedExemptionStart({ joinDate: '2025-07-01', contracts: [v({ status: 'superseded' }), v({ number: 'CON-2026-0031', version: 2, startDate: '2026-07-30' })] }, TODAY),
    ).toEqual({ date: '2026-07-30', source: 'contract', contractNumber: 'CON-2026-0031' });
  });

  it('for a salary amendment in force, is the start of the contract it amends', () => {
    const contracts = [
      v({ status: 'superseded' }),
      v({ number: 'CON-2025-0012-A1', version: 2, kind: 'amendment', status: 'superseded', startDate: '2026-01-01' }),
      v({ number: 'CON-2025-0012-A2', version: 3, kind: 'amendment', startDate: '2026-07-01' }),
    ];
    expect(suggestedExemptionStart({ joinDate: '2025-07-01', contracts }, TODAY)).toEqual({ date: '2025-07-30', source: 'contract', contractNumber: 'CON-2025-0012' });
    // without the contract before it among those read: the amendment's own
    expect(suggestedExemptionStart({ joinDate: '2025-07-01', contracts: [contracts[2]] }, TODAY)).toEqual({ date: '2026-07-01', source: 'contract', contractNumber: 'CON-2025-0012-A2' });
  });

  it('without a contract in force (none signed yet, a draft, one ended), is the join date', () => {
    expect(suggestedExemptionStart({ joinDate: '2026-09-14', contracts: [] }, TODAY)).toEqual({ date: '2026-09-14', source: 'join', contractNumber: null });
    expect(suggestedExemptionStart({ joinDate: '2026-09-14', contracts: [v({ status: 'draft', startDate: '2026-09-14' })] }, TODAY)).toMatchObject({ source: 'join' });
    expect(suggestedExemptionStart({ joinDate: '2024-03-01', contracts: [v({ status: 'ended' }), v({ status: 'superseded', version: 2 })] }, TODAY)).toEqual({
      date: '2024-03-01',
      source: 'join',
      contractNumber: null,
    });
  });

  it('without a current employment, is today, as before', () => {
    expect(suggestedExemptionStart(null, TODAY)).toEqual({ date: TODAY, source: 'today', contractNumber: null });
    expect(suggestedExemptionStart({ joinDate: null, contracts: [] }, TODAY)).toEqual({ date: TODAY, source: 'today', contractNumber: null });
  });
});

describe('an exempt day', () => {
  it('with no presses: full hours, not absent; holidays, rest days, leave and days to come as they are', () => {
    const days = exemptDays([kept('2026-10-12', { status: 'absent' })], OCTOBER, ctx());
    const byDate = new Map(days.map((d) => [d.date, d]));
    // a working day gone by with nothing kept, and one kept absent: worked, 9 hours, exempt
    expect(byDate.get('2026-10-01')).toMatchObject({ status: 'worked', hoursCounted: 9, exempt: true, source: 'system' });
    expect(byDate.get('2026-10-12')).toMatchObject({ status: 'worked', hoursCounted: 9, exempt: true });
    // the holiday, Friday and Saturday, the day of leave, the days after today: none added
    for (const d of ['2026-10-06', '2026-10-02', '2026-10-03', '2026-10-13', '2026-10-26']) expect(byDate.has(d)).toBe(false);
    // a day of leave kept stays leave, unpaid leave too
    expect(exemptDays([kept('2026-10-13', { status: 'leave' })], OCTOBER, ctx()).find((d) => d.date === '2026-10-13')).toMatchObject({ status: 'leave' });
    const view = attendanceDayView(byDate.get('2026-10-12')!, 9);
    expect(view).toMatchObject({ shortHours: 0, extraHours: 0, missingCheckIn: false, missingCheckOut: false, exempt: true });
    const f = attendanceFigures(days.map((d) => attendanceDayView(d, 9)));
    expect(f.absentDays).toBe(0);
    expect(f.exemptDays).toBe(f.daysWorked);
  });

  it('with presses: still full, its presses kept for reference, never flagged nor missing a press', () => {
    const late = kept('2026-10-14', {
      checkIn: at('2026-10-14', '11:40'),
      checkOut: null,
      openAt: at('2026-10-14', '11:40'),
      pairs: [],
      place: 'remote',
      flags: ['outside_office'],
    });
    const [d] = exemptDays([late], OCTOBER, ctx()).filter((x) => x.date === '2026-10-14');
    expect(d).toMatchObject({ status: 'worked', hoursCounted: 9, exempt: true, flags: [], checkIn: at('2026-10-14', '11:40'), place: 'remote' });
    const view = attendanceDayView(d, 9);
    expect(view).toMatchObject({ missingCheckOut: false, shortHours: 0, flags: [] });
    // never late in the history, its press not in the check-in times
    const h = historyDay({ ...view, source: 'system', wfh: false, shift: { startTime: '09:00', endTime: '19:00', graceMinutes: 15 }, scheduled: true });
    expect(h).toMatchObject({ mode: 'exempt', onTime: true, lateMinutes: 0, checkInMinutes: null, attended: true, counted: true, exempt: true, hours: 9 });
    // the payroll reads it full: no extra for the open press either
    expect(attendanceLineInputs([d], { systemPermissionHours: 0, permissionHoursPerMonth: 4, hourly: false, hoursADay: 9 }).workedHours).toBe(9);
  });

  it('only inside its dates: before and after are normal days', () => {
    const p = [{ startDate: '2026-10-11', endDate: '2026-10-15' }];
    const days = exemptDays([kept('2026-10-08', { status: 'absent' }), kept('2026-10-18', { status: 'absent' })], p, ctx());
    expect(days.find((d) => d.date === '2026-10-08')).toMatchObject({ status: 'absent' });
    expect(days.find((d) => d.date === '2026-10-18')).toMatchObject({ status: 'absent' });
    expect(days.filter((d) => d.exempt).map((d) => d.date)).toEqual(['2026-10-11', '2026-10-12', '2026-10-14', '2026-10-15']);
  });

  it('only within the employment, and without a shift counts no hours', () => {
    expect(exemptDays([], OCTOBER, ctx({ employedFrom: '2026-10-20' })).map((d) => d.date)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-25']);
    expect(exemptDays([], OCTOBER, ctx({ hoursADay: null }))[0]).toMatchObject({ hoursCounted: 0, exempt: true });
  });

  it('sends no check-in or check-out reminder', () => {
    const person: ReminderPerson = {
      userId: 'u1',
      employeeId: 'e1',
      settings: { checkInReminder: true, checkOutReminder: true },
      employments: [{ joinDate: '2026-01-01', endDate: null, employmentType: 'full_time', shift: { startTime: '09:00', endTime: '19:00', graceMinutes: 15, countUntil: null, workingDays: [0, 1, 2, 3, 4] } }],
    } as ReminderPerson;
    const facts = (exempt: string[]): ReminderFacts => ({ holidays: new Set(), leave: new Set(), permission: new Map(), zoho: new Set(), punches: new Map(), sent: new Map(), exempt: new Set(exempt) });
    // Sunday 18 October at 9:20 AM Cairo: the check-in reminder is due, unless exempt that day
    const now = new Date(zonedMoment('2026-10-18', '09:20'));
    expect(remindersDue([person], facts([]), now).map((r) => r.kind)).toEqual(['check_in_reminder']);
    expect(remindersDue([person], facts(['e1:2026-10-18']), now)).toEqual([]);
    // checked in and not out by the time hours stop counting: "Still checked in?", unless exempt
    const later = new Date(zonedMoment('2026-10-18', '19:30'));
    const pressed = (exempt: string[]) => ({ ...facts(exempt), punches: new Map([['e1:2026-10-18', [{ kind: 'in' as const, at: new Date(zonedMoment('2026-10-18', '09:05')) }]]]) });
    expect(remindersDue([person], pressed([]), later).map((r) => r.kind)).toEqual(['check_out_reminder']);
    expect(remindersDue([person], pressed(['e1:2026-10-18']), later)).toEqual([]);
  });
});
