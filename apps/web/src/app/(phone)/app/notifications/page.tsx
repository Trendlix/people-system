import type { Metadata } from 'next';
import { Suspense } from 'react';
import { inboxPage } from '@/lib/notifications';
import { Inbox, Reminders, WhatsAppMessages } from '../../../(app)/notifications/inbox';
import { PageTitle, PhoneLoading } from '../ui';

// The inbox on the phone pages (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone,
// a check-in reminder)"; apps/mobile/README.md, Phase 4), opened from the bell in the top bar and from a notification
// tapped on the phone when it has no page of its own: the site's inbox (inbox.tsx), each notification opening its page
// here (a request under My Requests or To Approve, a payslip, Home for the reminders).

export const metadata: Metadata = { title: 'Notifications · Trendlix People' };

async function Page({ searchParams }: { searchParams: PageProps<'/app/notifications'>['searchParams'] }) {
  const page = inboxPage((await searchParams).page);
  return <Inbox surface="app" page={page} />;
}

export default function PhoneNotificationsPage({ searchParams }: PageProps<'/app/notifications'>) {
  return (
    <div className="space-y-4">
      <PageTitle title="Notifications">Requests waiting for you, decisions on yours, your payslips and the reminders.</PageTitle>
      <Suspense fallback={<PhoneLoading />}>
        <Page searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={null}>
        <Reminders surface="app" />
      </Suspense>
      <Suspense fallback={null}>
        <WhatsAppMessages surface="app" />
      </Suspense>
    </div>
  );
}
