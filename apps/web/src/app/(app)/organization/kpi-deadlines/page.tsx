import { KPI_SETTING_LABELS, type KpiSettingsView } from '@trendlix/shared';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { KPI_API } from '@/lib/kpi-paths';
import { getCurrentUser } from '@/lib/session';
import type { SessionUser } from '@/lib/types';
import { updateKpiSettings } from '../../kpis/templates/actions';
import { loadKpi } from '../../kpis/templates/data';
import { KpiSettingsForm } from '../../kpis/templates/settings-form';
import { buildsKpiTemplates, readsKpiTemplates, SETTING_KEYS, settingsChangedText } from '../../kpis/templates/templates';
import { NotLoaded, SettingRow } from '../payroll/section';
import { dayOfMonth } from '../payroll/settings';
import { Empty, Loading } from '../ui';

// KPI Deadlines (owner, 23 October 2026: "Check-in Setup, KPI Pillars and deadlines, Recruitment and checklists,
// Templates"), in the setup menu's Performance: the day of the month each step of a month's scorecards is due by, the
// KPI settings section of KPI Templates until then (owner's brief, 21 October 2026: "Deadlines in a small KPI settings
// section, defaults: self-rating by the 3rd, manager by the 6th, HR by the 8th of the next month"; the sign-off by the
// 10th), as it was: HR and the Super Admin change them, the CEO and an Admin, whom the API answers too, read them. The
// API checks every request again.

export const metadata: Metadata = { title: 'KPI Deadlines · People System' };

async function KpiDeadlines({ user }: { user: SessionUser }) {
  const loaded = await loadKpi<KpiSettingsView>(KPI_API.settings);
  const changed = loaded.kind === 'ok' ? settingsChangedText(loaded.value) : null;
  return (
    <section aria-labelledby="kpi-deadlines-heading" className="card p-6">
      <h2 id="kpi-deadlines-heading" className="text-lg font-semibold">
        Monthly Deadlines
      </h2>
      <div className="mt-5">
        {loaded.kind !== 'ok' ? (
          <NotLoaded what="the KPI deadlines" loaded={loaded} />
        ) : buildsKpiTemplates(user) ? (
          <KpiSettingsForm action={updateKpiSettings} settings={loaded.value} />
        ) : (
          <dl>
            {SETTING_KEYS.map((k) => (
              <SettingRow key={k} label={KPI_SETTING_LABELS[k]}>
                {dayOfMonth(loaded.value[k])} of the next month
              </SettingRow>
            ))}
          </dl>
        )}
        {changed && <p className="mt-4 text-xs text-muted">{changed}</p>}
      </div>
    </section>
  );
}

async function Gate() {
  const user = await getCurrentUser();
  if (!readsKpiTemplates(user)) return <Empty>Only HR and the Super Admin set the KPI deadlines.</Empty>;
  return (
    <Suspense fallback={<Loading />}>
      <KpiDeadlines user={user} />
    </Suspense>
  );
}

export default function KpiDeadlinesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Gate />
    </Suspense>
  );
}
