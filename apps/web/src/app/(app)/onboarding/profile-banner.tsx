import Link from 'next/link';
import { ONBOARDING_STATUS_LABELS } from '@trendlix/shared';
import type { EmployeeProfile } from '@/lib/types';
import { getCurrentUser } from '@/lib/session';
import { todayInCairo } from '../employees/ui';
import { progressText } from '../offboarding/offboarding';
import { ActionButton } from '../recruitment/forms';
import { openOnboarding } from './actions';
import { loadEmployeeOnboarding } from './data';
import { managesOnboarding, offersOnboarding, onboardingHref, STATUS_STYLE } from './onboarding';

// A person's onboarding on their profile (owner, 22 October 2026, the ATS's Phase 2), for HR, the CEO and a Super Admin:
// their latest checklist (in progress, how far, or completed) with a link to it; for someone who joined in the last 90
// days (or joins later) without one, Start onboarding. Nothing for anyone else.

export async function OnboardingBanner({ profile: p }: { profile: EmployeeProfile }) {
  const user = await getCurrentUser();
  if (!managesOnboarding(user)) return null;
  const loaded = await loadEmployeeOnboarding(p.id);
  if (loaded.kind !== 'ok') return null;
  const found = loaded.value.checklist;
  if (found && (found.status === 'open' || found.employmentId === p.employment?.id)) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-card px-4 py-3 text-sm">
        <p>
          <span className="font-semibold">Onboarding</span> <span className={`badge ml-1 ${STATUS_STYLE[found.status]}`}>{ONBOARDING_STATUS_LABELS[found.status]}</span>
          <span className="ml-2 text-muted">{progressText(found.progress)}</span>
        </p>
        <Link href={onboardingHref(found.id)} className="font-semibold">
          Open the checklist
        </Link>
      </div>
    );
  }
  const employment = p.employment;
  if (!employment || !offersOnboarding(employment, todayInCairo())) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-card px-4 py-3 text-sm">
      <p className="text-muted">New here, with no onboarding checklist.</p>
      <ActionButton action={openOnboarding.bind(null, employment.id)} label="Start onboarding" pendingLabel="Opening…" />
    </div>
  );
}
