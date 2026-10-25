import {
  HIDDEN_PORTFOLIO,
  isPortfolioKind,
  isPortfolioMode,
  OTHER_POSITION_PORTFOLIO,
  portfolioDefaultFor,
  strictestAsk,
  tidyAsk,
  withVacancyMode,
  type CvPosition,
  type PortfolioAsk,
} from '@trendlix/shared';
import type { PrismaService } from '../prisma/prisma.service.js';
import { positionsOf } from './cv-positions.js';

// The asks of the portfolio per position as kept (portfolio_settings; packages/shared portfolio.ts), read without the
// settings' service, so the pages' services (the CV window's among them) may read them without importing it: a job
// title's row as an ask, every job title's of some positions, and the section title each record's portfolio went under
// (owner, 26 October 2026, on the careers site's form: "this part needs to be more clearer .. i cant visualize that this
// is a portfolio section"; asked, "a section title per position"), shown on HR's pages by the links sent.

type Db = Pick<PrismaService, 'portfolioSetting'>;

/** A job title's kept setting as an ask (no title kept: `defaultTitle`, the rule's); null for none (or one that can't be read: its default then). */
export function askOfRow(r: { mode: string; title: string | null; hint: string | null; kinds: string[]; maxLinks: number } | null | undefined, defaultTitle: string): PortfolioAsk | null {
  if (!r || !isPortfolioMode(r.mode)) return null;
  return tidyAsk({ mode: r.mode, title: r.title, hint: r.hint, kinds: r.kinds.filter(isPortfolioKind), maxLinks: r.maxLinks }, defaultTitle);
}

/** Every job title's ask, by id, for the positions given (their settings, else the defaults by name). */
export async function asksOfTitles(prisma: Db, positions: readonly CvPosition[]): Promise<Map<string, PortfolioAsk>> {
  const ids = positions.flatMap((p) => p.titleIds);
  const rows = ids.length ? await prisma.portfolioSetting.findMany({ where: { jobTitleId: { in: ids } } }) : [];
  const byId = new Map(rows.map((r) => [r.jobTitleId, r]));
  const out = new Map<string, PortfolioAsk>();
  for (const p of positions) {
    p.titleIds.forEach((id, i) => {
      const byRule = portfolioDefaultFor(p.titles[i] ?? p.name);
      out.set(id, askOfRow(byId.get(id), byRule.title) ?? byRule);
    });
  }
  return out;
}

/** An application as its portfolio's section title is read: its id and its vacancy's portfolio. */
export type TitledApplication = { id: string; vacancy: { portfolioMode: string | null; jobTitle: { id: string; titleEn: string } } };
/** A general CV as its section title is read: its id and the position chosen (none: Other, or an older page's area). */
export type TitledGeneralCv = { id: string; positionKey: string | null };

/**
 * The section title each record's portfolio went under, as set now, for HR's pages (26 October 2026: "Your case studies:
 * link, link, PDF"), by the record's id: an application's, its vacancy's ask's (as vacancyAsk reads it); a general CV's,
 * its position's, the strictest of its job titles' (HR's list, hidden ones too); Other's (or an older page's area, or a
 * position no longer on the list) DEFAULT_PORTFOLIO_TITLE.
 */
export async function portfolioTitlesOf(
  prisma: Db & Pick<PrismaService, 'department' | 'jobTitle' | 'cvPositionChoice'>,
  records: { applications?: readonly TitledApplication[]; generalCvs?: readonly TitledGeneralCv[] },
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const apps = records.applications ?? [];
  const gcvs = records.generalCvs ?? [];
  const titleIds = [...new Set(apps.map((a) => a.vacancy.jobTitle.id))];
  const rows = titleIds.length ? await prisma.portfolioSetting.findMany({ where: { jobTitleId: { in: titleIds } } }) : [];
  const byId = new Map(rows.map((r) => [r.jobTitleId, r]));
  for (const a of apps) {
    const byRule = portfolioDefaultFor(a.vacancy.jobTitle.titleEn);
    const ofTitle = askOfRow(byId.get(a.vacancy.jobTitle.id), byRule.title) ?? byRule;
    out.set(a.id, withVacancyMode(ofTitle, isPortfolioMode(a.vacancy.portfolioMode) ? a.vacancy.portfolioMode : null).title);
  }
  if (gcvs.length) {
    const positions = gcvs.some((g) => g.positionKey) ? await positionsOf(prisma) : [];
    const chosen = positions.filter((p) => gcvs.some((g) => g.positionKey === p.key));
    const asks = await asksOfTitles(prisma, chosen);
    const byKey = new Map(chosen.map((p) => [p.key, strictestAsk(p.titleIds.map((id) => asks.get(id) ?? HIDDEN_PORTFOLIO))]));
    for (const g of gcvs) out.set(g.id, (g.positionKey ? byKey.get(g.positionKey)?.title : undefined) ?? OTHER_POSITION_PORTFOLIO.title);
  }
  return out;
}
