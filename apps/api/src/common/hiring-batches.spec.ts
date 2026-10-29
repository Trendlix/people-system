import { BATCH_NOT_FOUND, batchIds, OTHER_VACANCY, reviewOrder, reviewSkip, shortlistSkip, skippedOf, type BatchApplicant } from '../recruitment/hiring-batches.js';

// The hiring steps' batches (owner, 29 October 2026: "HR Filteration and shortlisting - Manager view the shortlisted and
// accept or reject them"; "Tick several at once"; recruitment/hiring-batches.ts). Every person here is invented.

const V = 'vacancy-1';
const a = (over: Partial<BatchApplicant> = {}): BatchApplicant => ({ id: 'a1', number: 'APP-2026-0001', fullName: 'Sara Applicant', vacancyId: V, stage: 'applied', filteredOut: false, ...over });

describe('HR’s shortlist of several', () => {
  it('shortlists those at Applied of the vacancy', () => {
    expect(shortlistSkip(a(), V)).toBeNull();
  });

  it('skips the others with why, in words', () => {
    expect(shortlistSkip(a({ vacancyId: 'vacancy-2' }), V)).toBe(OTHER_VACANCY);
    expect(shortlistSkip(a({ filteredOut: true }), V)).toBe('They failed a must-have question and were filtered out: restore them first.');
    expect(shortlistSkip(a({ stage: 'shortlisted' }), V)).toBe('They are shortlisted already.');
    expect(shortlistSkip(a({ stage: 'rejected' }), V)).toBe('They were rejected: restore them first.');
    expect(shortlistSkip(a({ stage: 'hired' }), V)).toBe('They were hired: their application stays as it is.');
    expect(shortlistSkip(a({ stage: 'offer' }), V)).toBe("They are at Offer: they can't go back to shortlisted.");
    // their page may move one at Interview back; a batch leaves them be
    expect(shortlistSkip(a({ stage: 'interview' }), V)).toBe('They are at Interview: only applicants at Applied are shortlisted together.');
  });
});

describe('the hiring manager’s review of several', () => {
  it('reviews those shortlisted for the vacancy', () => {
    expect(reviewSkip(a({ stage: 'shortlisted' }), V)).toBeNull();
  });

  it('skips the others with why, in words', () => {
    expect(reviewSkip(a({ stage: 'shortlisted', vacancyId: 'vacancy-2' }), V)).toBe(OTHER_VACANCY);
    expect(reviewSkip(a({ stage: 'shortlisted', filteredOut: true }), V)).toBe('They failed a must-have question and were filtered out.');
    expect(reviewSkip(a({ stage: 'rejected' }), V)).toBe('They were rejected already.');
    expect(reviewSkip(a({ stage: 'interview' }), V)).toBe('They are at Interview: only shortlisted applicants are accepted or rejected here.');
    expect(reviewSkip(a({ stage: 'applied' }), V)).toBe('They are at Applied: only shortlisted applicants are accepted or rejected here.');
  });
});

describe('a batch', () => {
  it('takes each id once, in the order first listed', () => {
    expect(batchIds(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']);
  });

  it('names one skipped when the caller may see them, else only their id', () => {
    expect(skippedOf('a1', a(), 'Why')).toEqual({ id: 'a1', number: 'APP-2026-0001', fullName: 'Sara Applicant', reason: 'Why' });
    expect(skippedOf('zz', undefined, BATCH_NOT_FOUND)).toEqual({ id: 'zz', number: null, fullName: null, reason: 'Applicant not found.' });
  });
});

describe('My Hiring’s shortlist, in order', () => {
  const r = (fullName: string, suggestion: 'next' | 'reject' | null, matchPercent: number | null, cvMatchPercent: number | null = null) => ({ fullName, suggestion, matchPercent, cvMatchPercent });

  it('lists those not reviewed yet first, then those accepted, then those rejected; the best match first in each', () => {
    const rows = [r('Rana', 'reject', 90), r('Adam', 'next', 60), r('Nour', null, 50), r('Omar', null, null, 70), r('Hala', 'next', 80), r('Zaid', null, null), r('Badr', null, 50)];
    expect(reviewOrder(rows).map((x) => x.fullName)).toEqual(['Omar', 'Badr', 'Nour', 'Zaid', 'Hala', 'Adam', 'Rana']);
  });

  it('leaves the list it was given as it was', () => {
    const rows = [r('B', 'next', 1), r('A', null, 1)];
    reviewOrder(rows);
    expect(rows.map((x) => x.fullName)).toEqual(['B', 'A']);
  });
});
