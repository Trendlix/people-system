import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { countUntilProblems, formatHours, shiftHours } from '@trendlix/shared';
import { AuditService, changes } from '../../audit/audit.service.js';
import { assertDeletes } from '../../auth/roles.js';
import type { SessionUser } from '../../auth/session-user.js';
import { fromTimeOfDay, toTimeOfDay } from '../../common/time-of-day.js';
import type { Shift } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateShiftDto, UpdateShiftDto } from './shift.dto.js';

const ENTITY = 'shift';

// A shift is a window, its start to its end, and the hours to work a day within it (owner, 16 October 2026, on the
// MORNING shift of 9:00 AM to 7:00 PM: "my company shift is to maintain 9 hours within the shift window, its like
// flexible shift"): fewer than the window, it is flexible, worked anywhere within it; not set, the whole window, as
// before. They are what payroll counts a day of the shift as, and the most attendance counts a day (owner, 16 October
// 2026: "maximum working hours to be recorded per day is 9 hours between checkin and check out"). In half hours, never
// more than the window: checked here with the times as they will be, and by the database. "Count hours until" (owner, 20
// October 2026: "within the same month with no working hours to be counted after 8 PM even if the check out was 11 PM /
// record the checkout time but count till the checkout window limit"): set, a day counts until that time and past the
// hours to work, so a long day fills the month's short hours; at or after the end and the same day (packages/shared
// countUntilProblems), checked here with the times as they will be, and by the database. Every change is audited.

export interface ShiftView {
  id: string;
  code: string;
  startTime: string;
  endTime: string;
  /** The hours to work a day within the window; null: the whole window (shiftWorkHours in @trendlix/shared). */
  hoursPerDay: number | null;
  /** "HH:mm": hours count until it, a long day making up short ones (20 October 2026); null: the end and grace. */
  countUntil: string | null;
  graceMinutes: number;
  workingDays: number[];
}

function view(s: Shift): ShiftView {
  return {
    id: s.id,
    code: s.code,
    startTime: fromTimeOfDay(s.startTime),
    endTime: fromTimeOfDay(s.endTime),
    hoursPerDay: s.hoursPerDay?.toNumber() ?? null,
    countUntil: s.countUntil ? fromTimeOfDay(s.countUntil) : null,
    graceMinutes: s.graceMinutes,
    workingDays: [...s.workingDays].sort((a, b) => a - b),
  };
}

function assertOrder(start: string, end: string) {
  if (end <= start) throw new BadRequestException('The shift must end after it starts.');
}

/** The hours to work a day fit in the window from `start` to `end`. */
function assertHoursFit(start: string, end: string, hoursPerDay: number | null | undefined) {
  const window = shiftHours(start, end);
  if (typeof hoursPerDay === 'number' && window !== null && hoursPerDay > window) {
    throw new BadRequestException(`The hours to work can't be more than the shift's window, ${formatHours(window)}.`);
  }
}

/** The time hours count until is at or after the end, the same day (countUntilProblems): `until` null or missing, nothing to check. */
function assertCountUntil(start: string, end: string, until: string | null | undefined) {
  const problems = countUntilProblems({ startTime: start, endTime: end, countUntil: until });
  if (problems.length) throw new BadRequestException(problems);
}

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<ShiftView[]> {
    return (await this.prisma.shift.findMany({ orderBy: { code: 'asc' } })).map(view);
  }

  async get(id: string): Promise<ShiftView> {
    const shift = await this.prisma.shift.findUnique({ where: { id } });
    if (!shift) throw new NotFoundException('Shift not found.');
    return view(shift);
  }

  async create(dto: CreateShiftDto, userId: string): Promise<ShiftView> {
    assertOrder(dto.startTime, dto.endTime);
    assertHoursFit(dto.startTime, dto.endTime, dto.hoursPerDay);
    assertCountUntil(dto.startTime, dto.endTime, dto.countUntil);
    const shift = await this.prisma.shift.create({
      data: {
        code: dto.code,
        startTime: toTimeOfDay(dto.startTime),
        endTime: toTimeOfDay(dto.endTime),
        hoursPerDay: dto.hoursPerDay ?? null,
        countUntil: dto.countUntil ? toTimeOfDay(dto.countUntil) : null,
        graceMinutes: dto.graceMinutes,
        workingDays: dto.workingDays,
      },
    });
    const result = view(shift);
    await this.audit.record({ userId, action: 'create', entityType: ENTITY, entityId: shift.id, diff: { ...result } });
    return result;
  }

  async update(id: string, dto: UpdateShiftDto, userId: string): Promise<ShiftView> {
    const before = await this.get(id);
    const [start, end] = [dto.startTime ?? before.startTime, dto.endTime ?? before.endTime];
    assertOrder(start, end);
    // the hours as they will be (sent, or kept) within the window as it will be
    assertHoursFit(start, end, dto.hoursPerDay === undefined ? before.hoursPerDay : dto.hoursPerDay);
    // the time hours count until as it will be (sent, or kept) after the end as it will be
    assertCountUntil(start, end, dto.countUntil === undefined ? before.countUntil : dto.countUntil);
    const shift = await this.prisma.shift.update({
      where: { id },
      data: {
        code: dto.code,
        startTime: dto.startTime ? toTimeOfDay(dto.startTime) : undefined,
        endTime: dto.endTime ? toTimeOfDay(dto.endTime) : undefined,
        hoursPerDay: dto.hoursPerDay,
        countUntil: dto.countUntil === undefined ? undefined : dto.countUntil ? toTimeOfDay(dto.countUntil) : null,
        graceMinutes: dto.graceMinutes,
        workingDays: dto.workingDays,
      },
    });
    const result = view(shift);
    const { code, startTime, endTime, hoursPerDay, countUntil, graceMinutes } = dto;
    const diff = changes({ ...before }, { code, startTime, endTime, hoursPerDay, countUntil, graceMinutes, workingDays: dto.workingDays && result.workingDays });
    if (Object.keys(diff).length) await this.audit.record({ userId, action: 'update', entityType: ENTITY, entityId: id, diff });
    return result;
  }

  async remove(id: string, user: SessionUser) {
    assertDeletes(user);
    const shift = await this.get(id);
    // employments that ended keep their shift in the history
    const now = await this.prisma.employment.count({ where: { shiftId: id, endDate: null } });
    if (now > 0) throw new ConflictException(`${now} employee(s) work shift ${shift.code}. Move them to another shift before deleting it.`);
    const before = await this.prisma.employment.count({ where: { shiftId: id } });
    if (before > 0) throw new ConflictException(`Shift ${shift.code} is in the history of ${before} past employment(s), so it is kept.`);
    await this.prisma.shift.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'delete', entityType: ENTITY, entityId: id, diff: { code: shift.code } });
  }
}
