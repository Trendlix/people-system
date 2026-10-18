import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  annualAvailable,
  annualEntitlement,
  isLeaveDays,
  LEAVE_RULE_DEFAULTS,
  leaveDayRate,
  leaveTypeLeft,
  takesFromAnnual,
  type LeaveBalanceKind,
  type LeaveRules,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { seesEveryone } from '../employees/access.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isHr, type Caller } from './access.js';
import type { LeaveAdjustmentDto } from './leave.dto.js';
import { ADJUSTMENT_ENTITY, settingsRules } from './views.js';

type Db = PrismaService | Prisma.TransactionClient;

/** The statuses of a request that takes days: being decided, or approved. */
export const TAKING = ['with_manager', 'with_hr', 'approved'] as const;

/** An employment as the balances read it, with its person. */
export interface LeaveEmployment {
  id: string;
  employeeId: string;
  joinDate: string;
  endDate: string | null;
  hazardousWork: boolean;
  managerId: string | null;
  departmentId: string | null;
  workingDays: number[] | null;
  employee: { id: string; fullNameEn: string; workEmail: string | null; dateOfBirth: string | null; gender: string | null; priorServiceMonths: number | null; disability: boolean };
}

/** The annual balance of an employment's year, as GET /me/leave/balances sends it. */
export interface AnnualBalanceView {
  entitlement: number;
  usableFrom: string;
  carriedIn: number;
  adjustments: number;
  taken: number;
  booked: number;
  pending: number;
  available: number;
}

/** Another type's use in the year, and what is left of its days a year. */
export interface TypeBalanceView {
  typeId: string;
  nameEn: string;
  nameAr: string;
  used: number;
  timesInService: number;
  left: number | null;
}

export interface LeaveBalancesView {
  year: number;
  annual: AnnualBalanceView;
  types: TypeBalanceView[];
}

/** What an employment's year of annual leave is worked out from, loaded at once for many. */
export interface YearFigures {
  entitlement: number;
  usableFrom: string;
  carriedIn: number;
  carriedInByYear: Record<string, number>;
  adjustments: number;
  /** Approved, started by `today`. */
  taken: number;
  /** Approved, not started. */
  booked: number;
  pending: number;
  /** Each approved leave from the annual balance in the year, for the law's flags (Art. 125). */
  approved: { typeKey: string; days: number }[];
  closed: { on: string; unused: number; carriedOut: number; paidOut: number; dayRate: number | null; payoutAdjustmentId: string | null } | null;
}

const EMPLOYMENT_SELECT = {
  id: true,
  employeeId: true,
  joinDate: true,
  endDate: true,
  hazardousWork: true,
  managerId: true,
  departmentId: true,
  shift: { select: { workingDays: true } },
  employee: { select: { id: true, fullNameEn: true, workEmail: true, dateOfBirth: true, gender: true, priorServiceMonths: true, disability: true } },
} satisfies Prisma.EmploymentSelect;

type EmploymentRow = Prisma.EmploymentGetPayload<{ select: typeof EMPLOYMENT_SELECT }>;

export function leaveEmployment(e: EmploymentRow): LeaveEmployment {
  return {
    id: e.id,
    employeeId: e.employeeId,
    joinDate: fromDateOnly(e.joinDate),
    endDate: fromDateOnly(e.endDate),
    hazardousWork: e.hazardousWork,
    managerId: e.managerId,
    departmentId: e.departmentId,
    workingDays: e.shift?.workingDays ?? null,
    employee: { ...e.employee, dateOfBirth: fromDateOnly(e.employee.dateOfBirth) },
  };
}

const days = (d: Prisma.Decimal | null | undefined) => (d ? d.toNumber() : 0);
const tenth = (n: number) => Math.round(n * 10) / 10 + 0;

// The annual leave balance (owner, 18 October 2026: "can you apply the leaves according to the law?"), by calendar
// year (January to December) and by employment: what the year earns (Art. 124, packages/shared annualEntitlement: 15
// days in the first year of service, pro-rata, usable after six months; 21 from the second; 30 after 10 years' service
// with one or more employers or over the age of 50; 45 with a disability; 7 more for hazardous work), the days carried
// in by the year before's Year Closing, HR's adjustments, and what the leave from it (annual and casual) takes: taken
// (approved, started), booked (approved, not started) and pending (being decided). The other types' use in the year and
// in service. HR adjusts a year's balance with a reason, until the year is closed; every adjustment is in the audit log.
@Injectable()
export class LeaveBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The Leave Setup's numbers (the migration's row; the law's numbers should it be missing). */
  async rules(db: Db = this.prisma): Promise<LeaveRules> {
    const row = await db.leaveSettings.findUnique({ where: { id: 1 } });
    return row ? settingsRules(row) : { ...LEAVE_RULE_DEFAULTS };
  }

  /** The employment a person's leave is about: the current one, else the latest; null for someone never employed. */
  async employmentOf(employeeId: string, db: Db = this.prisma): Promise<LeaveEmployment | null> {
    const row = await db.employment.findFirst({
      where: { employeeId },
      orderBy: [{ endDate: { sort: 'desc', nulls: 'first' } }, { joinDate: 'desc' }],
      select: EMPLOYMENT_SELECT,
    });
    return row ? leaveEmployment(row) : null;
  }

  /** Employments by id, as the balances read them. */
  async employments(ids: readonly string[], db: Db = this.prisma): Promise<LeaveEmployment[]> {
    if (!ids.length) return [];
    return (await db.employment.findMany({ where: { id: { in: [...ids] } }, select: EMPLOYMENT_SELECT })).map(leaveEmployment);
  }

  /** The employments current at a year's end (joined by 31 December, not ended by then): those a Year Closing decides. */
  async employedAtYearEnd(year: number): Promise<LeaveEmployment[]> {
    const end = toDateOnly(`${year}-12-31`);
    const rows = await this.prisma.employment.findMany({
      where: { joinDate: { lte: end }, OR: [{ endDate: null }, { endDate: { gt: end } }] },
      orderBy: { employee: { fullNameEn: 'asc' } },
      select: EMPLOYMENT_SELECT,
    });
    return rows.map(leaveEmployment);
  }

  /**
   * Each employment's year of annual leave, keyed `${employmentId}:${year}`: its entitlement (Art. 124), the days carried
   * in, HR's adjustments, what its leave from the annual balance takes (approved by `today` taken, approved later booked,
   * being decided pending; `except`: a request left out, e.g. the one being checked), and how it was closed.
   */
  async yearFigures(pairs: readonly { employment: LeaveEmployment; year: number }[], today: string, db: Db = this.prisma, except?: string): Promise<Map<string, YearFigures>> {
    const out = new Map<string, YearFigures>();
    if (!pairs.length) return out;
    const rules = await this.rules(db);
    const ids = [...new Set(pairs.map((p) => p.employment.id))];
    const years = [...new Set(pairs.map((p) => p.year))];
    const [from, to] = [Math.min(...years), Math.max(...years)];
    const [balances, adjustments, requests] = await Promise.all([
      db.leaveBalanceYear.findMany({ where: { employmentId: { in: ids }, year: { in: years } } }),
      db.leaveAdjustment.groupBy({ by: ['employmentId', 'year'], where: { employmentId: { in: ids }, year: { in: years } }, _sum: { days: true } }),
      db.leaveRequest.findMany({
        where: {
          employmentId: { in: ids },
          status: { in: [...TAKING] },
          type: { balance: { in: ['annual', 'from_annual'] } },
          startDate: { gte: toDateOnly(`${from}-01-01`), lte: toDateOnly(`${to}-12-31`) },
          ...(except && { id: { not: except } }),
        },
        select: { employmentId: true, startDate: true, days: true, status: true, type: { select: { key: true } } },
      }),
    ]);
    const balanceOf = new Map(balances.map((b) => [`${b.employmentId}:${b.year}`, b]));
    const adjustmentOf = new Map(adjustments.map((a) => [`${a.employmentId}:${a.year}`, days(a._sum.days)]));
    for (const { employment: e, year } of pairs) {
      const key = `${e.id}:${year}`;
      const entitlement = annualEntitlement({
        year,
        joinDate: e.joinDate,
        endDate: e.endDate,
        dateOfBirth: e.employee.dateOfBirth,
        priorServiceMonths: e.employee.priorServiceMonths,
        disability: e.employee.disability,
        hazardousWork: e.hazardousWork,
        rules,
      });
      const b = balanceOf.get(key);
      const mine = requests.filter((r) => r.employmentId === e.id && r.startDate.getUTCFullYear() === year);
      const sum = (list: typeof mine) => tenth(list.reduce((n, r) => n + r.days.toNumber(), 0));
      const approved = mine.filter((r) => r.status === 'approved');
      out.set(key, {
        entitlement: entitlement.days,
        usableFrom: entitlement.usableFrom,
        carriedIn: days(b?.carriedIn),
        carriedInByYear: (b?.carriedInByYear ?? {}) as Record<string, number>,
        adjustments: adjustmentOf.get(key) ?? 0,
        taken: sum(approved.filter((r) => fromDateOnly(r.startDate) <= today)),
        booked: sum(approved.filter((r) => fromDateOnly(r.startDate) > today)),
        pending: sum(mine.filter((r) => r.status !== 'approved')),
        approved: approved.map((r) => ({ typeKey: r.type.key, days: r.days.toNumber() })),
        closed:
          b?.closedOn && b.unused !== null && b.carriedOut !== null && b.paidOut !== null
            ? { on: b.closedOn, unused: days(b.unused), carriedOut: days(b.carriedOut), paidOut: days(b.paidOut), dayRate: b.dayRate?.toNumber() ?? null, payoutAdjustmentId: b.payoutAdjustmentId }
            : null,
      });
    }
    return out;
  }

  /** One employment's year of annual leave, as the balances show it. */
  async annual(employment: LeaveEmployment, year: number, today = todayInCairo(), db: Db = this.prisma, except?: string): Promise<AnnualBalanceView & { figures: YearFigures }> {
    const f = (await this.yearFigures([{ employment, year }], today, db, except)).get(`${employment.id}:${year}`)!;
    return {
      entitlement: f.entitlement,
      usableFrom: f.usableFrom,
      carriedIn: f.carriedIn,
      adjustments: f.adjustments,
      taken: f.taken,
      booked: f.booked,
      pending: f.pending,
      available: annualAvailable(f),
      figures: f,
    };
  }

  /**
   * A person's leave for a year: the annual balance of the employment it is about (the current one, else the latest),
   * and every other type on (and any used): its days used in the year (approved and being decided), the times taken in
   * service (every employment) and what is left of its days a year.
   */
  async balances(employeeId: string, year: number): Promise<LeaveBalancesView> {
    const employment = await this.employmentOf(employeeId);
    if (!employment) throw new ConflictException('There is no employment yet, so there is no leave balance.');
    const today = todayInCairo();
    const { figures: _f, ...annual } = await this.annual(employment, year, today);
    const [types, requests] = await Promise.all([
      this.prisma.leaveType.findMany({ where: { balance: { not: 'annual' } }, orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }] }),
      this.prisma.leaveRequest.findMany({ where: { employeeId, status: { in: [...TAKING] } }, select: { typeId: true, startDate: true, days: true } }),
    ]);
    return {
      year,
      annual,
      types: types
        .map((t) => {
          const all = requests.filter((r) => r.typeId === t.id);
          const used = tenth(all.filter((r) => r.startDate.getUTCFullYear() === year).reduce((n, r) => n + r.days.toNumber(), 0));
          return { type: t, used, timesInService: all.length };
        })
        .filter((x) => x.type.active || x.used > 0 || x.timesInService > 0)
        .map(({ type: t, used, timesInService }) => ({
          typeId: t.id,
          nameEn: t.nameEn,
          nameAr: t.nameAr,
          used,
          timesInService,
          left: leaveTypeLeft({ balance: t.balance as LeaveBalanceKind, daysPerYear: t.daysPerYear }, used),
        })),
    };
  }

  /** Whether the caller may see a person's leave: HR, the CEO, Finance, the person, and their direct manager now. */
  async assertSees(employeeId: string, caller: Caller): Promise<void> {
    if (seesEveryone(caller.user) || caller.employeeId === employeeId) return;
    if (caller.employeeId) {
      const managed = await this.prisma.employment.count({ where: { employeeId, endDate: null, managerId: caller.employeeId } });
      if (managed) return;
    }
    throw new NotFoundException('Employee not found.');
  }

  /**
   * HR adds or takes days off an employment's annual balance for a year, with a reason: the employment the person's
   * leave is about, a year it covers and not closed. Never HR's own.
   */
  async adjust(employeeId: string, dto: LeaveAdjustmentDto, caller: Caller): Promise<void> {
    if (!isHr(caller.user)) throw new ForbiddenException('Only HR adjusts a leave balance.');
    if (caller.employeeId === employeeId) throw new ForbiddenException('Someone else in HR has to adjust your own leave balance.');
    if (!isLeaveDays(dto.days) || dto.days === 0) throw new BadRequestException(['Enter the days to add or take off, e.g. 2 or -1.5: whole or half days, not 0.']);
    const employment = await this.employmentOf(employeeId);
    if (!employment) throw new ConflictException('There is no employment yet, so there is no leave balance to adjust.');
    const [joined, ended] = [Number(employment.joinDate.slice(0, 4)), employment.endDate ? Number(employment.endDate.slice(0, 4)) : null];
    if (dto.year < joined || (ended !== null && dto.year > ended)) {
      throw new BadRequestException([`Choose a year of this employment: ${joined}${ended === null ? ' on' : ` to ${ended}`}.`]);
    }
    if (await this.prisma.leaveYearClosing.findUnique({ where: { year: dto.year } })) {
      throw new ConflictException(`${dto.year}'s leave is closed: reopen its Year Closing to adjust a balance of that year.`);
    }
    const closed = await this.prisma.leaveBalanceYear.findUnique({ where: { employmentId_year: { employmentId: employment.id, year: dto.year } }, select: { closedOn: true } });
    if (closed?.closedOn) throw new ConflictException(`${employment.employee.fullNameEn}'s ${dto.year} leave was paid on leaving, so the balance can't change.`);
    const row = await this.prisma.leaveAdjustment.create({
      data: { employeeId, employmentId: employment.id, year: dto.year, days: dto.days, reason: dto.reason, createdById: caller.user.id },
    });
    await this.audit.record({
      userId: caller.user.id,
      action: 'create',
      entityType: ADJUSTMENT_ENTITY,
      entityId: row.id,
      diff: { employeeId, employmentId: employment.id, year: dto.year, days: dto.days, reason: dto.reason },
    });
  }

  /** The contract gross in force on a day for an employment (the latest start, the highest version), else the last signed before it. */
  async grossOn(employmentIds: readonly string[], on: string, db: Db = this.prisma): Promise<Map<string, number>> {
    if (!employmentIds.length) return new Map();
    const rows = await db.contract.findMany({
      where: { employmentId: { in: [...employmentIds] }, status: { not: 'draft' }, startDate: { lte: toDateOnly(on) } },
      orderBy: [{ startDate: 'desc' }, { version: 'desc' }],
      select: { employmentId: true, startDate: true, endDate: true, grossSalary: true },
    });
    const out = new Map<string, number>();
    for (const id of employmentIds) {
      const mine = rows.filter((r) => r.employmentId === id);
      const inForce = mine.find((r) => r.endDate === null || fromDateOnly(r.endDate) >= on) ?? mine[0];
      if (inForce) out.set(id, inForce.grossSalary.toNumber());
    }
    return out;
  }

  /** A day's pay for unused leave paid, by employment: the gross in force on the day ÷ the payroll's day divisor. */
  async dayRates(employmentIds: readonly string[], on: string, db: Db = this.prisma): Promise<Map<string, number>> {
    const [gross, settings] = await Promise.all([this.grossOn(employmentIds, on, db), db.payrollSettings.findUnique({ where: { id: 1 }, select: { dayDivisor: true } })]);
    const divisor = settings?.dayDivisor ?? 30;
    return new Map([...gross].map(([id, g]) => [id, leaveDayRate(g, divisor)]));
  }
}

/** Whether a type's days come out of the annual balance (annual and casual leave). */
export const fromAnnual = (t: { balance: string }) => takesFromAnnual(t.balance);
