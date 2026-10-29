import { describe, expect, it } from 'vitest';
import {
  allTicks,
  batchDoneText,
  batchProblem,
  reviewBadge,
  reviewDoneText,
  reviewForm,
  reviewLabel,
  shortlistable,
  shortlistLabel,
  skippedText,
  ticked,
  tickedAll,
  tickedIds,
} from './shortlist';

// The hiring steps on the site (owner, 29 October 2026: "HR Filteration and shortlisting - Manager view the shortlisted
// and accept or reject them"; "Tick several at once"). Every person here is invented.

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
});

describe('HR’s shortlist', () => {
  it('ticks only those at Applied, never one filtered out', () => {
    expect(shortlistable({ stage: 'applied', filteredOut: false })).toBe(true);
    expect(shortlistable({ stage: 'applied', filteredOut: true })).toBe(false);
    expect(shortlistable({ stage: 'shortlisted', filteredOut: false })).toBe(false);
    expect(shortlistable({ stage: 'rejected', filteredOut: false })).toBe(false);
  });

  it('asks for 1 to 100, and says how many on its button', () => {
    expect(batchProblem([], 'shortlist')).toBe('Tick at least one applicant to shortlist.');
    expect(batchProblem(Array.from({ length: 101 }, (_, i) => String(i)), 'shortlist')).toBe('Shortlist at most 100 applicants at a time.');
    expect(batchProblem(['a'], 'shortlist')).toBeNull();
    expect(shortlistLabel(3)).toBe('Shortlist (3)');
  });

  it('says what it did and what it skipped, with why', () => {
    expect(batchDoneText('Shortlisted', { done: [{ id: 'a', number: 'APP-1', fullName: 'Sara Ali' }], skipped: [] })).toBe('Shortlisted 1.');
    const result = {
      done: [{ id: 'a', number: 'APP-1', fullName: 'Sara Ali' }],
      skipped: [
        { id: 'b', number: 'APP-2', fullName: 'Omar Adel', reason: 'They are shortlisted already.' },
        { id: 'c', number: null, fullName: null, reason: 'Applicant not found.' },
      ],
    };
    expect(batchDoneText('Shortlisted', result)).toBe('Shortlisted 1; 2 skipped: Omar Adel (they are shortlisted already), One applicant (applicant not found).');
    expect(batchDoneText('Shortlisted', result, 1)).toBe('Shortlisted 1; 2 skipped: Omar Adel (they are shortlisted already), and 1 more.');
    expect(skippedText({ id: 'd', number: 'APP-4', fullName: null, reason: 'Gone.' })).toBe('APP-4 (gone)');
  });
});

describe('the hiring manager’s review', () => {
  it('reads the applicants ticked, the button pressed and the note', () => {
    expect(reviewForm(form([['applicationIds', 'a'], ['applicationIds', 'b'], ['applicationIds', 'a'], ['decision', 'reject'], ['note', '  Not enough motion work ']]))).toEqual({
      body: { applicationIds: ['a', 'b'], decision: 'reject', note: 'Not enough motion work' },
      errors: [],
    });
    expect(reviewForm(form([['applicationIds', 'a'], ['decision', 'next'], ['note', '   ']])).body).toEqual({ applicationIds: ['a'], decision: 'next', note: null });
  });

  it('says what is missing, in words', () => {
    expect(reviewForm(form([['decision', 'maybe'], ['note', 'x'.repeat(501)]])).errors).toEqual([
      'Tick at least one applicant to accept or reject.',
      'Choose Accept or Reject.',
      'Keep the note to 500 characters or fewer.',
    ]);
  });

  it('labels its buttons and badges', () => {
    expect(reviewLabel('next', 2)).toBe('Accept (2)');
    expect(reviewLabel('reject', 0)).toBe('Reject (0)');
    expect(reviewBadge(null).label).toBe('To review');
    expect(reviewBadge('next')).toMatchObject({ label: 'Accepted', className: 'bg-ok-soft text-ok' });
    expect(reviewBadge('reject')).toMatchObject({ label: 'Rejected', title: 'You rejected them: HR confirms the rejection.' });
  });

  it('says what it did: a rejection is HR’s to confirm', () => {
    const one = { done: [{ id: 'a', number: 'APP-1', fullName: 'Sara Ali' }], skipped: [] };
    expect(reviewDoneText('next', one)).toBe('Accepted 1. HR makes the screening call next.');
    expect(reviewDoneText('reject', one)).toBe('Rejected 1. HR confirms each rejection.');
    expect(reviewDoneText('reject', { done: [], skipped: [{ id: 'b', number: 'APP-2', fullName: 'Omar Adel', reason: 'They were rejected already.' }] })).toBe(
      'Rejected 0; 1 skipped: Omar Adel (they were rejected already).',
    );
  });
});
