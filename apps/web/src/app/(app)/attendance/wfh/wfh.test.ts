import { describe, expect, it } from 'vitest';
import { toAppHref } from '../../../../lib/surface';
import type { LeaveCalendarEntry } from '../../../../lib/types';
import type { WfhAllowance, WfhCalendarItem, WfhRequestView } from '../../../../lib/wfh-types';
import { calendarAgenda, calendarDays, calendarPeople, cellLabel, monthSummaryText, offPerDay, WFH_CELL_TEXT } from '../../leave/calendar';
import {
  homeOn,
  isWfhDay,
  readWfhQuery,
  recordWfhHref,
  wfhAllowanceLine,
  wfhBack,
  wfhCancelBody,
  wfhDecisionButton,
  wfhDoneHref,
  wfhDoneText,
  wfhForm,
  wfhFormProblems,
  wfhListHref,
  wfhListPath,
  wfhProgressText,
  wfhRecordForm,
  wfhSentText,
  wfhSourceText,
  wfhStepText,
} from './wfh';

// Working from home (owner, 21 October 2026: "think about how should we handle the working from home in out erp"; asked,
// "Manager, then HR", "its 2 days per month with a gap of 1 week between each record (Biweekly)", "A day before").

const ID = '11111111-2222-4333-8444-555555555555';
const DEPT = '66666666-7777-4888-8999-000000000000';

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const allowance = (over: Partial<WfhAllowance> = {}): WfhAllowance => ({
  month: '2026-10',
  daysPerMonth: 2,
  minGapDays: 7,
  used: 1,
  approved: 1,
  pending: 0,
  taken: [{ date: '2026-10-25', status: 'approved' }],
  nextPossible: '2026-11-01',
  offered: true,
  refusal: null,
  today: '2026-10-21',
  ...over,
});

const request = (over: Partial<WfhRequestView> = {}): WfhRequestView => ({
  id: ID,
  kind: 'wfh',
  employee: { id: 'e1', employeeCode: 'EMP-0001', fullNameEn: 'Mona Adel', fullNameAr: null, department: 'Sales', team: null },
  type: { id: 'wfh', key: 'wfh', nameEn: 'Work from home', nameAr: 'العمل من المنزل' },
  date: '2026-11-02',
  startDate: '2026-11-02',
  endDate: '2026-11-02',
  reason: null,
  status: 'with_manager',
  stage: 'manager',
  waitingForYou: false,
  confidential: false,
  canCancel: true,
  hrCanCancel: false,
  manager: { id: 'm1', fullNameEn: 'Sara Ali', role: 'direct_manager' },
  rejectedStage: null,
  rejectReason: null,
  recordedByHr: false,
  source: 'system',
  warnings: [],
  steps: [],
  monthUsed: 1,
  createdAt: '2026-10-21T08:00:00.000Z',
  ...over,
});

describe('the addresses', () => {
  it('open a request under Attendance, and on the phone pages', () => {
    expect(wfhDoneHref(ID, 'sent')).toBe(`/attendance/wfh/${ID}?done=sent`);
    expect(recordWfhHref('e 1')).toBe('/attendance/wfh/record?employee=e%201');
    expect(toAppHref(wfhDoneHref(ID, 'manager_approve'), 'approve')).toBe(`/app/approve/wfh/${ID}?done=manager_approve`);
    expect(toAppHref(`/attendance/wfh/${ID}`, 'requests')).toBe(`/app/requests/wfh/${ID}`);
  });

  it('read the list’s filters, waiting for you without a status, and send the API a month as its days', () => {
    expect(readWfhQuery({})).toEqual({ filter: 'waiting', month: null, departmentId: null, employeeId: null, source: null });
    const q = readWfhQuery({ status: 'approved', month: '2026-11', department: DEPT, source: 'zoho', employee: 'nope' });
    expect(q).toEqual({ filter: 'approved', month: '2026-11', departmentId: DEPT, employeeId: null, source: 'zoho' });
    expect(wfhListHref(q)).toBe(`/attendance/wfh?status=approved&month=2026-11&department=${DEPT}&source=zoho`);
    expect(wfhListPath(q)).toBe(`/wfh?status=approved&from=2026-11-01&to=2026-11-30&departmentId=${DEPT}&source=zoho`);
    expect(wfhListPath({ filter: 'all', month: '2028-02' })).toBe('/wfh?from=2028-02-01&to=2028-02-29');
    expect(wfhListHref({ filter: 'waiting' })).toBe('/attendance/wfh');
  });

  it('go back to My Requests for the employee, Work From Home for HR and the CEO, else My Team', () => {
    expect(wfhBack({ roles: ['employee'], employeeId: 'e1' }, request())).toEqual({ href: '/my-requests#my-wfh', label: 'My Requests' });
    expect(wfhBack({ roles: ['hr'], employeeId: 'x' }, request())).toEqual({ href: '/attendance/wfh', label: 'Work From Home' });
    expect(wfhBack({ roles: ['manager'], employeeId: 'm1' }, request())).toEqual({ href: '/my-team', label: 'My Team' });
  });
});

describe('the employee’s form', () => {
  it('needs a day as DD/MM/YYYY; the reason is optional, at most 500 characters', () => {
    expect(wfhForm(form({ date: '', reason: '' })).errors).toEqual(['Enter the day you work from home.']);
    expect(wfhForm(form({ date: '2/13/2026', reason: '' })).errors).toEqual(['Enter the day as DD/MM/YYYY, e.g. 02/11/2026.']);
    expect(wfhForm(form({ date: '02/11/2026', reason: '  ' }))).toEqual({ body: { date: '2026-11-02' }, errors: [] });
    expect(wfhForm(form({ date: '02/11/2026', reason: ' Plumber ' })).body).toEqual({ date: '2026-11-02', reason: 'Plumber' });
    expect(wfhForm(form({ date: '02/11/2026', reason: 'x'.repeat(501) })).errors).toEqual(['Keep the reason to 500 characters; it has 501.']);
  });

  it('shows the notice and the limits live: today refused, a day too close, a full month', () => {
    expect(wfhFormProblems({ date: '21/10/2026', reason: '' }, allowance())).toEqual([
      '21/10/2026 is today: ask for a work from home day a day before it at the latest.',
      'Two work from home days must be at least 7 days apart: 21/10/2026 is 4 days from your day on 25/10/2026.',
    ]);
    expect(wfhFormProblems({ date: '01/11/2026', reason: '' }, allowance())).toEqual([]);
    expect(wfhFormProblems({ date: '29/10/2026', reason: '' }, allowance({ taken: [{ date: '2026-10-05', status: 'approved' }, { date: '2026-10-15', status: 'with_hr' }] }))).toEqual([
      "October 2026's 2 days of working from home are already asked for: 2 of 2.",
    ]);
    // the arrangement that never needs it says only that; unread figures leave the rest to the API
    expect(wfhFormProblems({ date: '01/11/2026', reason: '' }, allowance({ refusal: 'You work from home already: no work from home day is needed.' }))).toEqual([
      'You work from home already: no work from home day is needed.',
    ]);
    expect(wfhFormProblems({ date: '21/10/2026', reason: '' }, null)).toEqual([]);
  });

  it('says "x of 2 this month · next possible from DD/MM/YYYY", of the chosen day’s month', () => {
    expect(wfhAllowanceLine(allowance())).toBe('1 of 2 this month · next possible from 01/11/2026');
    expect(wfhAllowanceLine(allowance(), '2026-11-05')).toBe('0 of 2 in November 2026 · next possible from 01/11/2026');
  });
});

describe('HR’s form', () => {
  it('needs the employee and a reason', () => {
    expect(wfhRecordForm(form({ date: '02/11/2026', reason: '' })).errors).toEqual(['Choose the employee whose day it is.', 'Write why HR records this day.']);
    expect(wfhRecordForm(form({ employeeId: 'e1', date: '02/11/2026', reason: 'Internet down' })).body).toEqual({ employeeId: 'e1', date: '2026-11-02', reason: 'Internet down' });
  });

  it('cancels an approved day with a comment', () => {
    expect(wfhCancelBody(form({ comment: ' ' })).errors).toEqual(['Write why the work from home day is cancelled: the employee sees it.']);
    expect(wfhCancelBody(form({ comment: 'Moved' })).body).toEqual({ comment: 'Moved' });
  });
});

describe('a request, in words', () => {
  it('says where it goes once sent, and what was done', () => {
    expect(wfhSentText('with_manager', { role: 'team_lead' })).toBe('Request sent. It goes to your team lead, then HR; each step shows on the request.');
    expect(wfhSentText('with_hr', null, true)).toBe('Request sent. It goes to the CEO; each step shows on the request.');
    expect(wfhSentText('approved')).toContain('approved at once');
    expect(wfhDoneText({ done: 'manager_approve' }, 'with_hr')).toEqual({ text: 'Approved: the request goes to HR.', tone: 'ok' });
    expect(wfhDoneText({ done: 'moved' }, 'approved')?.tone).toBe('warn');
    expect(wfhDoneText({ done: 'nonsense' }, 'approved')).toBeNull();
    expect(wfhDecisionButton('approve', 'hr')).toEqual({ label: 'Approve working from home', busy: 'Approving…' });
    expect(wfhDecisionButton('approve', 'manager', true).label).toBe('Approve and send to the CEO');
  });

  it('words its steps, how it came and where it stands, an import from Zoho People too', () => {
    expect(wfhStepText({ kind: 'imported', decision: null, comment: null })).toBe('Imported from Zoho People, approved');
    expect(wfhStepText({ kind: 'recorded_by_hr', decision: null, comment: null })).toBe('Recorded by HR, approved at once');
    expect(wfhStepText({ kind: 'hr_decision', decision: 'approve', comment: null })).toBe('HR approved it');
    expect(wfhSourceText(request({ source: 'zoho', recordedByHr: true }))).toBe('Imported from Zoho People');
    expect(wfhSourceText(request({ recordedByHr: true }))).toBe('Recorded by HR');
    expect(wfhProgressText(request({ status: 'approved', source: 'zoho', recordedByHr: true })).text).toBe('Imported from Zoho People');
    expect(wfhProgressText(request({ status: 'rejected', rejectedStage: 'hr', rejectReason: 'Client day' }))).toEqual({ text: 'Rejected by HR', reason: 'Client day' });
  });
});

describe('the attendance pages and My Team', () => {
  it('know a day worked from home, and who is home today', () => {
    expect(isWfhDay({ wfhDays: ['2026-10-21'] }, '2026-10-21')).toBe(true);
    expect(isWfhDay({}, '2026-10-21')).toBe(false);
    const a = request({ status: 'approved', date: '2026-10-21' });
    const b = request({ id: 'x', status: 'with_hr', date: '2026-10-21', employee: { ...a.employee, id: 'e2', fullNameEn: 'Adam' } });
    expect(homeOn([a, a, b], '2026-10-21').map((e) => e.fullNameEn)).toEqual(['Mona Adel']);
  });
});

describe('the leave calendar and the team’s (the brief: "a distinct style from leave")', () => {
  const days = calendarDays('2026-11', [], '2026-10-21');
  const wfh = (over: Partial<WfhCalendarItem> = {}): WfhCalendarItem => ({
    id: 'w-1',
    kind: 'wfh',
    employee: { id: 'karim', fullNameEn: 'Karim Nabil', department: 'Marketing', team: null },
    type: { id: 'wfh', nameEn: 'Work from home', nameAr: 'العمل من المنزل' },
    startDate: '2026-11-03',
    endDate: '2026-11-03',
    halfDay: false,
    status: 'approved',
    ...over,
  });
  const leave = (over: Partial<LeaveCalendarEntry> = {}): LeaveCalendarEntry => ({
    id: 'l-1',
    employee: { id: 'karim', fullNameEn: 'Karim Nabil', department: 'Marketing', team: null },
    type: { nameEn: 'Annual leave' },
    startDate: '2026-11-03',
    endDate: '2026-11-03',
    halfDay: false,
    status: 'approved',
    ...over,
  });

  it('marks a work from home day apart, not as a day off; someone with only one still has a row', () => {
    const people = calendarPeople([wfh()], days);
    expect(people.map((p) => [p.name, p.daysOff, p.permissionHours, p.wfhDays])).toEqual([['Karim Nabil', 0, 0, 1]]);
    expect(people[0].cells[2]).toMatchObject({ wfh: true, permission: null, first: true, last: true, requestId: 'w-1', waiting: false });
    expect(offPerDay(people, days.length)[2]).toBe(0);
    expect(cellLabel(people[0].cells[2]!, 'Karim Nabil', days[2])).toBe('Karim Nabil: Working from home, approved, Tuesday 03/11/2026');
    expect(monthSummaryText(people)).toBe('No one off this month, 1 working from home');
    expect(WFH_CELL_TEXT).toBe('WFH');
    expect(calendarAgenda(people, days)[0].off[0]).toMatchObject({ wfh: true, requestId: 'w-1' });
  });

  it('gives way to leave on the same day; being decided, it is outlined as waiting', () => {
    const [karim] = calendarPeople([wfh(), leave()], days);
    expect(karim.cells[2]).toMatchObject({ typeName: 'Annual leave' });
    expect(karim.cells[2]?.wfh).toBeUndefined();
    expect([karim.daysOff, karim.wfhDays]).toEqual([1, 0]);
    const [waiting] = calendarPeople([wfh({ status: 'with_manager' })], days);
    expect(waiting.cells[2]).toMatchObject({ wfh: true, waiting: true });
    expect(calendarPeople([wfh({ status: 'cancelled' })], days)).toEqual([]);
  });
});
