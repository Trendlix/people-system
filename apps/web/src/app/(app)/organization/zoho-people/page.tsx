import {
  ZOHO_PEOPLE_DEFAULT_TIME_ZONE,
  ZOHO_PEOPLE_HR_ONLY,
  ZOHO_PEOPLE_NOT_CONNECTED,
  ZOHO_PEOPLE_OWN_ACCOUNT,
  ZOHO_PEOPLE_RUN_GOING,
  ZOHO_PEOPLE_SCOPES,
  ZOHO_RECORDED_LABEL,
  ZOHO_RUN_KIND_LABELS,
  zohoPeopleRedirectUri,
  type ZohoPeopleView,
  type ZohoRunView,
} from '@trendlix/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { Suspense } from 'react';
import { getOrNull } from '../../approvals/data';
import { CALENDAR_SETTINGS_PATH } from '@/lib/calendars';
import { originFromHeaders } from '@/lib/connector/site';
import { todayInCairo } from '@/lib/date-picker';
import { formatDateTime } from '@/lib/format';
import { loadJson } from '@/lib/interview-hours-data';
import { getCurrentUser } from '@/lib/session';
import {
  exclusionText,
  hiddenText,
  nightlyText,
  personText,
  runBadge,
  runDaysText,
  runExcludedText,
  runSkippedLines,
  runSummaryText,
  runWhoText,
  seesZohoPeople,
  yesterdayOf,
  zohoPeopleBanner,
  zohoZoneDiffers,
  zohoZoneText,
  type ZohoChoosable,
} from '@/lib/zoho-people';
import { saveZohoApp } from '../calendars/actions';
import { ZohoAppForm } from '../calendars/calendars-forms';
import { CopyUri } from '../meetings/meetings-forms';
import { SetupSection } from '../payroll/section';
import { Empty, Loading } from '../ui';
import { cancelZohoRun, disconnectZohoPeople, excludeFromZoho, fetchFromZoho, includeInZoho, startZohoPeopleConnect, testZohoPeople } from './actions';
import { ExclusionForm, FetchForm, RemoveExclusion, RunProgress, ZohoConnection } from './zoho-people-forms';

// Organization → Zoho People (owner, 25 October 2026: "can i fetch checkin and out transactions from zoho people through
// api?"; asked, "Yes, daily + backfill": every night yesterday's check-ins and check-outs for everyone, a "Fetch from
// Zoho" button for any range, a Super Admin connecting Zoho once; then "but can it fetch historical data?": up to 12
// months a run, former employees too, a month whose payroll is approved added to for the record, its payroll unchanged).
// HR and a Super Admin, never a developer: the connection (a Super Admin's, in their own session: the Zoho app shared
// with Organization → Calendars, its redirect URI to add, the account signed in as, a test, disconnecting; HR sees only
// whether it is connected), the nightly run, Fetch from Zoho with how long it takes, the run going now with its
// progress and Cancel, the people left out of the fetch (owner, 31 October 2026: "can i exclude users from the zoho
// api?"; he chose "Add an exclusion list"), the people Zoho People doesn't know by their work email, and the last runs.
// The API refuses everyone else and checks every request again.

export const metadata: Metadata = { title: 'Zoho People · People System' };

function Steps({ steps }: { steps: { text: string; values?: readonly string[] }[] }) {
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

/** The owner's steps (25 October 2026): Zoho's API console, the redirect URI, the scopes, the account, the data centre. */
function setupSteps(redirectUri: string): { text: string; values?: readonly string[] }[] {
  return [
    {
      text: 'On api-console.zoho.com, open the Server-based Application already made for Organization → Calendars (one Zoho app serves both, each sign-in asking its own permissions), or add one: Add Client → Server-based Applications.',
    },
    { text: 'Add this to its Authorized Redirect URIs, beside the calendars’ one, and update:', values: [redirectUri] },
    { text: 'Its client ID, secret and data centre are the ones below (the same as on Organization → Calendars: saved in either place, they are kept once).' },
    { text: 'The sign-in asks Zoho People only for these (reading attendance, Zoho People’s time zone and date format, and who signed in); nothing is ever written to Zoho:', values: ZOHO_PEOPLE_SCOPES },
    { text: 'Connect Zoho People signed in as a Zoho People administrator, who can read everyone’s attendance, e.g. hr@trendlix.com, in the data centre the company’s Zoho account is in.' },
    { text: 'Test it: today’s check-ins are read for that account and, if you write one, a colleague’s work email.' },
  ];
}

function RunRow({ run }: { run: ZohoRunView }) {
  const summary = runSummaryText(run);
  const skipped = runSkippedLines(run);
  const badge = runBadge(run);
  return (
    <li className="space-y-1.5 py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-semibold">
          {ZOHO_RUN_KIND_LABELS[run.kind]} · {runDaysText(run)} · {runWhoText(run)}
        </p>
        <span className={`badge ${badge.className}`}>{badge.label}</span>
      </div>
      <p className="text-xs text-muted">
        Started {formatDateTime(run.startedAt)}
        {run.startedBy ? ` by ${run.startedBy.name}` : run.kind === 'nightly' ? ' by the nightly run' : ''}
        {run.finishedAt ? ` · ended ${formatDateTime(run.finishedAt)}` : ''} · {run.counts.callsDone.toLocaleString('en-US')} of {run.counts.calls.toLocaleString('en-US')} calls ·{' '}
        {run.counts.peopleDone.toLocaleString('en-US')} of {run.counts.people.toLocaleString('en-US')} people
      </p>
      {summary && <p>{summary}.</p>}
      {run.counts.daysRecorded > 0 && (
        <p className="text-xs text-muted">
          {ZOHO_RECORDED_LABEL}: days missing from a month whose payroll is with the CEO, approved or paid were added for attendance history; nothing kept there was replaced, and its payroll didn’t change.
        </p>
      )}
      {skipped.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted" aria-label="Left as they were, or not fetched">
          {skipped.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      {run.noWorkEmail.length > 0 && <p className="text-xs text-muted">No work email, so not fetched: {run.noWorkEmail.map(personText).join('; ')}.</p>}
      {runExcludedText(run) && <p className="text-xs text-muted">{runExcludedText(run)}</p>}
      {run.problem && (
        <p role="alert" className="text-sm text-danger">
          {run.problem}
        </p>
      )}
      {run.errors.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">
            {run.errors.length} {run.errors.length === 1 ? 'thing' : 'things'} went wrong on the way
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {run.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

async function Gate({ searchParams }: { searchParams: PageProps<'/organization/zoho-people'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (user.developer) return <Empty>Zoho People’s connection and fetches aren’t open to developers.</Empty>;
  if (!seesZohoPeople(user)) return <Empty>{ZOHO_PEOPLE_HR_ONLY}</Empty>;
  const loaded = await loadJson<ZohoPeopleView>('/zoho-people');
  if (loaded.kind === 'unavailable') return <Empty>Not available yet: the server doesn’t fetch from Zoho People yet. Please try again after its next update.</Empty>;
  if (loaded.kind !== 'ok') return <Empty>Zoho People’s page could not be loaded. {loaded.messages.join(' ')}</Empty>;
  const view = loaded.value;
  const people = view.canFetch ? await getOrNull<ZohoChoosable[]>('/zoho-people/people') : null;
  const origin = originFromHeaders(await headers());
  const redirectUri = origin ? zohoPeopleRedirectUri(origin) : null;
  const banner = zohoPeopleBanner(query);
  const connected = view.connection?.status === 'connected';
  const yesterday = yesterdayOf(todayInCairo());
  const readIn = view.timeZone || ZOHO_PEOPLE_DEFAULT_TIME_ZONE;
  const blocked = view.current ? ZOHO_PEOPLE_RUN_GOING : !connected ? ZOHO_PEOPLE_NOT_CONNECTED : null;
  const superAdminViewingAs = user.roles.includes('super_admin') && !!user.viewAs;
  const hidden = hiddenText(view.hiddenNotFound);
  // left out of the fetch (31 October 2026); an API from before it has none
  const exclusions = view.exclusions ?? { exclusions: [], hidden: 0 };
  const hiddenLeftOut = hiddenText(exclusions.hidden);

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted">
        Zoho People’s check-ins and check-outs come into the system’s attendance as Zoho People’s days, the way its Excel import brings them: every night for
        yesterday, and for earlier days with Fetch from Zoho. Each day counts from its first check-in to its last check-out by the person’s shift, breaks included; what was checked in on the system,
        HR’s corrections and the payroll already with the CEO, approved or paid are never changed.
      </p>
      {banner && (
        <p role={banner.tone === 'danger' ? 'alert' : 'status'} className={`rounded-lg px-4 py-3 text-sm font-semibold ${banner.tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
          {banner.text}
        </p>
      )}

      <SetupSection id="zoho-connection" title="Connection" intro="The Zoho account the system reads Zoho People’s attendance with: a Super Admin connects it once.">
        {view.canManage ? (
          <div className="space-y-6">
            <div className="space-y-3">
              <h3 className="font-semibold">Setup Steps</h3>
              <Steps steps={setupSteps(redirectUri ?? '(this website’s address)/zoho-people/oauth')} />
              {redirectUri ? <CopyUri uri={redirectUri} /> : <p className="text-sm text-warn">This page could not tell its own address: open it again from the website.</p>}
            </div>
            {view.app && (
              <div className="space-y-3">
                <h3 className="font-semibold">App Credentials</h3>
                <p className="text-sm text-muted">
                  Shared with <Link href={CALENDAR_SETTINGS_PATH}>Organization → Calendars</Link>.
                </p>
                <ZohoAppForm app={view.app} action={saveZohoApp} />
              </div>
            )}
            <div className="space-y-3">
              <h3 className="font-semibold">Zoho Account</h3>
              <ZohoConnection
                connection={view.connection}
                canConnect={!!view.app?.ready}
                cannotConnect="Save the client ID, the secret and the data centre first."
                connect={startZohoPeopleConnect}
                disconnect={disconnectZohoPeople}
                test={testZohoPeople}
              />
              {view.connection && (
                <p className={`text-sm ${zohoZoneDiffers(view.connection, readIn) ? 'text-warn' : 'text-muted'}`}>
                  {zohoZoneText(view.connection, readIn)}
                  {zohoZoneDiffers(view.connection, readIn) ? ` Zoho’s times are read as ${readIn}’s.` : ''}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p role="status" className={`text-sm font-semibold ${!view.connection ? 'text-muted' : connected ? 'text-ok' : 'text-warn'}`}>
              {!view.connection
                ? 'Not connected: a Super Admin connects Zoho People on this page.'
                : connected
                  ? `Connected as ${view.connection.accountEmail}.`
                  : `Needs connecting again: ${view.connection.problem ?? 'a Super Admin connects it again on this page.'}`}
            </p>
            {superAdminViewingAs && <p className="text-sm text-muted">{ZOHO_PEOPLE_OWN_ACCOUNT}</p>}
          </div>
        )}
      </SetupSection>

      <p className="max-w-3xl text-sm">{nightlyText(view.nightly)}</p>

      {view.current && (
        <SetupSection id="zoho-now" title="Now Fetching" intro={`${ZOHO_RUN_KIND_LABELS[view.current.kind]} · ${runDaysText(view.current)} · ${runWhoText(view.current)}. It goes on in the background: this page can be closed.`}>
          <RunProgress run={view.current} cancel={view.canFetch ? cancelZohoRun.bind(null, view.current.id) : null} />
        </SetupSection>
      )}

      {view.canFetch && (
        <SetupSection
          id="zoho-fetch"
          title="Fetch From Zoho"
          intro="Earlier days from Zoho People: up to 12 months at a time, everyone employed in them (former employees too, by the work email they had) or the people you choose. Days Zoho’s Excel import or an earlier fetch kept aren’t added twice; a day Zoho changed since is replaced."
        >
          <FetchForm action={fetchFromZoho} people={people} everyone={view.people} yesterday={yesterday} blocked={blocked} />
        </SetupSection>
      )}

      {view.canFetch && (
        <SetupSection
          id="zoho-left-out"
          title="Left Out of the Zoho Fetch"
          intro="People the nightly run and Fetch from Zoho skip, even when chosen by hand: e.g. someone who checks in on the system now. Their days fetched before stay as they are; taken off the list, they are fetched again from the next run."
        >
          <div className="space-y-5">
            {exclusions.exclusions.length === 0 && !hiddenLeftOut ? (
              <p className="text-sm text-muted">No one is left out: every run fetches everyone it covers.</p>
            ) : (
              <ul className="divide-y divide-line-soft" aria-label="Left out of the Zoho fetch">
                {exclusions.exclusions.map((x) => {
                  const t = exclusionText(x, formatDateTime);
                  return (
                    <li key={x.employeeId} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                      <div className="min-w-0 space-y-0.5">
                        <p className="font-semibold break-words">{t.who}</p>
                        <p className="text-xs break-words text-muted">{t.note}</p>
                      </div>
                      <RemoveExclusion action={includeInZoho.bind(null, x.employeeId)} name={x.name} />
                    </li>
                  );
                })}
                {hiddenLeftOut && <li className="py-3 text-sm text-muted">{hiddenLeftOut}</li>}
              </ul>
            )}
            <div className="space-y-3">
              <h3 className="font-semibold">Leave Someone Out</h3>
              <ExclusionForm action={excludeFromZoho} people={people} />
            </div>
          </div>
        </SetupSection>
      )}

      <SetupSection id="zoho-not-found" title="Not Found in Zoho People" intro="People Zoho People doesn’t know by their work email, as the last fetch of them found: fix the work email on their profile, or in Zoho People.">
        {view.notFound.length === 0 && !hidden ? (
          <p className="text-sm text-muted">Everyone fetched was found.</p>
        ) : (
          <div className="space-y-2 text-sm">
            <p>Not found in Zoho People:</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {view.notFound.map((p) => (
                <li key={p.employeeId}>{personText(p)}</li>
              ))}
              {hidden && <li className="text-muted">{hidden}</li>}
            </ul>
          </div>
        )}
      </SetupSection>

      <SetupSection id="zoho-runs" title="Last Runs" intro="The nightly runs and the fetches, the latest first: what each added, replaced and left as it was, and why.">
        {view.runs.length === 0 ? (
          <p className="text-sm text-muted">Nothing has been fetched from Zoho People yet.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {view.runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </ul>
        )}
      </SetupSection>
    </div>
  );
}

export default function ZohoPeoplePage({ searchParams }: PageProps<'/organization/zoho-people'>) {
  return (
    <Suspense fallback={<Loading />}>
      <Gate searchParams={searchParams} />
    </Suspense>
  );
}
