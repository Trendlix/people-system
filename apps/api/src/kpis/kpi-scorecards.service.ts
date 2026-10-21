import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  KPI_COMMENT_MAX,
  KPI_STATUS_LABELS,
  kpiPast,
  kpiStatusAfterScoring,
  type KpiCounts,
  type KpiScorecardSummary,
  type KpiScorecardView,
  type KpiStatus,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { shownDate, todayInCairo, toDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { firstDay } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isOwnScorecard, isScorer, kpiCan, seesEveryScorecard, seesScorecard, type KpiCaller } from './kpi-access.js';
import { KpiNoticesService } from './kpi-notices.service.js';
import { KpiOpeningService } from './kpi-opening.service.js';
import { KpiSettingsService } from './kpi-settings.service.js';
import { CARD_INCLUDE, criteriaOf, deadlinesOf, monthOfCard, pillarsJson, SCORECARD_ENTITY, scoreOf, scorecardView, summaryOf, type CardRow } from './kpi-views.js';
import type { KpiCalibrateDto, KpiListQueryDto, KpiPicksDto, KpiSignDto } from './kpis.dto.js';

// KPI scorecards and their steps (owner, 21 October 2026: "Self, manager, HR, sign-off"; the brief: "1. The employee's
// self-rating: picks a criterion per metric, with an optional comment. 2. The manager scores with comments, seeing the
// self-rating. 3. HR calibrates: may change a manager's pick with a required reason, audited. 4. Sign-off by both, the
// employee and the manager: a digital "I've read it" with an optional comment. 5. Final and locked."). Who may see and
// do what: kpi-access.ts. Each step is saved in one transaction that checks the scorecard is still where it was, logged
// on the scorecard (its steps) and in the audit log, and told to whoever is next (kpi-notices.service.ts). The score kept
// on the scorecard (final %, level, pillars) is the manager's picks', calibrated: set when the scoring is sent, again at
// the calibration; the Attendance metric is read again at both (the month's attendance as payroll has it then). A
// scorecard final, the next month's payroll takes its final % (payroll/kpi-terms.ts). C-level people's (owner, 19
// October 2026: "make C level Employees details not visible to HR"): the CEO scores them and HR never sees them.

const NOT_FOUND = 'KPI scorecard not found.';

/** Another step was taken on it while the page was open (409). */
const movedMeanwhile = () => new ConflictException('This scorecard moved on meanwhile. Reload the page to see where it is.');

/** A step's status as a message says it: "with HR", "final". */
const statusWords = (status: string) => {
  const label = KPI_STATUS_LABELS[status as KpiStatus] ?? status;
  return label[0].toLowerCase() + label.slice(1);
};

/** A pick as sent, checked against the scorecard's metrics. */
interface Pick {
  metricId: string;
  choice: number | null;
  comment: string | null;
}

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const commentOf = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The picks sent, each a metric of the scorecard (once) with one of its criteria or none, and a comment within the limit. */
export function checkedPicks(raw: readonly unknown[], metrics: readonly { id: string; name: string; criteria: Prisma.JsonValue }[]): Pick[] {
  const byId = new Map(metrics.map((m) => [m.id, m]));
  const problems: string[] = [];
  const seen = new Set<string>();
  const picks: Pick[] = [];
  raw.forEach((value, i) => {
    const p = asObject(value);
    const metric = typeof p.metricId === 'string' ? byId.get(p.metricId) : undefined;
    if (!metric) return problems.push(`Pick ${i + 1}: choose a metric of this scorecard.`);
    if (seen.has(metric.id)) return problems.push(`${metric.name}: send it once.`);
    seen.add(metric.id);
    const count = criteriaOf(metric.criteria).length;
    const choice = p.choice === null || p.choice === undefined ? null : p.choice;
    if (choice !== null && !(typeof choice === 'number' && Number.isInteger(choice) && choice >= 0 && choice < count)) return problems.push(`${metric.name}: choose one of its criteria.`);
    if (p.comment !== undefined && p.comment !== null && typeof p.comment !== 'string') return problems.push(`${metric.name}: write the comment as text.`);
    const comment = commentOf(p.comment);
    if (comment && comment.length > KPI_COMMENT_MAX) return problems.push(`${metric.name}: keep the comment to ${KPI_COMMENT_MAX} characters or fewer.`);
    picks.push({ metricId: metric.id, choice: choice as number | null, comment });
  });
  if (problems.length) throw new BadRequestException(problems);
  return picks;
}

@Injectable()
export class KpiScorecardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly settings: KpiSettingsService,
    private readonly opening: KpiOpeningService,
    private readonly notices: KpiNoticesService,
  ) {}

  // ---------- reading ----------

  /** The caller's own scorecards, newest first; none without an employee profile. */
  async mine(user: SessionUser): Promise<KpiScorecardSummary[]> {
    const caller = await this.caller(user);
    if (!caller.employeeId) return [];
    const rows = await this.prisma.kpiScorecard.findMany({ where: { employeeId: caller.employeeId }, orderBy: { month: 'desc' }, include: CARD_INCLUDE });
    return this.summaries(rows, caller);
  }

  /** The scorecards waiting for the caller (their own too), the nearest deadline first. */
  async waiting(user: SessionUser): Promise<KpiScorecardSummary[]> {
    const caller = await this.caller(user);
    const rows = await this.prisma.kpiScorecard.findMany({ where: { AND: [{ status: { not: 'final' } }, this.involving(caller)] }, include: CARD_INCLUDE });
    const out = (await this.summaries(rows, caller)).filter((s) => s.action !== null);
    return out.sort((a, b) => (a.deadline ?? '').localeCompare(b.deadline ?? '') || a.employee.fullNameEn.localeCompare(b.employee.fullNameEn));
  }

  /** How many wait for the caller: their own, their people's, HR's (scored by HR, or to calibrate). */
  async counts(user: SessionUser): Promise<KpiCounts> {
    const caller = await this.caller(user);
    const waiting = await this.waiting(user);
    const counts: KpiCounts = { self: 0, team: 0, hr: 0 };
    for (const s of waiting) {
      if (caller.employeeId && s.employee.id === caller.employeeId) counts.self++;
      else if (s.action === 'calibrate' || s.scorer.kind === 'hr') counts.hr++;
      else counts.team++;
    }
    return counts;
  }

  /**
   * A list: `team`, those the caller scores (their people as the manager in charge; a C-level person's for the CEO; the
   * CEO's own for a Super Admin); `all`, for HR (without the C-level people's), the CEO and a Super Admin. Newest month
   * first, then by name.
   */
  async list(query: KpiListQueryDto, user: SessionUser): Promise<KpiScorecardSummary[]> {
    const caller = await this.caller(user);
    const filters: Prisma.KpiScorecardWhereInput[] = [];
    if (query.month) filters.push({ month: toDateOnly(firstDay(query.month)) });
    if (query.status) filters.push({ status: query.status });
    if (query.departmentId) filters.push({ OR: [{ departmentId: query.departmentId }, { department: { parentId: query.departmentId } }] });
    if (query.scope === 'all') {
      if (!seesEveryScorecard(user)) throw new ForbiddenException('Only HR, the CEO and a Super Admin see every KPI scorecard.');
      const hidden = [...caller.confidential.hidden];
      if (hidden.length) filters.push({ employeeId: { notIn: hidden } });
    } else filters.push(this.scoredBy(caller));
    const rows = await this.prisma.kpiScorecard.findMany({ where: { AND: filters }, orderBy: [{ month: 'desc' }, { employee: { fullNameEn: 'asc' } }], include: CARD_INCLUDE });
    return this.summaries(rows.filter((r) => query.scope === 'all' || isScorer(r, caller)), caller);
  }

  /** One scorecard, for those who may see it; everyone else is told it isn't there. */
  async one(id: string, user: SessionUser): Promise<KpiScorecardView> {
    const caller = await this.caller(user);
    const row = await this.visible(id, caller);
    const [settings, names] = await Promise.all([this.settings.read(), userNames(this.prisma, row.steps.map((s) => s.actor))]);
    return scorecardView(row, caller, settings, todayInCairo(), names);
  }

  // ---------- the steps ----------

  /** The employee's self-rating: saved, or sent (every metric picked) on to the scorer. */
  async selfRate(id: string, dto: KpiPicksDto, user: SessionUser): Promise<KpiScorecardView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    if (!isOwnScorecard(before, caller)) throw new ForbiddenException('Only the employee rates themself on their scorecard.');
    if (before.status !== 'self_rating') throw this.moved(before, 'rated');
    const picks = checkedPicks(dto.picks, before.template.metrics);
    const merged = this.merged(before, picks, 'self');
    if (dto.submit) this.assertAllPicked(before, merged, 'Rate yourself on every metric before you send it, or save it for later.');
    const comment = dto.comment ?? null;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.kpiScorecard.updateMany({
        where: { id, status: 'self_rating' },
        data: { selfComment: comment, ...(dto.submit && { status: 'manager', selfSubmittedAt: now }) },
      });
      if (!count) throw movedMeanwhile();
      await this.savePicks(tx, id, picks, 'self');
      if (dto.submit) await tx.kpiScorecardStep.create({ data: { scorecardId: id, kind: 'self_rated', actorId: user.id, comment } });
    });
    await this.audit.record({
      userId: user.id,
      action: dto.submit ? 'self_rate' : 'update',
      entityType: SCORECARD_ENTITY,
      entityId: id,
      diff: { month: monthOfCard(before), employeeCode: before.employee.employeeCode, step: 'self_rating', picked: Object.values(merged).filter((c) => c !== null).length, ...(dto.submit && { status: { from: 'self_rating', to: 'manager' } }) },
    });
    if (dto.submit) await this.notices.toScorer(id);
    return this.one(id, user);
  }

  /**
   * The scorer's scoring: saved at any time from the opening; sent (every metric picked, with the comments) once the
   * self-rating is sent or its day has gone by (then noted as missed), on to HR's calibration after a manager's scoring,
   * else straight to the sign-off.
   */
  async score(id: string, dto: KpiPicksDto, user: SessionUser): Promise<KpiScorecardView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    if (!isScorer(before, caller)) {
      throw new ForbiddenException(caller.confidential.all.has(before.employeeId) ? "A C-level person's scorecard is scored by the CEO." : 'Only the manager in charge scores this scorecard.');
    }
    if (before.status !== 'self_rating' && before.status !== 'manager') throw this.moved(before, 'scored');
    const settings = await this.settings.read();
    const month = monthOfCard(before);
    const today = todayInCairo();
    const selfDeadline = deadlinesOf(before, settings).selfRating;
    if (dto.submit && before.status === 'self_rating' && !kpiPast(selfDeadline, today)) {
      throw new ConflictException(`${before.employee.fullNameEn} can rate themself until ${shownDate(selfDeadline)}: save your scoring now, and send it once they have, or after that day.`);
    }
    const picks = checkedPicks(dto.picks, before.template.metrics);
    const merged = this.merged(before, picks, 'manager');
    const comment = dto.comment ?? null;
    if (dto.submit) {
      this.assertAllPicked(before, merged, 'Score every metric before you send it, or save it for later.');
      if (!comment) throw new BadRequestException(['Write your comments: how the month went and the areas of focus.']);
    }
    const to = kpiStatusAfterScoring(before.scorer);
    const now = new Date();
    // the month's attendance as payroll has it now, for the Attendance metric
    const attendance = dto.submit ? await this.opening.attendanceOf(month, before.employeeId, before.template.attendancePoints) : null;
    await this.prisma.$transaction(async (tx) => {
      const missed = dto.submit && before.status === 'self_rating';
      const { count } = await tx.kpiScorecard.updateMany({
        where: { id, status: before.status },
        data: { managerComment: comment, ...(missed && { selfMissed: true }), ...attendance },
      });
      if (!count) throw movedMeanwhile();
      await this.savePicks(tx, id, picks, 'manager');
      if (!dto.submit) return;
      if (missed) await tx.kpiScorecardStep.create({ data: { scorecardId: id, kind: 'self_missed', comment: `Not sent by ${shownDate(selfDeadline)}` } });
      const row = await tx.kpiScorecard.findUniqueOrThrow({ where: { id }, include: CARD_INCLUDE });
      const score = scoreOf(row, 'final');
      await tx.kpiScorecard.update({
        where: { id },
        data: { status: to, scoredAt: now, scoredById: user.id, finalPercent: score.finalPercent, level: score.level, pillars: pillarsJson(score) },
      });
      await tx.kpiScorecardStep.create({ data: { scorecardId: id, kind: 'scored', actorId: user.id, comment } });
    });
    await this.audit.record({
      userId: user.id,
      action: dto.submit ? 'score' : 'update',
      entityType: SCORECARD_ENTITY,
      entityId: id,
      diff: {
        month,
        employeeCode: before.employee.employeeCode,
        step: 'manager',
        picked: Object.values(merged).filter((c) => c !== null).length,
        ...(dto.submit && { status: { from: before.status, to }, ...(before.status === 'self_rating' && { selfMissed: true }) }),
      },
    });
    if (dto.submit) {
      if (to === 'hr') await this.notices.toHr(id);
      else await this.notices.readyToSign(id, settings);
    }
    return this.one(id, user);
  }

  /**
   * HR's calibration: the manager's picks changed (each with its reason, in the audit log with what it was and became),
   * HR's comment, then on to the sign-off. With no change it is confirmed as scored.
   */
  async calibrate(id: string, dto: KpiCalibrateDto, user: SessionUser): Promise<KpiScorecardView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    if (!kpiCan(before, caller).calibrate) {
      if (before.status !== 'hr') throw this.moved(before, 'calibrated');
      throw new ForbiddenException(isOwnScorecard(before, caller) ? 'Someone else in HR calibrates your own scorecard.' : 'Only HR calibrates a KPI scorecard.');
    }
    const metrics = new Map(before.template.metrics.map((m) => [m.id, m]));
    const scores = new Map(before.scores.map((s) => [s.metricId, s]));
    const problems: string[] = [];
    const changesMade: { metricId: string; name: string; from: string | null; to: string; choice: number; reason: string }[] = [];
    const seen = new Set<string>();
    dto.changes.forEach((value, i) => {
      const c = asObject(value);
      const metric = typeof c.metricId === 'string' ? metrics.get(c.metricId) : undefined;
      if (!metric) return problems.push(`Change ${i + 1}: choose a metric of this scorecard.`);
      if (seen.has(metric.id)) return problems.push(`${metric.name}: change it once.`);
      seen.add(metric.id);
      const criteria = criteriaOf(metric.criteria);
      if (!(typeof c.choice === 'number' && Number.isInteger(c.choice) && c.choice >= 0 && c.choice < criteria.length)) return problems.push(`${metric.name}: choose one of its criteria.`);
      const was = scores.get(metric.id)?.managerChoice ?? null;
      if (c.choice === was) return problems.push(`${metric.name}: that is the manager's pick already; leave it out, or choose another criterion.`);
      const reason = commentOf(c.reason);
      if (!reason) return problems.push(`${metric.name}: write the reason for changing the manager's pick.`);
      if (reason.length > KPI_COMMENT_MAX) return problems.push(`${metric.name}: keep the reason to ${KPI_COMMENT_MAX} characters or fewer.`);
      changesMade.push({ metricId: metric.id, name: metric.name, from: was === null ? null : (criteria[was]?.label ?? null), to: criteria[c.choice].label, choice: c.choice, reason });
    });
    if (problems.length) throw new BadRequestException(problems);
    const comment = dto.comment ?? null;
    const settings = await this.settings.read();
    const month = monthOfCard(before);
    const attendance = await this.opening.attendanceOf(month, before.employeeId, before.template.attendancePoints);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.kpiScorecard.updateMany({ where: { id, status: 'hr' }, data: { hrComment: comment, ...attendance } });
      if (!count) throw movedMeanwhile();
      for (const c of changesMade) await tx.kpiScore.update({ where: { scorecardId_metricId: { scorecardId: id, metricId: c.metricId } }, data: { hrChoice: c.choice, hrReason: c.reason } });
      const row = await tx.kpiScorecard.findUniqueOrThrow({ where: { id }, include: CARD_INCLUDE });
      const score = scoreOf(row, 'final');
      await tx.kpiScorecard.update({
        where: { id },
        data: { status: 'sign_off', calibratedAt: now, calibratedById: user.id, finalPercent: score.finalPercent, level: score.level, pillars: pillarsJson(score) },
      });
      const note = changesMade.length ? `${changesMade.length} ${changesMade.length === 1 ? 'pick' : 'picks'} changed` : 'Confirmed as scored';
      await tx.kpiScorecardStep.create({ data: { scorecardId: id, kind: 'calibrated', actorId: user.id, comment: comment ? `${note}. ${comment}` : note } });
    });
    await this.audit.record({
      userId: user.id,
      action: 'calibrate',
      entityType: SCORECARD_ENTITY,
      entityId: id,
      diff: {
        month,
        employeeCode: before.employee.employeeCode,
        status: { from: 'hr', to: 'sign_off' },
        changes: changesMade.map((c) => ({ metric: c.name, from: c.from, to: c.to, reason: c.reason })),
        ...(comment && { comment }),
      },
    });
    await this.notices.readyToSign(id, settings);
    return this.one(id, user);
  }

  /** "I've read it": the employee's signature, or the manager's; both signed, it is final and locked. */
  async sign(id: string, dto: KpiSignDto, user: SessionUser): Promise<KpiScorecardView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    if (before.status !== 'sign_off') throw this.moved(before, 'signed');
    const can = kpiCan(before, caller);
    const as = can.signAsEmployee ? 'employee' : can.signAsManager ? 'manager' : null;
    if (!as) {
      if (isOwnScorecard(before, caller) || isScorer(before, caller)) throw new ConflictException('You have signed this scorecard already.');
      throw new ForbiddenException('Only the employee and their manager sign a KPI scorecard.');
    }
    const comment = dto.comment ?? null;
    const now = new Date();
    const final = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.kpiScorecard.updateMany({
        where: { id, status: 'sign_off', ...(as === 'employee' ? { employeeSignedAt: null } : { managerSignedAt: null }) },
        data: as === 'employee' ? { employeeSignedAt: now, employeeSignComment: comment } : { managerSignedAt: now, managerSignedById: user.id, managerSignComment: comment },
      });
      if (!count) throw movedMeanwhile();
      await tx.kpiScorecardStep.create({ data: { scorecardId: id, kind: as === 'employee' ? 'signed_employee' : 'signed_manager', actorId: user.id, comment } });
      const { count: done } = await tx.kpiScorecard.updateMany({ where: { id, status: 'sign_off', employeeSignedAt: { not: null }, managerSignedAt: { not: null } }, data: { status: 'final', finalAt: now } });
      if (done) await tx.kpiScorecardStep.create({ data: { scorecardId: id, kind: 'final' } });
      return done > 0;
    });
    await this.audit.record({
      userId: user.id,
      action: 'sign',
      entityType: SCORECARD_ENTITY,
      entityId: id,
      diff: { month: monthOfCard(before), employeeCode: before.employee.employeeCode, signedAs: as, ...(comment && { comment }), ...(final && { status: { from: 'sign_off', to: 'final' } }) },
    });
    return this.one(id, user);
  }

  // ---------- helpers ----------

  /** The caller, with their own employee profile and the C-level people. */
  async caller(user: SessionUser): Promise<KpiCaller> {
    const [employeeId, confidential] = await Promise.all([this.confidential.selfId(user), this.confidential.view(user)]);
    return { user, employeeId, confidential };
  }

  /** The scorecards the caller may be waited for on: their own, those they score, and (HR, the CEO) those at HR's step. */
  private involving(caller: KpiCaller): Prisma.KpiScorecardWhereInput {
    const or: Prisma.KpiScorecardWhereInput[] = [this.scoredBy(caller)];
    if (caller.employeeId) or.push({ employeeId: caller.employeeId });
    if (caller.user.roles.includes('hr') || caller.user.roles.includes('ceo')) or.push({ status: 'hr' });
    return { OR: or };
  }

  /** The scorecards the caller scores, as a filter (isScorer checks each again). */
  private scoredBy(caller: KpiCaller): Prisma.KpiScorecardWhereInput {
    const or: Prisma.KpiScorecardWhereInput[] = [];
    if (caller.employeeId) or.push({ scorer: 'manager', managerId: caller.employeeId });
    if (caller.user.roles.includes('hr')) or.push({ scorer: 'hr' });
    if (caller.user.roles.includes('ceo')) or.push({ scorer: 'ceo' });
    if (caller.user.roles.includes('super_admin')) or.push({ scorer: 'super_admin' });
    const own = caller.employeeId ? { employeeId: { not: caller.employeeId } } : {};
    return or.length ? { AND: [{ OR: or }, own] } : { id: { in: [] } };
  }

  /** A scorecard the caller may see; otherwise it isn't there. */
  private async visible(id: string, caller: KpiCaller): Promise<CardRow> {
    const row = await this.prisma.kpiScorecard.findUnique({ where: { id }, include: CARD_INCLUDE });
    if (!row || !seesScorecard(row, caller)) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private async summaries(rows: readonly CardRow[], caller: KpiCaller): Promise<KpiScorecardSummary[]> {
    if (!rows.length) return [];
    const settings = await this.settings.read();
    const today = todayInCairo();
    return rows.filter((r) => seesScorecard(r, caller)).map((r) => summaryOf(r, caller, settings, today));
  }

  /** The step's picks after this change: the ones sent replace what was saved. */
  private merged(row: CardRow, picks: readonly Pick[], step: 'self' | 'manager'): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    for (const s of row.scores) out[s.metricId] = step === 'self' ? s.selfChoice : s.managerChoice;
    for (const p of picks) out[p.metricId] = p.choice;
    return out;
  }

  private assertAllPicked(row: CardRow, merged: Record<string, number | null>, message: string) {
    const missing = row.template.metrics.filter((m) => merged[m.id] === null || merged[m.id] === undefined).map((m) => m.name);
    if (missing.length) throw new BadRequestException([message, ...missing.map((name) => `${name}: choose one of its criteria.`)]);
  }

  private async savePicks(tx: Prisma.TransactionClient, id: string, picks: readonly Pick[], step: 'self' | 'manager') {
    for (const p of picks) {
      await tx.kpiScore.update({
        where: { scorecardId_metricId: { scorecardId: id, metricId: p.metricId } },
        data: step === 'self' ? { selfChoice: p.choice, selfComment: p.comment } : { managerChoice: p.choice, managerComment: p.comment },
      });
    }
  }

  /** The scorecard isn't at the step (409), saying where it is now. */
  private moved(row: CardRow, doing: string) {
    return new ConflictException(`This scorecard is ${statusWords(row.status)} now, so it can't be ${doing} at this step. Reload the page to see where it is.`);
  }
}
