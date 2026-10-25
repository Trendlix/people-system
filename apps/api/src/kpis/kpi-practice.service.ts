import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  kpiAttendanceAchieved,
  kpiEligibleType,
  kpiMonthName,
  kpiPracticeMonthProblem,
  kpiPracticeMonths,
  kpiScorerOf,
  startsKpiPractice,
  type KpiPracticeChoice,
  type KpiPracticeChoices,
  type KpiPracticeDeleted,
  type KpiPracticeRow,
  type KpiScorecardView,
  type KpiScorer,
  type KpiStatus,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { Prisma } from '../generated/prisma/client.js';
import { approverFor } from '../organisation/departments/leads.js';
import { placeName, userNames } from '../payroll/adjustments/people.js';
import { firstDay, lastDay } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { KpiOpeningService } from './kpi-opening.service.js';
import { KpiScorecardsService } from './kpi-scorecards.service.js';
import { monthOfCard, SCORECARD_ENTITY } from './kpi-views.js';
import type { KpiPracticeStartDto } from './kpis.dto.js';

// Practice KPI scorecards (owner, 22 October 2026: "i want to test the KPI's .. and it is locked to dates, HR and
// Admin.. how?", choosing "Practice scorecards": "I or HR start a practice scorecard for any employee and month, from a
// draft or published template"; "It's marked Practice everywhere, notifies nobody, never reaches payroll, reports or
// exports, and deletes in one click"; packages/shared kpi-practice.ts). HR and a Super Admin start one for anyone they
// may see (HR never a C-level person), any month from the person's join date to this one, on their job title's newest
// version or the one picked (a draft, to try it); it opens as the month's real one would (kpi-opening.service.ts): its
// scorer as kpiScorerOf has it, the Attendance metric from the month's attendance (this month's so far), a row a metric,
// the step "Opened". Several a person and month may be. Their steps are kpi-scorecards.service.ts's (standing in, or as
// the person while a Super Admin views as them). A draft's are started again when it is saved changed and deleted with
// it when it is discarded (kpi-templates.service.ts, through restartOnDraft and removeOnDraft here). Only a Super Admin
// deletes them, one or all (only their own, if they say), never a real scorecard. Each start, reset and delete is in the
// audit log, marked practice.

const PRACTICE_NOT_FOUND = 'Practice scorecard not found.';
const EMPLOYEE_NOT_FOUND = 'Employee not found.';

type Tx = Prisma.TransactionClient;

const DEPARTMENT = { select: { nameEn: true, parent: { select: { nameEn: true } } } } as const;

/** What a practice scorecard is listed and audited with. */
const ROW = {
  id: true,
  month: true,
  status: true,
  scorer: true,
  employeeId: true,
  practiceAt: true,
  practiceBy: { select: { id: true, email: true } },
  employee: { select: { id: true, employeeCode: true, fullNameEn: true } },
  department: DEPARTMENT,
  template: { select: { id: true, version: true, status: true, jobTitle: { select: { titleEn: true } } } },
} as const satisfies Prisma.KpiScorecardSelect;

type Row = Prisma.KpiScorecardGetPayload<{ select: typeof ROW }>;

/** A practice scorecard as the audit log has it. */
const auditOf = (r: Pick<Row, 'month' | 'status' | 'employee' | 'template'>) => ({
  practice: true,
  month: monthOfCard(r),
  employeeCode: r.employee.employeeCode,
  templateId: r.template.id,
  version: r.template.version,
  draft: r.template.status === 'draft',
  status: r.status,
});

/** A practice scorecard started again (its draft saved changed): what it was, for the audit log. */
export interface RestartedCard {
  id: string;
  month: Date;
  status: string;
  employee: { employeeCode: string };
}

@Injectable()
export class KpiPracticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly opening: KpiOpeningService,
    private readonly scorecards: KpiScorecardsService,
  ) {}

  // ---------- reading ----------

  /** The practice scorecards, newest started first: HR and a Super Admin (HR not a C-level person's). */
  async list(user: SessionUser): Promise<KpiPracticeRow[]> {
    this.assertStarts(user);
    const caller = await this.scorecards.caller(user);
    const hidden = [...caller.confidential.hidden];
    const rows = await this.prisma.kpiScorecard.findMany({
      where: { practice: true, ...(hidden.length && { employeeId: { notIn: hidden } }) },
      orderBy: [{ practiceAt: 'desc' }, { id: 'asc' }],
      select: ROW,
    });
    const names = await userNames(this.prisma, rows.map((r) => r.practiceBy));
    return rows.map((r) => ({
      id: r.id,
      month: monthOfCard(r),
      employee: r.employee,
      jobTitle: r.template.jobTitle.titleEn,
      department: placeName(r.department),
      template: { id: r.template.id, version: r.template.version, draft: r.template.status === 'draft' },
      status: r.status as KpiStatus,
      scorer: r.scorer as KpiScorer,
      startedBy: r.practiceBy ? { email: r.practiceBy.email, name: names.get(r.practiceBy.id)?.name ?? null } : null,
      startedAt: (r.practiceAt ?? new Date(0)).toISOString(),
      mine: r.practiceBy?.id === user.id,
      confidential: caller.confidential.all.has(r.employeeId),
    }));
  }

  /**
   * Whom a practice scorecard may be started for: everyone employed now whom the caller may see (HR not a C-level
   * person), who gets a scorecard (not a freelancer or an unpaid intern) and whose job title has a template version
   * (a draft or a published one), with the months from their join date to this one and the versions, newest first.
   */
  async choices(user: SessionUser): Promise<KpiPracticeChoices> {
    this.assertStarts(user);
    const caller = await this.scorecards.caller(user);
    const hidden = [...caller.confidential.hidden];
    const today = todayInCairo();
    const month = today.slice(0, 7);
    const employments = await this.prisma.employment.findMany({
      where: {
        OR: [{ endDate: null }, { endDate: { gte: toDateOnly(today) } }],
        jobTitleId: { not: null },
        // not freelancers or unpaid interns (packages/shared kpiEligibleType)
        employmentType: { notIn: ['freelance', 'intern'] },
        ...(hidden.length && { employeeId: { notIn: hidden } }),
      },
      orderBy: { joinDate: 'desc' },
      select: {
        employeeId: true,
        joinDate: true,
        jobTitle: { select: { id: true, titleEn: true } },
        department: DEPARTMENT,
        employee: { select: { id: true, employeeCode: true, fullNameEn: true } },
      },
    });
    const latest = new Map<string, (typeof employments)[number]>();
    for (const e of employments) if (!latest.has(e.employeeId)) latest.set(e.employeeId, e);
    const titles = [...new Set([...latest.values()].map((e) => e.jobTitle!.id))];
    const templates = titles.length
      ? await this.prisma.kpiTemplate.findMany({
          where: { jobTitleId: { in: titles } },
          orderBy: { version: 'desc' },
          select: { id: true, jobTitleId: true, version: true, status: true, opensFrom: true, _count: { select: { metrics: true } } },
        })
      : [];
    const opening = toDateOnly(firstDay(month));
    const people: KpiPracticeChoice[] = [];
    for (const e of latest.values()) {
      const own = templates.filter((t) => t.jobTitleId === e.jobTitle!.id);
      const months = kpiPracticeMonths(fromDateOnly(e.joinDate), today);
      if (!own.length || !months.length) continue;
      const inForce = own.find((t) => t.status === 'published' && t.opensFrom && t.opensFrom <= opening)?.id ?? null;
      people.push({
        employee: e.employee,
        jobTitle: { id: e.jobTitle!.id, titleEn: e.jobTitle!.titleEn },
        department: placeName(e.department),
        joinDate: fromDateOnly(e.joinDate),
        months,
        templates: own.map((t) => ({ id: t.id, version: t.version, draft: t.status === 'draft', inForce: t.id === inForce, metrics: t._count.metrics })),
        confidential: caller.confidential.all.has(e.employeeId),
      });
    }
    people.sort((a, b) => a.employee.fullNameEn.localeCompare(b.employee.fullNameEn));
    return { month, people };
  }

  // ---------- starting one ----------

  /**
   * A practice scorecard for the person and month (this one unless sent), on the version sent or their job title's
   * newest (a draft is the newest), opened as the month's real one would be; audited. 404 for someone the caller may not
   * see, 400 with what is wrong (the month, no job title or template, not scored).
   */
  async start(dto: KpiPracticeStartDto, user: SessionUser): Promise<KpiScorecardView> {
    this.assertStarts(user);
    const caller = await this.scorecards.caller(user);
    const today = todayInCairo();
    const month = dto.month ?? today.slice(0, 7);
    const person = await this.prisma.employee.findUnique({ where: { id: dto.employeeId }, select: { id: true, employeeCode: true, fullNameEn: true } });
    // a C-level person is hidden from HR (owner, 19 October 2026): as if there were none
    if (!person || caller.confidential.hidden.has(person.id)) throw new NotFoundException(EMPLOYEE_NOT_FOUND);
    const name = person.fullNameEn;
    const employments = await this.prisma.employment.findMany({
      where: { employeeId: person.id },
      orderBy: { joinDate: 'desc' },
      select: { id: true, joinDate: true, endDate: true, managerId: true, departmentId: true, jobTitleId: true, employmentType: true, jobTitle: { select: { titleEn: true } } },
    });
    if (!employments.length) throw new BadRequestException([`${name} has no employment yet: hire them first.`]);
    const problem = kpiPracticeMonthProblem(month, fromDateOnly(employments.at(-1)!.joinDate), today, name);
    if (problem) throw new BadRequestException([problem]);
    // the employment of the month (the latest, a person rehired), as the real opening reads it
    const from = firstDay(month);
    const to = lastDay(month);
    const e = employments.find((x) => fromDateOnly(x.joinDate) <= to && (!x.endDate || fromDateOnly(x.endDate) >= from));
    const monthName = kpiMonthName(month);
    if (!e) throw new BadRequestException([`${name} wasn't employed in ${monthName}: choose another month.`]);
    if (!kpiEligibleType(e.employmentType)) throw new BadRequestException([`${name} is a freelancer or an unpaid intern in ${monthName}, who get no KPI scorecard.`]);
    if (!e.jobTitleId || !e.jobTitle) throw new BadRequestException([`${name} has no job title in ${monthName}: give them one first.`]);

    const include = { metrics: { orderBy: { position: 'asc' }, select: { id: true } } } as const;
    const template = dto.templateId
      ? await this.prisma.kpiTemplate.findUnique({ where: { id: dto.templateId }, include })
      : await this.prisma.kpiTemplate.findFirst({ where: { jobTitleId: e.jobTitleId }, orderBy: { version: 'desc' }, include });
    if (dto.templateId && (!template || template.jobTitleId !== e.jobTitleId)) throw new BadRequestException([`Choose a version of ${e.jobTitle.titleEn}’s KPI template.`]);
    if (!template) throw new BadRequestException([`${e.jobTitle.titleEn} has no KPI template yet: start a draft on its KPI template page first.`]);

    // its scorer, as the month's real one would have (kpi-opening.service.ts)
    const isConfidential = caller.confidential.all.has(person.id);
    const approver = isConfidential ? null : await approverFor(this.prisma, { employeeId: person.id, managerId: e.managerId, departmentId: e.departmentId });
    const isCeo = (await this.prisma.user.count({ where: { isActive: true, employeeId: person.id, roles: { some: { role: { key: 'ceo' } } } } })) > 0;
    const scorer = kpiScorerOf({ confidential: isConfidential, isCeo, approverId: approver?.employeeId ?? null });
    // the month's attendance as payroll has it now: this month's so far
    const attendance = await this.opening.attendanceOf(month, person.id, template.attendancePoints);
    const draft = template.status === 'draft';
    const made = await this.prisma.kpiScorecard.create({
      data: {
        employeeId: person.id,
        employmentId: e.id,
        month: toDateOnly(from),
        templateId: template.id,
        departmentId: e.departmentId,
        status: 'self_rating',
        scorer,
        managerId: scorer === 'manager' ? approver!.employeeId : null,
        approverRole: scorer === 'manager' ? approver!.role : null,
        ...attendance,
        practice: true,
        practiceById: user.id,
        practiceAt: new Date(),
        scores: { create: template.metrics.map((m) => ({ metricId: m.id })) },
        steps: { create: { kind: 'opened', actorId: user.id, comment: `Practice, on ${draft ? `the draft of version ${template.version}` : `version ${template.version}`}` } },
      },
      select: { id: true },
    });
    await this.audit.record({
      userId: user.id,
      action: 'practice_start',
      entityType: SCORECARD_ENTITY,
      entityId: made.id,
      diff: { practice: true, month, employeeCode: person.employeeCode, templateId: template.id, version: template.version, draft, scorer, status: 'self_rating' },
    });
    return this.scorecards.one(made.id, user);
  }

  // ---------- deleting ----------

  /** Deletes a practice scorecard (a Super Admin only); a real one never (409). */
  async remove(id: string, user: SessionUser): Promise<void> {
    assertDeletes(user);
    const row = await this.prisma.kpiScorecard.findUnique({ where: { id }, select: { ...ROW, practice: true } });
    if (!row) throw new NotFoundException(PRACTICE_NOT_FOUND);
    if (!row.practice) throw new ConflictException('This is a real KPI scorecard: only a practice one can be deleted.');
    const { count } = await this.prisma.kpiScorecard.deleteMany({ where: { id, practice: true } });
    if (count) await this.audit.record({ userId: user.id, action: 'delete', entityType: SCORECARD_ENTITY, entityId: id, diff: auditOf(row) });
  }

  /** "Delete all practice scorecards" (a Super Admin only), or only those the caller started (`mine`); never a real one. */
  async removeAll(mine: boolean, user: SessionUser): Promise<KpiPracticeDeleted> {
    assertDeletes(user);
    const rows = await this.prisma.kpiScorecard.findMany({ where: { practice: true, ...(mine && { practiceById: user.id }) }, select: ROW });
    if (!rows.length) return { deleted: 0 };
    const { count } = await this.prisma.kpiScorecard.deleteMany({ where: { id: { in: rows.map((r) => r.id) }, practice: true } });
    for (const r of rows) {
      await this.audit.record({ userId: user.id, action: 'delete', entityType: SCORECARD_ENTITY, entityId: r.id, diff: { ...auditOf(r), all: true, ...(mine && { onlyMine: true }) } });
    }
    return { deleted: count };
  }

  // ---------- a draft changing under them ----------

  /** The practice scorecards on a template version (a draft's), in the caller's transaction. */
  onTemplate(tx: Tx, templateId: string) {
    return tx.kpiScorecard.findMany({
      where: { templateId, practice: true },
      select: { id: true, month: true, status: true, attendanceScore: true, employee: { select: { employeeCode: true } } },
    });
  }

  /**
   * A draft's practice scorecards started again on its new metrics (owner's brief, 22 October 2026: "saving a draft that
   * has practice cards resets them (their picks cleared, back to self-rating)"): every pick, comment, signature and
   * score cleared, back to the self-rating, a row a new metric, the Attendance metric's points as the draft now gives
   * them (from the attendance score kept), and its steps started again with "Opened" saying why. In the draft's save's
   * transaction, after its old metrics' picks were cleared (detach) and its new metrics made.
   */
  async restartOnDraft(tx: Tx, cards: readonly { id: string; attendanceScore: Prisma.Decimal | null }[], metricIds: readonly string[], attendancePoints: number, version: number, userId: string) {
    for (const c of cards) {
      await tx.kpiScorecard.update({
        where: { id: c.id },
        data: {
          status: 'self_rating',
          selfComment: null,
          selfSubmittedAt: null,
          selfMissed: false,
          managerComment: null,
          scoredAt: null,
          scoredById: null,
          hrComment: null,
          calibratedAt: null,
          calibratedById: null,
          employeeSignedAt: null,
          employeeSignComment: null,
          managerSignedAt: null,
          managerSignedById: null,
          managerSignComment: null,
          finalAt: null,
          finalPercent: null,
          level: null,
          pillars: Prisma.DbNull,
          remindersSent: [],
          attendanceAchieved: kpiAttendanceAchieved(attendancePoints, c.attendanceScore?.toNumber() ?? null),
        },
      });
      await tx.kpiScorecardStep.deleteMany({ where: { scorecardId: c.id } });
      await tx.kpiScorecardStep.create({ data: { scorecardId: c.id, kind: 'opened', actorId: userId, comment: `Practice, started again: the draft of version ${version} was changed` } });
      if (metricIds.length) await tx.kpiScore.createMany({ data: metricIds.map((metricId) => ({ scorecardId: c.id, metricId })) });
    }
  }

  /** Their picks cleared, so the draft's metrics they were made on can be replaced (a pick keeps its metric). */
  async detach(tx: Tx, cardIds: readonly string[]) {
    if (cardIds.length) await tx.kpiScore.deleteMany({ where: { scorecardId: { in: [...cardIds] } } });
  }

  /** A draft's practice scorecards deleted with it as it is discarded, in its transaction; what they were. */
  async removeOnDraft(tx: Tx, templateId: string): Promise<Row[]> {
    const rows = await tx.kpiScorecard.findMany({ where: { templateId, practice: true }, select: ROW });
    if (rows.length) await tx.kpiScorecard.deleteMany({ where: { id: { in: rows.map((r) => r.id) }, practice: true } });
    return rows;
  }

  /** The audit log's entries for a draft's practice scorecards started again, or deleted with it. */
  async recordDraftChange(kind: 'restart' | 'remove', cards: readonly (RestartedCard | Row)[], template: { id: string; version: number }, userId: string) {
    for (const c of cards) {
      await this.audit.record({
        userId,
        action: kind === 'restart' ? 'practice_reset' : 'delete',
        entityType: SCORECARD_ENTITY,
        entityId: c.id,
        diff: {
          practice: true,
          month: monthOfCard(c),
          employeeCode: c.employee.employeeCode,
          templateId: template.id,
          version: template.version,
          draft: true,
          reason: kind === 'restart' ? 'Its draft was saved changed' : 'Its draft was discarded',
          ...(kind === 'restart' ? { status: { from: c.status, to: 'self_rating' } } : { status: c.status }),
        },
      });
    }
  }

  private assertStarts(user: SessionUser) {
    if (!startsKpiPractice(user)) throw new ForbiddenException('Only HR, the CEO and a Super Admin start practice KPI scorecards.');
  }
}
