import {
  isPortfolioKind,
  isPortfolioMode,
  kindsInWords,
  PORTFOLIO_KINDS,
  PORTFOLIO_LIMITS,
  PORTFOLIO_MODE_LABELS,
  portfolioPlatformLabel,
  type PortfolioAsk,
  type PortfolioKind,
  type PortfolioMode,
  type PortfolioPositionView,
  type PortfolioSettingInput,
} from '@trendlix/shared';

// A portfolio per position on HR's side (owner, 25 October 2026, on "Apply for This Job": "for creatives, they need to
// add their portfolios. so based on the positions i have, what kind of portfolios i might need to ask them for?"; asked,
// "Portfolio per position"; packages/shared portfolio.ts): Recruitment Settings' "Portfolio on the Forms" read into what
// the API takes, the positions grouped by team, an ask in words, a vacancy's "Portfolio" choice, and the links an
// applicant or a general CV sent as chips with their platform (never fetched: the platforms block automatic checks, and
// nothing fetches an address people type). Pure code, tested in portfolio.test.ts; the API checks everything again.

// ---------- Recruitment Settings: "Portfolio on the Forms" ----------

/** The form fields of a position's row: its key, its mode, its hint, its kinds (one box each) and its links allowed. */
export const portfolioField = {
  key: 'portfolioKey',
  mode: (key: string) => `mode-${key}`,
  hint: (key: string) => `hint-${key}`,
  kinds: (key: string) => `kinds-${key}`,
  links: (key: string) => `links-${key}`,
} as const;

/** The links allowed a form, as the row's list offers them: 1 to 3. */
export const LINK_CHOICES = Array.from({ length: PORTFOLIO_LIMITS.links - PORTFOLIO_LIMITS.linksMin + 1 }, (_, i) => PORTFOLIO_LIMITS.linksMin + i);

const text = (fd: FormData, name: string): string => {
  const v = fd.get(name);
  return typeof v === 'string' ? v.trim() : '';
};

/**
 * HR's settings as the API takes them (PUT /recruitment/settings/portfolio): every row on the form (its key in
 * `portfolioKey`), with its mode, hint (empty: none), the kinds ticked (in their own order) and the links allowed. A mode
 * or a number that isn't one is passed on as typed, for the API to refuse in words.
 */
export function portfolioSettingsOf(fd: FormData): PortfolioSettingInput[] {
  const keys = [...new Set(fd.getAll(portfolioField.key).filter((k): k is string => typeof k === 'string' && k.length > 0))];
  return keys.map((key) => {
    const ticked = fd.getAll(portfolioField.kinds(key)).filter((k): k is PortfolioKind => isPortfolioKind(k));
    const mode = text(fd, portfolioField.mode(key));
    const links = Number(text(fd, portfolioField.links(key)));
    return {
      key,
      mode: (isPortfolioMode(mode) ? mode : mode || 'hidden') as PortfolioMode,
      hint: text(fd, portfolioField.hint(key)).replace(/\s+/g, ' ') || null,
      kinds: PORTFOLIO_KINDS.filter((k) => ticked.includes(k)),
      maxLinks: Number.isFinite(links) ? links : NaN,
    };
  });
}

/** What was typed, kept to show again after a refused save: each row's fields, its kinds as the list ticked. */
export function typedPortfolioValues(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== 'string' || k.startsWith('$')) continue;
    if (k.startsWith('kinds-')) out[k] = [...((out[k] as string[] | undefined) ?? []), v];
    else if (k !== portfolioField.key) out[k] = v;
  }
  return out;
}

/** The positions grouped by team, in their order, under the team's name as HR's lists give it ("Video · Production"). */
export function portfolioByTeam(positions: readonly PortfolioPositionView[]): { teamId: string; team: string; positions: PortfolioPositionView[] }[] {
  const out: { teamId: string; team: string; positions: PortfolioPositionView[] }[] = [];
  for (const p of positions) {
    const last = out[out.length - 1];
    if (last && last.teamId === p.teamId) last.positions.push(p);
    else out.push({ teamId: p.teamId, team: p.teamHrName, positions: [p] });
  }
  return out;
}

/** "Required: Vimeo, YouTube or Behance, up to 3 links"; "Hidden". */
export function askText(ask: PortfolioAsk): string {
  if (ask.mode === 'hidden') return PORTFOLIO_MODE_LABELS.hidden;
  const kinds = kindsInWords(ask.kinds);
  const links = ask.maxLinks === 1 ? '1 link' : `up to ${ask.maxLinks} links`;
  return `${PORTFOLIO_MODE_LABELS[ask.mode]}${kinds ? `: ${kinds}` : ''}, ${links}`;
}

/** A row's values as the form shows them: what was sent before a refused save, else the position's ask. */
export function rowValues(p: PortfolioPositionView, sent?: Record<string, string | string[]>): { mode: PortfolioMode; hint: string; kinds: PortfolioKind[]; maxLinks: number } {
  if (!sent) return { mode: p.ask.mode, hint: p.ask.hint ?? '', kinds: [...p.ask.kinds], maxLinks: p.ask.maxLinks };
  const one = (name: string) => {
    const v = sent[name];
    return (Array.isArray(v) ? v[0] : v) ?? '';
  };
  const many = (name: string) => {
    const v = sent[name];
    return Array.isArray(v) ? v : v ? [v] : [];
  };
  const mode = one(portfolioField.mode(p.key));
  const links = Number(one(portfolioField.links(p.key)));
  return {
    mode: isPortfolioMode(mode) ? mode : p.ask.mode,
    hint: one(portfolioField.hint(p.key)),
    kinds: PORTFOLIO_KINDS.filter((k) => many(portfolioField.kinds(p.key)).includes(k)),
    maxLinks: LINK_CHOICES.includes(links) ? links : p.ask.maxLinks,
  };
}

// ---------- a vacancy's "Portfolio" (as the job title, or its own) ----------

/** The vacancy form's field, and its choices: "As the job title" (empty), then each mode. */
export const PORTFOLIO_MODE_FIELD = 'portfolioMode';

/** The choice sent: a mode, or null for "As the job title" (anything else too: the API refuses nothing it never got). */
export const vacancyPortfolioModeOf = (value: string): PortfolioMode | null => (isPortfolioMode(value) ? value : null);

/** "The job title asks: Required: Vimeo or YouTube, up to 3 links."; null when it isn't known (a new vacancy). */
export function jobTitleAskText(ask: PortfolioAsk | null | undefined): string | null {
  return ask ? `The job title asks: ${askText(ask)}.` : null;
}

/** A vacancy's portfolio in a line, for its page: its own choice, or the job title's ask. */
export function vacancyPortfolioText(mode: PortfolioMode | null | undefined, title: PortfolioAsk | null | undefined): string | null {
  if (mode) return `${PORTFOLIO_MODE_LABELS[mode]}, set on this vacancy`;
  return title ? `As the job title: ${askText(title)}` : null;
}

// ---------- the links and the file, on HR's pages ----------

/** Every portfolio link of an application or a general CV: its list (25 October 2026), else the one link of before. */
export function portfolioLinksOf(r: { portfolioLinks?: readonly string[] | null; portfolio?: string | null }): string[] {
  if (r.portfolioLinks?.length) return [...r.portfolioLinks];
  return r.portfolio ? [r.portfolio] : [];
}

/** A link's chip: its platform ("Vimeo"), what it shows ("vimeo.com/123456789") and where it goes (none: not a web link). */
export function portfolioChip(link: string): { platform: string; shown: string; href: string | null } {
  const href = /^https?:\/\/[^\s]+$/i.test(link) ? link : null;
  const shown = link
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '');
  return { platform: portfolioPlatformLabel(link), shown: shown.length > 48 ? `${shown.slice(0, 47)}…` : shown, href };
}

/** The PDF case study of an application or a general CV, through the website (the API checks who may see it). */
export const applicantPortfolioHref = (id: string, download = false) => `/recruitment/applicants/${encodeURIComponent(id)}/portfolio${download ? '?download=1' : ''}`;
export const generalPortfolioHref = (id: string, download = false) => `/recruitment/general-cvs/${encodeURIComponent(id)}/portfolio${download ? '?download=1' : ''}`;
