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
  decisionEffectiveDate,
  effectiveFromOptions,
  effectiveFromText,
  figuresNote,
  handlesRaiseRequests,
  isRequestForSelf,
  justSent,
  monthText,
  newRaiseRequestHref,
  pickerOptions,
  preselectedPerson,
  raiseRequestOnListHref,
  readEmployee,
  requestablePeople,
  requestBackHref,
  requestPlace,
  requestSentHref,
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
  apiRaiseRequestsPath,
  askedWord,
  ceoDecidesHere,
  ceoDoneMessage,
  inStatus,
  isDirect,
  noneWithStatusText,
  raiseRequestsDoneHref,
  reasonChangeText,
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
  it('offers All first, the open stages, then the history together and each of it (19 October 2026)', () => {
    expect(STATUS_FILTERS.map((f) => f.label)).toEqual(['All', 'With HR', 'With the CEO', 'History: approved, done or rejected', 'Approved', 'Done', 'Rejected']);
    expect(STATUS_FILTERS.map((f) => f.value)).toEqual(['', 'with_hr', 'with_ceo', 'history', 'approved', 'done', 'declined']);
  });

  it('reads a known status from the address, History too, else All', () => {
    expect(readStatus({ status: 'with_ceo' })).toBe('with_ceo');
    expect(readStatus({ status: 'history' })).toBe('history');
    expect(readStatus({ status: 'pending' })).toBe('');
    expect(readStatus({ status: ['with_hr', 'done'] })).toBe('');
    expect(readStatus({})).toBe('');
  });

  it('History: every request read, kept to those the CEO approved, done or rejected', () => {
    expect(raiseRequestsHref('history')).toBe('/raise-requests?status=history');
    expect(apiRaiseRequestsPath('history')).toBe('/raise-requests');
    expect(apiRaiseRequestsPath('done')).toBe('/raise-requests?status=done');
    expect(apiRaiseRequestsPath('')).toBe('/raise-requests');
    const statuses = ['with_hr', 'with_ceo', 'approved', 'declined', 'done'] as const;
    expect(statuses.filter((status) => inStatus({ status }, 'history'))).toEqual(['approved', 'declined', 'done']);
    // the API filtered the others already
    expect(statuses.every((status) => inStatus({ status }, 'with_hr'))).toBe(true);
    expect(noneWithStatusText('history')).toBe('No raise requests approved, done or rejected yet.');
    expect(noneWithStatusText('done')).toBe('No raise requests with this status.');
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

describe('a raise HR prepared directly (owner, 19 October 2026: every raise on Raise Requests)', () => {
  const direct = request({ origin: 'direct', requester: 'hr', requestedBy: { email: 'hr@trendlix.com' }, status: 'with_ceo', raise: prepared });

  it('says so where the requester is shown, and that it was prepared, not asked', () => {
    expect(isDirect(direct)).toBe(true);
    expect(isDirect(request())).toBe(false);
    // an API from before has asked ones only
    expect(isDirect(request({ origin: undefined }))).toBe(false);
    expect(requesterText(direct)).toEqual({ who: 'Prepared directly by HR', email: 'hr@trendlix.com' });
    expect(askedWord(direct)).toBe('prepared');
    expect(askedWord(request())).toBe('asked');
    expect(progressText(direct).text).toBe('HR sent the raise to the CEO');
  });

  it('is carried on with by HR, never rejected; the CEO decides it here while it is with them', () => {
    expect(requestActions(as('hr'), { ...direct, status: 'with_hr', raise: { ...prepared, stage: 'returned' } })).toEqual({
      decide: false,
      prepare: false,
      continueRaise: true,
      decline: false,
    });
    expect(ceoDecidesHere(as('ceo'), direct)).toBe(true);
    expect(ceoDecidesHere(as('ceo'), request({ status: 'with_ceo', raise: prepared }))).toBe(true);
    expect(ceoDecidesHere(as('hr', 'finance'), direct)).toBe(false);
    expect(ceoDecidesHere(as('ceo'), { ...direct, status: 'approved', raise: { ...prepared, stage: 'approved' } })).toBe(false);
    expect(ceoDecidesHere(as('ceo'), request({ status: 'with_ceo', raise: null }))).toBe(false);
  });

  it('a renewal with new pay says so; from its start, a day that may not be a 1st', () => {
    expect(preparedRaiseText({ ...prepared, way: 'contract', change: 'renewal' })?.title).toBe('CON-2026-0001-A1 · Renewal');
    expect(preparedRaiseText({ ...prepared, change: 'amendment' })?.title).toBe('CON-2026-0001-A1 · Amendment');
    expect(effectiveFromText(request({ effectiveFrom: '2027-01-15' }))).toBe('15/01/2027');
  });

  it('back to the page once the CEO decides, saying what was done', () => {
    expect(raiseRequestsDoneHref('with_ceo', 'raise-approved')).toBe('/raise-requests?status=with_ceo&done=raise-approved');
    expect(raiseRequestsDoneHref('', 'raise-returned')).toBe('/raise-requests?done=raise-returned');
    expect(ceoDoneMessage({ done: 'raise-approved-other' })).toMatch(/^Raise approved with your raise/);
    expect(ceoDoneMessage({ done: 'raise-declined' })).toBe('Raise rejected: its request shows as rejected, with your comment.');
    expect(ceoDoneMessage({ done: 'toString' })).toBeNull();
    expect(ceoDoneMessage({})).toBeNull();
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
    // the month asked from (17 October 2026), for everyone who sees the request
    expect(stepText(step({ raiseReason: 'annual', effectiveDate: '2026-11-01', figure: 'percent', increasePercent: 8 }), 'manager')).toEqual({
      title: 'Asked for by their direct manager',
      detail: 'Annual raise · Effective from November 2026 · Suggested +8%',
    });
    expect(stepText(step({ kind: 'hr_decision', decision: 'approve', figure: 'percent', increaseAmount: 896, increasePercent: 8, gross: 12096 }), 'manager')).toEqual({
      title: 'HR approved it as suggested',
      detail: '+8% (+EGP 896.00) → EGP 12,096.00',
    });
    expect(stepText(step({ kind: 'hr_decision', decision: 'approve_other' }), 'self')).toEqual({ title: 'HR approved it with another raise', detail: null });
    // the date HR chose, once the caller is sent it
    expect(stepText(step({ kind: 'hr_decision', decision: 'approve', figure: 'percent', increaseAmount: 896, increasePercent: 8, gross: 12096, effectiveDate: '2026-12-01' }), 'hr')).toEqual({
      title: 'HR approved it as suggested',
      detail: '+8% (+EGP 896.00) → EGP 12,096.00 · Effective from December 2026',
    });
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

  it('a raise HR prepared directly: its prepared step says so, with the reason and the raise; a renewal as such (19 October 2026)', () => {
    const made = step({ kind: 'prepared', raiseReason: 'annual', way: 'amendment', effectiveDate: '2026-11-01', contractNumber: 'CON-2026-0001-A1', increaseAmount: 2500, increasePercent: 25, gross: 12500 });
    const direct = { origin: 'direct' as const, raise: { ...prepared, change: 'amendment' as const } };
    expect(stepText(made, 'hr', direct)).toEqual({
      title: 'Prepared directly by HR',
      detail: 'Annual raise · CON-2026-0001-A1 · Amendment from 01/11/2026 · +EGP 2,500.00 (+25%) → EGP 12,500.00',
    });
    const renewal = { origin: 'direct' as const, raise: { ...prepared, way: 'contract' as const, change: 'renewal' as const } };
    expect(stepText({ ...made, way: 'contract', effectiveDate: '2027-01-15' }, 'hr', renewal).detail).toMatch(/· Renewal from 15\/01\/2027 ·/);
    // one prepared from an asked request stays as it was
    expect(stepText(made, 'hr', { origin: 'request', raise: prepared }).title).toBe('HR prepared the raise');
  });

  it('the CEO’s other reason on their decision (19 October 2026: "i might want to ammend the raise reason")', () => {
    expect(reasonChangeText({ raiseReason: 'annual', raiseReasonFrom: 'performance' })).toBe('Reason changed from Performance raise to Annual raise');
    expect(reasonChangeText({ raiseReason: null, raiseReasonFrom: null })).toBeNull();
    expect(reasonChangeText({ raiseReason: 'annual' })).toBeNull();
    expect(stepText(step({ kind: 'ceo_decision', decision: 'approve', raiseReason: 'annual', raiseReasonFrom: 'performance' }), 'manager')).toEqual({
      title: 'The CEO approved it',
      detail: 'Reason changed from Performance raise to Annual raise',
    });
    expect(
      stepText(step({ kind: 'ceo_decision', decision: 'approve_other', figure: 'percent', increaseAmount: 900, increasePercent: 10, gross: 9900, raiseReason: 'counter_offer', raiseReasonFrom: 'performance' }), 'hr').detail,
    ).toBe('+10% (+EGP 900.00) → EGP 9,900.00 · Reason changed from Performance raise to Counter-offer raise');
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

describe('asking for a raise under Requests (owner, 17 October 2026: "Under Requests")', () => {
  /** Someone GET /employees lists: currently employed (with their direct manager) unless `employment` is null. */
  const person = (id: string, name: string, manager: string | null, employed = true, workEmail: string | null = null) => ({
    id,
    fullNameEn: name,
    employeeCode: `EMP-${id}`,
    workEmail,
    employment: employed ? { manager: manager ? { id: manager } : null } : null,
  });
  const people = [
    person('mona', 'Mona Manager', null, true, 'mona@trendlix.com'),
    person('ben', 'Ben Asking', 'mona', true, 'ben@trendlix.com'),
    person('dana', 'Dana Decided', 'mona'),
    person('omar', 'Omar Left', 'mona', false),
    person('sam', 'Sam Other', 'sara'),
  ];
  const hr = { roles: ['hr'] as Role[], email: 'hr@trendlix.com', employeeId: null };
  const mona = { roles: ['manager', 'employee'] as Role[], email: 'mona@trendlix.com', employeeId: 'mona' };
  const ben = { roles: ['employee'] as Role[], email: 'ben@trendlix.com', employeeId: 'ben' };
  const ids = (list: { id: string }[]) => list.map((p) => p.id);

  it('offers HR everyone employed now; a manager themself and their direct reports; an employee themself', () => {
    expect(ids(requestablePeople(hr, people))).toEqual(['mona', 'ben', 'dana', 'sam']);
    expect(ids(requestablePeople(mona, people))).toEqual(['mona', 'ben', 'dana']);
    expect(ids(requestablePeople(ben, people))).toEqual(['ben']);
    // the CEO and Finance, who see everyone, ask for themselves (and their own direct reports)
    expect(ids(requestablePeople({ roles: ['ceo'], email: 'ceo@trendlix.com', employeeId: 'sara' }, [...people, person('sara', 'Sara Chief', null)]))).toEqual(['sam', 'sara']);
    // no profile of their own: no one (HR aside)
    expect(requestablePeople({ roles: ['finance'], email: 'x@trendlix.com', employeeId: null }, people)).toEqual([]);
    // an API that doesn't name the profile: found by the work email
    expect(ids(requestablePeople({ roles: ['manager'], email: 'Mona@Trendlix.com' }, people))).toEqual(['mona', 'ben', 'dana']);
    expect(isRequestForSelf(ben, people[1])).toBe(true);
    expect(isRequestForSelf(mona, people[1])).toBe(false);
  });

  it('lists them by name, the user marked; preselects the one asked for when allowed, else the only one', () => {
    expect(pickerOptions(mona, requestablePeople(mona, people))).toEqual([
      { id: 'ben', label: 'Ben Asking · EMP-ben' },
      { id: 'dana', label: 'Dana Decided · EMP-dana' },
      { id: 'mona', label: 'Mona Manager · EMP-mona (you)' },
    ]);
    const team = requestablePeople(mona, people);
    expect(preselectedPerson(team, 'dana')).toBe('dana');
    expect(preselectedPerson(team, 'sam')).toBeNull(); // not hers to ask for
    expect(preselectedPerson(team, null)).toBeNull();
    expect(preselectedPerson(requestablePeople(ben, people), null)).toBe('ben');
    expect(preselectedPerson(requestablePeople(ben, people), 'dana')).toBe('ben');
    expect(readEmployee({ employee: 'dana' })).toBe('dana');
    expect(readEmployee({ employee: ['a', 'b'] })).toBeNull();
    expect(readEmployee({})).toBeNull();
  });

  it('links to the form, and back to where each requester follows their requests', () => {
    expect(newRaiseRequestHref()).toBe('/raise-requests/new');
    expect(newRaiseRequestHref('e 1')).toBe('/raise-requests/new?employee=e%201');
    expect(requestBackHref(hr, false)).toBe('/raise-requests');
    expect(requestBackHref({ roles: ['ceo'] }, true)).toBe('/raise-requests');
    expect(requestBackHref(ben, true)).toBe('/my-requests');
    expect(requestBackHref(mona, false)).toBe('/my-team');
    // once sent: listed first, and said so
    expect(requestSentHref(hr, false)).toBe('/raise-requests?sent=1');
    expect(requestSentHref(ben, true)).toBe('/my-requests?kind=raise&sent=1');
    expect(requestSentHref(mona, false)).toBe('/my-requests?kind=team&sent=1');
    expect(justSent({ sent: '1' })).toBe(true);
    expect(justSent({ status: 'with_hr' })).toBe(false);
  });

  it('opens a request listed on a profile in its place under Requests, or nowhere else for a manager told of it', () => {
    const q = request({ id: 'q1', status: 'with_hr', requester: 'manager', requestedBy: { email: 'mona@trendlix.com' } });
    expect(raiseRequestOnListHref(q)).toBe('/raise-requests?status=with_hr#raise-request-q1');
    expect(requestPlace(hr, q, false)).toEqual({ href: '/raise-requests?status=with_hr#raise-request-q1', label: 'Open in Raise Requests' });
    expect(requestPlace(mona, q, false)).toEqual({ href: '/my-requests?kind=team#raise-request-q1', label: 'Open in My Requests' });
    expect(requestPlace(ben, request({ requester: 'self', requestedBy: { email: 'ben@trendlix.com' } }), true)).toEqual({
      href: '/my-requests?kind=raise#raise-request-q1',
      label: 'Open in My Requests',
    });
    // the employee's own, or HR's, read by their manager: the profile is its place
    expect(requestPlace(mona, request({ requester: 'self', requestedBy: { email: 'ben@trendlix.com' } }), false)).toBeNull();
    expect(requestPlace(mona, request({ requester: 'hr', requestedBy: { email: 'hr@trendlix.com' } }), false)).toBeNull();
  });

  it('says who sees the figures while asking', () => {
    expect(figuresNote(true)).toMatch(/^Your own pay, which only you, HR, Finance and the CEO see: your direct manager doesn’t/);
    expect(figuresNote(false)).toMatch(/^HR, Finance and the CEO see these figures; a direct manager sees no salary figures/);
    expect(figuresNote(false)).toMatch(/The net is approximate\.$/);
  });
});

describe('Effective from (owner, 17 October 2026: "in the request their should be a tab called Effective from")', () => {
  it('says the month a request is asked from, or Not given on one from before', () => {
    expect(monthText('2026-11-01')).toBe('November 2026');
    expect(effectiveFromText(request({ effectiveFrom: '2027-01-01' }))).toBe('January 2027');
    expect(effectiveFromText(request({ effectiveFrom: null }))).toBe('Not given');
    expect(effectiveFromText(request())).toBe('Not given');
  });

  it('offers this month and the next eleven, by name', () => {
    const options = effectiveFromOptions('2026-10-17');
    expect(options).toHaveLength(12);
    expect(options[0]).toEqual({ value: '2026-10-01', label: 'October 2026' });
    expect(options[1]).toEqual({ value: '2026-11-01', label: 'November 2026' });
    expect(options[3]).toEqual({ value: '2027-01-01', label: 'January 2027' });
    expect(options.at(-1)).toEqual({ value: '2027-09-01', label: 'September 2027' });
  });

  it('starts HR’s decision from it; on one from before, the next 1st after today and the contract’s start', () => {
    const inForce = { number: 'CON-2026-0001', startDate: '2026-11-01', endDate: null, payBasis: 'monthly' as const, grossSalary: 10_000 };
    expect(decisionEffectiveDate(request({ effectiveFrom: '2027-01-01', inForce }), '2026-10-17')).toBe('2027-01-01');
    expect(decisionEffectiveDate(request({ effectiveFrom: null, inForce }), '2026-10-17')).toBe('2026-12-01');
    expect(decisionEffectiveDate(request({ effectiveFrom: null, inForce: null }), '2026-10-17')).toBe('2026-11-01');
  });
});

describe('who reads a comment', () => {
  it('says so under each box', () => {
    expect(commentReaders('request', 'self', true)).toBe(
      'HR, Finance, the CEO and your direct manager see this comment; the figures of the raise you suggest, only you, HR, Finance and the CEO.',
    );
    expect(commentReaders('request', 'manager')).toMatch(/the employee doesn’t see a request you make/);
    expect(commentReaders('request', 'hr')).toMatch(/^Finance, the CEO and the employee’s direct manager see this comment, the manager no figures/);
    expect(commentReaders('decision', 'self')).toBe('The employee and their manager see this comment.');
    expect(commentReaders('decision', 'manager')).toBe('The employee’s manager sees this comment; the employee doesn’t see this request.');
    expect(commentReaders('decision', null)).toBe('HR, Finance and the CEO see this comment, with the raise.');
    expect(commentReaders('return', 'self')).toMatch(/^HR sees this comment/);
    expect(commentReaders('send', 'self')).toMatch(/^The CEO sees this note/);
  });
});
