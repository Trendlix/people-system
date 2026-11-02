import type { Metadata } from 'next';
import { Suspense } from 'react';
import { inboxPage } from '@/lib/notifications';
import { Inbox, Reminders, WhatsAppMessages } from './inbox';

// The inbox on the site (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a
// check-in reminder)"; apps/mobile/README.md, Phase 4), opened from the bell in the header: the body is shared with the
// phone pages' (inbox.tsx), which open the same notifications on their own pages.

export const metadata: Metadata = { title: 'Notifications · People System' };

async function Page({ searchParams }: { searchParams: PageProps<'/notifications'>['searchParams'] }) {
  const page = inboxPage((await searchParams).page);
  return <Inbox surface="site" page={page} />;
}

export default function NotificationsPage({ searchParams }: PageProps<'/notifications'>) {
  return (
    <div className="space-y-4">
      <h1 className="page-title">Notifications</h1>
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <Page searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={null}>
        <Reminders surface="site" />
      </Suspense>
      <Suspense fallback={null}>
        <WhatsAppMessages surface="site" />
      </Suspense>
    </div>
  );
}
