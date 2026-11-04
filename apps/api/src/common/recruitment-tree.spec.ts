import { decisionProblems, rejectReasonsOf, stageAfter, STEP_OUTCOMES_OF, takesStep, type TreeCaller } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';

// The recruitment tree (owner, 3 November 2026: "Recrutment tree"): packages/shared recruitment-tree.ts.

describe('where a pass leads', () => {
  const both = { hasRecruiterManager: true, hasHiringManager: true };
  it('Review 1 → Review 2 → Final Review → HR Screening → Technical Interview → Offer', () => {
    expect(stageAfter('review_1', both)).toBe('review_2');
    expect(stageAfter('review_2', both)).toBe('final_review');
    expect(stageAfter('final_review', both)).toBe('screening');
    expect(stageAfter('screening', both)).toBe('interview');
    expect(stageAfter('interview', both)).toBe('offer');
  });

  it('skips Review 2 without a recruiter’s manager, and the Final Review without a hiring manager', () => {
    expect(stageAfter('review_1', { hasRecruiterManager: false, hasHiringManager: true })).toBe('final_review');
    expect(stageAfter('review_1', { hasRecruiterManager: false, hasHiringManager: false })).toBe('screening');
    expect(stageAfter('review_2', { hasRecruiterManager: true, hasHiringManager: false })).toBe('screening');
  });
});

describe('the outcomes and reasons', () => {
  it('each step takes its own outcomes', () => {
    expect(STEP_OUTCOMES_OF.review_1).toEqual(['passed', 'rejected']);
    expect(STEP_OUTCOMES_OF.screening).toEqual(['accepted', 'rejected', 'unreachable']);
    expect(STEP_OUTCOMES_OF.interview).toEqual(['accepted', 'rejected', 'pending', 'unreachable', 'declined']);
    expect(rejectReasonsOf('review_2')).toContain('objectives_mismatch');
    expect(rejectReasonsOf('interview')).toEqual(['culture_fit', 'underqualified', 'skills_mismatch', 'overqualified', 'no_show', 'attitude']);
  });

  it('a rejection takes one reason or more from its step’s list; feedback is free, within its length', () => {
    expect(decisionProblems('review_1', { outcome: 'passed', feedback: 'Strong portfolio' })).toEqual([]);
    expect(decisionProblems('review_1', { outcome: 'rejected', reasons: ['culture_fit', 'location'] })).toEqual([]);
    expect(decisionProblems('review_1', { outcome: 'rejected' })).toEqual(['Choose why they are rejected: one reason or more.']);
    expect(decisionProblems('screening', { outcome: 'rejected', reasons: ['no_show'] })[0]).toContain('Choose the reasons from: Culture Fit');
    expect(decisionProblems('interview', { outcome: 'rejected', reasons: ['no_show', 'no_show'] })).toEqual(['Choose each reason once.']);
    expect(decisionProblems('interview', { outcome: 'pending', reasons: ['attitude'] })).toEqual(['Reasons are for a rejection only.']);
    expect(decisionProblems('screening', { outcome: 'pending' })).toEqual(['Choose Accepted, Rejected or Unreachable.']);
    expect(decisionProblems('interview', { outcome: 'declined', feedback: 'x'.repeat(2001) })).toEqual(['Keep the feedback to 2000 characters or fewer.']);
    expect(decisionProblems('applied', { outcome: 'rejected', reasons: ['underqualified'] })).toEqual([]);
  });
});

describe('who takes each step', () => {
  const nobody: TreeCaller = { manages: false, superAdmin: false, isRecruiter: false, isRecruiterManager: false, isHiringManager: false, hasRecruiter: true, hasRecruiterManager: true, hasHiringManager: true };
  const hr = { ...nobody, manages: true };
  it('each review its own person; HR the rest; a Super Admin any', () => {
    expect(takesStep('review_1', { ...hr, isRecruiter: true })).toBe(true);
    // another HR person: not the recruiter's review
    expect(takesStep('review_1', hr)).toBe(false);
    expect(takesStep('review_2', { ...nobody, isRecruiterManager: true })).toBe(true);
    expect(takesStep('review_2', hr)).toBe(false);
    expect(takesStep('final_review', { ...nobody, isHiringManager: true })).toBe(true);
    expect(takesStep('final_review', hr)).toBe(false);
    expect(takesStep('screening', hr)).toBe(true);
    expect(takesStep('interview', { ...nobody, isHiringManager: true })).toBe(false);
    expect(takesStep('applied', hr)).toBe(true);
    expect(takesStep('final_review', { ...nobody, superAdmin: true })).toBe(true);
  });

  it('a review nobody is named for is HR’s', () => {
    expect(takesStep('review_1', { ...hr, hasRecruiter: false })).toBe(true);
    expect(takesStep('review_2', { ...hr, hasRecruiterManager: false })).toBe(true);
    expect(takesStep('final_review', { ...hr, hasHiringManager: false })).toBe(true);
    expect(takesStep('final_review', { ...nobody, hasHiringManager: false })).toBe(false);
  });
});
