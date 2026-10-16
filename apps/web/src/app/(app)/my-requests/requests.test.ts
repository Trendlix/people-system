import { describe, expect, it } from 'vitest';
import type { RaiseRequest } from '../../../lib/raise-types';
import type { ChangeRequest } from '../../../lib/types';
import {
  askedByManager,
  filterRequests,
  myRequests,
  myRequestsHref,
  readRequestFilters,
  requestCounts,
  requestLabel,
  requestTitle,
  type MyRequest,
} from './requests';

const change = (id: string, requestedAt: string, status: ChangeRequest['status']): ChangeRequest => ({
  id,
  employee: { id: 'me', employeeCode: 'TLX-0001', fullNameEn: 'Nour Adel' },
  changes: [{ field: 'mobile', label: 'Mobile', from: '+201000000000', to: '+201111111111' }],
  note: null,
  status,
  requestedBy: { email: 'nour@trendlix.com' },
  requestedAt,
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
});

const raise = (id: string, createdAt: string, status: RaiseRequest['status'], over: Partial<RaiseRequest> = {}): RaiseRequest => ({
  id,
  employee: { id: 'me', employeeCode: 'TLX-0001', fullNameEn: 'Nour Adel' },
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
  ...over,
});

const report = { id: 'r1', employeeCode: 'TLX-0002', fullNameEn: 'Omar Sayed' };

describe('myRequests', () => {
  const list = myRequests({
    changes: [change('c1', '2026-10-01T08:00:00.000Z', 'approved'), change('c2', '2026-10-15T08:00:00.000Z', 'pending')],
    raises: [raise('r-old', '2026-03-01T08:00:00.000Z', 'declined'), raise('r-new', '2026-10-10T08:00:00.000Z', 'with_hr')],
    team: [raise('t1', '2026-10-12T08:00:00.000Z', 'with_ceo', { employee: report, requester: 'manager', requestedBy: { email: 'lead@trendlix.com' } })],
  });

  it('puts every kind in one list, newest first', () => {
    expect(list.map((r) => [r.kind, r.id])).toEqual([
      ['details', 'c2'],
      ['team', 't1'],
      ['raise', 'r-new'],
      ['details', 'c1'],
      ['raise', 'r-old'],
    ]);
  });

  it('tells the open ones: a change waiting for HR, a raise with HR, with the CEO or approved', () => {
    expect(list.filter((r) => r.open).map((r) => r.id)).toEqual(['c2', 't1', 'r-new']);
    const states = myRequests({
      changes: (['pending', 'approved', 'rejected', 'cancelled'] as const).map((s, i) => change(`c${i}`, `2026-10-0${i + 1}T08:00:00.000Z`, s)),
      raises: (['with_hr', 'with_ceo', 'approved', 'declined', 'done'] as const).map((s, i) => raise(s, `2026-09-0${i + 1}T08:00:00.000Z`, s)),
    });
    expect(states.filter((r) => r.open).map((r) => r.id)).toEqual(['c0', 'approved', 'with_ceo', 'with_hr']);
  });

  it('lists each request once', () => {
    const twice = raise('same', '2026-10-10T08:00:00.000Z', 'with_hr');
    expect(myRequests({ changes: [], raises: [twice, twice] })).toHaveLength(1);
    expect(myRequests({ changes: [], raises: [], team: undefined })).toEqual([]);
  });
});

describe('askedByManager', () => {
  it('keeps the raises this manager asked for a direct report, by their sign-in email in any case', () => {
    const requests = [
      raise('mine', '2026-10-10T08:00:00.000Z', 'with_hr', { requester: 'manager', requestedBy: { email: 'Lead@TrendLIX.com' } }),
      raise('theirs', '2026-10-09T08:00:00.000Z', 'with_hr', { requester: 'self', requestedBy: { email: 'omar@trendlix.com' } }),
      raise('hr', '2026-10-08T08:00:00.000Z', 'done', { requester: 'hr', requestedBy: { email: 'hr@trendlix.com' } }),
      raise('before', '2026-01-08T08:00:00.000Z', 'done', { requester: 'manager', requestedBy: { email: 'old.lead@trendlix.com' } }),
      raise('unknown', '2026-01-07T08:00:00.000Z', 'done', { requester: 'manager', requestedBy: null }),
    ];
    expect(askedByManager(requests, ' lead@trendlix.com ').map((r) => r.id)).toEqual(['mine']);
  });
});

describe('the filters', () => {
  const list: MyRequest[] = myRequests({
    changes: [change('c1', '2026-10-01T08:00:00.000Z', 'rejected'), change('c2', '2026-10-15T08:00:00.000Z', 'pending')],
    raises: [raise('r1', '2026-10-10T08:00:00.000Z', 'done')],
    team: [raise('t1', '2026-10-12T08:00:00.000Z', 'with_hr', { employee: report, requester: 'manager' })],
  });

  it('reads the kind and the status from the address, anything else as All', () => {
    expect(readRequestFilters({ kind: 'raise', status: 'open' })).toEqual({ kind: 'raise', status: 'open' });
    expect(readRequestFilters({ kind: 'team', status: 'closed' })).toEqual({ kind: 'team', status: 'closed' });
    expect(readRequestFilters({ kind: 'leave', status: 'pending' })).toEqual({ kind: '', status: '' });
    expect(readRequestFilters({ kind: ['raise', 'details'] })).toEqual({ kind: '', status: '' });
    expect(readRequestFilters({})).toEqual({ kind: '', status: '' });
  });

  it('builds the address back, leaving out what is All', () => {
    expect(myRequestsHref({ kind: '', status: '' })).toBe('/my-requests');
    expect(myRequestsHref({ kind: 'details', status: '' })).toBe('/my-requests?kind=details');
    expect(myRequestsHref({ kind: 'raise', status: 'open' })).toBe('/my-requests?kind=raise&status=open');
    expect(myRequestsHref({ kind: '', status: 'closed' })).toBe('/my-requests?status=closed');
  });

  it('lists the requests of a kind and a status, in the list’s order', () => {
    expect(filterRequests(list, { kind: '', status: '' }).map((r) => r.id)).toEqual(['c2', 't1', 'r1', 'c1']);
    expect(filterRequests(list, { kind: 'details', status: '' }).map((r) => r.id)).toEqual(['c2', 'c1']);
    expect(filterRequests(list, { kind: '', status: 'open' }).map((r) => r.id)).toEqual(['c2', 't1']);
    expect(filterRequests(list, { kind: 'raise', status: 'closed' }).map((r) => r.id)).toEqual(['r1']);
    expect(filterRequests(list, { kind: 'raise', status: 'open' })).toEqual([]);
  });

  it('counts what each chip would list: kinds within the status chosen, statuses within the kind chosen', () => {
    expect(requestCounts(list, { kind: '', status: '' })).toEqual({
      kinds: { '': 4, details: 2, raise: 1, team: 1 },
      states: { '': 4, open: 2, closed: 2 },
    });
    expect(requestCounts(list, { kind: 'details', status: 'open' })).toEqual({
      kinds: { '': 2, details: 1, raise: 0, team: 1 },
      states: { '': 2, open: 1, closed: 1 },
    });
  });
});

describe('a request’s heading', () => {
  const [details, team, own] = myRequests({
    changes: [change('c', '2026-10-15T08:00:00.000Z', 'pending')],
    raises: [raise('r', '2026-10-10T08:00:00.000Z', 'with_hr')],
    team: [raise('t', '2026-10-12T08:00:00.000Z', 'with_hr', { employee: report, requester: 'manager' })],
  });

  it('is in Title Case as a heading, and in sentence case in a list', () => {
    expect([details, own, team].map(requestTitle)).toEqual(['Change to Your Details', 'Raise Request', 'Raise Request for Omar Sayed']);
    expect([details, own, team].map(requestLabel)).toEqual(['Change to your details', 'Raise request', 'Raise request for Omar Sayed']);
  });
});
