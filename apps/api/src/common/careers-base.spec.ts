import { careersBaseOf, careersCookiePath, careersHref, isCareersBase, linkedinFormHref, linkedinRedirectUri } from '@trendlix/shared';

// The careers pages' public address (25 October 2026: the owner moves them to www.trendlix.com/careers, the main site
// proxying /careers/* here; packages/shared careers-base.ts): CAREERS_BASE_URL when set, else the site's own address and
// /careers; every link of the sign-in built from it. The hosts here are made up.

describe('the careers base', () => {
  it('is the address set, else the site’s own and /careers', () => {
    expect(careersBaseOf('https://app.example.test', 'https://www.example.test/careers/')).toBe('https://www.example.test/careers');
    expect(careersBaseOf('https://app.example.test', null)).toBe('https://app.example.test/careers');
    expect(careersBaseOf('https://app.example.test', '  ')).toBe('https://app.example.test/careers');
    expect(careersBaseOf('http://localhost:3000')).toBe('http://localhost:3000/careers');
    // one that isn't an address is passed over
    expect(careersBaseOf('https://app.example.test', 'www.example.test/careers')).toBe('https://app.example.test/careers');
    expect(careersBaseOf(null)).toBeNull();
    expect(careersBaseOf('http://app.example.test')).toBeNull();
  });

  it('takes https (http only on this computer), no query or fragment', () => {
    expect(isCareersBase('https://www.example.test/careers')).toBe(true);
    expect(isCareersBase('https://careers.example.test')).toBe(true);
    expect(isCareersBase('http://www.example.test/careers')).toBe(false);
    expect(isCareersBase('https://www.example.test/careers?x=1')).toBe(false);
  });

  it('builds the pages and the redirect URL from it, and the cookies’ path', () => {
    const www = 'https://www.example.test/careers';
    expect(careersHref(www, '/careers/video-editor-vac-2026-0001?src=linkedin')).toBe('https://www.example.test/careers/video-editor-vac-2026-0001?src=linkedin');
    expect(careersHref(www, '/careers')).toBe(www);
    expect(careersHref('https://careers.example.test', '/careers/general')).toBe('https://careers.example.test/general');
    expect(linkedinRedirectUri(www)).toBe('https://www.example.test/careers/linkedin/callback');
    expect(linkedinFormHref(www, { kind: 'job', slug: 'video-editor-vac-2026-0001' }, 'facebook')).toBe('https://www.example.test/careers/video-editor-vac-2026-0001?src=facebook');
    expect(linkedinFormHref(www, { kind: 'general' })).toBe('https://www.example.test/careers/general');
    expect(careersCookiePath(www)).toBe('/careers');
    expect(careersCookiePath(www, '/linkedin')).toBe('/careers/linkedin');
    expect(careersCookiePath('https://careers.example.test')).toBe('/');
  });
});
