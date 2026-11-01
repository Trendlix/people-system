import { INTERVIEWER_REASON_LABELS, type InterviewersView } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { formatDateTime } from '@/lib/format';
import { interviewHoursHref } from '@/lib/interview-hours';
import { loadJson } from '@/lib/interview-hours-data';
import { getCurrentUser } from '@/lib/session';
import { readsRecruitment, WHO_SEES } from '../../recruitment/recruitment';
import { Empty, Loading } from '../ui';
import { saveInterviewDefaults } from './actions';
import { InterviewDefaultsForm } from './defaults-form';

// Organization → Interview Hours (owner, 25 October 2026: "is it better for each interviewer to add his available
// interviews timeslots?"; asked, "Hours + calendar" and "HR only": each interviewer sets weekly interview hours once, HR
// books the times they are all free). HR's, the CEO's and a Super Admin's: the company's minimum notice and buffer between
// interviews (which a person may only make stricter), and the people who interview, the hiring managers of open
// vacancies, those on upcoming panels and anyone with hours, each with their week and "Set hours" (HR, the CEO and a
// Super Admin can set anyone's). A C-level person isn't listed for HR, as everywhere.

export const metadata: Metadata = { title: 'Interview Hours · People System' };

async function Gate() {
  const user = await getCurrentUser();
  if (!readsRecruitment(user)) return <Empty>{WHO_SEES}</Empty>;
  const loaded = await loadJson<InterviewersView>('/interview-hours');
  if (loaded.kind === 'unavailable') return <Empty>Not available yet: the server doesn’t keep interview hours yet.</Empty>;
  if (loaded.kind !== 'ok') return <Empty>The interview hours could not be loaded. {loaded.messages.join(' ')}</Empty>;
  const { settings, people } = loaded.value;
  return (
    <div className="space-y-6">
      <section aria-labelledby="interview-defaults" className="card space-y-3 p-6">
        <h2 id="interview-defaults" className="text-lg font-semibold">
          Company Defaults
        </h2>
        {settings.updatedAt && (
          <p className="text-sm text-muted">
            Last saved {formatDateTime(settings.updatedAt)}
            {settings.updatedBy ? ` by ${settings.updatedBy.name}` : ''}
          </p>
        )}
        <InterviewDefaultsForm defaults={settings.defaults} action={saveInterviewDefaults} />
      </section>
      <section aria-labelledby="interviewers" className="card space-y-3 p-6">
        <h2 id="interviewers" className="text-lg font-semibold">
          People Who Interview
        </h2>
        {people.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="py-2 pe-4 font-semibold">
                    Name
                  </th>
                  <th scope="col" className="py-2 pe-4 font-semibold">
                    Why listed
                  </th>
                  <th scope="col" className="py-2 pe-4 font-semibold">
                    Weekly hours
                  </th>
                  <th scope="col" className="py-2 pe-4 font-semibold">
                    Last saved
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    <span className="sr-only">Change</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {people.map((p) => (
                  <tr key={p.employeeId}>
                    <td className="py-2 pe-4 font-medium">{p.name}</td>
                    <td className="py-2 pe-4 text-muted">{p.reasons.map((r) => INTERVIEWER_REASON_LABELS[r]).join(' · ')}</td>
                    <td className={`py-2 pe-4 ${p.summary ? '' : 'text-warn'}`}>{p.summary ?? 'Not set'}</td>
                    <td className="py-2 pe-4 text-muted">{p.updatedAt ? formatDateTime(p.updatedAt) : '—'}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <Link href={interviewHoursHref(p.employeeId)}>
                        {p.summary ? 'Change hours' : 'Set hours'}
                        <span className="sr-only"> of {p.name}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">Nobody yet.</p>
        )}
      </section>
    </div>
  );
}

export default function InterviewHoursPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Gate />
    </Suspense>
  );
}
