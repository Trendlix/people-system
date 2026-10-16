import { describe, expect, it } from 'vitest';
import { ceoDecisionBody, figureFrom, figureValue, hrDecisionBody, previewGross, requestBody } from './decisions';

// The forms of raise requests and their decisions, read as the API takes them (owner, 17 October 2026).

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe('the raise typed', () => {
  it('an amount as the pay fields take one, a percent with a point only', () => {
    expect(figureValue('amount', '1,500')).toBe(1500);
    expect(figureValue('amount', '١٥٠٠')).toBe(1500);
    expect(figureValue('percent', '7.5')).toBe(7.5);
    expect(figureValue('percent', '10%')).toBe(10);
    // a decimal comma would read as thousands
    expect(figureValue('percent', '7,5')).toBeNaN();
    // too many decimals stay a number, for the problem to say so
    expect(figureValue('percent', '7.125')).toBe(7.125);
    expect(figureValue('amount', 'abc')).toBeNaN();
  });

  it('of the kinds the caller may use; empty is none, a mistake when required', () => {
    const errors: string[] = [];
    expect(figureFrom(form({ figureKind: 'amount', figureValue: '1,500' }), errors)).toEqual({ kind: 'amount', value: 1500 });
    expect(figureFrom(form({ figureKind: 'percent', figureValue: '' }), errors)).toBeNull();
    expect(errors).toEqual([]);
    // a manager: a percent only, even if an amount is sent
    expect(figureFrom(form({ figureKind: 'amount', figureValue: '8' }), errors, ['percent'])).toEqual({ kind: 'percent', value: 8 });
    figureFrom(form({ figureKind: 'percent', figureValue: '' }), errors, ['amount', 'percent'], true);
    figureFrom(form({ figureKind: 'percent', figureValue: '150' }), errors);
    figureFrom(form({ figureKind: 'percent', figureValue: '7.125' }), errors);
    figureFrom(form({ figureKind: 'amount', figureValue: '0' }), errors);
    figureFrom(form({ figureValue: '10' }), errors);
    expect(errors).toEqual([
      'Enter the raise as a percent of the gross, e.g. 10.',
      'A raise is 100% of the gross at most.',
      'Enter the percent with two decimals at most, e.g. 7.5.',
      'Enter the raise as an amount in EGP of more than 0, e.g. 1,500.',
      'Choose whether the raise is an amount in EGP or a percent.',
    ]);
  });

  it('shows the gross it comes to, for those sent the gross in force', () => {
    expect(previewGross(10000, 'percent', '10')).toBe(11000);
    expect(previewGross(12345.67, 'percent', '7.5')).toBe(13271.6);
    expect(previewGross(10000, 'amount', '1,500.50')).toBe(11500.5);
    expect(previewGross(null, 'percent', '10')).toBeNull();
    expect(previewGross(10000, 'percent', '')).toBeNull();
    expect(previewGross(10000, 'percent', '101')).toBeNull();
  });
});

describe('the request', () => {
  it('the reason from the list, the comment, the raise suggested', () => {
    const errors: string[] = [];
    expect(requestBody(form({ raiseReason: 'performance', comment: ' Led the audit ', figureKind: 'amount', figureValue: '1500' }), ['amount', 'percent'], errors)).toEqual({
      raiseReason: 'performance',
      comment: 'Led the audit',
      suggestedIncrease: 1500,
    });
    expect(requestBody(form({ raiseReason: 'annual', comment: 'A year', figureKind: 'percent', figureValue: '8' }), ['percent'], errors)).toEqual({
      raiseReason: 'annual',
      comment: 'A year',
      suggestedPercent: 8,
    });
    expect(requestBody(form({ raiseReason: 'other', comment: 'Why not', figureValue: '' }), ['percent'], errors)).toEqual({ raiseReason: 'other', comment: 'Why not' });
    expect(errors).toEqual([]);
  });

  it('refuses no reason, one not on the list (adjustment is from before), and no comment', () => {
    const errors: string[] = [];
    requestBody(form({ raiseReason: '', comment: '' }), ['percent'], errors);
    requestBody(form({ raiseReason: 'adjustment', comment: 'x' }), ['percent'], errors);
    expect(errors).toEqual(['Choose why the raise is asked for.', 'Write a comment: what the raise is for.', 'Choose why the raise is asked for.']);
  });
});

describe("HR's decision", () => {
  const approve = { comment: 'Within the band', way: 'amendment', effectiveDate: '01/11/2026' };

  it('approve as suggested: the way and the date; with another raise, the raise too', () => {
    const errors: string[] = [];
    expect(hrDecisionBody(form({ decision: 'approve', ...approve }), errors)).toEqual({
      decision: 'approve',
      body: { decision: 'approve', comment: 'Within the band', way: 'amendment', effectiveDate: '2026-11-01' },
    });
    expect(hrDecisionBody(form({ decision: 'approve_other', ...approve, figureKind: 'percent', figureValue: '10' }), errors).body).toEqual({
      decision: 'approve_other',
      comment: 'Within the band',
      way: 'amendment',
      effectiveDate: '2026-11-01',
      increasePercent: 10,
    });
    // a new contract, its length if sent
    expect(hrDecisionBody(form({ decision: 'approve_other', ...approve, way: 'contract', durationMonths: '6', figureKind: 'amount', figureValue: '900' }), errors).body).toMatchObject({
      way: 'contract',
      durationMonths: 6,
      increaseAmount: 900,
    });
    expect(errors).toEqual([]);
  });

  it('reject: the comment only', () => {
    const errors: string[] = [];
    expect(hrDecisionBody(form({ decision: 'reject', comment: 'Not now', way: 'amendment', figureValue: '5' }), errors)).toEqual({ decision: 'reject', body: { comment: 'Not now' } });
    expect(errors).toEqual([]);
  });

  it('refuses no choice, no comment, approving as suggested what suggests nothing, another raise without one, no date', () => {
    const errors: string[] = [];
    hrDecisionBody(form({ comment: '' }), errors);
    hrDecisionBody(form({ decision: 'approve', ...approve }), errors, false);
    hrDecisionBody(form({ decision: 'approve_other', ...approve, figureValue: '' }), errors);
    hrDecisionBody(form({ decision: 'approve', comment: 'x', way: '', effectiveDate: '' }), errors);
    expect(errors).toEqual([
      'Choose approve, approve with another raise or reject.',
      'Write your comment on the decision.',
      'This request suggests no raise: approve it with another raise, and set the raise.',
      'Enter the raise as an amount in EGP or a percent of the gross.',
      'Choose how the raise is made: an amendment to the contract in force, or a new contract.',
      'Enter the date the raise takes effect, the 1st of a month, e.g. 01/12/2026.',
    ]);
  });
});

describe("the CEO's decision", () => {
  it('approve, approve with another raise, reject, or return to HR (the secondary button), always with a comment', () => {
    const errors: string[] = [];
    expect(ceoDecisionBody(form({ decision: 'approve', comment: 'Fine' }), errors)).toEqual({ choice: 'approve', path: 'approve', body: { comment: 'Fine' } });
    expect(ceoDecisionBody(form({ decision: 'approve_other', comment: 'More', figureKind: 'amount', figureValue: '1,200' }), errors)).toEqual({
      choice: 'approve_other',
      path: 'approve',
      body: { comment: 'More', increaseAmount: 1200 },
    });
    expect(ceoDecisionBody(form({ decision: 'reject', comment: 'No' }), errors)).toEqual({ choice: 'reject', path: 'decline', body: { comment: 'No' } });
    // Return to HR wins over the choice made
    expect(ceoDecisionBody(form({ decision: 'approve', intent: 'return', comment: 'Round it' }), errors)).toEqual({ choice: 'return', path: 'return', body: { comment: 'Round it' } });
    expect(errors).toEqual([]);
  });

  it('refuses no choice, no comment, another raise without one', () => {
    const errors: string[] = [];
    expect(ceoDecisionBody(form({ comment: 'x' }), errors).path).toBeNull();
    ceoDecisionBody(form({ decision: 'approve', comment: '' }), errors);
    ceoDecisionBody(form({ intent: 'return', comment: '' }), errors);
    ceoDecisionBody(form({ decision: 'approve_other', comment: 'x' }), errors);
    expect(errors).toEqual([
      'Choose approve, approve with another raise, reject or return to HR.',
      'Write your comment on the decision.',
      'Write what HR should change: it goes back to HR with your comment.',
      'Enter the raise as an amount in EGP or a percent of the gross.',
    ]);
  });
});
