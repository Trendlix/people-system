import {
  checkPortfolio,
  checkPortfolioLink,
  DEFAULT_PORTFOLIO_TITLE,
  HIDDEN_PORTFOLIO,
  keptPortfolioTitle,
  OTHER_POSITION_PORTFOLIO,
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
// their shape (never fetched), the strictest of a position's job titles, a vacancy's own mode. Each with its section title
// (owner, 26 October 2026: "a section title per position"), by the same rows. Every title here is made up.

const ask = (mode: PortfolioAsk['mode'], kinds: PortfolioAsk['kinds'], hint: string | null = null, maxLinks = 3, title = DEFAULT_PORTFOLIO_TITLE): PortfolioAsk => ({
  mode,
  title,
  kinds,
  hint,
  maxLinks,
});

describe('the defaults by rule (the owner’s table)', () => {
  const d = (t: string) => portfolioDefaultFor(t);

  it('asks a graphic designer, a UI/UX designer, motion, a video editor, a videographer and a reel creator', () => {
    expect(d('Senior Graphic Designer')).toEqual(ask('required', ['behance', 'dribbble', 'website', 'pdf'], 'Behance or Dribbble, or a PDF portfolio', 3, 'Your portfolio'));
    expect(d('UI/UX Designer')).toEqual(ask('required', ['behance', 'dribbble', 'figma', 'website'], 'Behance or Dribbble, plus one case study', 3, 'Your portfolio'));
    expect(d('UX-UI Designer').mode).toBe('required');
    expect(d('Motion Graphics Designer')).toEqual(ask('required', ['behance', 'vimeo', 'youtube'], 'A showreel on Vimeo or YouTube', 3, 'Your showreel'));
    expect(d('Junior Video Editor')).toEqual(ask('required', ['vimeo', 'youtube', 'google_drive', 'frame_io'], 'A 1–2 minute showreel', 3, 'Your showreel'));
    expect(d('Videographer')).toEqual(ask('required', ['vimeo', 'youtube', 'instagram'], 'A showreel', 3, 'Your showreel'));
    expect(d('Reel Creator')).toEqual(ask('required', ['youtube', 'instagram', 'tiktok'], 'Your Reels, TikTok or Shorts account', 3, 'Your content'));
  });

  it('tells "SEO Content Creator" from "Content Creator" and "SEO Specialist"', () => {
    expect(d('SEO Content Creator')).toEqual(ask('required', ['google_drive', 'medium', 'website'], 'Links to published articles or samples', 3, 'Your writing samples'));
    expect(d('Content Creator')).toEqual(ask('required', ['youtube', 'instagram', 'tiktok', 'google_drive'], 'Your account or writing samples', 3, 'Your content'));
    expect(d('SEO Specialist')).toEqual(ask('optional', ['google_drive', 'website', 'pdf'], 'Case studies with results (ROAS, CPA, rankings)', 3, 'Your case studies'));
  });

  it('takes a developer’s, Flutter’s, a tester’s, a media buyer’s and a page moderator’s, as Optional', () => {
    expect(d('Full Stack Developer')).toEqual(ask('optional', ['github', 'website'], 'GitHub and sites you built', 3, 'Your GitHub and projects'));
    expect(d('WordPress Specialist')).toEqual(ask('optional', ['github', 'website'], 'GitHub and sites you built', 3, 'Your GitHub and projects'));
    expect(d('Flutter Developer')).toEqual(ask('optional', ['github', 'app_store', 'google_play'], 'GitHub or your apps in the stores', 3, 'Your GitHub and projects'));
    expect(d('Software Testing Engineer')).toEqual(ask('optional', ['github'], null, 3, 'Your GitHub and projects'));
    expect(d('Media Buyer').hint).toBe('Case studies with results (ROAS, CPA, rankings)');
    expect(d('Traffic Specialist').mode).toBe('optional');
    expect(d('Marketing Manager').kinds).toEqual(['google_drive', 'website', 'pdf']);
    expect(d('Page Moderator')).toEqual(ask('optional', ['instagram', 'website'], 'Pages you managed', 3, 'Your pages'));
  });

  it('hides it for everything else', () => {
    expect(d('Accountant')).toEqual({ ...HIDDEN_PORTFOLIO, kinds: [] });
    expect(d('HR Specialist').mode).toBe('hidden');
    expect(d('').mode).toBe('hidden');
    expect(d('Promotion Officer').mode).toBe('hidden');
  });

  // the section title, the portfolio part's heading (owner, 26 October 2026: "a section title per position")
  it('titles each row’s section, and everything else’s (Other’s too) “Your work samples”', () => {
    const rows: [string, string][] = [
      ['Senior Graphic Designer', 'Your portfolio'],
      ['UI/UX Designer', 'Your portfolio'],
      ['Motion Graphics Designer', 'Your showreel'],
      ['Junior Video Editor', 'Your showreel'],
      ['Videographer', 'Your showreel'],
      ['Reel Creator', 'Your content'],
      ['Content Creator', 'Your content'],
      ['SEO Content Creator', 'Your writing samples'],
      ['Full Stack Developer', 'Your GitHub and projects'],
      ['WordPress Developer', 'Your GitHub and projects'],
      ['Flutter Developer', 'Your GitHub and projects'],
      ['Software Testing Engineer', 'Your GitHub and projects'],
      ['Media Buyer', 'Your case studies'],
      ['Traffic Specialist', 'Your case studies'],
      ['Marketing Manager', 'Your case studies'],
      ['SEO Specialist', 'Your case studies'],
      ['Page Moderator', 'Your pages'],
      ['Accountant', 'Your work samples'],
      ['HR Specialist', 'Your work samples'],
      ['', 'Your work samples'],
    ];
    for (const [title, section] of rows) expect([title, d(title).title]).toEqual([title, section]);
    expect(OTHER_POSITION_PORTFOLIO.title).toBe('Your work samples');
    expect(HIDDEN_PORTFOLIO.title).toBe(DEFAULT_PORTFOLIO_TITLE);
    // every title fits HR's limit
    for (const [title] of rows) expect(d(title).title.length).toBeLessThanOrEqual(40);
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
    const merged = strictestAsk([ask('optional', ['github'], 'GitHub', 1, 'Your code'), ask('required', ['vimeo'], 'A reel', 2, 'Your reel'), { ...HIDDEN_PORTFOLIO }]);
    expect(merged).toEqual({ mode: 'required', title: 'Your reel', kinds: ['vimeo', 'github'], hint: 'A reel', maxLinks: 2 });
    expect(strictestAsk([{ ...HIDDEN_PORTFOLIO }, { ...HIDDEN_PORTFOLIO }]).mode).toBe('hidden');
    expect(strictestAsk([ask('optional', ['github']), ask('optional', ['website'])]).mode).toBe('optional');
  });

  it('takes the section title of the one whose hint it takes, else the first of the strictest; none asking, the first one’s', () => {
    expect(strictestAsk([ask('required', ['vimeo'], null, 3, 'Your reel'), ask('required', ['behance'], 'Behance', 3, 'Your designs')]).title).toBe('Your designs');
    expect(strictestAsk([ask('optional', ['github'], 'GitHub', 3, 'Your code'), ask('required', ['vimeo'], null, 3, 'Your reel')]).title).toBe('Your reel');
    expect(strictestAsk([{ ...HIDDEN_PORTFOLIO, title: 'Your models' }, { ...HIDDEN_PORTFOLIO }])).toMatchObject({ mode: 'hidden', title: 'Your models' });
    expect(strictestAsk([]).title).toBe('Your work samples');
  });

  // reported 25 October 2026: a position set to Hidden was read back without its hint and kinds, and the page's next
  // Save sent them so (owner, 26 October 2026: "yes", keep them)
  it('none asking: what they keep, read the same way, for a vacancy asking anyway; the forms still take nothing', () => {
    const kept = ask('hidden', ['website', 'google_drive'], 'Models you built', 2, 'Your spreadsheets');
    expect(strictestAsk([kept])).toEqual({ ...kept, kinds: ['google_drive', 'website'] });
    expect(strictestAsk([ask('hidden', ['github'], null, 1, 'Your code'), ask('hidden', ['vimeo'], 'A reel', 2, 'Your reel')])).toEqual({
      mode: 'hidden',
      title: 'Your reel',
      hint: 'A reel',
      kinds: ['vimeo', 'github'],
      maxLinks: 2,
    });
    // one asking: only those asking count, as before
    expect(strictestAsk([kept, ask('optional', ['github'], 'GitHub', 1, 'Your code')])).toEqual({ mode: 'optional', title: 'Your code', hint: 'GitHub', kinds: ['github'], maxLinks: 1 });
    // a vacancy asking anyway takes them; while hidden the forms take nothing
    expect(withVacancyMode(strictestAsk([kept]), 'optional')).toEqual({ mode: 'optional', title: 'Your spreadsheets', hint: 'Models you built', kinds: ['google_drive', 'website'], maxLinks: 2 });
    expect(checkPortfolio({ links: ['https://drive.google.com/file/1'], file: false }, strictestAsk([kept]))).toEqual({ links: [], file: false, problems: [] });
    // kept as a setting, not the rule's Hidden (no row) of a job title asking none
    const setting = tidyAsk({ mode: 'hidden', title: 'Your spreadsheets', hint: ' Models  you built ', kinds: ['website', 'google_drive'], maxLinks: 2 }, 'Your work samples');
    expect(setting).toEqual({ ...kept, kinds: ['google_drive', 'website'] });
    expect(sameAsk(setting, portfolioDefaultFor('Accountant'))).toBe(false);
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

  it('keeps the job title’s section title, as it keeps its hint (26 October 2026)', () => {
    const editor = { ...portfolioDefaultFor('Video Editor'), title: 'Your edits' };
    expect(withVacancyMode(editor, 'optional')).toMatchObject({ mode: 'optional', title: 'Your edits', hint: editor.hint });
    expect(withVacancyMode(editor, 'hidden')).toMatchObject({ mode: 'hidden', title: 'Your edits' });
    expect(withVacancyMode(portfolioDefaultFor('Accountant'), 'required')).toMatchObject({ mode: 'required', title: 'Your work samples', hint: null });
    expect(withVacancyMode(portfolioDefaultFor('Media Buyer'), 'required').title).toBe('Your case studies');
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

  it('refuses a section title over 40 characters; a blank one is the default', () => {
    expect(portfolioSettingProblems({ mode: 'optional', kinds: ['vimeo'], maxLinks: 2, title: 'x'.repeat(41) }, 'Editor')).toEqual(['Keep the section title for Editor to 40 characters or fewer.']);
    expect(portfolioSettingProblems({ mode: 'optional', kinds: ['vimeo'], maxLinks: 2, title: ` ${'x'.repeat(40)}  ` }, 'Editor')).toEqual([]);
    expect(portfolioSettingProblems({ mode: 'optional', kinds: ['vimeo'], maxLinks: 2, title: '   ' }, 'Editor')).toEqual([]);
    expect(portfolioSettingProblems({ mode: 'optional', kinds: ['vimeo'], maxLinks: 2, title: null }, 'Editor')).toEqual([]);
  });

  it('keeps a setting tidy, and tells one the same as another', () => {
    expect(tidyAsk({ mode: 'optional', hint: '  A  reel ', kinds: ['youtube', 'vimeo', 'youtube'], maxLinks: 2 })).toEqual({
      mode: 'optional',
      title: 'Your work samples',
      hint: 'A reel',
      kinds: ['vimeo', 'youtube'],
      maxLinks: 2,
    });
    expect(sameAsk(ask('optional', ['vimeo', 'youtube']), ask('optional', ['youtube', 'vimeo']))).toBe(true);
    expect(sameAsk(ask('optional', ['vimeo']), ask('required', ['vimeo']))).toBe(false);
  });

  it('keeps a section title trimmed, a blank one the rule’s, and one the same as the rule’s as none', () => {
    const setting = { mode: 'optional' as const, hint: null, kinds: ['pdf' as const], maxLinks: 3 };
    expect(tidyAsk({ ...setting, title: '  Your   results ' }, 'Your case studies').title).toBe('Your results');
    expect(tidyAsk({ ...setting, title: '  ' }, 'Your case studies').title).toBe('Your case studies');
    expect(tidyAsk({ ...setting, title: null }, 'Your case studies').title).toBe('Your case studies');
    expect(keptPortfolioTitle({ title: 'Your case studies' }, 'Your case studies')).toBeNull();
    expect(keptPortfolioTitle({ title: 'Your results' }, 'Your case studies')).toBe('Your results');
    expect(sameAsk(ask('optional', ['pdf'], null, 3, 'Your results'), ask('optional', ['pdf'], null, 3, 'Your case studies'))).toBe(false);
  });
});
