import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { cairoDay } from '@trendlix/shared';
import { PageHead, Pill } from '@/components/design';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../organization/ui';
import { kpiNotLoaded, loadKpiSettings, loadMyScorecards } from './data';
import { latestShown, nextCycleText } from './mine';
import { History, HowItWorks, LatestScoreHero, NoScorecardsHero, PayrollImpact, PendingScoreHero, WaitingForYou } from './mine-ui';

// My KPIs (owner's brief, 21 October 2026: "My KPIs: this month's scorecard to self-rate, and the history with level and
// final % by month"): the caller's own scorecards waiting for them (to rate themself, or to sign), each with the way in,
// and every month's scorecard, newest first, with its final % and level once they are shown to the employee (from the
// sign-off: until then a dash and the step it is at). Each opens the scorecard's page. A month's scorecard opens on the
// 1st of the next month (owner, 21 October 2026: "Last month's KPI, this pay"). Someone without an employee profile has
// none. A practice scorecard (owner, 22 October 2026: "Practice scorecards") shows here only to a Super Admin viewing as
// the person, marked Practice.
// In the owner's design since 30 October 2026 (Figma "PeopleTrendlix", the desktop version; mine-ui.tsx): the head with
// the day the next scorecards open; a large card with the latest score in a ring (the orbit, with when the first one
// opens, while there is none); "How it works", the steps with the day each is due by; and what the score does in
// payroll.

export const metadata: Metadata = { title: 'My KPIs · People System' };

/** The head's badge: the day the next scorecards open, today being Cairo's (so read at request time). */
async function NextCycle() {
  await connection();
  return <Pill>{nextCycleText(cairoDay(new Date()))}</Pill>;
}

async function Mine() {
  const user = await getCurrentUser();
  if (!user.employeeId) {
    return (
      <Empty>
        No employee record uses your sign-in email ({user.email}) as its work email, so there are no KPI scorecards for you. Ask HR to add it to
        your profile.
      </Empty>
    );
  }
  const loaded = await loadMyScorecards();
  if (loaded.kind !== 'ok') return <Empty>{kpiNotLoaded(loaded, 'scorecards')}</Empty>;
  const scorecards = loaded.value;
  if (!scorecards.length) return <NoScorecardsHero />;
  const waiting = scorecards.filter((s) => s.action);
  const shown = latestShown(scorecards);
  return (
    <div className="space-y-3">
      {waiting.length > 0 && <WaitingForYou scorecards={waiting} />}
      {shown ? <LatestScoreHero scorecard={shown} /> : <PendingScoreHero scorecard={scorecards[0]} />}
      <History scorecards={scorecards} />
    </div>
  );
}

/** "How it works", with the day each step is due by (the KPI settings, which everyone may read). */
async function Steps({ className }: { className: string }) {
  const settings = await loadKpiSettings();
  return <HowItWorks settings={settings.kind === 'ok' ? settings.value : null} className={className} />;
}

export default function MyKpisPage() {
  return (
    <div>
      <PageHead
        eyebrow="People System · Performance"
        title="My KPIs"
        intro="Your monthly scorecard is built from your job description, its pillars, weights and metrics."
        actions={
          <Suspense fallback={null}>
            <NextCycle />
          </Suspense>
        }
      />
      <div className="mt-7 space-y-3">
        <Suspense fallback={<Loading />}>
          <Mine />
        </Suspense>
        <div className="grid gap-3 xl:grid-cols-3">
          <Suspense fallback={<HowItWorks settings={null} className="xl:col-span-2" />}>
            <Steps className="xl:col-span-2" />
          </Suspense>
          <PayrollImpact />
        </div>
      </div>
    </div>
  );
}
