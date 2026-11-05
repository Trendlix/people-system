import { describe, expect, it } from 'vitest';
import { decisionLine, decisionOf, holdBadge, holdFilterOf, rejectReasonsAt } from './tree';

// The recruitment tree on the site (owner, 3 November 2026: "Recrutment tree"; "Reason list + feedback").

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};

describe('the hold', () => {
  it('reads the filter, and badges Unreachable and Pending', () => {
    expect(holdFilterOf('unreachable')).toBe('unreachable');
    expect(holdFilterOf(['pending', 'x'])).toBe('pending');
    expect(holdFilterOf('maybe')).toBe('');
    expect(holdFilterOf(undefined)).toBe('');
    expect(holdBadge('unreachable')).toEqual({ label: 'Unreachable', className: 'bg-warn-soft text-warn', title: 'The candidate could not be contacted' });
    expect(holdBadge('pending')?.label).toBe('Pending');
    expect(holdBadge(null)).toBeNull();
  });
});

describe('a decision', () => {
  it('says it in a line', () => {
    expect(decisionLine({ stage: 'screening', outcome: 'rejected', reasons: ['culture_fit', 'location'] })).toBe('HR Screening: Rejected (Culture Fit, Location)');
    expect(decisionLine({ stage: 'applied', outcome: 'passed', reasons: [] })).toBe('Applicants: Passed');
    // the steps of before keep their names in the histories (5 November 2026)
    expect(decisionLine({ stage: 'review_1', outcome: 'rejected', reasons: ['culture_fit'] })).toBe('Review 1: Rejected (Culture Fit)');
    expect(decisionLine({ stage: 'final_review', outcome: 'passed', reasons: [] })).toBe('Hiring Manager Review: Passed');
    expect(decisionLine({ stage: 'interview', outcome: 'pending', reasons: [] })).toBe('Technical Interview: Pending');
  });

  it('offers each step its own reasons', () => {
    expect(rejectReasonsAt('interview')).toContain('no_show');
    expect(rejectReasonsAt('screening')).toContain('salary_expectations');
    expect(rejectReasonsAt('offer')).toEqual(rejectReasonsAt('screening'));
    // a review is Pass or Reject, no reasons (owner, 5 November 2026)
    expect(rejectReasonsAt('applied')).toEqual([]);
    expect(rejectReasonsAt('review_2')).toEqual([]);
  });

  it('reads the form: the outcome, a rejection’s reasons and email tick, the feedback', () => {
    expect(decisionOf(form([['outcome', 'rejected'], ['reasonsAsked', '1'], ['reasons', 'attitude'], ['reasons', 'attitude'], ['feedback', ' Late twice '], ['email', 'on']]))).toEqual({
      body: { outcome: 'rejected', reasons: ['attitude'], feedback: 'Late twice', email: true },
      errors: [],
    });
    // the reasons and the email only go with a rejection
    expect(decisionOf(form([['reasons', 'attitude'], ['email', 'on']]), 'passed').body).toEqual({ outcome: 'passed', reasons: [], feedback: null });
  });

  it('says what is missing in words', () => {
    expect(decisionOf(form([])).errors).toEqual(['Choose the outcome.']);
    expect(decisionOf(form([['outcome', 'rejected'], ['reasonsAsked', '1']])).errors).toEqual(['Choose why they are rejected: one reason or more.']);
    // a review's rejection asks no reasons (its form has none): the feedback optional
    expect(decisionOf(form([['outcome', 'rejected']])).body).toEqual({ outcome: 'rejected', reasons: [], feedback: null });
    expect(decisionOf(form([['outcome', 'passed'], ['feedback', 'x'.repeat(2001)]])).errors).toEqual(['Keep the feedback to 2000 characters or fewer.']);
  });
});
