import { describe, expect, it } from 'vitest';
import { checkInHref, checkInReminderOf, nextAskIn, POPUP_EVERY_MS, POPUP_TEXT, popupLine, popupShows, snooze, SNOOZE_KEY, snoozedUntil, trappedFocus } from './check-in-reminder';

// The check-in reminder's popup (owner, 20 October 2026: "a reminder for people that didn't checkin and not on a leave
// every 10 minutes. like a popup"): what it says, where Check in goes, Remind me in 10 minutes kept in the browser, when
// it shows, and the focus kept inside it.

const DUE = { due: true, shiftStart: '09:00', checkInPath: '/my-attendance' };
const NOW = Date.UTC(2026, 9, 20, 7, 5);

/** A browser's storage in memory; `blocked`: every call throws, as in a private window. */
function memory(blocked = false) {
  const kept = new Map<string, string>();
  const check = () => {
    if (blocked) throw new Error('SecurityError');
  };
  return {
    kept,
    getItem: (k: string) => (check(), kept.get(k) ?? null),
    setItem: (k: string, v: string) => (check(), void kept.set(k, v)),
  };
}

describe('the check-in reminder popup', () => {
  it('says it with the owner’s words: the heading in Title Case, the shift’s start on the 12-hour clock', () => {
    expect(POPUP_TEXT).toEqual({ title: 'You Haven’t Checked In Yet', checkIn: 'Check in', later: 'Remind me in 10 minutes' });
    expect(popupLine('09:00')).toBe('Your shift started at 9:00 AM');
    expect(popupLine('13:30:00')).toBe('Your shift started at 1:30 PM');
    expect(popupLine('00:15')).toBe('Your shift started at 12:15 AM');
    for (const odd of [null, undefined, '', 'soon', '25:00']) expect(popupLine(odd)).toBe('Your shift has started');
  });

  it('reads the API’s answer; anything else shows nothing', () => {
    expect(checkInReminderOf(DUE)).toEqual(DUE);
    expect(checkInReminderOf({ due: false, shiftStart: null, checkInPath: '/my-attendance' })).toEqual({ due: false, shiftStart: null, checkInPath: '/my-attendance' });
    // a page that isn't one on this site: My Attendance
    expect(checkInReminderOf({ due: true, shiftStart: '09:00', checkInPath: 'https://evil.example/' })).toEqual(DUE);
    expect(checkInReminderOf({ due: true })).toEqual({ due: true, shiftStart: null, checkInPath: '/my-attendance' });
    for (const odd of [null, undefined, 'yes', 42, {}, { due: 'true' }, { message: 'Not found' }]) expect(checkInReminderOf(odd)).toBeNull();
  });

  it('Check in opens the check-in panel: My Attendance on the site, Home on the phone pages', () => {
    expect(checkInHref('site', DUE)).toBe('/my-attendance');
    expect(checkInHref('site', { checkInPath: '//evil.example' })).toBe('/my-attendance');
    expect(checkInHref('site', null)).toBe('/my-attendance');
    expect(checkInHref('app', DUE)).toBe('/app');
  });

  it('Remind me in 10 minutes: kept in the browser for every tab; storage blocked, the page keeps it', () => {
    const storage = memory();
    expect(snoozedUntil(storage)).toBe(0);
    expect(snooze(storage, NOW)).toBe(NOW + POPUP_EVERY_MS);
    expect(storage.kept.get(SNOOZE_KEY)).toBe(String(NOW + 10 * 60_000));
    expect(snoozedUntil(storage)).toBe(NOW + POPUP_EVERY_MS);
    storage.kept.set(SNOOZE_KEY, 'not a time');
    expect(snoozedUntil(storage)).toBe(0);
    const blocked = memory(true);
    expect(snooze(blocked, NOW)).toBe(NOW + POPUP_EVERY_MS);
    expect(snoozedUntil(blocked)).toBe(0);
    expect(snoozedUntil(null)).toBe(0);
  });

  it('shows while due and not put off, never on the sign-in page or a public one', () => {
    const page = { now: NOW, until: 0, pathname: '/dashboard' };
    expect(popupShows(DUE, page)).toBe(true);
    expect(popupShows(DUE, { ...page, pathname: '/app/requests' })).toBe(true);
    expect(popupShows({ ...DUE, due: false }, page)).toBe(false);
    expect(popupShows(null, page)).toBe(false);
    // put off for 10 minutes: not until then
    expect(popupShows(DUE, { ...page, until: NOW + 1 })).toBe(false);
    expect(popupShows(DUE, { ...page, until: NOW })).toBe(true);
    for (const pathname of ['/login', '/login/fingerprint', '/offer/abc123', '/company-logo']) expect(popupShows(DUE, { ...page, pathname })).toBe(false);
  });

  it('asks again in 10 minutes, or once it is no longer put off', () => {
    expect(nextAskIn(NOW, 0)).toBe(POPUP_EVERY_MS);
    expect(nextAskIn(NOW, NOW + 4 * 60_000)).toBe(POPUP_EVERY_MS);
    expect(nextAskIn(NOW, NOW + 15 * 60_000)).toBe(15 * 60_000);
  });

  it('keeps the focus inside: Tab and Shift+Tab wrap round its controls', () => {
    expect(trappedFocus(0, 2, false)).toBe(1);
    expect(trappedFocus(1, 2, false)).toBe(0);
    expect(trappedFocus(0, 2, true)).toBe(1);
    expect(trappedFocus(1, 2, true)).toBe(0);
    // the focus outside them (the window itself): the first, or the last going back
    expect(trappedFocus(-1, 2, false)).toBe(0);
    expect(trappedFocus(-1, 2, true)).toBe(1);
    expect(trappedFocus(0, 0, false)).toBe(-1);
  });
});
