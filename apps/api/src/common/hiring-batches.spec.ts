import { BATCH_NOT_FOUND, batchIds, decideSkip, OTHER_VACANCY, reviewOrder, sendSkip, skippedOf, type BatchApplicant } from '../recruitment/hiring-batches.js';

// The batches (owner, 29 October 2026: "Tick several at once"; the recruitment tree, 3 November 2026;
// recruitment/hiring-batches.ts). Every person here is invented.

const V = 'vacancy-1';
const a = (over: Partial<BatchApplicant> = {}): BatchApplicant => ({ id: 'a1', number: 'APP-2026-0001', fullName: 'Sara Applicant', vacancyId: V, stage: 'applied', filteredOut: false, ...over });

describe('HR’s Send to Review 1 of several', () => {
  it('sends those at Applicants of the vacancy', () => {
    expect(sendSkip(a(), V)).toBeNull();
  });

  it('skips the others with why, in words', () => {
    expect(sendSkip(a({ vacancyId: 'vacancy-2' }), V)).toBe(OTHER_VACANCY);
    expect(sendSkip(a({ filteredOut: true }), V)).toBe('They failed a must-have question and were filtered out: restore them first.');
    expect(sendSkip(a({ stage: 'review_1' }), V)).toBe('They are at Review 1 already.');
    expect(sendSkip(a({ stage: 'rejected' }), V)).toBe('They were rejected: restore them first.');
    expect(sendSkip(a({ stage: 'hired' }), V)).toBe('They were hired: their application stays as it is.');
    expect(sendSkip(a({ stage: 'screening' }), V)).toBe('They are at HR Screening: only Applicants are sent to Review 1.');
  });
});

describe('a step decided for several', () => {
  it('decides those at that step of the vacancy', () => {
    expect(decideSkip(a({ stage: 'final_review' }), V, 'final_review')).toBeNull();
  });

  it('skips the others with why, in words', () => {
    expect(decideSkip(a({ stage: 'final_review', vacancyId: 'vacancy-2' }), V, 'final_review')).toBe(OTHER_VACANCY);
    expect(decideSkip(a({ stage: 'final_review', filteredOut: true }), V, 'final_review')).toBe('They failed a must-have question and were filtered out.');
    expect(decideSkip(a({ stage: 'rejected' }), V, 'review_2')).toBe('They were rejected already.');
    expect(decideSkip(a({ stage: 'screening' }), V, 'final_review')).toBe('They are at HR Screening: only those at Final Review are decided here.');
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

describe('My Hiring’s reviews waiting, in order', () => {
  const r = (fullName: string, since: string | null, matchPercent: number | null, cvMatchPercent: number | null = null) => ({ fullName, since, matchPercent, cvMatchPercent });

  it('lists the longest waiting first, then the best match, then by name', () => {
    const rows = [r('Rana', '2026-11-03T10:00:00Z', 90), r('Adam', '2026-11-01T10:00:00Z', 60), r('Nour', '2026-11-01T10:00:00Z', 80), r('Zaid', null, 99), r('Badr', '2026-11-01T10:00:00Z', null, 70)];
    expect(reviewOrder(rows).map((x) => x.fullName)).toEqual(['Nour', 'Badr', 'Adam', 'Rana', 'Zaid']);
  });

  it('leaves the list it was given as it was', () => {
    const rows = [r('B', '2026-11-02T00:00:00Z', 1), r('A', '2026-11-01T00:00:00Z', 1)];
    reviewOrder(rows);
    expect(rows.map((x) => x.fullName)).toEqual(['B', 'A']);
  });
});
