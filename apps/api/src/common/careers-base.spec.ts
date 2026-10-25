import { CAREERS_SITE_STANDARD, careersSiteOf, careersSiteProblem, careersSiteUrl, careersSiteValue, inviteLink, isCareersBase, linkedinFormHref, linkedinRedirectUri } from '@trendlix/shared';

// The careers site's address (25 October 2026: the careers pages moved to www.trendlix.com/en/careers; the owner asked
// that the links stop relying on people.trendlix.com/careers' redirect; packages/shared careers-base.ts): "Careers site
// address" in Recruitment Settings, the standard when unset, and every public careers link built from it. The other
// hosts here are made up.

describe('the careers site’s address', () => {
  it('is the one set, else the website’s CAREERS_BASE_URL, else the standard', () => {
    expect(CAREERS_SITE_STANDARD).toBe('https://www.trendlix.com/en/careers');
    expect(careersSiteOf('https://careers.example.test/jobs/')).toBe('https://careers.example.test/jobs');
    expect(careersSiteOf(null)).toBe(CAREERS_SITE_STANDARD);
    expect(careersSiteOf('  ', undefined)).toBe(CAREERS_SITE_STANDARD);
    expect(careersSiteOf(null, 'https://www.example.test/careers')).toBe('https://www.example.test/careers');
    expect(careersSiteOf('https://careers.example.test', 'https://www.example.test/careers')).toBe('https://careers.example.test');
    // the setting is https only; the fallback may be this computer's, for building on it
    expect(careersSiteOf('http://careers.example.test')).toBe(CAREERS_SITE_STANDARD);
    expect(careersSiteOf(undefined, 'http://localhost:3000/careers')).toBe('http://localhost:3000/careers');
    // one that isn't an address is passed over
    expect(careersSiteOf('www.example.test/careers', 'not an address')).toBe(CAREERS_SITE_STANDARD);
  });

  it('takes an https address with no query or fragment, kept without its slash at the end', () => {
    expect(careersSiteProblem('https://www.trendlix.com/en/careers')).toBeNull();
    expect(careersSiteProblem('https://careers.example.test/')).toBeNull();
    expect(careersSiteProblem('https://www.example.test:8443/en/careers')).toBeNull();
    expect(careersSiteValue(' https://www.trendlix.com/en/careers/ ')).toBe('https://www.trendlix.com/en/careers');
    expect(careersSiteValue('  ')).toBeNull();
    // its scheme and host in lower case, its path as typed
    expect(careersSiteValue('HTTPS://WWW.Trendlix.com/en/Careers/')).toBe('https://www.trendlix.com/en/Careers');
    expect(careersSiteProblem('HTTPS://WWW.Trendlix.com/en/careers')).toBeNull();
    expect(careersSiteProblem('http://www.trendlix.com/en/careers')).toBe('Write the careers site’s address in full, starting with https://, e.g. https://www.trendlix.com/en/careers.');
    expect(careersSiteProblem('www.trendlix.com/en/careers')).toBe('Write the careers site’s address in full, starting with https://, e.g. https://www.trendlix.com/en/careers.');
    expect(careersSiteProblem('https://www.trendlix.com/en/careers?src=hr')).toBe('Leave out the part from ? or # in the careers site’s address: the links add their own.');
    expect(careersSiteProblem('https://www.trendlix.com/en/careers#jobs')).toBe('Leave out the part from ? or # in the careers site’s address: the links add their own.');
    expect(careersSiteProblem('https://trendlix/careers')).toBe('Write the careers site’s address as its job list’s page, e.g. https://www.trendlix.com/en/careers.');
    expect(careersSiteProblem('https://www.trendlix.com/en careers')).toBe('Write the careers site’s address as its job list’s page, e.g. https://www.trendlix.com/en/careers.');
    expect(careersSiteProblem(`https://www.trendlix.com/${'a'.repeat(200)}`)).toBe('Keep the careers site’s address to 200 characters or fewer.');
  });

  it('LinkedIn’s sign-in takes https (http only on this computer), no query or fragment', () => {
    expect(isCareersBase('https://www.example.test/careers')).toBe(true);
    expect(isCareersBase('https://careers.example.test')).toBe(true);
    expect(isCareersBase('http://localhost:3000/careers')).toBe(true);
    expect(isCareersBase('http://www.example.test/careers')).toBe(false);
    expect(isCareersBase('https://www.example.test/careers?x=1')).toBe(false);
  });
});

describe('the public careers links', () => {
  const site = CAREERS_SITE_STANDARD;

  it('a job’s page with the ?src= of its link, “Send us your CV” and the list', () => {
    expect(careersSiteUrl(site, { slug: 'video-editor-vac-2026-0001', src: 'linkedin' })).toBe('https://www.trendlix.com/en/careers/video-editor-vac-2026-0001?src=linkedin');
    // the careers page reached directly has no ?src=
    expect(careersSiteUrl(site, { slug: 'video-editor-vac-2026-0001', src: 'careers' })).toBe('https://www.trendlix.com/en/careers/video-editor-vac-2026-0001');
    expect(careersSiteUrl(site, { slug: 'video-editor-vac-2026-0001' })).toBe('https://www.trendlix.com/en/careers/video-editor-vac-2026-0001');
    expect(careersSiteUrl(site, { slug: 'video-editor-vac-2026-0001', src: 'job_board' })).toBe('https://www.trendlix.com/en/careers/video-editor-vac-2026-0001?src=job_board');
    expect(careersSiteUrl(site, { general: true })).toBe('https://www.trendlix.com/en/careers/general');
    expect(careersSiteUrl(site)).toBe(site);
    // a slash at the end of the address is not doubled
    expect(careersSiteUrl('https://careers.example.test/', { slug: 'a-vac-2026-0002' })).toBe('https://careers.example.test/a-vac-2026-0002');
    expect(careersSiteUrl('https://careers.example.test/', {})).toBe('https://careers.example.test');
  });

  it('the invitation’s link (?src=invite) and LinkedIn’s, all at the address', () => {
    expect(inviteLink(site, 'video-editor-vac-2026-0003')).toBe('https://www.trendlix.com/en/careers/video-editor-vac-2026-0003?src=invite');
    expect(inviteLink('https://careers.example.test', 'video-editor-vac-2026-0003')).toBe('https://careers.example.test/video-editor-vac-2026-0003?src=invite');
    expect(linkedinRedirectUri(site)).toBe('https://www.trendlix.com/en/careers/linkedin/callback');
    expect(linkedinRedirectUri('https://www.example.test/careers')).toBe('https://www.example.test/careers/linkedin/callback');
    expect(linkedinFormHref(site, { kind: 'job', slug: 'video-editor-vac-2026-0001' }, 'facebook')).toBe('https://www.trendlix.com/en/careers/video-editor-vac-2026-0001?src=facebook');
    expect(linkedinFormHref(site, { kind: 'job', slug: 'video-editor-vac-2026-0001' }, 'not a source')).toBe('https://www.trendlix.com/en/careers/video-editor-vac-2026-0001');
    expect(linkedinFormHref(site, { kind: 'general' }, 'linkedin')).toBe('https://www.trendlix.com/en/careers/general');
  });
});
