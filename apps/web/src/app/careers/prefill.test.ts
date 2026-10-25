import { describe, expect, it } from 'vitest';
import { NO_PREFILL, type PortfolioAsk } from '@trendlix/shared';
import { isLinkedInAuthorizeUrl, linkedinCookie, linkedinReturnUrl } from './linkedin/linkedin-return';
import {
  cvFieldValues,
  draftFrom,
  draftOf,
  emptyFieldsPatch,
  linkedinFieldValues,
  linkedinStartHref,
  platformLabelOf,
  portfolioBoxesPatch,
  withoutLinkedInParam,
} from './prefill';

// The careers forms filled in for the person to check (owner, 25 October 2026, on "Apply for This Job": "can i use
// linkedin to complete the data?"; asked, "Fill the form from the CV" and "Sign in with LinkedIn"; and "Portfolio per
// position"): only the empty fields, the CV's links in empty boxes of a kind the position takes, a link's platform, the
// fields kept while away at LinkedIn, and where the sign-in sends the browser. Every name and address is made up.

describe('filling only the empty fields', () => {
  it('never writes over what was typed, and leaves out what wasn’t found', () => {
    expect(emptyFieldsPatch({ fullName: '', email: 'typed@mail.test', mobile: '  ' }, { fullName: 'Mona Adel', email: 'cv@mail.test', mobile: '+201001234567', linkedin: '' })).toEqual({
      fullName: 'Mona Adel',
      mobile: '+201001234567',
    });
    expect(emptyFieldsPatch({ fullName: 'Mona' }, { fullName: 'Mona Adel' })).toEqual({});
    expect(emptyFieldsPatch({}, {})).toEqual({});
  });

  it('takes the CV’s fields as the form’s, the years as text', () => {
    expect(
      cvFieldValues({ ...NO_PREFILL, fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '+201001234567', linkedin: 'https://www.linkedin.com/in/mona-adel', yearsExperience: 4 }),
    ).toEqual({ fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '+201001234567', linkedin: 'https://www.linkedin.com/in/mona-adel', yearsExperience: '4' });
    expect(cvFieldValues({ ...NO_PREFILL, yearsExperience: 0 })).toEqual({ yearsExperience: '0' });
    expect(cvFieldValues(NO_PREFILL)).toEqual({});
  });

  it('takes LinkedIn’s name and email only', () => {
    expect(linkedinFieldValues({ fullName: 'Mona Adel', email: 'mona@mail.test' })).toEqual({ fullName: 'Mona Adel', email: 'mona@mail.test' });
    expect(linkedinFieldValues({ fullName: null, email: 'mona@mail.test' })).toEqual({ email: 'mona@mail.test' });
  });
});

describe('the CV’s portfolio links', () => {
  const SHOWREEL: PortfolioAsk = { mode: 'required', hint: null, kinds: ['vimeo', 'youtube'], maxLinks: 2 };
  const found = [
    { url: 'https://github.com/mona', kind: 'github' as const },
    { url: 'https://vimeo.com/123456', kind: 'vimeo' as const },
    { url: 'https://youtu.be/abcdef12', kind: 'youtube' as const },
    { url: 'https://vimeo.com/999999', kind: 'vimeo' as const },
  ];

  it('go into the empty boxes, those of a kind the position takes, up to the links allowed', () => {
    expect(portfolioBoxesPatch([], found, SHOWREEL)).toEqual({ boxes: ['https://vimeo.com/123456', 'https://youtu.be/abcdef12'], filled: [0, 1] });
    // a box typed in keeps its link
    expect(portfolioBoxesPatch(['vimeo.com/mine'], found, SHOWREEL)).toEqual({ boxes: ['vimeo.com/mine', 'https://vimeo.com/123456'], filled: [1] });
    expect(portfolioBoxesPatch(['', 'youtu.be/typed'], found, SHOWREEL)).toEqual({ boxes: ['https://vimeo.com/123456', 'youtu.be/typed'], filled: [0] });
    // one typed already isn't put in again
    expect(portfolioBoxesPatch(['https://vimeo.com/123456'], found, SHOWREEL).boxes).toEqual(['https://vimeo.com/123456', 'https://youtu.be/abcdef12']);
  });

  it('take any site when a personal website is taken, and nothing when the position asks for none', () => {
    expect(portfolioBoxesPatch([], found, { mode: 'optional', hint: null, kinds: ['website'], maxLinks: 1 })).toEqual({ boxes: ['https://github.com/mona'], filled: [0] });
    expect(portfolioBoxesPatch([], found, { mode: 'hidden', hint: null, kinds: [], maxLinks: 3 })).toEqual({ boxes: [], filled: [] });
    expect(portfolioBoxesPatch([], found, { mode: 'required', hint: null, kinds: ['pdf'], maxLinks: 3 })).toEqual({ boxes: [], filled: [] });
  });
});

describe('a typed link’s platform', () => {
  it('names the platform as the link is typed, nothing before it is a link', () => {
    expect(platformLabelOf('vimeo.com/123456')).toBe('Vimeo');
    expect(platformLabelOf('https://www.behance.net/mona')).toBe('Behance');
    expect(platformLabelOf('youtu.be/abcdef12')).toBe('YouTube');
    expect(platformLabelOf('tiktok.com/@mona')).toBe('TikTok');
    expect(platformLabelOf('play.google.com/store/apps/details?id=com.example')).toBe('Google Play');
    expect(platformLabelOf('mona-adel.design')).toBe('Website');
    expect(platformLabelOf('')).toBe('');
    expect(platformLabelOf('vimeo')).toBe('');
    expect(platformLabelOf('my reel')).toBe('');
  });
});

describe('the fields kept while away at LinkedIn', () => {
  it('keeps the typed text fields and the ticks, never the files, the honeypot or the ticket', () => {
    const fd = new FormData();
    fd.set('fullName', ' Mona Adel ');
    fd.set('email', '');
    fd.set('consent', 'on');
    fd.set('website', 'spam');
    fd.set('linkedinTicket', 'v1:sealed');
    fd.set('cv', new File(['%PDF-1.4'], 'My CV.pdf', { type: 'application/pdf' }));
    fd.set('portfolioFile', new File([], ''));
    const kept = draftOf(fd);
    expect(kept).toEqual({ values: { fullName: 'Mona Adel', consent: 'on' }, hadCv: true });
    expect(draftFrom(JSON.stringify(kept))).toEqual(kept);
    expect(draftFrom(null)).toBeNull();
    expect(draftFrom('not json')).toBeNull();
    expect(draftFrom(JSON.stringify({ values: ['x'] }))).toBeNull();
  });

  it('takes ?linkedin= off the address, the rest kept', () => {
    expect(withoutLinkedInParam('?src=facebook&linkedin=done')).toBe('?src=facebook');
    expect(withoutLinkedInParam('?linkedin=cancelled')).toBe('');
    expect(withoutLinkedInParam('')).toBe('');
  });
});

describe('where the sign-in sends the browser', () => {
  const ORIGIN = 'https://people.example.test';

  it('starts with the form and its channel', () => {
    expect(linkedinStartHref('/careers/linkedin/start', 'job:video-editor-vac-2026-0001', 'facebook')).toBe('/careers/linkedin/start?form=job%3Avideo-editor-vac-2026-0001&src=facebook');
    expect(linkedinStartHref('/careers/linkedin/start', 'general', null)).toBe('/careers/linkedin/start?form=general');
    expect(linkedinStartHref('/careers/linkedin/start', 'general', 'bad value')).toBe('/careers/linkedin/start?form=general');
  });

  it('comes back to the same form saying how it went', () => {
    expect(linkedinReturnUrl(`${ORIGIN}/careers`, 'job:video-editor-vac-2026-0001', 'facebook', 'done').toString()).toBe(
      `${ORIGIN}/careers/video-editor-vac-2026-0001?src=facebook&linkedin=done`,
    );
    expect(linkedinReturnUrl(`${ORIGIN}/careers`, 'general', null, 'cancelled').toString()).toBe(`${ORIGIN}/careers/general?linkedin=cancelled`);
    // a form it doesn't know: the open roles
    expect(linkedinReturnUrl(`${ORIGIN}/careers`, 'job:../admin', null, 'failed').toString()).toBe(`${ORIGIN}/careers?linkedin=failed`);
    expect(linkedinReturnUrl(`${ORIGIN}/careers`, null, null, 'off').toString()).toBe(`${ORIGIN}/careers?linkedin=off`);
  });

  it('goes back to the careers pages’ own address once they live elsewhere (the main site’s /careers)', () => {
    const www = 'https://www.example.test/careers';
    expect(linkedinReturnUrl(www, 'job:video-editor-vac-2026-0001', 'linkedin', 'done').toString()).toBe(`${www}/video-editor-vac-2026-0001?src=linkedin&linkedin=done`);
    expect(linkedinReturnUrl(www, null, null, 'failed').toString()).toBe(`${www}?linkedin=failed`);
    // the cookies: the host's own (no Domain), on the careers pages' path
    expect(linkedinCookie(www, '/linkedin', 600)).toEqual({ httpOnly: true, sameSite: 'lax', secure: true, path: '/careers/linkedin', maxAge: 600 });
    expect(linkedinCookie('https://careers.example.test', '', 600).path).toBe('/');
  });

  it('goes only to LinkedIn’s own sign-in page', () => {
    expect(isLinkedInAuthorizeUrl('https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=x')).toBe(true);
    expect(isLinkedInAuthorizeUrl('https://evil.example/oauth/v2/authorization?x=1')).toBe(false);
    expect(isLinkedInAuthorizeUrl('https://www.linkedin.com/oauth/v2/authorization.evil.example?x')).toBe(false);
    expect(isLinkedInAuthorizeUrl(null)).toBe(false);
  });
});
