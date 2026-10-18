import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import type { ReimbursementClaimStep, ReimbursementClaimView } from '../../../lib/types';
import {
  canSeeReimbursements,
  CLAIM_FILTERS,
  claimantCount,
  claimBack,
  claimDoneHref,
  claimHref,
  claimsLabel,
  claimsPath,
  currentAmount,
  decidedText,
  decisionBody,
  decisionButton,
  defaultFilter,
  doneText,
  emptyText,
  lowerApproved,
  MOVED_ON,
  newClaimBack,
  payMonthOf,
  placeOfClaim,
  progressText,
  readFilter,
  receiptHref,
  reimbursementsHref,
  stepsLabel,
  stepText,
  stepTone,
  WAITING_CLAIMS,
} from './list';

const as = (...roles: Role[]) => ({ roles });
const ID = '0b8f2c1e-1111-4222-8333-444455556666';

const claim = (over: Partial<ReimbursementClaimView> = {}): ReimbursementClaimView => ({
  id: ID,
  employee: { id: 'emp-1', fullNameEn: 'Nour Adel', fullNameAr: null, department: 'Marketing', team: 'Content Team' },
  type: { id: 'type-1', nameEn: 'Transport', nameAr: 'مواصلات', receiptRequired: true },
  expenseDate: '2026-10-12',
  amount: 250,
  approvedAmount: null,
  description: 'Taxi to the client',
  status: 'with_manager',
  stage: 'manager',
  waitingForYou: false,
  canCancel: false,
  manager: { id: 'emp-2', fullNameEn: 'Omar Khaled' },
  rejectedStage: null,
  rejectReason: null,
  payMonth: null,
  payroll: null,
  receipts: [],
  steps: [],
  createdAt: '2026-10-18T09:00:00.000Z',
  ...over,
});

const step = (over: Partial<ReimbursementClaimStep>): ReimbursementClaimStep => ({
  id: '1',
  kind: 'submitted',
  decision: null,
  amount: null,
  comment: null,
  payMonth: null,
  actor: 'Nour Adel',
  at: '2026-10-18T09:00:00.000Z',
  ...over,
});

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe('who sees the claims', () => {
  it('is HR, Finance and the CEO, not an Admin, a manager or an employee as such', () => {
    for (const role of ['hr', 'finance', 'ceo'] as const) expect(canSeeReimbursements(as(role))).toBe(true);
    for (const role of ['admin', 'super_admin', 'manager', 'employee'] as const) expect(canSeeReimbursements(as(role))).toBe(false);
  });

  it('goes back to Reimbursements for them, to My Requests for the employee’s own and to My Team for their manager', () => {
    expect(claimBack({ roles: ['hr'], employeeId: 'emp-1' }, claim())).toEqual({ href: '/reimbursements', label: 'Reimbursements' });
    expect(claimBack({ roles: ['employee'], employeeId: 'emp-1' }, claim())).toEqual({ href: '/my-requests', label: 'My Requests' });
    expect(claimBack({ roles: ['employee', 'manager'], employeeId: 'emp-2' }, claim())).toEqual({ href: '/my-team', label: 'My Team' });
    expect(newClaimBack(as('finance'))).toEqual({ href: '/reimbursements', label: 'Reimbursements' });
    expect(newClaimBack(as('employee'))).toEqual({ href: '/my-requests', label: 'My Requests' });
  });

  it('keeps each claim and receipt under the web domain', () => {
    expect(claimHref(ID)).toBe(`/reimbursements/${ID}`);
    expect(receiptHref(ID, 'r1')).toBe(`/reimbursements/${ID}/receipts/r1`);
    expect(claimDoneHref(ID, 'sent')).toBe(`/reimbursements/${ID}?done=sent`);
    expect(claimDoneHref(ID, 'hr_approve_other')).toBe(`/reimbursements/${ID}?done=hr_approve_other`);
  });
});

describe('the status filter', () => {
  it('is Waiting for you, All, then each status in order', () => {
    expect(CLAIM_FILTERS.map((f) => [f.value, f.label])).toEqual([
      ['waiting', 'Waiting for you'],
      ['all', 'All'],
      ['with_manager', 'With the manager'],
      ['with_hr', 'With HR'],
      ['with_finance', 'With Finance'],
      ['approved', 'Approved'],
      ['rejected', 'Rejected'],
      ['cancelled', 'Cancelled'],
    ]);
  });

  it('starts at Waiting for you for HR and Finance, who decide, and at All for the CEO, who views', () => {
    expect(defaultFilter(as('hr'))).toBe('waiting');
    expect(defaultFilter(as('finance'))).toBe('waiting');
    expect(defaultFilter(as('ceo'))).toBe('all');
    expect(defaultFilter(as('ceo', 'finance'))).toBe('waiting');
    expect(readFilter({}, as('hr'))).toBe('waiting');
    expect(readFilter({}, as('ceo'))).toBe('all');
    expect(readFilter({ status: 'all' }, as('hr'))).toBe('all');
    expect(readFilter({ status: 'with_finance' }, as('ceo'))).toBe('with_finance');
    expect(readFilter({ status: 'pending' }, as('ceo'))).toBe('all');
    expect(readFilter({ status: ['approved', 'rejected'] }, as('hr'))).toBe('waiting');
  });

  it('names the status in the page’s address, and asks the API for it (All without one)', () => {
    expect(reimbursementsHref('all')).toBe('/reimbursements?status=all');
    expect(reimbursementsHref('waiting')).toBe('/reimbursements?status=waiting');
    expect(claimsPath('all')).toBe('/reimbursements');
    expect(claimsPath('with_hr')).toBe('/reimbursements?status=with_hr');
    expect(claimsPath('all', 'emp-1')).toBe('/reimbursements?employeeId=emp-1');
    expect(WAITING_CLAIMS).toBe('/reimbursements?status=waiting');
  });

  it('says what is empty, by the filter', () => {
    expect(emptyText('waiting')).toBe('No claims are waiting for you.');
    expect(emptyText('all')).toMatch(/^No reimbursement claims yet/);
    expect(emptyText('rejected')).toBe('No claims rejected.');
    expect(emptyText('with_hr')).toBe('No claims are with HR.');
    expect(emptyText('with_manager')).toBe('No claims are with a direct manager.');
  });
});

describe('a claim, in words', () => {
  it('counts claims and the people who made them', () => {
    expect(claimsLabel(1)).toBe('1 claim');
    expect(claimsLabel(3)).toBe('3 claims');
    expect(claimantCount([claim(), claim({ id: 'b' }), claim({ id: 'c', employee: { ...claim().employee, id: 'emp-9' } })])).toBe(2);
    expect(stepsLabel(1)).toBe('1 step');
  });

  it('groups by where the claimant works: the team under its department', () => {
    expect(placeOfClaim({ department: 'Marketing', team: 'Content Team' })).toBe('Marketing › Content Team');
    expect(placeOfClaim({ department: 'Marketing', team: null })).toBe('Marketing');
    expect(placeOfClaim({ department: 'Marketing › Content Team', team: 'Content Team' })).toBe('Marketing › Content Team');
    expect(placeOfClaim({ department: null })).toBeNull();
    expect(placeOfClaim({ department: ' ', team: undefined })).toBeNull();
  });

  it('says who has it now, or how it ended', () => {
    expect(progressText(claim()).text).toBe('Waiting for the direct manager, Omar Khaled');
    expect(progressText(claim({ manager: null })).text).toBe('Waiting for the direct manager');
    expect(progressText(claim({ status: 'with_hr' })).text).toBe('Waiting for HR');
    expect(progressText(claim({ status: 'with_finance' })).text).toBe('Waiting for Finance');
    expect(progressText(claim({ status: 'rejected', rejectedStage: 'hr', rejectReason: ' Not a work trip ' }))).toEqual({ text: 'Rejected by HR', reason: 'Not a work trip' });
    expect(progressText(claim({ status: 'rejected', rejectedStage: 'manager' })).text).toBe('Rejected by the direct manager');
    expect(progressText(claim({ status: 'cancelled' })).text).toBe('Cancelled by the employee');
  });

  it('says the payroll an approved claim is paid with', () => {
    expect(progressText(claim({ status: 'approved' })).text).toBe('Approved');
    expect(progressText(claim({ status: 'approved', payMonth: '2026-11-01', payroll: { status: 'pending', runMonth: '2026-11-01' } })).text).toBe(
      'Approved: to be paid with the November 2026 payroll',
    );
    expect(progressText(claim({ status: 'approved', payMonth: '2026-11-01', payroll: { status: 'applied', runMonth: '2026-11-01' } })).text).toBe(
      'Approved: paid with the November 2026 payroll',
    );
    expect(progressText(claim({ status: 'approved', payMonth: '2026-11-01', payroll: { status: 'cancelled', runMonth: '2026-12' } })).text).toBe(
      'Approved: its addition to the December 2026 payroll was cancelled',
    );
    expect(payMonthOf(claim({ payMonth: '2026-11-01' }))).toBe('November 2026');
    expect(payMonthOf(claim())).toBeNull();
  });

  it('tells a lower amount approved from the amount claimed', () => {
    expect(lowerApproved(claim({ approvedAmount: 200 }))).toBe(200);
    expect(lowerApproved(claim({ approvedAmount: 250 }))).toBeNull();
    expect(lowerApproved(claim())).toBeNull();
    expect(currentAmount(claim())).toBe(250);
    expect(currentAmount(claim({ approvedAmount: 200 }))).toBe(200);
  });
});

describe('the timeline of a claim', () => {
  it('words each step, with its amount and the payroll it was added to', () => {
    expect(stepText(step({ amount: 250 }))).toEqual({ title: 'Claimed by the employee', detail: 'EGP 250.00' });
    expect(stepText(step({ kind: 'no_manager' }))).toEqual({ title: 'No direct manager: sent straight to HR', detail: null });
    expect(stepText(step({ kind: 'manager_decision', decision: 'approve', amount: 250 }))).toEqual({ title: 'The direct manager approved it', detail: 'EGP 250.00' });
    expect(stepText(step({ kind: 'hr_decision', decision: 'approve_other', amount: 200 }))).toEqual({ title: 'HR approved a lower amount', detail: 'EGP 200.00' });
    expect(stepText(step({ kind: 'finance_decision', decision: 'reject' }))).toEqual({ title: 'Finance rejected it', detail: null });
    expect(stepText(step({ kind: 'cancelled' }))).toEqual({ title: 'Cancelled by the employee', detail: null });
    expect(stepText(step({ kind: 'added_to_payroll', payMonth: '2026-11-01', amount: 200 }))).toEqual({ title: 'Added to the November 2026 payroll', detail: 'EGP 200.00, untaxed' });
  });

  it('marks the decisions: approved, a lower amount, rejected', () => {
    expect(stepTone(step({ kind: 'hr_decision', decision: 'approve' }))).toBe('ok');
    expect(stepTone(step({ kind: 'hr_decision', decision: 'approve_other' }))).toBe('warn');
    expect(stepTone(step({ kind: 'finance_decision', decision: 'reject' }))).toBe('danger');
    expect(stepTone(step({ kind: 'added_to_payroll' }))).toBe('ok');
    expect(stepTone(step({}))).toBeNull();
  });
});

describe('deciding a claim', () => {
  it('approves with an optional comment', () => {
    expect(decisionBody(form({ decision: 'approve' }), 250)).toEqual({ body: { decision: 'approve' }, errors: [] });
    expect(decisionBody(form({ decision: 'approve', comment: ' Fine ' }), 250)).toEqual({ body: { decision: 'approve', comment: 'Fine' }, errors: [] });
  });

  it('approves a lower amount, less than the current one, with a comment', () => {
    expect(decisionBody(form({ decision: 'approve_other', amount: '200', comment: 'Cap' }), 250)).toEqual({
      body: { decision: 'approve_other', amount: 200, comment: 'Cap' },
      errors: [],
    });
    expect(decisionBody(form({ decision: 'approve_other', amount: '٢٠٠٫٥', comment: 'Cap' }), 250).body?.amount).toBe(200.5);
    expect(decisionBody(form({ decision: 'approve_other', amount: '250', comment: 'Cap' }), 250).errors).toEqual([
      'The amount approved must be less than 250.00. To approve the whole amount, choose Approve.',
    ]);
    expect(decisionBody(form({ decision: 'approve_other', amount: '', comment: '' }), 250).errors).toEqual([
      'Enter the amount approved, more than 0, e.g. 250 or 250.50.',
      'Write your comment: why a lower amount is approved.',
    ]);
  });

  it('rejects only with a comment, and needs a decision', () => {
    expect(decisionBody(form({ decision: 'reject' }), 250)).toEqual({ body: null, errors: ['Write your comment: why the claim is rejected.'] });
    expect(decisionBody(form({ decision: 'reject', comment: 'Personal' }), 250).body).toEqual({ decision: 'reject', comment: 'Personal' });
    expect(decisionBody(form({}), 250).errors).toEqual(['Choose your decision: approve, approve a lower amount or reject.']);
  });

  it('says where an approved claim goes next, on the button and once done', () => {
    expect(decisionButton('approve', 'manager').label).toBe('Approve and send to HR');
    expect(decisionButton('approve_other', 'hr').label).toBe('Approve and send to Finance');
    expect(decisionButton('approve', 'finance').label).toBe('Approve and add to payroll');
    expect(decisionButton('reject', 'hr').label).toBe('Reject the claim');
    expect(decidedText('approve', 'manager')).toBe('Approved: the claim goes to HR.');
    expect(decidedText('approve_other', 'hr')).toBe('Approved: the claim goes to Finance.');
    expect(decidedText('approve', 'finance')).toMatch(/added, untaxed, to the next payroll/);
    expect(decidedText('reject', 'finance')).toBe('Claim rejected. The employee sees your comment.');
  });

  it('says on the claim’s page what was just done there, and nothing for anything else', () => {
    expect(doneText({ done: 'sent' }, 'with_manager')?.text).toMatch(/^Claim sent\. It goes to your direct manager, then HR, then Finance/);
    expect(doneText({ done: 'sent' }, 'with_hr')?.text).toMatch(/^Claim sent\. It goes to HR, then Finance/);
    expect(doneText({ done: 'cancelled' }, 'cancelled')).toEqual({ text: 'Claim cancelled. It stays on your list, cancelled.', tone: 'ok' });
    expect(doneText({ done: 'hr_approve_other' }, 'with_finance')).toEqual({ text: 'Approved: the claim goes to Finance.', tone: 'ok' });
    expect(doneText({ done: 'manager_reject' }, 'rejected')?.text).toBe('Claim rejected. The employee sees your comment.');
    // refused as the claim moved on since the page was opened (the API's 409)
    expect(doneText({ done: 'moved' }, 'with_finance')).toEqual({ text: MOVED_ON, tone: 'warn' });
    expect(claimDoneHref(ID, 'moved')).toBe(`/reimbursements/${ID}?done=moved`);
    expect(doneText({ done: 'ceo_approve' }, 'approved')).toBeNull();
    expect(doneText({ done: 'hr_maybe' }, 'with_hr')).toBeNull();
    expect(doneText({}, 'with_hr')).toBeNull();
  });
});
