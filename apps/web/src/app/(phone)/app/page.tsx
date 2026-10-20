import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { permissionClock, underLabourLaw } from '@trendlix/shared';
import { getCurrentUser } from '@/lib/session';
import { APP_PATHS, appItemHref, appRequestsHref } from '@/lib/surface';
import type { EmployeeProfile } from '@/lib/types';
import type { Session } from '@/lib/view-as';
import { NoProfile } from '../../(app)/dashboard/cards';
import { holidayWhen, holidayYears, inDaysText, upcomingHolidays } from '../../(app)/dashboard/dashboard';
import { bannerMessage } from '../../(app)/employees/confirmation';
import { todayInCairo } from '../../(app)/employees/ui';
import { TodayCheckIn } from '../../(app)/my-attendance/check-in-card';
import { loadOwnProfile } from '../../(app)/own-profile';
import { daysText, leaveWhenText, periodText, upcomingLeave } from '../../(app)/leave/list';
import { loadHolidayYears, loadMyBalances, loadMyLeave, loadMyPermissionMonth, loadMyPermissions } from '../../(app)/leave/data';
import { permissionDayText, permissionHoursLine, permissionInDaysText, upcomingPermissions } from '../../(app)/leave/permissions';
import { LeaveStatusBadge } from '../../(app)/leave/ui';
import { approveCount } from './approve-count';
import { FingerprintOffer } from './fingerprint-offer';
import { askOptions } from './requests/new/options';
import { decidesSomething } from './tabs';
import { PhoneCard, PhoneLoading, Quiet, RowLink, RowList } from './ui';

// The phone pages' Home (owner, 20 October 2026: "what if we tried to build a mobile app for the employees? to enable
// them to check in and out, and apply for their requests"; apps/mobile/README.md, Phase 1): today's check-in first, with
// the big Check in / Check out button (the site's own panel and punch, my-attendance/check-in-panel.tsx) and the time
// since checking in; what waits for them to decide, for those who decide something; the ways to ask (Leave, Permission,
// Reimbursement, Correction), each only where it applies as on the site; the annual leave left and this month's
// permission hours; and what is coming up: their leave and permission, and the official holidays. Each opens its page
// on the phone pages. Confirming their details stays on the site (its review page), linked from here.

export const metadata: Metadata = { title: 'Home · TrendLIX People' };

const TILE =
  'flex min-h-20 flex-col items-start justify-between gap-2 rounded-xl border border-line bg-card p-3 text-sm font-semibold text-ink no-underline hover:border-accent active:bg-canvas';

function Icon({ d }: { d: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const ICON_PATHS = {
  leave: 'M4 7h16v13H4zM4 11h16M8 4v5M16 4v5',
  permission: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2',
  reimbursement: 'M4 6h16v12H4zM4 10h16M8 15h3',
  correction: 'M5 19h4L19 9l-4-4L5 15zM13.5 6.5l4 4',
} as const;

/** The ways to ask (Leave, Permission, Reimbursement, Correction), each where it applies as on the site (options.ts). */
async function Shortcuts({ profile, today }: { profile: EmployeeProfile; today: string }) {
  const e = profile.employment;
  const month = e ? await loadMyPermissionMonth(today.slice(0, 7)) : null;
  const tiles = askOptions({ employment: e, permissionMonth: month?.kind === 'ok' ? month.value : null, asksRaise: false }).filter(
    (t): t is typeof t & { key: keyof typeof ICON_PATHS } => t.key in ICON_PATHS,
  );
  return (
    <section aria-labelledby="ask-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="ask-heading" className="font-semibold">
          New Request
        </h2>
        <Link href={APP_PATHS.newRequest} className="text-sm">
          All kinds
        </Link>
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-2 landscape:grid-cols-4">
        {tiles.map((t) => (
          <li key={t.key}>
            <Link href={t.href} className={TILE}>
              <Icon d={ICON_PATHS[t.key]} />
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What waits for them to decide, when anything does (the count beside To Approve). */
async function Waiting({ user }: { user: Session }) {
  const n = await approveCount(user);
  if (!n) return null;
  return (
    <Link href={APP_PATHS.approve} className="card flex min-h-16 items-center justify-between gap-3 border-accent/40 bg-accent-soft px-4 py-3 text-ink no-underline">
      <span>
        <span className="block font-semibold">
          {n} {n === 1 ? 'request waits' : 'requests wait'} for you
        </span>
        <span className="block text-xs text-muted">Approve or reject them on To Approve.</span>
      </span>
      <span aria-hidden="true" className="text-lg text-accent">
        ›
      </span>
    </Link>
  );
}

/** The annual leave left this year, and this month's permission hours left (when Leave Setup gives any). */
async function Balances({ today }: { today: string }) {
  const [balances, month] = await Promise.all([loadMyBalances(Number(today.slice(0, 4))), loadMyPermissionMonth(today.slice(0, 7))]);
  if (balances.kind === 'unavailable' && month.kind === 'unavailable') return null;
  const m = month.kind === 'ok' && month.value.hoursPerMonth > 0 ? month.value : null;
  return (
    <PhoneCard
      title="Balances"
      action={
        <Link href={appRequestsHref('leave')} className="text-sm">
          My leave
        </Link>
      }
    >
      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-canvas px-3 py-2">
          <dt className="text-xs text-muted">Annual leave</dt>
          {balances.kind === 'ok' ? (
            <>
              <dd className="text-lg font-semibold tabular-nums">{daysText(balances.value.annual.available)}</dd>
              <dd className="text-[11px] text-muted">available in {balances.value.year}</dd>
            </>
          ) : (
            <dd className="text-sm text-muted">Couldn&apos;t load</dd>
          )}
        </div>
        <div className="rounded-lg bg-canvas px-3 py-2">
          <dt className="text-xs text-muted">Permission</dt>
          {m ? (
            <>
              <dd className="text-lg font-semibold tabular-nums">{permissionClock(m.left)} left</dd>
              <dd className="text-[11px] text-muted tabular-nums">of {permissionClock(m.hoursPerMonth)} this month</dd>
            </>
          ) : (
            <dd className="text-sm text-muted">{month.kind === 'ok' ? 'Turned off' : 'Couldn’t load'}</dd>
          )}
        </div>
      </dl>
    </PhoneCard>
  );
}

/** Their leave and approved permission coming up, and the next official holidays. */
async function ComingUp({ profile, today }: { profile: EmployeeProfile | null; today: string }) {
  const [leave, permissions, holidays] = await Promise.all([
    profile ? loadMyLeave() : null,
    profile ? loadMyPermissions() : null,
    loadHolidayYears(holidayYears(today)),
  ]);
  const myLeave = leave?.kind === 'ok' ? upcomingLeave(leave.value, today, 3) : [];
  const myHours = permissions?.kind === 'ok' ? upcomingPermissions(permissions.value, today, 3) : [];
  const days = upcomingHolidays(holidays, today, 3);
  return (
    <PhoneCard title="Coming Up" flush>
      {myLeave.length === 0 && myHours.length === 0 && days.length === 0 ? (
        <div className="px-4 pb-4">
          <Quiet>Nothing coming up: no leave, permission or official holiday on file.</Quiet>
        </div>
      ) : (
        <RowList label="Coming up">
          {myLeave.map((r) => (
            <RowLink
              key={`leave:${r.id}`}
              href={appItemHref('requests', 'leave', r.id)}
              title={r.type.nameEn}
              line={
                <span className="tabular-nums">
                  {periodText(r)} · {daysText(r.days)} · {leaveWhenText(r, today)}
                </span>
              }
              aside={<LeaveStatusBadge status={r.status} confidential={r.confidential} />}
            />
          ))}
          {myHours.map((r) => (
            <RowLink
              key={`permission:${r.id}`}
              href={appItemHref('requests', 'permission', r.id)}
              title="Permission"
              line={
                <span className="tabular-nums">
                  {permissionDayText(r)} · {permissionHoursLine(r)} · {permissionInDaysText(r, today)}
                </span>
              }
              aside={<LeaveStatusBadge status={r.status} confidential={r.confidential} />}
            />
          ))}
          {days.map((h) => (
            <li key={`holiday:${h.from}`} className="flex min-h-16 items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {h.nameEn}
                  {h.nameAr && (
                    <span lang="ar" dir="rtl" className="ml-1.5 inline-block text-sm font-normal text-muted">
                      {h.nameAr}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-muted tabular-nums">
                  Official holiday · {holidayWhen(h)}
                  {h.days > 1 ? ` · ${h.days} days` : ''}
                </span>
              </span>
              <span className={`badge shrink-0 ${h.inDays <= 7 ? 'bg-warn-soft text-warn' : ''}`}>{inDaysText(h.inDays)}</span>
            </li>
          ))}
        </RowList>
      )}
    </PhoneCard>
  );
}

function CardLoading({ title }: { title: string }) {
  return (
    <PhoneCard title={title}>
      <Quiet>Loading…</Quiet>
    </PhoneCard>
  );
}

async function Home() {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  const today = todayInCairo();
  const confirm = profile && bannerMessage(profile.confirmation);
  return (
    <div className="space-y-4">
      <h1 className="sr-only">Home</h1>
      {!profile && <NoProfile user={user} />}
      {profile && confirm && (
        <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {confirm}{' '}
          <Link href={`/employees/${profile.id}/confirm`} className="font-semibold text-warn">
            Review on the full site
          </Link>
        </p>
      )}
      {/* fingerprint sign-in next time (owner, 20 October 2026: chose Face ID / fingerprint sign-in for the app): offered
          in the app on an app session, never while viewing as someone; the phone decides whether it can */}
      {!user.viewAs && user.session?.kind === 'app' && <FingerprintOffer />}
      {/* checking in (19 October 2026), the first thing on the phone: a current employment's */}
      {profile?.employment && (
        <Suspense fallback={<CardLoading title="Today" />}>
          <TodayCheckIn big />
        </Suspense>
      )}
      {decidesSomething(user) && (
        <Suspense fallback={null}>
          <Waiting user={user} />
        </Suspense>
      )}
      {profile && (
        <Suspense fallback={null}>
          <Shortcuts profile={profile} today={today} />
        </Suspense>
      )}
      {profile?.employment && underLabourLaw(profile.employment.employmentType) && (
        <Suspense fallback={<CardLoading title="Balances" />}>
          <Balances today={today} />
        </Suspense>
      )}
      <Suspense fallback={<CardLoading title="Coming Up" />}>
        <ComingUp profile={profile} today={today} />
      </Suspense>
    </div>
  );
}

export default function PhoneHomePage() {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <Home />
    </Suspense>
  );
}
