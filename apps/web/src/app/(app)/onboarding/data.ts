import 'server-only';
import type { ClearanceDefaultView, OnboardingSummary, OnboardingView } from '@trendlix/shared';
import { loadJson, type Loaded } from '../payroll/load';
import type { OnboardingFilter } from './onboarding';

// Reading onboarding (owner, 22 October 2026, the ATS's Phase 2): the checklists, a checklist, a person's latest for their
// profile, and the default items. An API from before them answers 404: "not available yet".

export type { Loaded };

export const loadOnboardingList = (filter: OnboardingFilter): Promise<Loaded<OnboardingSummary[]>> => loadJson(`/onboarding?status=${filter}`);

export const loadOnboarding = (id: string): Promise<Loaded<OnboardingView>> => loadJson(`/onboarding/${encodeURIComponent(id)}`);

/** { checklist }: a person's latest, for HR, the CEO and a Super Admin. */
export const loadEmployeeOnboarding = (employeeId: string): Promise<Loaded<{ checklist: OnboardingSummary | null }>> => loadJson(`/onboarding/employees/${encodeURIComponent(employeeId)}`);

export const loadOnboardingDefaults = (): Promise<Loaded<ClearanceDefaultView[]>> => loadJson('/onboarding/checklist');

/** What a page says in place of what it couldn't load. */
export function onboardingNotLoaded(loaded: Exclude<Loaded<unknown>, { kind: 'ok' }>, what: string): string {
  if (loaded.kind === 'unavailable') return `Not found, or not available yet: the server may not have the ${what} yet.`;
  if (loaded.kind === 'forbidden') return 'Only HR, the CEO and a Super Admin handle onboarding.';
  return `The ${what} could not be loaded. ${loaded.messages.join(' ')}`;
}
