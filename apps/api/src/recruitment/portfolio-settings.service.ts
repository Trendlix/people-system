import { BadRequestException, Injectable } from '@nestjs/common';
import {
  HIDDEN_PORTFOLIO,
  isPortfolioMode,
  keptPortfolioTitle,
  OTHER_POSITION_PORTFOLIO,
  PORTFOLIO_MODE_LABELS,
  portfolioDefaultFor,
  portfolioSettingProblems,
  sameAsk,
  strictestAsk,
  tidyAsk,
  withVacancyMode,
  type CvPosition,
  type PortfolioAsk,
  type PortfolioKind,
  type PortfolioMode,
  type PortfolioPositionView,
  type PortfolioSettingInput,
  type PortfolioSettingsView,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { SessionUser } from '../auth/session-user.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { positionsOf } from './cv-positions.js';
import { askOfRow, asksOfTitles } from './portfolio-asks.js';
import { userRef } from './recruitment-views.js';
import { SETTINGS_ENTITY } from './recruitment-settings.service.js';

// The portfolio on the careers forms, per position (owner, 25 October 2026: "for creatives, they need to add their
// portfolios. so based on the positions i have, what kind of portfolios i might need to ask them for?"; asked, "Portfolio
// per position"; packages/shared portfolio.ts). Kept per job title (portfolio_settings): Hidden, Optional or Required, a
// hint, the kinds taken, 1 to 3 links; a job title without a row asks the rule's default (portfolioDefaultFor, by its
// merged position name). Recruitment Settings' "Portfolio on the Forms" lists the positions by team, as "Positions on the
// CV Form" does: HR (or a Super Admin) sets a position, which sets each of its job titles; one set like its default
// keeps no row. Each save audited (the positions changed, their mode before and after). A job's form asks its vacancy's
// job title's (the vacancy's own mode, when set, over it); "Send us your CV" a position's, the strictest of its titles'.
// Since 26 October 2026 (owner, on the careers site's form: "this part needs to be more clearer .. i cant visualize that
// this is a portfolio section"; asked, "a section title per position"), each with its section title, the portfolio
// part's heading: HR's beside the hint (blank: the rule's, kept as none), going with the hint wherever it goes; HR's
// pages show it by the links sent (portfolio-asks.ts portfolioTitlesOf).

type Db = Pick<PrismaService, 'portfolioSetting'>;

/** What a job title asks: its setting, else the rule's default for its name. */
export async function titleAsk(prisma: Db, jobTitle: { id: string; titleEn: string }): Promise<PortfolioAsk> {
  const row = await prisma.portfolioSetting.findUnique({ where: { jobTitleId: jobTitle.id } });
  const byRule = portfolioDefaultFor(jobTitle.titleEn);
  return askOfRow(row, byRule.title) ?? byRule;
}

/** What a vacancy's form asks: its job title's, its own mode over it when set. */
export async function vacancyAsk(prisma: Db, v: { portfolioMode: string | null; jobTitle: { id: string; titleEn: string } }): Promise<PortfolioAsk> {
  return withVacancyMode(await titleAsk(prisma, v.jobTitle), isPortfolioMode(v.portfolioMode) ? v.portfolioMode : null);
}

/** "Required: vimeo, youtube; 3 links; “A showreel”; title “Your showreel”", for the audit log. */
const askText = (a: PortfolioAsk) =>
  `${a.mode === 'hidden' ? 'Hidden' : `${PORTFOLIO_MODE_LABELS[a.mode]}: ${a.kinds.join(', ')}; ${a.maxLinks} ${a.maxLinks === 1 ? 'link' : 'links'}${a.hint ? `; “${a.hint}”` : ''}`}; title “${a.title}”`;

@Injectable()
export class PortfolioSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every job title's ask, by id, for the positions given (their settings, else the defaults by name). */
  private asksOf(positions: readonly CvPosition[]): Promise<Map<string, PortfolioAsk>> {
    return asksOfTitles(this.prisma, positions);
  }

  /** A position's view: what its titles ask together (the strictest), the rule's default, whether set and alike. */
  private positionView(p: CvPosition, asks: ReadonlyMap<string, PortfolioAsk>, setIds: ReadonlySet<string>): PortfolioPositionView {
    const each = p.titleIds.map((id) => asks.get(id) ?? HIDDEN_PORTFOLIO);
    return {
      key: p.key,
      name: p.shownName,
      teamHrName: p.teamHrName,
      teamId: p.teamId,
      hidden: p.hidden,
      titles: p.titles,
      ask: strictestAsk(each),
      defaultAsk: portfolioDefaultFor(p.name),
      set: p.titleIds.some((id) => setIds.has(id)),
      mixed: each.some((a) => !sameAsk(a, each[0])),
    };
  }

  /** GET /recruitment/settings/portfolio: every position (hidden ones too), by team, with what its forms ask. */
  async view(): Promise<PortfolioSettingsView> {
    const positions = await positionsOf(this.prisma);
    const [asks, rows, last] = await Promise.all([
      this.asksOf(positions),
      this.prisma.portfolioSetting.findMany({ select: { jobTitleId: true } }),
      this.prisma.portfolioSetting.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true, updatedBy: { select: { id: true, email: true } } } }),
    ]);
    const setIds = new Set(rows.map((r) => r.jobTitleId));
    const names = await userNames(this.prisma, [last?.updatedBy ?? null]);
    return { positions: positions.map((p) => this.positionView(p, asks, setIds)), updatedAt: last?.updatedAt.toISOString() ?? null, updatedBy: userRef(last?.updatedBy ?? null, names) };
  }

  /**
   * PUT /recruitment/settings/portfolio: each position sent sets every job title it merges; one the same as a title's
   * default keeps no row for it. Only what changed is written and audited. A position no longer on the list (its job
   * titles changed since the page opened) refuses the save.
   */
  async save(dto: { positions?: unknown }, user: SessionUser): Promise<PortfolioSettingsView> {
    const sent = (Array.isArray(dto.positions) ? dto.positions : []).map((r): Partial<PortfolioSettingInput> => {
      const row = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>;
      return {
        key: typeof row.key === 'string' ? row.key : '',
        mode: row.mode as PortfolioMode,
        // the section title (26 October 2026): none or blank, the rule's
        title: typeof row.title === 'string' ? row.title : null,
        hint: typeof row.hint === 'string' ? row.hint : null,
        kinds: Array.isArray(row.kinds) ? (row.kinds as PortfolioKind[]) : [],
        maxLinks: typeof row.maxLinks === 'number' ? row.maxLinks : NaN,
      };
    });
    const positions = await positionsOf(this.prisma);
    const byKey = new Map(positions.map((p) => [p.key, p]));
    if (sent.some((s) => !byKey.has(s.key ?? ''))) throw new BadRequestException(['The positions changed since the page opened: reload it and try again.']);
    const problems = [...new Set(sent.flatMap((s) => portfolioSettingProblems(s, byKey.get(s.key!)!.shownName)))];
    if (problems.length) throw new BadRequestException(problems);
    const chosen = sent.filter((s) => byKey.has(s.key!)).map((s) => ({ position: byKey.get(s.key!)!, setting: s as PortfolioSettingInput }));
    const asks = await this.asksOf(chosen.map((c) => c.position));
    const now = new Date();
    const writes: Prisma.PrismaPromise<unknown>[] = [];
    const changed: string[] = [];
    for (const { position, setting } of chosen) {
      let any = false;
      position.titleIds.forEach((id, i) => {
        // a blank section title is each job title's rule's (26 October 2026), kept as none
        const byRule = portfolioDefaultFor(position.titles[i] ?? position.name);
        const ask = tidyAsk(setting, byRule.title);
        if (sameAsk(asks.get(id) ?? HIDDEN_PORTFOLIO, ask)) return;
        any = true;
        const kept = { mode: ask.mode, title: keptPortfolioTitle(ask, byRule.title), hint: ask.hint, kinds: ask.kinds, maxLinks: ask.maxLinks, updatedById: user.id, updatedAt: now };
        writes.push(
          sameAsk(ask, byRule)
            ? this.prisma.portfolioSetting.deleteMany({ where: { jobTitleId: id } })
            : this.prisma.portfolioSetting.upsert({ where: { jobTitleId: id }, create: { jobTitleId: id, ...kept }, update: kept }),
        );
      });
      if (any) {
        const before = strictestAsk(position.titleIds.map((id) => asks.get(id) ?? HIDDEN_PORTFOLIO));
        changed.push(`${position.shownName} (${position.teamHrName}): ${askText(before)} → ${askText(tidyAsk(setting, portfolioDefaultFor(position.name).title))}`);
      }
    }
    if (!writes.length) return this.view();
    await this.prisma.$transaction(writes);
    await this.audit.record({ userId: user.id, action: 'update', entityType: SETTINGS_ENTITY, entityId: null, diff: { portfolioOnForms: changed } });
    return this.view();
  }

  // ---------- the careers forms ----------

  /**
   * "Send us your CV"'s asks: each shown position's (the strictest of its job titles'), only those asking for one (a
   * position left out asks for none), and Other's.
   */
  async generalAsks(): Promise<{ portfolios: Record<string, PortfolioAsk>; otherPortfolio: PortfolioAsk }> {
    const positions = (await positionsOf(this.prisma)).filter((p) => !p.hidden);
    const asks = await this.asksOf(positions);
    const portfolios: Record<string, PortfolioAsk> = {};
    for (const p of positions) {
      const a = strictestAsk(p.titleIds.map((id) => asks.get(id) ?? HIDDEN_PORTFOLIO));
      if (a.mode !== 'hidden') portfolios[p.key] = a;
    }
    return { portfolios, otherPortfolio: OTHER_POSITION_PORTFOLIO };
  }

  /** A position's ask (the strictest of its job titles'); Other's (or an older page's area) when none is chosen. */
  async positionAsk(position: CvPosition | null): Promise<PortfolioAsk> {
    if (!position) return OTHER_POSITION_PORTFOLIO;
    const asks = await this.asksOf([position]);
    return strictestAsk(position.titleIds.map((id) => asks.get(id) ?? HIDDEN_PORTFOLIO));
  }
}
