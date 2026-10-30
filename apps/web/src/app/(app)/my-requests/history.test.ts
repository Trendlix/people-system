import { describe, expect, it } from 'vitest';
import type { AttendanceCorrectionView } from '../../../lib/correction-types';
import type { HomeLocationView } from '../../../lib/home-location-types';
import type { OdRequestView } from '../../../lib/od-types';
import type { RaiseRequest } from '../../../lib/raise-types';
import type { ResignationRequestView } from '../../../lib/resignation-types';
import type { ChangeRequest, LeaveRequestView, PermissionRequestView, ReimbursementClaimView } from '../../../lib/types';
import type { WfhRequestView } from '../../../lib/wfh-types';
import {
  emptyHistoryText,
  filterHistory,
  historyHref,
  historyRows,
  noticeText,
  readHistoryAll,
  readHistoryFilter,
  twoDigits,
  yearSummary,
  type HistoryRow,
} from './history';
import { myRequests } from './requests';

// invented people and requests; each kind with only what the table reads
const me = { id: 'me', employeeCode: 'TLX-0001', fullNameEn: 'Nour Adel' };

const leave = (id: string, createdAt: string, over: Partial<LeaveRequestView> = {}) =>
  ({
    id,
    type: {
      id: 't1',
      key: 'casual',
      nameEn: 'Casual leave',
      nameAr: 'إجازة عارضة',
      paid: 'paid',
    },
    startDate: '2026-10-25',
    endDate: '2026-10-25',
    halfDay: false,
    days: 1,
    status: 'approved',
    recordedByHr: true,
    createdAt,
    ...over,
  }) as LeaveRequestView;

const permission = (id: string, createdAt: string, over: Partial<PermissionRequestView> = {}) =>
  ({
    id,
    kind: 'permission',
    date: '2026-11-03',
    hours: 2,
    fromTime: '17:00',
    toTime: '19:00',
    status: 'with_manager',
    recordedByHr: false,
    createdAt,
    ...over,
  }) as PermissionRequestView;

const correction = (id: string, createdAt: string) =>
  ({
    id,
    date: '2026-10-12',
    correctionKind: 'forgot_check_out',
    status: 'with_hr',
    recordedByHr: false,
    confidential: false,
    createdAt,
  }) as unknown as AttendanceCorrectionView;

const wfh = (id: string, createdAt: string) =>
  ({
    id,
    date: '2026-10-28',
    status: 'rejected',
    recordedByHr: false,
    confidential: false,
    createdAt,
  }) as unknown as WfhRequestView;

const od = (id: string, createdAt: string) =>
  ({
    id,
    startDate: '2026-11-01',
    endDate: '2026-11-03',
    fullDay: true,
    dutyPlace: 'The client’s studio, Zamalek',
    status: 'with_manager',
    confidential: false,
    createdAt,
  }) as unknown as OdRequestView;

const home = (id: string, createdAt: string, over: Partial<HomeLocationView> = {}) =>
  ({
    id,
    kind: 'home',
    type: 'home',
    label: 'Maadi',
    latitude: 29.96,
    longitude: 31.25,
    radiusMetres: 100,
    status: 'approved',
    inForce: true,
    confidential: false,
    createdAt,
    ...over,
  }) as unknown as HomeLocationView;

const claim = (id: string, createdAt: string) =>
  ({
    id,
    type: {
      id: 'c1',
      nameEn: 'Transport',
      nameAr: 'مواصلات',
      receiptRequired: true,
    },
    expenseDate: '2026-10-20',
    amount: 450,
    status: 'with_finance',
    confidential: false,
    createdAt,
  }) as unknown as ReimbursementClaimView;

const resignation = (id: string, createdAt: string) =>
  ({
    id,
    status: 'sent',
    statusLabel: 'Sent to HR',
    sentOn: '2026-10-29',
    notice: '2 months',
    ruleLastDay: '2026-12-29',
    preferredLastDay: null,
    createdAt,
  }) as unknown as ResignationRequestView;

const change = (id: string, requestedAt: string, status: ChangeRequest['status']): ChangeRequest => ({
  id,
  employee: me,
  changes: [
    {
      field: 'mobile',
      label: 'Mobile',
      from: '+201000000000',
      to: '+201111111111',
    },
    { field: 'address', label: 'Address', from: 'Giza', to: 'Maadi' },
  ],
  note: null,
  status,
  requestedBy: { email: 'nour@trendlix.com' },
  requestedAt,
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
});

const raise = (id: string, createdAt: string, status: RaiseRequest['status'], over: Partial<RaiseRequest> = {}): RaiseRequest =>
  ({
    id,
    employee: me,
    employmentId: 'e1',
    requester: 'self',
    requestedBy: { email: 'nour@trendlix.com' },
    reason: 'A year of good work',
    status,
    createdAt,
    updatedAt: createdAt,
    suggestedGross: null,
    raise: null,
    decision: null,
    doneAt: null,
    amountsHidden: true,
    effectiveFrom: '2026-11-01',
    ...over,
  }) as RaiseRequest;

describe('historyRows', () => {
  const rows = historyRows({
    leave: [leave('l1', '2026-10-26T08:00:00.000Z')],
    permissions: [permission('p1', '2026-10-27T08:00:00.000Z')],
    corrections: [correction('c1', '2026-10-13T08:00:00.000Z')],
    wfh: [wfh('w1', '2026-10-21T08:00:00.000Z')],
    od: [od('o1', '2026-10-29T08:00:00.000Z')],
    homes: [home('h1', '2026-09-01T08:00:00.000Z')],
    claims: [claim('r1', '2026-10-22T08:00:00.000Z')],
    resignations: [resignation('s1', '2026-10-29T09:00:00.000Z')],
    requests: myRequests({
      changes: [change('d1', '2026-08-01T08:00:00.000Z', 'pending'), change('d2', '2026-07-01T08:00:00.000Z', 'approved')],
      raises: [raise('q1', '2026-03-01T08:00:00.000Z', 'with_hr')],
    }),
  });
  const byKey = (key: string) => rows.find((r) => r.key === key)!;

  it('puts every kind in one list, newest asked first', () => {
    expect(rows.map((r) => r.key)).toEqual([
      'resignation:s1',
      'od:o1',
      'permission:p1',
      'leave:l1',
      'claim:r1',
      'wfh:w1',
      'correction:c1',
      'home:h1',
      'details:d1',
      'details:d2',
      'raise:q1',
    ]);
  });

  it('says each row as the design’s table does: what, the day, how long, where it stands, opening its page', () => {
    expect(byKey('leave:l1')).toMatchObject({
      title: 'Casual leave',
      sub: 'Recorded by HR 26/10/2026',
      date: 'Sunday 25/10/2026',
      duration: '1 day',
      status: 'Approved',
      state: 'approved',
      href: '/leave/l1',
    });
    expect(byKey('permission:p1')).toMatchObject({
      title: 'Permission',
      sub: 'Sent 27/10/2026',
      date: 'Tuesday 03/11/2026',
      status: 'With the manager',
      state: 'waiting',
    });
    expect(byKey('correction:c1')).toMatchObject({
      title: 'Attendance correction',
      date: 'Monday 12/10/2026',
      duration: '—',
      status: 'With HR',
      state: 'waiting',
    });
    expect(byKey('wfh:w1')).toMatchObject({
      title: 'Work from home',
      date: 'Wednesday 28/10/2026',
      duration: '1 day',
      status: 'Rejected',
      state: 'closed',
    });
    expect(byKey('od:o1')).toMatchObject({
      title: 'Official duty',
      sub: 'The client’s studio, Zamalek · Sent 29/10/2026',
      state: 'waiting',
    });
    expect(byKey('home:h1')).toMatchObject({
      title: 'Check-in location',
      date: '—',
      status: 'Approved',
      state: 'approved',
    });
    expect(byKey('claim:r1')).toMatchObject({
      title: 'Reimbursement',
      sub: 'Transport · EGP 450.00 · Sent 22/10/2026',
      date: 'Tuesday 20/10/2026',
      status: 'With Finance',
      state: 'waiting',
    });
    expect(byKey('resignation:s1')).toMatchObject({
      title: 'Resignation',
      sub: 'Sent 29/10/2026',
      date: 'Last day 29/12/2026',
      duration: '2 months’ notice',
      status: 'Sent to HR',
      state: 'waiting',
    });
  });

  it('opens a change waiting for HR on its page, a decided one at its card, and a raise at its card', () => {
    expect(byKey('details:d1')).toMatchObject({
      title: 'Change to your details',
      sub: 'Mobile, Address · Sent 01/08/2026',
      state: 'waiting',
      href: '/employees/me/change-request',
    });
    expect(byKey('details:d2')).toMatchObject({
      state: 'approved',
      href: '/my-requests?kind=details#details-request-d2',
    });
    expect(byKey('raise:q1')).toMatchObject({
      title: 'Raise request',
      date: 'From November 2026',
      state: 'waiting',
      href: '/my-requests?kind=raise#raise-request-q1',
    });
  });

  it('says an approved check-in place that no longer counts has ended', () => {
    const [ended] = historyRows({
      homes: [home('h2', '2026-09-01T08:00:00.000Z', { inForce: false })],
    });
    expect(ended).toMatchObject({ status: 'Ended', state: 'approved' });
  });

  it('lists each request once, and nothing when nothing was read', () => {
    expect(
      historyRows({
        leave: [leave('l1', '2026-10-26T08:00:00.000Z'), leave('l1', '2026-10-26T08:00:00.000Z')],
      }),
    ).toHaveLength(1);
    expect(historyRows({})).toEqual([]);
  });

  it('reads a raise approved or done as approved, declined as closed', () => {
    const states = historyRows({
      requests: myRequests({
        changes: [],
        raises: (['with_hr', 'with_ceo', 'approved', 'declined', 'done'] as const).map((s, i) => raise(s, `2026-09-0${i + 1}T08:00:00.000Z`, s)),
      }),
    }).map((r) => [r.key, r.state]);
    expect(states).toEqual([
      ['raise:done', 'approved'],
      ['raise:declined', 'closed'],
      ['raise:approved', 'approved'],
      ['raise:with_ceo', 'waiting'],
      ['raise:with_hr', 'waiting'],
    ]);
  });
});

describe('the filter', () => {
  it('reads All, Approved or Waiting from the address, anything else as All', () => {
    expect(readHistoryFilter({ show: 'waiting' })).toBe('waiting');
    expect(readHistoryFilter({ show: 'approved' })).toBe('approved');
    expect(readHistoryFilter({ show: 'rejected' })).toBe('');
    expect(readHistoryFilter({ show: ['waiting', 'approved'] })).toBe('');
    expect(readHistoryAll({ all: '1' })).toBe(true);
    expect(readHistoryAll({})).toBe(false);
  });

  it('builds the address, keeping the changes-and-raises filters and landing on the panel', () => {
    expect(historyHref({}, '')).toBe('/my-requests#recent-requests');
    expect(historyHref({ kind: 'raise', status: 'open', show: 'approved', sent: '1' }, 'waiting')).toBe(
      '/my-requests?kind=raise&status=open&show=waiting#recent-requests',
    );
    expect(historyHref({ show: 'waiting' }, 'waiting', true)).toBe('/my-requests?show=waiting&all=1#recent-requests');
  });

  it('keeps the rows of the state chosen, in order', () => {
    const rows = [
      { key: 'a', state: 'approved' },
      { key: 'b', state: 'waiting' },
      { key: 'c', state: 'closed' },
      { key: 'd', state: 'approved' },
    ] as HistoryRow[];
    expect(filterHistory(rows, '').map((r) => r.key)).toEqual(['a', 'b', 'c', 'd']);
    expect(filterHistory(rows, 'approved').map((r) => r.key)).toEqual(['a', 'd']);
    expect(filterHistory(rows, 'waiting').map((r) => r.key)).toEqual(['b']);
  });

  it('says why the table is empty', () => {
    expect(emptyHistoryText('')).toBe('You haven’t asked for anything yet. Start a request below.');
    expect(emptyHistoryText('waiting')).toBe('Nothing is waiting: every request you sent is decided.');
  });
});

describe('Requests this year', () => {
  const row = (at: string, state: HistoryRow['state']) => ({ key: at, at, state }) as HistoryRow;

  it('counts the year’s requests, in Cairo, and says where they stand', () => {
    // 31 December 2025, 23:30 in Cairo is 2025; 1 January 2026, 00:30 in Cairo is 2026
    const rows = [row('2026-10-26T08:00:00.000Z', 'approved'), row('2025-12-31T22:30:00.000Z', 'approved'), row('2025-12-31T21:30:00.000Z', 'waiting')];
    expect(yearSummary(rows, '2026')).toEqual({
      count: 2,
      approved: 2,
      waiting: 0,
      note: 'Both requests approved',
    });
    expect(yearSummary(rows, '2025')).toEqual({
      count: 1,
      approved: 0,
      waiting: 1,
      note: '1 waiting',
    });
  });

  it('words the note by what there is', () => {
    expect(yearSummary([], '2026').note).toBe('None asked for yet');
    expect(yearSummary([row('2026-10-26T08:00:00.000Z', 'approved')], '2026').note).toBe('Approved');
    expect(
      yearSummary(
        [1, 2, 3].map(() => row('2026-10-26T08:00:00.000Z', 'approved')),
        '2026',
      ).note,
    ).toBe('All approved');
    expect(
      yearSummary([row('2026-10-26T08:00:00.000Z', 'approved'), row('2026-10-25T08:00:00.000Z', 'waiting'), row('2026-10-24T08:00:00.000Z', 'closed')], '2026').note,
    ).toBe('1 approved · 1 waiting · 1 closed');
  });

  it('writes the figure with two digits, as the design does', () => {
    expect([0, 2, 14, 120].map(twoDigits)).toEqual(['00', '02', '14', '120']);
  });

  it('says a notice as a length', () => {
    expect(noticeText('2 months')).toBe('2 months’ notice');
    expect(noticeText('1 month')).toBe('1 month’s notice');
  });
});
