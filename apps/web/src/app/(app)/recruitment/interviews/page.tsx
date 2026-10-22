import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../../organization/ui';
import { loadUpcomingInterviews, recruitmentNotLoaded } from '../data';
import { readsRecruitment, WHO_SEES } from '../recruitment';
import { InterviewsTable } from './interviews-table';

// Interviews (Phase 2, owner, 22 October 2026: "interview invites go by email through the owner's SMTP settings"; the
// brief: "'Upcoming Interviews' on the Recruitment page"): every interview still to come, soonest first, for HR, the CEO
// and a Super Admin. Each is scheduled, moved and cancelled from its applicant's page.

export const metadata: Metadata = { title: 'Interviews · People System' };

async function Upcoming() {
  const user = await getCurrentUser();
  if (!readsRecruitment(user)) return <Empty>{WHO_SEES}</Empty>;
  const loaded = await loadUpcomingInterviews();
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'interviews')}</Empty>;
  if (!loaded.value.length) return <div className="card px-6 py-8 text-center text-sm text-muted">No interviews to come. Schedule one from an applicant’s page.</div>;
  return <InterviewsTable rows={loaded.value} />;
}

export default function InterviewsPage() {
  return (
    <div className="max-w-5xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Upcoming Interviews</h1>
        <p className="max-w-3xl text-sm text-muted">
          Scheduled from an applicant’s page: the candidate is emailed the calendar invitation, and the interviewers are told.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Upcoming />
      </Suspense>
    </div>
  );
}
