import Link from 'next/link';
import { OFFBOARDING_STATUS_LABELS } from '@trendlix/shared';
import type { EmployeeProfile } from '@/lib/types';
import { getCurrentUser } from '@/lib/session';
import { openCase } from './actions';
import { loadEmployeeCase } from './data';
import { OpenCaseButton } from './forms';
import { caseHref, managesOffboarding, progressText, STATUS_STYLE } from './offboarding';

// A person's offboarding on their profile (owner, 22 October 2026: the full module), for HR, the CEO and a Super Admin:
// their latest case (in clearance, how far, or completed) with a link to it; for someone who left (or is in their notice
// period) without one, Open an offboarding case. Nothing for anyone else, nor for someone neither leaving nor gone.

export async function OffboardingBanner({ profile: p }: { profile: EmployeeProfile }) {
  const user = await getCurrentUser();
  if (!managesOffboarding(user)) return null;
  const leaving = p.employment?.status === 'notice_period';
  const left = !p.employment && p.employments.some((e) => e.endDate);
  const loaded = await loadEmployeeCase(p.id);
  const found = loaded.kind === 'ok' ? loaded.value.case : null;
  if (found && found.status !== 'cancelled') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-card px-4 py-3 text-sm">
        <p>
          <span className="font-semibold">Offboarding</span> <span className={`badge ml-1 ${STATUS_STYLE[found.status]}`}>{OFFBOARDING_STATUS_LABELS[found.status]}</span>
          <span className="ml-2 text-muted">{progressText(found.progress)}</span>
        </p>
        <Link href={caseHref(found.id)} className="font-semibold">
          Open the case
        </Link>
      </div>
    );
  }
  if (loaded.kind !== 'ok' || !(leaving || left)) return null;
  const employmentId = p.employment?.id ?? p.employments.find((e) => e.endDate)?.id;
  if (!employmentId) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-card px-4 py-3 text-sm">
      <p className="text-muted">{leaving ? 'In their notice period, with no offboarding case.' : 'Left, with no offboarding case.'}</p>
      <OpenCaseButton action={openCase.bind(null, employmentId)} />
    </div>
  );
}
