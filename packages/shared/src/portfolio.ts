// A portfolio on the careers forms, per position (owner, 25 October 2026, on "Apply for This Job": "for creatives, they
// need to add their portfolios. so based on the positions i have, what kind of portfolios i might need to ask them
// for?"; asked, they chose "Portfolio per position"). Both careers forms (a job's and "Send us your CV") ask for it as
// the position says:
// - its mode: Hidden, Optional or Required;
// - a section title, the portfolio part's heading ("Your showreel"; owner, 26 October 2026: "this part needs to be more
//   clearer .. i cant visualize that this is a portfolio section"; asked, "a section title per position");
// - a hint ("A showreel on Vimeo or YouTube");
// - the kinds taken: Behance, Dribbble, Vimeo, YouTube, Instagram, TikTok, GitHub, App Store, Google Play, Google Drive,
//   Frame.io, Figma, ArtStation, Medium, a personal website, a PDF case study (uploaded);
// - how many links: 1 to 3.
// HR sets them per job title in Recruitment Settings ("Portfolio on the Forms"); a job title without a setting takes the
// default by the rule below (portfolioDefaultFor, by the words of its merged position name; a section title left blank,
// the rule's). A job's form uses its vacancy's job title's (the vacancy may say otherwise: Hidden, Optional or Required);
// "Send us your CV" the chosen position's, the strictest of its job titles (strictestAsk).
// Each link is checked by its shape only: https, and a known platform's address (behance.net/name, vimeo.com/123 …), or
// any https site when a personal website is taken. The links are never fetched: the platforms block automatic checks,
// and the server must never fetch an address people type.
// Pure code, tested in apps/api/src/common/portfolio.spec.ts.

import { positionNameOf } from './cv-positions.js';
import { RECRUITMENT_LIMITS, type RecruitmentUserRef } from './recruitment.js';

// ---------- the kinds ----------

export const PORTFOLIO_KINDS = [
  'behance',
  'dribbble',
  'vimeo',
  'youtube',
  'instagram',
  'tiktok',
  'github',
  'app_store',
  'google_play',
  'google_drive',
  'frame_io',
  'figma',
  'artstation',
  'medium',
  'website',
  'pdf',
] as const;
export type PortfolioKind = (typeof PORTFOLIO_KINDS)[number];

/** The kinds that are links (all but the PDF case study, which is uploaded). */
export type PortfolioLinkKind = Exclude<PortfolioKind, 'pdf'>;
export const PORTFOLIO_LINK_KINDS = PORTFOLIO_KINDS.filter((k): k is PortfolioLinkKind => k !== 'pdf');

export const PORTFOLIO_KIND_LABELS: Record<PortfolioKind, string> = {
  behance: 'Behance',
  dribbble: 'Dribbble',
  vimeo: 'Vimeo',
  youtube: 'YouTube',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  github: 'GitHub',
  app_store: 'App Store',
  google_play: 'Google Play',
  google_drive: 'Google Drive',
  frame_io: 'Frame.io',
  figma: 'Figma',
  artstation: 'ArtStation',
  medium: 'Medium',
  website: 'Personal website',
  pdf: 'PDF case study (upload)',
};

/** A link of each kind as people write it, for the fields' placeholders and the refusals' examples. */
export const PORTFOLIO_KIND_EXAMPLES: Record<PortfolioLinkKind, string> = {
  behance: 'behance.net/your-name',
  dribbble: 'dribbble.com/your-name',
  vimeo: 'vimeo.com/123456789',
  youtube: 'youtube.com/@your-channel',
  instagram: 'instagram.com/your-name',
  tiktok: 'tiktok.com/@your-name',
  github: 'github.com/your-name',
  app_store: 'apps.apple.com/app/…',
  google_play: 'play.google.com/store/apps/details?id=…',
  google_drive: 'drive.google.com/…',
  frame_io: 'frame.io/…',
  figma: 'figma.com/file/…',
  artstation: 'artstation.com/your-name',
  medium: 'medium.com/@your-name',
  website: 'your-site.com',
};

export const isPortfolioKind = (v: unknown): v is PortfolioKind => typeof v === 'string' && (PORTFOLIO_KINDS as readonly string[]).includes(v);

// ---------- the modes ----------

export const PORTFOLIO_MODES = ['hidden', 'optional', 'required'] as const;
export type PortfolioMode = (typeof PORTFOLIO_MODES)[number];

export const PORTFOLIO_MODE_LABELS: Record<PortfolioMode, string> = { hidden: 'Hidden', optional: 'Optional', required: 'Required' };

export const isPortfolioMode = (v: unknown): v is PortfolioMode => typeof v === 'string' && (PORTFOLIO_MODES as readonly string[]).includes(v);

/** How strict a mode is: hidden < optional < required. */
const STRICTNESS: Record<PortfolioMode, number> = { hidden: 0, optional: 1, required: 2 };

export const PORTFOLIO_LIMITS = {
  /** Links on a form, at most (and at least, when asked). */
  links: 3,
  linksMin: 1,
  /** HR's hint, at most. */
  hint: 120,
  /** The section title, at most (26 October 2026). */
  title: 40,
  /** The PDF case study, as the CV: at most 5 MB. */
  fileMb: RECRUITMENT_LIMITS.cvMb,
} as const;

/** The section title of a position no rule names, and of "Other (write it)" (owner's brief, 26 October 2026). */
export const DEFAULT_PORTFOLIO_TITLE = 'Your work samples';

/**
 * What a form asks for: the mode, the section title (the portfolio part's heading, always one), the hint (none: no line
 * under it), the kinds taken, how many links at most.
 */
export interface PortfolioAsk {
  mode: PortfolioMode;
  /** The portfolio part's heading on the forms ("Your case studies"; 26 October 2026): HR's, else the rule's. */
  title: string;
  hint: string | null;
  kinds: PortfolioKind[];
  maxLinks: number;
}

/** Not asked: the form has no portfolio. */
export const HIDDEN_PORTFOLIO: PortfolioAsk = { mode: 'hidden', title: DEFAULT_PORTFOLIO_TITLE, hint: null, kinds: [], maxLinks: PORTFOLIO_LIMITS.links };

const ask = (mode: PortfolioMode, kinds: PortfolioKind[], hint: string | null, title: string): PortfolioAsk => ({ mode, title, hint, kinds, maxLinks: PORTFOLIO_LIMITS.links });

// ---------- the defaults, by rule (the owner's table, 25 October 2026) ----------

/**
 * The rows of the table, in the order they are tried: "seo content" before "content creator" and "seo specialist",
 * "motion" before "graphic designer" ("Motion Graphics Designer" is motion's), "flutter" before "developer". Each is the words of a merged position name, English, in lower case.
 * Each row's section title (owner's brief, 26 October 2026): a designer's "Your portfolio", motion's and video's "Your
 * showreel", a reel or content creator's "Your content", SEO content's "Your writing samples", a developer's and a
 * tester's "Your GitHub and projects", a media buyer's (traffic, marketing manager, SEO specialist) "Your case studies",
 * a page moderator's "Your pages" (the brief's "Pages you managed" is its hint already); everything else's
 * DEFAULT_PORTFOLIO_TITLE.
 */
const DEFAULT_RULES: readonly { words: RegExp; ask: PortfolioAsk }[] = [
  { words: /\bseo content\b/, ask: ask('required', ['medium', 'google_drive', 'website'], 'Links to published articles or samples', 'Your writing samples') },
  { words: /\bmotion\b/, ask: ask('required', ['vimeo', 'youtube', 'behance'], 'A showreel on Vimeo or YouTube', 'Your showreel') },
  { words: /\bgraphics? designer\b/, ask: ask('required', ['behance', 'dribbble', 'pdf', 'website'], 'Behance or Dribbble, or a PDF portfolio', 'Your portfolio') },
  { words: /\bui ?\/? ?ux\b|\bux ?\/? ?ui\b/, ask: ask('required', ['behance', 'dribbble', 'figma', 'website'], 'Behance or Dribbble, plus one case study', 'Your portfolio') },
  { words: /\bvideo editor\b/, ask: ask('required', ['vimeo', 'youtube', 'google_drive', 'frame_io'], 'A 1–2 minute showreel', 'Your showreel') },
  { words: /\bvideographer\b/, ask: ask('required', ['vimeo', 'youtube', 'instagram'], 'A showreel', 'Your showreel') },
  { words: /\breels? creator\b/, ask: ask('required', ['instagram', 'tiktok', 'youtube'], 'Your Reels, TikTok or Shorts account', 'Your content') },
  { words: /\bcontent creator\b/, ask: ask('required', ['instagram', 'tiktok', 'youtube', 'google_drive'], 'Your account or writing samples', 'Your content') },
  { words: /\bflutter\b/, ask: ask('optional', ['github', 'app_store', 'google_play'], 'GitHub or your apps in the stores', 'Your GitHub and projects') },
  { words: /\bdevelopers?\b|\bfull ?stack\b|\bword ?press\b/, ask: ask('optional', ['github', 'website'], 'GitHub and sites you built', 'Your GitHub and projects') },
  { words: /\btesting\b|\btesters?\b/, ask: ask('optional', ['github'], null, 'Your GitHub and projects') },
  {
    words: /\bmedia buy(?:er|ers|ing)\b|\btraffic\b|\bmarketing manager\b|\bseo specialist\b/,
    ask: ask('optional', ['pdf', 'google_drive', 'website'], 'Case studies with results (ROAS, CPA, rankings)', 'Your case studies'),
  },
  { words: /\bpages? moderator\b/, ask: ask('optional', ['instagram', 'website'], 'Pages you managed', 'Your pages') },
];

/** A position's name as the rules read it: its levels merged, lower case, "ui/ux" and "UI-UX" alike, single spaces. */
function ruleWords(title: string): string {
  return positionNameOf(title)
    .toLowerCase()
    .replace(/[-–—_,.]+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The portfolio a job title asks for when HR set none (owner's table, 25 October 2026), by the words of its merged
 * position name in English: a graphic designer's, a UI/UX designer's, motion's, a video editor's … Required; a
 * developer's, a tester's, a media buyer's … Optional; everything else Hidden. Its section title by the same row (26
 * October 2026), DEFAULT_PORTFOLIO_TITLE for everything else; also the title of a job title HR set without one.
 */
export function portfolioDefaultFor(title: string | null | undefined): PortfolioAsk {
  const words = ruleWords(title ?? '');
  if (!words) return { ...HIDDEN_PORTFOLIO, kinds: [] };
  const rule = DEFAULT_RULES.find((r) => r.words.test(words));
  return rule ? { ...rule.ask, kinds: orderedKinds(rule.ask.kinds) } : { ...HIDDEN_PORTFOLIO, kinds: [] };
}

/** The kinds in their own order, each once. */
export const orderedKinds = (kinds: readonly PortfolioKind[]): PortfolioKind[] => PORTFOLIO_KINDS.filter((k) => kinds.includes(k));

/**
 * One ask from several (a position on "Send us your CV" that merges several job titles): the strictest mode; the kinds
 * of every one that asks, together; the most links; the hint of the first of the strictest that has one, and the
 * section title of that one (else of the first of the strictest). None asking: hidden, with the first one's title.
 */
export function strictestAsk(asks: readonly PortfolioAsk[]): PortfolioAsk {
  const asking = asks.filter((a) => a.mode !== 'hidden');
  if (!asking.length) return { ...HIDDEN_PORTFOLIO, title: asks[0]?.title ?? DEFAULT_PORTFOLIO_TITLE, kinds: [] };
  const mode = asking.reduce<PortfolioMode>((m, a) => (STRICTNESS[a.mode] > STRICTNESS[m] ? a.mode : m), 'optional');
  const strictest = asking.filter((a) => a.mode === mode);
  const lead = strictest.find((a) => a.hint) ?? strictest[0];
  return {
    mode,
    title: lead.title,
    hint: lead.hint ?? null,
    kinds: orderedKinds(asking.flatMap((a) => a.kinds)),
    maxLinks: Math.max(...asking.map((a) => a.maxLinks)),
  };
}

/**
 * A vacancy's own say (owner's brief: "Portfolio: as the job title / Hidden / Optional / Required"): `mode` null keeps
 * the job title's; otherwise its mode with the job title's kinds, hint and section title (26 October 2026: the title
 * goes as the hint does), or every kind when the job title takes none.
 */
export function withVacancyMode(title: PortfolioAsk, mode: PortfolioMode | null | undefined): PortfolioAsk {
  if (!mode || mode === title.mode) return title;
  if (mode === 'hidden') return { ...HIDDEN_PORTFOLIO, title: title.title, kinds: [] };
  return { mode, title: title.title, hint: title.hint, kinds: title.kinds.length ? [...title.kinds] : [...PORTFOLIO_KINDS], maxLinks: title.maxLinks || PORTFOLIO_LIMITS.links };
}

/** "Other (write it)" on "Send us your CV": a portfolio taken but never asked for, any kind, as the form had before. */
export const OTHER_POSITION_PORTFOLIO: PortfolioAsk = { mode: 'optional', title: DEFAULT_PORTFOLIO_TITLE, hint: null, kinds: [...PORTFOLIO_KINDS], maxLinks: PORTFOLIO_LIMITS.links };

// ---------- the links ----------

/** A host as compared: lower case, without "www." or "m." in front. */
const bareHost = (host: string) => host.toLowerCase().replace(/^(?:www|m)\./, '');

/** Each platform's hosts (a host, or a host ending in one of these after a dot). */
const PLATFORM_HOSTS: readonly [PortfolioLinkKind, RegExp][] = [
  ['behance', /^(?:[a-z0-9-]+\.)?behance\.net$/],
  ['dribbble', /^dribbble\.com$/],
  ['vimeo', /^(?:player\.)?vimeo\.com$/],
  ['youtube', /^(?:youtube\.com|youtu\.be|music\.youtube\.com)$/],
  ['instagram', /^instagram\.com$/],
  ['tiktok', /^(?:vm\.|vt\.)?tiktok\.com$/],
  ['github', /^(?:github\.com|[a-z0-9-]+\.github\.io|gist\.github\.com)$/],
  ['app_store', /^(?:apps|itunes)\.apple\.com$/],
  ['google_play', /^play\.google\.com$/],
  ['google_drive', /^(?:drive|docs)\.google\.com$/],
  ['frame_io', /^(?:(?:app|next|[a-z0-9-]+)\.)?frame\.io$|^f\.io$/],
  ['figma', /^figma\.com$/],
  ['artstation', /^(?:[a-z0-9-]+\.)?artstation\.com$/],
  ['medium', /^(?:[a-z0-9-]+\.)?medium\.com$/],
];

/** Each platform's addresses, as its own pages give them (the path and the query, the host taken off). */
const PLATFORM_SHAPES: Record<Exclude<PortfolioLinkKind, 'website'>, (host: string, path: string, query: URLSearchParams) => boolean> = {
  // behance.net/name, behance.net/gallery/123/…, name.behance.net
  behance: (host, path) => (host !== 'behance.net' && /^[a-z0-9-]+\.behance\.net$/.test(host)) || /^\/(?:gallery\/\d+(?:\/.*)?|[A-Za-z0-9_-]{2,}(?:\/.*)?)$/.test(path),
  // dribbble.com/name, dribbble.com/shots/123-…
  dribbble: (_h, path) => /^\/(?:shots\/\d+[^/]*(?:\/.*)?|[A-Za-z0-9_-]{2,}(?:\/.*)?)$/.test(path),
  // vimeo.com/123, vimeo.com/name, vimeo.com/showcase/123, vimeo.com/channels/name, player.vimeo.com/video/123
  vimeo: (host, path) => (host === 'player.vimeo.com' ? /^\/video\/\d+/.test(path) : /^\/(?:\d+(?:\/[A-Za-z0-9]+)?|(?:showcase|album|channels|groups)\/[A-Za-z0-9_-]+(?:\/.*)?|[A-Za-z][A-Za-z0-9_-]+(?:\/.*)?)$/.test(path)),
  // youtube.com/watch?v=…, youtu.be/…, youtube.com/@channel, /shorts/…, /channel/…, /c/…, /playlist?list=…
  youtube: (host, path, query) =>
    host === 'youtu.be'
      ? /^\/[A-Za-z0-9_-]{6,}$/.test(path)
      : (path === '/watch' && /^[A-Za-z0-9_-]{6,}$/.test(query.get('v') ?? '')) ||
        (path === '/playlist' && !!query.get('list')) ||
        /^\/(?:@[A-Za-z0-9._-]+(?:\/.*)?|shorts\/[A-Za-z0-9_-]{6,}|(?:channel|c|user)\/[A-Za-z0-9_-]+(?:\/.*)?|embed\/[A-Za-z0-9_-]{6,})$/.test(path),
  // instagram.com/name, /p/…, /reel/…
  instagram: (_h, path) => /^\/(?:(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?|[A-Za-z0-9._]{1,30}\/?)$/.test(path) && !/^\/(?:accounts|explore|about)\/?$/.test(path),
  // tiktok.com/@name, tiktok.com/@name/video/123, vm.tiktok.com/…
  tiktok: (host, path) => (host === 'tiktok.com' ? /^\/@[A-Za-z0-9._]{2,}(?:\/video\/\d+)?\/?$/.test(path) : /^\/[A-Za-z0-9]+\/?$/.test(path)),
  // github.com/name, github.com/name/repo, name.github.io, gist.github.com/…
  github: (host, path) => host.endsWith('.github.io') || (host === 'gist.github.com' ? /^\/[A-Za-z0-9-]+/.test(path) : /^\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9._-]+)?(?:\/.*)?$/.test(path)),
  // apps.apple.com/… (an app's page)
  app_store: (_h, path) => /^\/(?:[a-z]{2}\/)?(?:app|developer)\/.+/.test(path),
  // play.google.com/store/apps/…
  google_play: (_h, path) => /^\/store\/apps\/.+/.test(path),
  // drive.google.com/…, docs.google.com/… (a file or a folder)
  google_drive: (_h, path) => path.length > 1,
  // frame.io/…, f.io/…
  frame_io: (_h, path) => path.length > 1,
  // figma.com/file/…, /design/…, /proto/…, /community/…, /@name
  figma: (_h, path) => /^\/(?:file|design|proto|board|slides|community|deck|@)[^\s]*/.test(path),
  // artstation.com/name, artstation.com/artwork/…, name.artstation.com
  artstation: (host, path) => (host !== 'artstation.com' && host.endsWith('.artstation.com')) || /^\/(?:artwork\/[A-Za-z0-9]+|[A-Za-z0-9_-]{2,})(?:\/.*)?$/.test(path),
  // medium.com/@name, name.medium.com, medium.com/<publication>/<article>
  medium: (host, path) => (host !== 'medium.com' && host.endsWith('.medium.com')) || /^\/@[A-Za-z0-9._-]+(?:\/.*)?$/.test(path) || /^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+/.test(path),
};

/** The platform a link is on, by its host: a known one, else a website. Null when it isn't an address at all. */
export function portfolioPlatformOf(value: string): PortfolioLinkKind | null {
  const url = urlOf(value);
  if (!url) return null;
  const host = bareHost(url.hostname);
  return PLATFORM_HOSTS.find(([, re]) => re.test(host))?.[0] ?? 'website';
}

/** "Vimeo", "Personal website" … for a link, as the pages show it beside the link. */
export const portfolioPlatformLabel = (value: string): string => {
  const kind = portfolioPlatformOf(value);
  return kind === 'website' || !kind ? 'Website' : PORTFOLIO_KIND_LABELS[kind];
};

/** A link as typed, read as an address (https:// put in front when it has no scheme); null when it isn't one. */
function urlOf(value: string): URL | null {
  const t = value.trim();
  if (!t || /\s/.test(t)) return null;
  const whole = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`;
  try {
    const url = new URL(whole);
    return url.hostname.includes('.') ? url : null;
  } catch {
    return null;
  }
}

/** "Behance or Dribbble", "Vimeo, YouTube or Behance". */
export function kindsInWords(kinds: readonly PortfolioKind[]): string {
  const labels = orderedKinds(kinds).map((k) => (k === 'website' ? 'your own website' : k === 'pdf' ? 'a PDF case study' : PORTFOLIO_KIND_LABELS[k]));
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}

/** A portfolio link checked: the link as kept (https, as typed otherwise) and its platform, or what is wrong in words. */
export type PortfolioLinkCheck = { ok: true; link: string; kind: PortfolioLinkKind } | { ok: false; problem: string };

/**
 * A link checked by its shape, for `kinds` (owner's brief, 25 October 2026): https; a known platform's address
 * (behance.net/name, dribbble.com/name, vimeo.com/123 or /name, youtube.com/watch?v= or youtu.be/ or @channel,
 * instagram.com/name, tiktok.com/@name, github.com/name, apps.apple.com/…, play.google.com/store/apps/…,
 * drive.google.com/…, frame.io/…, figma.com/…, artstation.com/name, medium.com/@name); or any https site when a personal
 * website is taken. Never fetched.
 */
export function checkPortfolioLink(value: string, kinds: readonly PortfolioKind[]): PortfolioLinkCheck {
  const t = value.trim();
  const takes = orderedKinds(kinds).filter((k) => k !== 'pdf');
  const anySite = takes.includes('website');
  const examples = takes.filter((k) => k !== 'website').slice(0, 2).map((k) => PORTFOLIO_KIND_EXAMPLES[k as PortfolioLinkKind]);
  const eg = examples.length ? `, e.g. ${examples.join(' or ')}` : anySite ? `, e.g. ${PORTFOLIO_KIND_EXAMPLES.website}` : '';
  if (/^http:\/\//i.test(t)) return { ok: false, problem: `Use your link’s https:// address: ${t.slice(0, 60)}` };
  const url = urlOf(t);
  if (!url || url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || t.length > RECRUITMENT_LIMITS.link) {
    return { ok: false, problem: `Write each portfolio link as a web address${eg}.` };
  }
  const host = bareHost(url.hostname);
  const kind = PLATFORM_HOSTS.find(([, re]) => re.test(host))?.[0] ?? 'website';
  // a bare site without its slash ("https://your-site.com"); anything else as the address reads
  const link = url.pathname === '/' && !url.search && !url.hash ? `${url.protocol}//${url.host}` : url.toString();
  if (kind !== 'website') {
    const shaped = PLATFORM_SHAPES[kind](host, url.pathname.replace(/\/+$/, '') || '/', url.searchParams);
    if (takes.includes(kind)) {
      return shaped ? { ok: true, link, kind } : { ok: false, problem: `This doesn’t look like a ${PORTFOLIO_KIND_LABELS[kind]} link: write it as ${PORTFOLIO_KIND_EXAMPLES[kind]}.` };
    }
    if (anySite) return { ok: true, link, kind };
    return { ok: false, problem: `${PORTFOLIO_KIND_LABELS[kind]} isn’t asked for here: add ${kindsInWords(takes) || 'a link to your work'}.` };
  }
  if (anySite) return { ok: true, link, kind: 'website' };
  return { ok: false, problem: `Add a link on ${kindsInWords(takes) || 'a platform from the list'}${eg}.` };
}

/** "Add your portfolio: a showreel on Vimeo or YouTube." The hint's first word in lower case when it is a common one. */
export function portfolioRequiredText(a: Pick<PortfolioAsk, 'hint' | 'kinds'>): string {
  const hint = a.hint?.trim().replace(/[.\s]+$/, '');
  if (!hint) return a.kinds.length ? `Add your portfolio: ${kindsInWords(a.kinds)}.` : 'Add your portfolio: a link to your work.';
  const [first, ...rest] = hint.split(' ');
  const common = /^(?:A|An|The|Your|Links?|Case|Pages?|Some|One|Samples?)$/.test(first);
  return `Add your portfolio: ${[common ? first.toLowerCase() : first, ...rest].join(' ')}.`;
}

/** The careers forms' fields: each link's box (portfolioLink-0 …), and what the API takes (the links as JSON, the PDF). */
export const portfolioLinkField = (i: number): string => `portfolioLink-${i}`;
export const PORTFOLIO_LINKS_FIELD = 'portfolioLinks';
export const PORTFOLIO_FILE_FIELD = 'portfolioFile';

/** The links an API form sent (PORTFOLIO_LINKS_FIELD, a JSON list of texts), at most 10 read; [] for anything else. */
export function portfolioLinksSent(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((l): l is string => typeof l === 'string').slice(0, 10) : [];
  } catch {
    return [];
  }
}

/** What a form sends for its portfolio: the links typed (empty ones dropped) and whether a PDF case study is attached. */
export interface PortfolioInput {
  links: readonly string[];
  file: boolean;
}

/**
 * A form's portfolio checked against its ask: the links as kept (each once, in order) and what is wrong in words.
 * Hidden: nothing is taken (the links and the file are ignored). A file is taken only when a PDF case study is; more
 * links than allowed, a link of the wrong shape and, for Required, none at all are refused.
 */
export function checkPortfolio(input: PortfolioInput, a: PortfolioAsk): { links: string[]; file: boolean; problems: string[] } {
  if (a.mode === 'hidden') return { links: [], file: false, problems: [] };
  const problems: string[] = [];
  const typed = input.links.map((l) => (typeof l === 'string' ? l.trim() : '')).filter(Boolean);
  const links: string[] = [];
  for (const t of typed) {
    const c = checkPortfolioLink(t, a.kinds);
    if (!c.ok) problems.push(c.problem);
    else if (!links.includes(c.link)) links.push(c.link);
  }
  const max = Math.min(Math.max(a.maxLinks, PORTFOLIO_LIMITS.linksMin), PORTFOLIO_LIMITS.links);
  if (links.length > max) problems.push(max === 1 ? 'Add one portfolio link.' : `Add at most ${max} portfolio links.`);
  const file = input.file && a.kinds.includes('pdf');
  if (a.mode === 'required' && !typed.length && !file) problems.push(portfolioRequiredText(a));
  return { links: problems.length ? [] : links, file, problems };
}

// ---------- HR's settings (Recruitment Settings: "Portfolio on the Forms") ----------

/** A position's setting as HR sends it: for every job title it merges. */
export interface PortfolioSettingInput {
  /** The position's key (cv-positions.ts). */
  key: string;
  mode: PortfolioMode;
  /** The section title (26 October 2026); blank or none: the rule's (portfolioDefaultFor). */
  title?: string | null;
  hint?: string | null;
  kinds: PortfolioKind[];
  maxLinks: number;
}

/** A section title as typed: trimmed, its spaces single; '' for none. */
const tidyTitle = (title: unknown): string => (typeof title === 'string' ? title.trim().replace(/\s+/g, ' ') : '');

/** What is wrong with a position's setting, in words (`name`: the position's, to say which). */
export function portfolioSettingProblems(s: Partial<PortfolioSettingInput>, name: string): string[] {
  const problems: string[] = [];
  if (!isPortfolioMode(s.mode)) problems.push(`Choose Hidden, Optional or Required for ${name}.`);
  const hint = typeof s.hint === 'string' ? s.hint.trim() : '';
  if (hint.length > PORTFOLIO_LIMITS.hint) problems.push(`Keep the hint for ${name} to ${PORTFOLIO_LIMITS.hint} characters or fewer.`);
  if (tidyTitle(s.title).length > PORTFOLIO_LIMITS.title) problems.push(`Keep the section title for ${name} to ${PORTFOLIO_LIMITS.title} characters or fewer.`);
  const kinds = Array.isArray(s.kinds) ? s.kinds : [];
  if (kinds.some((k) => !isPortfolioKind(k))) problems.push(`Choose the kinds of portfolio for ${name} from the list.`);
  if (s.mode !== 'hidden' && isPortfolioMode(s.mode) && !kinds.some(isPortfolioKind)) problems.push(`Choose at least one kind of portfolio for ${name}.`);
  if (!Number.isInteger(s.maxLinks) || (s.maxLinks as number) < PORTFOLIO_LIMITS.linksMin || (s.maxLinks as number) > PORTFOLIO_LIMITS.links) {
    problems.push(`Allow 1 to ${PORTFOLIO_LIMITS.links} links for ${name}.`);
  }
  return problems;
}

/**
 * A setting as kept: its kinds in order and each once, the hint trimmed (none when empty), the section title trimmed
 * (blank: `defaultTitle`, the rule's for the job title), hidden with no kinds.
 */
export function tidyAsk(s: Pick<PortfolioSettingInput, 'mode' | 'title' | 'hint' | 'kinds' | 'maxLinks'>, defaultTitle: string = DEFAULT_PORTFOLIO_TITLE): PortfolioAsk {
  const hint = typeof s.hint === 'string' && s.hint.trim() ? s.hint.trim().replace(/\s+/g, ' ') : null;
  return { mode: s.mode, title: tidyTitle(s.title) || defaultTitle, hint, kinds: orderedKinds(s.kinds.filter(isPortfolioKind)), maxLinks: s.maxLinks };
}

/** The section title as kept for a job title: none when it is the rule's (`defaultTitle`), so the rule's stays its own. */
export const keptPortfolioTitle = (ask: Pick<PortfolioAsk, 'title'>, defaultTitle: string): string | null => (ask.title === defaultTitle ? null : ask.title);

/** Whether two asks are the same (a setting the same as the default is kept as none). */
export const sameAsk = (a: PortfolioAsk, b: PortfolioAsk): boolean =>
  a.mode === b.mode &&
  a.title === b.title &&
  (a.hint ?? null) === (b.hint ?? null) &&
  a.maxLinks === b.maxLinks &&
  orderedKinds(a.kinds).join() === orderedKinds(b.kinds).join();

/** A position with its portfolio: what the forms ask (the strictest of its job titles'), and the rule's default. */
export interface PortfolioPositionView {
  key: string;
  name: string;
  /** Its team as HR's lists name it: "Video · Production". */
  teamHrName: string;
  teamId: string;
  hidden: boolean;
  titles: string[];
  /** What the forms ask for it. */
  ask: PortfolioAsk;
  /** The rule's, for a job title without a setting (its title: what a blank section title means). */
  defaultAsk: PortfolioAsk;
  /** HR set it (one of its job titles at least); false: the rule's default. */
  set: boolean;
  /** Its job titles ask differently (a job title added since): saving makes them one. */
  mixed: boolean;
}

/** GET /recruitment/settings/portfolio. */
export interface PortfolioSettingsView {
  positions: PortfolioPositionView[];
  updatedAt: string | null;
  updatedBy: RecruitmentUserRef | null;
}
