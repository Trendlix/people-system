import 'server-only';
import type { ApplicationListItem, ApplicationView, VacancyListItem, VacancyView } from '@trendlix/shared';
import { loadJson, type Loaded } from '../payroll/load';
import { applicantsApiPath, vacanciesApiPath, type ApplicantsQuery, type VacancyFilter } from './recruitment';

// Reading recruitment (owner, 22 October 2026: "where will we include the ATS?"): the vacancies, a vacancy, the
// applicants (a vacancy's or all) and an applicant, as the API allows the caller. An API from before them answers 404:
// "not available yet".

export type { Loaded };

export const loadVacancies = (f: { status: VacancyFilter; q: string }): Promise<Loaded<VacancyListItem[]>> => loadJson(vacanciesApiPath(f));

export const loadVacancy = (id: string): Promise<Loaded<VacancyView>> => loadJson(`/recruitment/vacancies/${encodeURIComponent(id)}`);

export const loadApplicants = (q: Partial<ApplicantsQuery>): Promise<Loaded<ApplicationListItem[]>> => loadJson(applicantsApiPath(q));

export const loadApplicant = (id: string): Promise<Loaded<ApplicationView>> => loadJson(`/recruitment/applications/${encodeURIComponent(id)}`);

/** What a page says in place of what it couldn't load. */
export function recruitmentNotLoaded(loaded: Exclude<Loaded<unknown>, { kind: 'ok' }>, what: string): string {
  if (loaded.kind === 'unavailable') return `Not found, or not available yet: the server may not have the ${what} yet.`;
  if (loaded.kind === 'forbidden') return 'Only HR, the CEO and a Super Admin see recruitment.';
  return `The ${what} could not be loaded. ${loaded.messages.join(' ')}`;
}
