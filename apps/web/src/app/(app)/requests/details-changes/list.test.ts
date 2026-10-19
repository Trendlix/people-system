import { describe, expect, it } from 'vitest';
import { DETAILS_CHANGES_PATH } from '../../../../components/nav';
import { formatDateTime } from '../../../../lib/format';
import type { ChangeRequest } from '../../../../lib/types';
import {
  changeDeciders,
  changeRequestsPath,
  changeStatusLabel,
  decisionView,
  detailsChangesHref,
  emptyText,
  fromLabel,
  readDone,
  readsChangeRequests,
  readStatus,
  requestsLabel,
  STATUS_FILTERS,
  waitingForYou,
} from './list';

const AT = '2026-10-16T14:42:00.000Z';
const decided = (over: Partial<ChangeRequest>): Pick<ChangeRequest, 'status' | 'decidedBy' | 'decidedAt' | 'decisionNote'> => ({
  status: 'approved',
  decidedBy: { email: 'hr@trendlix.com' },
  decidedAt: AT,
  decisionNote: null,
  ...over,
});

describe('the status filter of Details Changes', () => {
  it('is All, then the change requests’ own statuses in order', () => {
    expect(STATUS_FILTERS.map((o) => [o.value, o.label])).toEqual([
      ['', 'All'],
      ['pending', 'Waiting for HR'],
      ['approved', 'Approved'],
      ['rejected', 'Rejected'],
      ['cancelled', 'Cancelled'],
    ]);
  });

  it('reads the status from the address, anything else as All', () => {
    expect(readStatus({ status: 'pending' })).toBe('pending');
    expect(readStatus({ status: 'rejected' })).toBe('rejected');
    expect(readStatus({ status: 'cancelled' })).toBe('cancelled');
    expect(readStatus({})).toBe('');
    expect(readStatus({ status: 'all' })).toBe('');
    expect(readStatus({ status: 'with_hr' })).toBe('');
    expect(readStatus({ status: ['pending', 'approved'] })).toBe('');
  });

  it('keeps the status in the page’s address, and what was done after a decision', () => {
    expect(DETAILS_CHANGES_PATH).toBe('/requests/details-changes');
    expect(detailsChangesHref('')).toBe('/requests/details-changes');
    expect(detailsChangesHref('pending')).toBe('/requests/details-changes?status=pending');
    expect(detailsChangesHref('pending', 'change-approved')).toBe('/requests/details-changes?status=pending&done=change-approved');
    expect(detailsChangesHref('', 'change-rejected')).toBe('/requests/details-changes?done=change-rejected');
  });

  it('asks the API for every status on All, as it lists the waiting ones without one', () => {
    expect(changeRequestsPath('')).toBe('/change-requests?status=all');
    expect(changeRequestsPath('pending')).toBe('/change-requests?status=pending');
    expect(changeRequestsPath('approved')).toBe('/change-requests?status=approved');
  });

  it('says what was done after a decision, and nothing for anything else', () => {
    expect(readDone({ done: 'change-approved' })).toBe('Change request approved: the profile is updated.');
    expect(readDone({ done: 'change-rejected' })).toBe('Change request rejected. The employee sees your note.');
    expect(readDone({ done: 'approved' })).toBeNull();
    expect(readDone({ done: 'toString' })).toBeNull();
    expect(readDone({})).toBeNull();
  });
});

describe('a change request on Details Changes', () => {
  it('has no decision while it waits: it is decided there', () => {
    expect(decisionView(decided({ status: 'pending', decidedBy: null, decidedAt: null }))).toBeNull();
  });

  it('says who approved it and when, with the note if any', () => {
    expect(decisionView(decided({}))).toEqual({ title: 'Approved by hr@trendlix.com', at: formatDateTime(AT), noteLabel: 'Note', note: null });
    expect(decisionView(decided({ decisionNote: 'Checked against the passport.' }))?.note).toBe('Checked against the passport.');
    expect(decisionView(decided({ decisionNote: '   ' }))?.note).toBeNull();
  });

  it('says who rejected it, when and why', () => {
    expect(decisionView(decided({ status: 'rejected', decidedBy: { email: 'admin@trendlix.com' }, decisionNote: 'Send a copy first.' }))).toEqual({
      title: 'Rejected by admin@trendlix.com',
      at: formatDateTime(AT),
      noteLabel: 'Why it was rejected',
      note: 'Send a copy first.',
    });
  });

  it('says the employee cancelled it, not by their email', () => {
    expect(decisionView(decided({ status: 'cancelled', decidedBy: { email: 'nour@trendlix.com' } }))).toEqual({
      title: 'Cancelled by the employee',
      at: formatDateTime(AT),
      noteLabel: 'Note',
      note: null,
    });
  });

  it('leaves out who and when when the API doesn’t send them', () => {
    expect(decisionView(decided({ decidedBy: null, decidedAt: null }))).toMatchObject({ title: 'Approved', at: null });
  });

  it('heads what the fields were as the profile now has them while it waits, and as they were when asked once decided', () => {
    expect(fromLabel('pending')).toBe('Current');
    expect(fromLabel('approved')).toBe('When asked');
    expect(fromLabel('rejected')).toBe('When asked');
    expect(fromLabel('cancelled')).toBe('When asked');
  });

  it('counts and says when there are none', () => {
    expect(requestsLabel(1)).toBe('1 request');
    expect(requestsLabel(12)).toBe('12 requests');
    expect(emptyText('')).toBe('No change requests yet. Employees ask for them when they check their details on their profile.');
    expect(emptyText('pending')).toBe('No change requests are waiting.');
    expect(emptyText('approved')).toBe('No approved change requests.');
    expect(emptyText('rejected')).toBe('No rejected change requests.');
    expect(emptyText('cancelled')).toBe('No cancelled change requests.');
  });
});

describe('a C-level person’s change request (owner, 19 October 2026: "make C level Employees details not visible to HR")', () => {
  const waiting = (id: string, confidential?: boolean) => ({ id, status: 'pending' as const, confidential });

  it('is read by HR, Admin and the CEO, who decides a C-level person’s', () => {
    expect(readsChangeRequests({ roles: ['hr'] })).toBe(true);
    expect(readsChangeRequests({ roles: ['admin'] })).toBe(true);
    expect(readsChangeRequests({ roles: ['super_admin'] })).toBe(true);
    expect(readsChangeRequests({ roles: ['ceo'] })).toBe(true);
    expect(readsChangeRequests({ roles: ['finance'] })).toBe(false);
    expect(readsChangeRequests({ roles: ['employee', 'manager'] })).toBe(false);
  });

  it('waits for the CEO or a Super Admin, not HR: each counts for who decides it', () => {
    const list = [waiting('a'), waiting('b', true), { id: 'c', status: 'approved' as const, confidential: true }];
    expect(waitingForYou({ roles: ['hr'] }, list).map((r) => r.id)).toEqual(['a']);
    expect(waitingForYou({ roles: ['ceo'] }, list).map((r) => r.id)).toEqual(['b']);
    expect(waitingForYou({ roles: ['super_admin'] }, list).map((r) => r.id)).toEqual(['a', 'b']);
    expect(waitingForYou({ roles: ['admin'] }, list).map((r) => r.id)).toEqual(['a']);
    expect(changeStatusLabel('pending', true)).toBe('Waiting for the CEO');
    expect(changeStatusLabel('pending')).toBe('Waiting for HR');
    expect(changeStatusLabel('approved', true)).toBe('Approved');
    expect(changeDeciders(true)).toBe('the CEO or a Super Admin');
    expect(changeDeciders(false)).toBe('HR or an Admin');
  });
});
