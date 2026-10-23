import { ACCESS_HOLD_MESSAGE } from '@trendlix/shared';
import type { Metadata, Viewport } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Brand, BrandFallback, brandMetadata } from '@/components/brand';
import { CheckInReminder } from '@/components/check-in-reminder';
import { PushTokenField } from '@/components/push-token-field';
import { SessionWatch } from '@/components/session-watch';
import { ViewAsBanner } from '@/components/view-as-banner';
import { logout } from '@/app/login/actions';
import { getCurrentUser } from '@/lib/session';
import type { Session } from '@/lib/view-as';
import { TodayCheckIn } from '../(app)/my-attendance/check-in-card';
import { PullToRefresh } from '../(phone)/app/pull-to-refresh';
import { PushBridge } from '../(phone)/app/push-bridge';
import { TabBar } from '../(phone)/app/tab-bar';
import { tabsFor } from '../(phone)/app/tabs';

// The Hold page (owner, 23 October 2026: "Access should be on hold with a 7 days grace period one time granted by the
// hr"; asked what still works on Hold: "Check-in/out only", on the website and in the app, so attendance and pay stay
// right). Someone with no contract in force and no grace running sees only this: why, the check-in panel of My
// Attendance (the same one, with the office network and location rules), and Sign out; every other page sends them here
// (components/hold-gate.tsx) and the API refuses everything else. In the app it keeps the phone pages' look, its tabs
// collapsed to Check-in; the check-in reminder keeps working on both. Outside the site's and the phone pages' layouts,
// as the choice page is, since their sidebar and bell are closed to them. Anyone not on hold goes to their home page.

export const viewport: Viewport = { themeColor: '#0e1726', viewportFit: 'cover', colorScheme: 'only light' };

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'On Hold · People System', ...(await brandMetadata()) };
}

const HEADING = 'Your Access Is on Hold';

/** What to do about it: HR renews the contract, or gives 7 days' grace meanwhile. */
const WHAT_NEXT = 'HR renews your contract, or can give you 7 days’ full access meanwhile. Ask HR if you have any questions.';

function SignOut({ className = '' }: { className?: string }) {
  return (
    <form action={logout} className={className}>
      {/* in the app, the phone's push token, unregistered on signing out (Phase 4) */}
      <PushTokenField />
      <button type="submit" className="btn btn-secondary min-h-11 w-full">
        Sign out
      </button>
    </form>
  );
}

/** The message, today's check-in and Sign out, on either look. */
function HoldBody({ user, big }: { user: Session; big: boolean }) {
  return (
    <div className="space-y-4">
      <section className="card space-y-2 p-5" aria-labelledby="hold-heading">
        <h1 id="hold-heading" className="text-xl font-semibold">
          {HEADING}
        </h1>
        {user.name && <p className="text-sm text-muted">{user.name}</p>}
        <p role="status" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
          {ACCESS_HOLD_MESSAGE}
        </p>
        <p className="text-sm text-muted">{WHAT_NEXT}</p>
      </section>
      {/* the same panel as My Attendance's, the larger one in the app */}
      <Suspense fallback={<section className="card p-5 text-sm text-muted">Loading today’s check-in…</section>}>
        <TodayCheckIn big={big} />
      </Suspense>
      <SignOut />
    </div>
  );
}

const SIDES = 'pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]';

/** In the app: the phone pages' look, the top bar with the brand, the tab bar collapsed to Check-in. */
function PhoneHold({ user }: { user: Session }) {
  return (
    <div className="phone-pages flex min-h-dvh flex-col bg-canvas">
      <div className="sticky top-0 z-30" data-phone-header="">
        <Suspense fallback={null}>
          <ViewAsBanner />
        </Suspense>
        <header className={`on-dark bg-sidebar pt-[env(safe-area-inset-top)] text-white ${SIDES}`}>
          <div className="mx-auto flex min-h-14 max-w-xl items-center">
            <Suspense fallback={<BrandFallback dark />}>
              <Brand dark />
            </Suspense>
          </div>
        </header>
      </div>
      <main className={`mx-auto w-full max-w-xl flex-1 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] landscape:pb-[calc(4.5rem+env(safe-area-inset-bottom))] ${SIDES}`}>
        <HoldBody user={user} big />
      </main>
      <TabBar tabs={tabsFor(user)} />
      <Suspense fallback={null}>
        <SessionWatch />
      </Suspense>
      <Suspense fallback={null}>
        <CheckInReminder surface="app" />
      </Suspense>
      <PushBridge />
      <PullToRefresh />
    </div>
  );
}

/** On the website: the brand and the page alone, as the choice page is. */
function SiteHold({ user }: { user: Session }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Suspense fallback={null}>
        <ViewAsBanner />
      </Suspense>
      <Suspense fallback={null}>
        <SessionWatch />
      </Suspense>
      <Suspense fallback={null}>
        <CheckInReminder surface="site" />
      </Suspense>
      <main className="flex flex-1 items-start justify-center px-4 py-12 sm:items-center">
        <div className="w-full max-w-lg">
          <div className="mb-8">
            <Suspense fallback={<BrandFallback />}>
              <Brand />
            </Suspense>
          </div>
          <HoldBody user={user} big={false} />
        </div>
      </main>
    </div>
  );
}

async function Hold() {
  const user = await getCurrentUser();
  const app = user.session?.kind === 'app';
  // not on hold (a contract signed, a grace given since): their home page
  if (!user.hold) redirect(app ? '/app' : '/');
  return app ? <PhoneHold user={user} /> : <SiteHold user={user} />;
}

export default function HoldPage() {
  return (
    <Suspense fallback={<p className="px-4 py-12 text-center text-sm text-muted">Loading…</p>}>
      <Hold />
    </Suspense>
  );
}
