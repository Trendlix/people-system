import type { OnboardingStatus, Role } from '@trendlix/shared';

// Onboarding on the site (owner, 22 October 2026, the ATS's Phase 2; the original plan's spec §12: "onboarding checklist
// (incl. ID & documents, JD sign-off, KPI template assignment)"): the addresses, who handles it, the list's filter and
// when a profile offers to start one. Pure code (relative imports), tested in onboarding.test.ts; the API checks
// everything again.

export const ONBOARDING_PATH = '/onboarding';
export const ONBOARDING_CHECKLIST_PATH = '/onboarding/checklist';
export const onboardingHref = (id: string) => `${ONBOARDING_PATH}/${encodeURIComponent(id)}`;

type WithRoles = { roles: readonly Role[] };

/** Those who handle the checklists: HR, the CEO and a Super Admin (as offboarding's cases). */
export const managesOnboarding = (user: WithRoles): boolean => user.roles.some((r) => r === 'hr' || r === 'ceo' || r === 'super_admin');

export type OnboardingFilter = OnboardingStatus | 'all';

export const ONBOARDING_FILTERS: readonly { value: OnboardingFilter; label: string }[] = [
  { value: 'open', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
];

export function readOnboardingFilter(query: Record<string, string | string[] | undefined>): OnboardingFilter {
  const v = Array.isArray(query.status) ? query.status[0] : query.status;
  return v === 'completed' || v === 'all' ? v : 'open';
}

export const onboardingListHref = (filter: OnboardingFilter) => (filter === 'open' ? ONBOARDING_PATH : `${ONBOARDING_PATH}?status=${filter}`);

export const STATUS_STYLE: Record<OnboardingStatus, string> = { open: 'bg-accent-soft text-accent', completed: 'bg-ok-soft text-ok' };

/**
 * Whether a profile offers "Start onboarding": a current employment that joined in the last 90 days or joins later
 * (someone hired without the ATS), with no checklist yet. Older employments are left alone.
 */
export function offersOnboarding(employment: { joinDate: string; endDate?: string | null } | null | undefined, today: string): boolean {
  if (!employment || employment.endDate) return false;
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
  return employment.joinDate >= since;
}
