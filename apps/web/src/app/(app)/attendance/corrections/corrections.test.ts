import { zonedMoment, type CorrectableDay } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import type { AttendanceCorrectionView } from '../../../../lib/correction-types';
import {
  askCorrectionHref,
  correctionBack,
  correctionDecisionButton,
  correctionDoneText,
  correctionForm,
  correctionFormProblems,
  correctionKindName,
  correctionReadyText,
  correctionsListHref,
  correctionsPath,
  correctionStepText,
  dayBeforeText,
  dayCorrection,
  hrCorrectionHref,
  readCorrectionQuery,
  rightTimesText,
  seesCorrections,
  timesNeeded,
  type TypedCorrection,
} from './corrections';
import { askedDate, correctionMonthOf } from './month';

// Attendance corrections (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to check out")"): the
// addresses, the list's filters, the words, a day's offer on the attendance pages, and the form. Invented people.

const DAY = '2026-10-12';
const at = (time: string, day = DAY) => new Date(zonedMoment(day, time)).toISOString();
const onRecord = (more: Partial<CorrectableDay> = {}): CorrectableDay => ({ status: 'worked', checkIn: at('09:05'), checkOut: null, place: 'office', source: 'system', ...more });
const typed = (t: Partial<TypedCorrection> = {}): TypedCorrection => ({ date: '12/10/2026', kind: 'forgot_check_out', checkIn: '', checkOut: '6:30 PM', reason: 'Client meeting', ...t });
const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};
const ctx = { today: '2026-10-19', day: onRecord(), known: true, correctable: { allowed: true, reason: null }, open: false };

describe('the addresses and the list', () => {
  it('live under Attendance, the employee’s form under My Attendance, HR’s under the person’s month', () => {
    expect(askCorrectionHref(DAY)).toBe('/my-attendance/correct?date=2026-10-12');
    expect(askCorrectionHref('12/10/2026')).toBe('/my-attendance/correct');
    expect(hrCorrectionHref('p1', DAY)).toBe('/attendance/p1/correct?date=2026-10-12');
    expect(correctionsListHref('waiting')).toBe('/attendance/corrections');
    expect(correctionsListHref('approved', '2026-10')).toBe('/attendance/corrections?status=approved&month=2026-10');
    expect(correctionsPath('all')).toBe('/attendance/corrections');
    expect(correctionsPath('waiting')).toBe('/attendance/corrections?status=waiting');
    expect(readCorrectionQuery({ status: 'rejected', month: '2026-10' })).toEqual({ filter: 'rejected', month: '2026-10' });
    expect(readCorrectionQuery({ status: 'nonsense', month: 'october' })).toEqual({ filter: 'waiting', month: null });
  });

  it('is HR’s and the CEO’s; the page goes back to the list, My Requests or My Team', () => {
    expect(seesCorrections({ roles: ['hr'] })).toBe(true);
    expect(seesCorrections({ roles: ['ceo'] })).toBe(true);
    expect(seesCorrections({ roles: ['finance', 'manager'] })).toBe(false);
    const r = { employee: { id: 'nour' } } as Pick<AttendanceCorrectionView, 'employee'>;
    expect(correctionBack({ roles: ['hr'] }, r).label).toBe('Corrections');
    expect(correctionBack({ roles: ['employee'], employeeId: 'nour' }, r)).toEqual({ href: '/my-requests#my-corrections', label: 'My Requests' });
    expect(correctionBack({ roles: ['manager'], employeeId: 'sara' }, r).label).toBe('My Team');
  });
});

describe('a correction, in words', () => {
  it('says what was wrong, the times and what was on record in 12-hour time', () => {
    expect(correctionKindName('forgot_check_out')).toBe('Forgot to check out');
    expect(rightTimesText({ checkIn: at('09:05'), checkOut: at('18:30') })).toBe('9:05 AM – 6:30 PM');
    expect(rightTimesText({ checkIn: null, checkOut: at('18:30') })).toBe('Out at 6:30 PM');
    expect(rightTimesText({ checkIn: null, checkOut: null })).toBe('As on record');
    expect(dayBeforeText(onRecord())).toBe('9:05 AM – no check-out');
    expect(dayBeforeText({ ...onRecord(), status: 'absent', checkIn: null })).toBe('Absent');
    expect(dayBeforeText(null)).toBe('No day on record');
  });

  it('says where it goes once sent, each decision, and the steps in its own words', () => {
    expect(correctionDoneText({ done: 'sent' }, 'with_manager', { role: 'team_lead' })?.text).toBe('Request sent. It goes to your team lead, then HR; each step shows on the request.');
    expect(correctionDoneText({ done: 'recorded' }, 'approved')?.text).toContain('Day corrected, approved at once');
    expect(correctionDoneText({ done: 'manager_approve' }, 'with_hr', null, true)?.text).toBe('Approved: the correction goes to the CEO.');
    expect(correctionDoneText({ done: 'hr_approve' }, 'approved')?.text).toContain('the day is corrected');
    expect(correctionDoneText({ done: 'moved' }, 'with_hr')?.tone).toBe('warn');
    expect(correctionDoneText({ done: 'nonsense' }, 'with_hr')).toBeNull();
    expect(correctionStepText({ kind: 'recorded_by_hr', decision: null, comment: null })).toBe('Corrected by HR directly, approved at once');
    expect(correctionStepText({ kind: 'cancelled', decision: null, comment: null })).toBe('Cancelled by the employee');
    expect(correctionDecisionButton('approve', 'hr').label).toBe('Approve the correction');
    expect(correctionDecisionButton('approve', 'manager').label).toBe('Approve and send to HR');
  });
});

describe('a day on the attendance pages', () => {
  const href = (d: string) => askCorrectionHref(d);
  const ok = { allowed: true, reason: null };

  it('offers to ask on a day gone by or today, not of leave, in a month that can be corrected', () => {
    expect(dayCorrection({ date: DAY, status: 'worked' }, [], ok, '2026-10-19', href)).toEqual({ kind: 'ask', href: '/my-attendance/correct?date=2026-10-12' });
    expect(dayCorrection({ date: '2026-10-20', status: 'worked' }, [], ok, '2026-10-19', href)).toBeNull();
    expect(dayCorrection({ date: DAY, status: 'leave' }, [], ok, '2026-10-19', href)).toBeNull();
    expect(dayCorrection({ date: DAY, status: 'absent' }, [], { allowed: false, reason: 'Approved' }, '2026-10-19', href)).toBeNull();
  });

  it('shows a correction of the day being decided instead', () => {
    const open = [{ id: 'c1', date: DAY, correctionKind: 'forgot_check_out' as const, status: 'with_hr' as const, checkIn: null, checkOut: null }];
    expect(dayCorrection({ date: DAY, status: 'worked' }, open, ok, '2026-10-19', href)).toEqual({ kind: 'open', id: 'c1', status: 'with_hr' });
    // a decided one doesn't stop another
    expect(dayCorrection({ date: DAY, status: 'worked' }, [{ ...open[0], status: 'rejected' }], ok, '2026-10-19', href)?.kind).toBe('ask');
  });
});

describe('the form', () => {
  it('asks for the times the kind needs', () => {
    expect(timesNeeded('forgot_check_in', null)).toEqual({ checkIn: 'required', checkOut: 'optional' });
    expect(timesNeeded('forgot_check_out', null)).toEqual({ checkIn: 'none', checkOut: 'required' });
    expect(timesNeeded('worked_remotely', { checkIn: at('09:00') })).toEqual({ checkIn: 'optional', checkOut: 'optional' });
    expect(timesNeeded('worked_remotely', null).checkIn).toBe('required');
  });

  it('checks live what it can, in 12-hour time and DD/MM/YYYY', () => {
    expect(correctionFormProblems(typed(), ctx)).toEqual([]);
    expect(correctionFormProblems(typed({ checkOut: '25:00' }), ctx)).toEqual(['Enter the time of the check-out as a 12-hour time, e.g. 6:30 PM.']);
    expect(correctionFormProblems(typed({ checkOut: '8:00 AM' }), ctx)).toEqual(['The check-out (8:00 AM) must be after the check-in (9:05 AM) on the same day.']);
    expect(correctionFormProblems(typed({ date: '20/10/2026' }), ctx)).toEqual(['20/10/2026 is still to come: only a day gone by, or today, can be corrected.']);
    expect(correctionFormProblems(typed({ reason: '' }), ctx)[0]).toContain('Write why the day needs correcting');
    expect(correctionFormProblems(typed({ kind: '' }), ctx)).toEqual(['Choose what was wrong.']);
    expect(correctionFormProblems(typed(), { ...ctx, open: true })[0]).toContain('You asked to correct 12/10/2026 already');
    expect(correctionFormProblems(typed(), { ...ctx, correctable: { allowed: false, reason: 'The October 2026 payroll is approved, so its days can’t be corrected any more.' } })).toEqual([
      'The October 2026 payroll is approved, so its days can’t be corrected any more.',
    ]);
    expect(correctionFormProblems(typed({ kind: 'forgot_check_in', checkIn: '9:00 AM' }), ctx)[0]).toContain('You checked in at 9:05 AM on 12/10/2026 already');
    // a day of another month than the one read: the API checks what is on record
    expect(correctionFormProblems(typed({ kind: 'forgot_check_in', checkIn: '9:00 AM' }), { ...ctx, known: false })).toEqual([]);
  });

  it('is read into what the API takes: the times as HH:MM, only those the kind asks for', () => {
    expect(correctionForm(form({ date: '12/10/2026', kind: 'forgot_check_out', checkIn: '9:00 AM', checkOut: '6:30 PM', reason: ' Client ' }))).toEqual({
      body: { date: DAY, kind: 'forgot_check_out', checkOut: '18:30', reason: 'Client' },
      errors: [],
    });
    expect(correctionForm(form({ date: '12/10/2026', kind: 'wrong_time', checkIn: '8:55 am', checkOut: '', reason: 'x' })).body).toEqual({ date: DAY, kind: 'wrong_time', checkIn: '08:55', reason: 'x' });
    expect(correctionForm(form({ date: '', kind: 'x', checkIn: '', checkOut: '', reason: '' })).errors).toEqual(['Enter the day to correct.', 'Choose what was wrong.']);
  });

  it('says where it goes when it can be sent, or that HR corrects it at once', () => {
    expect(correctionReadyText(typed(), false, 'Nour Adel')).toBe('Ready to send: forgot to check out on Monday 12/10/2026, to your direct manager (without one, your lead), then HR.');
    expect(correctionReadyText(typed(), false, 'Nour Adel', true)).toContain('then the CEO');
    expect(correctionReadyText(typed(), true, 'Nour Adel')).toBe(
      'Ready to correct: forgot to check out on Monday 12/10/2026 for Nour Adel, at once. The day keeps what it was, shown as corrected from it.',
    );
  });

  it('takes the month from the person’s view, none from an API from before corrections', () => {
    const view = { person: { days: [{ date: DAY, status: 'worked' as const, checkIn: at('09:05'), checkOut: null, place: 'office' as const }] } };
    expect(correctionMonthOf('2026-10', view)).toBeNull();
    const data = correctionMonthOf('2026-10', { ...view, corrections: [], correctable: { allowed: true, reason: null } });
    expect(data?.days[0]).toMatchObject({ date: DAY, source: 'zoho', flags: [] });
    expect(askedDate({ date: DAY })).toBe(DAY);
    expect(askedDate({ date: '2026-13-01' })).toBeNull();
  });
});
