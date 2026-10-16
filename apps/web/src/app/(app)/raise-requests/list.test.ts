import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import type { RaiseRequest } from '../../../lib/raise-types';
import type { RaiseRequestStep } from '../../../lib/raise-types';
import {
  commentReaders,
  commentText,
  figureText,
  reasonText,
  stepsLabel,
  stepText,
  stepTone,
  suggestionText,
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
  showsRaiseRequests,
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

describe('a profile’s Raise Requests', () => {
  const ok = (requests: RaiseRequest[], canRequest: boolean) => ({ kind: 'ok' as const, value: { requests, canRequest } });

  it('show with requests to see or one to ask for, and say so when they could not be loaded', () => {
    expect(showsRaiseRequests(ok([request()], false))).toBe(true);
    expect(showsRaiseRequests(ok([], true))).toBe(true);
    expect(showsRaiseRequests({ kind: 'failed' })).toBe(true);
  });

  it('show nothing with neither, to someone the API refuses, or from a server without them', () => {
    expect(showsRaiseRequests(ok([], false))).toBe(false);
    expect(showsRaiseRequests({ kind: 'forbidden' })).toBe(false);
    expect(showsRaiseRequests({ kind: 'unavailable' })).toBe(false);
  });
});

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
    expect(STATUS_FILTERS.map((f) => f.label)).toEqual(['All', 'With HR', 'With the CEO', 'Approved', 'Rejected', 'Done']);
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
    expect(progressText(request({ status: 'with_ceo', raise: prepared })).text).toBe('HR approved it and sent the raise to the CEO');
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
    ).toEqual({ text: 'Rejected by the CEO on 21/10/2026', reason: 'Not this year.' });
    expect(progressText(request({ status: 'declined', decision: { stage: 'hr', reason: 'Too soon.', at: null, by: null } }))).toEqual({
      text: 'Rejected by HR',
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
  it('decides a request with HR (or approves it in the whole raise form); carries on with a raise prepared from it, or rejects it', () => {
    expect(requestActions(as('hr'), request())).toEqual({ decide: true, prepare: true, continueRaise: false, decline: false });
    expect(requestActions(as('hr'), request({ raise: { ...prepared, stage: 'returned' } }))).toEqual({
      decide: false,
      prepare: false,
      continueRaise: true,
      decline: true,
    });
    expect(requestActions(as('hr'), request({ status: 'with_ceo', raise: prepared }))).toEqual({
      decide: false,
      prepare: false,
      continueRaise: false,
      decline: false,
    });
    // the CEO and Finance only follow them here
    expect(requestActions(as('ceo', 'finance'), request())).toEqual({ decide: false, prepare: false, continueRaise: false, decline: false });
  });

  it('links to the raise form with the request, and counts those with HR', () => {
    expect(prepareRaiseHref('e1', 'q1')).toBe('/employees/e1/contracts/raise?request=q1');
    expect(withHrCount([request(), request({ status: 'with_ceo' }), request()])).toBe(2);
  });
});

describe('the reason, the comment and the raise suggested', () => {
  it('the reason from the list, and the comment (a request from before 17 October 2026: its text)', () => {
    expect(reasonText({ raiseReason: 'counter_offer' })).toBe('Counter-offer raise');
    expect(reasonText({ raiseReason: null })).toBeNull();
    expect(reasonText({})).toBeNull();
    expect(commentText({ comment: 'Led the audit', reason: 'Led the audit' })).toBe('Led the audit');
    expect(commentText({ reason: 'A year of good reviews' })).toBe('A year of good reviews');
  });

  it('the figures as far as sent: the one typed first, the other in brackets, the gross it comes to', () => {
    expect(figureText({ figure: 'percent', increaseAmount: 1000, increasePercent: 10, gross: 11000 })).toBe('+10% (+EGP 1,000.00) → EGP 11,000.00');
    expect(figureText({ figure: 'amount', increaseAmount: 1500, increasePercent: 15, gross: 11500 })).toBe('+EGP 1,500.00 (+15%) → EGP 11,500.00');
    // worked out from the pay: the amount first
    expect(figureText({ figure: null, increaseAmount: 1000, increasePercent: 11.11, gross: 10000 })).toBe('+EGP 1,000.00 (+11.11%) → EGP 10,000.00');
    // the employee's own amount, the manager's own percent
    expect(figureText({ figure: 'amount', increaseAmount: 1500, increasePercent: null, gross: null })).toBe('+EGP 1,500.00');
    expect(figureText({ figure: 'percent', increaseAmount: null, increasePercent: 8, gross: null })).toBe('+8%');
    // the new salary once signed, or a gross typed before
    expect(figureText({ figure: null, increaseAmount: null, increasePercent: null, gross: 11200 })).toBe('Gross EGP 11,200.00');
    expect(figureText({ figure: null, increaseAmount: null, increasePercent: null, gross: null })).toBeNull();
    // a pay cut says so
    expect(figureText({ figure: null, increaseAmount: -500, increasePercent: -5, gross: 9500 })).toBe('−EGP 500.00 (−5%) → EGP 9,500.00');
  });

  it('the suggestion, as far as sent', () => {
    expect(suggestionText({ kind: 'amount', amount: 1500, percent: null, gross: 11500 })).toBe('+EGP 1,500.00 → EGP 11,500.00');
    expect(suggestionText({ kind: 'percent', amount: null, percent: 7.5, gross: null })).toBe('+7.5%');
    expect(suggestionText({ kind: 'gross', amount: null, percent: null, gross: 12000 })).toBe('Gross EGP 12,000.00');
    expect(suggestionText({ kind: 'gross', amount: null, percent: null, gross: null })).toBeNull();
    expect(suggestionText(null)).toBeNull();
    expect(suggestionText(undefined)).toBeNull();
  });
});

describe('the log', () => {
  const step = (over: Partial<RaiseRequestStep>): RaiseRequestStep => ({
    id: '1',
    kind: 'submitted',
    decision: null,
    raiseReason: null,
    comment: null,
    figure: null,
    increaseAmount: null,
    increasePercent: null,
    gross: null,
    way: null,
    effectiveDate: null,
    contractNumber: null,
    by: { email: 'hr@trendlix.com' },
    at: '2026-10-17T08:00:00.000Z',
    figuresHidden: false,
    ...over,
  });

  it('says each step as far as the caller is sent it', () => {
    expect(stepText(step({ raiseReason: 'performance', figure: 'amount', increaseAmount: 1500 }), 'self')).toEqual({
      title: 'Asked for by the employee',
      detail: 'Performance raise · Suggested +EGP 1,500.00',
    });
    expect(stepText(step({ raiseReason: 'annual' }), 'manager')).toEqual({ title: 'Asked for by their direct manager', detail: 'Annual raise' });
    expect(stepText(step({ kind: 'hr_decision', decision: 'approve', figure: 'percent', increaseAmount: 896, increasePercent: 8, gross: 12096 }), 'manager')).toEqual({
      title: 'HR approved it as suggested',
      detail: '+8% (+EGP 896.00) → EGP 12,096.00',
    });
    expect(stepText(step({ kind: 'hr_decision', decision: 'approve_other' }), 'self')).toEqual({ title: 'HR approved it with another raise', detail: null });
    expect(stepText(step({ kind: 'hr_decision', decision: 'reject', comment: 'Not now' }), 'hr').title).toBe('HR rejected it');
    expect(stepText(step({ kind: 'ceo_decision', decision: 'approve' }), 'self').title).toBe('The CEO approved it');
    expect(stepText(step({ kind: 'ceo_decision', decision: 'approve_other', figure: 'amount', increaseAmount: 1200, increasePercent: 12, gross: 11200 }), 'self')).toEqual({
      title: 'The CEO approved it with another raise',
      detail: '+EGP 1,200.00 (+12%) → EGP 11,200.00',
    });
    expect(stepText(step({ kind: 'ceo_decision', decision: 'reject' }), 'self').title).toBe('The CEO rejected it');
    expect(stepText(step({ kind: 'prepared', way: 'amendment', effectiveDate: '2026-11-01', contractNumber: 'CON-2026-0001-A1' }), 'self')).toEqual({
      title: 'HR prepared the raise',
      detail: 'CON-2026-0001-A1 · Amendment from 01/11/2026',
    });
    // the date, not yet the employee's to see
    expect(stepText(step({ kind: 'prepared', way: 'contract', contractNumber: 'CON-2026-0042' }), 'self').detail).toBe('CON-2026-0042 · New contract');
    expect(stepText(step({ kind: 'sent', gross: 11000 }), 'self')).toEqual({ title: 'Sent to the CEO', detail: 'Gross EGP 11,000.00' });
    expect(stepText(step({ kind: 'returned' }), 'self')).toEqual({ title: 'The CEO returned it to HR', detail: null });
    expect(stepText(step({ kind: 'signed', effectiveDate: '2026-11-01', gross: 11200 }), 'self')).toEqual({
      title: 'Signed: the request is done',
      detail: 'In force from 01/11/2026 · New gross EGP 11,200.00',
    });
    expect(stepText(step({ kind: 'signed' }), 'self').detail).toBeNull();
    expect(stepText(step({ kind: 'unsigned', contractNumber: 'CON-2026-0001-A1' }), 'self').title).toBe('Signing undone: the raise is to be signed again');
    expect(stepText(step({ kind: 'raise_deleted' }), 'self').title).toBe('The raise was deleted: the request is with HR again');
    expect(stepText(step({ kind: 'changed', gross: 11500 }), 'self')).toEqual({ title: 'HR changed the approved raise: it goes to the CEO again', detail: 'Gross EGP 11,500.00' });
  });

  it('marks the decisions, the signing and the setbacks', () => {
    expect(stepTone({ kind: 'hr_decision', decision: 'reject' })).toBe('danger');
    expect(stepTone({ kind: 'ceo_decision', decision: 'approve_other' })).toBe('ok');
    expect(stepTone({ kind: 'signed', decision: null })).toBe('ok');
    expect(stepTone({ kind: 'returned', decision: null })).toBe('warn');
    expect(stepTone({ kind: 'sent', decision: null })).toBeNull();
    expect(stepsLabel(1)).toBe('1 step');
    expect(stepsLabel(4)).toBe('4 steps');
  });
});

describe('who reads a comment', () => {
  it('says so under each box', () => {
    expect(commentReaders('request', 'self', true)).toBe('HR, Finance, the CEO and your direct manager see this comment.');
    expect(commentReaders('request', 'manager')).toMatch(/the employee doesn’t see a request you make/);
    expect(commentReaders('request', 'hr')).toMatch(/^Finance, the CEO and the employee’s direct manager see this comment/);
    expect(commentReaders('decision', 'self')).toBe('The employee and their manager see this comment.');
    expect(commentReaders('decision', 'manager')).toBe('The employee’s manager sees this comment; the employee doesn’t see this request.');
    expect(commentReaders('decision', null)).toBe('HR, Finance and the CEO see this comment, with the raise.');
    expect(commentReaders('return', 'self')).toMatch(/^HR sees this comment/);
    expect(commentReaders('send', 'self')).toMatch(/^The CEO sees this note/);
  });
});
