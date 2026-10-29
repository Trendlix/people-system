import { describe, expect, it } from 'vitest';
import { HIRING_STEPS, hiringStepOf, type ApplicationView } from '@trendlix/shared';
import { boardInterviewProblem, screeningCallApiPath, screeningCallCard, screeningCallForm, screeningCallSavedText, STEP_STANDING, stepInputOf } from './screening-call';

// HR's screening call and the interview's gate on the site (owner, 29 October 2026: "HR Screening and scheduling";
// "Screening call + result"). Every person here is invented.

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};

type Shown = Parameters<typeof screeningCallCard>[0];
const applicant = (over: Partial<Shown> = {}): Shown => ({ viewer: 'manages', stage: 'shortlisted', filteredOut: false, suggestion: null, screeningCall: null, hasHiringManager: true, ...over });
const accepted: ApplicationView['suggestion'] = { kind: 'next', note: null, by: { email: 'hana@example.test', name: 'Hana Hiring' }, at: '2026-10-29T10:00:00.000Z' };
const passed: ApplicationView['screeningCall'] = { result: 'passed', note: 'Clear and keen', by: { email: 'hr@example.test', name: 'Huda HR' }, at: '2026-10-29T11:00:00.000Z' };

describe('the screening call’s form', () => {
  it('reads Passed or Failed and the comment', () => {
    expect(screeningCallForm(form([['result', 'passed'], ['note', '  Clear and keen  ']]))).toEqual({ body: { result: 'passed', note: 'Clear and keen' }, errors: [] });
    expect(screeningCallForm(form([['result', 'failed'], ['note', '']]))).toEqual({ body: { result: 'failed', note: null }, errors: [] });
  });

  it('says what is missing or too long', () => {
    expect(screeningCallForm(form([]))).toEqual({ body: null, errors: ['Choose whether they passed or failed the screening call.'] });
    expect(screeningCallForm(form([['result', 'maybe'], ['note', 'x'.repeat(1001)]])).errors).toEqual([
      'Choose whether they passed or failed the screening call.',
      'Keep the comment to 1000 characters or fewer.',
    ]);
  });

  it('is sent to the applicant’s address, and says what was saved', () => {
    expect(screeningCallApiPath('a b')).toBe('/recruitment/applications/a%20b/screening-call');
    expect(screeningCallSavedText('passed')).toContain('Schedule their interview');
    expect(screeningCallSavedText('failed')).toContain('no interview can be scheduled');
  });
});

describe('the applicant page’s Screening Call card', () => {
  it('waits for the hiring manager, then offers HR the form', () => {
    expect(screeningCallCard(applicant())).toEqual({ call: null, form: false, problem: 'Waiting for the hiring manager to accept them.' });
    expect(screeningCallCard(applicant({ suggestion: { ...accepted!, kind: 'reject' } }))?.problem).toBe('The hiring manager rejected them: reject them, or ask the hiring manager to accept them.');
    expect(screeningCallCard(applicant({ suggestion: accepted }))).toEqual({ call: null, form: true, problem: null });
    // made already: shown, and the form to change it
    expect(screeningCallCard(applicant({ suggestion: accepted, screeningCall: passed }))).toEqual({ call: passed, form: true, problem: null });
    // no hiring manager: no acceptance asked
    expect(screeningCallCard(applicant({ hasHiringManager: false }))).toEqual({ call: null, form: true, problem: null });
  });

  it('shows the call made, read only, to others and at later stages; nothing when there is none', () => {
    expect(screeningCallCard(applicant({ viewer: 'hiring_manager', suggestion: accepted, screeningCall: passed }))).toEqual({ call: passed, form: false, problem: null });
    expect(screeningCallCard(applicant({ viewer: 'reads', suggestion: accepted }))).toBeNull();
    expect(screeningCallCard(applicant({ stage: 'interview', screeningCall: passed }))).toEqual({ call: passed, form: false, problem: null });
    expect(screeningCallCard(applicant({ stage: 'applied' }))).toBeNull();
    // an API before the hiring steps
    expect(screeningCallCard(applicant({ hasHiringManager: undefined }))).toBeNull();
  });

  it('reads the rules’ input from the page’s applicant', () => {
    expect(stepInputOf(applicant({ suggestion: accepted, screeningCall: passed }))).toEqual({ stage: 'shortlisted', filteredOut: false, hasHiringManager: true, suggestion: 'next', screeningCall: 'passed' });
    expect(stepInputOf(applicant({ hasHiringManager: undefined }))).toMatchObject({ hasHiringManager: false, suggestion: null, screeningCall: null });
  });
});

describe('the board’s move to Interview', () => {
  it('stands each hiring step as it is', () => {
    for (const step of HIRING_STEPS) expect(hiringStepOf(STEP_STANDING[step])).toBe(step);
  });

  it('says why a shortlisted card can’t go yet, in the API’s words', () => {
    expect(boardInterviewProblem({ stage: 'shortlisted', hiringStep: 'to_review' })).toBe('Waiting for the hiring manager to accept them.');
    expect(boardInterviewProblem({ stage: 'shortlisted', hiringStep: 'manager_rejected' })).toMatch(/^The hiring manager rejected them/);
    expect(boardInterviewProblem({ stage: 'shortlisted', hiringStep: 'call_due' })).toBe('Make the screening call first: only those who pass it are interviewed.');
    expect(boardInterviewProblem({ stage: 'shortlisted', hiringStep: 'call_failed' })).toBe('They failed the screening call.');
    expect(boardInterviewProblem({ stage: 'shortlisted', hiringStep: 'ready' })).toBeNull();
    // the API decides when the card doesn't say, and at other stages
    expect(boardInterviewProblem({ stage: 'shortlisted' })).toBeNull();
    expect(boardInterviewProblem({ stage: 'applied', hiringStep: null })).toBeNull();
  });
});
