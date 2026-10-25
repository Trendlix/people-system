import { EXEMPT_BADGE } from '@trendlix/shared';
import { todayInCairo } from '@/lib/date-picker';
import type { EmployeeExemptionsView } from '@/lib/exemption-types';
import { isHidden } from '@/lib/hidden';
import type { EmployeeProfile, SessionUser } from '@/lib/types';
import { loadJson } from '../../payroll/load';
import { addExemptions, endExemption } from '../../organization/check-in-setup/exemption-actions';
import { EndExemptionButton, ExemptionSwitch } from '../../organization/check-in-setup/exemption-form';
import { periodByText, periodText, seesExemptions, splitPeriods, stateBadge } from '../../organization/check-in-setup/exemptions';
import { ProfileSection } from '../ui';

// Exempt From Check-in on a person's profile (owner, 25 October 2026: "allow me to select people that are not eligable for
// attendance checkins and outs, trat them as if they achived their full working hours"; asked, "Optional check-in" and
// "Profile + a list in Check-in Setup"), on the Employment tab under their attendance details: the period current or to
// come (an Exempt badge, from–until, why, who added it) with End now, and the earlier periods; for those who manage it,
// the switch "Exempt from check-in" (on: the reason, from today unless changed, until a day or no end). HR, Admin (a Super
// Admin as an Admin), the CEO and the person themself read it; HR, Admin and the Super Admin manage it, a C-level
// person's only the CEO or a Super Admin (the API says which: canManage, canEnd; it answers 404 to those who may not see
// a C-level person). Nothing for anyone else, nor for someone never exempt whom the caller can't exempt.

export async function CheckInExemptionSection({ employee, user }: { employee: Pick<EmployeeProfile, 'id' | 'fullNameEn'>; user: SessionUser }) {
  if (!seesExemptions(user, employee.id)) return null;
  const loaded = await loadJson<EmployeeExemptionsView>(`/employees/${encodeURIComponent(employee.id)}/check-in-exemptions`);
  if (loaded.kind !== 'ok') return null;
  const { periods, canManage } = loaded.value;
  if (!periods.length && !canManage) return null;
  const today = todayInCairo();
  const { active, ended } = splitPeriods(periods);
  const on = active[0] ?? null;
  const name = employee.fullNameEn;
  return (
    <ProfileSection title="Exempt From Check-in" note={on ? periodText(on) : undefined}>
      <div className="space-y-4">
        {active.length > 0 && (
          <ul className="space-y-3" aria-label={`${name}’s exemptions from check-in, current and to come`}>
            {active.map((p) => {
              const badge = stateBadge(p.state);
              return (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-white p-4">
                  <div className="min-w-0 space-y-1 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="badge bg-ok-soft text-ok">{EXEMPT_BADGE}</span>
                      <span className={`badge ${badge.tone}`}>{badge.label}</span>
                      <span className="font-medium tabular-nums">{periodText(p)}</span>
                    </p>
                    <p className={`break-words ${isHidden(p.reason) ? 'text-muted' : ''}`}>{p.reason}</p>
                    <p className="text-xs text-muted">{periodByText(p)}</p>
                  </div>
                  {/* the first is ended by the switch below when they manage it */}
                  {p.canEnd && !(canManage && p.id === on?.id) && <EndExemptionButton end={endExemption.bind(null, p.id, name)} name={name} period={p} today={today} />}
                </li>
              );
            })}
          </ul>
        )}
        {canManage ? (
          <ExemptionSwitch
            add={addExemptions}
            end={on?.canEnd ? endExemption.bind(null, on.id, name) : null}
            active={on && { startDate: on.startDate, endDate: on.endDate }}
            employeeId={employee.id}
            name={name}
            today={today}
          />
        ) : (
          active.length === 0 && <p className="text-sm text-muted">Not exempt from check-in now: their working days count from their check-ins.</p>
        )}
        {ended.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Earlier periods ({ended.length})</summary>
            <ul className="mt-2 space-y-2">
              {ended.map((p) => (
                <li key={p.id} className="space-y-0.5">
                  <p className="tabular-nums">{periodText(p)}</p>
                  <p className="break-words text-muted">{p.reason}</p>
                  <p className="text-xs text-muted">{periodByText(p)}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </ProfileSection>
  );
}
