// The steps a request still has to go through on its Every Step card (owner, 1 November 2026: "in the everystep, can we
// add all the steps and show where the request is standing?").
import { describe, expect, it } from 'vitest';
import { approverText, claimStepsAhead, homeStepsAhead, leaveStepsAhead } from './steps-ahead';

const YASMINE = { fullNameEn: 'Yasmine Fahmy', role: 'direct_manager' as const };

describe('the steps ahead', () => {
  it('a request with its manager: the manager now, then HR, then approved', () => {
    expect(leaveStepsAhead({ status: 'with_manager', manager: YASMINE })).toEqual([
      { key: 'with_manager', text: 'Waiting for Yasmine Fahmy (direct manager) to decide', now: true },
      { key: 'with_hr', text: 'Then HR', now: false },
      { key: 'end', text: 'Then it’s approved', now: false },
    ]);
    // past the manager: HR now
    expect(leaveStepsAhead({ status: 'with_hr', manager: YASMINE }).map((s) => [s.text, s.now])).toEqual([
      ['Waiting for HR to decide', true],
      ['Then it’s approved', false],
    ]);
  });

  it('nobody in charge goes straight to HR; a C-level person’s HR stage is the CEO’s', () => {
    expect(leaveStepsAhead({ status: 'with_hr', manager: null }).map((s) => s.text)).toEqual(['Waiting for HR to decide', 'Then it’s approved']);
    expect(leaveStepsAhead({ status: 'with_manager', manager: { fullNameEn: 'Dan Head', role: 'department_head' }, confidential: true }).map((s) => s.text)).toEqual([
      'Waiting for Dan Head (head of department) to decide',
      'Then the CEO',
      'Then it’s approved',
    ]);
  });

  it('nothing ahead once decided, cancelled or withdrawn', () => {
    for (const status of ['approved', 'rejected', 'cancelled']) expect(leaveStepsAhead({ status, manager: YASMINE })).toEqual([]);
    expect(homeStepsAhead({ status: 'withdrawn' })).toEqual([]);
    expect(claimStepsAhead({ status: 'approved', manager: YASMINE })).toEqual([]);
  });

  it('a claim goes on to Finance; a home location to the CEO', () => {
    expect(claimStepsAhead({ status: 'with_hr', manager: YASMINE }).map((s) => s.text)).toEqual(['Waiting for HR to decide', 'Then Finance', 'Then it’s approved for payment']);
    expect(claimStepsAhead({ status: 'with_finance', manager: null }).map((s) => s.text)).toEqual(['Waiting for Finance to decide', 'Then it’s approved for payment']);
    expect(homeStepsAhead({ status: 'with_hr' }).map((s) => s.text)).toEqual(['Waiting for HR to decide', 'Then the CEO', 'Then it’s approved']);
  });

  it('names the approver by their role, or “their manager” when not known', () => {
    expect(approverText({ fullNameEn: 'Tia Lead', role: 'team_lead' })).toBe('Tia Lead (team lead)');
    expect(approverText({ fullNameEn: 'Mona', role: null })).toBe('Mona');
    expect(approverText(null)).toBe('their manager');
  });
});
