import Link from 'next/link';
import { isHidden } from '@/lib/hidden';
import { todayInCairo } from '@/lib/date-picker';
import { SetupSection } from '../payroll/section';
import { profileHref } from '../../employees/tab-list';
import { loadExemptions, loadLinkable } from './data';
import { addExemptions, endExemption } from './exemption-actions';
import { AddExemptions, EndExemptionButton } from './exemption-form';
import { EXEMPTIONS_ID, EXEMPTIONS_INTRO, exemptionCandidates, exemptionRowText, periodByText, stateBadge } from './exemptions';

// Organization → Check-in Setup → Exempt From Check-in (owner, 25 October 2026: "allow me to select people that are not
// eligable for attendance checkins and outs, trat them as if they achived their full working hours"; asked, "Optional
// check-in" and "Profile + a list in Check-in Setup"): the people exempt now or from a day to come, by name, each with
// their team, why, from and until, and where it stands; "Add people" exempts several at once with one reason and one
// from–until, and "End now" ends one today (one not started is removed). Each person's earlier periods are on their
// profile. HR and Admin (a Super Admin as an Admin); a C-level person's only the CEO or a Super Admin (the API lists
// them only to those who see them, and says per row who may end it).

export async function ExemptionsSection() {
  const [loaded, linkable] = await Promise.all([loadExemptions(), loadLinkable()]);
  const today = todayInCairo();
  return (
    <SetupSection id={EXEMPTIONS_ID} title="Exempt From Check-in" intro={EXEMPTIONS_INTRO}>
      {loaded.kind === 'unavailable' ? (
        <p className="rounded-lg bg-line-soft px-4 py-3 text-sm text-muted">Not available yet: the server does not have exemptions from check-in yet.</p>
      ) : loaded.kind === 'forbidden' ? (
        <p className="rounded-lg bg-line-soft px-4 py-3 text-sm text-muted">Only HR and Admin keep who is exempt from check-in.</p>
      ) : loaded.kind === 'failed' ? (
        <p className="rounded-lg bg-line-soft px-4 py-3 text-sm text-muted">The exemptions could not be loaded. {loaded.messages.join(' ')}</p>
      ) : (
        <div className="space-y-4">
          {loaded.value.canAdd && linkable.kind === 'ok' && (
            <AddExemptions action={addExemptions} options={exemptionCandidates(linkable.value, loaded.value.exemptions)} today={today} />
          )}
          {loaded.value.exemptions.length === 0 ? (
            <p className="text-sm text-muted">No one is exempt from check-in. Add people here, or switch it on from a person&apos;s profile.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <caption className="sr-only">People exempt from check-in, now or from a day to come</caption>
                <thead>
                  <tr className="border-b border-line text-left text-xs font-semibold tracking-wide text-muted uppercase">
                    <th scope="col" className="py-2 pe-3">
                      Name
                    </th>
                    <th scope="col" className="py-2 pe-3">
                      Team
                    </th>
                    <th scope="col" className="py-2 pe-3">
                      Reason
                    </th>
                    <th scope="col" className="py-2 pe-3">
                      From
                    </th>
                    <th scope="col" className="py-2 pe-3">
                      Until
                    </th>
                    <th scope="col" className="py-2">
                      <span className="sr-only">Where it stands, and End now</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {loaded.value.exemptions.map((e) => {
                    const row = exemptionRowText(e);
                    const badge = stateBadge(e.state);
                    return (
                      <tr key={e.id} className="align-top">
                        <td className="py-3 pe-3">
                          <Link href={profileHref(e.employee.id, 'employment')} className="font-semibold">
                            {row.person}
                          </Link>
                          <p className="text-xs text-muted">{periodByText(e)}</p>
                        </td>
                        <td className="py-3 pe-3 text-muted">{row.team ?? '—'}</td>
                        <td className="max-w-xs py-3 pe-3 break-words">{isHidden(e.reason) ? <span className="text-muted">{e.reason}</span> : e.reason}</td>
                        <td className="py-3 pe-3 tabular-nums whitespace-nowrap">{row.from}</td>
                        <td className="py-3 pe-3 tabular-nums whitespace-nowrap">{row.until}</td>
                        <td className="py-3">
                          <div className="flex flex-col items-end gap-2">
                            <span className={`badge ${badge.tone}`}>{badge.label}</span>
                            {e.canEnd && <EndExemptionButton end={endExemption.bind(null, e.id, e.employee.fullNameEn)} name={e.employee.fullNameEn} period={e} today={today} />}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </SetupSection>
  );
}
