import {
  companyConnectsBy,
  MEETING_PROVIDER_LABELS,
  MEETING_PROVIDERS,
  meetingRedirectUri,
  MEETINGS_OWN_ACCOUNT,
  MEETINGS_SUPER_ADMIN_ONLY,
  type MeetingAppView,
  type MeetingConnectionView,
  type MeetingProvider,
  type MeetingSettingsView,
} from '@trendlix/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { MeetingConnection } from '@/components/meeting-connection';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import { originFromHeaders } from '@/lib/connector/site';
import { startMeetingConnect } from '@/lib/meeting-actions';
import { meetingBanner, seesMeetingSettings } from '@/lib/meetings';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../ui';
import { disconnectCompanyMeetings, saveMeetingApp, saveMeetingDefault, saveMeetingHost, testCompanyMeetings } from './actions';
import { CopyUri, MeetingAppForm, MeetingDefaultForm, MeetingHostForm } from './meetings-forms';
import { defaultOptions, setupSteps } from './setup';

// Organization → Meetings (owner, 24 October 2026: "can i link an online meeting service provider to automatically
// generate meeting links? line teams - gogole meet - zoom - etc.."; asked, "Google Meet, Microsoft Teams, Zoom", and who
// hosts them, "make it both": a company account a Super Admin connects once, and each HR person's own). A Super Admin's
// only, in their own session: for each provider its app (the credentials from the provider's console, the secrets kept
// encrypted and never shown again), the redirect URI to copy, short exact steps for the console, and the company's
// account (Google's by signing in to it; Microsoft's and Zoom's by naming the host) with Create a test meeting; and the
// default for new online interviews. The API refuses everyone else, a developer and a Super Admin viewing as someone too.

export const metadata: Metadata = { title: 'Meetings · People System' };

type Loaded = { kind: 'ok'; value: MeetingSettingsView } | { kind: 'unavailable' } | { kind: 'failed'; messages: string[] };

/** GET /meetings/settings: a refusal's own words kept (the API says why), 404 an API from before the page. */
async function loadSettings(): Promise<Loaded> {
  let res: Response;
  try {
    res = await apiFetch('/meetings/settings');
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', messages: err.messages };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { kind: 'unavailable' };
  if (!res.ok) return { kind: 'failed', messages: await messagesOf(res) };
  try {
    return { kind: 'ok', value: (await res.json()) as MeetingSettingsView };
  } catch {
    return { kind: 'failed', messages: ['The server sent an answer that could not be read.'] };
  }
}

const DISCONNECT_COMPANY = 'Disconnect the company’s account?';

/** The company's account: Google's signed in to; Microsoft's and Zoom's the host named. */
function CompanyAccount({ provider, app, connection }: { provider: MeetingProvider; app: MeetingAppView; connection: MeetingConnectionView | null }) {
  const by = companyConnectsBy(provider);
  return (
    <div className="space-y-3">
      <h3 className="font-semibold">Company Account</h3>
      {by === 'host' && (provider === 'microsoft' || provider === 'zoom') && (
        <MeetingHostForm provider={provider} current={connection?.accountEmail ?? null} action={saveMeetingHost.bind(null, provider)} disabled={!app.companyReady} />
      )}
      <MeetingConnection
        connection={connection}
        connect={by === 'oauth' ? startMeetingConnect.bind(null, provider, 'company') : undefined}
        connectLabel="Connect a Google account"
        canConnect={app.companyReady}
        cannotConnect="Save the client ID and secret first."
        disconnect={disconnectCompanyMeetings.bind(null, provider)}
        disconnectConfirm={DISCONNECT_COMPANY}
        test={testCompanyMeetings.bind(null, provider)}
      />
    </div>
  );
}

function ProviderCard({ provider, app, connection, origin }: { provider: MeetingProvider; app: MeetingAppView; connection: MeetingConnectionView | null; origin: string | null }) {
  const uri = origin ? meetingRedirectUri(origin, provider) : null;
  const headingId = `meetings-${provider}`;
  return (
    <section aria-labelledby={headingId} className="card space-y-6 p-6">
      <div className="space-y-1">
        <h2 id={headingId} className="text-lg font-semibold">
          {MEETING_PROVIDER_LABELS[provider]}
        </h2>
        <p className="text-sm text-muted">
          Company app: {app.companyReady ? 'set up' : 'not set up'} · HR’s own: {app.personalReady ? 'ready' : 'not ready'}
        </p>
      </div>
      <div className="space-y-3">
        <h3 className="font-semibold">Setup Steps</h3>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {setupSteps(provider, uri ?? '(this website’s address)/…').map((s) => (
            <li key={s.text}>
              {s.text}
              {s.values && (
                <span className="mt-1 flex flex-wrap gap-1">
                  {s.values.map((v) => (
                    <code key={v} className="rounded bg-canvas px-1.5 py-0.5 font-mono text-xs break-all">
                      {v}
                    </code>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ol>
        {uri ? <CopyUri uri={uri} /> : <p className="text-sm text-warn">This page could not tell its own address: open it again from the website.</p>}
      </div>
      <div className="space-y-3">
        <h3 className="font-semibold">App Credentials</h3>
        <MeetingAppForm provider={provider} app={app} action={saveMeetingApp.bind(null, provider)} />
      </div>
      <CompanyAccount provider={provider} app={app} connection={connection} />
    </section>
  );
}

async function Gate({ searchParams }: { searchParams: PageProps<'/organization/meetings'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (user.developer) return <Empty>The meeting settings aren’t open to developers.</Empty>;
  if (!seesMeetingSettings(user)) return <Empty>{MEETINGS_SUPER_ADMIN_ONLY}</Empty>;
  if (user.viewAs) return <Empty>{MEETINGS_OWN_ACCOUNT}</Empty>;
  const loaded = await loadSettings();
  if (loaded.kind === 'unavailable') return <Empty>Not available yet: the server doesn’t make meetings yet.</Empty>;
  if (loaded.kind === 'failed') return <Empty>The meeting settings could not be loaded. {loaded.messages.join(' ')}</Empty>;
  const view = loaded.value;
  const origin = originFromHeaders(await headers());
  const banner = meetingBanner(query);
  return (
    <div className="space-y-6">
      {banner && (
        <p role={banner.tone === 'danger' ? 'alert' : 'status'} className={`rounded-lg px-4 py-3 text-sm font-semibold ${banner.tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
          {banner.text}
        </p>
      )}
      <section aria-labelledby="meetings-default" className="card space-y-3 p-6">
        <h2 id="meetings-default" className="text-lg font-semibold">
          Default for New Online Interviews
        </h2>
        <MeetingDefaultForm options={defaultOptions(view)} current={view.defaultChoice} action={saveMeetingDefault} />
      </section>
      {MEETING_PROVIDERS.map((p) => {
        const app = view.apps.find((a) => a.provider === p);
        if (!app) return null;
        return <ProviderCard key={p} provider={p} app={app} connection={view.company.find((c) => c.provider === p) ?? null} origin={origin} />;
      })}
    </div>
  );
}

export default function MeetingsSettingsPage({ searchParams }: PageProps<'/organization/meetings'>) {
  return (
    <Suspense fallback={<Loading />}>
      <Gate searchParams={searchParams} />
    </Suspense>
  );
}
