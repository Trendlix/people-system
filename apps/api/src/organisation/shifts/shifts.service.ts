import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, changes } from '../../audit/audit.service.js';
import { assertDeletes } from '../../auth/roles.js';
import type { SessionUser } from '../../auth/session-user.js';
import { fromTimeOfDay, toTimeOfDay } from '../../common/time-of-day.js';
import type { Shift } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateShiftDto, UpdateShiftDto } from './shift.dto.js';

const ENTITY = 'shift';

export interface ShiftView {
  id: string;
  code: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  workingDays: number[];
}

function view(s: Shift): ShiftView {
  return {
    id: s.id,
    code: s.code,
    startTime: fromTimeOfDay(s.startTime),
    endTime: fromTimeOfDay(s.endTime),
    graceMinutes: s.graceMinutes,
    workingDays: [...s.workingDays].sort((a, b) => a - b),
  };
}

function assertOrder(start: string, end: string) {
  if (end <= start) throw new BadRequestException('The shift must end after it starts.');
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
    const shift = await this.prisma.shift.create({
      data: {
        code: dto.code,
        startTime: toTimeOfDay(dto.startTime),
        endTime: toTimeOfDay(dto.endTime),
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
    assertOrder(dto.startTime ?? before.startTime, dto.endTime ?? before.endTime);
    const shift = await this.prisma.shift.update({
      where: { id },
      data: {
        code: dto.code,
        startTime: dto.startTime ? toTimeOfDay(dto.startTime) : undefined,
        endTime: dto.endTime ? toTimeOfDay(dto.endTime) : undefined,
        graceMinutes: dto.graceMinutes,
        workingDays: dto.workingDays,
      },
    });
    const result = view(shift);
    const { code, startTime, endTime, graceMinutes } = dto;
    const diff = changes({ ...before }, { code, startTime, endTime, graceMinutes, workingDays: dto.workingDays && result.workingDays });
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
