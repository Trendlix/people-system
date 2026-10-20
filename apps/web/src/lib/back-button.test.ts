import { describe, expect, it } from 'vitest';
import { backAction, EXIT_WINDOW_MS, isPhonePath, isRootPath, previousPath, upFrom, type BackPress } from './back-button';

const SITE = 'https://people.trendlix.com';

/** A press on `pathname`, the page before it `previous`, nothing open and no hint shown. */
const press = (pathname: string, previous: string | null | undefined, more: Partial<BackPress> = {}): BackPress => ({
  pathname,
  previous,
  canGoBack: previous !== null,
  open: false,
  hintAt: null,
  now: 10_000,
  ...more,
});

describe('the phone pages and where back leaves the app', () => {
  it('tells the phone pages from the full site', () => {
    expect(isPhonePath('/app')).toBe(true);
    expect(isPhonePath('/app/')).toBe(true);
    expect(isPhonePath('/app/requests/leave/1')).toBe(true);
    expect(isPhonePath('/applications')).toBe(false);
    expect(isPhonePath('/')).toBe(false);
    expect(isPhonePath('/approvals')).toBe(false);
  });

  it('leaves the app from Home and the sign-in page only', () => {
    expect(isRootPath('/app')).toBe(true);
    expect(isRootPath('/app/')).toBe(true);
    expect(isRootPath('/login')).toBe(true);
    expect(isRootPath('/app/requests')).toBe(false);
    expect(isRootPath('/')).toBe(false);
  });

  it('goes up the phone pages: a request to its tab, a tab to Home, never out of them', () => {
    expect(upFrom('/app/requests/leave/abc')).toBe('/app/requests');
    expect(upFrom('/app/approve/reimbursement/abc')).toBe('/app/approve');
    expect(upFrom('/app/payslips/abc')).toBe('/app/payslips');
    expect(upFrom('/app/requests/new/leave')).toBe('/app/requests/new');
    expect(upFrom('/app/requests/new')).toBe('/app/requests');
    expect(upFrom('/app/requests')).toBe('/app');
    expect(upFrom('/app/attendance')).toBe('/app');
    expect(upFrom('/app/notifications')).toBe('/app');
    expect(upFrom('/app/unknown/page')).toBe('/app');
    expect(upFrom('/approvals')).toBe('/app');
  });
});

describe('the page before, from the Navigation API', () => {
  const nav = (urls: string[], index: number) => ({ entries: () => urls.map((url) => ({ url })), currentEntry: { index } });

  it('is the previous entry’s path on the site', () => {
    expect(previousPath(nav([`${SITE}/app`, `${SITE}/app/requests?kind=leave`], 1), SITE)).toBe('/app');
    expect(previousPath(nav([`${SITE}/login?next=%2Fapp`, `${SITE}/app/requests`], 1), SITE)).toBe('/login');
  });

  it('is none for the first page opened, or another site’s', () => {
    expect(previousPath(nav([`${SITE}/app/requests`], 0), SITE)).toBeNull();
    expect(previousPath(nav(['https://example.com/', `${SITE}/app/requests`], 1), SITE)).toBeNull();
    expect(previousPath({ entries: () => [{ url: null }, { url: `${SITE}/app` }], currentEntry: { index: 1 } }, SITE)).toBeNull();
  });

  it('is not known without the Navigation API', () => {
    expect(previousPath(undefined, SITE)).toBeUndefined();
    expect(previousPath({}, SITE)).toBeUndefined();
    expect(previousPath({ entries: () => [], currentEntry: null }, SITE)).toBeUndefined();
    expect(
      previousPath(
        {
          entries: () => {
            throw new Error('x');
          },
          currentEntry: { index: 2 },
        },
        SITE,
      ),
    ).toBeUndefined();
  });
});

describe('a press of the back button', () => {
  it('closes what is open over the page first', () => {
    expect(backAction(press('/app/requests/leave/1', '/app/requests', { open: true }))).toEqual({ kind: 'close' });
    expect(backAction(press('/app', null, { open: true }))).toEqual({ kind: 'close' });
  });

  it('on Home: the hint, then leaving the app on a second press within 2 seconds', () => {
    expect(backAction(press('/app', '/app/requests'))).toEqual({ kind: 'hint' });
    expect(backAction(press('/app', null, { hintAt: 9_000 }))).toEqual({ kind: 'exit' });
    expect(backAction(press('/app', null, { hintAt: 10_000 - EXIT_WINDOW_MS }))).toEqual({ kind: 'exit' });
    // too late: the hint again
    expect(backAction(press('/app', null, { hintAt: 10_000 - EXIT_WINDOW_MS - 1 }))).toEqual({ kind: 'hint' });
    // a clock that went back: the hint again
    expect(backAction(press('/app', null, { hintAt: 12_000 }))).toEqual({ kind: 'hint' });
  });

  it('on the sign-in page: the same, never back to a page that sends here again', () => {
    expect(backAction(press('/login', '/app'))).toEqual({ kind: 'hint' });
    expect(backAction(press('/login', '/app', { hintAt: 9_500 }))).toEqual({ kind: 'exit' });
  });

  it('goes back on the phone pages when the page before is one of them', () => {
    expect(backAction(press('/app/requests', '/app'))).toEqual({ kind: 'back' });
    expect(backAction(press('/app/requests/leave/1', '/app/requests'))).toEqual({ kind: 'back' });
  });

  it('never goes back from the phone pages to the full site or out of the app: the phone page above instead', () => {
    expect(backAction(press('/app/requests', '/'))).toEqual({ kind: 'go', href: '/app' });
    expect(backAction(press('/app/requests/leave/1', '/leave/1'))).toEqual({ kind: 'go', href: '/app/requests' });
    expect(backAction(press('/app/approve/leave/1', '/login'))).toEqual({ kind: 'go', href: '/app/approve' });
    expect(backAction(press('/app/payslips/1', null))).toEqual({ kind: 'go', href: '/app/payslips' });
    // not known (no Navigation API): up, which is always a phone page
    expect(backAction(press('/app/requests/new/leave', undefined, { canGoBack: true }))).toEqual({ kind: 'go', href: '/app/requests/new' });
    // the web view has nothing to go back to
    expect(backAction(press('/app/requests', '/app', { canGoBack: false }))).toEqual({ kind: 'go', href: '/app' });
  });

  it('on a page of the full site opened from the app: back, or Home when there is nothing of the site before it', () => {
    expect(backAction(press('/', '/app'))).toEqual({ kind: 'back' });
    expect(backAction(press('/account/password', undefined, { canGoBack: true }))).toEqual({ kind: 'back' });
    expect(backAction(press('/approvals', null))).toEqual({ kind: 'go', href: '/app' });
    expect(backAction(press('/approvals', '/', { canGoBack: false }))).toEqual({ kind: 'go', href: '/app' });
  });
});
