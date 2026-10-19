import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  attendanceMonth,
  changesPayrollLine,
  confidentialPeople,
  EMPTY_PAYROLL_INPUTS,
  matchPerson,
  OFFICE_ADDRESS_DEFAULTS,
  PERMISSION_RULE_DEFAULTS,
  type AttendanceDayResult,
  type AttendanceImportMark,
  type AttendanceMonthResult,
  type ImportedDay,
  type ImportedInput,
  type MatchKind,
  type PayrollInputs,
  type PayrollRules,
  type PayrollTerms,
} from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { addDays, fromDateOnly, toDateOnly } from '../common/date-only.js';
import { fromTimeOfDay } from '../common/time-of-day.js';
import { ConfidentialService, type ConfidentialView } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { employedIn, userNames } from '../payroll/adjustments/people.js';
import { json, savedInputs, worked } from '../payroll/line-work.js';
import { firstDay, lastDay, monthName } from '../payroll/months.js';
import { runLawRates } from '../payroll/views.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AttendancePersonDto } from './attendance-imports.dto.js';
import { personKey, readZohoWorkbook, ZOHO_MAX_FILES, ZohoFileError, type ZohoRow } from './zoho-file.js';

const IMPORT = 'attendance_import';
const LINE = 'payroll_line';
const NOT_FOUND = 'Attendance import not found.';

/** A person of the files as the import keeps them: Zoho's id and name, their days of the run's month, HR's choice. */
interface StoredPerson {
  key: string;
  zohoId: string | null;
  zohoName: string;
  days: ImportedDay[];
  /** Their rows of another month than the run's: left out, counted. */
  outside: number;
  /** The employee HR picked or confirmed; null: matched by name (or not at all). */
  pick: string | null;
  skipped: boolean;
  /** When their line was filled from it last, and by whom (a user id). */
  applied: { at: string; by: string } | null;
}

/** A file as the import keeps it: its name, the sheet read, its rows and people, the months its days are in. */
interface StoredFile {
  name: string;
  sheet: string;
  rows: number;
  people: number;
  months: string[];
  problems: string[];
}

/** How a person is matched, as the review shows it: by HR's choice too, or skipped. */
export type PersonMatch = MatchKind | 'confirmed' | 'skipped';

interface EmployeeRef {
  id: string;
  fullNameEn: string;
  employeeCode: string;
}

/** A person of the files as the review shows them. */
export interface AttendancePersonView {
  key: string;
  zohoId: string | null;
  zohoName: string;
  match: PersonMatch;
  employee: EmployeeRef | null;
  /** "Did you mean …?": the closest employees, for a close name or two of the same name. */
  candidates: (EmployeeRef & { similarity: number })[];
  /** Another person of the files is matched to the same employee: neither is applied until HR chooses. */
  duplicate: boolean;
  /** Their line on the run, and whether the caller fills it (HR, a C-level person's the CEO). */
  lineId: string | null;
  editable: boolean;
  confidential: boolean;
  /** Their days in the files of the run's month. */
  rows: number;
  /** Their month by the system's rules, once matched: the days, the hours counted, the absent days, the permission. */
  month: AttendanceMonthResult | null;
  applied: { at: string; by: string | null } | null;
}

export interface AttendanceImportView {
  id: string;
  runId: string;
  month: string;
  source: 'zoho';
  createdAt: string;
  createdBy: string | null;
  appliedAt: string | null;
  files: StoredFile[];
  people: AttendancePersonView[];
  /** The C-level people of the files hidden from the caller (owner, 19 October 2026): the CEO applies theirs. */
  hidden: { count: number; label: string } | null;
  counts: { matched: number; toConfirm: number; notFound: number; skipped: number; notOnRun: number };
  /** Whether the caller may apply it now: a draft run, and someone whose line they fill matched. */
  canApply: boolean;
}

/** Whether a match names the employee: by Zoho's id, by name, or by HR's choice. */
const isMatched = (m: PersonMatch) => m === 'linked' || m === 'exact' || m === 'confirmed';

const hoursToMinutes = (n: number) => Math.round(n * 60) / 60;

// Importing attendance from Zoho People on a draft payroll run (owner, 19 October 2026: attendance runs in Zoho People
// today, "Import Zoho now, replace it later"). HR uploads Zoho's daily attendance entries, one file with everyone or
// many at once (".xlsx", at most 60 of 5 MB each; zoho-file.ts reads them): the days of the run's month are kept with
// the import, by person, each check-in's place as office or remote (never its address), the days of another month left
// out and said. The review matches each person to an employee (packages/shared matchPerson: their remembered Zoho ID,
// else their English name written alike, else a close name for HR to confirm, else none for HR to pick or skip) and
// works out their month by the system's rules (attendanceMonth: the hours by their shift, the absent days, leave from
// the Leave module, the permission hours from the system's requests else Zoho's within the allowance, the leave days in
// Zoho not in the system listed). Apply fills the run's lines HR may fill (a C-level person's only the CEO, or HR with
// Super Admin: changesPayrollLine), replacing what was typed: the worked hours, the no-show days (the absent ones) and
// the permission hours, marked from Zoho; keeps each day (AttendanceDay, that month's Zoho days replaced); and remembers
// each person's Zoho ID on the employee. Every upload, choice and apply is in the audit log, each line changed too. The
// C-level people HR may not see are one row of the review, without their figures.
@Injectable()
export class AttendanceImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
  ) {}

  /** Reads the files on a draft run and keeps their days of its month for the review. */
  async upload(runId: string, files: Express.Multer.File[] | undefined, user: SessionUser): Promise<AttendanceImportView> {
    const run = await this.draftRun(runId, "attendance can't be imported on it");
    const month = fromDateOnly(run.month).slice(0, 7);
    if (!files?.length) throw new BadRequestException(['Choose the attendance entries exported from Zoho People: one file with everyone, or a file per person (.xlsx).']);
    if (files.length > ZOHO_MAX_FILES) throw new BadRequestException([`Upload at most ${ZOHO_MAX_FILES} files at once.`]);
    const settings = await this.prisma.payrollSettings.findUnique({ where: { id: 1 }, select: { officeAddresses: true } });
    const offices = settings?.officeAddresses ?? [...OFFICE_ADDRESS_DEFAULTS];

    const errors: string[] = [];
    const storedFiles: StoredFile[] = [];
    const people = new Map<string, StoredPerson>();
    for (const file of files) {
      const name = file.originalname || 'A file';
      let rows: ZohoRow[];
      let reading;
      try {
        reading = await readZohoWorkbook(file.buffer, offices);
        rows = reading.rows;
      } catch (err) {
        if (err instanceof ZohoFileError) {
          errors.push(`${name} ${err.message}`);
          continue;
        }
        throw err;
      }
      const months = [...new Set(rows.map((r) => r.date.slice(0, 7)))].sort();
      storedFiles.push({ name, sheet: reading.sheet, rows: rows.length, people: new Set(rows.map(personKey)).size, months, problems: reading.problems.slice(0, 20).map((p) => p.message) });
      for (const r of rows) {
        const key = personKey(r);
        const p = people.get(key) ?? { key, zohoId: r.zohoId, zohoName: r.name, days: [], outside: 0, pick: null, skipped: false, applied: null };
        if (r.name) p.zohoName = r.name;
        if (r.date.slice(0, 7) !== month) p.outside++;
        else {
          // the same day twice (two files): the later one kept
          const day: ImportedDay = { date: r.date, checkIn: r.checkIn, checkOut: r.checkOut, place: r.place, zohoStatus: r.zohoStatus, permissionHours: r.permissionHours };
          const i = p.days.findIndex((d) => d.date === r.date);
          if (i >= 0) p.days[i] = day;
          else p.days.push(day);
        }
        people.set(key, p);
      }
    }
    if (errors.length) throw new BadRequestException(errors);
    for (const p of people.values()) p.days.sort((a, b) => a.date.localeCompare(b.date));
    if (![...people.values()].some((p) => p.days.length)) {
      const theirs = [...new Set(storedFiles.flatMap((f) => f.months))].map(monthName).join(', ');
      throw new BadRequestException([`These files have no day of ${monthName(month)}, this payroll's month (they are of ${theirs}). Export ${monthName(month)}'s attendance entries from Zoho People.`]);
    }
    const made = await this.prisma.attendanceImport.create({
      data: { runId, month: run.month, source: 'zoho', files: json(storedFiles), people: json([...people.values()]), createdById: user.id },
      select: { id: true },
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: IMPORT,
      entityId: made.id,
      diff: { runId, month, source: 'zoho', files: storedFiles.map((f) => f.name), people: people.size },
    });
    return this.view(runId, made.id, user);
  }

  /** The run's imports, the latest first: when, by whom, how many people, whether applied. */
  async list(runId: string): Promise<{ id: string; createdAt: string; createdBy: string | null; files: number; people: number; appliedAt: string | null }[]> {
    if (!(await this.prisma.payrollRun.findUnique({ where: { id: runId }, select: { id: true } }))) throw new NotFoundException('Payroll not found.');
    const rows = await this.prisma.attendanceImport.findMany({
      where: { runId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, appliedAt: true, files: true, people: true, createdBy: { select: { id: true, email: true } } },
    });
    const names = await userNames(this.prisma, rows.map((r) => r.createdBy));
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy ? (names.get(r.createdBy.id)?.name ?? r.createdBy.email) : null,
      files: (r.files as unknown as StoredFile[]).length,
      people: (r.people as unknown as StoredPerson[]).length,
      appliedAt: r.appliedAt?.toISOString() ?? null,
    }));
  }

  /** The review: each person matched, to confirm or not found, with their month by the system's rules once matched. */
  async view(runId: string, importId: string, user: SessionUser): Promise<AttendanceImportView> {
    const { view } = await this.review(runId, importId, user);
    return view;
  }

  /**
   * HR's choice for a person: the employee they are (a close name confirmed, or someone picked), back to the match by
   * name (null), or skipped. A C-level person hidden from the caller can't be chosen by them.
   */
  async choose(runId: string, importId: string, dto: AttendancePersonDto, user: SessionUser): Promise<AttendanceImportView> {
    const imp = await this.row(runId, importId);
    await this.draftRun(runId, "its attendance import can't be changed");
    const people = imp.people as unknown as StoredPerson[];
    const person = people.find((p) => p.key === dto.key);
    if (!person) throw new NotFoundException('This person is not in the import. Reload the page and try again.');
    const before = { pick: person.pick, skipped: person.skipped };
    if (dto.skipped === true) {
      person.skipped = true;
      person.pick = null;
    } else {
      person.skipped = false;
      if (dto.employeeId) {
        const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId }, select: { id: true } });
        const confidential = await this.confidential.view(user);
        if (!employee || confidential.hidden.has(dto.employeeId)) throw new BadRequestException(['Employee not found. Choose the employee from the list.']);
        person.pick = dto.employeeId;
      } else person.pick = null;
    }
    const diff = changes(before, { pick: person.pick, skipped: person.skipped });
    if (Object.keys(diff).length) {
      await this.prisma.attendanceImport.update({ where: { id: importId }, data: { people: json(people) } });
      await this.audit.record({ userId: user.id, action: 'update', entityType: IMPORT, entityId: importId, diff: { runId, person: person.zohoId ?? person.zohoName, ...diff } });
    }
    return this.view(runId, importId, user);
  }

  /**
   * Fills the run's lines from the import: those of the people matched (not twice), on the run, whose lines the caller
   * fills; their worked hours, no-show days and permission hours replaced, marked from Zoho; their days kept, that
   * month's Zoho days replaced; their Zoho ID remembered.
   */
  async apply(runId: string, importId: string, user: SessionUser): Promise<AttendanceImportView> {
    const run = await this.draftRun(runId, "attendance can't be applied to it");
    const { view, imp, people } = await this.review(runId, importId, user);
    const due = view.people.filter((p) => isMatched(p.match) && !p.duplicate && p.lineId && p.editable && p.month);
    if (!due.length) {
      throw new ConflictException('Nobody in this import can be filled in by you now: match the people to their employees, and put them on this payroll, first.');
    }
    const month = fromDateOnly(run.month).slice(0, 7);
    const rules = run.rules as unknown as PayrollRules;
    const law = runLawRates(run);
    const at = new Date();
    const lineById = new Map(run.lines.map((l) => [l.id, l]));
    const audits: { lineId: string; employeeCode: string; diff: Record<string, unknown> }[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const p of due) {
        const line = lineById.get(p.lineId!)!;
        const m = p.month!;
        const hourly = line.payBasis === 'hourly';
        const was = savedInputs(line.inputs);
        const filled: Partial<PayrollInputs> = hourly
          ? { workedHours: hoursToMinutes(m.hoursCounted) }
          : { workedHours: hoursToMinutes(m.hoursCounted), noShowDays: m.absentDays, permissionHours: m.permissionHours };
        const inputs: PayrollInputs = { ...EMPTY_PAYROLL_INPUTS, ...was, ...filled };
        const fields = Object.keys(filled) as ImportedInput[];
        const mark: AttendanceImportMark = { source: 'zoho', importId, at: at.toISOString(), fields };
        await tx.payrollLine.update({
          where: { id: line.id },
          data: { inputs: json(inputs), attendanceImport: json(mark), ...worked(line.terms as unknown as PayrollTerms, inputs, rules, law) },
        });
        audits.push({ lineId: line.id, employeeCode: line.employeeCode, diff: { ...changes(was as unknown as Record<string, unknown>, inputs as unknown as Record<string, unknown>), source: 'zoho', importId } });

        // the days kept: that month's Zoho days replaced
        await tx.attendanceDay.deleteMany({ where: { employeeId: p.employee!.id, source: 'zoho', date: { gte: toDateOnly(firstDay(month)), lte: toDateOnly(lastDay(month)) } } });
        if (m.days.length) {
          await tx.attendanceDay.createMany({ data: m.days.map((d: AttendanceDayResult) => dayRow(p.employee!.id, d, importId, user.id, at)) });
        }

        // their Zoho ID remembered, for the next import to match them by it
        const stored = people.find((s) => s.key === p.key)!;
        if (stored.zohoId) {
          const holder = await tx.employee.findUnique({ where: { zohoPeopleId: stored.zohoId }, select: { id: true } });
          const own = await tx.employee.findUnique({ where: { id: p.employee!.id }, select: { zohoPeopleId: true } });
          if (!holder && !own?.zohoPeopleId) await tx.employee.update({ where: { id: p.employee!.id }, data: { zohoPeopleId: stored.zohoId } });
        }
        stored.applied = { at: at.toISOString(), by: user.id };
      }
      await tx.attendanceImport.update({ where: { id: imp.id }, data: { people: json(people), appliedAt: at, appliedById: user.id } });
    });
    for (const a of audits) {
      await this.audit.record({ userId: user.id, action: 'update', entityType: LINE, entityId: a.lineId, diff: { runId, month, employeeCode: a.employeeCode, ...a.diff } });
    }
    await this.audit.record({ userId: user.id, action: 'apply', entityType: IMPORT, entityId: importId, diff: { runId, month, lines: due.length } });
    return this.view(runId, importId, user);
  }

  // ---------- helpers ----------

  /** A run that is a draft, else 409 saying what can't be done (`what`). */
  private async draftRun(runId: string, what: string) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        month: true,
        status: true,
        rules: true,
        lawRates: true,
        lines: { select: { id: true, employeeId: true, employmentId: true, employeeCode: true, nameEn: true, payBasis: true, terms: true, inputs: true } },
      },
    });
    if (!run) throw new NotFoundException('Payroll not found.');
    if (run.status !== 'draft') throw new ConflictException(`The ${monthName(fromDateOnly(run.month).slice(0, 7))} payroll isn't a draft any more, so ${what}.`);
    return run;
  }

  private async row(runId: string, importId: string) {
    const imp = await this.prisma.attendanceImport.findUnique({ where: { id: importId }, include: { createdBy: { select: { id: true, email: true } } } });
    if (!imp || imp.runId !== runId) throw new NotFoundException(NOT_FOUND);
    return imp;
  }

  /** The review worked out: each person matched, their line and their month by the system's rules. */
  private async review(runId: string, importId: string, user: SessionUser) {
    const imp = await this.row(runId, importId);
    const run = await this.prisma.payrollRun.findUnique({
      where: { id: runId },
      select: { id: true, month: true, status: true, lines: { select: { id: true, employeeId: true, employmentId: true } } },
    });
    if (!run) throw new NotFoundException('Payroll not found.');
    const month = fromDateOnly(run.month).slice(0, 7);
    const people = imp.people as unknown as StoredPerson[];
    const files = imp.files as unknown as StoredFile[];
    const confidential: ConfidentialView = await this.confidential.view(user);

    // the employees a person may be: those employed in the month, and those remembered by a Zoho ID of the files
    const zohoIds = people.map((p) => p.zohoId).filter((id): id is string => !!id);
    const employees = await this.prisma.employee.findMany({
      where: { OR: [{ employments: { some: employedIn(month) } }, ...(zohoIds.length ? [{ zohoPeopleId: { in: zohoIds } }] : []), { id: { in: people.map((p) => p.pick).filter((id): id is string => !!id) } }] },
      select: { id: true, fullNameEn: true, employeeCode: true, zohoPeopleId: true },
    });
    const byId = new Map(employees.map((e) => [e.id, e]));
    const ref = (id: string): EmployeeRef | null => {
      const e = byId.get(id);
      return e ? { id: e.id, fullNameEn: e.fullNameEn, employeeCode: e.employeeCode } : null;
    };

    const resolved = people.map((p) => {
      if (p.skipped) return { p, match: 'skipped' as PersonMatch, employeeId: null as string | null, candidates: [] as { id: string; similarity: number }[] };
      if (p.pick) return { p, match: 'confirmed' as PersonMatch, employeeId: p.pick, candidates: [] };
      const m = matchPerson({ zohoId: p.zohoId, name: p.zohoName }, employees);
      return { p, match: m.kind as PersonMatch, employeeId: m.employeeId, candidates: m.candidates };
    });
    const matchedTimes = new Map<string, number>();
    for (const r of resolved) if (r.employeeId && isMatched(r.match)) matchedTimes.set(r.employeeId, (matchedTimes.get(r.employeeId) ?? 0) + 1);

    const lineOf = new Map(run.lines.map((l) => [l.employeeId, l]));
    const months = await this.months(
      month,
      resolved.filter((r) => r.employeeId && isMatched(r.match) && !confidential.hidden.has(r.employeeId)).map((r) => ({ employeeId: r.employeeId!, employmentId: lineOf.get(r.employeeId!)?.employmentId ?? null, days: r.p.days })),
    );
    const appliedBy = await userNames(
      this.prisma,
      (await this.prisma.user.findMany({ where: { id: { in: people.map((p) => p.applied?.by).filter((id): id is string => !!id) } }, select: { id: true, email: true } })),
    );

    let hidden = 0;
    const shown: AttendancePersonView[] = [];
    for (const r of resolved) {
      const employeeId = r.employeeId && isMatched(r.match) ? r.employeeId : null;
      if (employeeId && confidential.hidden.has(employeeId)) {
        hidden++;
        continue;
      }
      const line = employeeId ? lineOf.get(employeeId) : undefined;
      const isConfidential = employeeId ? confidential.all.has(employeeId) : false;
      shown.push({
        key: r.p.key,
        zohoId: r.p.zohoId,
        zohoName: r.p.zohoName,
        match: r.match,
        employee: employeeId ? ref(employeeId) : null,
        candidates: r.candidates.map((c) => ({ ...ref(c.id)!, similarity: c.similarity })).filter((c) => c.id && !confidential.hidden.has(c.id)),
        duplicate: employeeId ? (matchedTimes.get(employeeId) ?? 0) > 1 : false,
        lineId: line?.id ?? null,
        editable: !!line && run.status === 'draft' && changesPayrollLine(user, isConfidential),
        confidential: isConfidential,
        rows: r.p.days.length,
        month: employeeId ? (months.get(employeeId) ?? null) : null,
        applied: r.p.applied ? { at: r.p.applied.at, by: appliedBy.get(r.p.applied.by)?.name ?? null } : null,
      });
    }
    // the outside rows said with each person's month
    for (const v of shown) {
      const stored = people.find((p) => p.key === v.key)!;
      if (v.month && stored.outside) {
        v.month = { ...v.month, outside: stored.outside, warnings: [`${stored.outside} ${stored.outside === 1 ? 'day is' : 'days are'} of another month than this payroll's: left out.`, ...v.month.warnings] };
      }
    }
    const order: Record<PersonMatch, number> = { close: 0, none: 1, linked: 2, exact: 2, confirmed: 2, skipped: 3 };
    shown.sort((a, b) => order[a.match] - order[b.match] || a.zohoName.localeCompare(b.zohoName));
    const names = await userNames(this.prisma, [imp.createdBy]);
    const view: AttendanceImportView = {
      id: imp.id,
      runId,
      month,
      source: 'zoho',
      createdAt: imp.createdAt.toISOString(),
      createdBy: imp.createdBy ? (names.get(imp.createdBy.id)?.name ?? imp.createdBy.email) : null,
      appliedAt: imp.appliedAt?.toISOString() ?? null,
      files,
      people: shown,
      hidden: hidden ? { count: hidden, label: `${confidentialPeople(hidden)}: the CEO fills their lines` } : null,
      counts: {
        matched: shown.filter((p) => isMatched(p.match)).length,
        toConfirm: shown.filter((p) => p.match === 'close').length,
        notFound: shown.filter((p) => p.match === 'none').length,
        skipped: shown.filter((p) => p.match === 'skipped').length,
        notOnRun: shown.filter((p) => isMatched(p.match) && !p.lineId).length,
      },
      canApply: run.status === 'draft' && shown.some((p) => isMatched(p.match) && !p.duplicate && p.lineId && p.editable),
    };
    return { view, imp, people };
  }

  /**
   * Each matched person's month by the system's rules: their employment's shift and dates (the line's employment, else
   * the latest in the month), the month's holidays, their approved leave days, their approved permission hours, the
   * Leave Setup's allowance.
   */
  private async months(month: string, who: { employeeId: string; employmentId: string | null; days: ImportedDay[] }[]): Promise<Map<string, AttendanceMonthResult>> {
    const out = new Map<string, AttendanceMonthResult>();
    if (!who.length) return out;
    const [first, last] = [firstDay(month), lastDay(month)];
    const ids = who.map((w) => w.employeeId);
    const [employments, holidays, leave, permissions, setup] = await Promise.all([
      this.prisma.employment.findMany({
        where: { employeeId: { in: ids }, ...employedIn(month) },
        orderBy: { joinDate: 'desc' },
        select: { id: true, employeeId: true, joinDate: true, endDate: true, shift: { select: { startTime: true, endTime: true, hoursPerDay: true, workingDays: true } } },
      }),
      this.prisma.holiday.findMany({ where: { date: { gte: toDateOnly(first), lte: toDateOnly(last) } }, select: { date: true } }),
      this.prisma.leaveRequest.findMany({
        where: { employeeId: { in: ids }, status: 'approved', startDate: { lte: toDateOnly(last) }, endDate: { gte: toDateOnly(first) } },
        select: { employeeId: true, startDate: true, endDate: true },
      }),
      this.prisma.permissionRequest.groupBy({
        by: ['employeeId'],
        where: { employeeId: { in: ids }, status: 'approved', date: { gte: toDateOnly(first), lte: toDateOnly(last) } },
        _sum: { hours: true },
      }),
      this.prisma.leaveSettings.findUnique({ where: { id: 1 }, select: { permissionHoursPerMonth: true } }),
    ]);
    const holidayDays = holidays.map((h) => fromDateOnly(h.date));
    const allowance = setup?.permissionHoursPerMonth.toNumber() ?? PERMISSION_RULE_DEFAULTS.hoursPerMonth;
    for (const w of who) {
      const employment = employments.find((e) => e.id === w.employmentId) ?? employments.find((e) => e.employeeId === w.employeeId);
      if (!employment) continue;
      const leaveDays: string[] = [];
      for (const l of leave.filter((x) => x.employeeId === w.employeeId)) {
        for (let d = fromDateOnly(l.startDate); d <= fromDateOnly(l.endDate); d = addDays(d, 1)) if (d >= first && d <= last) leaveDays.push(d);
      }
      const s = employment.shift;
      out.set(
        w.employeeId,
        attendanceMonth({
          month,
          days: w.days,
          shift: s ? { startTime: fromTimeOfDay(s.startTime), endTime: fromTimeOfDay(s.endTime), hoursPerDay: s.hoursPerDay?.toNumber() ?? null, workingDays: s.workingDays } : null,
          holidays: holidayDays,
          leaveDays,
          employedFrom: fromDateOnly(employment.joinDate),
          employedTo: fromDateOnly(employment.endDate),
          systemPermissionHours: permissions.find((p) => p.employeeId === w.employeeId)?._sum.hours?.toNumber() ?? 0,
          permissionHoursPerMonth: allowance,
        }),
      );
    }
    return out;
  }
}

/** A day as AttendanceDay keeps it. */
function dayRow(employeeId: string, d: AttendanceDayResult, importId: string, userId: string, at: Date): Prisma.AttendanceDayCreateManyInput {
  return {
    employeeId,
    date: toDateOnly(d.date),
    checkIn: d.checkIn ? new Date(d.checkIn) : null,
    checkOut: d.checkOut ? new Date(d.checkOut) : null,
    status: d.status,
    zohoStatus: d.zohoStatus,
    place: d.place,
    permissionHours: d.permissionHours > 0 ? d.permissionHours : null,
    hoursCounted: Math.round(d.hoursCounted * 100) / 100,
    source: 'zoho',
    importId,
    importedById: userId,
    importedAt: at,
  };
}
