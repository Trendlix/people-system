import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, changes } from '../audit/audit.service.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, shownDate, toDateOnly } from '../common/date-only.js';
import type { Holiday } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { HOLIDAY_YEARS, type CreateHolidayDto, type UpdateHolidayDto } from './holidays.dto.js';

const ENTITY = 'holiday';

/** A holiday as the API sends it: its day (YYYY-MM-DD) and names. */
export interface HolidayView {
  id: string;
  date: string;
  nameEn: string;
  nameAr: string | null;
}

const view = (h: Holiday): HolidayView => ({ id: h.id, date: fromDateOnly(h.date), nameEn: h.nameEn, nameAr: h.nameAr });

// The year's official holidays (owner's request, 16 October 2026, Payroll Setup → Holidays and Working Days): one day
// each, a holiday of several days a row per day, one holiday a day. A holiday on a shift's working day takes that day's
// hours out of the expected hours a run works out for each monthly-paid person; runs made or refreshed afterwards count
// it, and an approved run keeps what it was worked out with. HR, Finance, the CEO and Admin read them (as the payroll
// settings); HR and Admin add and change them; removing one is a deletion, so a Super Admin's (owner's decision, 15
// October 2026: only a Super Admin deletes records). Every change is in the audit log.
@Injectable()
export class HolidaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The holidays of a year, or every one, in date order. */
  async list(year?: number): Promise<HolidayView[]> {
    const where = year === undefined ? {} : { date: { gte: toDateOnly(`${year}-01-01`), lte: toDateOnly(`${year}-12-31`) } };
    return (await this.prisma.holiday.findMany({ where, orderBy: { date: 'asc' } })).map(view);
  }

  /** The holidays' days from `from` to `to` (YYYY-MM-DD, both included): what a run's roster takes out of the shifts' days. */
  async datesBetween(from: string, to: string): Promise<string[]> {
    const rows = await this.prisma.holiday.findMany({ where: { date: { gte: toDateOnly(from), lte: toDateOnly(to) } }, select: { date: true } });
    return rows.map((h) => fromDateOnly(h.date));
  }

  async create(dto: CreateHolidayDto, user: SessionUser): Promise<HolidayView> {
    await this.assertFree(dto.date);
    const row = await this.prisma.holiday.create({ data: { date: toDateOnly(dto.date), nameEn: dto.nameEn, nameAr: dto.nameAr ?? null } });
    const result = view(row);
    await this.audit.record({ userId: user.id, action: 'create', entityType: ENTITY, entityId: row.id, diff: { date: result.date, nameEn: result.nameEn, nameAr: result.nameAr } });
    return result;
  }

  async update(id: string, dto: UpdateHolidayDto, user: SessionUser): Promise<HolidayView> {
    const before = view(await this.row(id));
    if (dto.date !== undefined && dto.date !== before.date) await this.assertFree(dto.date);
    const row = await this.prisma.holiday.update({
      where: { id },
      data: { date: dto.date === undefined ? undefined : toDateOnly(dto.date), nameEn: dto.nameEn, nameAr: dto.nameAr },
    });
    const diff = changes({ ...before }, { date: dto.date, nameEn: dto.nameEn, nameAr: dto.nameAr });
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, entityId: id, diff });
    return view(row);
  }

  /** Removes a holiday: a Super Admin only, as every deletion. Runs made or refreshed afterwards no longer count it. */
  async remove(id: string, user: SessionUser): Promise<void> {
    assertDeletes(user);
    const holiday = view(await this.row(id));
    await this.prisma.holiday.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'delete', entityType: ENTITY, entityId: id, diff: { date: holiday.date, nameEn: holiday.nameEn } });
  }

  private async row(id: string): Promise<Holiday> {
    const holiday = await this.prisma.holiday.findUnique({ where: { id } });
    if (!holiday) throw new NotFoundException('Holiday not found.');
    return holiday;
  }

  /** Within the years a run can be for, and not a day that already has a holiday. */
  private async assertFree(date: string) {
    const year = Number(date.slice(0, 4));
    if (year < HOLIDAY_YEARS.from || year > HOLIDAY_YEARS.to) {
      throw new BadRequestException(`Choose a date from ${HOLIDAY_YEARS.from} to ${HOLIDAY_YEARS.to}.`);
    }
    const taken = await this.prisma.holiday.findUnique({ where: { date: toDateOnly(date) }, select: { nameEn: true } });
    if (taken) throw new ConflictException(`There is already a holiday on ${shownDate(date)}: ${taken.nameEn}.`);
  }
}
