import { describe, expect, it } from 'vitest';
import type { LinkedInSettingsView } from '@trendlix/shared';
import { linkedinSettingsOf, linkedinStatus, redirectUrlFor, typedLinkedInValues } from './linkedin-settings';

// Recruitment Settings' "LinkedIn Sign-in" (owner, 25 October 2026: "can i use linkedin to complete the data?"; asked,
// "Sign in with LinkedIn"): where it stands, the redirect URL at the careers site's address, and the form read for the API
// (the secret only when pasted, never kept to show again). The ID and secret here are made up.

const view = (over: Partial<LinkedInSettingsView> = {}): LinkedInSettingsView => ({
  enabled: false,
  clientId: null,
  secretSet: false,
  secretUnreadable: false,
  ready: false,
  updatedAt: null,
  updatedBy: null,
  ...over,
});

describe('LinkedIn Sign-in', () => {
  it('gives the redirect URL at the careers site’s address', () => {
    expect(redirectUrlFor('https://www.trendlix.com/en/careers')).toBe('https://www.trendlix.com/en/careers/linkedin/callback');
    expect(redirectUrlFor('https://careers.example.test/jobs/')).toBe('https://careers.example.test/jobs/linkedin/callback');
    expect(redirectUrlFor('http://localhost:3000/careers')).toBe('http://localhost:3000/careers/linkedin/callback');
  });

  it('says where it stands', () => {
    expect(linkedinStatus(view())).toMatchObject({ tone: 'neutral', text: expect.stringContaining('Not set up yet') });
    expect(linkedinStatus(view({ clientId: 'abc123', secretSet: true }))).toMatchObject({ tone: 'neutral', text: expect.stringContaining('Off') });
    expect(linkedinStatus(view({ enabled: true, clientId: 'abc123' }))).toMatchObject({ tone: 'warn' });
    expect(linkedinStatus(view({ enabled: true, clientId: 'abc123', secretSet: true, secretUnreadable: true }))).toMatchObject({ tone: 'warn', text: expect.stringContaining('paste it again') });
    expect(linkedinStatus(view({ enabled: true, clientId: 'abc123', secretSet: true, ready: true }))).toMatchObject({ tone: 'ok' });
  });

  it('sends the secret only when one was pasted, and never keeps it to show again', () => {
    const fd = new FormData();
    fd.set('clientId', ' 86madeupid ');
    fd.set('clientSecret', '');
    fd.set('enabled', 'on');
    expect(linkedinSettingsOf(fd)).toEqual({ enabled: true, clientId: '86madeupid' });
    fd.set('clientSecret', ' made-up-secret ');
    fd.delete('enabled');
    expect(linkedinSettingsOf(fd)).toEqual({ enabled: false, clientId: '86madeupid', clientSecret: 'made-up-secret' });
    expect(typedLinkedInValues(fd)).toEqual({ clientId: '86madeupid' });
    fd.set('clientId', '');
    expect(linkedinSettingsOf(fd).clientId).toBeNull();
  });
});
