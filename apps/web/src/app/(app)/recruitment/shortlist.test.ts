import { describe, expect, it } from 'vitest';
import {
  allTicks,
  batchDecisionForm,
  batchDoneText,
  batchProblem,
  decideDoneText,
  outcomeLabel,
  sharedStage,
  skippedText,
  tickable,
  ticked,
  tickedAll,
  tickedIds,
  vacancyCaller,
} from './shortlist';

// The batches on the site (owner, 29 October 2026: "Tick several at once"; the recruitment tree, 3 November 2026; 5
// November 2026: Review 1 merged into Applicants, Review 2 the Final Review, no reasons at a review).
// Every person here is invented.

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};

describe('the ticks', () => {
  it('ticks one, all or none, and reads "Select all" as all, some or none', () => {
    const one = ticked(new Set(), 'a', true);
    expect([...one]).toEqual(['a']);
    expect([...ticked(one, 'a', false)]).toEqual([]);
    expect(allTicks(one, ['a', 'b'])).toBe('some');
    expect(allTicks(tickedAll(['a', 'b'], true), ['a', 'b'])).toBe('all');
    expect(allTicks(tickedAll(['a', 'b'], false), ['a', 'b'])).toBe('none');
  });

  it('keeps those the list still shows, in its order', () => {
    expect(tickedIds(['c', 'a', 'b'], new Set(['a', 'c', 'gone']))).toEqual(['c', 'a']);
  });

  it('acts on those ticked at one step only', () => {
    const stageOf = { a: 'applied', b: 'applied', c: 'review_2' } as const;
    expect(sharedStage(['a', 'b'], stageOf)).toBe('applied');
    expect(sharedStage(['a', 'c'], stageOf)).toBeNull();
    expect(sharedStage([], stageOf)).toBeNull();
  });
});

describe('who ticks what on a vacancy’s list (9 November 2026: the Final Review and the interview the hiring manager’s)', () => {
  const v = { viewer: 'manages' as const, recruiter: { id: 'rana', name: 'Rana Recruiter' }, hiringManager: { id: 'hana', name: 'Hana Hiring' } };
  const row = (stage: 'applied' | 'review_2' | 'screening' | 'interview' | 'offer' | 'rejected', filteredOut = false) => ({ stage, filteredOut });

  it('lets the recruiter tick Applicants; HR HR Screening; the hiring manager the Final Review and the interview; never one filtered out', () => {
    const hr = vacancyCaller(v, { employeeId: 'someone', superAdmin: false });
    expect(tickable(row('applied'), hr)).toBe(false);
    expect(tickable(row('review_2'), hr)).toBe(false);
    expect(tickable(row('screening'), hr)).toBe(true);
    expect(tickable(row('interview'), hr)).toBe(false);
    expect(tickable(row('offer'), hr)).toBe(false);
    expect(tickable(row('rejected'), hr)).toBe(false);
    const recruiter = vacancyCaller(v, { employeeId: 'rana', superAdmin: false });
    expect(tickable(row('applied'), recruiter)).toBe(true);
    expect(tickable(row('applied', true), recruiter)).toBe(false);
    expect(tickable(row('review_2'), recruiter)).toBe(false);
    const manager = vacancyCaller({ ...v, viewer: 'hiring_manager' as const }, { employeeId: 'hana', superAdmin: false });
    expect(tickable(row('review_2'), manager)).toBe(true);
    expect(tickable(row('interview'), manager)).toBe(true);
    expect(tickable(row('screening'), manager)).toBe(false);
  });

  it('lets a Super Admin tick every step, and HR a step nobody is named for', () => {
    expect(tickable(row('review_2'), vacancyCaller(v, { employeeId: null, superAdmin: true }))).toBe(true);
    const hr = vacancyCaller({ ...v, recruiter: null, hiringManager: null }, { employeeId: 'someone', superAdmin: false });
    expect(tickable(row('applied'), hr)).toBe(true);
    expect(tickable(row('review_2'), hr)).toBe(true);
    expect(tickable(row('interview'), hr)).toBe(true);
  });
});

describe('a batch', () => {
  it('needs one ticked, at most 100', () => {
    expect(batchProblem([])).toBe('Tick at least one applicant to decide.');
    expect(batchProblem(['a'])).toBeNull();
    expect(batchProblem(Array.from({ length: 101 }, (_, i) => `a${i}`))).toBe('Decide at most 100 applicants at a time.');
  });

  it('reads a step decided for several: the outcome, a rejection’s reasons (HR Screening’s, the interview’s), the feedback', () => {
    const fd = form([
      ['applicationIds', 'a'],
      ['applicationIds', 'b'],
      ['applicationIds', 'a'],
      ['stage', 'screening'],
      ['outcome', 'rejected'],
      ['reasonsAsked', '1'],
      ['reasons', 'culture_fit'],
      ['feedback', '  Not enough motion work '],
    ]);
    expect(batchDecisionForm(fd)).toEqual({
      body: { applicationIds: ['a', 'b'], stage: 'screening', outcome: 'rejected', reasons: ['culture_fit'], feedback: 'Not enough motion work' },
      errors: [],
    });
    expect(batchDecisionForm(form([['applicationIds', 'a'], ['stage', 'review_2'], ['outcome', 'passed']])).body).toEqual({ applicationIds: ['a'], stage: 'review_2', outcome: 'passed', reasons: [], feedback: null });
  });

  it('rejects at a review with no reasons, the feedback optional (owner, 5 November 2026)', () => {
    expect(batchDecisionForm(form([['applicationIds', 'a'], ['stage', 'applied'], ['outcome', 'rejected']])).body).toEqual({ applicationIds: ['a'], stage: 'applied', outcome: 'rejected', reasons: [], feedback: null });
    expect(batchDecisionForm(form([['applicationIds', 'a'], ['stage', 'review_2'], ['outcome', 'rejected'], ['feedback', 'Portfolio too thin']])).body).toEqual({
      applicationIds: ['a'],
      stage: 'review_2',
      outcome: 'rejected',
      reasons: [],
      feedback: 'Portfolio too thin',
    });
  });

  it('says what is missing in words', () => {
    expect(batchDecisionForm(form([['stage', 'screening'], ['outcome', 'rejected'], ['reasonsAsked', '1']])).errors).toEqual(['Tick at least one applicant to decide.', 'Choose why they are rejected: one reason or more.']);
    expect(batchDecisionForm(form([['applicationIds', 'a'], ['stage', 'offer'], ['outcome', 'passed']])).errors).toEqual(['Tick applicants at one step to decide them together.']);
    // gone steps aren't steps any more
    expect(batchDecisionForm(form([['applicationIds', 'a'], ['stage', 'review_1'], ['outcome', 'passed']])).errors).toEqual(['Tick applicants at one step to decide them together.']);
    // an outcome the step doesn't take
    expect(batchDecisionForm(form([['applicationIds', 'a'], ['stage', 'applied'], ['outcome', 'unreachable']])).errors).toEqual(['Choose the outcome.']);
  });

  it('names its buttons for those ticked', () => {
    expect(outcomeLabel('passed', 2)).toBe('Pass (2)');
    expect(outcomeLabel('rejected', 2)).toBe('Reject (2)');
    expect(outcomeLabel('unreachable', 1)).toBe('Unreachable (1)');
  });
});

describe('what a batch did', () => {
  it('says how many were done, and who was skipped with why', () => {
    expect(batchDoneText('Passed', { done: [{ id: 'a', number: 'APP-1', fullName: 'Sara Ali' }], skipped: [] })).toBe('Passed: 1.');
    const result = {
      done: [{ id: 'a', number: 'APP-1', fullName: 'Sara Ali' }],
      skipped: [
        { id: 'b', number: 'APP-2', fullName: 'Omar Adel', reason: 'They were rejected already.' },
        { id: 'c', number: null, fullName: null, reason: 'Applicant not found.' },
      ],
    };
    expect(batchDoneText('Passed', result)).toBe('Passed: 1; 2 skipped: Omar Adel (they were rejected already), One applicant (applicant not found).');
    expect(batchDoneText('Passed', result, 1)).toBe('Passed: 1; 2 skipped: Omar Adel (they were rejected already), and 1 more.');
    expect(skippedText({ id: 'x', number: 'APP-9', fullName: null, reason: 'Why.' })).toBe('APP-9 (why)');
    expect(decideDoneText('passed', { done: [], skipped: [] })).toBe('Passed: 0.');
    expect(decideDoneText('unreachable', result).startsWith('Marked unreachable: 1; 2 skipped')).toBe(true);
  });
});
