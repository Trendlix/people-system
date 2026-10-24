import { GOOGLE_SCOPES, MICROSOFT_APPLICATION_PERMISSIONS, MICROSOFT_DELEGATED_PERMISSIONS, ZOOM_COMPANY_SCOPES, ZOOM_PERSONAL_SCOPES, type MeetingSettingsView } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { defaultBody, defaultOptions, hostBody, meetingAppBody, setupSteps } from './setup';

// Organization → Meetings (owner, 24 October 2026: "can i link an online meeting service provider to automatically
// generate meeting links?"; "Google Meet, Microsoft Teams, Zoom"; "make it both").

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
};

const URI = 'https://people.trendlix.com/meetings/oauth/x';

describe('an app’s credentials', () => {
  it('sends what each provider takes, an empty secret box keeping the saved one', () => {
    expect(meetingAppBody('google', form({ clientId: ' 123-abc.apps.googleusercontent.com ', clientSecret: '' }))).toEqual({
      body: { clientId: '123-abc.apps.googleusercontent.com' },
      errors: [],
    });
    expect(meetingAppBody('microsoft', form({ clientId: '1b2c3d4e-0000-4000-8000-000000000001', clientSecret: 's3cret~x', tenantId: 'trendlix.onmicrosoft.com' })).body).toEqual({
      clientId: '1b2c3d4e-0000-4000-8000-000000000001',
      clientSecret: 's3cret~x',
      tenantId: 'trendlix.onmicrosoft.com',
    });
    expect(meetingAppBody('zoom', form({ clientId: 'AbCdEfGh12', accountId: 'AcCoUnT_1234', userClientId: 'UsErApp_99', userClientSecret: 'gen-secret' })).body).toEqual({
      clientId: 'AbCdEfGh12',
      accountId: 'AcCoUnT_1234',
      userClientId: 'UsErApp_99',
      userClientSecret: 'gen-secret',
    });
  });

  it('says what is wrong, as the API would', () => {
    expect(meetingAppBody('google', form({ clientId: 'not-a-google-id' })).errors[0]).toContain('.apps.googleusercontent.com');
    expect(meetingAppBody('microsoft', form({ clientId: 'abc', tenantId: 'not a tenant' })).errors).toHaveLength(2);
  });
});

describe('the host and the default', () => {
  it('takes a host’s address in full', () => {
    expect(hostBody(form({ hostEmail: ' HR@Trendlix.com ' }))).toEqual({ body: { hostEmail: 'hr@trendlix.com' }, errors: [] });
    expect(hostBody(form({ hostEmail: 'hr' })).errors).toEqual(['Write the host’s address in full, e.g. hr@trendlix.com.']);
  });

  it('offers the company’s working connections, or none', () => {
    const app = (provider: 'google' | 'microsoft' | 'zoom', companyReady: boolean) => ({ provider, companyReady }) as MeetingSettingsView['apps'][number];
    const connection = (provider: 'google' | 'microsoft' | 'zoom', status: 'connected' | 'needs_reconnecting') =>
      ({ provider, owner: 'company', status, accountEmail: `${provider}@trendlix.com` }) as MeetingSettingsView['company'][number];
    const options = defaultOptions({ apps: [app('google', true), app('microsoft', true), app('zoom', false)], company: [connection('google', 'connected'), connection('microsoft', 'needs_reconnecting'), connection('zoom', 'connected')] });
    expect(options.map((o) => o.value)).toEqual(['', 'company:google']);
    expect(options[1].label).toBe('Company Google Meet (google@trendlix.com)');
    expect(defaultBody(form({ choice: 'company:zoom' }))).toEqual({ body: { choice: 'company:zoom' }, errors: [] });
    expect(defaultBody(form({ choice: '' }))).toEqual({ body: { choice: null }, errors: [] });
    expect(defaultBody(form({ choice: 'personal:zoom' })).body).toBeNull();
  });
});

describe('the consoles’ steps', () => {
  it('name the redirect URI and the exact scopes and permissions the API asks for', () => {
    const values = (p: 'google' | 'microsoft' | 'zoom') => setupSteps(p, URI).flatMap((s) => s.values ?? []);
    expect(values('google')).toEqual([...GOOGLE_SCOPES, URI]);
    expect(values('microsoft')).toEqual(expect.arrayContaining([URI, ...MICROSOFT_APPLICATION_PERMISSIONS, ...MICROSOFT_DELEGATED_PERMISSIONS]));
    expect(values('zoom')).toEqual([...ZOOM_COMPANY_SCOPES, URI, ...ZOOM_PERSONAL_SCOPES]);
    // Google's consent screen Internal, to need no verification
    expect(setupSteps('google', URI).some((s) => /Internal/.test(s.text) && /verification/.test(s.text))).toBe(true);
    expect(setupSteps('google', URI)[0].text).toContain('trendlix-people');
  });
});
