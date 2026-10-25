import { describe, expect, it } from 'vitest';
import { HIDDEN, type ApplicationDeletion, type VacancyDeletion } from '@trendlix/shared';
import { applicationDeleteText, confirmLabel, deletedText, vacancyDeletable, vacancyDeletePath, vacancyDeleteText, vacancyRefusalLead } from './deletes';

// Deleting an applicant, or a vacancy people applied to (owner, 25 October 2026: "i want to delete this"; asked, "Vacancy
// alone - applicant alone - superadmin only"): what the confirmation windows say. Every name and number is invented.

const application = (extra: Partial<ApplicationDeletion> = {}): ApplicationDeletion => ({
  id: 'a1',
  number: 'APP-2026-0001',
  vacancy: { id: 'v1', number: 'VAC-2026-0001', title: 'Account Manager' },
  refusal: null,
  interviews: 1,
  comments: 2,
  files: 1,
  draftOffers: 0,
  candidate: { id: 'c1', code: 'CAN-0001', goes: false },
  ...extra,
});

const vacancy = (extra: Partial<VacancyDeletion> = {}): VacancyDeletion => ({
  id: 'v1',
  number: 'VAC-2026-0001',
  title: 'Account Manager',
  status: 'closed',
  applications: 1,
  refusals: [],
  candidates: 0,
  confirm: true,
  ...extra,
});

describe('the applicant’s confirmation', () => {
  it('says their candidate profile stays when they have other records', () => {
    expect(applicationDeleteText(application())).toBe('This deletes APP-2026-0001, its interviews, comments and files. Their candidate profile stays, as they have other records.');
  });

  it('says their candidate profile goes too when nothing else is left of them', () => {
    expect(applicationDeleteText(application({ candidate: { id: 'c1', code: 'CAN-0001', goes: true } }))).toBe(
      'This deletes APP-2026-0001, its interviews, comments and files, and their candidate profile (CAN-0001).',
    );
  });

  it('names the job offers drafted and never sent, and says nothing of a profile they don’t have', () => {
    expect(applicationDeleteText(application({ candidate: null, draftOffers: 1 }))).toBe('This deletes APP-2026-0001, its interviews, comments, files and draft job offer.');
    expect(applicationDeleteText(application({ candidate: null, draftOffers: 2 }))).toBe('This deletes APP-2026-0001, its interviews, comments, files and draft job offers.');
  });

  it('never shows a hidden number', () => {
    expect(applicationDeleteText(application({ number: HIDDEN, candidate: { id: 'c1', code: HIDDEN, goes: true } }))).toBe(
      'This deletes this application, its interviews, comments and files, and their candidate profile.',
    );
    expect(deletedText('APP-2026-0001')).toBe('APP-2026-0001 was deleted.');
    expect(deletedText(HIDDEN)).toBe('It was deleted.');
  });
});

describe('the vacancy’s confirmation', () => {
  it('says nobody applied to one without applications', () => {
    expect(vacancyDeleteText(vacancy({ applications: 0, confirm: false }))).toBe('This deletes VAC-2026-0001. Nobody has applied.');
  });

  it('counts the applications that go with it, and the candidate profiles nothing else is left of', () => {
    expect(vacancyDeleteText(vacancy())).toBe('This deletes VAC-2026-0001 and its application, with its interviews, comments and files. Their candidate profile stays, as they have other records.');
    expect(vacancyDeleteText(vacancy({ candidates: 1 }))).toBe('This deletes VAC-2026-0001 and its application, with its interviews, comments and files. Their candidate profile goes too, as nothing else is left of it.');
    expect(vacancyDeleteText(vacancy({ applications: 3 }))).toBe('This deletes VAC-2026-0001 and its 3 applications, with their interviews, comments and files. Their candidate profiles stay, as they have other records.');
    expect(vacancyDeleteText(vacancy({ applications: 3, candidates: 3 }))).toBe('This deletes VAC-2026-0001 and its 3 applications, with their interviews, comments and files. Their candidate profiles go too, as nothing else is left of them.');
    expect(vacancyDeleteText(vacancy({ applications: 3, candidates: 1 }))).toBe(
      'This deletes VAC-2026-0001 and its 3 applications, with their interviews, comments and files. One of their candidate profiles goes too, as nothing else is left of it; the others stay.',
    );
    expect(vacancyDeleteText(vacancy({ applications: 3, candidates: 2 }))).toBe(
      'This deletes VAC-2026-0001 and its 3 applications, with their interviews, comments and files. 2 of their candidate profiles go too, as nothing else is left of them; the others stay.',
    );
  });

  it('leads the applications that stay on record', () => {
    expect(vacancyRefusalLead(1)).toBe('One application stays on record, so the vacancy stays:');
    expect(vacancyRefusalLead(2)).toBe('2 applications stay on record, so the vacancy stays:');
  });

  it('asks for its number, typed in any case, before Delete can be pressed', () => {
    expect(confirmLabel('VAC-2026-0001')).toBe('Type VAC-2026-0001 to confirm');
    expect(vacancyDeletable(vacancy(), '')).toBe(false);
    expect(vacancyDeletable(vacancy(), 'VAC-2026-0002')).toBe(false);
    expect(vacancyDeletable(vacancy(), ' vac-2026-0001 ')).toBe(true);
    // nobody applied: nothing to type
    expect(vacancyDeletable(vacancy({ applications: 0, confirm: false }), '')).toBe(true);
    // an application stays on record: never, whatever is typed
    expect(vacancyDeletable(vacancy({ refusals: ['APP-2026-0005: an offer was sent (OFF-2026-0002)'] }), 'VAC-2026-0001')).toBe(false);
  });

  it('sends the number typed as ?confirm=, and nothing when none is needed', () => {
    expect(vacancyDeletePath('v1', ' VAC-2026-0001 ')).toBe('/recruitment/vacancies/v1?confirm=VAC-2026-0001');
    expect(vacancyDeletePath('v1', null)).toBe('/recruitment/vacancies/v1');
    expect(vacancyDeletePath('v1', '  ')).toBe('/recruitment/vacancies/v1');
  });
});
