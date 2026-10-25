import {
  checkPortfolio,
  checkPortfolioLink,
  HIDDEN_PORTFOLIO,
  portfolioDefaultFor,
  portfolioLinksSent,
  portfolioPlatformOf,
  portfolioRequiredText,
  portfolioSettingProblems,
  PORTFOLIO_KINDS,
  sameAsk,
  strictestAsk,
  tidyAsk,
  withVacancyMode,
  type PortfolioAsk,
} from '@trendlix/shared';

// A portfolio per position on the careers forms (owner, 25 October 2026: "for creatives, they need to add their
// portfolios. so based on the positions i have, what kind of portfolios i might need to ask them for?"; asked,
// "Portfolio per position"; packages/shared portfolio.ts): the defaults by the owner's table, the links checked by
// their shape (never fetched), the strictest of a position's job titles, a vacancy's own mode. Every title here is made up.

const ask = (mode: PortfolioAsk['mode'], kinds: PortfolioAsk['kinds'], hint: string | null = null, maxLinks = 3): PortfolioAsk => ({ mode, kinds, hint, maxLinks });

describe('the defaults by rule (the owner’s table)', () => {
  const d = (t: string) => portfolioDefaultFor(t);

  it('asks a graphic designer, a UI/UX designer, motion, a video editor, a videographer and a reel creator', () => {
    expect(d('Senior Graphic Designer')).toEqual(ask('required', ['behance', 'dribbble', 'website', 'pdf'], 'Behance or Dribbble, or a PDF portfolio'));
    expect(d('UI/UX Designer')).toEqual(ask('required', ['behance', 'dribbble', 'figma', 'website'], 'Behance or Dribbble, plus one case study'));
    expect(d('UX-UI Designer').mode).toBe('required');
    expect(d('Motion Graphics Designer')).toEqual(ask('required', ['behance', 'vimeo', 'youtube'], 'A showreel on Vimeo or YouTube'));
    expect(d('Junior Video Editor')).toEqual(ask('required', ['vimeo', 'youtube', 'google_drive', 'frame_io'], 'A 1–2 minute showreel'));
    expect(d('Videographer')).toEqual(ask('required', ['vimeo', 'youtube', 'instagram'], 'A showreel'));
    expect(d('Reel Creator')).toEqual(ask('required', ['youtube', 'instagram', 'tiktok'], 'Your Reels, TikTok or Shorts account'));
  });

  it('tells "SEO Content Creator" from "Content Creator" and "SEO Specialist"', () => {
    expect(d('SEO Content Creator')).toEqual(ask('required', ['google_drive', 'medium', 'website'], 'Links to published articles or samples'));
    expect(d('Content Creator')).toEqual(ask('required', ['youtube', 'instagram', 'tiktok', 'google_drive'], 'Your account or writing samples'));
    expect(d('SEO Specialist')).toEqual(ask('optional', ['google_drive', 'website', 'pdf'], 'Case studies with results (ROAS, CPA, rankings)'));
  });

  it('takes a developer’s, Flutter’s, a tester’s, a media buyer’s and a page moderator’s, as Optional', () => {
    expect(d('Full Stack Developer')).toEqual(ask('optional', ['github', 'website'], 'GitHub and sites you built'));
    expect(d('WordPress Specialist')).toEqual(ask('optional', ['github', 'website'], 'GitHub and sites you built'));
    expect(d('Flutter Developer')).toEqual(ask('optional', ['github', 'app_store', 'google_play'], 'GitHub or your apps in the stores'));
    expect(d('Software Testing Engineer')).toEqual(ask('optional', ['github'], null));
    expect(d('Media Buyer').hint).toBe('Case studies with results (ROAS, CPA, rankings)');
    expect(d('Traffic Specialist').mode).toBe('optional');
    expect(d('Marketing Manager').kinds).toEqual(['google_drive', 'website', 'pdf']);
    expect(d('Page Moderator')).toEqual(ask('optional', ['instagram', 'website'], 'Pages you managed'));
  });

  it('hides it for everything else', () => {
    expect(d('Accountant')).toEqual({ ...HIDDEN_PORTFOLIO, kinds: [] });
    expect(d('HR Specialist').mode).toBe('hidden');
    expect(d('').mode).toBe('hidden');
    expect(d('Promotion Officer').mode).toBe('hidden');
  });
});

describe('the links, by their shape', () => {
  const all = PORTFOLIO_KINDS;
  const ok = (url: string, kinds: readonly (typeof PORTFOLIO_KINDS)[number][] = all) => checkPortfolioLink(url, kinds);

  it('takes each platform’s own addresses', () => {
    for (const [url, kind] of [
      ['https://www.behance.net/mona-adel', 'behance'],
      ['behance.net/gallery/123456/Brand', 'behance'],
      ['https://dribbble.com/mona', 'dribbble'],
      ['https://vimeo.com/123456789', 'vimeo'],
      ['vimeo.com/monaedits', 'vimeo'],
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
      ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
      ['https://youtube.com/@mona-edits', 'youtube'],
      ['https://www.instagram.com/mona.pages/', 'instagram'],
      ['https://www.tiktok.com/@mona.reels', 'tiktok'],
      ['https://github.com/omar-dev', 'github'],
      ['https://apps.apple.com/eg/app/an-app/id123456', 'app_store'],
      ['https://play.google.com/store/apps/details?id=com.example.app', 'google_play'],
      ['https://drive.google.com/drive/folders/abc', 'google_drive'],
      ['https://frame.io/reviews/abc', 'frame_io'],
      ['https://www.figma.com/file/abc/Case', 'figma'],
      ['https://www.artstation.com/mona', 'artstation'],
      ['https://medium.com/@omar.writes', 'medium'],
    ] as const) {
      expect(ok(url)).toMatchObject({ ok: true, kind });
    }
  });

  it('refuses http:// and a platform’s address of another shape', () => {
    expect(ok('http://vimeo.com/123456789')).toMatchObject({ ok: false });
    expect(ok('https://vimeo.com/', ['vimeo'])).toMatchObject({ ok: false, problem: expect.stringContaining('Vimeo') });
    expect(ok('https://www.youtube.com/watch', ['youtube'])).toMatchObject({ ok: false });
    expect(ok('https://www.tiktok.com/mona', ['tiktok'])).toMatchObject({ ok: false });
    expect(ok('https://medium.com/', ['medium'])).toMatchObject({ ok: false });
    expect(ok('not a link', ['vimeo'])).toMatchObject({ ok: false });
    expect(ok('https://user:pass@vimeo.com/123', ['vimeo'])).toMatchObject({ ok: false });
  });

  it('takes any https site only when a personal website is taken', () => {
    expect(ok('https://mona-edits.test', ['vimeo', 'youtube'])).toMatchObject({ ok: false });
    expect(ok('https://mona-edits.test', ['website'])).toEqual({ ok: true, link: 'https://mona-edits.test', kind: 'website' });
    // a platform not asked for: refused, unless any site is taken
    expect(ok('https://github.com/omar', ['vimeo'])).toMatchObject({ ok: false, problem: expect.stringContaining('GitHub isn’t asked for') });
    expect(ok('https://github.com/omar', ['vimeo', 'website'])).toMatchObject({ ok: true });
  });

  it('tells a link’s platform by its host, a website otherwise', () => {
    expect(portfolioPlatformOf('youtu.be/abcdefg')).toBe('youtube');
    expect(portfolioPlatformOf('https://mona.artstation.com')).toBe('artstation');
    expect(portfolioPlatformOf('https://omar.github.io')).toBe('github');
    expect(portfolioPlatformOf('https://my-site.test')).toBe('website');
    expect(portfolioPlatformOf('nothing')).toBeNull();
  });
});

describe('a form’s portfolio', () => {
  const showreel = ask('required', ['vimeo', 'youtube'], 'A showreel on Vimeo or YouTube', 2);

  it('Required refuses none, in the hint’s words, and takes a Vimeo link', () => {
    expect(checkPortfolio({ links: [], file: false }, showreel).problems).toEqual(['Add your portfolio: a showreel on Vimeo or YouTube.']);
    expect(checkPortfolio({ links: ['', '  '], file: false }, showreel).problems).toEqual(['Add your portfolio: a showreel on Vimeo or YouTube.']);
    expect(checkPortfolio({ links: ['vimeo.com/123456789'], file: false }, showreel)).toEqual({ links: ['https://vimeo.com/123456789'], file: false, problems: [] });
  });

  it('refuses a malformed link, and more links than allowed', () => {
    expect(checkPortfolio({ links: ['https://vimeo.com/'], file: false }, showreel).problems).toHaveLength(1);
    expect(checkPortfolio({ links: ['vimeo.com/1', 'vimeo.com/2', 'vimeo.com/3'], file: false }, showreel).problems).toEqual(['Add at most 2 portfolio links.']);
  });

  it('Hidden takes nothing: the links and the file are ignored', () => {
    expect(checkPortfolio({ links: ['not a link'], file: true }, { ...HIDDEN_PORTFOLIO })).toEqual({ links: [], file: false, problems: [] });
  });

  it('takes a PDF case study only when it is asked for; it is enough for Required', () => {
    const designer = portfolioDefaultFor('Graphic Designer');
    expect(checkPortfolio({ links: [], file: true }, designer)).toEqual({ links: [], file: true, problems: [] });
    expect(checkPortfolio({ links: [], file: true }, showreel).file).toBe(false);
  });

  it('says the hint’s first word in lower case only when it is a common one', () => {
    expect(portfolioRequiredText({ hint: 'Behance or Dribbble, or a PDF portfolio', kinds: [] })).toBe('Add your portfolio: Behance or Dribbble, or a PDF portfolio.');
    expect(portfolioRequiredText({ hint: null, kinds: ['vimeo', 'youtube'] })).toBe('Add your portfolio: Vimeo or YouTube.');
  });

  it('reads the links an API form sent, as a JSON list', () => {
    expect(portfolioLinksSent('["https://vimeo.com/1", 2, "b"]')).toEqual(['https://vimeo.com/1', 'b']);
    expect(portfolioLinksSent('not json')).toEqual([]);
    expect(portfolioLinksSent(undefined)).toEqual([]);
  });
});

describe('the strictest mode across a position’s job titles', () => {
  it('takes the strictest mode, every kind asked, the most links, the strictest one’s hint', () => {
    const merged = strictestAsk([ask('optional', ['github'], 'GitHub', 1), ask('required', ['vimeo'], 'A reel', 2), { ...HIDDEN_PORTFOLIO }]);
    expect(merged).toEqual({ mode: 'required', kinds: ['vimeo', 'github'], hint: 'A reel', maxLinks: 2 });
    expect(strictestAsk([{ ...HIDDEN_PORTFOLIO }, { ...HIDDEN_PORTFOLIO }]).mode).toBe('hidden');
    expect(strictestAsk([ask('optional', ['github']), ask('optional', ['website'])]).mode).toBe('optional');
  });
});

describe('a vacancy’s own mode', () => {
  it('keeps the job title’s, or puts its own over it (every kind when the job title asks none)', () => {
    const editor = portfolioDefaultFor('Video Editor');
    expect(withVacancyMode(editor, null)).toBe(editor);
    expect(withVacancyMode(editor, 'optional')).toEqual({ ...editor, mode: 'optional' });
    expect(withVacancyMode(editor, 'hidden').mode).toBe('hidden');
    expect(withVacancyMode(portfolioDefaultFor('Accountant'), 'required')).toMatchObject({ mode: 'required', kinds: [...PORTFOLIO_KINDS] });
  });
});

describe('HR’s settings', () => {
  it('refuses a mode not on the list, a long hint, no kinds when asked, and links out of 1 to 3', () => {
    expect(portfolioSettingProblems({ mode: 'sometimes' as never, kinds: [], maxLinks: 1 }, 'Editor')).toEqual(['Choose Hidden, Optional or Required for Editor.']);
    expect(portfolioSettingProblems({ mode: 'required', kinds: [], maxLinks: 1 }, 'Editor')).toEqual(['Choose at least one kind of portfolio for Editor.']);
    expect(portfolioSettingProblems({ mode: 'optional', kinds: ['vimeo'], maxLinks: 4 }, 'Editor')).toEqual(['Allow 1 to 3 links for Editor.']);
    expect(portfolioSettingProblems({ mode: 'optional', kinds: ['vimeo'], maxLinks: 2, hint: 'x'.repeat(121) }, 'Editor')).toHaveLength(1);
    expect(portfolioSettingProblems({ mode: 'hidden', kinds: [], maxLinks: 3 }, 'Editor')).toEqual([]);
  });

  it('keeps a setting tidy, and tells one the same as another', () => {
    expect(tidyAsk({ mode: 'optional', hint: '  A  reel ', kinds: ['youtube', 'vimeo', 'youtube'], maxLinks: 2 })).toEqual({ mode: 'optional', hint: 'A reel', kinds: ['vimeo', 'youtube'], maxLinks: 2 });
    expect(sameAsk(ask('optional', ['vimeo', 'youtube']), ask('optional', ['youtube', 'vimeo']))).toBe(true);
    expect(sameAsk(ask('optional', ['vimeo']), ask('required', ['vimeo']))).toBe(false);
  });
});
