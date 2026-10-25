import { describe, expect, it } from 'vitest';
import {
  APPLICATION_CLOSED,
  APPLICATION_EVENT_LABELS,
  CV_UPDATED_MARK_DAYS,
  cvUpdatedMark,
  reapplyChanges,
  reapplyFilter,
  reapplyNote,
  reapplyOutcome,
  REAPPLY_OPEN_STAGES,
  WHATSAPP_TEMPLATES,
  whatsappContent,
  type ReapplySent,
} from '@trendlix/shared';

// Applying again for the same job (owner, 25 October 2026: "if an employee updated the cv and reapplied, how will he be
// treated in the system?"; asked, "Update their application"; packages/shared reapply.ts): which applications are open
// to it, the must-have questions' filter after it, what changed and the step's words, the "CV updated" mark and the
// applicant's WhatsApp words.

describe('applying again: open or closed', () => {
  it('updates an application at Applied, Shortlisted, Interview or Offer', () => {
    expect(REAPPLY_OPEN_STAGES).toEqual(['applied', 'shortlisted', 'interview', 'offer']);
    for (const stage of REAPPLY_OPEN_STAGES) expect(reapplyOutcome({ stage }), stage).toBe('update');
    // an offer declined or withdrawn (back to Shortlisted), or still a draft or sent: open
    expect(reapplyOutcome({ stage: 'shortlisted', offers: [{ status: 'declined' }, { status: 'withdrawn' }] })).toBe('update');
    expect(reapplyOutcome({ stage: 'offer', offers: [{ status: 'sent' }] })).toBe('update');
  });

  it('refuses a rejected or hired one, one with an offer accepted or a profile made from it, in words', () => {
    expect(reapplyOutcome({ stage: 'rejected' })).toBe('closed');
    expect(reapplyOutcome({ stage: 'hired' })).toBe('closed');
    expect(reapplyOutcome({ stage: 'offer', offers: [{ status: 'accepted' }] })).toBe('closed');
    expect(reapplyOutcome({ stage: 'offer', employeeId: 'e1' })).toBe('closed');
    expect(reapplyOutcome({ stage: 'withdrawn' })).toBe('closed');
    expect(APPLICATION_CLOSED).toBe('Your application for this job is closed. You can apply for other jobs.');
  });
});

describe('applying again: the must-have questions', () => {
  const applied = { stage: 'applied', filteredOut: false, knockedOut: [] as string[] };

  it('at Applied, as the new answers say: filtered out now, or no longer', () => {
    expect(reapplyFilter(applied, ['q1'])).toEqual({ filteredOut: true, change: 'now_filtered' });
    expect(reapplyFilter({ stage: 'applied', filteredOut: true, knockedOut: ['q1'] }, [])).toEqual({ filteredOut: false, change: 'no_longer_filtered' });
    expect(reapplyFilter({ stage: 'applied', filteredOut: true, knockedOut: ['q1'] }, ['q2'])).toEqual({ filteredOut: true, change: null });
    expect(reapplyFilter(applied, [])).toEqual({ filteredOut: false, change: null });
  });

  it('once HR moved them on, or restored them, HR’s decision stands: never filtered out by itself, the failure told', () => {
    for (const stage of ['shortlisted', 'interview', 'offer']) {
      expect(reapplyFilter({ stage, filteredOut: false, knockedOut: [] }, ['q1']), stage).toEqual({ filteredOut: false, change: 'kept_by_hr' });
      expect(reapplyFilter({ stage, filteredOut: false, knockedOut: [] }, []), stage).toEqual({ filteredOut: false, change: null });
    }
    // restored after a must-have: kept at Applied, not filtered out, its knockouts kept
    expect(reapplyFilter({ stage: 'applied', filteredOut: false, knockedOut: ['q1'] }, ['q1'])).toEqual({ filteredOut: false, change: 'kept_by_hr' });
  });
});

describe('applying again: what changed, in the step', () => {
  const sent = (over: Partial<ReapplySent> = {}): ReapplySent => ({
    fullName: 'Sara Ali',
    mobile: '+201012345678',
    linkedin: null,
    portfolioLinks: [],
    portfolioFile: false,
    yearsExperience: 3,
    noticePeriod: '30 days',
    expectedSalary: 20000,
    answers: { q1: 'yes', q2: 3 },
    whatsapp: false,
    whatsappLanguage: null,
    ...over,
  });

  it('names each field changed, never its value; the same answers in another form are the same', () => {
    expect(reapplyChanges(sent(), sent())).toEqual([]);
    expect(reapplyChanges(sent(), sent({ answers: { q1: 'yes', q2: '3' } }))).toEqual([]);
    expect(reapplyChanges(sent(), sent({ mobile: '+201099999999', answers: { q1: 'no', q2: 3 }, expectedSalary: 25000, whatsapp: true, whatsappLanguage: 'ar' }))).toEqual([
      'mobile',
      'expectedSalary',
      'answers',
      'whatsapp',
    ]);
    // a new PDF case study is a portfolio change
    expect(reapplyChanges(sent(), sent({ portfolioFile: true }))).toEqual(['portfolio']);
  });

  it('says a new CV or the same, the match moving, the filter and another source', () => {
    const base = { match: { from: 60, to: 100 }, filter: null, knockedOut: 0, stageLabel: 'Applied', sourceLabel: null } as const;
    expect(reapplyNote({ ...base, newCv: true, changed: ['mobile', 'answers'] })).toBe('New CV. Changed: mobile, answers (match 60% → 100%).');
    expect(reapplyNote({ ...base, newCv: true, changed: [] })).toBe('New CV.');
    expect(reapplyNote({ ...base, newCv: false, changed: [] })).toBe('Same CV. Nothing else changed.');
    expect(reapplyNote({ ...base, newCv: false, changed: ['expectedSalary'], match: { from: 60, to: 60 } })).toBe('Same CV. Changed: expected salary.');
    expect(reapplyNote({ ...base, newCv: true, changed: ['answers'], match: { from: 100, to: 75 }, filter: 'now_filtered', knockedOut: 1 })).toBe(
      'New CV. Changed: answers (match 100% → 75%). Now filtered out: 1 must-have question not met.',
    );
    expect(reapplyNote({ ...base, newCv: true, changed: ['answers'], filter: 'no_longer_filtered' })).toBe('New CV. Changed: answers (match 60% → 100%). No longer filtered out: every must-have question met.');
    expect(reapplyNote({ ...base, newCv: true, changed: ['answers'], match: { from: 100, to: 75 }, filter: 'kept_by_hr', knockedOut: 2, stageLabel: 'Shortlisted' })).toBe(
      'New CV. Changed: answers (match 100% → 75%). 2 must-have questions not met; kept at Shortlisted (HR decides).',
    );
    expect(reapplyNote({ ...base, newCv: true, changed: [], sourceLabel: 'LinkedIn' })).toBe('New CV. Sent from LinkedIn this time.');
    expect(APPLICATION_EVENT_LABELS.updated).toBe('Updated by the candidate');
  });
});

describe('applying again: what HR and the applicant see', () => {
  const NOW = new Date('2026-10-25T12:00:00Z');
  it('the "CV updated" mark for 7 days, never for a time to come', () => {
    expect(CV_UPDATED_MARK_DAYS).toBe(7);
    expect(cvUpdatedMark(null, NOW)).toBe(false);
    expect(cvUpdatedMark('2026-10-25T11:00:00Z', NOW)).toBe(true);
    expect(cvUpdatedMark('2026-10-18T12:00:01Z', NOW)).toBe(true);
    expect(cvUpdatedMark('2026-10-18T12:00:00Z', NOW)).toBe(false);
    expect(cvUpdatedMark('2026-10-26T12:00:00Z', NOW)).toBe(false);
    expect(cvUpdatedMark('not a date', NOW)).toBe(false);
  });

  it('"We’ve updated your application" on WhatsApp, in English and Arabic, with the same reference', () => {
    expect(WHATSAPP_TEMPLATES.application_updated).toMatchObject({ name: 'people_application_updated', audience: 'candidate', group: null });
    expect(WHATSAPP_TEMPLATES.application_updated.body.en).toContain('we’ve updated your application for {{2}} at {{3}}');
    expect(WHATSAPP_TEMPLATES.application_updated.body.ar).toContain('حدّثنا طلبك');
    expect(whatsappContent({ template: 'application_updated', name: 'Sara Ali', job: 'Video Editor', company: 'TrendLIX', reference: 'APP-2026-0042' }, 'en')).toEqual({
      template: 'application_updated',
      body: ['Sara', 'Video Editor', 'TrendLIX', 'APP-2026-0042'],
      button: null,
    });
  });
});
