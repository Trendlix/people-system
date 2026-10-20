import { describe, expect, it } from 'vitest';
import type { LeaveRequestView, PermissionMonthView, PermissionRequestView } from '../../../lib/types';
import {
  asksPermission,
  emptyRequestsText,
  hoursFrom,
  isPermission,
  mergeRequests,
  MY_PERMISSION_HREF,
  NEW_PERMISSION_PATH,
  newPermissionBack,
  noPermissionText,
  permissionBack,
  permissionDayText,
  permissionDecidedText,
  permissionDecisionButton,
  permissionDoneHref,
  permissionDoneText,
  permissionForm,
  permissionFormProblems,
  permissionHourOptions,
  permissionHoursLine,
  permissionHref,
  permissionInDaysText,
  permissionMonthText,
  permissionReadyText,
  permissionSentText,
  permissionsPath,
  permissionStepText,
  permissionTimesText,
  permissionWhenText,
  readRequestKind,
  RECORD_PERMISSION_PATH,
  recordPermissionHref,
  recordsPermission,
  REQUEST_KIND_FILTERS,
  requestHref,
  requestListHref,
  shownMessage,
  typedPermissionValues,
  typedTimes,
  upcomingPermissions,
  usedOnDay,
  WAITING_PERMISSIONS,
  workedOutTimes,
  type TypedPermission,
} from './permissions';

// Permission requests (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a maximum 2 hours
// per day"; "In the system, like leave"; "Yes, in Leave Setup"). Invented people and requests.

const ID = '0b8f2c1e-1111-4222-8333-444455556666';

const permission = (p: Partial<PermissionRequestView> = {}): PermissionRequestView => ({
  id: 'p1',
  kind: 'permission',
  employee: { id: 'nour', fullNameEn: 'Nour Adel', fullNameAr: null, department: 'Marketing', team: null },
  type: { id: 'permission', key: 'permission', nameEn: 'Permission', nameAr: 'إذن' },
  date: '2026-11-03',
  startDate: '2026-11-03',
  endDate: '2026-11-03',
  hours: 2,
  fromTime: '17:00',
  toTime: '19:00',
  reason: null,
  status: 'with_manager',
  stage: 'manager',
  waitingForYou: false,
  canCancel: true,
  manager: { id: 'sara', fullNameEn: 'Sara Ali', role: 'direct_manager' },
  rejectedStage: null,
  rejectReason: null,
  recordedByHr: false,
  steps: [],
  monthLeft: 2,
  createdAt: '2026-10-19T08:00:00.000Z',
  ...p,
});

const leave = (l: Partial<LeaveRequestView> = {}) =>
  ({
    id: 'l1',
    employee: { id: 'karim', fullNameEn: 'Karim Nabil', fullNameAr: null, department: 'Marketing', team: null },
    type: { id: 't1', key: 'annual', nameEn: 'Annual leave', nameAr: 'إجازة سنوية', paid: 'paid' },
    startDate: '2026-11-02',
    endDate: '2026-11-04',
    halfDay: false,
    days: 3,
    reason: null,
    status: 'approved',
    stage: null,
    waitingForYou: false,
    canCancel: false,
    manager: null,
    rejectedStage: null,
    rejectReason: null,
    recordedByHr: false,
    documents: [],
    steps: [],
    balanceAfter: null,
    createdAt: '2026-10-18T08:00:00.000Z',
    ...l,
  }) satisfies LeaveRequestView;

const month = (m: Partial<PermissionMonthView> = {}): PermissionMonthView => ({
  month: '2026-11',
  hoursPerMonth: 4,
  maxHoursPerDay: 2,
  approved: 1.5,
  pending: 0.5,
  left: 2,
  days: [{ date: '2026-11-03', hours: 1.5 }],
  ...m,
});

const typed = (t: Partial<TypedPermission> = {}): TypedPermission => ({ date: '10/11/2026', hours: '1', fromTime: '', toTime: '', reason: '', ...t });

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

describe('the addresses', () => {
  it('live under Leave Requests', () => {
    expect(NEW_PERMISSION_PATH).toBe('/leave/permissions/new');
    expect(RECORD_PERMISSION_PATH).toBe('/leave/permissions/record');
    expect(recordPermissionHref(ID)).toBe(`/leave/permissions/record?employee=${ID}`);
    expect(recordPermissionHref(null)).toBe('/leave/permissions/record');
    expect(permissionHref(ID)).toBe(`/leave/permissions/${ID}`);
    expect(permissionDoneHref(ID, 'sent')).toBe(`/leave/permissions/${ID}?done=sent`);
    expect(MY_PERMISSION_HREF).toBe('/my-requests#my-permission');
  });

  it('go back to Leave Requests, My Requests or My Team, as a leave request’s', () => {
    expect(permissionBack({ roles: ['hr'] }, permission())).toEqual({ href: '/leave?kind=permission', label: 'Leave Requests' });
    expect(permissionBack({ roles: ['employee'], employeeId: 'nour' }, permission())).toEqual({ href: MY_PERMISSION_HREF, label: 'My Requests' });
    expect(permissionBack({ roles: ['manager'], employeeId: 'sara' }, permission())).toEqual({ href: '/my-team', label: 'My Team' });
    expect(newPermissionBack({ roles: ['ceo'] })).toEqual({ href: '/leave', label: 'Leave Requests' });
    expect(newPermissionBack({ roles: ['employee'] })).toEqual({ href: MY_PERMISSION_HREF, label: 'My Requests' });
    expect(recordsPermission({ roles: ['hr'] })).toBe(true);
    expect(recordsPermission({ roles: ['ceo', 'admin'] })).toBe(false);
  });
});

describe('the list: leave, permissions or both', () => {
  it('reads the kind in the address, both when none, keeping the status in each link', () => {
    expect(REQUEST_KIND_FILTERS.map((k) => k.label)).toEqual(['All', 'Leave', 'Permissions']);
    expect(readRequestKind({ kind: 'permission' })).toBe('permission');
    expect(readRequestKind({ kind: 'leave' })).toBe('leave');
    expect(readRequestKind({ kind: 'other' })).toBe('all');
    expect(readRequestKind({})).toBe('all');
    expect(requestListHref('waiting', 'permission')).toBe('/leave?status=waiting&kind=permission');
    expect(requestListHref('approved')).toBe('/leave?status=approved');
    expect(requestListHref(null, 'leave')).toBe('/leave?kind=leave');
    expect(requestListHref(null)).toBe('/leave');
  });

  it('asks the API for the permissions of a status, or one person’s', () => {
    expect(permissionsPath('all')).toBe('/leave/permissions');
    expect(permissionsPath('with_hr')).toBe('/leave/permissions?status=with_hr');
    expect(permissionsPath('all', ID)).toBe(`/leave/permissions?employeeId=${ID}`);
    expect(WAITING_PERMISSIONS).toBe('/leave/permissions?status=waiting');
  });

  it('says what is missing by the kind', () => {
    expect(emptyRequestsText('waiting', 'leave')).toBe('No leave requests are waiting for you.');
    expect(emptyRequestsText('waiting', 'permission')).toBe('No permission requests are waiting for you.');
    expect(emptyRequestsText('waiting', 'all')).toBe('No leave or permission requests are waiting for you.');
    expect(emptyRequestsText('approved', 'permission')).toBe('No permission approved.');
  });

  it('merges the leave and the permissions newest first: the latest day, then the latest sent', () => {
    const rows = mergeRequests(
      [leave({ id: 'l-old', startDate: '2026-10-05' }), leave({ id: 'l-new', startDate: '2026-11-03', createdAt: '2026-10-19T09:00:00.000Z' })],
      [permission({ id: 'p-mid', date: '2026-11-03', startDate: '2026-11-03' }), permission({ id: 'p-top', date: '2026-11-10', startDate: '2026-11-10' })],
    );
    expect(rows.map((r) => r.id)).toEqual(['p-top', 'l-new', 'p-mid', 'l-old']);
    expect(rows.map((r) => isPermission(r))).toEqual([true, false, true, false]);
    expect(requestHref(rows[0])).toBe('/leave/permissions/p-top');
    expect(requestHref(rows[1])).toBe('/leave/l-new');
  });
});

describe('a permission, in words', () => {
  it('says its day, its hours and its times in 12-hour time', () => {
    expect(permissionDayText(permission())).toBe('Tuesday 03/11/2026');
    expect(permissionTimesText(permission())).toBe('5:00 PM – 7:00 PM');
    expect(permissionTimesText({ fromTime: '09:30', toTime: null })).toBe('from 9:30 AM');
    expect(permissionTimesText({ fromTime: null, toTime: '12:00' })).toBe('until 12:00 PM');
    expect(permissionTimesText({ fromTime: null, toTime: null })).toBeNull();
    expect(permissionHoursLine(permission())).toBe('2 hours (5:00 PM – 7:00 PM)');
    expect(permissionHoursLine(permission({ hours: 1.5, fromTime: null, toTime: null }))).toBe('1 hour 30 minutes');
    expect(permissionWhenText(permission())).toBe('Tuesday 03/11/2026 · 2 hours (5:00 PM – 7:00 PM)');
  });

  it('offers the hours in half hours up to the day’s most', () => {
    expect(permissionHourOptions(2)).toEqual([
      { value: '0.5', label: '30 minutes' },
      { value: '1', label: '1 hour' },
      { value: '1.5', label: '1 hour 30 minutes' },
      { value: '2', label: '2 hours' },
    ]);
    expect(permissionHourOptions(0.5).map((o) => o.value)).toEqual(['0.5']);
    expect(permissionHourOptions(20)).toHaveLength(16);
  });

  it('says what is left of a month, and that permission is off', () => {
    expect(permissionMonthText(month(), '2026-11')).toBe('This month: 1:30 approved, 0:30 waiting, 2:00 left of 4:00');
    expect(permissionMonthText(month({ pending: 0, approved: 0, left: 4 }), '2026-10')).toBe('November 2026: 0:00 approved, 4:00 left of 4:00');
    expect(permissionMonthText(month({ hoursPerMonth: 0 }), '2026-11')).toBe('This month: permission is turned off in Leave Setup.');
    expect(usedOnDay(month(), '2026-11-03')).toBe(1.5);
    expect(usedOnDay(month(), '2026-11-04')).toBe(0);
  });

  it('isn’t for a freelancer or an unpaid intern, outside the labour law', () => {
    expect(noPermissionText('full_time')).toBeNull();
    expect(noPermissionText('trainee')).toBeNull();
    expect(noPermissionText('freelance')).toContain('No permission under a freelance employment');
    expect(noPermissionText('intern')).toContain('No permission under an unpaid internship');
  });
});

describe('coming up, on the dashboard', () => {
  // owner, 19 October 2026: "upcoming permissions on the employee dashboard"
  it('lists the approved permission of today and later, the soonest first, the earlier time first on a day', () => {
    const rows = [
      permission({ id: 'past', date: '2026-10-18', status: 'approved' }),
      permission({ id: 'later', date: '2026-11-10', status: 'approved', fromTime: null, toTime: null }),
      permission({ id: 'today', date: '2026-10-19', status: 'approved', fromTime: '17:00' }),
      permission({ id: 'morning', date: '2026-11-10', status: 'approved', fromTime: '09:00', toTime: '10:00', hours: 1 }),
      permission({ id: 'waiting', date: '2026-10-20', status: 'with_manager' }),
      permission({ id: 'rejected', date: '2026-10-21', status: 'rejected' }),
      permission({ id: 'cancelled', date: '2026-10-22', status: 'cancelled' }),
    ];
    expect(upcomingPermissions(rows, '2026-10-19').map((p) => p.id)).toEqual(['today', 'morning', 'later']);
    expect(upcomingPermissions(rows, '2026-10-19', 1).map((p) => p.id)).toEqual(['today']);
    expect(upcomingPermissions([], '2026-10-19')).toEqual([]);
  });

  it('says how far off it is', () => {
    expect(permissionInDaysText({ date: '2026-10-19' }, '2026-10-19')).toBe('Today');
    expect(permissionInDaysText({ date: '2026-10-20' }, '2026-10-19')).toBe('Tomorrow');
    expect(permissionInDaysText({ date: '2026-10-29' }, '2026-10-19')).toBe('In 10 days');
  });
});

describe('what its page says once something is done', () => {
  it('says where a request sent goes, and that one recorded is approved', () => {
    expect(permissionSentText('with_manager', { role: 'direct_manager' })).toBe('Request sent. It goes to your direct manager, then HR; each step shows on the request.');
    expect(permissionSentText('with_hr', null, true)).toBe('Request sent. It goes to the CEO; each step shows on the request.');
    expect(permissionSentText('approved')).toBe('Permission recorded, approved at once. Its hours count as worked in the month’s payroll.');
  });

  it('says each decision, and where an approved one goes', () => {
    expect(permissionDecidedText('approve', 'manager')).toBe('Approved: the request goes to HR.');
    expect(permissionDecidedText('approve', 'manager', true)).toBe('Approved: the request goes to the CEO.');
    expect(permissionDecidedText('approve', 'hr')).toBe('Approved: its hours count as worked in the month’s payroll.');
    expect(permissionDecidedText('reject', 'hr')).toBe('Request rejected. The employee sees your comment.');
  });

  it('reads ?done=', () => {
    expect(permissionDoneText({ done: 'sent' }, 'with_manager', { role: 'team_lead' })).toEqual({ text: 'Request sent. It goes to your team lead, then HR; each step shows on the request.', tone: 'ok' });
    expect(permissionDoneText({ done: 'cancelled' }, 'cancelled')?.text).toBe('Permission cancelled. Its hours are back in the month’s allowance; it stays on the list, cancelled.');
    expect(permissionDoneText({ done: 'moved' }, 'approved')?.tone).toBe('warn');
    expect(permissionDoneText({ done: 'hr_approve' }, 'approved')?.text).toBe('Approved: its hours count as worked in the month’s payroll.');
    expect(permissionDoneText({ done: 'other' }, 'approved')).toBeNull();
    expect(permissionDoneText({}, 'approved')).toBeNull();
  });

  it('logs each step as leave does, a cancelling giving the hours back', () => {
    expect(permissionStepText({ kind: 'cancelled', decision: null, comment: null })).toBe('Cancelled, the hours given back');
    expect(permissionStepText({ kind: 'manager_decision', decision: 'approve', comment: null }, { role: 'team_lead' })).toBe('The team lead approved it');
    expect(permissionStepText({ kind: 'recorded_by_hr', decision: null, comment: null })).toBe('Recorded by HR, approved at once');
  });

  it('has the decision form approve the permission at the last stage', () => {
    expect(permissionDecisionButton('approve', 'hr').label).toBe('Approve the permission');
    expect(permissionDecisionButton('approve', 'manager').label).toBe('Approve and send to HR');
    expect(permissionDecisionButton('reject', 'hr').label).toBe('Reject the request');
  });
});

describe('the form', () => {
  it('reads the hours in half hours, and the times in 12-hour time or 24-hour', () => {
    expect(hoursFrom('1.5')).toBe(1.5);
    // typed on an Arabic keyboard
    expect(hoursFrom('١٫٥')).toBe(1.5);
    expect(hoursFrom('2')).toBe(2);
    expect(hoursFrom('1.25')).toBeNull();
    expect(hoursFrom('0')).toBeNull();
    expect(hoursFrom('9')).toBeNull();
    expect(hoursFrom('')).toBeNull();
    expect(typedTimes({ fromTime: '5:00 PM', toTime: '' })).toEqual({ fromTime: '17:00', toTime: null, problems: [] });
    expect(typedTimes({ fromTime: '', toTime: '19:00' })).toEqual({ fromTime: null, toTime: '19:00', problems: [] });
    expect(typedTimes({ fromTime: '25:00', toTime: 'soon' }).problems).toEqual([
      'Choose the hour, minutes and AM or PM of the time it starts.',
      'Choose the hour, minutes and AM or PM of the time it ends.',
    ]);
    // partly chosen in the lists (lib/time-parts.ts): the minutes missing
    expect(typedTimes({ fromTime: '5:-- PM', toTime: '' }).problems).toEqual(['Choose the hour, minutes and AM or PM of the time it starts.']);
  });

  it('shows the shared and the API’s messages with the dates and times as the screens show them', () => {
    expect(shownMessage('From 17:00 to 18:00 is 1 hour, not 2 hours: change the hours or the times.')).toBe('From 5:00 PM to 6:00 PM is 1 hour, not 2 hours: change the hours or the times.');
    expect(shownMessage('Enter the time it starts as HH:MM, e.g. 17:00.')).toBe('Enter the time it starts as a 12-hour time, e.g. 5:00 PM.');
    expect(shownMessage('Enter the day of the permission, e.g. 2026-11-01.')).toBe('Enter the day of the permission, e.g. 01/11/2026.');
  });

  it('checks live what it can: the day, the hours, the times, the day’s most and what is left of the day and the month', () => {
    expect(permissionFormProblems(typed({ date: '', hours: '' }), month())).toEqual(['Enter the day of the permission.', 'Choose the hours.']);
    expect(permissionFormProblems(typed({ date: '31/02/2026' }), month())).toEqual(['Enter the day as DD/MM/YYYY, e.g. 03/11/2026.']);
    expect(permissionFormProblems(typed(), month())).toEqual([]);
    // 1.5 already asked for on the 3rd, of the 2 a day
    expect(permissionFormProblems(typed({ date: '03/11/2026', hours: '1' }), month())).toEqual(['Only 30 minutes left of the 2 hours a day on 03/11/2026: 1 hour 30 minutes already asked for.']);
    // 2 approved and waiting of the 4 a month: 2.5 is too many (and more than the day's most)
    expect(permissionFormProblems(typed({ hours: '2' }), month({ approved: 2, pending: 1, days: [] }))).toEqual(["Only 1 hour left of November 2026's 4 hours of permission."]);
    // times that don't span the hours, in 12-hour time
    expect(permissionFormProblems(typed({ hours: '2', fromTime: '5:00 PM', toTime: '6:00 PM' }), month({ days: [] }))).toEqual([
      'From 5:00 PM to 6:00 PM is 1 hour, not 2 hours: change the hours or the times.',
    ]);
    // off in Leave Setup
    expect(permissionFormProblems(typed(), month({ hoursPerMonth: 0 }))).toEqual(['Permission is turned off in Leave Setup: there are no permission hours a month to ask for.']);
    // another month, not read yet: only the times are checked here
    expect(permissionFormProblems(typed({ date: '01/12/2026', hours: '2' }), month())).toEqual([]);
    expect(permissionFormProblems(typed({ date: '01/12/2026', hours: '2', fromTime: '11:00 PM' }), null)).toEqual(['2 hours from 11:00 PM run to midnight or past it: choose an earlier time.']);
    expect(permissionFormProblems(typed({ reason: 'x'.repeat(501) }), month())).toEqual(['Keep the reason to 500 characters; it has 501.']);
  });

  it('shows the times as they will be saved, and what it is ready to send', () => {
    expect(workedOutTimes(typed({ hours: '2', fromTime: '5:00 PM' }))).toBe('5:00 PM – 7:00 PM');
    expect(workedOutTimes(typed({ hours: '1.5', toTime: '10:30 AM' }))).toBe('9:00 AM – 10:30 AM');
    expect(workedOutTimes(typed())).toBeNull();
    expect(permissionReadyText(typed({ hours: '2', fromTime: '5:00 PM' }), false, 'Nour Adel')).toBe(
      'Ready to send: 2 hours on Tuesday 10/11/2026 (5:00 PM – 7:00 PM), to your direct manager (without one, your lead), then HR.',
    );
    expect(permissionReadyText(typed(), false, 'Nour Adel', true)).toBe('Ready to send: 1 hour on Tuesday 10/11/2026, to your direct manager (without one, your lead), then the CEO.');
    expect(permissionReadyText(typed(), true, 'Nour Adel')).toBe('Ready to record: 1 hour on Tuesday 10/11/2026 for Nour Adel, approved at once.');
  });

  it('is read into what the API takes, the times only when given', () => {
    expect(permissionForm(form({ date: '10/11/2026', hours: '1.5', fromTime: '5:00 PM', toTime: '', reason: ' Doctor ' }))).toEqual({
      body: { date: '2026-11-10', hours: 1.5, fromTime: '17:00', reason: 'Doctor' },
      errors: [],
    });
    expect(permissionForm(form({ date: '10/11/2026', hours: '2', fromTime: '', toTime: '' }))).toEqual({ body: { date: '2026-11-10', hours: 2 }, errors: [] });
    expect(permissionForm(form({ date: '', hours: '', fromTime: 'later', toTime: '' }))).toEqual({
      body: null,
      errors: ['Enter the day of the permission.', 'Choose the hours.', 'Choose the hour, minutes and AM or PM of the time it starts.'],
    });
    expect(typedPermissionValues(form({ date: '10/11/2026', hours: '1', employeeId: ID }))).toEqual({ date: '10/11/2026', hours: '1', fromTime: '', toTime: '', reason: '', employeeId: ID });
  });
});

describe('whether New permission is offered (My Requests, the phone pages)', () => {
  it('needs an employment under the labour law and hours a month', () => {
    expect(asksPermission({ employmentType: 'full_time' }, { hoursPerMonth: 4 })).toBe(true);
    expect(asksPermission({ employmentType: 'full_time' }, { hoursPerMonth: 0 })).toBe(false);
    expect(asksPermission({ employmentType: 'full_time' }, null)).toBe(false);
    expect(asksPermission({ employmentType: 'freelance' }, { hoursPerMonth: 4 })).toBe(false);
    expect(asksPermission({ employmentType: 'intern' }, { hoursPerMonth: 4 })).toBe(false);
    expect(asksPermission(null, { hoursPerMonth: 4 })).toBe(false);
  });
});
