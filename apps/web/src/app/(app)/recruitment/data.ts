import 'server-only';
import type {
  ApplicantsSummary,
  ApplicationListItem,
  ApplicationView,
  CvBatchTarget,
  CvTextView,
  CvUploadView,
  GeneralCvListItem,
  GeneralCvView,
  InterviewView,
  MyHiring,
  PublicGeneralForm,
  RecruitmentAnalytics,
  RecruitmentSettingsView,
  VacancyBoard,
  VacancyListItem,
  VacancyView,
} from '@trendlix/shared';
import { publicGet } from '@/lib/public-api';
import { loadJson, type Loaded } from '../payroll/load';
import { generalApiPath, uploadsApiPath, type GeneralQuery } from './general';
import { applicantCvTextApiPath, generalCvTextApiPath } from './cv-reading';
import { analyticsSearch, type AnalyticsQuery } from './hiring';
import { applicantsApiPath, vacanciesApiPath, type ApplicantsQuery, type VacancyFilter } from './recruitment';

// Reading recruitment (owner, 22 October 2026: "where will we include the ATS?"): the vacancies, a vacancy, the
// applicants (a vacancy's or all) and an applicant, as the API allows the caller. An API from before them answers 404:
// "not available yet".

export type { Loaded };

export const loadVacancies = (f: { status: VacancyFilter; q: string }): Promise<Loaded<VacancyListItem[]>> => loadJson(vacanciesApiPath(f));

export const loadVacancy = (id: string): Promise<Loaded<VacancyView>> => loadJson(`/recruitment/vacancies/${encodeURIComponent(id)}`);

export const loadApplicants = (q: Partial<ApplicantsQuery>): Promise<Loaded<ApplicationListItem[]>> => loadJson(applicantsApiPath(q));

export const loadApplicant = (id: string): Promise<Loaded<ApplicationView>> => loadJson(`/recruitment/applications/${encodeURIComponent(id)}`);

// Phase 2 (22 October 2026): a vacancy's pipeline board, the interviews to come, My Hiring, the settings, the analytics.

export const loadBoard = (vacancyId: string): Promise<Loaded<VacancyBoard>> => loadJson(`/recruitment/vacancies/${encodeURIComponent(vacancyId)}/board`);

export const loadUpcomingInterviews = (): Promise<Loaded<InterviewView[]>> => loadJson('/recruitment/interviews');

export const loadMyHiring = (): Promise<Loaded<MyHiring>> => loadJson('/recruitment/my-hiring');

export const loadRecruitmentSettings = (): Promise<Loaded<RecruitmentSettingsView>> => loadJson('/recruitment/settings');

export const loadAnalytics = (q: AnalyticsQuery): Promise<Loaded<RecruitmentAnalytics>> => loadJson(`/recruitment/analytics${analyticsSearch(q)}`);

// General CVs, the Applicants page's summary and the bulk upload (22 October 2026).

export const loadApplicantsSummary = (): Promise<Loaded<ApplicantsSummary>> => loadJson('/recruitment/applicants/summary');

export const loadGeneralCvs = (q: Partial<GeneralQuery>): Promise<Loaded<GeneralCvListItem[]>> => loadJson(generalApiPath(q));

export const loadGeneralCv = (id: string): Promise<Loaded<GeneralCvView>> => loadJson(`/recruitment/general-cvs/${encodeURIComponent(id)}`);

export const loadCvUploads = (target: CvBatchTarget): Promise<Loaded<CvUploadView[]>> => loadJson(uploadsApiPath(target));

/**
 * The areas a general CV can name, the careers page's form's (teams, and departments without teams), each named as HR's
 * lists name it, "Video · Production" (the careers page shows "Video" alone: owner, 22 October 2026, "remove the
 * department from the dropdown menu"); none when unavailable.
 */
export async function loadGeneralAreas(): Promise<{ id: string; name: string }[]> {
  const form = await publicGet<PublicGeneralForm>('/general-cvs/form');
  return form.ok ? form.data.areas.map((a) => ({ id: a.id, name: a.hrName ?? a.name })) : [];
}

// A CV's text and the contacts found in it (22 October 2026: "make the OCR egine reads the CV and analyse it"): refused to
// a developer (403); 404 until it has been read.

export const loadApplicantCvText = (id: string): Promise<Loaded<CvTextView>> => loadJson(applicantCvTextApiPath(id));

export const loadGeneralCvText = (id: string): Promise<Loaded<CvTextView>> => loadJson(generalCvTextApiPath(id));

/** What a page says in place of what it couldn't load. */
export function recruitmentNotLoaded(loaded: Exclude<Loaded<unknown>, { kind: 'ok' }>, what: string): string {
  if (loaded.kind === 'unavailable') return `Not found, or not available yet: the server may not have the ${what} yet.`;
  if (loaded.kind === 'forbidden') return 'Only HR, the CEO and a Super Admin see recruitment.';
  return `The ${what} could not be loaded. ${loaded.messages.join(' ')}`;
}
