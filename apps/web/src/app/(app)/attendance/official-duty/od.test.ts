import { describe, expect, it } from 'vitest';
import type { OdForm, OdRequestView } from '../../../../lib/od-types';
import {
  awayOn,
  MY_OD_HREF,
  odAfterNote,
  odBack,
  odCancelBody,
  odCashHint,
  odCashText,
  odCompensatedAlready,
  odCompensationLead,
  odCompensationNote,
  odCompensationText,
  odDayOf,
  odDayOffHint,
  odDayTitle,
  odDecisionButton,
  odDoneHref,
  odDoneText,
  odForm,
  odFormCompensation,
  odFormDays,
  odFormProblems,
  odListHref,
  odListPath,
  odOnDayPath,
  odProgressText,
  odReadyText,
  odSent,
  odSentText,
  odSpanText,
  odStepText,
  odWhenLine,
  odWhenWords,
  readOdQuery,
  seesAllOd,
  typedOd,
  typedOdValues,
  WAITING_OD,
  type TypedOd,
} from './od';

// Official duty (owner, 23 October 2026: "Official duty (OD) requests"; asked, "Manager, then HR", "Ahead or up to 3
// days after", "Check in from anywhere"). Every person and place here is invented. 2026-11-02 is a Monday.

const ID = '00000000-0000-4000-8000-000000000001';
const DEPT = '0b8f2c1e-1111-4222-8333-444455556666';

const FORM: OdForm = { today: '2026-10-23', earliest: '2026-10-20', shift: { startTime: '09:00', endTime: '19:00', graceMinutes: 15 }, refusal: null, toCeo: false };

const typed = (t: Partial<TypedOd> = {}): TypedOd => ({ startDate: '02/11/2026', endDate: '', span: 'full', fromTime: '', toTime: '', place: 'The client’s office', reason: 'A site visit', ...t });

const request = (r: Partial<OdRequestView> = {}): OdRequestView =>
  ({
    id: ID,
    kind: 'od',
    employee: { id: 'e1', employeeCode: 'EMP-0001', fullNameEn: 'Nour Adel', fullNameAr: null, department: 'Marketing', team: null },
    type: { id: 'od', key: 'od', nameEn: 'Official duty', nameAr: 'مأمورية' },
    startDate: '2026-11-02',
    endDate: '2026-11-02',
    fullDay: true,
    fromTime: null,
    toTime: null,
    dutyPlace: 'The client’s office',
    reason: 'A site visit',
    late: false,
    status: 'with_manager',
    stage: 'manager',
    waitingForYou: false,
    confidential: false,
    canCancel: true,
    hrCanCancel: false,
    manager: { id: 'm', fullNameEn: 'Sara Ali', role: 'direct_manager' },
    rejectedStage: null,
    rejectReason: null,
    steps: [],
    createdAt: '2026-10-23T09:00:00.000Z',
    ...r,
  }) as OdRequestView;

const fd = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};

describe('the addresses and the list', () => {
  it('reads the filters from the address and writes the API’s request', () => {
    const q = readOdQuery({ status: 'approved', month: '2026-11', department: DEPT, late: '1' });
    expect(q).toEqual({ filter: 'approved', month: '2026-11', departmentId: DEPT, employeeId: null, late: true });
    expect(odListHref(q)).toBe(`/attendance/official-duty?status=approved&month=2026-11&department=${DEPT}&late=1`);
    expect(odListPath(q)).toBe(`/official-duty?status=approved&from=2026-11-01&to=2026-11-30&departmentId=${DEPT}&late=true`);
    expect(readOdQuery({ status: 'soon', month: '2026-13' })).toEqual({ filter: 'waiting', month: null, departmentId: null, employeeId: null, late: false });
    expect(WAITING_OD).toBe('/official-duty?status=waiting');
    expect(odOnDayPath('2026-11-02')).toBe('/official-duty?status=approved&from=2026-11-02&to=2026-11-02');
    expect(odDoneHref(ID, 'sent')).toBe(`/attendance/official-duty/${ID}?done=sent`);
  });

  it('is HR’s and the CEO’s; a request’s page goes back to My Requests for its employee', () => {
    expect(seesAllOd({ roles: ['hr'] })).toBe(true);
    expect(seesAllOd({ roles: ['ceo'] })).toBe(true);
    expect(seesAllOd({ roles: ['employee', 'manager'] })).toBe(false);
    expect(odBack({ roles: ['hr'], employeeId: 'e1' }, request())).toEqual({ href: MY_OD_HREF, label: 'My Requests' });
    expect(odBack({ roles: ['hr'], employeeId: 'x' }, request())).toEqual({ href: '/attendance/official-duty', label: 'Official Duty' });
    expect(odBack({ roles: ['manager'], employeeId: 'x' }, request())).toEqual({ href: '/my-team', label: 'My Team' });
  });
});

describe('a request in words', () => {
  it('says its days and hours', () => {
    expect(odWhenWords(request())).toBe('Monday 02/11/2026');
    expect(odWhenWords(request({ fullDay: false, fromTime: '10:00', toTime: '14:00' }))).toBe('Monday 02/11/2026, 10:00 AM–2:00 PM');
    expect(odWhenWords(request({ endDate: '2026-11-04' }))).toBe('Monday 02/11/2026 – Wednesday 04/11/2026');
    expect(odSpanText(request())).toBe('A full day');
    expect(odSpanText(request({ fullDay: false }))).toBe('Part of a day');
    expect(odSpanText(request({ endDate: '2026-11-04' }))).toBe('3 days in a row, full days');
  });

  it('says where it stands and where it goes, a C-level person’s to the CEO', () => {
    expect(odProgressText(request()).text).toContain('Sara Ali');
    expect(odProgressText(request({ status: 'with_hr', confidential: true })).text).toBe('Waiting for the CEO');
    expect(odSentText('with_manager', { role: 'team_lead' })).toBe('Request sent. It goes to your team lead, then HR; each step shows on the request.');
    expect(odSentText('with_hr', null, true)).toBe('Request sent. It goes to the CEO; each step shows on the request.');
    expect(odDoneText({ done: 'hr_approve' }, 'approved')?.text).toBe('Approved: on its days they check in from where they are, and the days count as attended for its hours.');
    expect(odDoneText({ done: 'manager_approve' }, 'with_hr')?.text).toBe('Approved: the request goes to HR.');
    expect(odDoneText({ done: 'moved' }, 'with_hr')?.tone).toBe('warn');
    expect(odDoneText({ done: 'nonsense' }, 'with_hr')).toBeNull();
    expect(odDecisionButton('approve', 'hr').label).toBe('Approve the official duty');
    expect(odDecisionButton('approve', 'manager').label).toBe('Approve and send to HR');
    expect(odStepText({ kind: 'cancelled', decision: null, comment: null })).toBe('Cancelled');
    expect(odStepText({ kind: 'submitted', decision: null, comment: null })).toBe('Asked for by the employee');
    expect(odCancelBody(fd({ comment: ' ' })).errors).toEqual(['Write why the official duty is cancelled: the employee sees it.']);
    expect(odCancelBody(fd({ comment: 'Called off' })).body).toEqual({ comment: 'Called off' });
  });
});

describe('the request form (owner, 23 October 2026: "Ahead or up to 3 days after")', () => {
  it('reads a full day, several days, or part of a day into the API’s values', () => {
    expect(odForm(fd({ ...typed() })).body).toEqual({ startDate: '2026-11-02', endDate: '2026-11-02', fullDay: true, place: 'The client’s office', reason: 'A site visit' });
    expect(odForm(fd({ ...typed({ endDate: '04/11/2026' }) })).body).toMatchObject({ startDate: '2026-11-02', endDate: '2026-11-04', fullDay: true });
    expect(odForm(fd({ ...typed({ span: 'part', fromTime: '10:00 AM', toTime: '2:00 PM' }) })).body).toEqual({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      fullDay: false,
      fromTime: '10:00',
      toTime: '14:00',
      place: 'The client’s office',
      reason: 'A site visit',
    });
    expect(typedOd(fd({ startDate: '02/11/2026' })).span).toBe('full');
  });

  it('says what is missing or wrong, the shared checks in the screens’ words', () => {
    expect(odFormProblems(typed({ startDate: '' }), FORM)).toEqual(['Enter the day of the official duty.']);
    expect(odFormProblems(typed({ startDate: '31/02/2026' }), FORM)).toEqual(['Enter the day as DD/MM/YYYY, e.g. 02/11/2026.']);
    expect(odFormProblems(typed({ place: '', reason: '' }), FORM)).toEqual([
      'Write where the official duty is, e.g. the client’s office in New Cairo.',
      'Write what the official duty is for, e.g. a site visit for the client’s launch.',
    ]);
    expect(odFormProblems(typed({ endDate: '01/11/2026' }), FORM)).toEqual(["The last day can't be before the first."]);
    expect(odFormProblems(typed({ span: 'part', fromTime: '2:00 PM', toTime: '10:00 AM' }), FORM)).toEqual(['The time it ends must be after the time it starts.']);
    expect(odFormProblems(typed({ span: 'part', fromTime: '', toTime: '' }), FORM)).toEqual(['Choose the time it starts, e.g. 10:00 AM.', 'Choose the time it ends, e.g. 2:00 PM.']);
  });

  it('allows up to 3 days after, marked requested after; 4 days refused', () => {
    expect(odFormProblems(typed({ startDate: '20/10/2026' }), FORM)).toEqual([]);
    expect(odAfterNote(typed({ startDate: '20/10/2026' }), FORM)).toContain('requested after');
    expect(odAfterNote(typed({ startDate: '23/10/2026' }), FORM)).toBeNull();
    expect(odFormProblems(typed({ startDate: '19/10/2026' }), FORM)).toEqual([
      '19/10/2026 is more than 3 days ago: ask for an official duty ahead, or within 3 days after the day (from 20/10/2026).',
    ]);
  });

  it('keeps part of a day inside the shift, and says a refusal from the form', () => {
    expect(odFormProblems(typed({ span: 'part', fromTime: '7:00 AM', toTime: '10:00 AM' }), FORM)).toEqual(['Choose times within your shift, 9:00 AM to 7:00 PM.']);
    expect(odFormProblems(typed({ span: 'part', fromTime: '10:00 AM', toTime: '2:00 PM' }), FORM)).toEqual([]);
    expect(odFormProblems(typed(), { ...FORM, refusal: 'You work freelance.' })).toEqual(['You work freelance.']);
    expect(odReadyText(typed({ span: 'part', fromTime: '10:00 AM', toTime: '2:00 PM' }))).toBe(
      'Ready to send: official duty for Monday 02/11/2026, 10:00 AM–2:00 PM, to your direct manager (without one, your lead), then HR.',
    );
    expect(odReadyText(typed(), true)).toContain('then the CEO');
  });
});

describe('the attendance pages', () => {
  it('finds a person’s official duty on a day, and who is on duty today', () => {
    const day = { date: '2026-11-02', requestId: ID, fullDay: false, fromTime: '10:00', toTime: '14:00' };
    expect(odDayOf({ odDays: [day] }, '2026-11-02')).toEqual(day);
    expect(odDayOf({}, '2026-11-02')).toBeNull();
    expect(odDayTitle(day)).toBe('On official duty, 10:00 AM–2:00 PM');
    expect(odDayTitle({ ...day, fullDay: true })).toBe('On official duty, the full day');
    const away = awayOn([request({ status: 'approved', endDate: '2026-11-04' }), request({ id: 'x', status: 'with_hr', employee: { ...request().employee, id: 'e2' } })], '2026-11-03');
    expect(away.map((e) => e.id)).toEqual(['e1']);
  });
});

// A single rest day or official holiday, with its compensation (owner, 27 October 2026, on HR's form refusing a rest day:
// "it should count in the compensatories"; he chose "One step"; then by the hour, by the Compensatory Setup). Sunday to
// Thursday is the shift: 23/10/2026 is a Friday, 24/10 a Saturday, 27/10 a Tuesday; 29/10 is an invented holiday.

const RULES = { cashRate: 1.5, minHours: 2, hoursCap: 4, fullDayHours: 6, offWithinDays: null };

const DAY_OFF_FORM: OdForm = {
  today: '2026-10-21',
  earliest: '2026-10-18',
  shift: { startTime: '09:00', endTime: '17:00', graceMinutes: 15 },
  refusal: null,
  toCeo: false,
  workingDays: [0, 1, 2, 3, 4],
  holidays: [{ date: '2026-10-29', nameEn: 'Revolution Day' }],
  rules: RULES,
  hoursADay: 8,
};

const friday = (t: Partial<TypedOd> = {}): TypedOd => typed({ startDate: '23/10/2026', compensation: 'day_off', dayOff: '27/10/2026', ...t });
const part = (fromTime: string, toTime: string, t: Partial<TypedOd> = {}) => friday({ span: 'part', fromTime, toTime, ...t });

describe('on a rest day or an official holiday (owner, 27 October 2026: "it should count in the compensatories")', () => {
  it('tells a rest day and a holiday from the working days and holidays the form read first', () => {
    expect(odFormDays({ startDate: '2026-10-23', endDate: '2026-10-23' }, DAY_OFF_FORM)).toEqual([
      { date: '2026-10-23', workingDay: false, holiday: null, leave: null, wfh: null, od: [], compensatory: null, compensated: null },
    ]);
    expect(odFormDays({ startDate: '2026-10-29', endDate: '2026-10-29' }, DAY_OFF_FORM)?.[0]).toMatchObject({ workingDay: true, holiday: 'Revolution Day' });
    expect(odFormDays({ startDate: '2026-10-25', endDate: '2026-10-26' }, DAY_OFF_FORM)?.map((d) => d.workingDay)).toEqual([true, true]);
    // a day compensated already, as the form read it first (or, failing that, as the API's refusal named it)
    expect(odFormDays({ startDate: '2026-10-23', endDate: '2026-10-23' }, { ...DAY_OFF_FORM, compensated: [{ date: '2026-10-23', status: 'with HR' }] })?.[0].compensated).toEqual({ status: 'with HR' });
    expect(odFormCompensation(friday(), { ...DAY_OFF_FORM, compensated: [{ date: '2026-10-23', status: 'approved' }] })).toMatchObject({ needed: false, already: 'approved' });
    expect(odFormDays({ startDate: '2026-10-23', endDate: '2026-10-23' }, DAY_OFF_FORM, { date: '2026-10-23', status: 'approved' })?.[0].compensated).toEqual({ status: 'approved' });
    // an API from before it: the form leaves rest days and holidays to the API
    expect(odFormDays({ startDate: '2026-10-23', endDate: '2026-10-23' }, FORM)).toBeNull();
  });

  it('works out what a single day off earns: a whole day, hours by the Setup, or nothing below its minimum', () => {
    expect(odFormCompensation(friday(), DAY_OFF_FORM)).toEqual({
      onDayOff: true,
      needed: true,
      earned: { kind: 'day' },
      cashDays: 1.5,
      already: null,
      what: 'Friday 23/10/2026 is a rest day of your shift',
    });
    expect(odFormCompensation(friday({ startDate: '29/10/2026' }), DAY_OFF_FORM)?.what).toBe('Thursday 29/10/2026 is an official holiday (Revolution Day)');
    // 10:00–14:00 earns 4 hours off, or 4 ÷ 8 × 1.5 days' pay
    expect(odFormCompensation(part('10:00 AM', '2:00 PM'), DAY_OFF_FORM)).toMatchObject({ needed: true, earned: { kind: 'hours', hours: 4 }, cashDays: 0.75 });
    // 5 hours capped at 4; 6 hours a whole day
    expect(odFormCompensation(part('10:00 AM', '3:00 PM'), DAY_OFF_FORM)?.earned).toEqual({ kind: 'hours', hours: 4 });
    expect(odFormCompensation(part('9:00 AM', '3:00 PM'), DAY_OFF_FORM)?.earned).toEqual({ kind: 'day' });
    // an hour earns nothing: nothing to choose
    expect(odFormCompensation(part('10:00 AM', '11:00 AM'), DAY_OFF_FORM)).toMatchObject({ needed: false, earned: { kind: 'none', hours: 1 }, cashDays: 0 });
    // compensated already
    expect(odFormCompensation(friday(), DAY_OFF_FORM, { date: '2026-10-23', status: 'approved' })).toMatchObject({ needed: false, already: 'approved' });
    // a working day, several days, a day not typed yet, an API from before it: none
    expect(odFormCompensation(friday({ startDate: '26/10/2026' }), DAY_OFF_FORM)).toBeNull();
    expect(odFormCompensation(friday({ endDate: '26/10/2026' }), DAY_OFF_FORM)).toBeNull();
    expect(odFormCompensation(friday({ startDate: '23/10' }), DAY_OFF_FORM)).toBeNull();
    expect(odFormCompensation(friday(), FORM)).toBeNull();
  });

  it('sends the compensation only while the form shows it: a day off with its date, or cash with none', () => {
    expect(odForm(fd({ ...friday() } as Record<string, string>)).body).toEqual({
      startDate: '2026-10-23',
      endDate: '2026-10-23',
      fullDay: true,
      place: 'The client’s office',
      reason: 'A site visit',
      compensation: 'day_off',
      dayOff: '2026-10-27',
    });
    expect(odForm(fd({ ...friday({ compensation: 'cash' }) } as Record<string, string>)).body).toMatchObject({ compensation: 'cash' });
    expect(odForm(fd({ ...friday({ compensation: 'cash' }) } as Record<string, string>)).body).not.toHaveProperty('dayOff');
    // the fields not shown (a working day): nothing of it in the form, nothing sent
    expect(odForm(fd({ ...typed({ startDate: '26/10/2026' }) })).body).toEqual({ startDate: '2026-10-26', endDate: '2026-10-26', fullDay: true, place: 'The client’s office', reason: 'A site visit' });
    expect(odSent(friday(), false)).toMatchObject({ compensation: '', dayOff: '' });
    expect(odSent(friday(), true)).toEqual(friday());
    expect(odForm(fd({ ...friday({ dayOff: '31/13/2026' }) } as Record<string, string>)).errors).toEqual(['Enter the day off as DD/MM/YYYY, e.g. 10/11/2026.']);
    // kept with what was typed after a refusal
    expect(typedOdValues(fd({ ...friday() } as Record<string, string>))).toMatchObject({ compensation: 'day_off', dayOff: '27/10/2026' });
    expect(typedOd(fd({ startDate: '23/10/2026' })).compensation).toBe('');
  });

  it('checks the compensation live, as the API does', () => {
    expect(odFormProblems(friday(), DAY_OFF_FORM)).toEqual([]);
    expect(odFormProblems(friday({ compensation: 'cash' }), DAY_OFF_FORM)).toEqual([]);
    expect(odFormProblems(friday({ compensation: '' }), DAY_OFF_FORM)).toEqual([
      '23/10/2026 is a rest day of your shift: official duty on it earns a whole day off, so choose the day off or cash instead.',
    ]);
    expect(odFormProblems(part('10:00 AM', '2:00 PM', { compensation: '' }), DAY_OFF_FORM)).toEqual([
      '23/10/2026 is a rest day of your shift: official duty on it earns 4 hours off, so choose the day for the hours off or cash instead.',
    ]);
    expect(odFormProblems(friday({ dayOff: '' }), DAY_OFF_FORM)).toEqual(['Enter the day off, e.g. 10/11/2026.']);
    expect(odFormProblems(friday({ dayOff: '24/10/2026' }), DAY_OFF_FORM)).toEqual(['24/10/2026 is a rest day of your shift: the day off must be a working day.']);
    expect(odFormProblems(friday({ dayOff: '29/10/2026' }), DAY_OFF_FORM)).toEqual(['29/10/2026 is an official holiday (Revolution Day): the day off must be a working day.']);
    expect(odFormProblems(friday({ dayOff: '02/11/2026' }), DAY_OFF_FORM)).toEqual([
      'The day off must be in the same month as the day worked: 23/10/2026 is in October 2026, 02/11/2026 in November 2026.',
    ]);
    // a day's notice: today is too late (before the day worked is fine, in the same month)
    expect(odFormProblems(friday({ dayOff: '21/10/2026' }), DAY_OFF_FORM)).toEqual(['21/10/2026 is today: ask for a compensatory day a day before the day off at the latest.']);
    expect(odFormProblems(friday({ dayOff: '22/10/2026' }), DAY_OFF_FORM)).toEqual([]);
    // the Setup's window instead of the month
    expect(odFormProblems(friday({ dayOff: '22/10/2026' }), { ...DAY_OFF_FORM, rules: { ...RULES, offWithinDays: 7 } })).toEqual([
      'The day off must be within 7 days after the day worked: from 24/10/2026 to 30/10/2026.',
    ]);
    // an hour earns nothing, and a day compensated already needs none: whatever the form held, none is asked
    expect(odFormProblems(part('10:00 AM', '11:00 AM'), DAY_OFF_FORM)).toEqual([]);
    expect(odFormProblems(friday({ dayOff: '' }), DAY_OFF_FORM, { date: '2026-10-23', status: 'approved' })).toEqual([]);
    // a working day: the day off left in the form is not asked
    expect(odFormProblems(friday({ startDate: '26/10/2026', dayOff: '24/10/2026' }), DAY_OFF_FORM)).toEqual([]);
    // several days with none a working day
    expect(odFormProblems(friday({ endDate: '24/10/2026' }), DAY_OFF_FORM)).toEqual([
      'None of the days from 23/10/2026 to 24/10/2026 is a working day of your shift: there is no work to be away for.',
    ]);
    // part of a rest day stays within the shift
    expect(odFormProblems(part('6:00 PM', '9:00 PM'), DAY_OFF_FORM)).toEqual(['Choose times within your shift, 9:00 AM to 5:00 PM.']);
  });

  it('stops asking for a compensation once the API says the day is compensated already', () => {
    const refused = ['23/10/2026 is a rest day of your shift, compensated already by a compensatory day (with HR): leave the compensation out.'];
    expect(odCompensatedAlready(refused)).toEqual({ date: '2026-10-23', status: 'with HR' });
    expect(odCompensatedAlready(['29/10/2026 is an official holiday (Revolution Day), compensated already by a compensatory day (approved): leave the compensation out.'])).toEqual({
      date: '2026-10-29',
      status: 'approved',
    });
    expect(odCompensatedAlready(['Something else.'])).toBeNull();
    expect(odCompensatedAlready(undefined)).toBeNull();
  });

  it('says what it earns, the day off and cash instead', () => {
    const day = odFormCompensation(friday(), DAY_OFF_FORM)!;
    const hours = odFormCompensation(part('10:00 AM', '2:00 PM'), DAY_OFF_FORM)!;
    const none = odFormCompensation(part('10:00 AM', '11:00 AM'), DAY_OFF_FORM)!;
    expect(odCompensationLead(day, day.what, RULES)).toBe(
      "Friday 23/10/2026 is a rest day of your shift: official duty on it earns a whole day off, or 1.5 days' pay instead. The day itself adds no hours or overtime.",
    );
    expect(odCompensationLead(hours, hours.what, RULES)).toBe(
      "Friday 23/10/2026 is a rest day of your shift: official duty on it earns 4 hours off, or 4 hours' pay at 1.5× instead. The day itself adds no hours or overtime.",
    );
    expect(odCompensationLead(none, none.what, RULES)).toBe(
      'Friday 23/10/2026 is a rest day of your shift: 1 hour of official duty on it earns nothing, fewer than the 2 hours that earn a compensation (Compensatory Setup), so there is no compensation to choose.',
    );
    expect(odCompensationLead({ ...day, already: 'approved' }, null, null)).toBe(
      'A rest day or an official holiday, compensated already by a compensatory day (approved): there is nothing more to choose.',
    );
    // HR's check doesn't say the rate: the days' pay
    expect(odCashText(hours)).toBe("0.75 days' pay");
    expect(odCashText(day)).toBe("1.5 days' pay");
    expect(odCashHint(hours, 1.5)).toBe("Cash instead: 4 hours' pay at 1.5× added to the month's payroll once approved, and no day off.");
    expect(odDayOffHint(day, RULES, false)).toBe('A working day of your shift in the same month, from tomorrow on.');
    expect(odDayOffHint(hours, { offWithinDays: 7 }, true)).toBe(
      'A working day of their shift within 7 days after it; a day gone by is recorded with a warning. The 4 hours off are taken that day, with no deduction.',
    );
  });

  it('says the compensation in the ready text', () => {
    const day = odFormCompensation(friday(), DAY_OFF_FORM);
    const hours = odFormCompensation(part('10:00 AM', '2:00 PM'), DAY_OFF_FORM);
    expect(odReadyText(friday(), false, day, 1.5)).toBe(
      'Ready to send: official duty for Friday 23/10/2026, with a day off on Tuesday 27/10/2026, to your direct manager (without one, your lead), then HR.',
    );
    expect(odReadyText(friday({ compensation: 'cash' }), false, day, 1.5)).toBe(
      "Ready to send: official duty for Friday 23/10/2026, paid 1.5 days' pay instead, to your direct manager (without one, your lead), then HR.",
    );
    expect(odReadyText(part('10:00 AM', '2:00 PM'), false, hours, 1.5)).toBe(
      'Ready to send: official duty for Friday 23/10/2026, 10:00 AM–2:00 PM, with 4 hours off on Tuesday 27/10/2026, to your direct manager (without one, your lead), then HR.',
    );
    expect(odReadyText(part('10:00 AM', '2:00 PM', { compensation: 'cash' }), false, hours, 1.5)).toContain("paid 4 hours' pay at 1.5× instead");
    // none asked for: none said
    expect(odReadyText(friday({ startDate: '26/10/2026' }), false, null, 1.5)).toBe(
      'Ready to send: official duty for Monday 26/10/2026, to your direct manager (without one, your lead), then HR.',
    );
  });

  it('shows the compensation on the request’s page and in the lists', () => {
    const comp = { id: 'c1', status: 'with_manager' as const, outcome: 'day_off' as const, dayOff: '2026-10-27', hoursWorked: null, hoursOff: null };
    expect(odCompensationText(comp)).toBe('A day off on Tuesday 27/10/2026');
    expect(odCompensationText({ ...comp, hoursOff: 4 })).toBe('4 hours off on Tuesday 27/10/2026');
    expect(odCompensationText({ ...comp, outcome: 'cash', dayOff: null })).toBe('Cash instead of a day off');
    expect(odCompensationText({ ...comp, outcome: 'cash', dayOff: null, hoursOff: 4 })).toBe('Cash instead of 4 hours off');
    const r = request({ startDate: '2026-10-23', endDate: '2026-10-23', compensation: comp });
    expect(odCompensationNote(r)).toBe('+ day off 27/10');
    expect(odCompensationNote(request({ compensation: { ...comp, hoursOff: 4 } }))).toBe('+ 4 hours off 27/10');
    expect(odCompensationNote(request({ compensation: { ...comp, outcome: 'cash', dayOff: null } }))).toBe('+ cash');
    expect(odCompensationNote(request())).toBeNull();
    expect(odWhenLine(r)).toBe('Friday 23/10/2026 + day off 27/10');
    expect(odWhenLine(request())).toBe('Monday 02/11/2026');
  });
});
