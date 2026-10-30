import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { brandMetadata } from '@/components/brand';
import { CheckInReminder } from '@/components/check-in-reminder';
import { SessionWatch } from '@/components/session-watch';
import { DeveloperBanner } from '@/components/developer-banner';
import { ModeGate } from '@/components/mode-gate';
import { HoldGate } from '@/components/hold-gate';
import { ViewAsBanner } from '@/components/view-as-banner';
import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import type { Session } from '@/lib/view-as';
import { approveCount } from './approve-count';
import { PullToRefresh } from './pull-to-refresh';
import { PushBridge } from './push-bridge';
import { TabBar, TabList } from './tab-bar';
import { tabsFor } from './tabs';
import { TopBar, TopBarFallback } from './top-bar';

// The phone pages (owner, 20 October 2026: "what if we tried to build a mobile app for the employees? to enable them to
// check in and out, and apply for their requests"; apps/mobile/README.md, Phase 1): a phone-first area of the site at
// /app, which the Trendlix People app shows (a Capacitor shell over these pages) and which works in a phone's browser
// too. Its own layout, not the sidebar's: the top bar with the person's name and the bell, the page, and the tab bar at
// the bottom (Home, Requests, Attendance, Payslips, and To Approve for those who decide something), clear of the
// phone's notch and home bar (viewport-fit=cover and the safe-area insets), one column at 320–430 px and in landscape,
// in the site's colours. Signed out, the proxy sends people to the sign-in page and back here after it, as everywhere.
// Every page reads with the person's session; the API decides what they may see and do, as on the site. Phase 5 (20
// October 2026): pull to refresh at the top of every page, and a clear focus ring on everything that takes a tap
// (globals.css, .phone-pages).

// light only, as the site (it has no dark theme): "only light" also keeps a phone's dark mode from darkening the pages
// itself (the app's web view, Chrome), so they look as the site does
export const viewport: Viewport = { themeColor: '#0e1726', viewportFit: 'cover', colorScheme: 'only light' };

/** The browser tab icon: the company's thumbnail when there is one. */
export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Trendlix People', ...(await brandMetadata()) };
}

/** The tab bar for the signed-in user, with how many things wait for them on To Approve. */
async function Tabs() {
  let user: Session | null = null;
  try {
    user = await getCurrentUser();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  const waiting = user ? await approveCount(user) : 0;
  return <TabBar tabs={tabsFor(user)} counts={{ approve: waiting }} />;
}

const SIDES = 'pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]';

export default function PhoneLayout({ children }: LayoutProps<'/app'>) {
  return (
    <div className="phone-pages flex min-h-dvh flex-col bg-canvas">
      {/* the view-as banner and the top bar stay at the top together as the page scrolls (pull to refresh comes from
          under them) */}
      <div className="sticky top-0 z-30" data-phone-header="">
        {/* the phone pages opened on the website by a developer who hasn't chosen yet: the choice page (in the app they
            are always themselves; 22 October 2026) */}
        <Suspense fallback={null}>
          <ModeGate />
          {/* someone whose access is on hold: the Hold page, its one tab Check-In (owner, 23 October 2026: "Check-in/out
              only") */}
          <HoldGate />
          <ViewAsBanner />
          <DeveloperBanner />
        </Suspense>
        <header className={`on-dark bg-sidebar pt-[env(safe-area-inset-top)] text-sidebar-ink ${SIDES}`}>
          <div className="mx-auto flex min-h-14 max-w-xl items-center">
            <Suspense fallback={<TopBarFallback />}>
              <TopBar />
            </Suspense>
          </div>
        </header>
      </div>
      <main className={`mx-auto w-full max-w-xl flex-1 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] landscape:pb-[calc(4.5rem+env(safe-area-inset-bottom))] ${SIDES}`}>
        {children}
      </main>
      <Suspense fallback={<TabList tabs={tabsFor(null)} active={null} />}>
        <Tabs />
      </Suspense>
      {/* the warning a minute before HR, Admin and Super Admin are signed out after 15 minutes (20 October 2026) */}
      <Suspense fallback={null}>
        <SessionWatch />
      </Suspense>
      {/* "You haven't checked in yet" (owner, 20 October 2026: "a reminder for people that didn't checkin and not on a
          leave every 10 minutes. like a popup"), Check in opening Home; never while viewing as someone */}
      <Suspense fallback={null}>
        <CheckInReminder surface="app" />
      </Suspense>
      {/* push notifications inside the app (Phase 4, 20 October 2026): registered again on each open once allowed, and a
          notification tapped opens its page here */}
      <PushBridge />
      {/* pull down at the top of a page to read it again (Phase 5, 20 October 2026) */}
      <PullToRefresh />
    </div>
  );
}
