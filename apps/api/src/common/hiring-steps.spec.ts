import {
  hiringStepOf,
  interviewGateProblem,
  namesLine,
  reviewNotice,
  screeningCallProblem,
  shortlistEmail,
  shortlistNotice,
  suggestionLabel,
  suggestionShown,
  type HiringStepInput,
} from '@trendlix/shared';

// The hiring steps (owner, 29 October 2026: "HR Filteration and shortlisting - Manager view the shortlisted and accept or
// reject them - HR Screening and scheduling"; packages/shared hiring-steps.ts). Every person here is invented.

const a = (over: Partial<HiringStepInput> = {}): HiringStepInput => ({ stage: 'shortlisted', hasHiringManager: true, suggestion: null, screeningCall: null, ...over });

describe('the interview, only after the hiring manager’s acceptance and a passed screening call', () => {
  it('waits for the hiring manager, then the screening call', () => {
    expect(interviewGateProblem(a())).toBe('Waiting for the hiring manager to accept them.');
    expect(interviewGateProblem(a({ suggestion: 'reject' }))).toBe('The hiring manager rejected them: reject them, or ask the hiring manager to accept them.');
    expect(interviewGateProblem(a({ suggestion: 'next' }))).toBe('Make the screening call first: only those who pass it are interviewed.');
    expect(interviewGateProblem(a({ suggestion: 'next', screeningCall: 'failed' }))).toBe('They failed the screening call.');
    expect(interviewGateProblem(a({ suggestion: 'next', screeningCall: 'passed' }))).toBeNull();
  });

  it('asks no acceptance on a vacancy without a hiring manager; nothing of a later round', () => {
    expect(interviewGateProblem(a({ hasHiringManager: false }))).toBe('Make the screening call first: only those who pass it are interviewed.');
    expect(interviewGateProblem(a({ hasHiringManager: false, screeningCall: 'passed' }))).toBeNull();
    expect(interviewGateProblem(a({ stage: 'applied' }))).toMatch(/^Shortlist them first/);
    expect(interviewGateProblem(a({ stage: 'interview' }))).toBeNull();
    expect(interviewGateProblem(a({ stage: 'offer' }))).toBeNull();
  });

  it('makes the screening call only at Shortlisted, once accepted', () => {
    expect(screeningCallProblem(a())).toBe('Waiting for the hiring manager to accept them.');
    expect(screeningCallProblem(a({ suggestion: 'next' }))).toBeNull();
    expect(screeningCallProblem(a({ hasHiringManager: false }))).toBeNull();
    expect(screeningCallProblem(a({ stage: 'applied' }))).toMatch(/^Shortlist them first/);
    expect(screeningCallProblem(a({ stage: 'interview' }))).toBe('They are at Interview: the screening call is made at Shortlisted.');
    expect(screeningCallProblem(a({ suggestion: 'next', filteredOut: true }))).toMatch(/filtered out/);
  });

  it('tells where a shortlisted applicant stands', () => {
    expect(hiringStepOf(a())).toBe('to_review');
    expect(hiringStepOf(a({ suggestion: 'reject' }))).toBe('manager_rejected');
    expect(hiringStepOf(a({ suggestion: 'next' }))).toBe('call_due');
    expect(hiringStepOf(a({ suggestion: 'next', screeningCall: 'failed' }))).toBe('call_failed');
    expect(hiringStepOf(a({ suggestion: 'next', screeningCall: 'passed' }))).toBe('ready');
    expect(hiringStepOf(a({ hasHiringManager: false }))).toBe('call_due');
    expect(hiringStepOf(a({ stage: 'interview' }))).toBeNull();
  });
});

describe('the words', () => {
  it('says the hiring manager’s choice as their review at Shortlisted, the next step later', () => {
    expect(suggestionLabel('next', 'shortlisted')).toBe('Accept');
    expect(suggestionLabel('next', 'interview')).toBe('Next step');
    expect(suggestionShown('reject', 'shortlisted')).toBe('Rejected by the hiring manager');
    expect(suggestionShown('next', 'interview')).toBe('Hiring manager suggests: Next step');
  });

  it('tells the hiring manager once a batch, and HR once a review', () => {
    const names = ['Mona Adel', 'Karim Fathy', 'Hana Samir', 'Omar Nabil', 'Sara Hany', 'Nour Ali'];
    expect(namesLine(names)).toBe('Mona Adel, Karim Fathy, Hana Samir, Omar Nabil, Sara Hany and 1 more');
    expect(shortlistNotice('Media Buyer', names.slice(0, 1))).toEqual({ title: '1 applicant shortlisted for Media Buyer: please accept or reject them', body: 'Mona Adel' });
    const mail = shortlistEmail('Media Buyer', names.slice(0, 2), 'https://people.trendlix.com/recruitment/my-hiring');
    expect(mail.subject).toBe('2 applicants shortlisted for Media Buyer: please accept or reject them');
    expect(mail.text).toContain('- Karim Fathy');
    expect(mail.text).toContain('https://people.trendlix.com/recruitment/my-hiring');
    expect(reviewNotice('Media Buyer', 3, 1)).toEqual({ title: 'Hiring manager reviewed the shortlist: 3 accepted, 1 rejected', body: 'Media Buyer' });
    expect(reviewNotice('Media Buyer', 0, 2).title).toBe('Hiring manager reviewed the shortlist: 2 rejected');
  });
});
