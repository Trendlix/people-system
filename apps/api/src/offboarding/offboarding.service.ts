import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CLEARANCE_AUTO_ITEMS,
  DEFAULT_CLEARANCE_ITEMS,
  CLEARANCE_ITEM_STATUS_LABELS,
  clearanceChecklistProblems,
  clearanceComplete,
  clearanceItemProblems,
  clearanceProgress,
  EXIT_RATINGS,
  exitInterviewProblems,
  isClearanceOwner,
  REHIRE_LABELS,
  rehireProblems,
  type ClearanceDefaultView,
  type ClearanceHolding,
  type ClearanceItemStatus,
  type ClearanceItemView,
  type ClearanceKind,
  type ClearanceOwner,
  type ExitFilledBy,
  type ExitInterviewAnswers,
  type ExitInterviewStatus,
  type ExitInterviewView,
  type ExitRating,
  type ExitReason,
  type ExitRecommend,
  type MyExitInterviewView,
  type OffboardingCaseSummary,
  type OffboardingCaseView,
  type OffboardingStatus,
  type RehireEligibility,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, shownDate, toDateOnly, todayInCairo } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { placeName, userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { accountOfEmployee } from '../users/employee-accounts.js';
import { holdsOwner, managesOffboarding, marksItem, offboardingCaller, type OffboardingCaller } from './offboarding-access.js';
import type { AddItemDto, ChecklistDto, CompleteCaseDto, DeclineInterviewDto, ExitInterviewDto, MarkItemDto, RehireDto } from './offboarding.dto.js';

// Offboarding (owner, 21 October 2026: "when an employee resigns or contract ends with no renewal, where will the data
// be stored? will it be another tab?"; 22 October 2026, the full module; packages/shared offboarding.ts).
// - A case per employment: opened when the CEO approves its ending (EndingsService.approve), when it is ended by hand or
//   its ending completed (afterEnded), or by HR; cancelled when its ending is withdrawn, opened again by the next one.
// - Its checklist: "Assets returned" and "Final settlement paid", read live from custody and payroll's Unsettled while it
//   is open (kept when completed), then HR's default items, each cleared by its owner (HR, the direct manager, an Admin,
//   Finance, the Assets custodians) or by HR, the CEO or a Super Admin. Completed by them once every item is cleared; a
//   Super Admin may complete it anyway, with a reason.
// - The exit interview, sent by the employee while they can sign in or recorded by HR, or declined; rehire eligibility.
// - Those who handle cases are HR, the CEO and a Super Admin; a C-level person's case only the CEO and a Super Admin
//   (owner, 19 October 2026: "make C level Employees details not visible to HR"): 404 for anyone else. Those who only
//   clear items read the checklist alone.
// - The leaver's sign-in is disabled once the last working day has passed and they don't work here again (closeSignIn,
//   by the scheduler too), once per ending; an Admin's or a Super Admin's account is left alone (said on the case).
// Every change is audited; the notifications go after each change has committed.

export const CASE_ENTITY = 'offboarding_case';
export const CHECKLIST_ENTITY = 'clearance_checklist';

/** The most items a case may have, with the one-off ones HR adds. */
const MAX_CASE_ITEMS = 30;

const USER = { select: { id: true, email: true } } as const;

const CASE_INCLUDE = {
  employment: {
    select: {
      id: true,
      employeeId: true,
      employmentType: true,
      joinDate: true,
      endDate: true,
      endReason: true,
      status: true,
      managerId: true,
      signInClosedAt: true,
      employee: { select: { id: true, employeeCode: true, fullNameEn: true, workEmail: true } },
      jobTitle: { select: { titleEn: true } },
      department: { select: { nameEn: true, parent: { select: { nameEn: true } } } },
      finalSettlement: { select: { status: true, settledOn: true } },
    },
  },
  ending: { select: { id: true, status: true, noticeGivenOn: true, lastWorkingDay: true, noticeEndsOn: true, lastDayAgreed: true, reason: true, rule: { select: { label: true } } } },
  items: { orderBy: { position: 'asc' }, include: { doneBy: USER } },
  interview: { include: { recordedBy: USER } },
  rehireSetBy: USER,
  completedBy: USER,
} satisfies Prisma.OffboardingCaseInclude;

type CaseRow = Prisma.OffboardingCaseGetPayload<{ include: typeof CASE_INCLUDE }>;

/** What the system reads for the two items it ticks, per case. */
interface LiveState {
  holdings: ClearanceHolding[];
}

/** An item's status as the case stands: the kept one, or for the two the system ticks while open, the live one. */
function itemStatus(row: CaseRow, item: CaseRow['items'][number], live: LiveState): ClearanceItemStatus {
  if (row.status !== 'open' || item.kind === 'manual') return item.status as ClearanceItemStatus;
  if (item.kind === 'assets') return live.holdings.length ? 'pending' : 'done';
  if (item.kind === 'final_settlement') return row.employment.endDate && row.employment.finalSettlement?.status === 'settled' ? 'done' : 'pending';
  return item.status as ClearanceItemStatus;
}

/** The last working day: the employment's end date once set, else its ending's (one still going). */
function lastDayOf(row: Pick<CaseRow, 'ending' | 'employment'>): string | null {
  if (row.employment.endDate) return fromDateOnly(row.employment.endDate);
  return row.ending && row.ending.status !== 'withdrawn' && row.ending.status !== 'rejected' ? fromDateOnly(row.ending.lastWorkingDay) : null;
}

/** Whether the last working day shown is one HR or an Admin agreed with the employee (owner, 26 October 2026). */
function lastDayAgreedOf(row: Pick<CaseRow, 'ending'>): boolean {
  return !!row.ending && row.ending.status !== 'withdrawn' && row.ending.status !== 'rejected' && row.ending.lastDayAgreed;
}

function interviewView(i: CaseRow['interview'], names: ReadonlyMap<string, { name: string }>): ExitInterviewView {
  if (!i) return { status: 'pending', filledBy: null, answers: null, declinedNote: null, recordedBy: null, recordedAt: null };
  return {
    status: i.status as ExitInterviewStatus,
    filledBy: i.filledBy as ExitFilledBy,
    answers: i.status === 'submitted' ? answersOf(i) : null,
    declinedNote: i.declinedNote,
    recordedBy: i.recordedBy ? (names.get(i.recordedBy.id)?.name ?? i.recordedBy.email) : null,
    recordedAt: i.recordedAt.toISOString(),
  };
}

function answersOf(i: NonNullable<CaseRow['interview']>): ExitInterviewAnswers {
  return {
    reason: i.reason as ExitReason,
    ratings: { role: i.ratingRole!, manager: i.ratingManager!, pay: i.ratingPay!, growth: i.ratingGrowth!, culture: i.ratingCulture! },
    recommend: i.recommend as ExitRecommend,
    comments: i.comments,
  };
}

const RATING_COLUMNS: Record<ExitRating, 'ratingRole' | 'ratingManager' | 'ratingPay' | 'ratingGrowth' | 'ratingCulture'> = {
  role: 'ratingRole',
  manager: 'ratingManager',
  pay: 'ratingPay',
  growth: 'ratingGrowth',
  culture: 'ratingCulture',
};

/** The answers as columns, once checked. */
function answerColumns(dto: ExitInterviewDto) {
  const ratings = dto.ratings as Record<ExitRating, number>;
  const comments = typeof dto.comments === 'string' ? dto.comments.trim() || null : null;
  return {
    reason: dto.reason as string,
    recommend: dto.recommend as string,
    comments,
    ...Object.fromEntries(EXIT_RATINGS.map((k) => [RATING_COLUMNS[k], ratings[k]])),
  } as { reason: string; recommend: string; comments: string | null } & Record<(typeof RATING_COLUMNS)[ExitRating], number>;
}

@Injectable()
export class OffboardingService {
  private readonly logger = new Logger('Offboarding');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- who asks ----------

  async caller(user: SessionUser): Promise<OffboardingCaller> {
    const [selfId, row] = await Promise.all([this.confidential.selfId(user), this.prisma.user.findUnique({ where: { id: user.id }, select: { assetsAccess: true } })]);
    return offboardingCaller(user, selfId, row?.assetsAccess);
  }

  // ---------- opening, cancelling, ending ----------

  /**
   * The CEO approved an ending (the notice period starts): its employment's case opens, or a cancelled one opens again
   * for it. Never throws into the ending's flow: a failure is logged, and HR can open the case by hand.
   */
  async openForEnding(endingId: string, employmentId: string, user: SessionUser): Promise<void> {
    try {
      await this.open(employmentId, endingId, user.id);
    } catch (err) {
      this.logger.error(`The offboarding case of ending ${endingId} could not be opened: ${(err as Error).message}`);
    }
  }

  /** An ending was withdrawn: its employment's open case is cancelled. Never throws into the ending's flow. */
  async cancelForEnding(endingId: string, employmentId: string, user: SessionUser): Promise<void> {
    try {
      const row = await this.prisma.offboardingCase.findUnique({ where: { employmentId }, select: { id: true, status: true, endingId: true } });
      if (!row || row.status !== 'open') return;
      await this.prisma.offboardingCase.update({ where: { id: row.id }, data: { status: 'cancelled', cancelledAt: new Date() } });
      await this.audit.record({ userId: user.id, action: 'cancel', entityType: CASE_ENTITY, entityId: row.id, diff: { employmentId, endingId, status: { from: 'open', to: 'cancelled' } } });
    } catch (err) {
      this.logger.error(`The offboarding case of ending ${endingId} could not be cancelled: ${(err as Error).message}`);
    }
  }

  /**
   * An employment ended (End employment, or its ending completed): its case opens if it has none (or opens again if
   * cancelled), and the leaver's sign-in is disabled if the last working day has passed. Never throws into that flow.
   */
  async afterEnded(employmentId: string, user: SessionUser): Promise<void> {
    try {
      const ending = await this.prisma.employmentEnding.findFirst({ where: { employmentId, status: { in: ['approved', 'completed'] } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
      await this.open(employmentId, ending?.id ?? null, user.id);
      await this.closeSignIn(employmentId);
    } catch (err) {
      this.logger.error(`The offboarding of employment ${employmentId} could not be brought up to date: ${(err as Error).message}`);
    }
  }

  /** HR (the CEO, a Super Admin) opens a case by hand: for an employment without one, or whose case was cancelled. */
  async openByHand(employmentId: string, user: SessionUser): Promise<OffboardingCaseView> {
    this.assertManages(user);
    const employment = await this.prisma.employment.findUnique({ where: { id: employmentId }, select: { employeeId: true } });
    if (!employment) throw new NotFoundException('Employment not found.');
    await this.confidential.assertVisible(user, employment.employeeId, 'Employment not found.');
    const existing = await this.prisma.offboardingCase.findUnique({ where: { employmentId }, select: { id: true, status: true } });
    if (existing && existing.status !== 'cancelled') throw new ConflictException('This employment has an offboarding case already. Open it from Offboarding.');
    const ending = await this.prisma.employmentEnding.findFirst({ where: { employmentId, status: { in: ['pending_ceo', 'approved', 'completed'] } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    const id = await this.open(employmentId, ending?.id ?? null, user.id);
    return this.get(id!, user);
  }

  /**
   * Opens the employment's case (or opens a cancelled one again) with its checklist: the two items the system ticks,
   * then the default items in force. Nothing when it has one open or completed. Answers the case's id. The item owners
   * and the leaver are told after it is saved.
   */
  private async open(employmentId: string, endingId: string | null, openedById: string | null): Promise<string | null> {
    const done = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`people-system offboarding ${employmentId}`}))`;
      const existing = await tx.offboardingCase.findUnique({ where: { employmentId }, select: { id: true, status: true } });
      if (existing && existing.status !== 'cancelled') return { id: existing.id, opened: false, again: false };
      if (existing) {
        await tx.offboardingCase.update({ where: { id: existing.id }, data: { status: 'open', cancelledAt: null, endingId, openedById, openedAt: new Date(), clearedNoticeAt: null } });
        return { id: existing.id, opened: true, again: true };
      }
      await this.ensureDefaults(tx);
      const defaults = await tx.clearanceDefault.findMany({ where: { active: true }, orderBy: { position: 'asc' }, select: { label: true, owner: true } });
      const items = [
        ...CLEARANCE_AUTO_ITEMS.map((a) => ({ kind: a.kind as ClearanceKind, label: a.label, owner: a.owner })),
        ...defaults.map((d) => ({ kind: 'manual' as ClearanceKind, label: d.label, owner: d.owner as ClearanceOwner })),
      ];
      const made = await tx.offboardingCase.create({
        data: { employmentId, endingId, openedById, items: { create: items.map((i, n) => ({ ...i, position: n + 1 })) } },
        select: { id: true },
      });
      return { id: made.id, opened: true, again: false };
    });
    if (done.opened) {
      await this.audit.record({
        userId: openedById,
        action: done.again ? 'reopen_case' : 'open_case',
        entityType: CASE_ENTITY,
        entityId: done.id,
        diff: { employmentId, endingId, status: 'open' },
      });
      await this.tellOpened(done.id);
    }
    return done.id;
  }

  /** Tells each item owner how many items wait for them, and the leaver of their exit interview. */
  private async tellOpened(caseId: string): Promise<void> {
    const row = await this.row(caseId);
    const name = row.employment.employee.fullNameEn;
    const last = lastDayOf(row);
    const when = last ? ` · last working day ${shownDate(last)}` : '';
    const counts = await this.ownerCounts(row);
    const groups = new Map<number, string[]>();
    for (const [userId, count] of counts) groups.set(count, [...(groups.get(count) ?? []), userId]);
    for (const [count, userIds] of groups) {
      await this.notifications.notify(userIds, {
        kind: 'offboarding_items',
        title: `Clearance for ${name}`,
        body: `${count} ${count === 1 ? 'item' : 'items'} for you${when}`,
        link: `/offboarding/${caseId}`,
      });
    }
    // the leaver, while they can still sign in: not once their last working day has passed (their sign-in ends then)
    const gone = !!row.employment.endDate && fromDateOnly(row.employment.endDate) < todayInCairo();
    const leaver = gone ? null : await this.userOf(row.employment.employee.id);
    if (leaver?.isActive && !row.interview) {
      await this.notifications.notify([leaver.id], {
        kind: 'exit_interview',
        title: 'Your exit interview',
        body: last ? `Tell us about your time here, before your last working day, ${shownDate(last)}.` : 'Tell us about your time here.',
        link: '/my-requests/exit-interview',
      });
    }
  }

  /**
   * Each user's pending items on a case, by the roles they hold: the direct manager's, every Admin's, Finance's, HR's,
   * the Assets custodians' (only while the leaver holds something). A C-level person's case goes to the CEO and the
   * Super Admins alone.
   */
  private async ownerCounts(row: CaseRow): Promise<Map<string, number>> {
    const live = await this.live([row]);
    const pending = row.items.filter((i) => itemStatus(row, i, live.get(row.id)!) === 'pending');
    const out = new Map<string, number>();
    const add = (ids: readonly string[], n: number) => {
      for (const id of ids) out.set(id, (out.get(id) ?? 0) + n);
    };
    const count = (owner: ClearanceOwner) => pending.filter((i) => i.owner === owner).length;
    const confidential = (await this.confidential.ids()).has(row.employment.employeeId);
    if (confidential) {
      if (pending.length) add(await this.usersWithRoles(['ceo', 'super_admin']), pending.length);
      return out;
    }
    if (count('hr')) add(await this.usersWithRoles(['hr']), count('hr'));
    if (count('admin')) add(await this.usersWithRoles(['admin', 'super_admin']), count('admin'));
    if (count('finance')) add(await this.usersWithRoles(['finance']), count('finance'));
    if (count('assets')) {
      const custodians = await this.prisma.user.findMany({
        where: { isActive: true, OR: [{ assetsAccess: { in: ['custodian', 'manager'] } }, { roles: { some: { role: { key: 'super_admin' } } } }] },
        select: { id: true },
      });
      add(
        custodians.map((u) => u.id),
        count('assets'),
      );
    }
    if (count('manager') && row.employment.managerId) {
      const u = await this.userOf(row.employment.managerId);
      if (u?.isActive) add([u.id], count('manager'));
    }
    return out;
  }

  private async usersWithRoles(keys: string[]): Promise<string[]> {
    const rows = await this.prisma.user.findMany({ where: { isActive: true, roles: { some: { role: { key: { in: keys } } } } }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  /** The account linked to an employee (users.employee_id, 22 October 2026: never by email); null without one. */
  private async userOf(employeeId: string | null | undefined) {
    return accountOfEmployee(this.prisma, employeeId);
  }

  // ---------- the sign-in ----------

  /**
   * Disables the leaver's sign-in once their last working day has passed (the brief: "disable sign-in and revoke sessions
   * when the employment ends, keeping the account for the record"), once per ending (sign_in_closed_at): an Admin who
   * turns it back on isn't overruled. Not while they work here again (another employment current, or not ended before
   * today); an Admin's or a Super Admin's account is left alone, as the system needs one. Their open sessions end and
   * their phones' fingerprint sign-in stops, as deactivating on the Users page does. Answers whether it was disabled.
   */
  async closeSignIn(employmentId: string, now = new Date()): Promise<boolean> {
    const today = todayInCairo();
    const e = await this.prisma.employment.findUnique({
      where: { id: employmentId },
      select: { id: true, employeeId: true, endDate: true, signInClosedAt: true, employee: { select: { workEmail: true } } },
    });
    if (!e || e.signInClosedAt || !e.endDate || fromDateOnly(e.endDate) >= today) return false;
    const still = await this.prisma.employment.count({ where: { employeeId: e.employeeId, id: { not: e.id }, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(today) } }] } });
    const user = still ? null : await this.userOf(e.employeeId);
    const roles = user?.roles.map((r) => r.role.key) ?? [];
    const disable = !!user && user.isActive && !roles.includes('admin') && !roles.includes('super_admin');
    const marked = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.employment.updateMany({ where: { id: e.id, signInClosedAt: null }, data: { signInClosedAt: now } });
      if (!count || !disable) return false;
      await tx.user.update({ where: { id: user.id }, data: { isActive: false } });
      await tx.session.updateMany({ where: { userId: user.id, endedAt: null }, data: { endedAt: now, endReason: 'revoked' } });
      await tx.deviceCredential.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now, revokeReason: 'deactivated' } });
      return true;
    });
    if (marked && user) {
      await this.audit.record({
        userId: null,
        action: 'update',
        entityType: 'user',
        entityId: user.id,
        diff: { isActive: { from: true, to: false }, reason: 'Their employment ended', employmentId: e.id, lastWorkingDay: fromDateOnly(e.endDate) },
      });
    }
    return marked;
  }

  // ---------- reading ----------

  /** The cases the caller may see, newest first: all for those who handle them, else those with items they clear. */
  async list(status: OffboardingStatus | 'all' | undefined, user: SessionUser): Promise<OffboardingCaseSummary[]> {
    const caller = await this.caller(user);
    const hidden = await this.confidential.hiddenFrom(user);
    const confidentialIds = caller.seesConfidential ? new Set<string>() : await this.confidential.ids();
    const rows = await this.prisma.offboardingCase.findMany({
      where: {
        ...(status && status !== 'all' ? { status } : !status ? { status: 'open' } : {}),
        ...(hidden.length && { employment: { employeeId: { notIn: hidden } } }),
      },
      orderBy: { openedAt: 'desc' },
      include: CASE_INCLUDE,
    });
    const visible = rows.filter((r) => caller.manages || (!confidentialIds.has(r.employment.employeeId) && r.items.some((i) => holdsOwner(caller, i.owner as ClearanceOwner, r.employment.managerId))));
    const live = await this.live(visible);
    return visible.map((r) => this.summaryOf(r, caller, live.get(r.id)!));
  }

  /**
   * A person's latest case, for their profile's banner (those who handle cases): null without one, and for a C-level
   * person hidden from the caller.
   */
  async forEmployee(employeeId: string, user: SessionUser): Promise<OffboardingCaseSummary | null> {
    this.assertManages(user);
    if (await this.confidential.isHidden(user, employeeId)) return null;
    const row = await this.prisma.offboardingCase.findFirst({ where: { employment: { employeeId } }, orderBy: { openedAt: 'desc' }, include: CASE_INCLUDE });
    if (!row) return null;
    const caller = await this.caller(user);
    return this.summaryOf(row, caller, (await this.live([row])).get(row.id)!);
  }

  /** A case's page: in full for those who handle cases, the checklist alone for those who clear items; else 404. */
  async get(id: string, user: SessionUser): Promise<OffboardingCaseView> {
    const caller = await this.caller(user);
    const row = await this.visibleRow(id, caller);
    const live = (await this.live([row])).get(row.id)!;
    const summary = this.summaryOf(row, caller, live);
    const names = await userNames(this.prisma, [...row.items.map((i) => i.doneBy), row.interview?.recordedBy ?? null, row.rehireSetBy, row.completedBy]);
    const full = caller.manages;
    const open = row.status === 'open';
    const items: ClearanceItemView[] = row.items.map((i) => {
      const status = itemStatus(row, i, live);
      const auto = i.kind !== 'manual';
      return {
        id: i.id,
        kind: i.kind as ClearanceKind,
        label: i.label,
        owner: i.owner as ClearanceOwner,
        status,
        doneBy: status === 'pending' ? null : auto && !i.doneBy ? 'The system' : i.doneBy ? (names.get(i.doneBy.id)?.name ?? i.doneBy.email) : null,
        doneAt: status === 'pending' ? null : (i.doneAt?.toISOString() ?? null),
        note: i.note,
        canMark: marksItem(caller, { kind: i.kind, owner: i.owner as ClearanceOwner }, row.employment.managerId, open),
      };
    });
    const fs = row.employment.finalSettlement;
    return {
      ...summary,
      employmentId: row.employment.id,
      joinDate: fromDateOnly(row.employment.joinDate),
      employmentType: row.employment.employmentType,
      ending: row.ending
        ? {
            id: row.ending.id,
            status: row.ending.status,
            rule: row.ending.rule.label,
            noticeGivenOn: fromDateOnly(row.ending.noticeGivenOn),
            lastWorkingDay: fromDateOnly(row.ending.lastWorkingDay),
            noticeEndsOn: fromDateOnly(row.ending.noticeEndsOn),
            lastDayAgreed: row.ending.lastDayAgreed,
            reason: full ? row.ending.reason : null,
          }
        : null,
      items,
      holdings: live.holdings,
      finalSettlement: full
        ? { status: !row.employment.endDate ? 'not_yet' : fs?.status === 'settled' ? 'settled' : 'open', settledOn: fs?.status === 'settled' ? fromDateOnly(fs.settledOn) : null }
        : null,
      interview: full ? interviewView(row.interview, names) : null,
      rehireReason: full ? row.rehireReason : null,
      rehireSetBy: full && row.rehireSetBy ? (names.get(row.rehireSetBy.id)?.name ?? row.rehireSetBy.email) : null,
      signIn: full ? await this.signInOf(row) : null,
      overrideReason: full ? row.overrideReason : null,
      completedBy: row.completedBy ? (names.get(row.completedBy.id)?.name ?? row.completedBy.email) : null,
      can: {
        manage: full,
        complete: full && open,
        override: full && open && isSuperAdmin(user),
        addItem: full && open,
        interview: full && row.status !== 'cancelled' && row.interview?.filledBy !== 'employee',
        rehire: full,
      },
    };
  }

  private summaryOf(r: CaseRow, caller: OffboardingCaller, live: LiveState): OffboardingCaseSummary {
    const statuses = r.items.map((i) => ({ status: itemStatus(r, i, live) }));
    const today = todayInCairo();
    const end = fromDateOnly(r.employment.endDate);
    return {
      id: r.id,
      status: r.status as OffboardingStatus,
      employee: { id: r.employment.employee.id, employeeCode: r.employment.employee.employeeCode, fullNameEn: r.employment.employee.fullNameEn },
      jobTitle: r.employment.jobTitle?.titleEn ?? null,
      department: placeName(r.employment.department),
      lastWorkingDay: lastDayOf(r),
      lastDayAgreed: lastDayAgreedOf(r),
      ended: !!end && end <= today,
      endReason: caller.manages ? r.employment.endReason : null,
      progress: clearanceProgress(statuses),
      mine: r.status === 'open' ? r.items.filter((i, n) => statuses[n]!.status === 'pending' && marksItem(caller, { kind: i.kind, owner: i.owner as ClearanceOwner }, r.employment.managerId, true)).length : 0,
      exitInterview: caller.manages ? ((r.interview?.status as ExitInterviewStatus | undefined) ?? 'pending') : null,
      rehire: caller.manages ? ((r.rehire as RehireEligibility | null) ?? null) : null,
      openedAt: r.openedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    };
  }

  /** What the leaver still holds, per case (read from custody: the items not returned of their records). */
  private async live(rows: readonly CaseRow[]): Promise<Map<string, LiveState>> {
    const employees = [...new Set(rows.map((r) => r.employment.employeeId))];
    const held = employees.length
      ? await this.prisma.custodyItem.findMany({
          where: { returnedAt: null, custody: { employeeId: { in: employees } } },
          select: { asset: { select: { code: true, name: true } }, custody: { select: { code: true, kind: true, dueDate: true, employeeId: true } } },
          orderBy: [{ custody: { outAt: 'asc' } }],
        })
      : [];
    const byEmployee = new Map<string, ClearanceHolding[]>();
    for (const h of held) {
      const list = byEmployee.get(h.custody.employeeId) ?? [];
      list.push({ assetCode: h.asset.code, assetName: h.asset.name, custodyCode: h.custody.code, custodyKind: h.custody.kind, dueDate: fromDateOnly(h.custody.dueDate) });
      byEmployee.set(h.custody.employeeId, list);
    }
    return new Map(rows.map((r) => [r.id, { holdings: byEmployee.get(r.employment.employeeId) ?? [] }]));
  }

  private async signInOf(row: CaseRow): Promise<OffboardingCaseView['signIn']> {
    const user = await this.userOf(row.employment.employee.id);
    if (!user) return { state: 'none', email: null, note: 'They have no sign-in account.' };
    if (!user.isActive) return { state: 'disabled', email: user.email, note: 'Their sign-in is disabled: their sessions ended and their phones were signed out.' };
    const roles = user.roles.map((r) => r.role.key);
    if (row.employment.signInClosedAt) {
      return roles.includes('admin') || roles.includes('super_admin')
        ? { state: 'kept', email: user.email, note: 'An Admin account, so the system left it on. Deactivate it on Users if it should stop.' }
        : { state: 'kept', email: user.email, note: 'Turned back on after the system disabled it.' };
    }
    const last = lastDayOf(row);
    return { state: 'active', email: user.email, note: last ? `Disabled by the system after the last working day, ${shownDate(last)}.` : 'Disabled by the system after the last working day.' };
  }

  // ---------- the checklist of a case ----------

  /** Clears an item (done, not applicable), or puts it back to pending: its owner, or HR, the CEO, a Super Admin. */
  async markItem(id: string, itemId: string, dto: MarkItemDto, user: SessionUser): Promise<OffboardingCaseView> {
    const caller = await this.caller(user);
    const row = await this.visibleRow(id, caller);
    const item = row.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Item not found.');
    if (row.status !== 'open') throw new ConflictException(`This case is ${row.status === 'completed' ? 'completed' : 'cancelled'}: its items can’t change.`);
    if (item.kind !== 'manual') {
      throw new BadRequestException(
        item.kind === 'assets'
          ? '“Assets returned” is ticked by the system once everything they hold is received back on Custody.'
          : '“Final settlement paid” is ticked by the system once it is marked settled under Payroll → Unsettled.',
      );
    }
    if (!marksItem(caller, { kind: item.kind, owner: item.owner as ClearanceOwner }, row.employment.managerId, true)) {
      throw new ForbiddenException('This item is cleared by someone else.');
    }
    const note = dto.note === undefined ? item.note : dto.note;
    if (item.status === dto.status && note === item.note) return this.get(id, user);
    const cleared = dto.status !== 'pending';
    await this.prisma.offboardingItem.update({
      where: { id: itemId },
      data: { status: dto.status, note, doneById: cleared ? user.id : null, doneAt: cleared ? new Date() : null },
    });
    await this.audit.record({
      userId: user.id,
      action: 'clear_item',
      entityType: CASE_ENTITY,
      entityId: id,
      diff: { item: item.label, status: { from: CLEARANCE_ITEM_STATUS_LABELS[item.status as ClearanceItemStatus], to: CLEARANCE_ITEM_STATUS_LABELS[dto.status] }, ...(note !== item.note && { note: { from: item.note, to: note } }) },
    });
    await this.tellClearedIfDone(id);
    return this.get(id, user);
  }

  /** HR adds a one-off item to an open case. */
  async addItem(id: string, dto: AddItemDto, user: SessionUser): Promise<OffboardingCaseView> {
    const caller = await this.caller(user);
    this.assertManages(user);
    const row = await this.visibleRow(id, caller);
    if (row.status !== 'open') throw new ConflictException('Only an open case takes new items.');
    const label = dto.label.trim().replace(/\s+/g, ' ');
    const problems = clearanceItemProblems({ label, owner: dto.owner });
    if (problems.length) throw new BadRequestException(problems);
    if (row.items.length >= MAX_CASE_ITEMS) throw new BadRequestException(`A case takes at most ${MAX_CASE_ITEMS} items.`);
    if (row.items.some((i) => i.label.toLowerCase() === label.toLowerCase())) throw new BadRequestException('This case has an item with that name already.');
    const position = Math.max(0, ...row.items.map((i) => i.position)) + 1;
    await this.prisma.offboardingItem.create({ data: { caseId: id, position, kind: 'manual', label, owner: dto.owner } });
    await this.prisma.offboardingCase.update({ where: { id }, data: { clearedNoticeAt: null } });
    await this.audit.record({ userId: user.id, action: 'add_item', entityType: CASE_ENTITY, entityId: id, diff: { item: label, owner: dto.owner } });
    return this.get(id, user);
  }

  /**
   * Completes a case once every item is cleared; with items pending, only a Super Admin, with the reason (the brief:
   * "A Super Admin may override, with a reason, audited"). The two items the system ticks are kept as they stand.
   */
  async complete(id: string, dto: CompleteCaseDto, user: SessionUser): Promise<OffboardingCaseView> {
    const caller = await this.caller(user);
    this.assertManages(user);
    const row = await this.visibleRow(id, caller);
    if (row.status !== 'open') throw new ConflictException(`This case is ${row.status === 'completed' ? 'completed already' : 'cancelled'}.`);
    const live = (await this.live([row])).get(row.id)!;
    const statuses = row.items.map((i) => ({ item: i, status: itemStatus(row, i, live) }));
    const pending = statuses.filter((s) => s.status === 'pending');
    const reason = dto.overrideReason?.trim() || null;
    if (pending.length) {
      if (!isSuperAdmin(user)) throw new BadRequestException([`Still pending: ${pending.map((p) => p.item.label).join(', ')}. Clear every item first.`]);
      if (!reason) throw new BadRequestException(['Say why the case is completed with items still pending.']);
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const s of statuses) {
        if (s.item.kind === 'manual' || s.status === 'pending' || s.item.status !== 'pending') continue;
        await tx.offboardingItem.update({ where: { id: s.item.id }, data: { status: s.status, doneAt: now } });
      }
      const { count } = await tx.offboardingCase.updateMany({
        where: { id, status: 'open' },
        data: { status: 'completed', completedAt: now, completedById: user.id, overrideReason: pending.length ? reason : null },
      });
      if (!count) throw new ConflictException('This case changed meanwhile. Reload the page.');
    });
    await this.audit.record({
      userId: user.id,
      action: 'complete',
      entityType: CASE_ENTITY,
      entityId: id,
      diff: { status: { from: 'open', to: 'completed' }, ...(pending.length && { overrideReason: reason, pending: pending.map((p) => p.item.label) }) },
    });
    return this.get(id, user);
  }

  /**
   * Tells HR (the CEO and the Super Admins for a C-level person) once every item of an open case is cleared, once (until
   * an item is added): after an item is cleared here, and from the scheduler for the two the system ticks.
   */
  async tellClearedIfDone(id: string): Promise<boolean> {
    const row = await this.row(id);
    if (row.status !== 'open' || row.clearedNoticeAt) return false;
    const live = (await this.live([row])).get(row.id)!;
    if (!clearanceComplete(row.items.map((i) => ({ status: itemStatus(row, i, live) })))) return false;
    const { count } = await this.prisma.offboardingCase.updateMany({ where: { id, clearedNoticeAt: null, status: 'open' }, data: { clearedNoticeAt: new Date() } });
    if (!count) return false;
    const confidential = (await this.confidential.ids()).has(row.employment.employeeId);
    const to = await this.usersWithRoles(confidential ? ['ceo', 'super_admin'] : ['hr']);
    await this.notifications.notify(to, {
      kind: 'offboarding_cleared',
      title: `Clearance done: ${row.employment.employee.fullNameEn}`,
      body: 'Every item is cleared. Complete the case.',
      link: `/offboarding/${id}`,
    });
    return true;
  }

  // ---------- rehire eligibility ----------

  async setRehire(id: string, dto: RehireDto, user: SessionUser): Promise<OffboardingCaseView> {
    const caller = await this.caller(user);
    this.assertManages(user);
    const row = await this.visibleRow(id, caller);
    const reason = dto.reason?.trim() || null;
    const problems = rehireProblems({ eligibility: dto.eligibility, reason });
    if (problems.length) throw new BadRequestException(problems);
    await this.prisma.offboardingCase.update({ where: { id }, data: { rehire: dto.eligibility, rehireReason: reason, rehireSetById: user.id, rehireSetAt: new Date() } });
    await this.audit.record({
      userId: user.id,
      action: 'rehire',
      entityType: CASE_ENTITY,
      entityId: id,
      diff: {
        rehire: { from: row.rehire ? REHIRE_LABELS[row.rehire as RehireEligibility] : null, to: REHIRE_LABELS[dto.eligibility] },
        ...(reason !== row.rehireReason && { reason: { from: row.rehireReason, to: reason } }),
      },
    });
    return this.get(id, user);
  }

  // ---------- the exit interview ----------

  /** HR records the exit interview from a conversation (or corrects what HR recorded). Not over the employee's own. */
  async recordInterview(id: string, dto: ExitInterviewDto, user: SessionUser): Promise<OffboardingCaseView> {
    const caller = await this.caller(user);
    this.assertManages(user);
    const row = await this.visibleRow(id, caller);
    if (row.status === 'cancelled') throw new ConflictException('This case is cancelled.');
    if (row.interview?.filledBy === 'employee' && row.interview.status === 'submitted') throw new ConflictException('The employee sent their exit interview themself: it can’t be changed.');
    const problems = exitInterviewProblems(dto);
    if (problems.length) throw new BadRequestException(problems);
    await this.saveInterview(row, { status: 'submitted', filledBy: 'hr', ...answerColumns(dto), declinedNote: null }, user, 'exit_interview');
    return this.get(id, user);
  }

  /** HR marks the exit interview declined (the leaver didn't want one). */
  async declineInterview(id: string, dto: DeclineInterviewDto, user: SessionUser): Promise<OffboardingCaseView> {
    const caller = await this.caller(user);
    this.assertManages(user);
    const row = await this.visibleRow(id, caller);
    if (row.status === 'cancelled') throw new ConflictException('This case is cancelled.');
    if (row.interview?.status === 'submitted') throw new ConflictException('The exit interview was done already.');
    await this.saveInterview(row, { ...EMPTY_ANSWERS, status: 'declined', filledBy: 'hr', declinedNote: dto.note ?? null }, user, 'decline_interview');
    return this.get(id, user);
  }

  /** The caller's own exit interview, while their case is open; null without one. */
  async mine(user: SessionUser): Promise<MyExitInterviewView | null> {
    const row = await this.ownOpenCase(user);
    if (!row) return null;
    return {
      caseId: row.id,
      lastWorkingDay: lastDayOf(row),
      status: (row.interview?.status as ExitInterviewStatus | undefined) ?? 'pending',
      answers: row.interview?.status === 'submitted' && row.interview.filledBy === 'employee' ? answersOf(row.interview) : null,
    };
  }

  /** The employee sends their exit interview: once, unless HR recorded it already. */
  async submitMine(dto: ExitInterviewDto, user: SessionUser): Promise<MyExitInterviewView | null> {
    const row = await this.ownOpenCase(user);
    if (!row) throw new NotFoundException('There is no exit interview for you.');
    if (row.interview?.status === 'submitted') throw new ConflictException('Your exit interview was sent already. Thank you.');
    const problems = exitInterviewProblems(dto);
    if (problems.length) throw new BadRequestException(problems);
    await this.saveInterview(row, { status: 'submitted', filledBy: 'employee', ...answerColumns(dto), declinedNote: null }, user, 'exit_interview');
    return this.mine(user);
  }

  /** The employee would rather not do one. */
  async declineMine(dto: DeclineInterviewDto, user: SessionUser): Promise<MyExitInterviewView | null> {
    const row = await this.ownOpenCase(user);
    if (!row) throw new NotFoundException('There is no exit interview for you.');
    if (row.interview?.status === 'submitted') throw new ConflictException('Your exit interview was sent already.');
    await this.saveInterview(row, { ...EMPTY_ANSWERS, status: 'declined', filledBy: 'employee', declinedNote: dto.note ?? null }, user, 'decline_interview');
    return this.mine(user);
  }

  private async ownOpenCase(user: SessionUser): Promise<CaseRow | null> {
    const self = await this.confidential.selfId(user);
    if (!self) return null;
    return this.prisma.offboardingCase.findFirst({ where: { status: 'open', employment: { employeeId: self } }, orderBy: { openedAt: 'desc' }, include: CASE_INCLUDE });
  }

  private async saveInterview(
    row: CaseRow,
    data: Omit<Prisma.ExitInterviewUncheckedCreateInput, 'caseId' | 'recordedById' | 'recordedAt'> & { status: string; filledBy: ExitFilledBy },
    user: SessionUser,
    action: string,
  ): Promise<void> {
    const values = { ...data, recordedById: user.id, recordedAt: new Date() };
    await this.prisma.exitInterview.upsert({ where: { caseId: row.id }, create: { caseId: row.id, ...values }, update: values });
    // the answers stay out of the audit log: who sent it, how and when is enough
    await this.audit.record({
      userId: user.id,
      action,
      entityType: CASE_ENTITY,
      entityId: row.id,
      diff: { exitInterview: { from: row.interview?.status ?? 'pending', to: data.status }, filledBy: data.filledBy },
    });
  }

  // ---------- the default checklist ----------

  async checklist(): Promise<ClearanceDefaultView[]> {
    await this.ensureDefaults();
    const rows = await this.prisma.clearanceDefault.findMany({ where: { active: true }, orderBy: { position: 'asc' } });
    return rows.map((r) => ({ id: r.id, label: r.label, owner: r.owner as ClearanceOwner }));
  }

  /** HR replaces the default checklist: the items kept by id, new ones added, the others switched off. */
  async saveChecklist(dto: ChecklistDto, user: SessionUser): Promise<ClearanceDefaultView[]> {
    this.assertManages(user);
    const items = (Array.isArray(dto.items) ? dto.items : []).map((i) => ({
      id: typeof i?.id === 'string' ? i.id : null,
      label: typeof i?.label === 'string' ? i.label.trim().replace(/\s+/g, ' ') : i?.label,
      owner: i?.owner,
    }));
    const problems = clearanceChecklistProblems(items);
    if (problems.length) throw new BadRequestException(problems);
    const before = await this.checklist();
    const known = new Set((await this.prisma.clearanceDefault.findMany({ select: { id: true } })).map((r) => r.id));
    await this.prisma.$transaction(async (tx) => {
      // out of the way of the positions first (they are not unique, but kept tidy)
      await tx.clearanceDefault.updateMany({ where: { active: true }, data: { active: false, updatedById: user.id } });
      let position = 1;
      for (const i of items) {
        const data = { label: i.label as string, owner: i.owner as ClearanceOwner, position: position++, active: true, updatedById: user.id };
        if (i.id && known.has(i.id)) await tx.clearanceDefault.update({ where: { id: i.id }, data });
        else await tx.clearanceDefault.create({ data });
      }
    });
    const after = await this.checklist();
    const words = (list: ClearanceDefaultView[]) => list.map((i) => `${i.label} (${i.owner})`);
    await this.audit.record({ userId: user.id, action: 'update', entityType: CHECKLIST_ENTITY, diff: { items: { from: words(before), to: words(after) } } });
    return after;
  }

  // ---------- helpers ----------

  /**
   * The brief's five default items, made by the migration, and here when the table has no row at all (as the tests'
   * database, emptied before each run). Never again once HR has a list: an item taken off stays, switched off.
   */
  private async ensureDefaults(db: PrismaService | Prisma.TransactionClient = this.prisma): Promise<void> {
    if (await db.clearanceDefault.count()) return;
    await db.clearanceDefault.createMany({ data: DEFAULT_CLEARANCE_ITEMS.map((d, i) => ({ position: i + 1, label: d.label, owner: d.owner })) });
  }

  private assertManages(user: SessionUser): void {
    if (!managesOffboarding(user)) throw new ForbiddenException('Only HR, the CEO and a Super Admin handle offboarding.');
  }

  private async row(id: string): Promise<CaseRow> {
    const row = await this.prisma.offboardingCase.findUnique({ where: { id }, include: CASE_INCLUDE });
    if (!row) throw new NotFoundException('Offboarding case not found.');
    return row;
  }

  /**
   * The case if the caller may see it: those who handle cases (a C-level person's only the CEO and a Super Admin), or
   * someone who clears one of its items (never a C-level person's); 404 for anyone else, so it isn't confirmed.
   */
  private async visibleRow(id: string, caller: OffboardingCaller): Promise<CaseRow> {
    const row = await this.row(id);
    const confidential = !caller.seesConfidential && (await this.confidential.ids()).has(row.employment.employeeId);
    if (confidential) throw new NotFoundException('Offboarding case not found.');
    if (caller.manages) return row;
    if (row.items.some((i) => isClearanceOwner(i.owner) && holdsOwner(caller, i.owner, row.employment.managerId))) return row;
    throw new NotFoundException('Offboarding case not found.');
  }

  /** The case ids still open, for the scheduler. */
  async openIds(): Promise<string[]> {
    return (await this.prisma.offboardingCase.findMany({ where: { status: 'open', clearedNoticeAt: null }, select: { id: true } })).map((r) => r.id);
  }
}

const EMPTY_ANSWERS = { reason: null, recommend: null, comments: null, ratingRole: null, ratingManager: null, ratingPay: null, ratingGrowth: null, ratingCulture: null };
