import { MEETING_ACCOUNT_LABELS, MEETING_COMPANY_NAMES, MEETING_PROVIDER_LABELS, MEETINGS_OWN_ACCOUNT, MEETINGS_SCHEDULERS_ONLY, type MyMeetingsView } from '@trendlix/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { MeetingConnection } from '@/components/meeting-connection';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import { startMeetingConnect } from '@/lib/meeting-actions';
import { connectsOwnMeetings, meetingBanner } from '@/lib/meetings';
import { getCurrentUser } from '@/lib/session';
import { disconnectMyMeetings, testMyMeetings } from './actions';

// Your Meetings (owner, 24 October 2026: "can i link an online meeting service provider to automatically generate meeting
// links?"; asked who hosts them, "make it both": a company account, and each HR person's own, connected by them). For
// those who schedule interviews, HR and a Super Admin, in their own session: for Google Meet, Microsoft Teams and Zoom,
// Connect my account (the provider's sign-in), connected as whom and since when, or why it needs connecting again,
// Create a test meeting, and Disconnect. A provider's own connection works only once a Super Admin has set up the
// company's app for it (Organization → Meetings). Interviews then offer "My Google Meet", "My Zoom"… to make the meeting.

export const metadata: Metadata = { title: 'Your Meetings · People System' };

type Loaded = { kind: 'ok'; value: MyMeetingsView } | { kind: 'unavailable' } | { kind: 'failed'; messages: string[] };

async function loadMine(): Promise<Loaded> {
  let res: Response;
  try {
    res = await apiFetch('/meetings/mine');
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', messages: err.messages };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { kind: 'unavailable' };
  if (!res.ok) return { kind: 'failed', messages: await messagesOf(res) };
  try {
    return { kind: 'ok', value: (await res.json()) as MyMeetingsView };
  } catch {
    return { kind: 'failed', messages: ['The server sent an answer that could not be read.'] };
  }
}

const DISCONNECT_MINE =
  'Disconnect your account? Interviews can’t use it until you connect it again. Meetings already made keep their link, but moving or cancelling them won’t change them at the provider any more.';

function Note({ children }: { children: React.ReactNode }) {
  return <section className="card p-6 text-sm text-muted">{children}</section>;
}

async function Mine({ searchParams }: { searchParams: PageProps<'/account/meetings'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (user.developer) return <Note>Meeting connections hold your accounts: they aren’t open to developers.</Note>;
  if (!connectsOwnMeetings(user)) return <Note>{MEETINGS_SCHEDULERS_ONLY}</Note>;
  if (user.viewAs) return <Note>{MEETINGS_OWN_ACCOUNT}</Note>;
  const loaded = await loadMine();
  if (loaded.kind === 'unavailable') return <Note>Not available yet: the server doesn’t make meetings yet. Please try again after its next update.</Note>;
  if (loaded.kind === 'failed') return <Note>Your meeting connections could not be loaded. {loaded.messages.join(' ')}</Note>;
  const banner = meetingBanner(query);
  return (
    <div className="space-y-4">
      {banner && (
        <p role={banner.tone === 'danger' ? 'alert' : 'status'} className={`rounded-lg px-4 py-3 text-sm font-semibold ${banner.tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
          {banner.text}
        </p>
      )}
      {loaded.value.providers.map(({ provider, available, connection }) => (
        <section key={provider} aria-labelledby={`mine-${provider}`} className="card space-y-3 p-6">
          <h2 id={`mine-${provider}`} className="text-lg font-semibold">
            {MEETING_PROVIDER_LABELS[provider]}
          </h2>
          {available || connection ? (
            <MeetingConnection
              connection={connection}
              connect={startMeetingConnect.bind(null, provider, 'personal')}
              connectLabel={`Connect my ${MEETING_ACCOUNT_LABELS[provider]}`}
              canConnect={available}
              cannotConnect={`A Super Admin sets up the company’s ${MEETING_COMPANY_NAMES[provider]} app first (Organization → Meetings).`}
              disconnect={disconnectMyMeetings.bind(null, provider)}
              disconnectConfirm={DISCONNECT_MINE}
              test={testMyMeetings.bind(null, provider)}
            />
          ) : (
            <p className="text-sm text-muted">A Super Admin sets up the company’s {MEETING_COMPANY_NAMES[provider]} app first (Organization → Meetings).</p>
          )}
          {/* busy times for "Find a time" (25 October 2026): a Google connection made before its free/busy scope was asked */}
          {provider === 'google' && connection?.status === 'connected' && connection.busyTimes === false && (
            <p className="text-sm text-warn">Reconnect to share your busy times: disconnect, then connect your Google account again and allow it.</p>
          )}
        </section>
      ))}
    </div>
  );
}

export default function YourMeetingsPage({ searchParams }: PageProps<'/account/meetings'>) {
  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Your Meetings</h1>
        <p className="mt-1 text-muted">
          Connect your own Google, Microsoft or Zoom account, and the interviews you schedule online can have their meeting made with it, hosted by you. The
          system keeps only what it needs to make, move and delete those meetings, encrypted; you can disconnect at any time.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <Mine searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
