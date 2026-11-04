import { describe, expect, it } from 'vitest';
import {
  allTicks,
  batchDecisionForm,
  batchDoneText,
  batchProblem,
  decideDoneText,
  outcomeLabel,
  sendLabel,
  sharedStage,
  skippedText,
  tickable,
  ticked,
  tickedAll,
  tickedIds,
  vacancyCaller,
} from './shortlist';

// The batches on the site (owner, 29 October 2026: "Tick several at once"; the recruitment tree, 3 November 2026).
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
    const stageOf = { a: 'applied', b: 'applied', c: 'review_1' } as const;
    expect(sharedStage(['a', 'b'], stageOf)).toBe('applied');
    expect(sharedStage(['a', 'c'], stageOf)).toBeNull();
    expect(sharedStage([], stageOf)).toBeNull();
  });
});

describe('who ticks what on a vacancy’s list', () => {
  const v = { viewer: 'manages' as const, recruiter: { id: 'rana', name: 'Rana Recruiter' }, recruiterManager: { id: 'mona', name: 'Mona Lead' }, hiringManager: { id: 'hadi', name: 'Hadi Manager' } };
  const row = (stage: 'applied' | 'review_1' | 'review_2' | 'final_review' | 'screening' | 'interview' | 'offer' | 'rejected', filteredOut = false) => ({ stage, filteredOut });

  it('lets HR tick Applicants, HR Screening and the Technical Interview; the recruiter Review 1 too', () => {
    const hr = vacancyCaller(v, { employeeId: 'someone', superAdmin: false });
    expect(tickable(row('applied'), hr)).toBe(true);
    expect(tickable(row('review_1'), hr)).toBe(false);
    expect(tickable(row('screening'), hr)).toBe(true);
    expect(tickable(row('interview'), hr)).toBe(true);
    expect(tickable(row('offer'), hr)).toBe(false);
    expect(tickable(row('rejected'), hr)).toBe(false);
    expect(tickable(row('applied', true), hr)).toBe(false);
    const recruiter = vacancyCaller(v, { employeeId: 'rana', superAdmin: false });
    expect(tickable(row('review_1'), recruiter)).toBe(true);
    expect(tickable(row('review_2'), recruiter)).toBe(false);
  });

  it('lets a Super Admin tick every step, and HR a review nobody is named for', () => {
    expect(tickable(row('final_review'), vacancyCaller(v, { employeeId: null, superAdmin: true }))).toBe(true);
    const hr = vacancyCaller({ ...v, recruiter: null, recruiterManager: null, hiringManager: null }, { employeeId: 'someone', superAdmin: false });
    expect(tickable(row('review_1'), hr)).toBe(true);
    expect(tickable(row('final_review'), hr)).toBe(true);
  });
});

describe('a batch', () => {
  it('needs one ticked, at most 100', () => {
    expect(batchProblem([], 'send to Review 1')).toBe('Tick at least one applicant to send to Review 1.');
    expect(batchProblem(['a'], 'send to Review 1')).toBeNull();
    expect(batchProblem(Array.from({ length: 101 }, (_, i) => `a${i}`), 'decide')).toBe('Decide at most 100 applicants at a time.');
    expect(sendLabel(3)).toBe('Send to Review 1 (3)');
  });

  it('reads a step decided for several: the outcome, a rejection’s reasons, the feedback', () => {
    const fd = form([['applicationIds', 'a'], ['applicationIds', 'b'], ['applicationIds', 'a'], ['stage', 'final_review'], ['outcome', 'rejected'], ['reasons', 'culture_fit'], ['feedback', '  Not enough motion work ']]);
    expect(batchDecisionForm(fd)).toEqual({
      body: { applicationIds: ['a', 'b'], stage: 'final_review', outcome: 'rejected', reasons: ['culture_fit'], feedback: 'Not enough motion work' },
      errors: [],
    });
    expect(batchDecisionForm(form([['applicationIds', 'a'], ['stage', 'review_2'], ['outcome', 'passed']])).body).toEqual({ applicationIds: ['a'], stage: 'review_2', outcome: 'passed', reasons: [], feedback: null });
  });

  it('says what is missing in words', () => {
    expect(batchDecisionForm(form([['stage', 'review_2'], ['outcome', 'rejected']])).errors).toEqual(['Tick at least one applicant to decide.', 'Choose why they are rejected: one reason or more.']);
    expect(batchDecisionForm(form([['applicationIds', 'a'], ['stage', 'offer'], ['outcome', 'passed']])).errors).toEqual(['Tick applicants at one step to decide them together.']);
    // an outcome the step doesn't take
    expect(batchDecisionForm(form([['applicationIds', 'a'], ['stage', 'review_1'], ['outcome', 'unreachable']])).errors).toEqual(['Choose the outcome.']);
  });

  it('names its buttons for those ticked', () => {
    expect(outcomeLabel('passed', 2)).toBe('Pass (2)');
    expect(outcomeLabel('rejected', 2)).toBe('Reject (2)');
    expect(outcomeLabel('unreachable', 1)).toBe('Unreachable (1)');
  });
});

describe('what a batch did', () => {
  it('says how many were done, and who was skipped with why', () => {
    expect(batchDoneText('Sent to Review 1', { done: [{ id: 'a', number: 'APP-1', fullName: 'Sara Ali' }], skipped: [] })).toBe('Sent to Review 1: 1.');
    const result = {
      done: [{ id: 'a', number: 'APP-1', fullName: 'Sara Ali' }],
      skipped: [
        { id: 'b', number: 'APP-2', fullName: 'Omar Adel', reason: 'They are at Review 1 already.' },
        { id: 'c', number: null, fullName: null, reason: 'Applicant not found.' },
      ],
    };
    expect(batchDoneText('Sent to Review 1', result)).toBe('Sent to Review 1: 1; 2 skipped: Omar Adel (they are at Review 1 already), One applicant (applicant not found).');
    expect(batchDoneText('Sent to Review 1', result, 1)).toBe('Sent to Review 1: 1; 2 skipped: Omar Adel (they are at Review 1 already), and 1 more.');
    expect(skippedText({ id: 'x', number: 'APP-9', fullName: null, reason: 'Why.' })).toBe('APP-9 (why)');
    expect(decideDoneText('passed', { done: [], skipped: [] })).toBe('Passed: 0.');
    expect(decideDoneText('unreachable', result).startsWith('Marked unreachable: 1; 2 skipped')).toBe(true);
  });
});
