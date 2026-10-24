import { describe, expect, it } from 'vitest';
import { callbackInput, callbackTarget, connectionText, connectsOwnMeetings, meetingBanner, meetingsInMenu, meetingTestText, seesMeetingSettings } from './meetings';

// Online interview meetings on the website (owner, 24 October 2026: "can i link an online meeting service provider to
// automatically generate meeting links?"; "make it both"): who sees the pages, the return from a provider's sign-in,
// and how a connection reads.

const when = (iso: string) => `[${iso}]`;

describe('who sees the meetings pages', () => {
  it('the company’s settings: a Super Admin, never a developer', () => {
    expect(seesMeetingSettings({ roles: ['super_admin'] })).toBe(true);
    expect(seesMeetingSettings({ roles: ['super_admin'], developer: true })).toBe(false);
    for (const r of ['hr', 'admin', 'ceo', 'finance', 'employee'] as const) expect(seesMeetingSettings({ roles: [r] })).toBe(false);
  });

  it('one’s own: those who schedule interviews, HR and a Super Admin; the menu only in their own session', () => {
    expect(connectsOwnMeetings({ roles: ['hr'] })).toBe(true);
    expect(connectsOwnMeetings({ roles: ['super_admin'] })).toBe(true);
    expect(connectsOwnMeetings({ roles: ['ceo'] })).toBe(false);
    expect(connectsOwnMeetings({ roles: ['employee', 'manager'] })).toBe(false);
    expect(connectsOwnMeetings({ roles: ['super_admin'], developer: true })).toBe(false);
    expect(meetingsInMenu({ roles: ['hr'] })).toBe(true);
    expect(meetingsInMenu({ roles: ['hr'], viewAs: { by: { id: 'x', email: 'a@b.c' }, act: true } })).toBe(false);
  });
});

describe('coming back from a provider’s sign-in', () => {
  it('says connected, or why not in the system’s own words, and nothing else from the address', () => {
    expect(meetingBanner({ connected: 'google' })).toEqual({ tone: 'ok', text: 'The Google account is connected.' });
    expect(meetingBanner({ connect: 'zoom', problem: 'denied' })?.text).toBe('Zoom wasn’t allowed access, so nothing was connected. Try again and allow it.');
    expect(meetingBanner({ connect: 'google', problem: 'refused', said: 'redirect_uri_mismatch' })?.text).toContain('refused the return address');
    expect(meetingBanner({ connect: 'microsoft', problem: 'refused', said: 'invalid_client' })?.text).toContain('(invalid_client)');
    // a code that isn't one, or words planted in the address, are never shown
    expect(meetingBanner({ connect: 'microsoft', problem: 'refused', said: 'Call 0100 now!' })?.text).not.toContain('Call');
    expect(meetingBanner({ connect: 'webex', problem: 'denied' })).toBeNull();
    expect(meetingBanner({ connect: 'zoom', problem: 'your account is hacked' })).toBeNull();
    expect(meetingBanner({ connected: '<script>' })).toBeNull();
    expect(meetingBanner({})).toBeNull();
  });

  it('sends the person back to the page they started from, else Your Meetings', () => {
    expect(callbackTarget({ back: '/organization/meetings', ok: true, problem: null, said: null }, 'google')).toBe('/organization/meetings?connected=google');
    expect(callbackTarget({ back: '/account/meetings', ok: false, problem: 'refused', said: 'invalid_grant' }, 'zoom')).toBe('/account/meetings?connect=zoom&problem=refused&said=invalid_grant');
    expect(callbackTarget({ back: 'https://evil.example/', ok: true, problem: null, said: null }, 'microsoft')).toBe('/account/meetings?connected=microsoft');
    expect(callbackTarget({ back: '/organization/meetings', ok: false, problem: null, said: 'bad words here' }, 'google')).toBe('/organization/meetings?connect=google&problem=unreachable');
    expect(callbackTarget(null, 'google', 'not_allowed')).toBe('/account/meetings?connect=google&problem=not_allowed');
  });

  it('passes on the code, the state and the error only, each on one line', () => {
    expect(callbackInput(new URLSearchParams('code=4/abc&state=v1.x&scope=email&error='))).toEqual({ code: '4/abc', state: 'v1.x' });
    expect(callbackInput(new URLSearchParams('error=access_denied&state=s'))).toEqual({ error: 'access_denied', state: 's' });
    expect(callbackInput(new URLSearchParams({ code: 'a\nb' }))).toEqual({});
  });
});

describe('a connection', () => {
  it('reads as whom and since when, or why it needs reconnecting', () => {
    expect(connectionText({ status: 'connected', accountEmail: 'hr@trendlix.com', connectedAt: '2026-10-24T08:00:00.000Z', problem: null }, when)).toBe(
      'Connected as hr@trendlix.com since [2026-10-24T08:00:00.000Z].',
    );
    expect(connectionText({ status: 'needs_reconnecting', accountEmail: 'hr@trendlix.com', connectedAt: 'x', problem: 'Google says the connection was revoked.' }, when)).toBe(
      'Needs reconnecting: Google says the connection was revoked.',
    );
    expect(meetingTestText({ at: 'T', ok: true, message: 'It works.' }, when)).toBe('Last test [T]: It works.');
  });
});
