import { seesRaiseRequests } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import type { AttendanceCorrectionView } from '../../../../lib/correction-types';
import type { HomeLocationView } from '../../../../lib/home-location-types';
import type { RaiseRequest } from '../../../../lib/raise-types';
import type { LeaveRequestView, PermissionRequestView, ReimbursementClaimView } from '../../../../lib/types';
import type { OdRequestView } from '../../../../lib/od-types';
import {
  appRequestCounts,
  appRequestHref,
  appRequestKindsFor,
  appRequestProgress,
  appRequestRows,
  appRequestTitle,
  appRequestWhen,
  filterAppRequests,
  readAppRequestFilters,
} from './rows';

// The phone pages' My Requests (owner, 20 October 2026: the employee app, "apply for their requests"). Every request
// here is invented.

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const leave = {
  id: ID(1),
  type: { id: 't', nameEn: 'Annual leave', nameAr: 'اعتيادية', paid: 'paid' },
  startDate: '2026-11-02',
  endDate: '2026-11-04',
  halfDay: false,
  days: 3,
  status: 'with_manager',
  manager: { id: 'm', fullNameEn: 'Sara Ali', role: 'direct_manager' },
  rejectedStage: null,
  rejectReason: null,
  recordedByHr: false,
  createdAt: '2026-10-18T09:00:00.000Z',
  steps: [],
} as unknown as LeaveRequestView;

const permission = {
  id: ID(2),
  kind: 'permission',
  date: '2026-10-27',
  hours: 2,
  fromTime: '15:00',
  toTime: '17:00',
  status: 'approved',
  manager: null,
  rejectedStage: null,
  rejectReason: null,
  recordedByHr: false,
  createdAt: '2026-10-19T09:00:00.000Z',
  steps: [],
} as unknown as PermissionRequestView;

const claim = {
  id: ID(3),
  type: { id: 'r', nameEn: 'Taxi', nameAr: 'تاكسي' },
  expenseDate: '2026-10-15',
  amount: 250,
  approvedAmount: null,
  status: 'with_finance',
  manager: null,
  rejectedStage: null,
  rejectReason: null,
  payMonth: null,
  payroll: null,
  createdAt: '2026-10-16T09:00:00.000Z',
} as unknown as ReimbursementClaimView;

const correction = {
  id: ID(4),
  date: '2026-10-14',
  correctionKind: 'forgot_check_out',
  status: 'rejected',
  manager: null,
  rejectedStage: 'hr',
  rejectReason: 'No',
  recordedByHr: false,
  createdAt: '2026-10-20T09:00:00.000Z',
  steps: [],
} as unknown as AttendanceCorrectionView;

const raise = {
  id: ID(5),
  status: 'with_hr',
  effectiveFrom: '2026-11-01',
  origin: 'asked',
  raise: null,
  createdAt: '2026-10-10T09:00:00.000Z',
} as unknown as RaiseRequest;

const all = appRequestRows({ leave: [leave], permissions: [permission], claims: [claim], corrections: [correction], raises: [raise, raise] });

describe('every request in one list', () => {
  it('lists each once, newest first', () => {
    expect(all.map((r) => r.kind)).toEqual(['correction', 'permission', 'leave', 'reimbursement', 'raise']);
  });

  it('knows which are still being decided', () => {
    expect(all.filter((r) => r.open).map((r) => r.kind)).toEqual(['leave', 'reimbursement', 'raise']);
  });

  it('copes with what couldn’t be read', () => {
    expect(appRequestRows({})).toEqual([]);
    expect(appRequestRows({ leave: [leave] })).toHaveLength(1);
  });
});

describe('the filters', () => {
  it('reads a kind and open ones from the address, anything else as All', () => {
    expect(readAppRequestFilters({ kind: 'leave', status: 'open' })).toEqual({ kind: 'leave', status: 'open' });
    expect(readAppRequestFilters({ kind: 'details', status: 'closed' })).toEqual({ kind: '', status: '' });
    expect(readAppRequestFilters({ kind: ['leave', 'raise'] })).toEqual({ kind: '', status: '' });
  });

  it('keeps the kind chosen and open ones when asked', () => {
    expect(filterAppRequests(all, { kind: 'leave', status: '' }).map((r) => r.id)).toEqual([ID(1)]);
    expect(filterAppRequests(all, { kind: '', status: 'open' }).map((r) => r.kind)).toEqual(['leave', 'reimbursement', 'raise']);
    expect(filterAppRequests(all, { kind: 'correction', status: 'open' })).toEqual([]);
  });

  it('counts each chip within the status chosen', () => {
    expect(appRequestCounts(all, { status: '' })).toEqual({ '': 5, leave: 1, permission: 1, reimbursement: 1, correction: 1, raise: 1, home: 0, wfh: 0, od: 0 });
    expect(appRequestCounts(all, { status: 'open' })).toEqual({ '': 3, leave: 1, permission: 0, reimbursement: 1, correction: 0, raise: 1, home: 0, wfh: 0, od: 0 });
  });
});

describe('a row', () => {
  const row = (kind: string) => all.find((r) => r.kind === kind)!;

  it('says what it is and when', () => {
    expect(appRequestTitle(row('leave'))).toBe('Annual leave');
    expect(appRequestWhen(row('leave'))).toBe('02/11/2026 – 04/11/2026 · 3 days');
    expect(appRequestTitle(row('permission'))).toBe('Permission');
    expect(appRequestWhen(row('permission'))).toMatch(/^Tuesday 27\/10\/2026 · 2 hours/);
    expect(appRequestTitle(row('reimbursement'))).toBe('Taxi reimbursement');
    expect(appRequestWhen(row('reimbursement'))).toMatch(/^15\/10\/2026 · EGP 250\.00$/);
    expect(appRequestTitle(row('correction'))).toBe('Attendance correction');
    expect(appRequestWhen(row('correction'))).toMatch(/^Wednesday 14\/10\/2026 · /);
    expect(appRequestTitle(row('raise'))).toBe('Raise request');
    expect(appRequestWhen(row('raise'))).toBe('Effective from November 2026');
  });

  it('says where it stands as its page does', () => {
    expect(appRequestProgress(row('leave'))).toMatch(/Sara Ali/);
    expect(appRequestProgress(row('permission'))).toBe('Approved');
    expect(appRequestProgress(row('reimbursement'))).toBe('Waiting for Finance');
    expect(appRequestProgress(row('correction'))).toBe('Rejected by HR');
  });

  it('opens its page in the phone pages', () => {
    expect(appRequestHref(row('leave'))).toBe(`/app/requests/leave/${ID(1)}`);
    expect(appRequestHref(row('reimbursement'), 'approve')).toBe(`/app/approve/reimbursement/${ID(3)}`);
  });
});

describe('raise requests kept from the employee level (owner, 20 October 2026: "raises not to be visible to employee level for now", then "Hide from managers too")', () => {
  it('offers the Raises chip only to someone who sees raise requests, by the shared helper', () => {
    // working from home among them (21 October 2026)
    expect(appRequestKindsFor(true)).toEqual(['leave', 'permission', 'reimbursement', 'correction', 'raise', 'home', 'wfh', 'od']);
    expect(appRequestKindsFor(false)).toEqual(['leave', 'permission', 'reimbursement', 'correction', 'home', 'wfh', 'od']);
    expect(appRequestKindsFor(seesRaiseRequests({ roles: ['employee'] }))).not.toContain('raise');
    expect(appRequestKindsFor(seesRaiseRequests({ roles: ['manager'] }))).not.toContain('raise');
    expect(appRequestKindsFor(seesRaiseRequests({ roles: ['ceo'] }))).toContain('raise');
  });

  it('reads ?kind=raise as All for them', () => {
    expect(readAppRequestFilters({ kind: 'raise', status: 'open' }, appRequestKindsFor(false))).toEqual({ kind: '', status: 'open' });
    expect(readAppRequestFilters({ kind: 'raise' }, appRequestKindsFor(true))).toEqual({ kind: 'raise', status: '' });
  });

  it('lists no raise rows when none are read', () => {
    expect(appRequestRows({ leave: [leave] }).map((r) => r.kind)).toEqual(['leave']);
  });
});

// owner, 20 October 2026: "allow other users to request to add their home locations when working from home"
describe('home location requests', () => {
  const home = {
    id: ID(6),
    kind: 'home',
    latitude: 30.101234,
    longitude: 31.380123,
    label: 'Home, Nasr City',
    radiusMetres: 100,
    status: 'with_hr',
    confidential: false,
    approvedAt: null,
    rejectedStage: null,
    rejectReason: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    steps: [],
  } as unknown as HomeLocationView;
  const removed = { ...home, id: ID(7), status: 'removed', latitude: null, longitude: null, label: null, createdAt: '2026-10-01T10:00:00.000Z' } as HomeLocationView;
  const rows = appRequestRows({ leave: [leave], homes: [home, removed] });

  it('are listed with the rest, newest first, open while with HR or the CEO', () => {
    expect(rows.map((r) => [r.kind, r.id, r.open])).toEqual([
      ['home', ID(6), true],
      ['leave', ID(1), true],
      ['home', ID(7), false],
    ]);
    expect(appRequestCounts(rows, { status: '' })).toMatchObject({ '': 3, home: 2, leave: 1 });
    expect(filterAppRequests(rows, { kind: 'home', status: 'open' }).map((r) => r.id)).toEqual([ID(6)]);
    expect(readAppRequestFilters({ kind: 'home' }, appRequestKindsFor(false))).toEqual({ kind: 'home', status: '' });
  });

  it('say what they are, where they stand, and open in the phone pages', () => {
    const [open, , gone] = rows;
    expect(appRequestTitle(open)).toBe('Home location');
    expect(appRequestWhen(open)).toBe('Home, Nasr City · 100 m');
    expect(appRequestProgress(open)).toBe('With HR, who decides it first; then the CEO');
    expect(appRequestWhen(gone)).toBe('Point deleted');
    expect(appRequestProgress(gone)).toBe('Removed: its point is deleted');
    expect(appRequestHref(open)).toBe(`/app/requests/home/${ID(6)}`);
  });

  // owner, 24 October 2026: "(Home Location - Remote Site - Client Location)"
  it('say their type: a remote site or a client location by its name', () => {
    const [site, client] = appRequestRows({ homes: [{ ...home, id: ID(8), type: 'remote_site', label: 'Studio' } as HomeLocationView, { ...home, id: ID(9), type: 'client', label: 'Acme', createdAt: '2026-10-19T10:00:00.000Z' } as HomeLocationView] });
    expect([appRequestTitle(site), appRequestWhen(site)]).toEqual(['Remote site', 'Remote site: Studio · 100 m']);
    expect([appRequestTitle(client), appRequestWhen(client)]).toEqual(['Client location', 'Client location: Acme · 100 m']);
  });
});

describe('official duty on the phone pages’ My Requests (owner, 23 October 2026: "Official duty (OD) requests")', () => {
  const od = {
    id: ID(9),
    kind: 'od',
    employee: { id: 'e', employeeCode: 'EMP-0001', fullNameEn: 'Nour Adel', fullNameAr: null, department: null, team: null },
    startDate: '2026-11-02',
    endDate: '2026-11-02',
    fullDay: false,
    fromTime: '10:00',
    toTime: '14:00',
    dutyPlace: 'The client’s office',
    reason: 'A site visit',
    late: false,
    status: 'with_manager',
    manager: { id: 'm', fullNameEn: 'Sara Ali', role: 'direct_manager' },
    rejectedStage: null,
    rejectReason: null,
    confidential: false,
    createdAt: '2026-10-23T09:00:00.000Z',
    steps: [],
  } as unknown as OdRequestView;

  it('lists one with its day and hours, open while being decided, under its own chip, opening its phone page', () => {
    const rows = appRequestRows({ od: [od] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'od', open: true });
    expect(appRequestTitle(rows[0])).toBe('Official duty');
    expect(appRequestWhen(rows[0])).toBe('Monday 02/11/2026, 10:00 AM–2:00 PM');
    expect(appRequestProgress(rows[0])).toContain('Sara Ali');
    expect(appRequestHref(rows[0])).toBe(`/app/requests/od/${ID(9)}`);
    expect(filterAppRequests(rows, readAppRequestFilters({ kind: 'od' }))).toHaveLength(1);
    expect(appRequestCounts(rows, { status: '' })).toMatchObject({ '': 1, od: 1 });
  });
});
