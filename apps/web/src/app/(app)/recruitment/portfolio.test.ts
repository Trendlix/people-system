import { describe, expect, it } from 'vitest';
import { HIDDEN_PORTFOLIO, portfolioDefaultFor, type PortfolioPositionView } from '@trendlix/shared';
import {
  applicantPortfolioHref,
  askText,
  generalPortfolioHref,
  jobTitleAskText,
  portfolioByTeam,
  portfolioChip,
  portfolioField,
  portfolioLinksOf,
  portfolioSettingsOf,
  rowValues,
  typedPortfolioValues,
  vacancyPortfolioModeOf,
  vacancyPortfolioText,
} from './portfolio';
import { vacancyForm } from './recruitment';

// A portfolio per position on HR's side (owner, 25 October 2026: "Portfolio per position"): Recruitment Settings' rows
// read for the API, the positions by team, an ask in words, a vacancy's own choice, and the links as chips. Every
// position, team and link here is made up.

const KEY = 'team-1:video editor';

function position(over: Partial<PortfolioPositionView> = {}): PortfolioPositionView {
  const ask = portfolioDefaultFor('Video Editor');
  return { key: KEY, name: 'Video Editor', teamHrName: 'Video · Production', teamId: 'team-1', hidden: false, titles: ['Junior Video Editor'], ask, defaultAsk: ask, set: false, mixed: false, ...over };
}

describe('Portfolio on the Forms: the rows read for the API', () => {
  it('reads every row: its mode, hint, kinds in their order and links allowed', () => {
    const fd = new FormData();
    fd.append(portfolioField.key, KEY);
    fd.set(portfolioField.mode(KEY), 'required');
    fd.set(portfolioField.hint(KEY), '  A   showreel  ');
    fd.append(portfolioField.kinds(KEY), 'youtube');
    fd.append(portfolioField.kinds(KEY), 'vimeo');
    fd.append(portfolioField.kinds(KEY), 'not-a-kind');
    fd.set(portfolioField.links(KEY), '2');
    fd.append(portfolioField.key, 'team-2:copywriter');
    fd.set(portfolioField.mode('team-2:copywriter'), 'hidden');
    fd.set(portfolioField.links('team-2:copywriter'), '3');
    expect(portfolioSettingsOf(fd)).toEqual([
      { key: KEY, mode: 'required', hint: 'A showreel', kinds: ['vimeo', 'youtube'], maxLinks: 2 },
      { key: 'team-2:copywriter', mode: 'hidden', hint: null, kinds: [], maxLinks: 3 },
    ]);
  });

  it('passes on what isn’t a mode or a number for the API to refuse, and sends each row once', () => {
    const fd = new FormData();
    fd.append(portfolioField.key, KEY);
    fd.append(portfolioField.key, KEY);
    fd.set(portfolioField.mode(KEY), 'always');
    fd.set(portfolioField.links(KEY), 'many');
    const [row, ...rest] = portfolioSettingsOf(fd);
    expect(rest).toEqual([]);
    expect(row.mode).toBe('always');
    expect(Number.isNaN(row.maxLinks)).toBe(true);
  });

  it('keeps what was typed after a refusal, the kinds as a list, and shows it again', () => {
    const fd = new FormData();
    fd.append(portfolioField.key, KEY);
    fd.set(portfolioField.mode(KEY), 'optional');
    fd.set(portfolioField.hint(KEY), 'Reels');
    fd.append(portfolioField.kinds(KEY), 'instagram');
    fd.append(portfolioField.kinds(KEY), 'tiktok');
    fd.set(portfolioField.links(KEY), '1');
    const typed = typedPortfolioValues(fd);
    expect(typed[portfolioField.kinds(KEY)]).toEqual(['instagram', 'tiktok']);
    expect(typed).not.toHaveProperty(portfolioField.key);
    expect(rowValues(position(), typed)).toEqual({ mode: 'optional', hint: 'Reels', kinds: ['instagram', 'tiktok'], maxLinks: 1 });
    // nothing sent: the position's own ask
    expect(rowValues(position())).toEqual({ mode: 'required', hint: 'A 1–2 minute showreel', kinds: ['vimeo', 'youtube', 'google_drive', 'frame_io'], maxLinks: 3 });
  });

  it('groups the positions by team, in their order', () => {
    const groups = portfolioByTeam([position(), position({ key: 'team-1:colorist', name: 'Colorist' }), position({ key: 'team-2:writer', teamId: 'team-2', teamHrName: 'Content · Marketing' })]);
    expect(groups.map((g) => [g.team, g.positions.length])).toEqual([
      ['Video · Production', 2],
      ['Content · Marketing', 1],
    ]);
  });

  it('says an ask in words', () => {
    expect(askText(portfolioDefaultFor('Motion Designer'))).toBe('Required: Behance, Vimeo or YouTube, up to 3 links');
    expect(askText({ ...portfolioDefaultFor('Flutter Developer'), maxLinks: 1 })).toBe('Optional: GitHub, App Store or Google Play, 1 link');
    expect(askText(HIDDEN_PORTFOLIO)).toBe('Hidden');
  });
});

describe('a vacancy’s portfolio', () => {
  it('sends a mode, or null for “As the job title”', () => {
    expect(vacancyPortfolioModeOf('required')).toBe('required');
    expect(vacancyPortfolioModeOf('')).toBeNull();
    expect(vacancyPortfolioModeOf('sometimes')).toBeNull();
    const fd = new FormData();
    for (const [k, v] of Object.entries({ jobTitleId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', employmentType: 'full_time', headcount: '1', portfolioMode: 'optional' })) fd.set(k, v);
    expect(vacancyForm(fd, { withQuestions: false }).body?.portfolioMode).toBe('optional');
    fd.set('portfolioMode', '');
    expect(vacancyForm(fd, { withQuestions: false }).body?.portfolioMode).toBeNull();
  });

  it('says what the job title asks, and the vacancy’s own choice', () => {
    expect(jobTitleAskText(portfolioDefaultFor('Videographer'))).toBe('The job title asks: Required: Vimeo, YouTube or Instagram, up to 3 links.');
    expect(jobTitleAskText(null)).toBeNull();
    expect(vacancyPortfolioText('hidden', portfolioDefaultFor('Videographer'))).toBe('Hidden, set on this vacancy');
    expect(vacancyPortfolioText(null, portfolioDefaultFor('Accountant'))).toBe('As the job title: Hidden');
    expect(vacancyPortfolioText(null, undefined)).toBeNull();
  });
});

describe('the links and the file on HR’s pages', () => {
  it('takes every link, else the one link of before', () => {
    expect(portfolioLinksOf({ portfolioLinks: ['https://vimeo.com/123456', 'https://behance.net/someone'], portfolio: 'https://vimeo.com/123456' })).toEqual(['https://vimeo.com/123456', 'https://behance.net/someone']);
    expect(portfolioLinksOf({ portfolio: 'https://dribbble.com/someone' })).toEqual(['https://dribbble.com/someone']);
    expect(portfolioLinksOf({ portfolioLinks: [], portfolio: null })).toEqual([]);
  });

  it('labels each chip with its platform, shortens what it shows, and links only to a web address', () => {
    expect(portfolioChip('https://www.vimeo.com/123456789/')).toEqual({ platform: 'Vimeo', shown: 'vimeo.com/123456789', href: 'https://www.vimeo.com/123456789/' });
    expect(portfolioChip('https://youtu.be/abcdefgh').platform).toBe('YouTube');
    expect(portfolioChip('https://studio-of-someone.example').platform).toBe('Website');
    expect(portfolioChip('javascript:alert(1)').href).toBeNull();
    expect(portfolioChip(`https://drive.google.com/${'x'.repeat(80)}`).shown).toHaveLength(48);
  });

  it('opens the PDF case study through the site', () => {
    expect(applicantPortfolioHref('a1')).toBe('/recruitment/applicants/a1/portfolio');
    expect(generalPortfolioHref('g1', true)).toBe('/recruitment/general-cvs/g1/portfolio?download=1');
  });
});
