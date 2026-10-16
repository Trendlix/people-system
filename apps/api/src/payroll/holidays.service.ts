import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, changes } from '../audit/audit.service.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, shownDate, toDateOnly } from '../common/date-only.js';
import { Prisma, type Holiday } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CHOOSE_FILE, classifyDays, IMPORT_MAX_BYTES, ImportFileError, readImportFile, TOO_LARGE, type ImportDay, type ImportProblem, type ImportReading } from './holidays-import.js';
import { holidayTemplate, holidayTemplateName } from './holidays-import-template.js';
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

/**
 * A holiday list read and set against the holidays on file, nothing saved (POST /payroll/holidays/import/preview):
 * the file's fingerprint (to confirm the import with), its rows of holidays, each day with what happens to it, and the
 * rows that can't be imported, with why.
 */
export interface HolidayImportPreview {
  fingerprint: string;
  rows: number;
  days: ImportDay[];
  problems: ImportProblem[];
}

/** An import done (POST /payroll/holidays/import): the file as checked at that moment, and the holidays added. */
export interface HolidayImportResult extends HolidayImportPreview {
  imported: HolidayView[];
}

/** The parts of an uploaded file the import reads. */
type Upload = Pick<Express.Multer.File, 'buffer' | 'size'>;

// The year's official holidays (owner's request, 16 October 2026; Organization → Holidays since the owner's "make
// holiday a separate tab" the same day): one day each, a holiday of several days a row per day, one holiday a day. A holiday on a shift's working day takes that day's
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

  // Importing a year's list (owner's request, 16 October 2026: "allow me to import yearly holiday list"): HR or Admin
  // downloads the template, fills it in and uploads it (.xlsx or .csv); the preview reads it and sets each day against
  // the holidays on file without saving anything; the import, confirmed with the preview's fingerprint and the same
  // file sent again, reads it again and adds the new days. Sending the file again, rather than the rows the preview
  // answered, means the import never trusts anything but the file: it is read and checked exactly as it was previewed,
  // and checked against the holidays as they are at that moment. Days on file, clashes, duplicates and problem rows are
  // left out, as the preview showed them.

  /** The template to fill in (holidays-import-template.ts), its example row in `year`. */
  async template(year: number): Promise<{ fileName: string; data: Buffer }> {
    return { fileName: holidayTemplateName(year), data: await holidayTemplate(year) };
  }

  /** The file read and set against the holidays on file; nothing is saved. */
  async previewImport(file: Upload | undefined): Promise<HolidayImportPreview> {
    const reading = await this.readImport(file);
    return { ...reading, days: classifyDays(reading.days, await this.onDays(this.prisma, reading)) };
  }

  /**
   * Adds the file's new days, all in one transaction (all or none), checked against the holidays as they are then; one
   * entry in the audit log for the import, with the days added. 409 when the file isn't the one previewed, or a holiday
   * was added on one of its days meanwhile.
   */
  async importFile(file: Upload | undefined, fingerprint: string, user: SessionUser): Promise<HolidayImportResult> {
    const reading = await this.readImport(file);
    if (reading.fingerprint !== fingerprint) throw new ConflictException("This isn't the file that was previewed. Preview it again, then import it.");
    let days: ImportDay[];
    let created: Holiday[];
    try {
      ({ days, created } = await this.prisma.$transaction(async (tx) => {
        const checked = classifyDays(reading.days, await this.onDays(tx, reading));
        const fresh = checked.filter((d) => d.status === 'new');
        const rows = fresh.length
          ? await tx.holiday.createManyAndReturn({ data: fresh.map((d) => ({ date: toDateOnly(d.date), nameEn: d.nameEn, nameAr: d.nameAr })) })
          : [];
        return { days: checked, created: rows };
      }));
    } catch (err) {
      // a holiday added on one of the days while this was being saved: nothing was imported
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A holiday was added on one of these days just now, so nothing was imported. Preview the file again.');
      }
      throw err;
    }
    const imported = created.map(view).sort((a, b) => a.date.localeCompare(b.date));
    if (imported.length) {
      await this.audit.record({ userId: user.id, action: 'import', entityType: ENTITY, diff: { count: imported.length, dates: imported.map((h) => h.date) } });
    }
    return { ...reading, days, imported };
  }

  /** The file read, its size checked first; a file the import can't take refused (400) with what to do. */
  private async readImport(file: Upload | undefined): Promise<ImportReading> {
    if (!file?.buffer?.length) throw new BadRequestException(CHOOSE_FILE);
    if (file.size > IMPORT_MAX_BYTES) throw new BadRequestException(TOO_LARGE);
    try {
      return await readImportFile(file.buffer);
    } catch (err) {
      if (err instanceof ImportFileError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  /** The holidays on file on the file's days. */
  private async onDays(db: Pick<Prisma.TransactionClient, 'holiday'>, reading: ImportReading): Promise<HolidayView[]> {
    const dates = [...new Set(reading.days.map((d) => d.date))].map(toDateOnly);
    if (!dates.length) return [];
    return (await db.holiday.findMany({ where: { date: { in: dates } } })).map(view);
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
