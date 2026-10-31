import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  attendanceMonth,
  changesPayrollLine,
  confidentialPeople,
  EMPTY_PAYROLL_INPUTS,
  figuresBefore,
  matchPerson,
  OFFICE_ADDRESS_DEFAULTS,
  PERMISSION_RULE_DEFAULTS,
  type AttendanceDayResult,
  type AttendanceImportMark,
  type AttendanceMonthResult,
  type ImportedDay,
  type ImportedInput,
  type LawRates,
  type MatchKind,
  type PayrollInputs,
  type PayrollRules,
  type PayrollStatus,
  type PayrollTerms,
} from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { addDays, fromDateOnly, toDateOnly } from '../common/date-only.js';
import { fromTimeOfDay } from '../common/time-of-day.js';
import { ConfidentialService, type ConfidentialView } from '../employees/confidential.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { employedIn, userNames } from '../payroll/adjustments/people.js';
import { json, savedInputs, worked } from '../payroll/line-work.js';
import { firstDay, lastDay, monthName } from '../payroll/months.js';
import { runLawRates } from '../payroll/views.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AttendanceDaysService } from './attendance-days.service.js';
import { AttendanceFillService } from './attendance-fill.service.js';
import type { AttendancePersonDto } from './attendance-imports.dto.js';
import { CorrectionDaysService } from './correction-days.service.js';
import { personKey, readZohoWorkbook, ZOHO_MAX_FILES, ZohoFileError, type ZohoRow } from './zoho-file.js';
import { withoutZohoRemovals, zohoRemovalsOf } from './record-removals.js';

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
  /** When it was undone on their line (Undo this import, owner, 19 October 2026), and by whom; left out until then. */
  undone?: { at: string; by: string } | null;
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
  /** Undone on their line since it was applied (owner, 19 October 2026), and by whom. */
  undone: { at: string; by: string | null } | null;
  /**
   * They check in on the system this month (19 October 2026): applying keeps their Zoho days (counted on the days before
   * their check-ins), and their line is filled from their attendance days instead of Zoho's month.
   */
  checksIn: boolean;
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
  /**
   * The run's lines filled from it that the caller fills (HR, a C-level person's the CEO), still marked from it: what
   * Undo this import puts back (owner, 19 October 2026: "imported data shouldn't be editable"); 0 on a run that isn't a
   * draft.
   */
  undoable: number;
  /**
   * What is still on the run from it, whoever fills the lines (asked, 21 October 2026: "how to delete previous imports"):
   * the lines still marked from it and the days kept from it. Anything there: a Super Admin's Delete undoes it first.
   */
  kept: ImportKept;
}

/** The run's lines still filled from an import (marked from it, the C-level people's too) and the days kept from it. */
export interface ImportKept {
  lines: number;
  days: number;
}

/** What deleting an import did: its month, whether it was undone first, the lines put back and the days removed. */
export interface AttendanceImportDeleted {
  id: string;
  runId: string;
  month: string;
  undone: boolean;
  lines: number;
  days: number;
}

/** An import as the Attendance section's Imports lists it. */
export interface AttendanceImportHistoryRow {
  id: string;
  runId: string;
  month: string;
  runStatus: PayrollStatus;
  createdAt: string;
  createdBy: string | null;
  files: { name: string; rows: number; people: number }[];
  people: number;
  counts: { matched: number; toConfirm: number; notFound: number; skipped: number };
  appliedAt: string | null;
  appliedBy: string | null;
  /** Undone (Undo this import) and not applied since: when, last. */
  undoneAt: string | null;
  /** What is still on its run from it (21 October 2026): a Super Admin's Delete undoes it first when anything is. */
  kept: ImportKept;
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
// C-level people HR may not see are one row of the review, without their figures. A Super Admin deletes an import on a
// draft run (asked, 21 October 2026: "how to delete previous imports"), undoing it first when it is applied (remove).
@Injectable()
export class AttendanceImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly attendanceDays: AttendanceDaysService,
    private readonly fill: AttendanceFillService,
    private readonly correctionDays: CorrectionDaysService,
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

  /**
   * Every import across the runs, the latest first (owner's brief, 19 October 2026: the Attendance section's Imports),
   * of one month or all: its month and run (with where the run stands), its files, how many people of them are matched
   * (the C-level ones with them, without saying who), to confirm, not found and skipped, as the review counts them now,
   * and whether it is applied, by whom and when, or undone. HR, the CEO and Finance.
   */
  async history(month: string | null | undefined): Promise<AttendanceImportHistoryRow[]> {
    const rows = await this.prisma.attendanceImport.findMany({
      where: month ? { month: toDateOnly(firstDay(month)) } : {},
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        runId: true,
        month: true,
        files: true,
        people: true,
        createdAt: true,
        appliedAt: true,
        run: { select: { status: true } },
        createdBy: { select: { id: true, email: true } },
        appliedBy: { select: { id: true, email: true } },
      },
    });
    const names = await userNames(this.prisma, rows.flatMap((r) => [r.createdBy, r.appliedBy]));
    const kept = await this.keptOf(rows);
    // the employees a person of the files may be, by month, as the review takes them
    const candidates = new Map<string, { id: string; fullNameEn: string; zohoPeopleId: string | null }[]>();
    for (const m of new Set(rows.map((r) => fromDateOnly(r.month).slice(0, 7)))) {
      const people = rows.filter((r) => fromDateOnly(r.month).startsWith(m)).flatMap((r) => r.people as unknown as StoredPerson[]);
      const zohoIds = [...new Set(people.map((p) => p.zohoId).filter((id): id is string => !!id))];
      candidates.set(
        m,
        await this.prisma.employee.findMany({
          where: { OR: [{ employments: { some: employedIn(m) } }, ...(zohoIds.length ? [{ zohoPeopleId: { in: zohoIds } }] : [])] },
          select: { id: true, fullNameEn: true, zohoPeopleId: true },
        }),
      );
    }
    return rows.map((r) => {
      const m = fromDateOnly(r.month).slice(0, 7);
      const people = r.people as unknown as StoredPerson[];
      const counts = { matched: 0, toConfirm: 0, notFound: 0, skipped: 0 };
      for (const p of people) {
        if (p.skipped) counts.skipped++;
        else if (p.pick) counts.matched++;
        else {
          const kind = matchPerson({ zohoId: p.zohoId, name: p.zohoName }, candidates.get(m) ?? []).kind;
          if (kind === 'close') counts.toConfirm++;
          else if (kind === 'none') counts.notFound++;
          else counts.matched++;
        }
      }
      const undone = people.map((p) => p.undone).filter((u): u is { at: string; by: string } => !!u);
      return {
        id: r.id,
        runId: r.runId,
        month: m,
        runStatus: r.run.status as PayrollStatus,
        createdAt: r.createdAt.toISOString(),
        createdBy: r.createdBy ? (names.get(r.createdBy.id)?.name ?? r.createdBy.email) : null,
        files: (r.files as unknown as StoredFile[]).map((f) => ({ name: f.name, rows: f.rows, people: f.people })),
        people: people.length,
        counts,
        appliedAt: r.appliedAt?.toISOString() ?? null,
        appliedBy: r.appliedBy ? (names.get(r.appliedBy.id)?.name ?? r.appliedBy.email) : null,
        undoneAt: !r.appliedAt && undone.length ? undone.map((u) => u.at).sort().at(-1)! : null,
        kept: kept.get(r.id) ?? { lines: 0, days: 0 },
      };
    });
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
    // those who check in on the system this month (19 October 2026): their Zoho days kept, their line filled from the
    // month's attendance days afterwards
    const checkIn = new Set(due.filter((p) => p.checksIn).map((p) => p.employee!.id));

    await this.prisma.$transaction(async (tx) => {
      for (const p of due) {
        const line = lineById.get(p.lineId!)!;
        const m = p.month!;
        if (checkIn.has(p.employee!.id)) {
          await tx.attendanceDay.deleteMany({ where: { employeeId: p.employee!.id, source: 'zoho', date: { gte: toDateOnly(firstDay(month)), lte: toDateOnly(lastDay(month)) } } });
          if (m.days.length) await tx.attendanceDay.createMany({ data: m.days.map((d: AttendanceDayResult) => dayRow(p.employee!.id, d, importId, user.id, at)) });
          const stored = people.find((s) => s.key === p.key)!;
          stored.applied = { at: at.toISOString(), by: user.id };
          stored.undone = null;
          continue;
        }
        const hourly = line.payBasis === 'hourly';
        const was = savedInputs(line.inputs);
        const filled: Partial<PayrollInputs> = hourly
          ? { workedHours: hoursToMinutes(m.hoursCounted) }
          : { workedHours: hoursToMinutes(m.hoursCounted), noShowDays: m.absentDays, permissionHours: m.permissionHours };
        const inputs: PayrollInputs = { ...EMPTY_PAYROLL_INPUTS, ...was, ...filled };
        const fields = Object.keys(filled) as ImportedInput[];
        // what they were before, for Undo this import (owner, 19 October 2026): HR's figures, not an earlier import's
        const earlier = line.attendanceImport as unknown as AttendanceImportMark | null;
        const mark: AttendanceImportMark = { source: 'zoho', importId, at: at.toISOString(), fields, before: figuresBefore(fields, was, earlier) };
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
        stored.undone = null;
      }
      await tx.attendanceImport.update({ where: { id: imp.id }, data: { people: json(people), appliedAt: at, appliedById: user.id } });
    });
    for (const a of audits) {
      await this.audit.record({ userId: user.id, action: 'update', entityType: LINE, entityId: a.lineId, diff: { runId, month, employeeCode: a.employeeCode, ...a.diff } });
    }
    await this.audit.record({ userId: user.id, action: 'apply', entityType: IMPORT, entityId: importId, diff: { runId, month, lines: due.length, ...(checkIn.size && { fromAttendance: checkIn.size }) } });
    // a day corrected over one of Zoho's (19 October 2026) is made again over the day imported now, and the lines of
    // those whose month has a corrected day or check-ins take their attendance days
    const applied = due.map((p) => p.employee!.id);
    await this.correctionDays.rebuildMonth(applied, month, user);
    await this.fill.fillRun(runId, user, applied);
    return this.view(runId, importId, user);
  }


  /**
   * Undo this import (owner, 19 October 2026: "imported data shouldn't be editable": to change what it filled, HR imports
   * the month again or undoes it): the run's lines filled from it that the caller fills (HR, a C-level person's the CEO)
   * get back what they had before it was applied (HR's figures; those of an earlier import, and from a mark without them,
   * empty), no longer marked; the days it kept for those people go; the people are no longer applied, nor the import
   * once no line is filled from it. A draft run only; every line and the import in the audit log.
   */
  async undo(runId: string, importId: string, user: SessionUser): Promise<AttendanceImportView> {
    const run = await this.draftRun(runId, "its attendance import can't be undone");
    const imp = await this.row(runId, importId);
    const confidential = await this.confidential.view(user);
    const due = undoableLines(run.lines, importId, user, confidential);
    // those who check in on the system, whose line is filled from the attendance days with this import's days in them
    // (19 October 2026): their days go, and their line takes the days left
    const viaAttendance = await this.filledFromAttendance(run.lines, importId, user, confidential);
    if (!due.length && !viaAttendance.length) throw new ConflictException('Nothing on this payroll is filled from this import for you to undo.');
    const month = fromDateOnly(run.month).slice(0, 7);
    const rules = run.rules as unknown as PayrollRules;
    const law = runLawRates(run);
    const at = new Date();
    const people = imp.people as unknown as StoredPerson[];
    const employees = new Set([...due, ...viaAttendance].map((l) => l.employeeId));
    const audits: { lineId: string; employeeCode: string; diff: Record<string, unknown> }[] = [];
    let days = 0;
    // the people of the files whose lines are put back: no longer applied
    const { view } = await this.review(runId, importId, user);
    const undoneKeys = new Set(view.people.filter((p) => p.employee && employees.has(p.employee.id)).map((p) => p.key));

    await this.prisma.$transaction(async (tx) => {
      for (const line of due) audits.push(await putBack(tx, line, importId, rules, law));
      days = (await tx.attendanceDay.deleteMany({ where: { importId, employeeId: { in: [...employees] } } })).count;
      for (const p of people) {
        if (!undoneKeys.has(p.key) || !p.applied) continue;
        p.applied = null;
        p.undone = { at: at.toISOString(), by: user.id };
      }
      // applied while any line of the run (anyone's) is still filled from it, or anyone's days are still its own
      const stillApplied =
        run.lines.some((l) => (l.attendanceImport as unknown as AttendanceImportMark | null)?.importId === importId && !due.includes(l)) ||
        (await tx.attendanceDay.count({ where: { importId } })) > 0;
      await tx.attendanceImport.update({
        where: { id: imp.id },
        data: { people: json(people), ...(!stillApplied && { appliedAt: null, appliedById: null }) },
      });
    });
    for (const a of audits) {
      await this.audit.record({ userId: user.id, action: 'update', entityType: LINE, entityId: a.lineId, diff: { runId, month, employeeCode: a.employeeCode, ...a.diff } });
    }
    await this.audit.record({ userId: user.id, action: 'undo', entityType: IMPORT, entityId: importId, diff: { runId, month, lines: due.length + viaAttendance.length, days } });
    // a corrected day is made again without this import's day under it, and a line filled from the attendance days
    // takes them as they are without this import's (19 October 2026)
    await this.correctionDays.rebuildMonth([...employees], month, user);
    await this.fill.fillRun(runId, user, [...employees]);
    return this.view(runId, importId, user);
  }

  /**
   * Deletes an import (asked, 21 October 2026: "how to delete previous imports"; a Super Admin only, like every deletion:
   * owner's decision, 15 October 2026), on a draft run, as Undo is. Not applied (no line of the run filled from it, no day
   * kept from it): the import goes, with the files and people it read. Applied: refused (409) unless `undo` (Undo and
   * delete): then, in one transaction, every line of the run filled from it is put back as Undo this import puts it back
   * and every day kept from it goes, for everyone at once, since a Super Admin acts for all (Undo itself is by the
   * caller: undoableLines). The C-level people's lines too, which the CEO fills (owner, 19 October 2026): a Super Admin
   * sees C-level people, and those lines get back the CEO's own figures from before the import (its mark's `before`),
   * so no one's figures are typed over. Then, as after Undo, the corrected days over its days are made again, and the
   * lines filled from the attendance days take the days left. One delete entry in the audit log (the month, the files,
   * their rows, whether it was undone first), and each line put back.
   */
  async remove(runId: string, importId: string, undo: boolean, user: SessionUser): Promise<AttendanceImportDeleted> {
    assertDeletes(user);
    const imp = await this.row(runId, importId);
    const run = await this.draftRun(runId, "its attendance import can't be deleted");
    const month = fromDateOnly(run.month).slice(0, 7);
    // every line still marked from it, whoever fills it, and everyone with days kept from it
    const filled = linesFilledFrom(run.lines, importId);
    const dayCounts = await this.prisma.attendanceDay.groupBy({ by: ['employeeId'], where: { importId }, _count: { _all: true } });
    const kept: ImportKept = { lines: filled.length, days: dayCounts.reduce((n, d) => n + d._count._all, 0) };
    const applied = kept.lines > 0 || kept.days > 0;
    if (applied && !undo) throw new ConflictException(`The ${monthName(month)} import is applied: ${keptText(kept)}. Undo it first, or undo and delete it.`);

    const files = imp.files as unknown as StoredFile[];
    const rules = run.rules as unknown as PayrollRules;
    const law = runLawRates(run);
    const dayPeople = new Set(dayCounts.map((d) => d.employeeId));
    const employees = [...new Set([...filled.map((l) => l.employeeId), ...dayPeople])];
    // those whose line is filled from the attendance days with its days in them (19 October 2026): filled again after
    const viaAttendance = run.lines.filter((l) => (l.attendanceImport as unknown as AttendanceImportMark | null)?.source === 'attendance' && dayPeople.has(l.employeeId));
    const audits: { lineId: string; employeeCode: string; diff: Record<string, unknown> }[] = [];
    let days = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const line of filled) audits.push(await putBack(tx, line, importId, rules, law));
      days = (await tx.attendanceDay.deleteMany({ where: { importId } })).count;
      await tx.attendanceImport.delete({ where: { id: importId } });
    });
    for (const a of audits) {
      await this.audit.record({ userId: user.id, action: 'update', entityType: LINE, entityId: a.lineId, diff: { runId, month, employeeCode: a.employeeCode, ...a.diff } });
    }
    const lines = filled.length + viaAttendance.length;
    await this.audit.record({
      userId: user.id,
      action: 'delete',
      entityType: IMPORT,
      entityId: importId,
      diff: {
        runId,
        month,
        files: files.map((f) => f.name),
        rows: files.reduce((n, f) => n + f.rows, 0),
        people: (imp.people as unknown as StoredPerson[]).length,
        undone: applied,
        ...(applied && { lines, days }),
      },
    });
    if (applied) {
      await this.correctionDays.rebuildMonth(employees, month, user);
      await this.fill.fillRun(runId, user, employees);
    }
    return { id: importId, runId, month, undone: applied, lines, days };
  }

  // ---------- helpers ----------

  /** What is still on the runs from these imports: the lines marked from each (anyone's) and the days kept from each. */
  private async keptOf(imports: readonly { id: string; runId: string }[]): Promise<Map<string, ImportKept>> {
    const out = new Map(imports.map((i) => [i.id, { lines: 0, days: 0 }]));
    if (!imports.length) return out;
    const [lines, days] = await Promise.all([
      this.prisma.payrollLine.findMany({
        where: { runId: { in: [...new Set(imports.map((i) => i.runId))] }, attendanceImport: { path: ['source'], equals: 'zoho' } },
        select: { attendanceImport: true },
      }),
      this.prisma.attendanceDay.groupBy({ by: ['importId'], where: { importId: { in: imports.map((i) => i.id) } }, _count: { _all: true } }),
    ]);
    for (const l of lines) {
      const kept = out.get((l.attendanceImport as unknown as AttendanceImportMark).importId ?? '');
      if (kept) kept.lines++;
    }
    for (const d of days) {
      const kept = d.importId ? out.get(d.importId) : undefined;
      if (kept) kept.days = d._count._all;
    }
    return out;
  }

  /**
   * The run's lines filled from the attendance days (19 October 2026: someone who checks in on the system) whose month
   * has days kept from this import, that the caller fills; none hidden from them.
   */
  private async filledFromAttendance<L extends { employeeId: string; attendanceImport: Prisma.JsonValue | null }>(
    lines: readonly L[],
    importId: string,
    user: SessionUser,
    confidential: ConfidentialView,
  ): Promise<L[]> {
    const marked = lines.filter((l) => (l.attendanceImport as unknown as AttendanceImportMark | null)?.source === 'attendance');
    if (!marked.length) return [];
    const kept = await this.prisma.attendanceDay.findMany({ where: { importId, employeeId: { in: marked.map((l) => l.employeeId) } }, distinct: ['employeeId'], select: { employeeId: true } });
    const ids = new Set(kept.map((k) => k.employeeId));
    return marked.filter((l) => ids.has(l.employeeId) && !confidential.hidden.has(l.employeeId) && changesPayrollLine(user, confidential.all.has(l.employeeId)));
  }

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
        lines: { select: { id: true, employeeId: true, employmentId: true, employeeCode: true, nameEn: true, payBasis: true, terms: true, inputs: true, attendanceImport: true } },
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
      select: { id: true, month: true, status: true, lines: { select: { id: true, employeeId: true, employmentId: true, attendanceImport: true } } },
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
    // those who check in on the system this month (19 October 2026): their line is filled from their attendance days
    const matchedIds = [...new Set(resolved.filter((r) => r.employeeId && isMatched(r.match)).map((r) => r.employeeId!))];
    const own = await this.attendanceDays.monthOf(month, matchedIds);
    // the Zoho records a Super Admin removed stay removed (owner, 31 October 2026: "Stays removed")
    const removals = await zohoRemovalsOf(this.prisma, matchedIds, firstDay(month), lastDay(month));
    const months = await this.months(
      month,
      resolved
        .filter((r) => r.employeeId && isMatched(r.match) && !confidential.hidden.has(r.employeeId))
        .map((r) => ({
          employeeId: r.employeeId!,
          employmentId: lineOf.get(r.employeeId!)?.employmentId ?? null,
          days: withoutZohoRemovals(r.employeeId!, r.p.days.map((day) => ({ day, openAt: null })), removals).map((d) => d.day),
        })),
    );
    const appliedBy = await userNames(
      this.prisma,
      await this.prisma.user.findMany({
        where: { id: { in: people.flatMap((p) => [p.applied?.by, p.undone?.by]).filter((id): id is string => !!id) } },
        select: { id: true, email: true },
      }),
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
        undone: r.p.undone ? { at: r.p.undone.at, by: appliedBy.get(r.p.undone.by)?.name ?? null } : null,
        checksIn: employeeId ? (own.get(employeeId)?.sources.some((x) => x === 'system' || x === 'device') ?? false) : false,
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
      undoable: run.status === 'draft' ? undoableLines(run.lines, importId, user, confidential).length + (await this.filledFromAttendance(run.lines, importId, user, confidential)).length : 0,
      kept: { lines: linesFilledFrom(run.lines, importId).length, days: await this.prisma.attendanceDay.count({ where: { importId } }) },
    };
    return { view, imp, people };
  }

  /**
   * Each matched person's month by the system's rules: their employment's shift and dates (the line's employment, else
   * the latest in the month), the month's holidays, their approved leave days, their approved permission hours, the
   * Leave Setup's allowance. Public for Zoho People's fetch (25 October 2026: "the same path the import uses"), whose
   * days are worked out the same way.
   */
  async months(month: string, who: { employeeId: string; employmentId: string | null; days: ImportedDay[] }[]): Promise<Map<string, AttendanceMonthResult>> {
    const out = new Map<string, AttendanceMonthResult>();
    if (!who.length) return out;
    const [first, last] = [firstDay(month), lastDay(month)];
    const ids = who.map((w) => w.employeeId);
    const [employments, holidays, leave, permissions, setup] = await Promise.all([
      this.prisma.employment.findMany({
        where: { employeeId: { in: ids }, ...employedIn(month) },
        orderBy: { joinDate: 'desc' },
        select: {
          id: true,
          employeeId: true,
          joinDate: true,
          endDate: true,
          shift: { select: { startTime: true, endTime: true, hoursPerDay: true, graceMinutes: true, countUntil: true, workingDays: true } },
        },
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
          // the window's end moved by the shift's grace minutes (owner, 19 October 2026: "if the employee checked in
          // 10:15 he can check out till 7:15 and the 9 hours are counted"), or the time it counts hours until (owner, 20
          // October 2026: "no working hours to be counted after 8 PM even if the check out was 11 PM")
          shift: s
            ? {
                startTime: fromTimeOfDay(s.startTime),
                endTime: fromTimeOfDay(s.endTime),
                hoursPerDay: s.hoursPerDay?.toNumber() ?? null,
                graceMinutes: s.graceMinutes,
                countUntil: s.countUntil ? fromTimeOfDay(s.countUntil) : null,
                workingDays: s.workingDays,
              }
            : null,
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

/**
 * The run's lines filled from an import, still marked from it, that the caller fills (HR, a C-level person's the CEO, or
 * HR with Super Admin: changesPayrollLine); none hidden from them.
 */
function undoableLines<L extends { employeeId: string; attendanceImport: Prisma.JsonValue | null }>(lines: readonly L[], importId: string, user: SessionUser, confidential: ConfidentialView): L[] {
  return linesFilledFrom(lines, importId).filter((l) => !confidential.hidden.has(l.employeeId) && changesPayrollLine(user, confidential.all.has(l.employeeId)));
}

/** The run's lines filled from an import, still marked from it, whoever fills them (the C-level people's too). */
function linesFilledFrom<L extends { attendanceImport: Prisma.JsonValue | null }>(lines: readonly L[], importId: string): L[] {
  return lines.filter((l) => (l.attendanceImport as unknown as AttendanceImportMark | null)?.importId === importId);
}

/** A line filled from an import, as it is put back. */
interface FilledLine {
  id: string;
  employeeCode: string;
  terms: Prisma.JsonValue;
  inputs: Prisma.JsonValue;
  attendanceImport: Prisma.JsonValue | null;
}

/**
 * Puts a line filled from an import back, as Undo this import does (owner, 19 October 2026: "imported data shouldn't be
 * editable"): the inputs it filled get back what they had before it was applied (HR's figures; those of an earlier
 * import, and from a mark without them, empty), no longer marked, and the line is worked out again. Answers its audit
 * entry, written once the transaction is done.
 */
async function putBack(tx: Prisma.TransactionClient, line: FilledLine, importId: string, rules: PayrollRules, law: LawRates) {
  const mark = line.attendanceImport as unknown as AttendanceImportMark;
  const was = savedInputs(line.inputs);
  const back = Object.fromEntries(mark.fields.map((f) => [f, mark.before?.[f] ?? null])) as Partial<PayrollInputs>;
  const inputs: PayrollInputs = { ...EMPTY_PAYROLL_INPUTS, ...was, ...back };
  await tx.payrollLine.update({
    where: { id: line.id },
    data: { inputs: json(inputs), attendanceImport: Prisma.DbNull, ...worked(line.terms as unknown as PayrollTerms, inputs, rules, law) },
  });
  return {
    lineId: line.id,
    employeeCode: line.employeeCode,
    diff: { ...changes(was as unknown as Record<string, unknown>, inputs as unknown as Record<string, unknown>), source: 'zoho', importId, undone: true } as Record<string, unknown>,
  };
}

/** "2 lines of the payroll are filled from it and 14 days of attendance are kept from it", the counts of none left out. */
function keptText(kept: ImportKept): string {
  const parts = [
    kept.lines ? `${kept.lines} ${kept.lines === 1 ? 'line of the payroll is' : 'lines of the payroll are'} filled from it` : null,
    kept.days ? `${kept.days} ${kept.days === 1 ? 'day of attendance is' : 'days of attendance are'} kept from it` : null,
  ].filter(Boolean);
  return parts.join(' and ');
}
