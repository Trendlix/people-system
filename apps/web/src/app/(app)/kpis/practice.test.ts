import { describe, expect, it } from 'vitest';
import { KPI_NO_PRACTICE_STEPS, kpiPracticeSteps, type KpiPracticeChoice, type KpiPracticeStep, type KpiScorecardSummary, type KpiScorecardView } from '@trendlix/shared';
import { kpiApprovalRows } from '../approvals/kpis';
import { formatDateTime } from '../../../lib/format';
import {
  deletedText,
  discardPracticeText,
  draftPracticeWarning,
  monthChoiceLabel,
  openPracticeSteps,
  personChoiceLabel,
  practiceDoneHref,
  practiceDoneText,
  practiceMode,
  practiceSignAs,
  practiceStep,
  practiceStepHref,
  practiceStepLabel,
  publishPracticeText,
  seesKpiPractice,
  standInText,
  standInTitle,
  START_FIELDS,
  startBody,
  startedSentence,
  startedText,
  templateChoiceLabel,
  unplacedText,
} from './practice';
import { ownCardText, scorecardBack, waitingLine } from './scorecard';

// Practice KPI scorecards as the pages word and read them (owner, 22 October 2026: "Practice scorecards": "Every step
// can be done by me, or through View as"; "It's marked Practice everywhere"). Every person here is invented.

const ID = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
const OMAR = { id: '2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed', employeeCode: 'TLX-0007', fullNameEn: 'Omar Ali' };
const PRACTICE = { startedBy: { email: 'h.magdy@example.test', name: 'Hazem Magdy' }, startedAt: '2026-10-22T14:42:00Z', draft: true };

const card = (status: KpiScorecardView['status'], over: Partial<KpiScorecardView> = {}): Pick<KpiScorecardView, 'id' | 'status' | 'standIn' | 'employee' | 'scorer'> => ({
  id: ID,
  status,
  employee: OMAR,
  scorer: { kind: 'manager', name: 'Mona Adel' },
  standIn: kpiPracticeSteps({ status }),
  ...over,
});

const form = (fields: Record<string, string>) => ({ get: (key: string) => fields[key] ?? null });

const choice: Pick<KpiPracticeChoice, 'employee' | 'months' | 'templates'> = {
  employee: OMAR,
  months: ['2026-10', '2026-09'],
  templates: [
    { id: 't-draft', version: 3, draft: true, inForce: false, metrics: 7 },
    { id: 't-v2', version: 2, draft: false, inForce: true, metrics: 1 },
  ],
};

describe('who has the Practice tab', () => {
  it('is HR and a Super Admin', () => {
    expect(seesKpiPractice({ roles: ['hr'] })).toBe(true);
    expect(seesKpiPractice({ roles: ['super_admin'] })).toBe(true);
    expect(seesKpiPractice({ roles: ['ceo'] })).toBe(true);
    expect(seesKpiPractice({ roles: ['employee', 'manager'] })).toBe(false);
  });
});

describe('the step stood in for', () => {
  it('is the one asked for (?as=) when open, else the first open one, in the flow’s order', () => {
    const atSelf = kpiPracticeSteps({ status: 'self_rating' });
    expect(openPracticeSteps(atSelf)).toEqual(['self_rate', 'score']);
    expect(practiceStep({}, atSelf)).toBe('self_rate');
    expect(practiceStep({ as: 'score' }, atSelf)).toBe('score');
    // not open now, or not a step: the first open one
    expect(practiceStep({ as: 'calibrate' }, atSelf)).toBe('self_rate');
    expect(practiceStep({ as: 'anything' }, atSelf)).toBe('self_rate');
    expect(practiceStep({ as: ['score'] }, atSelf)).toBe('self_rate');
    const atSignOff = kpiPracticeSteps({ status: 'sign_off', employeeSignedAt: '2026-10-22T10:00:00Z' });
    expect(practiceStep({}, atSignOff)).toBe('sign_manager');
  });

  it('is none for someone who doesn’t stand in, or once final', () => {
    expect(practiceStep({ as: 'score' }, null)).toBeNull();
    expect(practiceStep({}, undefined)).toBeNull();
    expect(practiceStep({}, KPI_NO_PRACTICE_STEPS)).toBeNull();
    expect(practiceStep({}, kpiPracticeSteps({ status: 'final' }))).toBeNull();
  });

  it('has its address, its form and the side it signs for', () => {
    expect(practiceStepHref(ID, 'calibrate')).toBe(`/kpis/scorecards/${ID}?as=calibrate`);
    const modes = (['self_rate', 'score', 'calibrate', 'sign_employee', 'sign_manager'] as KpiPracticeStep[]).map((s) => [practiceMode(s), practiceSignAs(s)]);
    expect(modes).toEqual([
      ['self', null],
      ['score', null],
      ['calibrate', null],
      [null, 'employee'],
      [null, 'manager'],
    ]);
  });

  it('words the buttons and whom the caller acts for', () => {
    const v = card('self_rating');
    expect(practiceStepLabel('self_rate', v)).toBe('Rate as Omar (practice)');
    expect(practiceStepLabel('score', v)).toBe('Score as the manager');
    expect(practiceStepLabel('sign_employee', v)).toBe('Sign as Omar');
    expect(practiceStepLabel('score', card('self_rating', { scorer: { kind: 'hr', name: null } }))).toBe('Score as HR');
    expect(standInText('self_rate', v)).toBe('You’re rating as Omar Ali. It is kept as done by you for Omar Ali.');
    expect(standInText('calibrate', v)).toBe('You’re calibrating as HR. It is kept as done by you for HR.');
    expect(standInText('sign_manager', v)).toBe('You’re signing as the manager. It is kept as done by you for the manager.');
    expect(standInTitle('score', 'the manager')).toBe('Scoring as the manager');
  });
});

describe('once a step is done', () => {
  it('says what was done and the next step', () => {
    expect(practiceDoneHref(ID, 'started')).toBe(`/kpis/scorecards/${ID}?done=started`);
    expect(practiceDoneText({ done: 'started' }, card('self_rating'))).toEqual({
      text: 'Practice scorecard started. Nobody is told of it. Next: Rate as Omar (practice) or Score as the manager.',
      tone: 'ok',
    });
    expect(practiceDoneText({ done: 'self_sent' }, card('manager'))?.text).toBe('The self-rating is sent. Next: Score as the manager.');
    expect(practiceDoneText({ done: 'score_sent' }, card('hr'))?.text).toBe('The scoring is sent to HR to calibrate. Next: Calibrate as HR.');
    expect(practiceDoneText({ done: 'calibrated' }, card('sign_off'))?.text).toBe('Calibrated and sent for sign-off. Next: Sign as Omar or Sign as the manager.');
    expect(practiceDoneText({ done: 'signed' }, card('final'))?.text).toBe('Signed. Both have signed. It is final now: the practice run is complete.');
  });

  it('says it moved on in amber, nothing for anything else, and no next step for someone viewing as the person', () => {
    expect(practiceDoneText({ done: 'moved' }, card('hr'))?.tone).toBe('warn');
    expect(practiceDoneText({ done: 'nope' }, card('hr'))).toBeNull();
    expect(practiceDoneText({}, card('hr'))).toBeNull();
    expect(practiceDoneText({ done: 'self_sent' }, card('manager', { standIn: null }))?.text).toBe('The self-rating is sent.');
  });

  it('says how many were deleted', () => {
    expect(deletedText({ deleted: '1' })).toBe('1 practice scorecard deleted.');
    expect(deletedText({ deleted: '4' })).toBe('4 practice scorecards deleted.');
    expect(deletedText({ deleted: '0' })).toBe('There were no practice scorecards to delete.');
    expect(deletedText({ deleted: 'x' })).toBeNull();
    expect(deletedText({})).toBeNull();
  });
});

describe('the start form', () => {
  it('sends whom, which month and which version, the defaults left to the API', () => {
    expect(startBody(form({ [START_FIELDS.employee]: OMAR.id }), [choice])).toEqual({ body: { employeeId: OMAR.id, month: null, templateId: null }, errors: [] });
    expect(startBody(form({ [START_FIELDS.employee]: OMAR.id, [START_FIELDS.month]: '2026-09', [START_FIELDS.template]: 't-draft' }), [choice]).body).toEqual({
      employeeId: OMAR.id,
      month: '2026-09',
      templateId: 't-draft',
    });
  });

  it('refuses someone not offered, a month not theirs, a version not their job title’s', () => {
    expect(startBody(form({}), [choice]).errors).toEqual(['Choose the employee.']);
    expect(startBody(form({ [START_FIELDS.employee]: ID }), [choice]).errors).toEqual(['Choose the employee.']);
    expect(startBody(form({ [START_FIELDS.employee]: OMAR.id, [START_FIELDS.month]: '2026-11', [START_FIELDS.template]: 'other' }), [choice]).errors).toEqual([
      'Choose one of Omar Ali’s months.',
      'Choose one of the job title’s template versions.',
    ]);
  });

  it('offers each choice in words', () => {
    expect(personChoiceLabel({ employee: OMAR, jobTitle: { id: 'j1', titleEn: 'Data Analyst' } })).toBe('Omar Ali · TLX-0007 · Data Analyst');
    expect(monthChoiceLabel('2026-10', '2026-10')).toBe('October 2026 (this month: attendance so far)');
    expect(monthChoiceLabel('2026-09', '2026-10')).toBe('September 2026');
    expect(choice.templates.map(templateChoiceLabel)).toEqual(['Version 3 · Draft · 7 metrics', 'Version 2 · In force · 1 metric']);
  });
});

describe('the list and the page', () => {
  it('says who started it, when and on which version', () => {
    expect(startedText(PRACTICE)).toBe(`Hazem Magdy · ${formatDateTime(PRACTICE.startedAt)}`);
    expect(startedText({ startedBy: null, startedAt: PRACTICE.startedAt })).toBe(`Someone · ${formatDateTime(PRACTICE.startedAt)}`);
    expect(startedSentence(PRACTICE, 3)).toBe(`Started by Hazem Magdy on ${formatDateTime(PRACTICE.startedAt)}, on the draft of version 3.`);
    expect(startedSentence({ ...PRACTICE, draft: false, startedBy: { email: 'hr@example.test', name: null } }, 2)).toBe(
      `Started by hr@example.test on ${formatDateTime(PRACTICE.startedAt)}, on version 2.`,
    );
    expect(unplacedText(0)).toBeNull();
    expect(unplacedText(2)).toBe('2 metrics of the draft are in Unplaced, so left out until placed in a pillar.');
  });

  it('marks a practice one Practice in the lists a Super Admin viewing as the person sees', () => {
    const s = { action: 'self_rate', status: 'self_rating', deadline: '2026-11-03', month: '2026-10' } as const;
    expect(ownCardText({ ...s, practice: PRACTICE })).toBe('Your October 2026 KPI (practice): rate yourself by 03/11/2026');
    expect(ownCardText(s)).toBe('Your October 2026 KPI: rate yourself by 03/11/2026');
    expect(waitingLine({ ...s, action: 'score', status: 'manager', deadline: '2026-11-06', practice: PRACTICE })).toBe('Practice · October 2026 · Score by 06/11/2026');
    const summary = { id: ID, month: '2026-10', employee: OMAR, jobTitle: null, status: 'manager', deadline: null, action: 'score', confidential: false } as unknown as KpiScorecardSummary;
    expect(kpiApprovalRows([{ ...summary, practice: PRACTICE }], { employeeId: null })[0]).toMatchObject({ practice: true });
    expect(kpiApprovalRows([summary], { employeeId: null })[0]).not.toHaveProperty('practice');
  });

  it('goes back to the Practice list for HR and a Super Admin in their own session', () => {
    expect(scorecardBack({ roles: ['super_admin'] }, { employee: OMAR, practice: PRACTICE })).toEqual({ href: '/kpis/all/practice', label: 'Practice scorecards' });
    // viewing as the employee: their own page's way back
    expect(scorecardBack({ roles: ['employee'], employeeId: OMAR.id, viewAs: { act: false } }, { employee: OMAR, practice: PRACTICE })).toEqual({ href: '/kpis', label: 'My KPIs' });
    expect(scorecardBack({ roles: ['hr'] }, { employee: OMAR })).toEqual({ href: '/kpis/all', label: 'All KPIs' });
  });
});

describe('the draft editor', () => {
  it('warns of the practice scorecards on a draft, and says what Discard and Publish do to them', () => {
    expect(draftPracticeWarning(0)).toBeNull();
    expect(draftPracticeWarning(2)).toBe('2 practice scorecards use this draft; saving a change starts them again from the self-rating.');
    expect(draftPracticeWarning(1)).toBe('1 practice scorecard uses this draft; saving a change starts it again from the self-rating.');
    expect(discardPracticeText(0)).toBe('');
    expect(discardPracticeText(2)).toBe(' Its 2 practice scorecards are deleted too.');
    expect(publishPracticeText(1)).toBe(' Its 1 practice scorecard carries on, on the published version.');
    expect(publishPracticeText(0)).toBe('');
  });
});
