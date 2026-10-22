import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
  kpiWithWeights,
  type KpiDepartmentPillarsView,
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
// By department (owner, 22 October 2026: "but i need pillars to each department / wights can be changed for each
// department and Job title"): a department may have its own versions, kept, numbered and changed the same way, or go
// back to the company's pillars from a month (a version that follows the company's). A job title takes its
// department's newest own pillars, else the company's newest (pillarsResolver);
// its template versions may give them the job title's own weights, which count in what they are compared with.
// By team (owner, 22 October 2026: "where is the pillars for team?", then "Yes, add team pillars"): a team may have its
// own versions too, or go back to its department's ("follows" is "takes the level above": a team its department's, a
// department the company's); a job title takes the newest own pillars of the nearest level that has them, team →
// department → company.

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

/** A version of the framework as the services use it: the company's, or a department's own. */
export interface FrameworkVersion {
  id: string;
  version: number;
  /** YYYY-MM. */
  appliesFrom: string;
  /** The department or team whose own pillars these are; null: the company's. */
  departmentId: string | null;
  /** A department's or team's version taking it back to the level above's pillars: no pillars of its own (`set` empty). */
  followsCompany: boolean;
  set: KpiPillarSet & { pillars: KpiPillar[] };
}

type FrameworkRow = {
  id: string;
  version: number;
  appliesFrom: Date;
  departmentId: string | null;
  followsCompany: boolean;
  pillars: Prisma.JsonValue;
  attendancePillar: string;
};

const versionOf = (row: FrameworkRow): FrameworkVersion => ({
  id: row.id,
  version: row.version,
  appliesFrom: fromDateOnly(row.appliesFrom).slice(0, 7),
  departmentId: row.departmentId,
  followsCompany: row.followsCompany,
  set: row.followsCompany ? { pillars: [], attendancePillar: '' } : pillarSetOf(row),
});

/**
 * The pillars a job title takes now (the newest: drafts are placed in them and published with them): `framework`, the
 * version whose pillars they are (its team's own, its department's, or the company's); `appliesFrom` (YYYY-MM), the
 * first month they score for it: the framework's, or the later of that and the months the levels below went back to
 * the one above; `department`, the department or team whose own pillars they are (null: the company's).
 */
export interface PillarsBase {
  framework: FrameworkVersion;
  appliesFrom: string;
  department: { id: string; nameEn: string } | null;
}

/** The pillars a job title of a department or team takes now. */
export type PillarsOf = (departmentId: string) => PillarsBase;

type DepartmentRef = { id: string; nameEn: string; parentId: string | null };

/** A department's or team's top department (a team's department), by id; null when unknown. */
export function topDepartmentOf(departments: readonly DepartmentRef[]): (departmentId: string) => DepartmentRef | null {
  const byId = new Map(departments.map((d) => [d.id, d]));
  return (departmentId) => {
    let d = byId.get(departmentId) ?? null;
    const seen = new Set<string>();
    while (d?.parentId && byId.has(d.parentId) && !seen.has(d.id)) {
      seen.add(d.id);
      d = byId.get(d.parentId)!;
    }
    return d;
  };
}

/**
 * A department's or team's line, nearest first: itself, then its department, and so on to the top (unknown ids left
 * out; a loop, which the organisation never has, cut).
 */
export function departmentChain(departments: readonly DepartmentRef[]): (departmentId: string) => DepartmentRef[] {
  const byId = new Map(departments.map((d) => [d.id, d]));
  return (departmentId) => {
    const out: DepartmentRef[] = [];
    let d = byId.get(departmentId);
    while (d && !out.some((o) => o.id === d!.id)) {
      out.push(d);
      d = d.parentId ? byId.get(d.parentId) : undefined;
    }
    return out;
  };
}

/** The later of two months (YYYY-MM), the second maybe none. */
const later = (a: string, b: string | null): string => (b && b > a ? b : a);

/**
 * Which pillars a job title takes now, from the company's versions and the departments' and teams' own (each oldest
 * first): the newest own version of the nearest level that has one, its team's, else its department's (owner, 22
 * October 2026: "Yes, add team pillars"), else the company's newest. A level whose newest version goes back to the one
 * above passes on, holding the pillars above back to its month: they apply from the later one.
 */
export function pillarsResolver(company: readonly FrameworkVersion[], ownVersions: readonly FrameworkVersion[], departments: readonly DepartmentRef[]): PillarsOf {
  const newestOwn = new Map<string, FrameworkVersion>();
  for (const v of [...ownVersions].sort((a, b) => a.version - b.version)) if (v.departmentId) newestOwn.set(v.departmentId, v);
  const companyNewest = company.at(-1)!;
  const chainOf = departmentChain(departments);
  return (departmentId) => {
    let held: string | null = null;
    for (const level of chainOf(departmentId)) {
      const own = newestOwn.get(level.id);
      if (!own) continue;
      if (!own.followsCompany) return { framework: own, appliesFrom: later(own.appliesFrom, held), department: { id: level.id, nameEn: level.nameEn } };
      held = later(own.appliesFrom, held);
    }
    return { framework: companyNewest, appliesFrom: later(companyNewest.appliesFrom, held), department: null };
  };
}

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

/**
 * A department's or team's own versions on `today`: the one applied (the newest whose first month is before this one; null: none
 * yet) and the next one (from this month on; one at most).
 */
export function ownOn<T extends { appliesFrom: string }>(versions: readonly T[], today: string): { applied: T | null; next: T | null } {
  const current = today.slice(0, 7);
  return { applied: versions.filter((v) => v.appliesFrom < current).at(-1) ?? null, next: versions.find((v) => v.appliesFrom >= current) ?? null };
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

  /**
   * The company's versions (no department), oldest first, version 1 (the plan's four pillars) made when there is none;
   * or a department's own, oldest first (none: it takes the company's).
   */
  async versions(db: Db = this.prisma, departmentId: string | null = null): Promise<FrameworkVersion[]> {
    if (departmentId) return (await db.kpiFramework.findMany({ where: { departmentId }, orderBy: { version: 'asc' } })).map(versionOf);
    let rows = await db.kpiFramework.findMany({ where: { departmentId: null }, orderBy: { version: 'asc' } });
    if (!rows.length) {
      await db.kpiFramework.createMany({
        data: [{ version: 1, appliesFrom: toDateOnly(FROM_THE_START), pillars: pillarsJsonOf(KPI_DEFAULT_PILLAR_SET), attendancePillar: KPI_DEFAULT_PILLAR_SET.attendancePillar }],
        skipDuplicates: true,
      });
      rows = await db.kpiFramework.findMany({ where: { departmentId: null }, orderBy: { version: 'asc' } });
    }
    return rows.map(versionOf);
  }

  /** The company's newest version: the next one when there is one, else the one in force. */
  async newest(db: Db = this.prisma): Promise<FrameworkVersion> {
    return (await this.versions(db)).at(-1)!;
  }

  /** Which pillars each job title takes now, by its department (one read of every version and department). */
  async resolver(db: Db = this.prisma): Promise<PillarsOf> {
    const company = await this.versions(db);
    const [own, departments] = await Promise.all([
      db.kpiFramework.findMany({ where: { departmentId: { not: null } }, orderBy: { version: 'asc' } }),
      db.department.findMany({ select: { id: true, nameEn: true, parentId: true } }),
    ]);
    return pillarsResolver(company, own.map(versionOf), departments);
  }

  /** The pillars a job title of the department (or team) takes now. */
  async pillarsFor(departmentId: string, db: Db = this.prisma): Promise<PillarsBase> {
    return (await this.resolver(db))(departmentId);
  }

  /**
   * The job titles whose newest published template version has other pillars than those they take now, with the own
   * weights it was published with (kpiWithWeights): "Uses the old pillars: update it".
   */
  async outdated(db: Db = this.prisma, pillarsOf?: PillarsOf): Promise<Set<string>> {
    const of = pillarsOf ?? (await this.resolver(db));
    const published = await db.kpiTemplate.findMany({
      where: { status: 'published' },
      orderBy: { version: 'desc' },
      select: { jobTitleId: true, pillars: true, attendancePillar: true, ownWeights: true, jobTitle: { select: { departmentId: true } } },
    });
    const seen = new Set<string>();
    const out = new Set<string>();
    for (const t of published) {
      if (seen.has(t.jobTitleId)) continue;
      seen.add(t.jobTitleId);
      if (!kpiSamePillars(pillarSetOf(t), kpiWithWeights(of(t.jobTitle.departmentId).framework.set, t.ownWeights))) out.add(t.jobTitleId);
    }
    return out;
  }

  /** The company's pillars in force and the next ones, every department's, with what may be chosen, as KPI Pillars shows them. */
  async view(user: SessionUser): Promise<KpiFrameworkView> {
    await this.versions();
    const today = todayInCairo();
    const [rows, departments, jobTitles] = await Promise.all([
      this.prisma.kpiFramework.findMany({ orderBy: { version: 'asc' }, include: { createdBy: USER, updatedBy: USER } }),
      this.prisma.department.findMany({ orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }], select: { id: true, nameEn: true, parentId: true } }),
      this.prisma.jobTitle.findMany({ select: { id: true, departmentId: true } }),
    ]);
    const versions = rows.map((r) => ({ ...versionOf(r), row: r }));
    const company = versions.filter((v) => !v.departmentId);
    const own = versions.filter((v) => v.departmentId);
    const of = pillarsResolver(company, own, departments);
    const outdated = await this.outdated(this.prisma, of);
    const { inForce, next } = frameworksOn(company, today);
    const names = await userNames(this.prisma, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
    const who = (u: { id: string; email: string } | null) => (u ? { email: u.email, name: names.get(u.id)?.name ?? null } : null);
    const viewOf = (v: (typeof versions)[number]): KpiFrameworkVersionView => ({
      id: v.id,
      version: v.version,
      departmentId: v.departmentId,
      followsCompany: v.followsCompany,
      appliesFrom: v.appliesFrom,
      opensFrom: kpiFrameworkOpensFrom(v.appliesFrom),
      pillars: v.set.pillars,
      attendancePillar: v.set.attendancePillar,
      createdAt: v.row.createdAt.toISOString(),
      createdBy: who(v.row.createdBy),
      updatedAt: v.row.updatedAt.toISOString(),
      updatedBy: who(v.row.updatedBy),
    });
    // the job titles each level's row counts (owner, 22 October 2026: "Yes, add team pillars"): a job title counts for
    // its team (or department), and on up the line while no level below has its own newest pillars; and those of them
    // on old pillars
    const chainOf = departmentChain(departments);
    const newestOwn = new Map<string, FrameworkVersion>();
    for (const v of own) newestOwn.set(v.departmentId!, v);
    const titles = new Map<string, number>();
    const old = new Map<string, number>();
    let companyOld = 0;
    for (const t of jobTitles) {
      const isOld = outdated.has(t.id);
      for (const level of chainOf(t.departmentId)) {
        titles.set(level.id, (titles.get(level.id) ?? 0) + 1);
        if (isOld) old.set(level.id, (old.get(level.id) ?? 0) + 1);
        const newest = newestOwn.get(level.id);
        if (newest && !newest.followsCompany) break;
      }
      if (isOld && !of(t.departmentId).department) companyOld++;
    }
    const current = today.slice(0, 7);
    const titlesOf = new Map(departments.map((d) => [d.id, d.nameEn]));
    const rowOf = (d: DepartmentRef): KpiDepartmentPillarsView => {
      const { applied, next: coming } = ownOn(
        own.filter((v) => v.departmentId === d.id),
        today,
      );
      return {
        department: { id: d.id, nameEn: d.nameEn },
        parent: d.parentId && titlesOf.has(d.parentId) ? { id: d.parentId, nameEn: titlesOf.get(d.parentId)! } : null,
        inForce: applied && !applied.followsCompany ? viewOf(applied) : null,
        next: coming ? viewOf(coming) : null,
        jobTitles: titles.get(d.id) ?? 0,
        oldTemplates: old.get(d.id) ?? 0,
        teams: departments.filter((c) => c.parentId === d.id).map(rowOf),
      };
    };
    return {
      inForce: viewOf(inForce),
      next: next ? viewOf(next) : null,
      departments: departments.filter((d) => !d.parentId || !titlesOf.has(d.parentId)).map(rowOf),
      defaultMonth: kpiFrameworkDefaultMonth(today),
      earliestMonth: current,
      latestMonth: kpiMonthAdd(current, KPI_FRAMEWORK_LIMITS.monthsAhead),
      oldTemplates: companyOld,
      canEdit: user.roles.includes('hr') || user.roles.includes('super_admin'),
      usedKeys: [...new Set(versions.flatMap((v) => v.set.pillars.map((p) => p.key)))],
    };
  }

  /**
   * Saves the next pillars of the company, or of a department or a team (owner's brief, 21 October 2026: "Applies from
   * the next month by default … It can't be set to a month whose scorecards are already open. A draft framework can be
   * edited until it applies"; owner, 22 October 2026: "i need pillars to each department", then "Yes, add team
   * pillars"): changes the next version of its scope, or makes it as the newest. A department's or team's may be its own
   * pillars, or the level above's again from that month (`followsCompany`: a team its department's, a department the
   * company's). Refused (400, each problem) unless its pillars pass the rules and its month's scorecards (and later ones)
   * aren't open; 404 for an unknown department or team; 409 when the next one sent (`nextId`) isn't the next any more.
   * The template versions published that haven't applied yet open from the month their pillars now apply from.
   */
  async save(dto: KpiFrameworkDto, user: SessionUser): Promise<KpiFrameworkView> {
    const today = todayInCairo();
    const following = dto.followsCompany === true;
    let scope: { id: string; nameEn: string; parent: { id: string; nameEn: string } | null } | null = null;
    if (dto.departmentId) {
      const found = await this.prisma.department.findUnique({ where: { id: dto.departmentId }, select: { id: true, nameEn: true, parent: { select: { id: true, nameEn: true } } } });
      if (!found) throw new NotFoundException('Department not found.');
      scope = { id: found.id, nameEn: found.nameEn, parent: found.parent };
    } else if (following) throw new BadRequestException(['Only a department or a team goes back to the pillars above it: choose one.']);
    const set: KpiPillarSet & { pillars: KpiPillar[] } = following
      ? { pillars: [], attendancePillar: '' }
      : kpiPillarSetOf({ pillars: (Array.isArray(dto.pillars) ? dto.pillars : []) as KpiPillarInput[], attendancePillar: dto.attendancePillar ?? '' });
    const problems = [...(following ? [] : kpiPillarSetProblems(set)), ...kpiFrameworkMonthProblems(dto.appliesFrom, today)];
    if (problems.length) throw new BadRequestException(problems);
    const month = toDateOnly(firstDay(dto.appliesFrom));
    const done = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${FRAMEWORK_LOCK}))`;
      const company = await this.versions(tx);
      const versions = scope ? await this.versions(tx, scope.id) : company;
      const { applied, next } = scope
        ? ownOn(versions, today)
        : (({ inForce, next: coming }) => ({ applied: inForce as FrameworkVersion | null, next: coming }))(frameworksOn(versions, today));
      if (dto.nextId !== undefined && (dto.nextId ?? null) !== (next?.id ?? null)) {
        throw new ConflictException(
          next ? 'Someone saved other pillars meanwhile. Reload the page to see them.' : 'The pillars you were changing apply now, so they can’t be changed. Reload the page.',
        );
      }
      // the real ones: a practice scorecard of the month never holds the pillars back (22 October 2026)
      const open = await tx.kpiScorecard.findFirst({ where: { month: { gte: month }, practice: false }, orderBy: { month: 'desc' }, select: { month: true } });
      if (open) throw new BadRequestException([`The scorecards of ${kpiMonthName(monthOfCard(open))} are open already: choose a later month.`]);
      if (!next) {
        if (!scope) {
          if (identical(set, applied!.set)) throw new BadRequestException(['These are the pillars in force: change a pillar, a weight or the Attendance metric’s pillar first.']);
        } else if (!applied || applied.followsCompany) {
          // it takes the level above's: a team its department's (as they stand, newest), a department the company's
          if (scope.parent) {
            if (following) throw new BadRequestException([`${scope.nameEn} takes ${scope.parent.nameEn}’s pillars already.`]);
            const above = (await this.resolver(tx))(scope.parent.id).framework.set;
            if (identical(set, above)) {
              throw new BadRequestException([
                `These are the pillars ${scope.parent.nameEn} gives its teams: change a pillar, a weight or the Attendance metric’s pillar first, or keep ${scope.parent.nameEn}’s.`,
              ]);
            }
          } else {
            if (following) throw new BadRequestException([`${scope.nameEn} takes the company’s pillars already.`]);
            if (identical(set, company.at(-1)!.set)) {
              throw new BadRequestException(['These are the company’s pillars: change a pillar, a weight or the Attendance metric’s pillar first, or keep the company’s.']);
            }
          }
        } else if (!following && identical(set, applied.set)) {
          throw new BadRequestException([`These are the pillars ${scope.nameEn} has in force: change a pillar, a weight or the Attendance metric’s pillar first.`]);
        }
      }
      const data = { appliesFrom: month, pillars: pillarsJsonOf(set), attendancePillar: set.attendancePillar, followsCompany: following, updatedById: user.id };
      let saved: { id: string; version: number };
      if (next) saved = await tx.kpiFramework.update({ where: { id: next.id }, data, select: { id: true, version: true } });
      else {
        saved = await tx.kpiFramework.create({
          data: { ...data, departmentId: scope?.id ?? null, version: (versions.at(-1)?.version ?? 0) + 1, createdById: user.id },
          select: { id: true, version: true },
        });
      }
      // the template versions published that haven't applied yet: those published with these pillars, and for a
      // department or team, its job titles' and those below it (they may be on the pillars above until its own month)
      const moved = await this.reopen(tx, today, saved.id, scope?.id ?? null);
      return { action: next ? ('update' as const) : ('create' as const), ...saved, before: next ?? applied, moved };
    });
    const words = (v: { appliesFrom: string; set: KpiPillarSet; followsCompany: boolean }) =>
      v.followsCompany
        ? { appliesFrom: v.appliesFrom, followsCompany: true }
        : { appliesFrom: v.appliesFrom, pillars: pillarWords(v.set), attendancePillar: kpiPillarOf(v.set, v.set.attendancePillar)?.name ?? v.set.attendancePillar };
    const after = words({ appliesFrom: dto.appliesFrom, set, followsCompany: following });
    // a team's: its name and its department's (22 October 2026)
    const where = !scope ? {} : scope.parent ? { team: scope.nameEn, department: scope.parent.nameEn, departmentId: scope.id } : { department: scope.nameEn, departmentId: scope.id };
    const replaces = !done.before
      ? { followsCompany: true }
      : done.before.followsCompany
        ? { version: done.before.version, followsCompany: true }
        : { version: done.before.version, pillars: pillarWords(done.before.set) };
    await this.audit.record({
      userId: user.id,
      action: done.action,
      entityType: FRAMEWORK_ENTITY,
      entityId: done.id,
      diff:
        done.action === 'create'
          ? { ...where, version: done.version, ...after, opensFrom: kpiFrameworkOpensFrom(dto.appliesFrom), replaces, ...(done.moved && { templatesMoved: done.moved }) }
          : {
              ...where,
              version: done.version,
              ...changes(done.before ? words(done.before) : {}, after),
              ...(done.moved && { templatesMoved: done.moved }),
            },
    });
    return this.view(user);
  }

  /**
   * The template versions published that haven't applied yet (opening after this month's 1st) among those published
   * with `frameworkId`, and with `scopeId` (a department or team), of its job titles and those below it: each opens
   * from the later of the 1st of the month after it was published and its pillars' first opening, its pillars' first
   * month being its framework's, held back by every level below the framework's own that goes back to the one above
   * from a later month (a team back to its department's, a department back to the company's). Says how many moved.
   */
  private async reopen(tx: Prisma.TransactionClient, today: string, frameworkId: string, scopeId: string | null): Promise<number> {
    const opening = toDateOnly(firstDay(today.slice(0, 7)));
    const departments = await tx.department.findMany({ select: { id: true, nameEn: true, parentId: true } });
    const chainOf = departmentChain(departments);
    const tree = scopeId ? departments.filter((d) => chainOf(d.id).some((l) => l.id === scopeId)).map((d) => d.id) : [];
    const upcoming = await tx.kpiTemplate.findMany({
      where: {
        status: 'published',
        opensFrom: { gt: opening },
        OR: [{ frameworkId }, ...(tree.length ? [{ jobTitle: { departmentId: { in: tree } } }] : [])],
      },
      select: { id: true, opensFrom: true, publishedAt: true, framework: { select: { appliesFrom: true, departmentId: true } }, jobTitle: { select: { departmentId: true } } },
    });
    if (!upcoming.length) return 0;
    const own = (await tx.kpiFramework.findMany({ where: { departmentId: { not: null } }, orderBy: { version: 'asc' } })).map(versionOf);
    const newestOwn = new Map<string, FrameworkVersion>();
    for (const v of own) newestOwn.set(v.departmentId!, v);
    let moved = 0;
    for (const t of upcoming) {
      if (!t.framework) continue;
      let first = fromDateOnly(t.framework.appliesFrom).slice(0, 7);
      for (const level of chainOf(t.jobTitle.departmentId)) {
        if (level.id === t.framework.departmentId) break;
        const back = newestOwn.get(level.id);
        if (back?.followsCompany && back.appliesFrom > first) first = back.appliesFrom;
      }
      const opensFrom = kpiTemplateOpensFrom(t.publishedAt ? dayInCairo(t.publishedAt) : today, first);
      if (t.opensFrom && fromDateOnly(t.opensFrom) === opensFrom) continue;
      await tx.kpiTemplate.update({ where: { id: t.id }, data: { opensFrom: toDateOnly(opensFrom) } });
      moved++;
    }
    return moved;
  }
}
