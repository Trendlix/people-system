import { GOOGLE_BUSY_SCOPES, MICROSOFT_APPLICATION_PERMISSIONS, MICROSOFT_BUSY_PERMISSIONS, ZOHO_CALENDAR_SCOPES } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { dataCentreOptions, otherSteps, testBody, zohoAppBody, zohoStatus, zohoSteps } from './setup';

// Organization → Calendars (owner, 25 October 2026: "its zoho mails"): what the forms send, and the exact steps with the
// values the API asks for.

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

describe('the Zoho app form', () => {
  it('sends the client ID and the data centre, the secret only when typed', () => {
    expect(zohoAppBody(form({ clientId: ' 1000.ABCDEFGHIJ1234567890 ', clientSecret: '', dataCentre: 'eu' }))).toEqual({
      body: { clientId: '1000.ABCDEFGHIJ1234567890', dataCentre: 'eu' },
      errors: [],
    });
    expect(zohoAppBody(form({ clientId: '1000.ABCDEFGHIJ1234567890', clientSecret: 'abc123', dataCentre: 'com' })).body.clientSecret).toBe('abc123');
  });

  it('says what is wrong, with the API’s own checks', () => {
    expect(zohoAppBody(form({ clientId: 'abc', clientSecret: '', dataCentre: 'mars' })).errors).toEqual([
      'A Zoho client ID looks like 1000.ABC123…: copy it from api-console.zoho.com → your app → Client Secret.',
      'Choose the data centre the company’s Zoho account is in.',
    ]);
  });

  it('offers every data centre', () => {
    expect(dataCentreOptions().map((o) => o.value)).toEqual(['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa', 'uk', 'ae', 'sg']);
  });
});

describe('the test', () => {
  it('checks the connected account’s own, or a colleague’s by their work email', () => {
    expect(testBody(form({ email: '' }))).toEqual({ body: { email: null }, errors: [] });
    expect(testBody(form({ email: ' Sara@Trendlix.com ' }))).toEqual({ body: { email: 'sara@trendlix.com' }, errors: [] });
    expect(testBody(form({ email: 'sara' })).errors).toEqual(['Write the colleague’s work email in full, e.g. name@trendlix.com.']);
  });
});

describe('the steps', () => {
  it('name the redirect URI, the homepage and the exact scopes the API asks for', () => {
    const steps = zohoSteps('https://people.trendlix.com/calendars/oauth/zoho', 'https://people.trendlix.com');
    const values = steps.flatMap((s) => s.values ?? []);
    expect(values).toEqual(['https://people.trendlix.com', 'https://people.trendlix.com/calendars/oauth/zoho', ...ZOHO_CALENDAR_SCOPES]);
    expect(steps.some((s) => s.text.includes('only with organization users'))).toBe(true);
  });

  it('give Google’s and Microsoft’s redirect URIs and their free/busy permissions', () => {
    const values = otherSteps('G', 'M').flatMap((s) => s.values ?? []);
    expect(values).toEqual(['G', ...GOOGLE_BUSY_SCOPES, 'M', ...MICROSOFT_BUSY_PERMISSIONS, ...MICROSOFT_APPLICATION_PERMISSIONS]);
  });

  it('say where the company’s Zoho stands', () => {
    expect(zohoStatus({ ready: false }, false)).toContain('isn’t set up yet');
    expect(zohoStatus({ ready: true }, false)).toContain('connect the company’s Zoho account');
    expect(zohoStatus({ ready: true }, true)).toContain('Nobody needs to connect anything');
  });
});
