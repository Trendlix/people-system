import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EXEMPTION_LABEL,
  exemptionInputProblems,
  exemptionLockProblem,
  exemptionMonths,
  exemptionOverlapProblem,
  exemptionState,
  seesConfidential,
  type ExemptionPeriod,
  type ExemptionState,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { actsAs, isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { placeName, userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AddCheckInExemptionsDto } from './check-in-exemptions.dto.js';
import { HoursByPairsService } from './hours-by-pairs.service.js';

// People exempt from check-in (owner, 25 October 2026: "allow me to select people that are not eligable for attendance
// checkins and outs, trat them as if they achived their full working hours"; asked, "Optional check-in" and "Profile + a
// list in Check-in Setup"; packages/shared check-in-exemptions.ts). Each exemption a dated period of its own, so a month
// always reads the periods that applied to it: added for one person on their profile or for several at once on Check-in
// Setup (one reason, one period), ended by "End now" (today, still exempt), one not started yet cancelled (kept: only a
// Super Admin deletes records). Who: HR, an Admin or a Super Admin; a C-level person's only the CEO or a Super Admin, as
// their other details (owner, 19 October 2026: "make C level Employees details not visible to HR"), hidden from the
// others (404); never someone's own but a Super Admin's (Claude's default). Only someone with a current employment, not
// a freelancer. A period whose days would fall in a month whose payroll is with the CEO, approved or paid is refused
// (approved and paid months never change); periods of one person never overlap. Each change is in the audit log (the
// reason too: it is free text, hidden from developers as every reason is), then the months it covers are recounted as
// the hours by pairs are (HoursByPairsService: the same pass), the person's draft lines refilled with their exempt days
// full.

const ENTITY = 'check_in_exemption';
const NOT_FOUND = 'Exemption not found.';
const PERSON_NOT_FOUND = 'Employee not found.';

/** An exemption as the profile and Check-in Setup show it. */
export interface CheckInExemptionView {
  id: string;
  employee: { id: string; employeeCode: string; fullNameEn: string; department: string | null };
  reason: string;
  startDate: string;
  endDate: string | null;
  state: ExemptionState;
  createdAt: string;
  createdBy: string | null;
  endedAt: string | null;
  endedBy: string | null;
  /** Whether the caller may end it now (it hasn't ended, and they manage this person's). */
  canEnd: boolean;
}

const SELECT = {
  id: true,
  employeeId: true,
  reason: true,
  startDate: true,
  endDate: true,
  createdAt: true,
  endedAt: true,
  createdBy: { select: { id: true, email: true } },
  endedBy: { select: { id: true, email: true } },
  employee: {
    select: {
      id: true,
      employeeCode: true,
      fullNameEn: true,
      employments: { where: { endDate: null }, orderBy: { joinDate: 'desc' }, take: 1, select: { department: { select: { nameEn: true, parent: { select: { nameEn: true } } } } } },
    },
  },
} satisfies Prisma.CheckInExemptionSelect;

type Row = Prisma.CheckInExemptionGetPayload<{ select: typeof SELECT }>;

/** A payroll status that keeps a month's days as they are. */
const LOCKED_STATUSES = ['pending_ceo', 'approved', 'paid'];

@Injectable()
export class CheckInExemptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly recount: HoursByPairsService,
  ) {}

  /** Check-in Setup's list: the current and upcoming exemptions of the people the caller may see, by name. */
  async list(user: SessionUser): Promise<{ exemptions: CheckInExemptionView[]; canAdd: boolean }> {
    const today = todayInCairo();
    const rows = await this.prisma.checkInExemption.findMany({
      where: { AND: [await this.confidential.ownedWhere(user), { cancelledAt: null, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(today) } }] }] },
      orderBy: [{ employee: { fullNameEn: 'asc' } }, { startDate: 'asc' }],
      select: SELECT,
    });
    return { exemptions: await this.views(rows, user, today), canAdd: actsAs(user.roles, ['hr', 'admin']) || seesConfidential(user) };
  }

  /**
   * A person's exemptions on their profile, the newest first, and the current one: for HR, an Admin, the CEO, a Super
   * Admin and the person themself; a C-level person's 404 for those who may not see them.
   */
  async ofEmployee(employeeId: string, user: SessionUser): Promise<{ periods: CheckInExemptionView[]; current: CheckInExemptionView | null; canManage: boolean }> {
    const self = (await this.confidential.selfId(user)) === employeeId;
    if (!self && !actsAs(user.roles, ['hr', 'admin', 'ceo'])) throw new NotFoundException(PERSON_NOT_FOUND);
    await this.confidential.assertVisible(user, employeeId, PERSON_NOT_FOUND);
    if (!(await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } }))) throw new NotFoundException(PERSON_NOT_FOUND);
    const today = todayInCairo();
    const rows = await this.prisma.checkInExemption.findMany({ where: { employeeId, cancelledAt: null }, orderBy: { startDate: 'desc' }, select: SELECT });
    const periods = await this.views(rows, user, today);
    const confidential = await this.confidential.isConfidential(employeeId);
    return { periods, current: periods.find((p) => p.state === 'current') ?? null, canManage: mayManage(user, { self, confidential }) };
  }

  /** One reason and one period for these people (1 to 100): all are kept, or none. */
  async add(dto: AddCheckInExemptionsDto, user: SessionUser): Promise<{ exemptions: CheckInExemptionView[] }> {
    const today = todayInCairo();
    const problems = exemptionInputProblems(dto, today);
    if (problems.length) throw new BadRequestException(problems);
    const reason = dto.reason!.trim();
    const startDate = dto.startDate || today;
    const endDate = dto.endDate || null;
    const ids = [...new Set(dto.employeeIds)];
    const [people, hidden, all, me] = await Promise.all([
      this.prisma.employee.findMany({
        where: { id: { in: ids } },
        select: { id: true, fullNameEn: true, employments: { where: { endDate: null }, orderBy: { joinDate: 'desc' }, take: 1, select: { employmentType: true } } },
      }),
      this.confidential.hiddenFrom(user),
      this.confidential.ids(),
      this.confidential.selfId(user),
    ]);
    if (people.length !== ids.length || ids.some((id) => hidden.includes(id))) throw new NotFoundException(PERSON_NOT_FOUND);
    for (const p of people) {
      if (!mayManage(user, { self: p.id === me, confidential: all.has(p.id) })) throw new ForbiddenException(refusalFor(user, { self: p.id === me, confidential: all.has(p.id), name: p.fullNameEn }));
      const job = p.employments[0];
      if (!job) throw new BadRequestException([`${p.fullNameEn} has no current employment, so there is no check-in to exempt them from.`]);
      if (job.employmentType === 'freelance') throw new BadRequestException([`${p.fullNameEn} works freelance and doesn't check in: freelance work is outside the labour law and its working hours.`]);
    }
    const lock = exemptionLockProblem(startDate, endDate, await this.lockedMonths(), 'start');
    if (lock) throw new ConflictException(lock);

    const made = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ANY(${[...ids].sort()}::uuid[]) ORDER BY id FOR UPDATE`;
      const others = await tx.checkInExemption.findMany({ where: { employeeId: { in: ids }, cancelledAt: null }, select: { employeeId: true, startDate: true, endDate: true } });
      const period: ExemptionPeriod = { startDate, endDate };
      for (const p of people) {
        const overlap = exemptionOverlapProblem(period, others.filter((o) => o.employeeId === p.id).map(periodOf), p.fullNameEn);
        if (overlap) throw new ConflictException(overlap);
      }
      const out: string[] = [];
      for (const p of people) {
        const row = await tx.checkInExemption.create({
          data: { employeeId: p.id, reason, startDate: toDateOnly(startDate), endDate: endDate ? toDateOnly(endDate) : null, createdById: user.id },
          select: { id: true },
        });
        out.push(row.id);
      }
      return out;
    });
    for (const [i, id] of made.entries()) {
      const p = people[i];
      await this.audit.record({ userId: user.id, action: 'create', entityType: ENTITY, entityId: id, diff: { employeeId: p.id, employee: p.fullNameEn, reason, startDate, endDate } });
    }
    // the months it covers, up to today (the days after it aren't read yet): their drafts refilled
    await this.recount.recount({ months: exemptionMonths(startDate, monthsUpTo(startDate, endDate, today)), employeeIds: ids, refillAll: true }, user);
    const rows = await this.prisma.checkInExemption.findMany({ where: { id: { in: made } }, orderBy: [{ employee: { fullNameEn: 'asc' } }], select: SELECT });
    return { exemptions: await this.views(rows, user, today) };
  }

  /** "End now": ends it today (today still exempt); one not started yet is cancelled (removed from the lists, kept). */
  async end(id: string, user: SessionUser): Promise<{ exemption: CheckInExemptionView | null; removed: boolean }> {
    const today = todayInCairo();
    const row = await this.prisma.checkInExemption.findUnique({ where: { id }, select: { ...SELECT, cancelledAt: true } });
    if (!row || row.cancelledAt || (await this.confidential.isHidden(user, row.employeeId))) throw new NotFoundException(NOT_FOUND);
    const [me, confidential] = await Promise.all([this.confidential.selfId(user), this.confidential.isConfidential(row.employeeId)]);
    const self = me === row.employeeId;
    if (!mayManage(user, { self, confidential })) throw new ForbiddenException(refusalFor(user, { self, confidential, name: row.employee.fullNameEn }));
    const period = periodOf(row);
    if (exemptionState(period, today) === 'ended') throw new ConflictException(`This exemption ended on ${shown(period.endDate!)} already.`);
    const upcoming = period.startDate > today;
    if (!upcoming) {
      // the days from tomorrow on change: never in a month whose payroll is with the CEO, approved or paid
      const lock = exemptionLockProblem(addDays(today, 1), period.endDate, await this.lockedMonths(), 'end');
      if (lock) throw new ConflictException(lock);
    }
    const { count } = await this.prisma.checkInExemption.updateMany({
      where: { id, cancelledAt: null, endedAt: null },
      data: upcoming ? { cancelledAt: new Date(), endedById: user.id, endedAt: new Date() } : { endDate: toDateOnly(today), endedById: user.id, endedAt: new Date() },
    });
    if (!count) throw new ConflictException('This exemption was ended meanwhile. Reload the page to see it as it is.');
    await this.audit.record({
      userId: user.id,
      action: upcoming ? 'cancel' : 'end',
      entityType: ENTITY,
      entityId: id,
      diff: { employeeId: row.employeeId, employee: row.employee.fullNameEn, startDate: period.startDate, endDate: { from: period.endDate, to: upcoming ? null : today }, ...(upcoming && { cancelled: true }) },
    });
    // the same pass as an addition: this month's draft refilled (the days from tomorrow on aren't read yet)
    await this.recount.recount({ months: [today.slice(0, 7)], employeeIds: [row.employeeId], refillAll: true }, user);
    if (upcoming) return { exemption: null, removed: true };
    const after = await this.prisma.checkInExemption.findUniqueOrThrow({ where: { id }, select: SELECT });
    return { exemption: (await this.views([after], user, today))[0], removed: false };
  }

  // ---------- helpers ----------

  /** The months whose payroll is with the CEO, approved or paid. */
  private async lockedMonths(): Promise<{ month: string; status: string }[]> {
    const runs = await this.prisma.payrollRun.findMany({ where: { status: { in: LOCKED_STATUSES } }, select: { month: true, status: true } });
    return runs.map((r) => ({ month: fromDateOnly(r.month).slice(0, 7), status: r.status }));
  }

  private async views(rows: readonly Row[], user: SessionUser, today: string): Promise<CheckInExemptionView[]> {
    if (!rows.length) return [];
    const [names, me, all] = await Promise.all([userNames(this.prisma, rows.flatMap((r) => [r.createdBy, r.endedBy])), this.confidential.selfId(user), this.confidential.ids()]);
    return rows.map((r) => {
      const period = periodOf(r);
      const state = exemptionState(period, today);
      return {
        id: r.id,
        employee: { id: r.employee.id, employeeCode: r.employee.employeeCode, fullNameEn: r.employee.fullNameEn, department: placeName(r.employee.employments[0]?.department ?? null) },
        reason: r.reason,
        startDate: period.startDate,
        endDate: period.endDate,
        state,
        createdAt: r.createdAt.toISOString(),
        createdBy: r.createdBy ? (names.get(r.createdBy.id)?.name ?? null) : null,
        endedAt: r.endedAt?.toISOString() ?? null,
        endedBy: r.endedBy ? (names.get(r.endedBy.id)?.name ?? null) : null,
        canEnd: state !== 'ended' && mayManage(user, { self: me === r.employeeId, confidential: all.has(r.employeeId) }),
      };
    });
  }
}

/**
 * Whether the caller adds and ends a person's exemptions: a C-level person's the CEO or a Super Admin (as their other
 * details); anyone else's HR, an Admin or a Super Admin; never their own but a Super Admin's.
 */
export function mayManage(user: SessionUser, who: { self: boolean; confidential: boolean }): boolean {
  if (who.self && !isSuperAdmin(user)) return false;
  if (who.confidential) return seesConfidential(user);
  return actsAs(user.roles, ['hr', 'admin']);
}

/** Why the caller may not exempt this person, in a sentence. */
function refusalFor(user: SessionUser, who: { self: boolean; confidential: boolean; name: string }): string {
  if (who.self && !isSuperAdmin(user)) return `Someone else exempts you from check-in: nobody sets their own ${EXEMPTION_LABEL.toLowerCase()}.`;
  if (who.confidential) return `Only the CEO or a Super Admin exempts a C-level person from check-in, as their other details.`;
  return `Only HR, an Admin or a Super Admin exempts someone from check-in; the CEO exempts the C-level people.`;
}

const periodOf = (r: { startDate: Date; endDate: Date | null }): ExemptionPeriod => ({ startDate: fromDateOnly(r.startDate), endDate: r.endDate ? fromDateOnly(r.endDate) : null });

/** The last day an addition's months run to: its end, else today (never before its first day's month). */
function monthsUpTo(startDate: string, endDate: string | null, today: string): string {
  const last = endDate !== null && endDate < today ? endDate : today;
  return last < startDate ? startDate : last;
}

/** A date as messages show it: DD/MM/YYYY. */
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
