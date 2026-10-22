import 'server-only';
import { cache } from 'react';
import type {
  ClearanceDefaultView,
  FormerEmployeeRow,
  MyExitInterviewView,
  OffboardingCaseSummary,
  OffboardingCaseView,
  RehireMatch,
  TurnoverReport,
} from '@trendlix/shared';
import { loadJson, type Loaded } from '../payroll/load';
import { formerApiPath, type CasesFilter, type FormerQuery } from './offboarding';

// Reading offboarding (owner, 22 October 2026: the full module): the cases (each caller's as the API allows), a case,
// a person's latest case for their profile, the default checklist, Former Employees, the turnover, the caller's own exit
// interview and the rehire warning. An API from before them answers 404: "not available yet".

export type { Loaded };

export const loadCases = (filter: CasesFilter): Promise<Loaded<OffboardingCaseSummary[]>> => loadJson(`/offboarding/cases?status=${filter}`);

export const loadCase = (id: string): Promise<Loaded<OffboardingCaseView>> => loadJson(`/offboarding/cases/${encodeURIComponent(id)}`);

/** { case }: a person's latest case, for HR, the CEO and a Super Admin. */
export const loadEmployeeCase = (employeeId: string): Promise<Loaded<{ case: OffboardingCaseSummary | null }>> => loadJson(`/offboarding/employees/${encodeURIComponent(employeeId)}`);

export const loadChecklist = (): Promise<Loaded<ClearanceDefaultView[]>> => loadJson('/offboarding/checklist');

export const loadFormer = (q: FormerQuery): Promise<Loaded<FormerEmployeeRow[]>> => loadJson(formerApiPath(q));

export const loadTurnover = (year: number): Promise<Loaded<TurnoverReport>> => loadJson(`/offboarding/turnover?year=${year}`);

/** { interview }: the caller's own exit interview while their case is open (null without one). Read once a request. */
export const loadMyExitInterview = cache((): Promise<Loaded<{ interview: MyExitInterviewView | null }>> => loadJson('/offboarding/my/exit-interview'));

/** The former employees an offer or a new employment may be for. */
export function loadRehireMatches(q: { employeeId?: string | null; email?: string | null }): Promise<Loaded<RehireMatch[]>> {
  const params = new URLSearchParams();
  if (q.employeeId) params.set('employeeId', q.employeeId);
  if (q.email) params.set('email', q.email);
  return loadJson(`/offboarding/rehire-check?${params.toString()}`);
}

/** What a page says in place of what it couldn't load. */
export function offboardingNotLoaded(loaded: Exclude<Loaded<unknown>, { kind: 'ok' }>, what: string): string {
  if (loaded.kind === 'unavailable') return `Not available yet: the server doesn't have the ${what} yet. Please try again after its next update.`;
  if (loaded.kind === 'forbidden') return 'Only HR, the CEO and a Super Admin see this.';
  return `The ${what} could not be loaded. ${loaded.messages.join(' ')}`;
}
