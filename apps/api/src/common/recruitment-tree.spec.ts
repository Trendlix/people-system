import { decisionProblems, rejectReasonsOf, stageAfter, STEP_OUTCOMES_OF, takesStep, type TreeCaller } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';

// The recruitment tree (owner, 3 November 2026: "Recrutment tree"; 5 November 2026: the reviews merged): packages/shared
// recruitment-tree.ts.

describe('where a pass leads (5 November 2026: Applicants the recruiter’s review, Review 2 the Final Review)', () => {
  it('Applicants → Final Review → HR Screening → Technical Interview → Offer', () => {
    const manager = { hasRecruiterManager: true };
    expect(stageAfter('applied', manager)).toBe('review_2');
    expect(stageAfter('review_2', manager)).toBe('screening');
    expect(stageAfter('screening', manager)).toBe('interview');
    expect(stageAfter('interview', manager)).toBe('offer');
  });

  it('skips the Final Review without a recruiter’s manager; the hiring manager has no review any more', () => {
    expect(stageAfter('applied', { hasRecruiterManager: false })).toBe('screening');
  });
});

describe('the outcomes and reasons', () => {
  it('each step takes its own outcomes: a review Pass or Reject, the interview’s unchanged', () => {
    expect(STEP_OUTCOMES_OF.applied).toEqual(['passed', 'rejected']);
    expect(STEP_OUTCOMES_OF.review_2).toEqual(['passed', 'rejected']);
    expect(STEP_OUTCOMES_OF.screening).toEqual(['accepted', 'rejected', 'unreachable']);
    expect(STEP_OUTCOMES_OF.interview).toEqual(['accepted', 'rejected', 'pending', 'unreachable', 'declined']);
    // the reasons: HR Screening's and the interview's lists; none at a review (owner: "optional Feedback")
    expect(rejectReasonsOf('applied')).toEqual([]);
    expect(rejectReasonsOf('review_2')).toEqual([]);
    expect(rejectReasonsOf('screening')).toContain('objectives_mismatch');
    expect(rejectReasonsOf('offer')).toEqual(rejectReasonsOf('screening'));
    expect(rejectReasonsOf('interview')).toEqual(['culture_fit', 'underqualified', 'skills_mismatch', 'overqualified', 'no_show', 'attitude']);
  });

  it('a review’s rejection takes no reasons, its feedback optional; elsewhere one reason or more from the step’s list', () => {
    expect(decisionProblems('applied', { outcome: 'passed', feedback: 'Strong portfolio' })).toEqual([]);
    expect(decisionProblems('applied', { outcome: 'rejected' })).toEqual([]);
    expect(decisionProblems('review_2', { outcome: 'rejected', feedback: 'Not for this role' })).toEqual([]);
    expect(decisionProblems('review_2', { outcome: 'rejected', reasons: ['culture_fit'] })).toEqual([
      'A review is passed or rejected: no reasons are chosen, write feedback if you like.',
    ]);
    expect(decisionProblems('applied', { outcome: 'unreachable' })).toEqual(['Choose Passed or Rejected.']);
    expect(decisionProblems('screening', { outcome: 'rejected' })).toEqual(['Choose why they are rejected: one reason or more.']);
    expect(decisionProblems('screening', { outcome: 'rejected', reasons: ['culture_fit', 'location'] })).toEqual([]);
    expect(decisionProblems('screening', { outcome: 'rejected', reasons: ['no_show'] })[0]).toContain('Choose the reasons from: Culture Fit');
    expect(decisionProblems('interview', { outcome: 'rejected', reasons: ['no_show', 'no_show'] })).toEqual(['Choose each reason once.']);
    expect(decisionProblems('interview', { outcome: 'pending', reasons: ['attitude'] })).toEqual(['Reasons are for a rejection only.']);
    expect(decisionProblems('screening', { outcome: 'pending' })).toEqual(['Choose Accepted, Rejected or Unreachable.']);
    expect(decisionProblems('interview', { outcome: 'declined', feedback: 'x'.repeat(2001) })).toEqual(['Keep the feedback to 2000 characters or fewer.']);
    // HR's hand rejection at the Offer: HR Screening's reasons
    expect(decisionProblems('offer', { outcome: 'rejected', reasons: ['underqualified'] })).toEqual([]);
    expect(decisionProblems('offer', { outcome: 'rejected' })).toEqual(['Choose why they are rejected: one reason or more.']);
  });
});

describe('who takes each step', () => {
  const nobody: TreeCaller = { manages: false, superAdmin: false, isRecruiter: false, isRecruiterManager: false, hasRecruiter: true, hasRecruiterManager: true };
  const hr = { ...nobody, manages: true };
  it('Applicants the recruiter, the Final Review their manager; HR the rest; a Super Admin any', () => {
    expect(takesStep('applied', { ...hr, isRecruiter: true })).toBe(true);
    // another HR person: not the recruiter's review
    expect(takesStep('applied', hr)).toBe(false);
    expect(takesStep('review_2', { ...nobody, isRecruiterManager: true })).toBe(true);
    expect(takesStep('review_2', hr)).toBe(false);
    expect(takesStep('screening', hr)).toBe(true);
    expect(takesStep('interview', hr)).toBe(true);
    expect(takesStep('interview', { ...nobody, isRecruiterManager: true })).toBe(false);
    expect(takesStep('review_2', { ...nobody, superAdmin: true })).toBe(true);
  });

  it('a review nobody is named for is HR’s', () => {
    expect(takesStep('applied', { ...hr, hasRecruiter: false })).toBe(true);
    expect(takesStep('review_2', { ...hr, hasRecruiterManager: false })).toBe(true);
    expect(takesStep('review_2', { ...nobody, hasRecruiterManager: false })).toBe(false);
  });
});
