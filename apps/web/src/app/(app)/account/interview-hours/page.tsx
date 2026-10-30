import {
  CALENDAR_ACCOUNT_LABELS,
  CALENDAR_COMPANY_NAMES,
  CALENDAR_PROVIDER_LABELS,
  INTERVIEW_KIND_LABELS,
  type MyCalendarsView,
  type MyInterviewHoursView,
  type MyUpcomingInterview,
} from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { CalendarConnection } from '@/components/calendar-connections';
import { InterviewHoursForm } from '@/components/interview-hours-form';
import { startCalendarConnect } from '@/lib/calendar-actions';
import { calendarBanner } from '@/lib/calendars';
import { todayInCairo } from '@/lib/date-picker';
import { formatDateTime } from '@/lib/format';
import { rulesText } from '@/lib/interview-hours';
import { loadJson } from '@/lib/interview-hours-data';
import { MY_MEETINGS_PATH } from '@/lib/meetings';
import { getCurrentUser } from '@/lib/session';
import { isViewOnly, TICK_ACT_AS_THEM, type Session } from '@/lib/view-as';
import { disconnectMyCalendar, saveMyInterviewHours, testMyCalendar } from './actions';

// Your Interview Hours (owner, 25 October 2026: "is it better for each interviewer to add his available interviews
// timeslots?"; asked, "Hours + calendar": each interviewer sets weekly interview hours once, and the system takes away
// their leave, holidays, booked interviews and, when connected, their calendar's busy times; then "its zoho mails": Zoho
// Calendar first). For anyone with an employee profile (anyone HR can put on a panel, and hiring managers): their weekly
// hours, the day they count from, their notice and buffer, and one-off changes; their calendar (read through the
// company's Zoho connection by their work email when there is one, else connected here: Zoho, Google or Microsoft, for
// busy and free only, never what an event is); and their interviews to come. HR then books the times they are free.
// A Super Admin viewing as someone sees their page as theirs (owner, 25 October 2026: "i need to be able to set it up on
// behalf of the employee, by acting as them"): with Act as them on, they set the person's hours and connect or
// disconnect the person's calendars (the API checks the account signed in to is the person's); view only, the page is
// read only and says "Tick Act as them to change this".

export const metadata: Metadata = { title: 'Your Interview Hours · People System' };

function Note({ children }: { children: React.ReactNode }) {
  return <section className="card p-6 text-sm text-muted">{children}</section>;
}

const DISCONNECT_MINE = 'Disconnect your calendar? HR’s times won’t leave out your busy times from it until you connect it again.';

/** Their calendar: read by the company's connection, connected here, or nothing to connect yet; read only viewing only. */
async function YourCalendar({ user }: { user: Session }) {
  const readOnly = isViewOnly(user);
  const loaded = await loadJson<MyCalendarsView>('/calendars/mine');
  if (loaded.kind === 'unavailable') return <Note>Not available yet: the server doesn’t read calendars yet. Please try again after its next update.</Note>;
  if (loaded.kind !== 'ok') return <Note>Your calendar connections could not be loaded. {loaded.messages.join(' ')}</Note>;
  const v = loaded.value;
  // the company's Zoho reads theirs already: no personal Zoho offered (one connected before stays, to disconnect)
  const shown = v.providers.filter((p) => p.connection || (p.available && !(p.provider === 'zoho' && v.companyZoho)));
  const google = v.meetings.find((m) => m.provider === 'google');
  return (
    <section aria-labelledby="your-calendar" className="card space-y-4 p-6">
      <div className="space-y-1">
        <h2 id="your-calendar" className="text-lg font-semibold">
          Your Calendar
        </h2>
        <p className="text-sm text-muted">Only when you’re busy is read, never what your events are, who is in them or where they are.</p>
      </div>
      {v.companyZoho && (
        <p className="text-sm">
          Your Zoho Calendar’s busy times are read through the company’s Zoho connection, by your work email{v.workEmail ? ` (${v.workEmail})` : ''}: there is nothing to
          connect.
        </p>
      )}
      {v.companyMicrosoft && (
        <p className="text-sm">
          Your Outlook calendar’s busy times are read through the company’s Microsoft 365 app, by your work email{v.workEmail ? ` (${v.workEmail})` : ''}: there is nothing to
          connect.
        </p>
      )}
      {google && !google.busyTimes && (
        <p className="text-sm text-warn">
          Your Google Meet connection doesn’t share your busy times yet. <Link href={MY_MEETINGS_PATH}>Reconnect to share your busy times</Link> (disconnect it on Your
          Meetings, then connect it again and allow it).
        </p>
      )}
      {shown.map(({ provider, available, connection }) => (
        <div key={provider} className="space-y-2 border-t border-line-soft pt-4">
          <h3 className="font-semibold">{CALENDAR_PROVIDER_LABELS[provider]}</h3>
          <CalendarConnection
            connection={connection}
            connect={startCalendarConnect.bind(null, provider, 'personal')}
            connectLabel={`Connect my ${CALENDAR_ACCOUNT_LABELS[provider]}`}
            canConnect={available}
            cannotConnect={`A Super Admin sets up the company’s ${CALENDAR_COMPANY_NAMES[provider]} app first (${provider === 'zoho' ? 'Organization → Calendars' : 'Organization → Meetings'}).`}
            disconnect={disconnectMyCalendar.bind(null, provider)}
            disconnectConfirm={DISCONNECT_MINE}
            test={testMyCalendar.bind(null, provider)}
            readOnly={readOnly}
          />
        </div>
      ))}
      {!shown.length && !v.companyZoho && !v.companyMicrosoft && (
        <p className="text-sm text-muted">
          No calendar can be connected yet: a Super Admin sets up the company’s Zoho Calendar (Organization → Calendars), or the Google and Microsoft apps (Organization →
          Meetings). Your leave, holidays and booked interviews are taken away all the same.
        </p>
      )}
    </section>
  );
}

function Upcoming({ rows }: { rows: MyUpcomingInterview[] }) {
  return (
    <section aria-labelledby="your-upcoming" className="card space-y-3 p-6">
      <h2 id="your-upcoming" className="text-lg font-semibold">
        Your Upcoming Interviews
      </h2>
      {rows.length ? (
        <ul className="divide-y divide-line-soft">
          {rows.map((i) => (
            <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
              <span className="text-sm">
                <Link href={`/recruitment/applicants/${encodeURIComponent(i.applicationId)}`} className="font-semibold">
                  {i.candidate}
                </Link>
                <span className="text-muted"> · {i.job}</span>
              </span>
              <span className="text-sm text-muted">
                {formatDateTime(i.startsAt)} · {i.minutes} minutes · {INTERVIEW_KIND_LABELS[i.kind]}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No interviews to come.</p>
      )}
    </section>
  );
}

async function Mine({ searchParams }: { searchParams: PageProps<'/account/interview-hours'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (user.developer) return <Note>Interview hours are each interviewer’s own: they aren’t open to developers.</Note>;
  if (!user.employeeId) return <Note>Interview hours are for the people who interview: an account with an employee profile. Yours has none.</Note>;
  const loaded = await loadJson<MyInterviewHoursView>('/me/interview-hours');
  if (loaded.kind === 'unavailable') return <Note>Not available yet: the server doesn’t keep interview hours yet. Please try again after its next update.</Note>;
  if (loaded.kind !== 'ok') return <Note>Your interview hours could not be loaded. {loaded.messages.join(' ')}</Note>;
  const view = loaded.value;
  // whose account a refused sign-in should have been: the person acted as, by name (else one's own)
  const banner = calendarBanner(query, user.viewAs ? (user.name ?? user.email) : null);
  const readOnly = isViewOnly(user);
  return (
    <div className="space-y-4">
      {readOnly && (
        <p role="note" className="rounded-lg bg-accent-soft px-4 py-3 text-sm font-semibold text-accent">
          {TICK_ACT_AS_THEM}
        </p>
      )}
      {banner && (
        <p role={banner.tone === 'danger' ? 'alert' : 'status'} className={`rounded-lg px-4 py-3 text-sm font-semibold ${banner.tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
          {banner.text}
        </p>
      )}
      {view.needsHours && (
        <p role="status" className="rounded-lg bg-accent-soft px-4 py-3 text-sm font-semibold text-accent">
          Set your interview hours so HR can book you.
        </p>
      )}
      <section aria-label="Your interview hours" className="card space-y-4 p-6">
        <p className="text-sm text-muted">
          {view.hours ? `In effect: ${rulesText(view.hours, view.defaults)}.` : `None set yet. The company asks for ${rulesText(null, view.defaults)}.`}
        </p>
        <InterviewHoursForm
          action={saveMyInterviewHours}
          hours={view.hours}
          defaults={view.defaults}
          today={todayInCairo()}
          updatedAt={view.updatedAt}
          updatedBy={view.updatedBy}
          readOnly={readOnly}
        />
      </section>
      <Suspense fallback={<Note>Loading your calendar…</Note>}>
        <YourCalendar user={user} />
      </Suspense>
      <Upcoming rows={view.upcoming} />
    </div>
  );
}

export default function YourInterviewHoursPage({ searchParams }: PageProps<'/account/interview-hours'>) {
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="page-title">Your Interview Hours</h1>
        <p className="mt-1 text-muted">
          Set the weekly hours you can interview in, once. HR then sees the times you and the rest of a panel are free, with your leave, public holidays, your other
          interviews and your calendar’s busy times already taken away, and books one; the candidate is invited by the system.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <Mine searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
