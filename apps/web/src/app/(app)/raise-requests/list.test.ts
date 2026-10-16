import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import type { RaiseRequest } from '../../../lib/raise-types';
import {
  canSeeRaiseRequests,
  handlesRaiseRequests,
  preparedRaiseText,
  prepareRaiseHref,
  progressText,
  raiseRequestsHref,
  REQUESTER_PHRASES,
  readStatus,
  requestActions,
  requesterText,
  requestsLabel,
  STATUS_BADGE,
  STATUS_FILTERS,
  withHrCount,
} from './list';

const as = (...roles: Role[]) => ({ roles });

/** A request as HR sees it, with what a test changes. */
function request(over: Partial<RaiseRequest> = {}): RaiseRequest {
  return {
    id: 'q1',
    employee: { id: 'e1', employeeCode: 'TL-0007', fullNameEn: 'Omar Khaled' },
    employmentId: 'm1',
    requester: 'manager',
    requestedBy: { email: 'sara@trendlix.com' },
    reason: 'Took over the design team.',
    status: 'with_hr',
    createdAt: '2026-10-16T09:00:00.000Z',
    updatedAt: '2026-10-16T09:00:00.000Z',
    suggestedGross: null,
    raise: null,
    decision: null,
    doneAt: null,
    amountsHidden: false,
    ...over,
  };
}

const prepared: NonNullable<RaiseRequest['raise']> = {
  contractId: 'c3',
  number: 'CON-2026-0001-A1',
  way: 'amendment',
  stage: 'pending_ceo',
  effectiveDate: '2026-11-01',
  previousGross: 10_000,
  newGross: 12_500,
  returnedReason: null,
  approvedAt: null,
};

describe('who sees raise requests', () => {
  it('is HR, the CEO and Finance for the page; HR alone handles them', () => {
    for (const role of ['hr', 'ceo', 'finance'] as const) expect(canSeeRaiseRequests(as(role))).toBe(true);
    expect(canSeeRaiseRequests(as('employee', 'manager', 'admin', 'super_admin'))).toBe(false);
    expect(handlesRaiseRequests(as('hr'))).toBe(true);
    expect(handlesRaiseRequests(as('ceo', 'finance'))).toBe(false);
  });
});

describe('the status filter', () => {
  it('offers All, then each status in order', () => {
    expect(STATUS_FILTERS.map((f) => f.label)).toEqual(['All', 'With HR', 'With the CEO', 'Approved', 'Declined', 'Done']);
    expect(STATUS_FILTERS.map((f) => f.value)).toEqual(['', 'with_hr', 'with_ceo', 'approved', 'declined', 'done']);
  });

  it('reads a known status from the address, else All', () => {
    expect(readStatus({ status: 'with_ceo' })).toBe('with_ceo');
    expect(readStatus({ status: 'pending' })).toBe('');
    expect(readStatus({ status: ['with_hr', 'done'] })).toBe('');
    expect(readStatus({})).toBe('');
  });

  it('links to a status, and counts', () => {
    expect(raiseRequestsHref('with_hr')).toBe('/raise-requests?status=with_hr');
    expect(raiseRequestsHref('')).toBe('/raise-requests');
    expect(requestsLabel(1)).toBe('1 request');
    expect(requestsLabel(3)).toBe('3 requests');
  });

  it('colours each status as the other approvals do', () => {
    expect(STATUS_BADGE).toEqual({
      with_hr: 'bg-warn-soft text-warn',
      with_ceo: 'bg-warn-soft text-warn',
      approved: '',
      declined: 'bg-danger-soft text-danger',
      done: 'bg-ok-soft text-ok',
    });
  });
});

describe('a request in words', () => {
  it('says who asked', () => {
    expect(requesterText(request())).toEqual({ who: 'The direct manager', email: 'sara@trendlix.com' });
    expect(requesterText(request({ requester: 'self', requestedBy: null }))).toEqual({ who: 'The employee', email: null });
    expect(requesterText(request({ requester: 'hr' })).who).toBe('HR');
    // inside a sentence ("Asked for by …"), HR keeps its capitals
    expect(REQUESTER_PHRASES).toEqual({ self: 'the employee', manager: 'their direct manager', hr: 'HR' });
  });

  it('shows the prepared raise as far as it was sent', () => {
    expect(preparedRaiseText(null)).toBeNull();
    expect(preparedRaiseText(prepared)).toEqual({
      title: 'CON-2026-0001-A1 · Amendment',
      detail: 'From 01/11/2026 · EGP 10,000.00 → EGP 12,500.00 · +EGP 2,500.00 (+25%)',
    });
    // the manager: no figure, no date before it is signed
    expect(preparedRaiseText({ ...prepared, way: 'contract', effectiveDate: null, previousGross: null, newGross: null })).toEqual({
      title: 'CON-2026-0001-A1 · New contract',
      detail: null,
    });
    // the employee once done: their new gross, not the one before
    expect(preparedRaiseText({ ...prepared, previousGross: null })?.detail).toBe('From 01/11/2026 · New gross EGP 12,500.00');
  });

  it('says where each request stands, with the reason given', () => {
    expect(progressText(request())).toEqual({ text: 'Waiting for HR', reason: null });
    expect(progressText(request({ raise: { ...prepared, stage: 'draft' } }))).toEqual({ text: 'HR is preparing the raise', reason: null });
    expect(progressText(request({ raise: { ...prepared, stage: 'returned', returnedReason: 'Wait for the review in December.' } }))).toEqual({
      text: 'Returned by the CEO to HR',
      reason: 'Wait for the review in December.',
    });
    expect(progressText(request({ status: 'with_ceo', raise: prepared })).text).toBe('HR prepared the raise and sent it to the CEO');
    expect(progressText(request({ status: 'approved', raise: { ...prepared, approvedAt: '2026-10-20T08:00:00.000Z' } })).text).toBe(
      'Approved by the CEO on 20/10/2026: the raise is to be signed',
    );
    expect(
      progressText(
        request({
          status: 'declined',
          decision: { stage: 'ceo', reason: 'Not this year.', at: '2026-10-21T08:00:00.000Z', by: { email: 'ceo@trendlix.com' } },
        }),
      ),
    ).toEqual({ text: 'Declined by the CEO on 21/10/2026', reason: 'Not this year.' });
    expect(progressText(request({ status: 'declined', decision: { stage: 'hr', reason: 'Too soon.', at: null, by: null } }))).toEqual({
      text: 'Declined by HR',
      reason: 'Too soon.',
    });
  });

  it('says a done request is signed, with the new gross only for those who are sent it', () => {
    const done = { status: 'done' as const, doneAt: '2026-11-02T08:00:00.000Z' };
    expect(progressText(request({ ...done, raise: { ...prepared, stage: 'signed' } })).text).toBe(
      'Done on 02/11/2026: the raise is signed, EGP 12,500.00 from 01/11/2026',
    );
    // the manager never sees a figure
    expect(progressText(request({ ...done, raise: { ...prepared, stage: 'signed', newGross: null, previousGross: null } })).text).toBe(
      'Done on 02/11/2026: the raise is signed',
    );
  });
});

describe("HR's actions", () => {
  it('prepares the raise from a request with HR, or carries on with the one prepared; declines it while with HR', () => {
    expect(requestActions(as('hr'), request())).toEqual({ prepare: true, continueRaise: false, decline: true });
    expect(requestActions(as('hr'), request({ raise: { ...prepared, stage: 'returned' } }))).toEqual({
      prepare: false,
      continueRaise: true,
      decline: true,
    });
    expect(requestActions(as('hr'), request({ status: 'with_ceo', raise: prepared }))).toEqual({
      prepare: false,
      continueRaise: false,
      decline: false,
    });
    // the CEO and Finance only follow them here
    expect(requestActions(as('ceo', 'finance'), request())).toEqual({ prepare: false, continueRaise: false, decline: false });
  });

  it('links to the raise form with the request, and counts those with HR', () => {
    expect(prepareRaiseHref('e1', 'q1')).toBe('/employees/e1/contracts/raise?request=q1');
    expect(withHrCount([request(), request({ status: 'with_ceo' }), request()])).toBe(2);
  });
});
