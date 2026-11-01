import { calendarRedirectUri, CALENDARS_OWN_ACCOUNT, CALENDARS_SUPER_ADMIN_ONLY, type CalendarSettingsView } from '@trendlix/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Suspense } from 'react';
import { CalendarConnection } from '@/components/calendar-connections';
import { startCalendarConnect } from '@/lib/calendar-actions';
import { calendarBanner, seesCalendarSettings } from '@/lib/calendars';
import { originFromHeaders } from '@/lib/connector/site';
import { loadJson } from '@/lib/interview-hours-data';
import { getCurrentUser } from '@/lib/session';
import { CopyUri } from '../meetings/meetings-forms';
import { Empty, Loading } from '../ui';
import { disconnectCompanyZoho, saveZohoApp, testCompanyZoho } from './actions';
import { ZohoAppForm } from './calendars-forms';
import { otherSteps, zohoStatus, zohoSteps, type SetupStep } from './setup';

// Organization → Calendars (owner, 25 October 2026: "is it better for each interviewer to add his available interviews
// timeslots?"; asked, "Hours + calendar": the interviewers' calendar busy times taken away from the times HR books; then
// "its zoho mails": the company's mail and calendars are Zoho's, so Zoho Calendar is the main source). A Super Admin's
// only, in their own session: the Zoho app (a Server-based Application at api-console.zoho.com: its client ID, the
// secret kept encrypted and never shown again, the data centre), the redirect URI to copy, short exact steps, and the
// company's Zoho account, signed in to once, which reads everyone's free/busy by their work email; a check; and what
// Google's and Microsoft's apps on Organization → Meetings need for the people who connect their own. Only busy and free
// is ever read, never what an event is. The API refuses everyone else, a developer and a Super Admin viewing as someone.

export const metadata: Metadata = { title: 'Calendars · People System' };

const DISCONNECT_COMPANY = 'Disconnect the company’s Zoho account?';

function Steps({ steps }: { steps: SetupStep[] }) {
  return (
    <ol className="list-decimal space-y-2 pl-5 text-sm">
      {steps.map((s) => (
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
  );
}

async function Gate({ searchParams }: { searchParams: PageProps<'/organization/calendars'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (user.developer) return <Empty>The calendar settings aren’t open to developers.</Empty>;
  if (!seesCalendarSettings(user)) return <Empty>{CALENDARS_SUPER_ADMIN_ONLY}</Empty>;
  if (user.viewAs) return <Empty>{CALENDARS_OWN_ACCOUNT}</Empty>;
  const loaded = await loadJson<CalendarSettingsView>('/calendars/settings');
  if (loaded.kind === 'unavailable') return <Empty>Not available yet: the server doesn’t read calendars yet.</Empty>;
  if (loaded.kind !== 'ok') return <Empty>The calendar settings could not be loaded. {loaded.messages.join(' ')}</Empty>;
  const view = loaded.value;
  const origin = originFromHeaders(await headers());
  const zohoUri = origin ? calendarRedirectUri(origin, 'zoho') : null;
  const banner = calendarBanner(query);
  const connected = view.company?.status === 'connected';
  return (
    <div className="space-y-6">
      {banner && (
        <p role={banner.tone === 'danger' ? 'alert' : 'status'} className={`rounded-lg px-4 py-3 text-sm font-semibold ${banner.tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
          {banner.text}
        </p>
      )}
      <section aria-labelledby="calendars-zoho" className="card space-y-6 p-6">
        <div className="space-y-1">
          <h2 id="calendars-zoho" className="text-lg font-semibold">
            Zoho Calendar
          </h2>
          <p className="text-sm text-muted">{zohoStatus(view.zoho, connected)}</p>
        </div>
        <div className="space-y-3">
          <h3 className="font-semibold">Setup Steps</h3>
          <Steps steps={zohoSteps(zohoUri ?? '(this website’s address)/calendars/oauth/zoho', origin ?? '(this website’s address)')} />
          {zohoUri ? <CopyUri uri={zohoUri} /> : <p className="text-sm text-warn">This page could not tell its own address: open it again from the website.</p>}
        </div>
        <div className="space-y-3">
          <h3 className="font-semibold">App Credentials</h3>
          <ZohoAppForm app={view.zoho} action={saveZohoApp} />
        </div>
        <div className="space-y-3">
          <h3 className="font-semibold">Company Account</h3>
          <CalendarConnection
            connection={view.company}
            connect={startCalendarConnect.bind(null, 'zoho', 'company')}
            connectLabel="Connect the company’s Zoho account"
            canConnect={view.zoho.ready}
            cannotConnect="Save the client ID, the secret and the data centre first."
            disconnect={disconnectCompanyZoho}
            disconnectConfirm={DISCONNECT_COMPANY}
            test={testCompanyZoho}
            testWithEmail
          />
        </div>
      </section>
      <section aria-labelledby="calendars-others" className="card space-y-3 p-6">
        <h2 id="calendars-others" className="text-lg font-semibold">
          Google and Microsoft
        </h2>
        <Steps
          steps={otherSteps(
            origin ? calendarRedirectUri(origin, 'google') : '(this website’s address)/calendars/oauth/google',
            origin ? calendarRedirectUri(origin, 'microsoft') : '(this website’s address)/calendars/oauth/microsoft',
          )}
        />
      </section>
    </div>
  );
}

export default function CalendarSettingsPage({ searchParams }: PageProps<'/organization/calendars'>) {
  return (
    <Suspense fallback={<Loading />}>
      <Gate searchParams={searchParams} />
    </Suspense>
  );
}
