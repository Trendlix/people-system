import { describe, expect, it } from 'vitest';
import type { LeaveRequestView, PermissionRequestView } from '../../../lib/types';
import type { WfhRequestView } from '../../../lib/wfh-types';
import { wfhListPath } from '../attendance/wfh/wfh';
import { isPermission } from './permissions';
import { isWfhChoice, OWN_WFH_TEXT, recordTypeChoices, WFH_CHOICE, WFH_CHOICE_HINT } from './record/record-kind';
import { WFH_TYPE } from './request-filters';
import { isWfh, listEmptyText, mergeLeaveList, rowHref, rowKind, WFH_WHEN_NOTE, wfhQueryOf } from './wfh-rows';

// Work from home shown with leave (owner, 26 October 2026, on Record leave's types: "YES move it to leaves"; asked,
// "Show it with leave"): listed on Leave Requests with the leave and the permissions, and recorded from Record leave.
// Invented people and requests.

const ANA = '0b6f2f5e-8d0e-4c9a-9a39-6f0f5a1d2c3e';
const WFH_ID = '11111111-2222-4333-8444-555555555555';

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

const wfh = (over: Partial<WfhRequestView> = {}): WfhRequestView => ({
  id: WFH_ID,
  kind: 'wfh',
  employee: { id: 'mona', employeeCode: 'EMP-0001', fullNameEn: 'Mona Adel', fullNameAr: null, department: 'Sales', team: null },
  type: { id: 'wfh', key: 'wfh', nameEn: 'Work from home', nameAr: 'العمل من المنزل' },
  date: '2026-11-03',
  startDate: '2026-11-03',
  endDate: '2026-11-03',
  reason: null,
  status: 'with_hr',
  stage: 'hr',
  waitingForYou: true,
  confidential: false,
  canCancel: false,
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

describe('Leave Requests with work from home', () => {
  it('merges the three lists newest first: the latest day, then the latest sent, a work from home day by its day', () => {
    const rows = mergeLeaveList(
      [leave({ id: 'l-old', startDate: '2026-10-05' }), leave({ id: 'l-new', startDate: '2026-11-03', createdAt: '2026-10-19T09:00:00.000Z' })],
      [permission({ id: 'p-mid', date: '2026-11-03', startDate: '2026-11-03' }), permission({ id: 'p-top', date: '2026-11-10', startDate: '2026-11-10' })],
      [wfh({ id: 'w-top', date: '2026-11-03', startDate: '2026-11-03', endDate: '2026-11-03', createdAt: '2026-10-21T08:00:00.000Z' }), wfh({ id: 'w-low', date: '2026-10-01', startDate: '2026-10-01', endDate: '2026-10-01' })],
    );
    expect(rows.map((r) => r.id)).toEqual(['p-top', 'w-top', 'l-new', 'p-mid', 'l-old', 'w-low']);
    expect(rows.map(rowKind)).toEqual(['permission', 'wfh', 'leave', 'permission', 'leave', 'wfh']);
    expect(rows.map(isWfh)).toEqual([false, true, false, false, false, true]);
    // a work from home row is no permission, though both have a kind
    expect(isPermission(rows[1] as PermissionRequestView)).toBe(false);
  });

  it('each row opens its own page: a work from home request at its address, kept under /attendance/wfh', () => {
    expect(rowHref(wfh())).toBe(`/attendance/wfh/${WFH_ID}`);
    expect(rowHref(permission({ id: 'p-1' }))).toBe('/leave/permissions/p-1');
    expect(rowHref(leave({ id: 'l-1' }))).toBe('/leave/l-1');
    expect(WFH_WHEN_NOTE).toBe('A working day, not leave');
  });

  it('asks the work from home list with the same status, person and days: Waiting for you is what waits for the caller', () => {
    const days = { from: '2026-10-01', to: '2026-10-31' };
    expect(wfhListPath(wfhQueryOf('waiting', null, { from: null, to: null }))).toBe('/wfh?status=waiting');
    expect(wfhListPath(wfhQueryOf('all', null, { from: null, to: null }))).toBe('/wfh');
    expect(wfhListPath(wfhQueryOf('approved', ANA, days))).toBe(`/wfh?status=approved&from=2026-10-01&to=2026-10-31&employeeId=${ANA}`);
    for (const status of ['with_manager', 'with_hr', 'rejected', 'cancelled'] as const) expect(wfhQueryOf(status, null, { from: null, to: null }).filter).toBe(status);
    expect(wfhListPath(wfhQueryOf('all', null, { from: null, to: '2026-10-31' }))).toBe('/wfh?to=2026-10-31');
  });

  it('says when nothing is listed: all three, the work from home alone, or the leave and the permissions as before', () => {
    expect(listEmptyText('waiting', 'all')).toBe('No leave, permission or work from home requests are waiting for you.');
    expect(listEmptyText('approved', 'all')).toBe('No leave, permission or work from home approved.');
    expect(listEmptyText('waiting', 'wfh')).toBe('No work from home requests are waiting for you.');
    expect(listEmptyText('all', 'wfh')).toBe('No work from home requests yet. Employees ask from My Requests; HR records a day for someone with Record leave, choosing Work from home.');
    expect(listEmptyText('waiting', 'leave')).toBe('No leave requests are waiting for you.');
    expect(listEmptyText('waiting', 'permission')).toBe('No permission requests are waiting for you.');
  });
});

describe('Record leave’s Work from home', () => {
  it('ends the types with Work from home, the same choice as the Type filter’s, never a leave type', () => {
    const types = [
      { id: 'annual', nameEn: 'Annual leave' },
      { id: 'casual', nameEn: 'Casual leave' },
      { id: 'sick', nameEn: 'Sick leave' },
      { id: 'unpaid', nameEn: 'Unpaid leave' },
    ];
    expect(recordTypeChoices(types)).toEqual([
      { value: '', label: 'Choose a type' },
      { value: 'annual', label: 'Annual leave' },
      { value: 'casual', label: 'Casual leave' },
      { value: 'sick', label: 'Sick leave' },
      { value: 'unpaid', label: 'Unpaid leave' },
      { value: 'wfh', label: 'Work from home' },
    ]);
    expect(recordTypeChoices([]).map((c) => c.value)).toEqual(['', 'wfh']);
    expect(WFH_CHOICE).toEqual({ value: WFH_TYPE, label: 'Work from home' });
    expect(isWfhChoice('wfh')).toBe(true);
    expect(isWfhChoice('annual')).toBe(false);
    expect(isWfhChoice('')).toBe(false);
  });

  it('is one day at a time, a working day, and never HR’s own', () => {
    expect(WFH_CHOICE_HINT).toContain('One day at a time');
    expect(WFH_CHOICE_HINT).toContain('Not leave');
    expect(OWN_WFH_TEXT).toBe('Someone else in HR has to record your own work from home day, or ask for it from My Requests.');
  });
});
