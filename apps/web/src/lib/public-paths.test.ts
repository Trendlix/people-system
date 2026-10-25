import { describe, expect, it } from 'vitest';
import { careersRewrite, isPublicPath } from './public-paths';

describe('pages open without signing in', () => {
  it('are the sign-in page and the company logo and thumbnail', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/company-logo')).toBe(true);
    expect(isPublicPath('/company-thumbnail')).toBe(true);
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/employees')).toBe(false);
  });

  it('include the set-password page and Forgot password (22 October 2026), but nothing under them', () => {
    expect(isPublicPath('/set-password')).toBe(true);
    expect(isPublicPath('/forgot-password')).toBe(true);
    expect(isPublicPath('/set-password/other')).toBe(false);
  });

  it("include a candidate's job offer and its document, but not HR's offers", () => {
    expect(isPublicPath('/offer/Xy3_k-9aBcDeFgHiJkLmNoPq')).toBe(true);
    expect(isPublicPath('/offer/Xy3_k-9aBcDeFgHiJkLmNoPq/document')).toBe(true);
    expect(isPublicPath('/offer')).toBe(false);
    expect(isPublicPath('/offers')).toBe(false);
    expect(isPublicPath('/offers/0b6f6c1e-7a5e-4a63-9d43-2f1f7f0e0c11')).toBe(false);
    expect(isPublicPath('/offers/new')).toBe(false);
  });

  it('include what Claude calls for the connector, but not the sign-in and consent page', () => {
    for (const path of [
      '/api/mcp',
      '/oauth/token',
      '/oauth/register',
      '/oauth/revoke',
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/api/mcp',
      '/.well-known/oauth-authorization-server',
    ]) {
      expect(isPublicPath(path)).toBe(true);
    }
    expect(isPublicPath('/oauth/authorize')).toBe(false);
    expect(isPublicPath('/api/mcp/other')).toBe(false);
    expect(isPublicPath('/assets/connect-claude')).toBe(false);
    expect(isPublicPath('/.well-known/other')).toBe(false);
  });
});

// Meta's WhatsApp webhook (owner, 24 October 2026: "how to make whatsapp notifications?").
describe('the WhatsApp webhook', () => {
  it('is open without signing in, nothing under it nor the settings', () => {
    expect(isPublicPath('/whatsapp/webhook')).toBe(true);
    expect(isPublicPath('/whatsapp/webhook/other')).toBe(false);
    expect(isPublicPath('/whatsapp')).toBe(false);
    expect(isPublicPath('/whatsapp-messages')).toBe(false);
    expect(isPublicPath('/organization/whatsapp')).toBe(false);
  });

  it('through Twilio too (25 October 2026: "Add Twilio as a choice"): its status callback and incoming messages, nothing else', () => {
    expect(isPublicPath('/whatsapp/twilio/status')).toBe(true);
    expect(isPublicPath('/whatsapp/twilio/incoming')).toBe(true);
    expect(isPublicPath('/whatsapp/twilio')).toBe(false);
    expect(isPublicPath('/whatsapp/twilio/other')).toBe(false);
  });
});

// The careers page (owner, 22 October 2026: "where will we include the ATS?").
describe('the careers page', () => {
  it('is open without signing in, its jobs and their forms too', () => {
    expect(isPublicPath('/careers')).toBe(true);
    expect(isPublicPath('/careers/video-producer-vac-2026-0003')).toBe(true);
    expect(isPublicPath('/recruitment/vacancies')).toBe(false);
  });

  it('answers on careers.<domain> alone, once it points here: everything there is a careers page', () => {
    expect(careersRewrite('careers.trendlix.com', '/')).toBe('/careers');
    expect(careersRewrite('careers.trendlix.com', '/video-producer-vac-2026-0003')).toBe('/careers/video-producer-vac-2026-0003');
    expect(careersRewrite('careers.trendlix.com', '/login')).toBe('/careers/login');
    expect(careersRewrite('careers.trendlix.com:443', '/careers/x')).toBeNull();
    expect(careersRewrite('careers.trendlix.com', '/company-logo')).toBeNull();
    expect(careersRewrite('people.trendlix.com', '/')).toBeNull();
    expect(careersRewrite(null, '/')).toBeNull();
  });
});
