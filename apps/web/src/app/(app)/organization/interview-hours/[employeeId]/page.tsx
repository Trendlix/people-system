import type { InterviewHoursView } from '@trendlix/shared';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { InterviewHoursForm } from '@/components/interview-hours-form';
import { todayInCairo } from '@/lib/date-picker';
import { INTERVIEW_HOURS_SETUP_PATH, rulesText } from '@/lib/interview-hours';
import { loadJson } from '@/lib/interview-hours-data';
import { getCurrentUser } from '@/lib/session';
import { readsRecruitment, WHO_SEES } from '../../../recruitment/recruitment';
import { BackLink, Empty, Loading } from '../../ui';
import { saveHoursFor } from '../actions';

// Someone's interview hours, set by HR, the CEO or a Super Admin (owner, 25 October 2026: "Hours + calendar"; the brief:
// "HR, the CEO and Super Admin can set anyone's"): the same form as their own page. A C-level person's are the CEO's and a
// Super Admin's only: for HR the API answers it isn't there.

export const metadata: Metadata = { title: 'Interview Hours · People System' };

async function Person({ params }: { params: PageProps<'/organization/interview-hours/[employeeId]'>['params'] }) {
  const [{ employeeId }, user] = await Promise.all([params, getCurrentUser()]);
  if (!readsRecruitment(user)) return <Empty>{WHO_SEES}</Empty>;
  const loaded = await loadJson<InterviewHoursView>(`/interview-hours/people/${encodeURIComponent(employeeId)}`);
  if (loaded.kind === 'unavailable') return <Empty>Not available yet: the server doesn’t keep interview hours yet. Please try again after its next update.</Empty>;
  if (loaded.kind === 'missing') return <Empty>This person isn’t there, or isn’t yours to see. {loaded.messages.join(' ')}</Empty>;
  if (loaded.kind !== 'ok') return <Empty>Their interview hours could not be loaded. {loaded.messages.join(' ')}</Empty>;
  const view = loaded.value;
  return (
    <section aria-labelledby="person-hours" className="card space-y-4 p-6">
      <div className="space-y-1">
        <h2 id="person-hours" className="text-lg font-semibold">
          Interview Hours: {view.name}
        </h2>
        <p className="text-sm text-muted">
          {view.hours ? `In effect: ${rulesText(view.hours, view.defaults)}.` : 'None set yet: “Find a time” checks only their leave, interviews and calendar.'} Their leave,
          the public holidays, their other interviews and their calendar’s busy times are taken away by themselves.
        </p>
      </div>
      <InterviewHoursForm
        action={saveHoursFor.bind(null, view.employeeId)}
        hours={view.hours}
        defaults={view.defaults}
        today={todayInCairo()}
        updatedAt={view.updatedAt}
        updatedBy={view.updatedBy}
        submitLabel="Save their hours"
      />
    </section>
  );
}

export default function PersonInterviewHoursPage({ params }: PageProps<'/organization/interview-hours/[employeeId]'>) {
  return (
    <div className="space-y-4">
      <BackLink href={INTERVIEW_HOURS_SETUP_PATH}>Interview Hours</BackLink>
      <Suspense fallback={<Loading />}>
        <Person params={params} />
      </Suspense>
    </div>
  );
}
