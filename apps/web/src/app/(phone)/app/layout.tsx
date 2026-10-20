import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { brandMetadata } from '@/components/brand';
import { ViewAsBanner } from '@/components/view-as-banner';
import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import type { Session } from '@/lib/view-as';
import { approveCount } from './approve-count';
import { TabBar, TabList } from './tab-bar';
import { tabsFor } from './tabs';
import { TopBar, TopBarFallback } from './top-bar';

// The phone pages (owner, 20 October 2026: "what if we tried to build a mobile app for the employees? to enable them to
// check in and out, and apply for their requests"; apps/mobile/README.md, Phase 1): a phone-first area of the site at
// /app, which the TrendLIX People app shows (a Capacitor shell over these pages) and which works in a phone's browser
// too. Its own layout, not the sidebar's: the top bar with the person's name and the bell, the page, and the tab bar at
// the bottom (Home, Requests, Attendance, Payslips, and To Approve for those who decide something), clear of the
// phone's notch and home bar (viewport-fit=cover and the safe-area insets), one column at 320–430 px and in landscape,
// in the site's colours. Signed out, the proxy sends people to the sign-in page and back here after it, as everywhere.
// Every page reads with the person's session; the API decides what they may see and do, as on the site.

// light only, as the site (it has no dark theme): "only light" also keeps a phone's dark mode from darkening the pages
// itself (the app's web view, Chrome), so they look as the site does
export const viewport: Viewport = { themeColor: '#0e1726', viewportFit: 'cover', colorScheme: 'only light' };

/** The browser tab icon: the company's thumbnail when there is one. */
export async function generateMetadata(): Promise<Metadata> {
  return { title: 'TrendLIX People', ...(await brandMetadata()) };
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
    <div className="flex min-h-dvh flex-col bg-canvas">
      {/* the view-as banner and the top bar stay at the top together as the page scrolls */}
      <div className="sticky top-0 z-30">
        <Suspense fallback={null}>
          <ViewAsBanner />
        </Suspense>
        <header className={`bg-sidebar pt-[env(safe-area-inset-top)] text-white ${SIDES}`}>
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
    </div>
  );
}
