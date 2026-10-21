import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  KPI_DEFAULT_PILLAR_SET,
  KPI_FRAMEWORK_LIMITS,
  kpiFrameworkDefaultMonth,
  kpiFrameworkMonthProblems,
  kpiFrameworkOpensFrom,
  kpiMonthAdd,
  kpiMonthName,
  kpiPillarOf,
  kpiPillarSetOf,
  kpiPillarSetProblems,
  kpiPillarsText,
  kpiSamePillars,
  kpiTemplateOpensFrom,
  type KpiFrameworkVersionView,
  type KpiFrameworkView,
  type KpiPillar,
  type KpiPillarInput,
  type KpiPillarSet,
} from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { dayInCairo, fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { firstDay } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { monthOfCard, pillarSetOf, pillarsJsonOf } from './kpi-views.js';
import type { KpiFrameworkDto } from './kpis.dto.js';

// The KPI framework (owner, 21 October 2026: "am i able to edit the pillars of the KPIs?", "Fully flexible"; the rules:
// packages/shared kpi-framework.ts): versions of the pillars, in KPI Settings. Everyone signed in reads them (the
// scorecards show them); HR and a Super Admin change them, each change in the audit log. The one in force is the newest
// whose first month's scorecards have opened; HR saves the next one, from a month whose scorecards aren't open (next
// month unless chosen), and changes it until it applies: one next at a time, saved under a lock. Version 1, the plan's
// four pillars, is made by the migration (and here, when the table is empty, as the tests' database is). When the next
// one's month changes, the template versions published with it open from its new first month. The templates whose
// newest published version has other pillars than the newest framework are those to update (outdated).

export const FRAMEWORK_ENTITY = 'kpi_framework';

/**
 * The lock a change of the framework holds, so two changes at once can't make two next ones; publishing a template
 * holds it shared, so the pillars it takes can't change under it.
 */
export const FRAMEWORK_LOCK = 'people-system kpi framework';

/** Version 1's first month: from the start. */
const FROM_THE_START = '2000-01-01';

type Db = PrismaService | Prisma.TransactionClient;

const USER = { select: { id: true, email: true } } as const;

/** A version of the framework as the services use it. */
export interface FrameworkVersion {
  id: string;
  version: number;
  /** YYYY-MM. */
  appliesFrom: string;
  set: KpiPillarSet & { pillars: KpiPillar[] };
}

const versionOf = (row: { id: string; version: number; appliesFrom: Date; pillars: Prisma.JsonValue; attendancePillar: string }): FrameworkVersion => ({
  id: row.id,
  version: row.version,
  appliesFrom: fromDateOnly(row.appliesFrom).slice(0, 7),
  set: pillarSetOf(row),
});

/**
 * The version in force on `today` (YYYY-MM-DD) and the next one, of the versions oldest first: in force, the newest
 * whose first month is before this one (its scorecards opened on the 1st of this month or earlier); next, the one from
 * this month on (one at most).
 */
export function frameworksOn<T extends { appliesFrom: string }>(versions: readonly T[], today: string): { inForce: T; next: T | null } {
  const current = today.slice(0, 7);
  const applied = versions.filter((v) => v.appliesFrom < current);
  const next = versions.find((v) => v.appliesFrom >= current) ?? null;
  return { inForce: applied.at(-1) ?? versions[0], next };
}

/** The pillars in words, for the audit log: ["Delivery & Timeliness 30%", …]. */
const pillarWords = (set: Pick<KpiPillarSet, 'pillars'>) => kpiPillarsText(set).split(' · ');

/** Exactly the same pillars, in the same order, with the same keys and short names, and the same Attendance pillar. */
const identical = (a: KpiPillarSet, b: KpiPillarSet) => a.attendancePillar === b.attendancePillar && JSON.stringify(pillarsJsonOf(a)) === JSON.stringify(pillarsJsonOf(b));

@Injectable()
export class KpiFrameworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every version, oldest first; version 1 (the plan's four pillars) made when there is none. */
  async versions(db: Db = this.prisma): Promise<FrameworkVersion[]> {
    let rows = await db.kpiFramework.findMany({ orderBy: { version: 'asc' } });
    if (!rows.length) {
      await db.kpiFramework.createMany({
        data: [{ version: 1, appliesFrom: toDateOnly(FROM_THE_START), pillars: pillarsJsonOf(KPI_DEFAULT_PILLAR_SET), attendancePillar: KPI_DEFAULT_PILLAR_SET.attendancePillar }],
        skipDuplicates: true,
      });
      rows = await db.kpiFramework.findMany({ orderBy: { version: 'asc' } });
    }
    return rows.map(versionOf);
  }

  /** The newest version: the next one when there is one, else the one in force. Template drafts are placed in it and published with it. */
  async newest(db: Db = this.prisma): Promise<FrameworkVersion> {
    return (await this.versions(db)).at(-1)!;
  }

  /**
   * The job titles whose newest published template version has other pillars than `newest` (kpiSamePillars): "Uses the
   * old pillars: update it".
   */
  async outdated(newest: Pick<FrameworkVersion, 'set'>, db: Db = this.prisma): Promise<Set<string>> {
    const published = await db.kpiTemplate.findMany({ where: { status: 'published' }, orderBy: { version: 'desc' }, select: { jobTitleId: true, pillars: true, attendancePillar: true } });
    const seen = new Set<string>();
    const out = new Set<string>();
    for (const t of published) {
      if (seen.has(t.jobTitleId)) continue;
      seen.add(t.jobTitleId);
      if (!kpiSamePillars(pillarSetOf(t), newest.set)) out.add(t.jobTitleId);
    }
    return out;
  }

  /** The framework in force and the next one, with what may be chosen, as KPI Settings shows them. */
  async view(user: SessionUser): Promise<KpiFrameworkView> {
    await this.versions();
    const today = todayInCairo();
    const rows = await this.prisma.kpiFramework.findMany({ orderBy: { version: 'asc' }, include: { createdBy: USER, updatedBy: USER } });
    const versions = rows.map((r) => ({ ...versionOf(r), row: r }));
    const { inForce, next } = frameworksOn(versions, today);
    const names = await userNames(this.prisma, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
    const who = (u: { id: string; email: string } | null) => (u ? { email: u.email, name: names.get(u.id)?.name ?? null } : null);
    const viewOf = (v: (typeof versions)[number]): KpiFrameworkVersionView => ({
      id: v.id,
      version: v.version,
      appliesFrom: v.appliesFrom,
      opensFrom: kpiFrameworkOpensFrom(v.appliesFrom),
      pillars: v.set.pillars,
      attendancePillar: v.set.attendancePillar,
      createdAt: v.row.createdAt.toISOString(),
      createdBy: who(v.row.createdBy),
      updatedAt: v.row.updatedAt.toISOString(),
      updatedBy: who(v.row.updatedBy),
    });
    const current = today.slice(0, 7);
    return {
      inForce: viewOf(inForce),
      next: next ? viewOf(next) : null,
      defaultMonth: kpiFrameworkDefaultMonth(today),
      earliestMonth: current,
      latestMonth: kpiMonthAdd(current, KPI_FRAMEWORK_LIMITS.monthsAhead),
      oldTemplates: (await this.outdated(versions.at(-1)!)).size,
      canEdit: user.roles.includes('hr') || user.roles.includes('super_admin'),
      usedKeys: [...new Set(versions.flatMap((v) => v.set.pillars.map((p) => p.key)))],
    };
  }

  /**
   * Saves the next framework (owner's brief, 21 October 2026: "Applies from the next month by default … It can't be
   * set to a month whose scorecards are already open. A draft framework can be edited until it applies"): changes the
   * next one, or makes it as the newest version. Refused (400, each problem) unless its pillars pass the rules and its
   * month's scorecards (and later ones) aren't open; 409 when the next one sent (`nextId`) isn't the next any more.
   */
  async save(dto: KpiFrameworkDto, user: SessionUser): Promise<KpiFrameworkView> {
    const today = todayInCairo();
    const set = kpiPillarSetOf({ pillars: dto.pillars as KpiPillarInput[], attendancePillar: dto.attendancePillar });
    const problems = [...kpiPillarSetProblems(set), ...kpiFrameworkMonthProblems(dto.appliesFrom, today)];
    if (problems.length) throw new BadRequestException(problems);
    const month = toDateOnly(firstDay(dto.appliesFrom));
    const done = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${FRAMEWORK_LOCK}))`;
      const versions = await this.versions(tx);
      const { inForce, next } = frameworksOn(versions, today);
      if (dto.nextId !== undefined && (dto.nextId ?? null) !== (next?.id ?? null)) {
        throw new ConflictException(
          next ? 'Someone saved other pillars meanwhile. Reload the page to see them.' : 'The pillars you were changing apply now, so they can’t be changed. Reload the page.',
        );
      }
      const open = await tx.kpiScorecard.findFirst({ where: { month: { gte: month } }, orderBy: { month: 'desc' }, select: { month: true } });
      if (open) throw new BadRequestException([`The scorecards of ${kpiMonthName(monthOfCard(open))} are open already: choose a later month.`]);
      if (!next && identical(set, inForce.set)) throw new BadRequestException(['These are the pillars in force: change a pillar, a weight or the Attendance metric’s pillar first.']);
      const data = { appliesFrom: month, pillars: pillarsJsonOf(set), attendancePillar: set.attendancePillar, updatedById: user.id };
      if (next) {
        await tx.kpiFramework.update({ where: { id: next.id }, data });
        // the template versions published with it open from its new first month on
        let moved = 0;
        if (next.appliesFrom !== dto.appliesFrom) {
          const published = await tx.kpiTemplate.findMany({ where: { frameworkId: next.id, status: 'published' }, select: { id: true, publishedAt: true } });
          for (const t of published) {
            const opensFrom = kpiTemplateOpensFrom(t.publishedAt ? dayInCairo(t.publishedAt) : today, dto.appliesFrom);
            await tx.kpiTemplate.update({ where: { id: t.id }, data: { opensFrom: toDateOnly(opensFrom) } });
            moved++;
          }
        }
        return { action: 'update' as const, id: next.id, version: next.version, before: next, moved };
      }
      const made = await tx.kpiFramework.create({ data: { ...data, version: versions.at(-1)!.version + 1, createdById: user.id }, select: { id: true, version: true } });
      return { action: 'create' as const, id: made.id, version: made.version, before: inForce, moved: 0 };
    });
    const words = (v: { appliesFrom: string; set: KpiPillarSet }) => ({
      appliesFrom: v.appliesFrom,
      pillars: pillarWords(v.set),
      attendancePillar: kpiPillarOf(v.set, v.set.attendancePillar)?.name ?? v.set.attendancePillar,
    });
    const after = words({ appliesFrom: dto.appliesFrom, set });
    await this.audit.record({
      userId: user.id,
      action: done.action,
      entityType: FRAMEWORK_ENTITY,
      entityId: done.id,
      diff:
        done.action === 'create'
          ? { version: done.version, ...after, opensFrom: kpiFrameworkOpensFrom(dto.appliesFrom), replaces: { version: done.before.version, pillars: pillarWords(done.before.set) } }
          : { version: done.version, ...changes(words(done.before), after), ...(done.moved && { templatesMoved: done.moved }) },
    });
    return this.view(user);
  }
}
