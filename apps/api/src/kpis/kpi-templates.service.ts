import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  KPI_ATTENDANCE_POINTS_DEFAULT,
  KPI_SAMPLE_TEMPLATES,
  kpiEligibleType,
  kpiLibraryDraft,
  kpiLibraryMatchOf,
  kpiLibraryRoles,
  kpiLibraryTitleOf,
  kpiMonthAdd,
  kpiMonthName,
  kpiSample,
  kpiTemplateProblems,
  type KpiDraftAllResult,
  type KpiJobTitleTemplates,
  type KpiLibraryRole,
  type KpiMetric,
  type KpiPublishDraftsResult,
  type KpiSampleView,
  type KpiTemplateContent,
  type KpiTemplateRow,
  type KpiTemplateView,
} from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { actsAs, assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { firstDay } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { metricView } from './kpi-views.js';
import type { KpiDraftDto, KpiPublishDraftsDto, KpiTemplateContentDto } from './kpis.dto.js';

// KPI templates (owner, 21 October 2026: "Templates: HR"; the brief: "HR (and Super Admin) build and edit templates per
// job title, with a draft and published versions. Publishing applies from the next month; a scorecard keeps the version
// it opened with. The history is kept. Managers can view their team's templates. Offer "Start from a sample" … and "Copy
// from another job title". Show the job title's JD next to the builder"). A job title has at most one draft, which HR
// (or a Super Admin) starts blank, from a copy of its newest published version, from one of the three samples, or from
// another job title's version, edits (its content checked with packages/shared kpiTemplateProblems) and publishes: the
// published version is never changed, and is used by the scorecards opened from the 1st of the next month (opens_from),
// the version in force being the newest published whose opens_from has come. HR, the CEO and Admin read every job
// title's templates; a manager (or lead) of someone under a job title, and the people under it, its published versions.
// Only a Super Admin deletes a draft. Every change is in the audit log.
// The KPI role library (owner, 21 October 2026: "can you add templetes for all departments and job roles"; packages/shared
// kpi-library.ts): a draft may start from one of its roles, and "Draft templates for every job title" makes a draft for
// each job title with no draft and no published version yet, from the role its title (else its department) matches,
// its metrics linked to the job title's JD duty rows; it never changes or publishes anything. "Publish selected
// drafts" publishes the drafts chosen that pass the rules, and says what stops the others.

export const TEMPLATE_ENTITY = 'kpi_template';

const TEMPLATE_INCLUDE = {
  metrics: { orderBy: { position: 'asc' } },
  publishedBy: { select: { id: true, email: true } },
  _count: { select: { scorecards: true } },
} as const satisfies Prisma.KpiTemplateInclude;

type TemplateRow = Prisma.KpiTemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>;

const DEPARTMENT = { select: { id: true, nameEn: true, parent: { select: { nameEn: true } } } } as const;

/** "Web Development", or a team as "Web Development › Frontend" (as a payroll line names it). */
const departmentName = (d: { nameEn: string; parent: { nameEn: string } | null }) => (d.parent ? `${d.parent.nameEn} › ${d.nameEn}` : d.nameEn);

/** Two drafts of a job title made at once: the second's version is taken (kpi_templates' job title and version are unique). */
const versionTaken = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** Builds templates: HR and a Super Admin. */
export const buildsTemplates = (user: SessionUser) => user.roles.includes('hr') || user.roles.includes('super_admin');

/** Reads every job title's templates: HR, the CEO and Admin (a Super Admin counts as one). */
const readsTemplates = (user: SessionUser) => actsAs(user.roles, ['hr', 'ceo', 'admin']);

/** The month whose 1st the scorecards opened now opened on: this month in Cairo, YYYY-MM. */
const openingNow = () => todayInCairo().slice(0, 7);

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const textOrNull = (v: unknown): string | null => {
  const t = text(v);
  return t ? t : null;
};
const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A draft's content as sent, tidied (texts trimmed, empty ones null), for the shared rules to check. */
export function contentOf(dto: Pick<KpiTemplateContentDto, 'attendancePoints' | 'metrics'>): KpiTemplateContent {
  return {
    attendancePoints: dto.attendancePoints as number,
    metrics: dto.metrics.map((raw) => {
      const m = asObject(raw);
      return {
        pillar: m.pillar as KpiMetric['pillar'],
        name: text(m.name),
        definition: textOrNull(m.definition),
        howMeasured: textOrNull(m.howMeasured),
        jdDuty: textOrNull(m.jdDuty),
        targetPoints: m.targetPoints as number,
        criteria: Array.isArray(m.criteria) ? m.criteria.map((c) => ({ label: text(asObject(c).label), points: asObject(c).points as number })) : [],
      };
    }),
  };
}

/** A template's metrics as rows to save. */
const metricRows = (metrics: readonly KpiMetric[]) =>
  metrics.map((m, i) => ({
    position: i + 1,
    pillar: m.pillar,
    name: m.name,
    definition: m.definition,
    howMeasured: m.howMeasured,
    jdDuty: m.jdDuty,
    targetPoints: m.targetPoints,
    criteria: m.criteria.map((c) => ({ label: c.label, points: c.points })) as Prisma.InputJsonValue,
  }));

@Injectable()
export class KpiTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
  ) {}

  /** Every job title, by department then title, with its version in force, the next one, its draft and its people. */
  async list(): Promise<KpiTemplateRow[]> {
    const opening = toDateOnly(firstDay(openingNow()));
    const [titles, templates, people] = await Promise.all([
      this.prisma.jobTitle.findMany({ orderBy: [{ department: { nameEn: 'asc' } }, { titleEn: 'asc' }], select: { id: true, titleEn: true, department: DEPARTMENT } }),
      this.prisma.kpiTemplate.findMany({
        orderBy: { version: 'desc' },
        select: { id: true, jobTitleId: true, version: true, status: true, opensFrom: true, updatedAt: true, _count: { select: { metrics: true } } },
      }),
      this.prisma.employment.findMany({ where: { endDate: null, jobTitleId: { not: null } }, select: { jobTitleId: true, employmentType: true } }),
    ]);
    const count = new Map<string, number>();
    for (const p of people) if (kpiEligibleType(p.employmentType)) count.set(p.jobTitleId!, (count.get(p.jobTitleId!) ?? 0) + 1);
    return titles.map((t) => {
      const own = templates.filter((x) => x.jobTitleId === t.id);
      const published = own.filter((x) => x.status === 'published' && x.opensFrom);
      const inForce = published.find((x) => x.opensFrom! <= opening) ?? null;
      const upcoming = published.find((x) => x.opensFrom! > opening) ?? null;
      const draft = own.find((x) => x.status === 'draft') ?? null;
      return {
        jobTitle: { id: t.id, titleEn: t.titleEn, department: { id: t.department.id, nameEn: t.department.nameEn, parentName: t.department.parent?.nameEn ?? null } },
        inForce: inForce && { id: inForce.id, version: inForce.version, metrics: inForce._count.metrics, opensFrom: fromDateOnly(inForce.opensFrom!) },
        upcoming: upcoming && { id: upcoming.id, version: upcoming.version, opensFrom: fromDateOnly(upcoming.opensFrom!) },
        draft: draft && { id: draft.id, version: draft.version, updatedAt: draft.updatedAt.toISOString() },
        versions: published.length,
        people: count.get(t.id) ?? 0,
      };
    });
  }

  /** The three samples to start a draft from. */
  samples(): readonly KpiSampleView[] {
    return KPI_SAMPLE_TEMPLATES;
  }

  /** The role library's templates to start a draft from: key, name and kind, for the picker. */
  library(): KpiLibraryRole[] {
    return kpiLibraryRoles();
  }

  /** A job title's page: its JD, its draft and its published versions, as the caller may see them. */
  async jobTitlePage(jobTitleId: string, user: SessionUser): Promise<KpiJobTitleTemplates> {
    const access = await this.access(jobTitleId, user);
    const job = await this.prisma.jobTitle.findUnique({
      where: { id: jobTitleId },
      select: { id: true, titleEn: true, titleAr: true, jdPurpose: true, jdDuties: true, jdRequirements: true, department: DEPARTMENT, duties: { orderBy: { position: 'asc' }, select: { duty: true } } },
    });
    if (!job) throw new NotFoundException('Job title not found.');
    const rows = await this.prisma.kpiTemplate.findMany({ where: { jobTitleId, ...(access === 'published' && { status: 'published' }) }, orderBy: { version: 'desc' }, include: TEMPLATE_INCLUDE });
    const views = await this.views(rows);
    return {
      jobTitle: {
        id: job.id,
        titleEn: job.titleEn,
        titleAr: job.titleAr,
        department: { id: job.department.id, nameEn: job.department.nameEn, parentName: job.department.parent?.nameEn ?? null },
        jdPurpose: job.jdPurpose,
        jdDuties: job.jdDuties,
        jdRequirements: job.jdRequirements,
        duties: job.duties.map((d) => d.duty),
      },
      draft: views.find((v) => v.status === 'draft') ?? null,
      versions: views.filter((v) => v.status === 'published'),
      canEdit: buildsTemplates(user),
    };
  }

  /** One version, as its job title's page shows it. */
  async one(id: string, user: SessionUser): Promise<KpiTemplateView> {
    const row = await this.prisma.kpiTemplate.findUnique({ where: { id }, include: TEMPLATE_INCLUDE });
    if (!row) throw new NotFoundException('KPI template not found.');
    const access = await this.access(row.jobTitleId, user, 'KPI template not found.');
    if (access === 'published' && row.status !== 'published') throw new NotFoundException('KPI template not found.');
    return (await this.views([row]))[0];
  }

  /**
   * A new draft for the job title (one at most): blank, a copy of its newest published version, a sample, another
   * version, or a role of the library (its metrics linked to the job title's JD duty rows, and the leadership metric
   * for a title that leads people).
   */
  async createDraft(jobTitleId: string, dto: KpiDraftDto, user: SessionUser): Promise<KpiTemplateView> {
    const job = await this.prisma.jobTitle.findUnique({
      where: { id: jobTitleId },
      select: { id: true, titleEn: true, titleAr: true, duties: { orderBy: { position: 'asc' }, select: { duty: true } } },
    });
    if (!job) throw new NotFoundException('Job title not found.');
    if (await this.prisma.kpiTemplate.count({ where: { jobTitleId, status: 'draft' } })) {
      throw new ConflictException(`${job.titleEn} has a draft already: change it, or publish it first.`);
    }
    let content: KpiTemplateContent = { attendancePoints: KPI_ATTENDANCE_POINTS_DEFAULT, metrics: [] };
    let source: Record<string, unknown> = { from: dto.from };
    if (dto.from === 'published') {
      const latest = await this.prisma.kpiTemplate.findFirst({ where: { jobTitleId, status: 'published' }, orderBy: { version: 'desc' }, include: { metrics: { orderBy: { position: 'asc' } } } });
      if (!latest) throw new BadRequestException([`${job.titleEn} has no published version to copy yet. Start blank or from a sample.`]);
      content = { attendancePoints: latest.attendancePoints, metrics: latest.metrics.map(metricView).map(withoutId) };
      source = { ...source, version: latest.version };
    } else if (dto.from === 'sample') {
      const sample = kpiSample(dto.sampleCode ?? '');
      if (!sample) throw new BadRequestException(['Choose one of the samples.']);
      content = { attendancePoints: sample.attendancePoints, metrics: sample.metrics.map((m) => ({ ...m, criteria: m.criteria.map((c) => ({ ...c })) })) };
      source = { ...source, sample: sample.code };
    } else if (dto.from === 'template') {
      const other = await this.prisma.kpiTemplate.findUnique({ where: { id: dto.templateId! }, include: { metrics: { orderBy: { position: 'asc' } }, jobTitle: { select: { titleEn: true } } } });
      if (!other) throw new BadRequestException(['Choose a job title’s template to copy.']);
      content = { attendancePoints: other.attendancePoints, metrics: other.metrics.map(metricView).map(withoutId) };
      source = { ...source, templateId: other.id, jobTitle: other.jobTitle.titleEn, version: other.version };
    } else if (dto.from === 'library') {
      const drafted = kpiLibraryDraft(dto.libraryKey ?? '', { title: kpiLibraryTitleOf(job), duties: job.duties.map((d) => d.duty) });
      if (!drafted) throw new BadRequestException(['Choose a role from the library.']);
      content = drafted.content;
      source = { ...source, libraryKey: drafted.template.key, library: drafted.template.name, leadership: drafted.leadership !== null };
    }
    let made: { id: string };
    try {
      made = await this.makeDraft(job, content, source, user);
    } catch (err) {
      if (versionTaken(err)) throw new ConflictException(`${job.titleEn} has a draft already: change it, or publish it first.`);
      throw err;
    }
    return this.one(made.id, user);
  }

  /**
   * "Draft templates for every job title" (owner, 21 October 2026: "can you add templetes for all departments and job
   * roles"): a draft for each job title with no draft and no published version, from the library role it matches (its
   * title, then its department, then the universal template), its metrics linked to its JD duty rows. Never changes or
   * publishes a template. One audit entry for the run, and one for each draft, as for any draft.
   */
  async draftAll(user: SessionUser): Promise<KpiDraftAllResult> {
    const [titles, templates] = await Promise.all([
      this.prisma.jobTitle.findMany({
        orderBy: [{ department: { nameEn: 'asc' } }, { titleEn: 'asc' }],
        select: { id: true, titleEn: true, titleAr: true, department: DEPARTMENT, duties: { orderBy: { position: 'asc' }, select: { duty: true } } },
      }),
      this.prisma.kpiTemplate.findMany({ select: { jobTitleId: true, status: true } }),
    ]);
    const result: KpiDraftAllResult = { made: [], skipped: [] };
    for (const t of titles) {
      const department = departmentName(t.department);
      const own = templates.filter((x) => x.jobTitleId === t.id);
      const skip = (why: string) => result.skipped.push({ jobTitleId: t.id, title: t.titleEn, department, why });
      if (own.some((x) => x.status === 'draft')) {
        skip('It has a draft already.');
        continue;
      }
      if (own.length) {
        skip('It has a published version: start its next draft from that, on its page.');
        continue;
      }
      const match = kpiLibraryMatchOf({ titleEn: t.titleEn, titleAr: t.titleAr, department: { nameEn: t.department.nameEn, parentName: t.department.parent?.nameEn ?? null } });
      const drafted = kpiLibraryDraft(match.key, { title: kpiLibraryTitleOf(t), duties: t.duties.map((d) => d.duty) })!;
      const source = { from: 'library', libraryKey: match.key, library: match.name, reason: match.reason, leadership: drafted.leadership !== null, draftAll: true };
      let made: { id: string };
      try {
        made = await this.makeDraft(t, drafted.content, source, user);
      } catch (err) {
        if (!versionTaken(err)) throw err;
        skip('A draft was started for it meanwhile.');
        continue;
      }
      result.made.push({
        jobTitleId: t.id,
        templateId: made.id,
        title: t.titleEn,
        department,
        libraryKey: match.key,
        libraryName: match.name,
        leadership: drafted.leadership !== null,
        reason: match.reason,
      });
    }
    await this.audit.record({
      userId: user.id,
      action: 'draft_all',
      entityType: TEMPLATE_ENTITY,
      diff: {
        made: result.made.length,
        skipped: result.skipped.length,
        drafts: result.made.map((m) => ({ templateId: m.templateId, jobTitle: m.title, libraryKey: m.libraryKey })),
      },
    });
    return result;
  }

  /** A draft's content replaced (its metrics in the order sent); 400 with every problem; 409 for a published version. */
  async update(id: string, dto: KpiTemplateContentDto, user: SessionUser): Promise<KpiTemplateView> {
    const before = await this.draft(id, 'changed');
    const content = contentOf(dto);
    const problems = kpiTemplateProblems(content);
    if (problems.length) throw new BadRequestException(problems);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.kpiTemplate.updateMany({ where: { id, status: 'draft' }, data: { attendancePoints: content.attendancePoints, updatedAt: new Date() } });
      if (!count) throw new ConflictException('This draft was published or discarded meanwhile. Reload the page.');
      await tx.kpiMetric.deleteMany({ where: { templateId: id } });
      await tx.kpiMetric.createMany({ data: metricRows(content.metrics).map((m) => ({ ...m, templateId: id })) });
    });
    const names = (ms: readonly { name: string }[]) => ms.map((m) => m.name);
    await this.audit.record({
      userId: user.id,
      action: 'update',
      entityType: TEMPLATE_ENTITY,
      entityId: id,
      diff: {
        jobTitleId: before.jobTitleId,
        version: before.version,
        ...changes({ attendancePoints: before.attendancePoints, metrics: names(before.metrics) }, { attendancePoints: content.attendancePoints, metrics: names(content.metrics) }),
      },
    });
    return this.one(id, user);
  }

  /** Publishes a draft: used by the scorecards opened from the 1st of next month on; 400 with what stops it. */
  async publish(id: string, user: SessionUser): Promise<KpiTemplateView> {
    const before = await this.draft(id, 'published');
    const problems = publishingProblems(before);
    if (problems.length) throw new BadRequestException(problems);
    await this.markPublished(before, user);
    return this.one(id, user);
  }

  /**
   * "Publish selected drafts": each draft sent that passes the rules is published (as Publish does, each audited), and
   * applies from the scorecards opened on the 1st of next month; the others are left as they are, each with what stops
   * it (not found, published already, the rules' problems). One audit entry for the run too.
   */
  async publishDrafts(dto: KpiPublishDraftsDto, user: SessionUser): Promise<KpiPublishDraftsResult> {
    const ids = [...new Set(dto.templateIds)];
    const rows = await this.prisma.kpiTemplate.findMany({ where: { id: { in: ids } }, include: { metrics: { orderBy: { position: 'asc' } }, jobTitle: { select: { titleEn: true } } } });
    const result: KpiPublishDraftsResult = { published: [], problems: [] };
    for (const id of ids) {
      const row = rows.find((r) => r.id === id);
      const refuse = (problems: string[]) =>
        result.problems.push({ templateId: id, jobTitleId: row?.jobTitleId ?? null, title: row?.jobTitle.titleEn ?? null, version: row?.version ?? null, problems });
      if (!row) {
        refuse(['This KPI template could not be found.']);
        continue;
      }
      if (row.status !== 'draft') {
        refuse([`Version ${row.version} is published already.`]);
        continue;
      }
      const problems = publishingProblems(row);
      if (problems.length) {
        refuse(problems);
        continue;
      }
      try {
        const opensFrom = await this.markPublished(row, user);
        result.published.push({ templateId: id, jobTitleId: row.jobTitleId, title: row.jobTitle.titleEn, version: row.version, opensFrom });
      } catch (err) {
        if (!(err instanceof ConflictException)) throw err;
        refuse([err.message]);
      }
    }
    await this.audit.record({
      userId: user.id,
      action: 'publish_drafts',
      entityType: TEMPLATE_ENTITY,
      diff: { published: result.published.map((p) => ({ templateId: p.templateId, jobTitle: p.title, version: p.version })), refused: result.problems.length, opensFrom: result.published[0]?.opensFrom },
    });
    return result;
  }

  /** Discards a draft (a Super Admin only, as every deletion: owner's decision, 15 October 2026). */
  async remove(id: string, user: SessionUser): Promise<void> {
    assertDeletes(user);
    const before = await this.draft(id, 'deleted');
    const { count } = await this.prisma.kpiTemplate.deleteMany({ where: { id, status: 'draft' } });
    if (!count) throw new ConflictException('This draft was published meanwhile. Reload the page.');
    await this.audit.record({ userId: user.id, action: 'delete', entityType: TEMPLATE_ENTITY, entityId: id, diff: { jobTitleId: before.jobTitleId, version: before.version, status: 'draft', metrics: before.metrics.length } });
  }

  // ---------- helpers ----------

  /** Saves a new draft of the job title, as its next version, and audits it with where it came from. */
  private async makeDraft(job: { id: string; titleEn: string }, content: KpiTemplateContent, source: Record<string, unknown>, user: SessionUser): Promise<{ id: string; version: number }> {
    const top = await this.prisma.kpiTemplate.aggregate({ where: { jobTitleId: job.id }, _max: { version: true } });
    const version = (top._max.version ?? 0) + 1;
    const made = await this.prisma.kpiTemplate.create({
      data: { jobTitleId: job.id, version, status: 'draft', attendancePoints: content.attendancePoints, createdById: user.id, metrics: { create: metricRows(content.metrics) } },
      select: { id: true },
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: TEMPLATE_ENTITY,
      entityId: made.id,
      diff: { jobTitleId: job.id, jobTitle: job.titleEn, version, status: 'draft', ...source, attendancePoints: content.attendancePoints, metrics: content.metrics.length },
    });
    return { id: made.id, version };
  }

  /**
   * Marks a draft published, from the 1st of next month (the brief: "Publishing applies from the next month"), and
   * audits it; 409 when it was published or discarded meanwhile. The draft's opens-from day, YYYY-MM-DD.
   */
  private async markPublished(before: { id: string; jobTitleId: string; version: number; metrics: readonly unknown[] }, user: SessionUser): Promise<string> {
    // published this month: the scorecards opened from the 1st of next month use it
    const opensFrom = firstDay(kpiMonthAdd(openingNow(), 1));
    const { count } = await this.prisma.kpiTemplate.updateMany({
      where: { id: before.id, status: 'draft' },
      data: { status: 'published', opensFrom: toDateOnly(opensFrom), publishedAt: new Date(), publishedById: user.id },
    });
    if (!count) throw new ConflictException('This draft was published or discarded meanwhile. Reload the page.');
    await this.audit.record({
      userId: user.id,
      action: 'publish',
      entityType: TEMPLATE_ENTITY,
      entityId: before.id,
      diff: { jobTitleId: before.jobTitleId, version: before.version, status: { from: 'draft', to: 'published' }, opensFrom, firstMonth: kpiMonthName(kpiMonthAdd(opensFrom, -1)), metrics: before.metrics.length },
    });
    return opensFrom;
  }

  /** A draft, or 409 for a published version (never changed), 404 for none. */
  private async draft(id: string, doing: string) {
    const row = await this.prisma.kpiTemplate.findUnique({ where: { id }, include: { metrics: { orderBy: { position: 'asc' } } } });
    if (!row) throw new NotFoundException('KPI template not found.');
    if (row.status !== 'draft') throw new ConflictException(`Version ${row.version} is published, so it can't be ${doing}: start a draft from it instead.`);
    return row;
  }

  /**
   * What of a job title's templates the caller reads: every version for HR, the CEO and Admin; the published ones for a
   * manager or lead of someone under it, or someone under it (owner's brief, 21 October 2026: "Managers can view their
   * team's templates"); else 404.
   */
  private async access(jobTitleId: string, user: SessionUser, message = 'Job title not found.'): Promise<'all' | 'published'> {
    if (readsTemplates(user)) return 'all';
    const me = await this.confidential.selfId(user);
    if (me) {
      const theirs = await this.prisma.employment.count({
        where: {
          jobTitleId,
          endDate: null,
          OR: [{ employeeId: me }, { managerId: me }, { department: { headId: me } }, { department: { parent: { headId: me } } }],
        },
      });
      if (theirs || (await this.prisma.kpiScorecard.count({ where: { managerId: me, template: { jobTitleId } } }))) return 'published';
    }
    throw new NotFoundException(message);
  }

  /** The versions as their page shows them, the one in force now marked. */
  private async views(rows: readonly TemplateRow[]): Promise<KpiTemplateView[]> {
    if (!rows.length) return [];
    const opening = toDateOnly(firstDay(openingNow()));
    const inForce = new Map<string, string>();
    const forced = await this.prisma.kpiTemplate.findMany({
      where: { jobTitleId: { in: [...new Set(rows.map((r) => r.jobTitleId))] }, status: 'published', opensFrom: { lte: opening } },
      orderBy: { version: 'desc' },
      select: { id: true, jobTitleId: true },
    });
    for (const f of forced) if (!inForce.has(f.jobTitleId)) inForce.set(f.jobTitleId, f.id);
    const names = await userNames(this.prisma, rows.map((r) => r.publishedBy));
    return rows.map((r) => {
      const metrics = r.metrics.map(metricView);
      const opensFrom = r.opensFrom ? fromDateOnly(r.opensFrom) : null;
      return {
        id: r.id,
        jobTitleId: r.jobTitleId,
        version: r.version,
        status: r.status as 'draft' | 'published',
        attendancePoints: r.attendancePoints,
        metrics,
        opensFrom,
        firstMonth: opensFrom ? kpiMonthAdd(opensFrom, -1) : null,
        inForce: inForce.get(r.jobTitleId) === r.id,
        publishedAt: r.publishedAt?.toISOString() ?? null,
        publishedBy: r.publishedBy ? { email: r.publishedBy.email, name: names.get(r.publishedBy.id)?.name ?? null } : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        scorecards: r._count.scorecards,
        problems: r.status === 'draft' ? kpiTemplateProblems({ attendancePoints: r.attendancePoints, metrics }, { publishing: true }) : [],
      };
    });
  }
}

/** What stops a draft (with its metrics) being published: the shared rules with `publishing`. */
function publishingProblems(row: { attendancePoints: number; metrics: Parameters<typeof metricView>[0][] }): string[] {
  return kpiTemplateProblems({ attendancePoints: row.attendancePoints, metrics: row.metrics.map(metricView) }, { publishing: true });
}

/** A metric copied into a new draft: without the id of the one it was copied from. */
function withoutId(m: KpiMetric): KpiMetric {
  const { id: _id, ...rest } = m;
  return { ...rest, criteria: rest.criteria.map((c) => ({ ...c })) };
}
