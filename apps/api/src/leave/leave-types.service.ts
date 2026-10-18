import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LEAVE_RULE_DEFAULTS, type LeaveBalanceKind, type LeavePay } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { actsAs, assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateLeaveTypeDto, UpdateLeaveSettingsDto, UpdateLeaveTypeDto } from './leave.dto.js';
import { COUNT_REQUESTS, SETTINGS_ENTITY, settingsView, TYPE_ENTITY, typeView, type LeaveTypeView } from './views.js';

/** A type's names and rules, as checked and logged. */
interface TypeValues {
  nameEn: string;
  nameAr: string;
  paid: LeavePay;
  payPercent: number | null;
  balance: LeaveBalanceKind;
  daysPerYear: number | null;
  maxPerRequest: number | null;
  maxTimesInService: number | null;
  minServiceMonths: number | null;
  noticeDays: number | null;
  documentRequired: boolean;
  gender: 'male' | 'female' | null;
  calendarDays: boolean;
  halfDays: boolean;
  active: boolean;
  sortOrder: number;
}

// Leave Setup (owner, 18 October 2026: "can you apply the leaves according to the law?"): the leave types and the annual
// leave's numbers. The law's types (Labour Law 14/2025: annual, casual, the birth of a child, exams, Hajj, sick,
// maternity, childcare, unpaid) are seeded by the leave migration with the law's numbers; HR changes them, turns them off
// and adds types of its own. A change applies to the requests sent after it: a request sent is never checked again. The
// annual leave stays the annual balance itself, paid and on (Art. 124: "يستحق العامل إجازة سنوية بأجر"); only it is.
// Only a Super Admin deletes a type, and only one never asked for (owner's decision, 15 October 2026). Everyone signed
// in reads the types on (to ask for one) and the Leave Setup; HR, the CEO and Admins every type, with its requests.
// Every change is in the audit log.
@Injectable()
export class LeaveTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The types on, in their order; HR, the CEO and Admins every type, with how many requests each has. */
  async list(user: SessionUser): Promise<LeaveTypeView[]> {
    const everything = actsAs(user.roles, ['hr', 'ceo', 'admin']);
    const rows = await this.prisma.leaveType.findMany({
      where: everything ? {} : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
      ...(everything && { include: COUNT_REQUESTS }),
    });
    return rows.map(typeView);
  }

  async create(dto: CreateLeaveTypeDto, user: SessionUser): Promise<LeaveTypeView> {
    const after: TypeValues = {
      nameEn: dto.nameEn,
      nameAr: dto.nameAr,
      paid: dto.paid ?? 'paid',
      payPercent: dto.payPercent ?? null,
      balance: dto.balance ?? 'none',
      daysPerYear: dto.daysPerYear ?? null,
      maxPerRequest: dto.maxPerRequest ?? null,
      maxTimesInService: dto.maxTimesInService ?? null,
      minServiceMonths: dto.minServiceMonths ?? null,
      noticeDays: dto.noticeDays ?? null,
      documentRequired: dto.documentRequired ?? false,
      gender: dto.gender ?? null,
      calendarDays: dto.calendarDays ?? false,
      halfDays: dto.halfDays ?? false,
      active: dto.active ?? true,
      sortOrder: dto.sortOrder ?? 100,
    };
    await this.check(after, null);
    const row = await this.prisma.leaveType.create({ data: { key: await this.freeKey(after.nameEn), kind: 'custom', ...after }, include: COUNT_REQUESTS });
    await this.audit.record({ userId: user.id, action: 'create', entityType: TYPE_ENTITY, entityId: row.id, diff: { key: row.key, ...after } });
    return typeView(row);
  }

  /** Changes a type: each field sent. The requests sent before keep what they were checked with. */
  async update(id: string, dto: UpdateLeaveTypeDto, user: SessionUser): Promise<LeaveTypeView> {
    const before = await this.prisma.leaveType.findUnique({ where: { id }, include: COUNT_REQUESTS });
    if (!before) throw new NotFoundException('Leave type not found.');
    const was = typeView(before);
    const sent = <T>(value: T | undefined, current: T) => (value === undefined ? current : value);
    const paid = dto.paid ?? was.paid;
    const after: TypeValues = {
      nameEn: dto.nameEn ?? was.nameEn,
      nameAr: dto.nameAr ?? was.nameAr,
      paid,
      // a type no longer partly paid loses its percent unless one is sent (which is then refused)
      payPercent: sent(dto.payPercent, paid === 'partly' ? was.payPercent : null),
      balance: dto.balance ?? was.balance,
      daysPerYear: sent(dto.daysPerYear, was.daysPerYear),
      maxPerRequest: sent(dto.maxPerRequest, was.maxPerRequest),
      maxTimesInService: sent(dto.maxTimesInService, was.maxTimesInService),
      minServiceMonths: sent(dto.minServiceMonths, was.minServiceMonths),
      noticeDays: sent(dto.noticeDays, was.noticeDays),
      documentRequired: dto.documentRequired ?? was.documentRequired,
      gender: sent(dto.gender, was.gender),
      calendarDays: dto.calendarDays ?? was.calendarDays,
      halfDays: dto.halfDays ?? was.halfDays,
      active: dto.active ?? was.active,
      sortOrder: dto.sortOrder ?? was.sortOrder,
    };
    const { id: _i, key: _k, kind: _kind, requests: _r, ...wasValues } = was;
    const diff = changes({ ...wasValues }, { ...after });
    if (!Object.keys(diff).length) return was;
    await this.check(after, before);
    const row = await this.prisma.leaveType.update({ where: { id }, data: after, include: COUNT_REQUESTS });
    await this.audit.record({ userId: user.id, action: 'update', entityType: TYPE_ENTITY, entityId: id, diff: { key: before.key, ...diff } });
    return typeView(row);
  }

  /** Deletes a type never asked for: a Super Admin only (owner's decision, 15 October 2026). */
  async remove(id: string, user: SessionUser): Promise<void> {
    assertDeletes(user);
    const type = await this.prisma.leaveType.findUnique({ where: { id }, include: COUNT_REQUESTS });
    if (!type) throw new NotFoundException('Leave type not found.');
    if (type.balance === 'annual') throw new ConflictException("Annual leave is the law's (Art. 124) and the annual balance itself, so it can't be deleted.");
    const n = type._count.requests;
    if (n > 0) throw new ConflictException(`${type.nameEn} has ${n} request${n === 1 ? '' : 's'}, so it can't be deleted. Turn it off instead.`);
    await this.prisma.leaveType.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'delete', entityType: TYPE_ENTITY, entityId: id, diff: { key: type.key, nameEn: type.nameEn, nameAr: type.nameAr } });
  }

  // ---------- the Leave Setup ----------

  async settings() {
    return settingsView(await this.settingsRow());
  }

  /** HR changes the annual leave's numbers: each field sent. A year already closed keeps what it was closed with. */
  async updateSettings(dto: UpdateLeaveSettingsDto, user: SessionUser) {
    const before = await this.settingsRow();
    const sentValues = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    const { updatedAt: _u, ...was } = settingsView(before);
    const diff = changes(was, sentValues);
    if (!Object.keys(diff).length) return settingsView(before);
    const row = await this.prisma.leaveSettings.update({ where: { id: 1 }, data: { ...sentValues, updatedById: user.id } });
    await this.audit.record({ userId: user.id, action: 'update', entityType: SETTINGS_ENTITY, diff });
    return settingsView(row);
  }

  // ---------- helpers ----------

  private async settingsRow() {
    return (await this.prisma.leaveSettings.findUnique({ where: { id: 1 } })) ?? (await this.prisma.leaveSettings.create({ data: { id: 1, ...LEAVE_RULE_DEFAULTS } }));
  }

  /**
   * The English name free (whatever the case); a partly paid type with its percent and only it; days a year for a type
   * with days of its own; only the annual leave the annual balance, and it paid and on.
   */
  private async check(v: TypeValues, before: { id: string; balance: string; nameEn: string } | null): Promise<void> {
    const taken = await this.prisma.leaveType.findFirst({
      where: { nameEn: { equals: v.nameEn, mode: 'insensitive' }, ...(before && { id: { not: before.id } }) },
      select: { nameEn: true },
    });
    if (taken) throw new ConflictException(`There is already a leave type called ${taken.nameEn}. Choose another name.`);
    const problems: string[] = [];
    if (v.paid === 'partly' && v.payPercent === null) problems.push('Enter the pay percent of a partly paid type, from 0 to 100, e.g. 75.');
    if (v.paid !== 'partly' && v.payPercent !== null) problems.push('Only a partly paid type has a pay percent: leave it empty, or choose Partly paid.');
    if (v.balance === 'yearly' && v.daysPerYear === null) problems.push('Enter the days a year: its days are its own each year.');
    if (before?.balance === 'annual') {
      if (v.balance !== 'annual') problems.push('Annual leave is the annual balance itself (Art. 124): its balance stays The annual balance.');
      if (v.paid !== 'paid') problems.push('Annual leave is paid (Art. 124: "يستحق العامل إجازة سنوية بأجر").');
      if (!v.active) problems.push("Annual leave is the law's (Art. 124): it can't be turned off.");
    } else if (v.balance === 'annual') {
      problems.push('Only Annual leave is the annual balance: choose From the annual balance to count this type against it.');
    }
    if (problems.length) throw new BadRequestException(problems);
  }

  /** A key for HR's own type: custom- and its English name, made unique. */
  private async freeKey(nameEn: string): Promise<string> {
    const base = `custom-${nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'leave'}`;
    for (let n = 1; ; n++) {
      const key = n === 1 ? base : `${base}-${n}`;
      if (!(await this.prisma.leaveType.findUnique({ where: { key }, select: { id: true } }))) return key;
    }
  }
}
