import { describe, expect, it } from 'vitest';
import {
  calendarBanner,
  calendarCallbackInput,
  calendarCallbackTarget,
  calendarConnectionText,
  calendarTestText,
  hasInterviewHours,
  interviewHoursInMenu,
  seesCalendarSettings,
} from './calendars';

// Calendars read for interviewers' busy times (owner, 25 October 2026: "Hours + calendar"; "its zoho mails"): who sees
// the pages, the return from a calendar's sign-in, and how a connection reads.

const when = (iso: string) => `[${iso}]`;
const viewAs = { by: { id: 'x', email: 'a@b.c' }, act: true };

describe('who sees the calendar pages', () => {
  it('the company’s settings: a Super Admin, never a developer', () => {
    expect(seesCalendarSettings({ roles: ['super_admin'] })).toBe(true);
    expect(seesCalendarSettings({ roles: ['super_admin'], developer: true })).toBe(false);
    for (const r of ['hr', 'admin', 'ceo', 'finance', 'employee'] as const) expect(seesCalendarSettings({ roles: [r] })).toBe(false);
  });

  it('one’s own interview hours: anyone with an employee profile, never a developer; the menu in their own session', () => {
    expect(hasInterviewHours({ roles: ['employee'], employeeId: 'e1' })).toBe(true);
    expect(hasInterviewHours({ roles: ['hr'], employeeId: null })).toBe(false);
    expect(hasInterviewHours({ roles: ['employee'], employeeId: 'e1', developer: true })).toBe(false);
    expect(interviewHoursInMenu({ roles: ['manager'], employeeId: 'e1' })).toBe(true);
    expect(interviewHoursInMenu({ roles: ['manager'], employeeId: 'e1', viewAs })).toBe(false);
  });
});

describe('coming back from a calendar’s sign-in', () => {
  it('says connected, or why not in the system’s own words, and nothing else from the address', () => {
    expect(calendarBanner({ connected: 'zoho' })).toEqual({ tone: 'ok', text: 'The Zoho account is connected: its busy times are read from now on.' });
    expect(calendarBanner({ connect: 'google', problem: 'denied' })).toEqual({
      tone: 'danger',
      text: 'Google wasn’t allowed to share the busy times, so nothing was connected. Try again and allow it.',
    });
    expect(calendarBanner({ connect: 'zoho', problem: 'no_app' })?.text).toBe('The company’s Zoho app isn’t set up yet: a Super Admin sets it up on Organization → Calendars.');
    expect(calendarBanner({ connect: 'microsoft', problem: 'no_app' })?.text).toBe('The company’s Microsoft app isn’t set up yet: a Super Admin sets it up on Organization → Meetings.');
    expect(calendarBanner({ connect: 'zoho', problem: 'refused', said: 'invalid_client' })?.text).toBe(
      'Zoho refused the sign-in (invalid_client). Check the app’s settings on Organization → Calendars, then try again.',
    );
    expect(calendarBanner({ connect: 'zoho', problem: 'refused', said: '<script>' })?.text).toBe('Zoho refused the sign-in. Check the app’s settings on Organization → Calendars, then try again.');
    expect(calendarBanner({ connect: 'zoho', problem: 'refused', said: 'redirect_uri_mismatch' })?.text).toContain('add the redirect URI shown on Organization → Calendars');
    expect(calendarBanner({ connected: 'zoom' })).toBeNull();
    expect(calendarBanner({ connect: 'zoho', problem: 'anything' })).toBeNull();
    expect(calendarBanner({})).toBeNull();
  });

  it('returns to the page it was started from, only one of the two', () => {
    expect(calendarCallbackTarget({ back: '/organization/calendars', ok: true, problem: null, said: null }, 'zoho')).toBe('/organization/calendars?connected=zoho');
    expect(calendarCallbackTarget({ back: '/account/interview-hours', ok: false, problem: 'refused', said: 'invalid_grant' }, 'google')).toBe(
      '/account/interview-hours?connect=google&problem=refused&said=invalid_grant',
    );
    expect(calendarCallbackTarget({ back: 'https://evil.example/', ok: true, problem: null, said: null }, 'microsoft')).toBe('/account/interview-hours?connected=microsoft');
    expect(calendarCallbackTarget(null, 'zoho', 'not_allowed')).toBe('/account/interview-hours?connect=zoho&problem=not_allowed');
    expect(calendarCallbackTarget(null, 'zoho')).toBe('/account/interview-hours?connect=zoho&problem=unreachable');
  });

  it('passes on the code, the state, the error and Zoho’s sign-in address, nothing else', () => {
    const params = new URLSearchParams({ code: '1000.abc', state: 'v1:x', 'accounts-server': 'https://accounts.zoho.eu', location: 'eu', other: 'x' });
    expect(calendarCallbackInput(params)).toEqual({ code: '1000.abc', state: 'v1:x', accountsServer: 'https://accounts.zoho.eu' });
    expect(calendarCallbackInput(new URLSearchParams({ 'accounts-server': 'http://accounts.zoho.eu' }))).toEqual({});
    expect(calendarCallbackInput(new URLSearchParams({ 'accounts-server': 'https://evil.example' }))).toEqual({});
    expect(calendarCallbackInput(new URLSearchParams({ error: 'access_denied', code: 'a\nb' }))).toEqual({ error: 'access_denied' });
  });
});

describe('a connection in words', () => {
  it('connected as whom and since when, or why it needs reconnecting', () => {
    expect(calendarConnectionText({ status: 'connected', accountEmail: 'hr@trendlix.com', connectedAt: 'T', problem: null }, when)).toBe('Connected as hr@trendlix.com since [T].');
    expect(calendarConnectionText({ status: 'needs_reconnecting', accountEmail: 'x', connectedAt: 'T', problem: 'Zoho refused the sign-in.' }, when)).toBe(
      'Needs reconnecting: Zoho refused the sign-in.',
    );
    expect(calendarTestText({ at: 'T', ok: true, message: 'Zoho answered.' }, when)).toBe('Last check [T]: Zoho answered.');
  });
});
