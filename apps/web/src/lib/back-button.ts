import { APP_PATHS } from './surface';

// What Android's back button does in the app (owner, 20 October 2026: the employee app; apps/mobile/README.md, Phase 5:
// "With history, go back. At /app Home, a second press within 2 seconds exits the app, after a short 'Press back again to
// exit' toast. Never leave the app for the site's desktop pages."). The Capacitor App plugin tells of each press
// (lib/native.ts onBackButton) and components/app-back-button.tsx does what this says. Pure code, tested; no "@/" imports.

/** How long after the hint a second press leaves the app. */
export const EXIT_WINDOW_MS = 2000;

/** The hint after the first press where back leaves the app. */
export const EXIT_HINT = 'Press back again to exit';

/** The sign-in page: behind it is nothing to go back to (a page that sends the signed-out person here again). */
const SIGN_IN = '/login';

/** A path without a trailing slash ("/app/" → "/app"). */
const pathOnly = (pathname: string): string => (pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname);

/** Whether an address is one of the phone pages: /app and every page under it. */
export function isPhonePath(pathname: string): boolean {
  const path = pathOnly(pathname);
  return path === APP_PATHS.home || path.startsWith(`${APP_PATHS.home}/`);
}

/** Where back leaves the app: the phone pages' Home, and the sign-in page. */
export function isRootPath(pathname: string): boolean {
  const path = pathOnly(pathname);
  return path === APP_PATHS.home || path === SIGN_IN;
}

/** The phone pages' sections that list what their pages open (each a tab). */
const SECTIONS = [APP_PATHS.requests, APP_PATHS.attendance, APP_PATHS.payslips, APP_PATHS.approve].map((p) => p.slice(APP_PATHS.home.length + 1));

/**
 * The phone page above this one, when there is no phone page behind it to go back to: a new request of a kind → New
 * Request, New Request → My Requests, a request or a payslip → its tab, a tab or the inbox → Home.
 */
export function upFrom(pathname: string): string {
  const [first, ...rest] = pathOnly(pathname).split('/').filter(Boolean);
  if (first !== 'app' || rest.length < 2) return APP_PATHS.home;
  if (`/app/${rest[0]}/${rest[1]}` === APP_PATHS.newRequest) return rest.length > 2 ? APP_PATHS.newRequest : APP_PATHS.requests;
  return SECTIONS.includes(rest[0]) ? `/app/${rest[0]}` : APP_PATHS.home;
}

/** The part of the browser's Navigation API read here (Chrome 102+, so Android's web view). */
export interface NavigationLike {
  entries?: () => readonly { url?: string | null }[];
  currentEntry?: { index?: number } | null;
}

/**
 * The page before this one, from the Navigation API: its path; null when there is none of the site's (the first page
 * opened, or another site's); undefined when it can't be known (no Navigation API).
 */
export function previousPath(navigation: NavigationLike | null | undefined, origin: string): string | null | undefined {
  const index = navigation?.currentEntry?.index;
  if (typeof navigation?.entries !== 'function' || typeof index !== 'number' || index < 0) return undefined;
  if (index === 0) return null;
  let url: string | null | undefined;
  try {
    url = navigation.entries()[index - 1]?.url;
  } catch {
    return undefined;
  }
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.origin === origin ? u.pathname : null;
  } catch {
    return null;
  }
}

/** What a press does: close what is open over the page; the page before; a phone page in place of this one; the hint; leave. */
export type BackAction = { kind: 'close' } | { kind: 'back' } | { kind: 'go'; href: string } | { kind: 'hint' } | { kind: 'exit' };

export interface BackPress {
  /** The page's path. */
  pathname: string;
  /** The page before it (previousPath): its path, null for none of the site's, undefined when not known. */
  previous: string | null | undefined;
  /** The web view has a page to go back to (the App plugin's word). */
  canGoBack: boolean;
  /** A pop-up window (a modal dialog, e.g. the document viewer) or the top bar's menu is open over the page. */
  open: boolean;
  /** When the hint was last shown (ms), null when it wasn't. */
  hintAt: number | null;
  now: number;
}

/**
 * What a press of the back button does, inside the app:
 * - something open over the page (a pop-up window, the menu): it is closed;
 * - on the phone pages' Home or the sign-in page: "Press back again to exit", and a second press within 2 seconds
 *   leaves the app;
 * - on another phone page: back when the page before is a phone page too; else the phone page above it (never a page of
 *   the full site, nor out of the app);
 * - on a page of the full site opened from the app: back when there is a page of the site before it; else Home.
 */
export function backAction(press: BackPress): BackAction {
  if (press.open) return { kind: 'close' };
  if (isRootPath(press.pathname)) {
    const since = press.hintAt === null ? null : press.now - press.hintAt;
    return since !== null && since >= 0 && since <= EXIT_WINDOW_MS ? { kind: 'exit' } : { kind: 'hint' };
  }
  if (isPhonePath(press.pathname)) {
    return press.canGoBack && typeof press.previous === 'string' && isPhonePath(press.previous) ? { kind: 'back' } : { kind: 'go', href: upFrom(press.pathname) };
  }
  return press.canGoBack && press.previous !== null ? { kind: 'back' } : { kind: 'go', href: APP_PATHS.home };
}
