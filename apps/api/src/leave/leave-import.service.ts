import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ALREADY_AT_BALANCE,
  alreadyImportedText,
  alreadyInSystemText,
  alreadyWfhText,
  isTemplateWfhType,
  annualAvailable,
  belowZeroText,
  confidentialPeople,
  daysMismatchText,
  DEFAULT_WORKING_DAYS,
  defaultZohoType,
  firstLeaveStatus,
  headingKey,
  holidaysHint,
  importedLeaveFindings,
  importedLeaveReason,
  importPersonKey,
  importsLeaveFor,
  LEAVE_IMPORT_ROW_STATUSES,
  LEAVE_IMPORT_SOURCE_LABELS,
  LEAVE_STATUS_LABELS,
  leaveDaysBetween,
  leaveImportKey,
  matchImportPerson,
  matchNeedsConfirming,
  monthsOf,
  notInPayrollText,
  noShowsToLeaveText,
  rowNoShowsText,
  type AttendanceImportMark,
  openingAdjustment,
  openingBalanceReason,
  overlapsRowText,
  overlapsSystemText,
  balanceRowProblems,
  sameFileText,
  sameRowText,
  serviceMonths,
  takesFromAnnual,
  underLabourLaw,
  unpaidInDraftText,
  WFH_IMPORT_MAX_SPAN,
  wfhFileHalfDayText,
  wfhHalfDaysText,
  wfhNameIsLeaveTypeText,
  wfhInFileText,
  wfhLeftOutText,
  wfhLinkKey,
  wfhOutsideEmploymentText,
  ZOHO_PENDING_NOTE,
  ZOHO_WFH_PENDING_NOTE,
  ZOHO_WFH_TARGET,
  ZOHO_WFH_TARGET_LABEL,
  zohoDayDifferences,
  zohoDayDifferencesText,
  zohoNotImportedText,
  zohoTypeTarget,
  zohoWfhDays,
  type ApproverRole,
  type ImportMatchKind,
  type LeaveGender,
  type LeaveImportRowStatus,
  type LeaveImportSource,
  type LeaveStatus,
  type ZohoApproval,
} from '@trendlix/shared';
import { AttendanceDaysService } from '../attendance/attendance-days.service.js';
import { AuditService } from '../audit/audit.service.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, shownDate, todayInCairo, toDateOnly } from '../common/date-only.js';
import { Prisma, type LeaveType } from '../generated/prisma/client.js';
import { NoticesService } from '../notifications/notices.service.js';
import { approverFor } from '../organisation/departments/leads.js';
import { userNames } from '../payroll/adjustments/people.js';
import { json } from '../payroll/line-work.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WFH_ENTITY } from '../wfh/wfh-views.js';
import { WfhService, type WfhHistoryResult } from '../wfh/wfh.service.js';
import { noLeaveMessage, type Caller } from './access.js';
import { readLeaveFile, LeaveImportFileError, CHOOSE_LEAVE_FILE, type ReadBalanceRow, type ReadLeaveRow } from './leave-import-file.js';
import { LEAVE_IMPORT_TEMPLATE_NAME, leaveImportTemplate } from './leave-import-template.js';
import type { LeaveImportPersonDto, LeaveImportTypeDto } from './leave-import.dto.js';
import { LeaveBalancesService, TAKING, type LeaveEmployment, type YearFigures } from './leave-balances.service.js';
import { LeavePayrollService } from './leave-payroll.service.js';
import { LeaveRequestsService } from './leave-requests.service.js';
import { recordLeaveStep } from './steps.js';
import { ADJUSTMENT_ENTITY, REQUEST_ENTITY, rulesOf } from './views.js';

export const IMPORT_ENTITY = 'leave_import';
const NOT_FOUND = 'Leave import not found.';

/** What a row became once applied: the leave, balance change or work-from-home days it made, when and by whom. */
interface AppliedMark {
  at: string;
  by: string;
  leaveId?: string;
  adjustmentId?: string;
  days?: number;
  /**
   * A Working from home row's days (owner, 21 October 2026: "Yes, as approved WFH days"): the requests made, their days,
   * and what bringing them over said.
   */
  wfhIds?: string[];
  wfhDays?: string[];
  warnings?: string[];
}

type StoredLeaveRow = ReadLeaveRow & { personKey: string; applied?: AppliedMark | null };
type StoredBalanceRow = ReadBalanceRow & { personKey: string; applied?: AppliedMark | null };
type StoredRow = StoredLeaveRow | StoredBalanceRow;

/** A person of the file as the import keeps them: as the file names them, and HR's choice. */
interface StoredPerson {
  key: string;
  code: string | null;
  name: string;
  zohoId: string | null;
  hint: string | null;
  /** The employee HR picked or confirmed; null: matched by code or name (or not at all). */
  pick: string | null;
  skipped: boolean;
}

/** A Zoho file's leave types as HR mapped them: the system's type id, ZOHO_WFH_TARGET (work-from-home days), or "skip". */
type TypeMap = Record<string, string>;

interface EmployeeRef {
  id: string;
  fullNameEn: string;
  employeeCode: string;
}

/** How a person of the file was matched, as the review shows it: by HR's choice too, or skipped. */
export type ImportPersonMatch = ImportMatchKind | 'confirmed' | 'skipped';

export interface LeaveImportPersonView {
  key: string;
  code: string | null;
  name: string;
  zohoId: string | null;
  /** A number Zoho's Employee ID holds that doesn't end it: shown as a hint, not matched by. */
  hint: string | null;
  rows: number;
  match: ImportPersonMatch;
  /** For HR to say who it is first: a name to confirm, or not found. */
  toConfirm: boolean;
  employee: EmployeeRef | null;
  candidates: (EmployeeRef & { similarity: number })[];
  confidential: boolean;
}

export interface LeaveImportTypeView {
  zohoType: string;
  rows: number;
  /** The system's type the rows are imported as; null: skipped, or work-from-home days. */
  typeId: string | null;
  /** Its rows are imported as work-from-home days (owner, 21 October 2026: "Yes, as approved WFH days"). */
  wfh: boolean;
  /** HR chose it (else it is the default). */
  chosen: boolean;
  defaultTypeId: string | null;
  defaultWfh: boolean;
  /** Why the default is what it is (Working from home as work-from-home days; Compensatory Off has no type yet). */
  note: string | null;
}

export interface LeaveImportRowView {
  sheet: 'leaves' | 'balances';
  row: number;
  status: LeaveImportRowStatus;
  /** Why it is a problem, a duplicate, waiting or not imported. */
  reasons: string[];
  /** Said, not blocking: the days counted otherwise, the type's limits, the balance below 0. */
  warnings: string[];
  /** What applying it does beyond the leave: the payroll it is (or isn't) counted in, a pending request. */
  notes: string[];
  personKey: string;
  nameInFile: string;
  code: string | null;
  employee: EmployeeRef | null;
  confidential: boolean;
  typeText: string;
  type: { id: string; nameEn: string } | null;
  from: string | null;
  to: string | null;
  fromText: string;
  toText: string;
  /** The days the system counts (leave rows). */
  days: number | null;
  fileDays: number | null;
  halfDay: boolean;
  /** Zoho's Pending: imported as a request being decided. */
  pending: boolean;
  /** Imported as work-from-home days, not leave (a Zoho type mapped so): its type is null. */
  wfh: boolean;
  /** A work-from-home row's days: those it makes (each working day, a holiday or weekend left out), or made. */
  wfhDays: string[] | null;
  approval: ZohoApproval | null;
  approvalText: string | null;
  balance: number | null;
  asOf: string | null;
  /** What applying the balance adds or takes (balance rows). */
  adjustment: number | null;
  applied: { at: string } | null;
  /** Whether the caller applies it: HR, a C-level person's the CEO, never their own. */
  yours: boolean;
  notYours: string | null;
}

export interface LeaveImportView {
  id: string;
  fileName: string;
  source: LeaveImportSource;
  sourceLabel: string;
  createdAt: string;
  createdBy: string | null;
  appliedAt: string | null;
  appliedBy: string | null;
  undoneAt: string | null;
  undoneBy: string | null;
  /** The same file imported before and still applied: every row is a duplicate. */
  sameFile: string | null;
  /** The same file uploaded before, not applied. */
  uploadedBefore: string | null;
  people: LeaveImportPersonView[];
  types: LeaveImportTypeView[];
  leaves: LeaveImportRowView[];
  balances: LeaveImportRowView[];
  counts: Record<LeaveImportRowStatus, number> & { pending: number; hidden: number };
  /** The C-level people's rows hidden from the caller: the CEO imports theirs. */
  hidden: { rows: number; label: string } | null;
  /** The file counts days as holidays the system counts as working days: check the year's holidays first. */
  holidaysHint: string | null;
  /** The no-shows on a draft payroll the file's leave turns into leave once applied (21 October 2026). */
  noShowsToLeave: { days: number; people: number; text: string } | null;
  /** Whom a person of the file may be chosen as: the employees the caller sees, by name. */
  options: EmployeeRef[];
  /** The leave types a Zoho type may be imported as: those on, the law's and HR's own. */
  typeOptions: { id: string; nameEn: string; kind: string; balance: string }[];
  canApply: boolean;
  /** The leave, balance changes and work-from-home days it made that the caller may undo. */
  undoable: number;
  /** What it made that is still there, whoever's: a Super Admin deletes it only when none is. */
  kept: Kept;
}

/** What an import made that is still in the system: its leave, balance changes and work-from-home days. */
export interface Kept {
  leaves: number;
  adjustments: number;
  wfhDays: number;
}

export interface LeaveImportHistoryRow {
  id: string;
  fileName: string;
  source: LeaveImportSource;
  sourceLabel: string;
  createdAt: string;
  createdBy: string | null;
  rows: { leaves: number; balances: number };
  kept: Kept;
  appliedAt: string | null;
  appliedBy: string | null;
  undoneAt: string | null;
  undoneBy: string | null;
  state: 'not_applied' | 'applied' | 'undone';
}

/** A leave row worked out for the review and for Apply. */
interface ResolvedLeave {
  stored: StoredLeaveRow;
  view: LeaveImportRowView;
  employeeId: string | null;
  employment: LeaveEmployment | null;
  type: LeaveType | null;
  hidden: boolean;
  /** A work-from-home row, and the days it makes (none: nothing to make). */
  wfh: boolean;
  wfhDays: string[];
}

interface ResolvedBalance {
  stored: StoredBalanceRow;
  view: LeaveImportRowView;
  employeeId: string | null;
  employment: LeaveEmployment | null;
  year: number | null;
  hidden: boolean;
}

const tenth = (n: number) => Math.round(n * 10) / 10 + 0;
const statusWords = (status: string) => {
  const label = LEAVE_STATUS_LABELS[status as LeaveStatus] ?? status;
  return label[0].toLowerCase() + label.slice(1);
};
/** The type a template row names: by its English or Arabic name, or its key, whatever the case. */
const typeNamed = (types: readonly LeaveType[], text: string) => {
  const k = headingKey(text);
  return k ? (types.find((t) => headingKey(t.nameEn) === k) ?? types.find((t) => headingKey(t.nameAr) === k) ?? types.find((t) => headingKey(t.key) === k) ?? null) : null;
};

// Importing leave in bulk (owner, 21 October 2026: "how to import bulk leaves?"; asked, he chose "Both": the leave already
// taken, recorded as approved, and each person's current balance; and "Our Excel template"). HR downloads the template
// (the leave types on as a list, the employees' codes HR may see), fills it and uploads it; Zoho People's leave export is
// read as it is (the owner's sample, 21 October 2026: its leave types mapped once each, Working from home skipped as no
// leave, Compensatory Off skipped unless a type is added for it; its approved leave imported approved, its pending leave
// as requests in the system's approval, its rejected and cancelled leave listed, not imported). The upload is kept and
// reviewed: each person matched (by code, else by name as the attendance import matches, for HR to confirm), each row
// ready, a problem with its reasons, a duplicate, waiting for its person, or not imported, with the warnings that don't
// block history (the days counted otherwise, the type's limits, the balance below 0). Apply, in one transaction: the
// leave made approved and marked imported (no steps, no notifications; the documents rule waived, as history), then each
// balance set with an adjustment, the figure less what the system has left as of its day. No duplicates (owner, 21
// October 2026: "while importing make sure there will be no duplicates from the previous imported files"): a Zoho row's
// link id is once only, the same person, type and days as a leave in the system is a duplicate, the same file again is
// said, and a balance at its figure changes nothing. A month whose payroll is no longer a draft isn't changed: its rows
// say they are counted in no payroll; a draft takes the leave as recorded leave (leave-payroll.service.ts). Undo removes
// what it made while no payroll that counts it is past its draft; a Super Admin deletes an import with nothing left of
// it. A C-level person's rows (owner, 19 October 2026: "make C level Employees details not visible to HR") are hidden
// from HR, one line on the review, and imported by the CEO. Every upload, choice, apply, undo and delete is in the audit
// log, each leave and balance change too.
@Injectable()
export class LeaveImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly balances: LeaveBalancesService,
    private readonly payroll: LeavePayrollService,
    private readonly requests: LeaveRequestsService,
    private readonly notices: NoticesService,
    private readonly attendanceDays: AttendanceDaysService,
    private readonly wfh: WfhService,
  ) {}

  // ---------- the template ----------

  /** The template: the leave types on, the annual balance's type, and the current employees the caller may see. */
  async template(user: SessionUser): Promise<{ data: Buffer; fileName: string }> {
    const caller = await this.requests.caller(user);
    const today = todayInCairo();
    const [types, people] = await Promise.all([
      this.prisma.leaveType.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }] }),
      this.prisma.employee.findMany({
        where: { employments: { some: { joinDate: { lte: toDateOnly(today) }, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(today) } }] } } },
        orderBy: { fullNameEn: 'asc' },
        select: { id: true, employeeCode: true, fullNameEn: true },
      }),
    ]);
    const shown = (t: LeaveType) => ({ nameEn: t.nameEn, balance: t.balance, paid: t.paid, payPercent: t.payPercent?.toNumber() ?? null, calendarDays: t.calendarDays });
    const data = await leaveImportTemplate({
      types: types.map(shown),
      balanceTypes: types.filter((t) => t.balance === 'annual').map(shown),
      // a C-level person isn't listed to HR (owner, 19 October 2026)
      people: people.filter((p) => !caller.confidential?.hidden.has(p.id)),
      year: Number(today.slice(0, 4)),
    });
    return { data, fileName: LEAVE_IMPORT_TEMPLATE_NAME };
  }

  // ---------- upload, history, review ----------

  /** Reads the file and keeps it, with its rows and people, for the review: nothing applied. */
  async upload(file: Express.Multer.File | undefined, user: SessionUser): Promise<LeaveImportView> {
    if (!file?.buffer?.length) throw new BadRequestException([CHOOSE_LEAVE_FILE]);
    let reading;
    try {
      reading = await readLeaveFile(file.buffer);
    } catch (err) {
      if (err instanceof LeaveImportFileError) throw new BadRequestException([err.message]);
      throw err;
    }
    const people = new Map<string, StoredPerson>();
    const keyOf = (r: { code: string | null; name: string; zohoId?: string | null; zohoHint?: string | null }) => {
      const person = { code: r.code, name: r.name, zohoId: r.zohoId ?? null };
      const key = importPersonKey(person);
      if (!people.has(key)) people.set(key, { key, ...person, hint: r.zohoHint ?? null, pick: null, skipped: false });
      return key;
    };
    const rows: StoredRow[] = [
      ...reading.leaves.map((r) => ({ ...r, personKey: keyOf(r), applied: null })),
      ...reading.balances.map((r) => ({ ...r, personKey: keyOf(r), applied: null })),
    ];
    const fileName = (file.originalname || 'Leave import.xlsx').slice(0, 200);
    const made = await this.prisma.leaveImport.create({
      data: {
        fileName,
        fileHash: createHash('sha256').update(file.buffer).digest('hex'),
        fileData: new Uint8Array(file.buffer),
        source: reading.source,
        rows: json(rows),
        people: json([...people.values()]),
        createdById: user.id,
      },
      select: { id: true },
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: IMPORT_ENTITY,
      entityId: made.id,
      diff: { fileName, source: reading.source, leaves: reading.leaves.length, balances: reading.balances.length, people: people.size },
    });
    return this.view(made.id, user);
  }

  /** Every import, the latest first: its file, who and when, its rows, what it made that is still there, applied or undone. */
  async history(): Promise<LeaveImportHistoryRow[]> {
    const rows = await this.prisma.leaveImport.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fileName: true,
        source: true,
        rows: true,
        createdAt: true,
        appliedAt: true,
        undoneAt: true,
        createdBy: { select: { id: true, email: true } },
        appliedBy: { select: { id: true, email: true } },
        undoneBy: { select: { id: true, email: true } },
        _count: { select: { leaves: true, adjustments: true, wfhDays: true } },
      },
    });
    const names = await userNames(this.prisma, rows.flatMap((r) => [r.createdBy, r.appliedBy, r.undoneBy]));
    const nameOf = (u: { id: string; email: string } | null) => (u ? (names.get(u.id)?.name ?? u.email) : null);
    return rows.map((r) => {
      const stored = r.rows as unknown as StoredRow[];
      const kept = { leaves: r._count.leaves, adjustments: r._count.adjustments, wfhDays: r._count.wfhDays };
      const source = r.source as LeaveImportSource;
      return {
        id: r.id,
        fileName: r.fileName,
        source,
        sourceLabel: LEAVE_IMPORT_SOURCE_LABELS[source] ?? source,
        createdAt: r.createdAt.toISOString(),
        createdBy: nameOf(r.createdBy),
        rows: { leaves: stored.filter((s) => s.sheet === 'leaves').length, balances: stored.filter((s) => s.sheet === 'balances').length },
        kept,
        appliedAt: r.appliedAt?.toISOString() ?? null,
        appliedBy: nameOf(r.appliedBy),
        undoneAt: r.undoneAt?.toISOString() ?? null,
        undoneBy: nameOf(r.undoneBy),
        state: kept.leaves + kept.adjustments + kept.wfhDays > 0 ? 'applied' : r.undoneAt ? 'undone' : 'not_applied',
      };
    });
  }

  async view(id: string, user: SessionUser): Promise<LeaveImportView> {
    return (await this.evaluate(id, user)).view;
  }

  /** HR's choice for a person of the file: the employee they are, back to the match (null), or skipped. */
  async choosePerson(id: string, dto: LeaveImportPersonDto, user: SessionUser): Promise<LeaveImportView> {
    const imp = await this.row(id);
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
        const caller = await this.requests.caller(user);
        const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId }, select: { id: true } });
        if (!employee || caller.confidential?.hidden.has(dto.employeeId)) throw new BadRequestException(['Employee not found. Choose the employee from the list.']);
        person.pick = dto.employeeId;
      } else person.pick = null;
    }
    if (before.pick !== person.pick || before.skipped !== person.skipped) {
      await this.prisma.leaveImport.update({ where: { id }, data: { people: json(people) } });
      await this.audit.record({
        userId: user.id,
        action: 'update',
        entityType: IMPORT_ENTITY,
        entityId: id,
        diff: { person: person.code ?? person.zohoId ?? person.name, pick: { from: before.pick, to: person.pick }, skipped: { from: before.skipped, to: person.skipped } },
      });
    }
    return this.view(id, user);
  }

  /**
   * A Zoho leave type's mapping: the system's type it is imported as, work-from-home days (owner, 21 October 2026: "Yes,
   * as approved WFH days"), skipped, or back to the default.
   */
  async mapType(id: string, dto: LeaveImportTypeDto, user: SessionUser): Promise<LeaveImportView> {
    const imp = await this.row(id);
    if (imp.source !== 'zoho') throw new ConflictException('Only a Zoho People export has leave types to map: the template names the system’s own.');
    const rows = imp.rows as unknown as StoredRow[];
    if (!rows.some((r) => r.sheet === 'leaves' && r.typeText === dto.zohoType)) throw new NotFoundException('This leave type is not in the file. Reload the page and try again.');
    const map = { ...(imp.typeMap as unknown as TypeMap) };
    const before = map[dto.zohoType] ?? null;
    if (dto.skipped === true) map[dto.zohoType] = 'skip';
    else if (dto.wfh === true) map[dto.zohoType] = ZOHO_WFH_TARGET;
    else if (dto.typeId) {
      const type = await this.prisma.leaveType.findUnique({ where: { id: dto.typeId }, select: { id: true, active: true, nameEn: true } });
      if (!type) throw new BadRequestException(['Choose a leave type from the list.']);
      if (!type.active) throw new BadRequestException([`${type.nameEn} is turned off in Leave Setup: turn it on first, or choose another type.`]);
      map[dto.zohoType] = type.id;
    } else delete map[dto.zohoType];
    const after = map[dto.zohoType] ?? null;
    if (before !== after) {
      await this.prisma.leaveImport.update({ where: { id }, data: { typeMap: json(map) } });
      await this.audit.record({ userId: user.id, action: 'update', entityType: IMPORT_ENTITY, entityId: id, diff: { zohoType: dto.zohoType, typeId: { from: before, to: after } } });
    }
    return this.view(id, user);
  }

  // ---------- apply, undo, delete ----------

  /**
   * Applies the rows ready that are the caller's (HR's, a C-level person's the CEO's, never their own), in one
   * transaction: the leave first (approved and marked imported; Zoho's pending as requests at their first step), then the
   * work-from-home days (WfhService.recordHistory in this transaction: owner, 21 October 2026, "Yes, as approved WFH
   * days"; Zoho's pending as requests), then each balance set to its figure as of its day. Then the draft payrolls of
   * their months take the leave, and the pending requests are sent to their deciders.
   */
  async apply(id: string, user: SessionUser): Promise<LeaveImportView> {
    const { imp, leaves, balances } = await this.evaluate(id, user);
    const due = leaves.filter((l) => l.view.status === 'ready' && l.view.yours && !l.hidden);
    const dueLeaves = due.filter((l) => !l.wfh);
    const dueWfh = due.filter((l) => l.wfh && l.wfhDays.length > 0);
    const dueBalances = balances.filter((b) => b.view.status === 'ready' && b.view.yours && !b.hidden);
    if (!dueLeaves.length && !dueWfh.length && !dueBalances.length) throw new ConflictException('Nothing in this import is ready for you to apply: put right the rows with problems, or say who the people waiting are, first.');
    const by = (await userNames(this.prisma, [{ id: user.id, email: user.email }])).get(user.id)?.name ?? user.email;
    // the pending ones' deciders, as an employee's request has them (owner, 19 October 2026: the direct manager, else the
    // team lead, else the department's head)
    const approvers = new Map<ResolvedLeave, { employeeId: string; role: ApproverRole } | null>();
    for (const l of dueLeaves.filter((x) => x.view.pending)) {
      approvers.set(l, await approverFor(this.prisma, { employeeId: l.employeeId!, managerId: l.employment!.managerId, departmentId: l.employment!.departmentId }));
    }
    const at = new Date();
    const stamp = { at: at.toISOString(), by: user.id };
    const made: { leaveId: string; l: ResolvedLeave; status: LeaveStatus }[] = [];
    const set: { adjustmentId: string; b: ResolvedBalance; days: number }[] = [];
    let wfhMade: WfhHistoryResult = { recorded: [], skipped: [] };
    const marks = (rows: unknown) => (rows as StoredRow[]).map((r) => r.applied?.leaveId ?? r.applied?.adjustmentId ?? r.applied?.wfhIds?.join('+') ?? '').join(',');
    const rowsBefore = marks(imp.rows);

    try {
      await this.prisma.$transaction(async (tx) => {
        // one apply at a time, and only of the rows as reviewed
        const locked = await tx.$queryRaw<{ rows: unknown }[]>`SELECT rows FROM leave_imports WHERE id = ${id}::uuid FOR UPDATE`;
        if (!locked.length || marks(locked[0].rows) !== rowsBefore) throw new ConflictException('This import was applied or changed meanwhile. Reload the page to see where it stands.');
        const rows = imp.rows as unknown as StoredRow[];
        for (const l of [...dueLeaves].sort((a, b) => a.view.from!.localeCompare(b.view.from!))) {
          const employeeId = l.employeeId!;
          const from = l.view.from!;
          const to = l.view.to!;
          await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
          const overlap = await tx.leaveRequest.findFirst({
            where: { employeeId, status: { in: [...TAKING] }, startDate: { lte: toDateOnly(to) }, endDate: { gte: toDateOnly(from) } },
            select: { id: true },
          });
          if (overlap) throw new ConflictException(`Row ${l.view.row}: leave on these days was recorded meanwhile. Reload the page to see it.`);
          if (takesFromAnnual(l.type!.balance) && (await tx.leaveYearClosing.findUnique({ where: { year: Number(from.slice(0, 4)) } }))) {
            throw new ConflictException(`${from.slice(0, 4)}'s annual leave was closed meanwhile. Reload the page to see it.`);
          }
          const approver = approvers.get(l) ?? null;
          const status: LeaveStatus = l.view.pending ? firstLeaveStatus(approver !== null) : 'approved';
          const leave = await tx.leaveRequest.create({
            data: {
              employeeId,
              employmentId: l.employment!.id,
              typeId: l.type!.id,
              startDate: toDateOnly(from),
              endDate: toDateOnly(to),
              halfDay: l.view.halfDay,
              days: l.view.days!,
              reason: importedLeaveReason(imp.fileName, by, l.stored.notes),
              status,
              managerId: l.view.pending ? (approver?.employeeId ?? null) : null,
              approverRole: l.view.pending ? (approver?.role ?? null) : null,
              // history recorded by HR (owner's brief, 21 October 2026: "no approval steps or notifications"); a pending
              // one goes on as a request sent
              recordedByHr: !l.view.pending,
              createdById: user.id,
              importId: id,
              zohoLinkId: l.stored.linkId,
            },
            select: { id: true },
          });
          if (l.view.pending) {
            await recordLeaveStep(tx, leave.id, user.id, { kind: 'submitted', comment: `Imported from ${imp.fileName}: pending in Zoho People.` });
            if (!approver) await recordLeaveStep(tx, leave.id, null, { kind: 'no_manager' });
          }
          made.push({ leaveId: leave.id, l, status });
          const stored = rows.find((r) => r.sheet === 'leaves' && r.row === l.stored.row)!;
          stored.applied = { ...stamp, leaveId: leave.id };
        }
        // the work-from-home days, in this transaction (all or nothing with the leave): each approved, Zoho's pending a
        // request at its first step, the import kept on each (Undo removes them) and its link id with the day, once only
        if (dueWfh.length) {
          wfhMade = await this.wfh.recordHistory(
            dueWfh.flatMap((l) =>
              l.wfhDays.map((date) => ({
                employeeId: l.employeeId!,
                date,
                reason: importedLeaveReason(imp.fileName, by, l.stored.notes),
                pending: l.view.pending,
                zohoLinkId: l.stored.linkId ? wfhLinkKey(l.stored.linkId, date) : null,
              })),
            ),
            { userId: user.id },
            { tx, importId: id, comment: `Imported from ${imp.fileName}` },
          );
          for (const l of dueWfh) {
            const mine = wfhMade.recorded.filter((x) => x.employeeId === l.employeeId && l.wfhDays.includes(x.date));
            if (!mine.length) continue;
            const stored = rows.find((r) => r.sheet === 'leaves' && r.row === l.stored.row)!;
            stored.applied = { ...stamp, wfhIds: mine.map((x) => x.id), wfhDays: mine.map((x) => x.date), warnings: [...new Set(mine.flatMap((x) => x.warnings))] };
          }
        }
        // each balance after the leave (owner's brief, 21 October 2026), in the order of its day: the figure less what the
        // system has left as of that day
        const ordered = [...dueBalances].sort((a, b) => a.employment!.id.localeCompare(b.employment!.id) || a.view.asOf!.localeCompare(b.view.asOf!));
        for (const b of ordered) {
          const year = b.year!;
          if (await tx.leaveYearClosing.findUnique({ where: { year } })) throw new ConflictException(`${year}'s leave was closed meanwhile. Reload the page to see it.`);
          const f = (await this.balances.yearFigures([{ employment: b.employment!, year }], b.view.asOf!, tx)).get(`${b.employment!.id}:${year}`)!;
          const days = openingAdjustment(b.view.balance!, remainingOf(f));
          if (days === 0) continue;
          const adjustment = await tx.leaveAdjustment.create({
            data: { employeeId: b.employeeId!, employmentId: b.employment!.id, year, days, reason: openingBalanceReason(imp.fileName), createdById: user.id, importId: id },
            select: { id: true },
          });
          set.push({ adjustmentId: adjustment.id, b, days });
          const stored = rows.find((r) => r.sheet === 'balances' && r.row === b.stored.row)!;
          stored.applied = { ...stamp, adjustmentId: adjustment.id, days };
        }
        await tx.leaveImport.update({ where: { id }, data: { rows: json(rows), appliedAt: at, appliedById: user.id, undoneAt: null, undoneById: null } });
        // a large file's rows, the work-from-home days with them, take longer than the 5 seconds a transaction has by default
      }, { maxWait: 10_000, timeout: 120_000 });
    } catch (err) {
      // a Zoho row's link id imported meanwhile by another apply
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException('A row of this file was imported meanwhile. Reload the page to see it.');
      throw err;
    }

    await this.audit.record({
      userId: user.id,
      action: 'import',
      entityType: IMPORT_ENTITY,
      entityId: id,
      diff: {
        fileName: imp.fileName,
        source: imp.source,
        leaves: made.filter((m) => m.status === 'approved').length,
        pending: made.filter((m) => m.status !== 'approved').length,
        days: tenth(made.reduce((n, m) => n + m.l.view.days!, 0)),
        balances: set.length,
        ...(wfhMade.recorded.length && {
          wfhDays: wfhMade.recorded.filter((w) => w.status === 'approved').length,
          wfhPending: wfhMade.recorded.filter((w) => w.status !== 'approved').length,
        }),
      },
    });
    // each work-from-home day in the audit log, and the pending ones sent to their deciders, once committed
    await this.wfh.historyRecorded(wfhMade, { userId: user.id }, { importId: id });
    for (const m of made) {
      await this.audit.record({
        userId: user.id,
        action: 'import',
        entityType: REQUEST_ENTITY,
        entityId: m.leaveId,
        diff: {
          employeeId: m.l.employeeId,
          typeId: m.l.type!.id,
          type: m.l.type!.nameEn,
          startDate: m.l.view.from,
          endDate: m.l.view.to,
          halfDay: m.l.view.halfDay,
          days: m.l.view.days,
          status: m.status,
          importId: id,
          row: m.l.view.row,
          ...(m.l.stored.linkId && { zohoLinkId: m.l.stored.linkId }),
        },
      });
    }
    for (const s of set) {
      await this.audit.record({
        userId: user.id,
        action: 'import',
        entityType: ADJUSTMENT_ENTITY,
        entityId: s.adjustmentId,
        diff: { employeeId: s.b.employeeId, employmentId: s.b.employment!.id, year: s.b.year, days: s.days, balance: s.b.view.balance, asOf: s.b.view.asOf, reason: openingBalanceReason(imp.fileName), importId: id },
      });
    }
    // the draft payrolls of their months take the approved leave as recorded leave does; those past their draft don't change
    await this.syncPayroll(made.filter((m) => m.status === 'approved').map((m) => ({ employeeId: m.l.employeeId!, from: m.l.view.from!, to: m.l.view.to! })), user);
    // the pending ones, to the one in charge of their first step, as a request sent
    for (const m of made.filter((x) => x.status !== 'approved')) await this.notices.leave(m.leaveId, 'sent');
    return this.view(id, user);
  }

  /**
   * Undo (owner's brief, 21 October 2026): removes the leave, the balance changes and the work-from-home days the import
   * made that the caller imports (HR, a C-level person's the CEO), while no payroll that counts its leave is past its
   * draft (409 with the months) and no year of them is closed. Its rows are free again: the same leave and days can be
   * imported later.
   */
  async undo(id: string, user: SessionUser): Promise<LeaveImportView> {
    const imp = await this.row(id);
    const caller = await this.requests.caller(user);
    const [leaves, adjustments, wfhDays] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { importId: id },
        select: { id: true, employeeId: true, employmentId: true, startDate: true, endDate: true, status: true, createdAt: true, type: { select: { balance: true, nameEn: true } } },
      }),
      this.prisma.leaveAdjustment.findMany({ where: { importId: id }, select: { id: true, employeeId: true, employmentId: true, year: true, days: true } }),
      this.prisma.wfhRequest.findMany({ where: { importId: id }, select: { id: true, employeeId: true, date: true, status: true, zohoLinkId: true } }),
    ]);
    const theirs = (employeeId: string) => mayImportFor(caller, employeeId);
    const myLeaves = leaves.filter((l) => theirs(l.employeeId));
    const myAdjustments = adjustments.filter((a) => theirs(a.employeeId));
    // a work-from-home day has no balance nor pay (owner, 21 October 2026): removed whatever the payroll
    const myWfh = wfhDays.filter((w) => theirs(w.employeeId));
    if (!myLeaves.length && !myAdjustments.length && !myWfh.length) throw new ConflictException('Nothing this import made is left for you to undo.');

    // a payroll past its draft that counts a leave: made or sent on after the leave was imported (one already approved
    // then counted it in no payroll)
    const months = [...new Set(myLeaves.filter((l) => l.status === 'approved').flatMap((l) => monthsOf(fromDateOnly(l.startDate), fromDateOnly(l.endDate))))];
    const runs = months.length
      ? await this.prisma.payrollRun.findMany({ where: { month: { in: months.map((m) => toDateOnly(`${m}-01`)) }, status: { not: 'draft' } }, select: { month: true, submittedAt: true } })
      : [];
    const counted = runs.filter((r) => {
      const month = fromDateOnly(r.month).slice(0, 7);
      return myLeaves.some(
        (l) => l.status === 'approved' && monthsOf(fromDateOnly(l.startDate), fromDateOnly(l.endDate)).includes(month) && (!r.submittedAt || r.submittedAt > l.createdAt),
      );
    });
    if (counted.length) {
      const names = counted.map((r) => fromDateOnly(r.month).slice(0, 7)).sort().map((m) => monthWords(m));
      throw new ConflictException(
        `This import can't be undone: its leave is counted in the ${names.join(', ')} payroll${names.length === 1 ? ', which isn’t a draft any more' : 's, which aren’t drafts any more'}.`,
      );
    }
    const years = [...new Set([...myLeaves.filter((l) => takesFromAnnual(l.type.balance)).map((l) => l.startDate.getUTCFullYear()), ...myAdjustments.map((a) => a.year)])];
    const closed = years.length ? await this.prisma.leaveYearClosing.findMany({ where: { year: { in: years } }, select: { year: true } }) : [];
    if (closed.length) {
      const list = closed.map((c) => c.year).sort((x, y) => x - y);
      throw new ConflictException(`${list.join(' and ')}'s annual leave ${list.length === 1 ? 'is' : 'are'} closed, so this import can't be undone. Reopen the Year Closing first.`);
    }
    const paidOnLeaving = await this.prisma.leaveBalanceYear.findFirst({
      where: { closedOn: 'leaving', OR: [...myLeaves.filter((l) => takesFromAnnual(l.type.balance)).map((l) => ({ employmentId: l.employmentId, year: l.startDate.getUTCFullYear() })), ...myAdjustments.map((a) => ({ employmentId: a.employmentId, year: a.year }))] },
      select: { year: true, employee: { select: { fullNameEn: true } } },
    });
    if (paidOnLeaving) {
      throw new ConflictException(`${paidOnLeaving.employee.fullNameEn}'s ${paidOnLeaving.year} leave was paid on leaving, so this import can't be undone.`);
    }

    const at = new Date();
    const leaveIds = new Set(myLeaves.map((l) => l.id));
    const adjustmentIds = new Set(myAdjustments.map((a) => a.id));
    const wfhIds = new Set(myWfh.map((w) => w.id));
    let left = 0;
    await this.prisma.$transaction(async (tx) => {
      await tx.leaveRequest.deleteMany({ where: { id: { in: [...leaveIds] }, importId: id } });
      await tx.leaveAdjustment.deleteMany({ where: { id: { in: [...adjustmentIds] }, importId: id } });
      await tx.wfhRequest.deleteMany({ where: { id: { in: [...wfhIds] }, importId: id } });
      const rows = imp.rows as unknown as StoredRow[];
      for (const r of rows) {
        if (
          r.applied &&
          ((r.applied.leaveId && leaveIds.has(r.applied.leaveId)) || (r.applied.adjustmentId && adjustmentIds.has(r.applied.adjustmentId)) || r.applied.wfhIds?.some((w) => wfhIds.has(w)))
        ) {
          r.applied = null;
        }
      }
      left =
        (await tx.leaveRequest.count({ where: { importId: id } })) + (await tx.leaveAdjustment.count({ where: { importId: id } })) + (await tx.wfhRequest.count({ where: { importId: id } }));
      await tx.leaveImport.update({ where: { id }, data: { rows: json(rows), ...(left === 0 && { undoneAt: at, undoneById: user.id }) } });
    });
    await this.audit.record({
      userId: user.id,
      action: 'undo',
      entityType: IMPORT_ENTITY,
      entityId: id,
      diff: { fileName: imp.fileName, leaves: myLeaves.length, balances: myAdjustments.length, ...(myWfh.length && { wfhDays: myWfh.length }), ...(left > 0 && { left }) },
    });
    for (const l of myLeaves) {
      await this.audit.record({ userId: user.id, action: 'delete', entityType: REQUEST_ENTITY, entityId: l.id, diff: { employeeId: l.employeeId, type: l.type.nameEn, startDate: fromDateOnly(l.startDate), endDate: fromDateOnly(l.endDate), status: l.status, importId: id, undone: true } });
    }
    for (const a of myAdjustments) {
      await this.audit.record({ userId: user.id, action: 'delete', entityType: ADJUSTMENT_ENTITY, entityId: a.id, diff: { employeeId: a.employeeId, year: a.year, days: a.days.toNumber(), importId: id, undone: true } });
    }
    for (const w of myWfh) {
      await this.audit.record({
        userId: user.id,
        action: 'delete',
        entityType: WFH_ENTITY,
        entityId: w.id,
        diff: { employeeId: w.employeeId, date: fromDateOnly(w.date), status: w.status, importId: id, ...(w.zohoLinkId && { zohoLinkId: w.zohoLinkId }), undone: true },
      });
    }
    await this.syncPayroll(myLeaves.filter((l) => l.status === 'approved').map((l) => ({ employeeId: l.employeeId, from: fromDateOnly(l.startDate), to: fromDateOnly(l.endDate) })), user);
    return this.view(id, user);
  }

  /**
   * Deletes an import with its file (a Super Admin only, like every deletion: owner's decision, 15 October 2026): one not
   * applied, or applied and undone; one with leave, balance changes or work-from-home days still from it is refused,
   * "Undo it first".
   */
  async remove(id: string, user: SessionUser): Promise<void> {
    assertDeletes(user);
    const imp = await this.prisma.leaveImport.findUnique({
      where: { id },
      select: { id: true, fileName: true, source: true, rows: true, _count: { select: { leaves: true, adjustments: true, wfhDays: true } } },
    });
    if (!imp) throw new NotFoundException(NOT_FOUND);
    const { leaves, adjustments, wfhDays } = imp._count;
    if (leaves + adjustments + wfhDays > 0) {
      const what = listed([
        leaves ? `${leaves} ${leaves === 1 ? 'leave' : 'leaves'}` : null,
        adjustments ? `${adjustments} balance ${adjustments === 1 ? 'change' : 'changes'}` : null,
        wfhDays ? `${wfhDays} work-from-home ${wfhDays === 1 ? 'day' : 'days'}` : null,
      ]);
      throw new ConflictException(`${what} from this import ${leaves + adjustments + wfhDays === 1 ? 'is' : 'are'} still in the system. Undo it first, then delete it.`);
    }
    await this.prisma.leaveImport.delete({ where: { id } });
    const rows = imp.rows as unknown as StoredRow[];
    await this.audit.record({
      userId: user.id,
      action: 'delete',
      entityType: IMPORT_ENTITY,
      entityId: id,
      diff: { fileName: imp.fileName, source: imp.source, leaves: rows.filter((r) => r.sheet === 'leaves').length, balances: rows.filter((r) => r.sheet === 'balances').length },
    });
  }

  // ---------- the review worked out ----------

  private async row(id: string) {
    const imp = await this.prisma.leaveImport.findUnique({
      where: { id },
      select: {
        id: true,
        fileName: true,
        fileHash: true,
        source: true,
        rows: true,
        people: true,
        typeMap: true,
        createdAt: true,
        appliedAt: true,
        undoneAt: true,
        createdBy: { select: { id: true, email: true } },
        appliedBy: { select: { id: true, email: true } },
        undoneBy: { select: { id: true, email: true } },
      },
    });
    if (!imp) throw new NotFoundException(NOT_FOUND);
    return imp;
  }

  /** The review: each person matched, each row's status with its reasons, warnings and notes, and what the caller may do. */
  private async evaluate(id: string, user: SessionUser) {
    const imp = await this.row(id);
    const caller = await this.requests.caller(user);
    const hiddenSet = caller.confidential?.hidden ?? new Set<string>();
    const confidentialSet = caller.confidential?.all ?? new Set<string>();
    const source = imp.source as LeaveImportSource;
    const today = todayInCairo();
    const currentYear = Number(today.slice(0, 4));
    const stored = imp.rows as unknown as StoredRow[];
    const storedLeaves = stored.filter((r): r is StoredLeaveRow => r.sheet === 'leaves');
    const storedBalances = stored.filter((r): r is StoredBalanceRow => r.sheet === 'balances');
    const storedPeople = imp.people as unknown as StoredPerson[];
    const typeMap = imp.typeMap as unknown as TypeMap;

    const [types, employees] = await Promise.all([
      this.prisma.leaveType.findMany({ orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }] }),
      this.prisma.employee.findMany({ where: { employments: { some: {} } }, orderBy: { fullNameEn: 'asc' }, select: { id: true, fullNameEn: true, employeeCode: true, zohoPeopleId: true, gender: true } }),
    ]);
    const typeById = new Map(types.map((t) => [t.id, t]));
    const employeeById = new Map(employees.map((e) => [e.id, e]));
    const ref = (eid: string): EmployeeRef | null => {
      const e = employeeById.get(eid);
      return e ? { id: e.id, fullNameEn: e.fullNameEn, employeeCode: e.employeeCode } : null;
    };
    const annualType = types.find((t) => t.balance === 'annual') ?? null;

    // ---- the people ----
    const resolvedPeople = new Map<string, { view: LeaveImportPersonView; employeeId: string | null }>();
    for (const p of storedPeople) {
      let match: ImportPersonMatch;
      let employeeId: string | null = null;
      let candidates: { id: string; similarity: number }[] = [];
      if (p.skipped) match = 'skipped';
      else if (p.pick && employeeById.has(p.pick)) {
        match = 'confirmed';
        employeeId = p.pick;
      } else {
        const m = matchImportPerson({ code: p.code, name: p.name, zohoId: p.zohoId }, employees);
        match = m.kind;
        candidates = m.candidates;
        if (m.employeeId && !matchNeedsConfirming(m.kind, source)) employeeId = m.employeeId;
      }
      const toConfirm = match === 'close' || match === 'none' || (match === 'exact' && employeeId === null);
      resolvedPeople.set(p.key, {
        employeeId,
        view: {
          key: p.key,
          code: p.code,
          name: p.name,
          zohoId: p.zohoId,
          hint: p.hint,
          rows: stored.filter((r) => r.personKey === p.key).length,
          match,
          toConfirm,
          employee: employeeId ? ref(employeeId) : null,
          candidates: candidates.filter((c) => !hiddenSet.has(c.id)).map((c) => ({ ...ref(c.id)!, similarity: c.similarity })),
          confidential: employeeId ? confidentialSet.has(employeeId) : false,
        },
      });
    }

    const matchedIds = [...new Set([...resolvedPeople.values()].map((p) => p.employeeId).filter((x): x is string => !!x))];
    const datesOf = storedLeaves.flatMap((r) => [r.from, r.to]).filter((d): d is string => !!d);
    const minDate = datesOf.length ? datesOf.reduce((a, b) => (a < b ? a : b)) : today;
    const maxDate = datesOf.length ? datesOf.reduce((a, b) => (a > b ? a : b)) : today;
    const linkIds = storedLeaves.map((r) => r.linkId).filter((x): x is string => !!x);

    const [employments, holidays, existing, linked, permissions, closings, sameHash] = await Promise.all([
      this.balances.employmentsOfPeople(matchedIds),
      this.prisma.holiday.findMany({ where: { date: { gte: toDateOnly(minDate), lte: toDateOnly(maxDate) } }, select: { date: true } }),
      matchedIds.length
        ? this.prisma.leaveRequest.findMany({
            where: { employeeId: { in: matchedIds }, status: { in: [...TAKING] } },
            select: { id: true, employeeId: true, typeId: true, startDate: true, endDate: true, days: true, status: true, importId: true, zohoLinkId: true, type: { select: { nameEn: true } } },
          })
        : Promise.resolve([]),
      linkIds.length
        ? this.prisma.leaveRequest.findMany({ where: { zohoLinkId: { in: linkIds } }, select: { id: true, zohoLinkId: true, importId: true, status: true, type: { select: { nameEn: true } } } })
        : Promise.resolve([]),
      matchedIds.length
        ? this.prisma.permissionRequest.findMany({
            where: { employeeId: { in: matchedIds }, status: { in: [...TAKING] }, date: { gte: toDateOnly(minDate), lte: toDateOnly(maxDate) } },
            select: { employeeId: true, date: true },
          })
        : Promise.resolve([]),
      this.prisma.leaveYearClosing.findMany({ select: { year: true } }),
      this.prisma.leaveImport.findMany({
        where: { fileHash: imp.fileHash, id: { not: id }, createdAt: { lt: imp.createdAt } },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          createdAt: true,
          appliedAt: true,
          createdBy: { select: { id: true, email: true } },
          appliedBy: { select: { id: true, email: true } },
          _count: { select: { leaves: true, adjustments: true, wfhDays: true } },
        },
      }),
    ]);
    const holidaySet = new Set(holidays.map((h) => fromDateOnly(h.date)));
    const closedYears = new Set(closings.map((c) => c.year));
    const ownLeaveRows = await this.prisma.leaveRequest.findMany({ where: { importId: id }, select: { id: true, employeeId: true, startDate: true, endDate: true, days: true, halfDay: true, type: { select: { id: true, nameEn: true } } } });
    const ownLeaves = new Map(ownLeaveRows.map((l) => [l.id, l]));
    const ownAdjustments = new Set((await this.prisma.leaveAdjustment.findMany({ where: { importId: id }, select: { id: true } })).map((a) => a.id));
    const ownWfh = new Map(
      (await this.prisma.wfhRequest.findMany({ where: { importId: id }, select: { id: true, employeeId: true, date: true } })).map((w) => [w.id, { employeeId: w.employeeId, date: fromDateOnly(w.date) }]),
    );
    // the imports the system's leave came from, for "Already imported from <file>, <date>"
    const sourceIds = [...new Set([...existing, ...linked].map((l) => l.importId).filter((x): x is string => !!x))];
    const sources = new Map(
      (sourceIds.length ? await this.prisma.leaveImport.findMany({ where: { id: { in: sourceIds } }, select: { id: true, fileName: true, appliedAt: true, createdAt: true } }) : []).map((s) => [
        s.id,
        alreadyImportedText(s.fileName, (s.appliedAt ?? s.createdAt).toISOString()),
      ]),
    );
    const userRefs = await userNames(this.prisma, [imp.createdBy, imp.appliedBy, imp.undoneBy, ...sameHash.flatMap((s) => [s.createdBy, s.appliedBy])]);
    const nameOf = (u: { id: string; email: string } | null) => (u ? (userRefs.get(u.id)?.name ?? u.email) : null);
    const before = sameHash.find((s) => s._count.leaves + s._count.adjustments + s._count.wfhDays > 0) ?? null;
    const sameFile = before ? sameFileText((before.appliedAt ?? before.createdAt).toISOString(), nameOf(before.appliedBy) ?? nameOf(before.createdBy)) : null;
    const uploaded = !before && sameHash.length ? sameHash[sameHash.length - 1] : null;
    const uploadedBefore = uploaded ? `This file was uploaded before, on ${shownDate(fromDateOnly(uploaded.createdAt))}${nameOf(uploaded.createdBy) ? ` by ${nameOf(uploaded.createdBy)}` : ''}, and not applied.` : null;

    const employmentsOf = (eid: string) => employments.filter((e) => e.employeeId === eid);
    const covering = (eid: string, from: string, to: string) => employmentsOf(eid).find((e) => e.joinDate <= from && (e.endDate === null || e.endDate >= to)) ?? null;
    const yoursOf = (eid: string): string | null => {
      if (caller.employeeId === eid) return 'Someone else in HR has to import your own leave and balance.';
      if (!mayImportFor(caller, eid)) return confidentialSet.has(eid) ? 'A C-level person’s leave is imported by the CEO.' : 'HR imports this person’s leave.';
      return null;
    };
    const blankView = (r: StoredRow, person: { view: LeaveImportPersonView; employeeId: string | null } | undefined): LeaveImportRowView => ({
      sheet: r.sheet,
      row: r.row,
      status: 'ready',
      reasons: [],
      warnings: [],
      notes: [],
      personKey: r.personKey,
      nameInFile: r.name || r.code || '',
      code: r.code,
      employee: person?.employeeId ? ref(person.employeeId) : null,
      confidential: person?.employeeId ? confidentialSet.has(person.employeeId) : false,
      typeText: r.typeText,
      type: null,
      from: null,
      to: null,
      fromText: '',
      toText: '',
      days: null,
      fileDays: null,
      halfDay: false,
      pending: false,
      wfh: false,
      wfhDays: null,
      approval: null,
      approvalText: null,
      balance: null,
      asOf: null,
      adjustment: null,
      applied: null,
      yours: person?.employeeId ? yoursOf(person.employeeId) === null : false,
      notYours: person?.employeeId ? yoursOf(person.employeeId) : null,
    });

    // ---- the leave rows, each on its own ----
    const offInZohoYears: number[] = [];
    let wfhNameSaid = false;
    const leaves: ResolvedLeave[] = storedLeaves.map((r) => {
      const person = resolvedPeople.get(r.personKey);
      const view: LeaveImportRowView = {
        ...blankView(r, person),
        from: r.from,
        to: r.to,
        fromText: r.fromText,
        toText: r.toText,
        fileDays: r.fileDays,
        approval: r.approval,
        approvalText: r.approvalText,
        pending: r.approval === 'pending',
      };
      const out: ResolvedLeave = { stored: r, view, employeeId: person?.employeeId ?? null, employment: null, type: null, hidden: false, wfh: false, wfhDays: [] };
      if (out.employeeId && hiddenSet.has(out.employeeId)) out.hidden = true;
      const fail = (status: LeaveImportRowStatus, ...reasons: string[]) => {
        view.status = status;
        view.reasons.push(...reasons);
        return out;
      };
      // applied by this import: as it was made
      const made = r.applied?.leaveId ? ownLeaves.get(r.applied.leaveId) : undefined;
      if (r.applied && made) {
        view.status = 'applied';
        view.applied = { at: r.applied.at };
        view.type = made.type;
        view.days = made.days.toNumber();
        view.halfDay = made.halfDay;
        return out;
      }
      // a Working from home row applied: the work-from-home days it made that are still there, and what was said of them
      const madeWfh = (r.applied?.wfhIds ?? []).filter((w) => ownWfh.has(w));
      if (r.applied && madeWfh.length) {
        out.wfh = true;
        view.wfh = true;
        view.status = 'applied';
        view.applied = { at: r.applied.at };
        view.wfhDays = madeWfh.map((w) => ownWfh.get(w)!.date).sort();
        view.days = view.wfhDays.length;
        view.warnings.push(...(r.applied.warnings ?? []));
        return out;
      }
      // Zoho's rejected and cancelled leave: listed, not imported
      if (r.approval === 'rejected' || r.approval === 'cancelled') return fail('skipped', zohoNotImportedText(r.approval));
      // the problems of any row: its dates, its person, Zoho's status and unit
      const rowProblems = (): string[] => {
        const problems: string[] = [];
        if (!r.from) problems.push(r.fromText ? `“${r.fromText}” isn’t a date: enter From as DD/MM/YYYY.` : 'Enter From: the first day of the leave.');
        if (!r.to) problems.push(r.toText ? `“${r.toText}” isn’t a date: enter To as DD/MM/YYYY.` : 'Enter To: the last day of the leave.');
        if (r.from && r.to && r.to < r.from) problems.push('To can’t be before From.');
        if (!r.code && !r.name && !r.zohoId) problems.push('Enter the employee code.');
        if (source === 'zoho' && !r.approval) problems.push(`Approval Status “${r.approvalText ?? ''}” isn’t one Zoho People uses: Approved, Pending, Rejected or Cancelled.`);
        if (source === 'zoho' && r.unit && !/day/i.test(r.unit)) problems.push(`Counted in ${r.unit.toLowerCase()} in Zoho People: only leave in days is imported.`);
        return problems;
      };
      // the type: the template's by its name, Zoho's as mapped (or by default): a leave type, work-from-home days, or skipped
      let type: LeaveType | null = null;
      let wfhRow = false;
      if (source === 'zoho') {
        const chosen = typeMap[r.typeText];
        const byDefault = defaultZohoType(r.typeText, types);
        const target = zohoTypeTarget(chosen, byDefault);
        if (target.kind === 'skip') {
          return fail(
            'skipped',
            !chosen && byDefault.note
              ? byDefault.note
              : `“${r.typeText}” is skipped: choose ${byDefault.wfh ? ZOHO_WFH_TARGET_LABEL : 'a leave type'} for it above to import these rows.`,
          );
        }
        if (target.kind === 'wfh') wfhRow = true;
        else type = typeById.get(target.typeId) ?? null;
      } else if (isTemplateWfhType(r.typeText)) {
        // a leave type of the organization named so wins over it, said once
        type = typeNamed(types, r.typeText);
        if (type && !wfhNameSaid) {
          wfhNameSaid = true;
          view.notes.push(wfhNameIsLeaveTypeText(type.nameEn));
        }
        wfhRow = !type;
      } else type = typeNamed(types, r.typeText);
      if (wfhRow) {
        // Working from home (owner, 21 October 2026: "Yes, as approved WFH days"): a work-from-home day each working
        // day of the row, not leave (no type, no balance, no pay). A template row naming Work from home is read the same
        // way (owner, 26 October 2026: "in the import leaves templete there is no working from home option")
        out.wfh = true;
        view.wfh = true;
        const problems = rowProblems();
        if (r.from && r.to && r.to >= r.from && leaveDaysBetween(r.from, r.to, { workingDays: [], holidays: [], calendarDays: true, halfDay: false }) > WFH_IMPORT_MAX_SPAN) {
          problems.push(`A work-from-home row covers at most ${WFH_IMPORT_MAX_SPAN} days: put the rest on a row of its own.`);
      }
      if (problems.length) return fail('problem', ...problems);
      if (!person || person.view.match === 'skipped') return fail('skipped', 'Its person is skipped.');
      if (!out.employeeId) return fail('waiting', `Say who ${r.name || r.code} is first.`);
      const eid = out.employeeId;
      const name = employeeById.get(eid)!.fullNameEn;
      const holidayList = [...holidaySet];
      // each day as recorded leave counts it: a working day of the shift of the employment it is in, no official holiday;
      // Zoho's Holiday/Weekend days left out too
      const countsDay = (d: string) =>
        leaveDaysBetween(d, d, { workingDays: covering(eid, d, d)?.workingDays ?? DEFAULT_WORKING_DAYS, holidays: holidayList, calendarDays: false, halfDay: false }) > 0;
      const found = zohoWfhDays(r.from!, r.to!, r.details, countsDay);
      // a template row's half day (a single day of 0.5): a whole work-from-home day, said so
      if (source !== 'zoho' && r.from === r.to && r.fileDays !== null && Math.round(r.fileDays * 10) === 5 && found.days.length) found.halfDays.push(r.from!);
      const outside = found.days.filter((d) => !covering(eid, d, d));
      const days = found.days.filter((d) => !outside.includes(d));
      if (outside.length && !days.length) {
        const all = employmentsOf(eid);
        return fail('problem', all.length ? `${name}’s employment${all.length === 1 ? '' : 's'} don’t cover these days (joined ${shownDate(all[all.length - 1].joinDate)}): choose days within one.` : `${name} has no employment.`);
      }
      view.days = days.length;
      view.wfhDays = days;
      out.wfhDays = days;
      if (!days.length) return fail('skipped', '0 days: every day of it is a rest day or an official holiday.');
      const half = source === 'zoho' ? wfhHalfDaysText(found.halfDays) : found.halfDays.length ? wfhFileHalfDayText(found.halfDays[0]) : null;
      if (half) view.warnings.push(half);
      const leftOut = wfhLeftOutText(found.leftOut);
      if (leftOut) view.notes.push(leftOut);
      if (outside.length) view.notes.push(wfhOutsideEmploymentText(outside, name));
      if (view.pending) view.notes.push(ZOHO_WFH_PENDING_NOTE);
      return out;
      }
      const problems: string[] = [];
      if (!r.typeText) problems.push('Choose the leave type from the list.');
      else if (!type) problems.push(`“${r.typeText}” isn’t a leave type of the system: choose one from the list.`);
      else if (!type.active) problems.push(`${type.nameEn} is turned off in Leave Setup: turn it on to import it, or choose another type.`);
      if (type) view.type = { id: type.id, nameEn: type.nameEn };
      out.type = type;
      problems.push(...rowProblems());
      if (problems.length) return fail('problem', ...problems);
      // who it is
      if (!person || person.view.match === 'skipped') return fail('skipped', 'Its person is skipped.');
      if (!out.employeeId) return fail('waiting', `Say who ${r.name || r.code} is first.`);
      const employee = employeeById.get(out.employeeId)!;
      const name = employee.fullNameEn;
      const employment = covering(out.employeeId, r.from!, r.to!);
      if (!employment) {
        const all = employmentsOf(out.employeeId);
        return fail('problem', all.length ? `${name}’s employment${all.length === 1 ? '' : 's'} don’t cover these days (joined ${shownDate(all[all.length - 1].joinDate)}): choose days within one.` : `${name} has no employment.`);
      }
      out.employment = employment;
      if (!underLabourLaw(employment.employmentType)) return fail('problem', noLeaveMessage(employment.employmentType, name));
      // the days, as recorded leave counts them: the shift's working days, the official holidays left out
      const t = type!;
      const workingDays = employment.workingDays ?? DEFAULT_WORKING_DAYS;
      const wantsHalf = source === 'zoho' ? (r.details?.some((d) => d.kind === 'half') ?? false) : r.fileDays !== null && r.from === r.to && Math.round(r.fileDays * 10) === 5;
      let halfDayRefused: string | null = null;
      let halfDay = false;
      if (wantsHalf) {
        if (r.from !== r.to) halfDayRefused = 'A half day within a leave of several days can’t be kept: counted in whole days.';
        else if (!t.halfDays) halfDayRefused = `${t.nameEn} can’t be taken as a half day: counted as a whole day.`;
        else halfDay = true;
      }
      const holidayList = [...holidaySet];
      const days = leaveDaysBetween(r.from!, r.to!, { workingDays, holidays: holidayList, calendarDays: t.calendarDays, halfDay });
      view.days = days;
      view.halfDay = halfDay;
      // the file's own figure against the system's (the system's used), and Zoho's days told apart from the system's
      const countsDay = (d: string) => leaveDaysBetween(d, d, { workingDays, holidays: holidayList, calendarDays: t.calendarDays, halfDay: false }) > 0;
      const diff = r.details && !t.calendarDays ? zohoDayDifferences(r.details, countsDay) : null;
      if (diff?.offInZoho.length) offInZohoYears.push(...diff.offInZoho.map((d) => Number(d.slice(0, 4))));
      if (halfDayRefused) view.warnings.push(halfDayRefused);
      else if (r.fileDays !== null && days > 0 && Math.round(r.fileDays * 10) !== Math.round(days * 10)) {
        view.warnings.push(daysMismatchText(r.fileDays, days, t.calendarDays));
        const why = diff && zohoDayDifferencesText(diff);
        if (why) view.warnings.push(why);
      }
      if (days <= 0 && source === 'zoho') return fail('skipped', '0 days: every day of it is a rest day or an official holiday.');
      const findings = importedLeaveFindings(
        { startDate: r.from!, endDate: r.to!, halfDay, days, fileDays: null, halfDayRefused: null },
        rulesOf(t),
        { usedInYear: 0, timesInService: 0, serviceMonths: 0, gender: (employee.gender as LeaveGender | null) ?? null, usableFrom: '0000-01-01' },
      );
      if (findings.problems.length) return fail('problem', ...findings.problems);
      const year = Number(r.from!.slice(0, 4));
      if (takesFromAnnual(t.balance) && closedYears.has(year)) return fail('problem', `${year}'s annual leave is closed, so leave from it can’t be imported. Reopen its Year Closing first.`);
      // nor on a day with permission asked for, as recorded leave
      const permission = permissions.find((p) => p.employeeId === out.employeeId && fromDateOnly(p.date) >= r.from! && fromDateOnly(p.date) <= r.to!);
      if (permission) return fail('problem', `${name} has permission on ${shownDate(fromDateOnly(permission.date))}: cancel it first, or put the leave on other days.`);
      if (view.pending) view.notes.push(ZOHO_PENDING_NOTE);
      return out;
    });

    // ---- duplicates and overlaps: with Zoho's link ids imported before, the system's leave, the file's earlier rows ----
    const taken: { r: ResolvedLeave; key: string }[] = [];
    for (const l of [...leaves].sort((a, b) => a.view.row - b.view.row)) {
      const v = l.view;
      if (v.status !== 'ready' || !l.employeeId || !l.type) continue;
      if (l.stored.linkId) {
        const was = linked.find((x) => x.zohoLinkId === l.stored.linkId);
        if (was) {
          v.status = 'duplicate';
          v.reasons.push(was.importId ? (sources.get(was.importId) ?? 'Already imported.') : alreadyInSystemText(was.type.nameEn, v.from!, v.to!, statusWords(was.status)));
          continue;
        }
      }
      const key = leaveImportKey(l.employeeId, l.type.id, v.from!, v.to!);
      const same = existing.find((x) => x.employeeId === l.employeeId && leaveImportKey(x.employeeId, x.typeId, fromDateOnly(x.startDate), fromDateOnly(x.endDate)) === key);
      if (same) {
        v.status = 'duplicate';
        v.reasons.push(same.importId ? (sources.get(same.importId) ?? 'Already imported.') : alreadyInSystemText(same.type.nameEn, v.from!, v.to!, statusWords(same.status)));
        continue;
      }
      const earlier = taken.find((x) => x.key === key);
      if (earlier) {
        v.status = 'duplicate';
        v.reasons.push(sameRowText(earlier.r.view.row));
        continue;
      }
      const overlap = existing.find((x) => x.employeeId === l.employeeId && fromDateOnly(x.startDate) <= v.to! && fromDateOnly(x.endDate) >= v.from!);
      if (overlap) {
        v.status = 'problem';
        v.reasons.push(
          overlap.importId && sources.get(overlap.importId)
            ? `${overlapsSystemText(overlap.type.nameEn, fromDateOnly(overlap.startDate), fromDateOnly(overlap.endDate), statusWords(overlap.status))} ${sources.get(overlap.importId)}`
            : overlapsSystemText(overlap.type.nameEn, fromDateOnly(overlap.startDate), fromDateOnly(overlap.endDate), statusWords(overlap.status)),
        );
        continue;
      }
      const overlapsRow = taken.find((x) => x.r.employeeId === l.employeeId && x.r.view.from! <= v.to! && x.r.view.to! >= v.from!);
      if (overlapsRow) {
        v.status = 'problem';
        v.reasons.push(overlapsRowText(overlapsRow.r.view.row));
        continue;
      }
      taken.push({ r: l, key });
    }

    // ---- the work-from-home rows' days (owner, 21 October 2026: "Yes, as approved WFH days"): none made for a day brought
    // over before (its ZOHO_LINK_ID and day), already a work-from-home day of the person's (being decided or approved), or
    // an earlier row's of the file; then what bringing the others over says (the limits, a rest day, a day of leave),
    // warnings only, as history ----
    const wfhReady = leaves.filter((l) => l.wfh && l.view.status === 'ready');
    if (wfhReady.length) {
      const linkKeys = wfhReady.flatMap((l) => (l.stored.linkId ? l.wfhDays.map((d) => wfhLinkKey(l.stored.linkId!, d)) : []));
      const [wfhLinked, wfhTaken] = await Promise.all([
        linkKeys.length ? this.prisma.wfhRequest.findMany({ where: { zohoLinkId: { in: linkKeys } }, select: { zohoLinkId: true, status: true, importId: true } }) : Promise.resolve([]),
        this.prisma.wfhRequest.findMany({
          where: { employeeId: { in: [...new Set(wfhReady.map((l) => l.employeeId!))] }, status: { in: [...TAKING] }, date: { in: [...new Set(wfhReady.flatMap((l) => l.wfhDays))].map(toDateOnly) } },
          select: { employeeId: true, date: true, status: true, importId: true },
        }),
      ]);
      const fileIds = [...new Set([...wfhLinked, ...wfhTaken].map((w) => w.importId).filter((x): x is string => !!x))];
      const files = new Map((fileIds.length ? await this.prisma.leaveImport.findMany({ where: { id: { in: fileIds } }, select: { id: true, fileName: true } }) : []).map((f) => [f.id, f.fileName]));
      const how = (w: { status: string; importId: string | null }) => {
        const file = w.importId ? files.get(w.importId) : undefined;
        return file ? `imported from ${file}${w.status === 'approved' ? '' : `, ${statusWords(w.status)}`}` : statusWords(w.status);
      };
      const byLink = new Map(wfhLinked.map((w) => [w.zohoLinkId!, w]));
      const byDay = new Map(wfhTaken.map((w) => [`${w.employeeId}|${fromDateOnly(w.date)}`, w]));
      const inFile = new Map<string, number>();
      for (const l of [...wfhReady].sort((a, b) => a.view.row - b.view.row)) {
        const already: string[] = [];
        const keep: string[] = [];
        for (const d of l.wfhDays) {
          const linked = l.stored.linkId ? byLink.get(wfhLinkKey(l.stored.linkId, d)) : undefined;
          const same = byDay.get(`${l.employeeId}|${d}`);
          const earlier = inFile.get(`${l.employeeId}|${d}`);
          if (linked) already.push(alreadyWfhText(d, how(linked)));
          else if (same) already.push(alreadyWfhText(d, how(same)));
          else if (earlier !== undefined) already.push(wfhInFileText(d, earlier));
          else {
            keep.push(d);
            inFile.set(`${l.employeeId}|${d}`, l.view.row);
          }
        }
        l.wfhDays = keep;
        if (!keep.length) {
          l.view.status = 'duplicate';
          l.view.reasons.push(...already);
        } else if (already.length) {
          l.view.wfhDays = keep;
          l.view.days = keep.length;
          l.view.notes.unshift(...already.map((t) => `${t} Left out.`));
        }
      }
      // as Apply brings them over (WfhService.recordHistory), saving nothing; the file's leave read as the people's too
      const previewed = wfhReady.filter((l) => l.view.status === 'ready' && !l.hidden);
      const fileLeave = leaves
        .filter((l) => !l.wfh && l.type && l.view.status === 'ready' && !l.hidden)
        .map((l) => ({ employeeId: l.employeeId!, from: l.view.from!, to: l.view.to!, type: l.type!.nameEn, status: l.view.pending ? 'pending' : 'approved' }));
      const preview = await this.wfh.previewHistory(
        previewed.flatMap((l) => l.wfhDays.map((date) => ({ employeeId: l.employeeId!, date, pending: l.view.pending, zohoLinkId: l.stored.linkId ? wfhLinkKey(l.stored.linkId, date) : null }))),
        fileLeave,
      );
      for (const l of previewed) {
        const mine = (x: { employeeId: string; date: string }) => x.employeeId === l.employeeId && l.wfhDays.includes(x.date);
        l.view.warnings = [...new Set([...l.view.warnings, ...preview.recorded.filter(mine).flatMap((x) => x.warnings)])];
        const skipped = preview.skipped.filter(mine);
        if (!skipped.length) continue;
        const keep = l.wfhDays.filter((d) => !skipped.some((x) => x.date === d));
        if (!keep.length) {
          l.view.status = skipped.every((x) => x.reason === 'duplicate') ? 'duplicate' : 'problem';
          l.view.reasons.push(...skipped.map((x) => x.message));
        } else {
          l.view.wfhDays = keep;
          l.view.days = keep.length;
          l.view.notes.push(...skipped.map((x) => x.message));
        }
        l.wfhDays = keep;
      }
    }

    // ---- the balance rows ----
    const leaveYears = [...new Set(storedLeaves.map((r) => r.from).filter((d): d is string => !!d).map((d) => Number(d.slice(0, 4))))];
    const balanceYearClosed = await this.paidOnLeaving(employments.map((e) => e.id));
    const balances: ResolvedBalance[] = storedBalances.map((r) => {
      const person = resolvedPeople.get(r.personKey);
      const view: LeaveImportRowView = { ...blankView(r, person), balance: r.balance, asOf: r.asOf, fromText: r.asOfText };
      const out: ResolvedBalance = { stored: r, view, employeeId: person?.employeeId ?? null, employment: null, year: r.asOf ? Number(r.asOf.slice(0, 4)) : null, hidden: false };
      if (out.employeeId && hiddenSet.has(out.employeeId)) out.hidden = true;
      const fail = (status: LeaveImportRowStatus, ...reasons: string[]) => {
        view.status = status;
        view.reasons.push(...reasons);
        return out;
      };
      if (r.applied?.adjustmentId && ownAdjustments.has(r.applied.adjustmentId)) {
        view.status = 'applied';
        view.applied = { at: r.applied.at };
        view.adjustment = r.applied.days ?? null;
        if (annualType) view.type = { id: annualType.id, nameEn: annualType.nameEn };
        return out;
      }
      const problems = balanceRowProblems({ balance: r.balance, balanceText: r.balanceText, asOf: r.asOf, asOfText: r.asOfText }, currentYear, leaveYears);
      // the annual balance's, the type left empty too: casual leave is counted against it, the others have none to set
      const type = r.typeText ? typeNamed(types, r.typeText) : annualType;
      if (!type) problems.push(`“${r.typeText}” isn’t a leave type of the system: choose ${annualType?.nameEn ?? 'Annual leave'} from the list.`);
      else if (type.balance === 'from_annual') problems.push(`${type.nameEn} is counted against the annual balance: give the balance of ${annualType?.nameEn ?? 'annual leave'} instead.`);
      else if (type.balance !== 'annual') problems.push(`${type.nameEn} has no balance to set: only the annual balance (${annualType?.nameEn ?? 'annual leave'}) is.`);
      else view.type = { id: type.id, nameEn: type.nameEn };
      if (!r.code && !r.name) problems.push('Enter the employee code.');
      if (problems.length) return fail('problem', ...problems);
      if (!person || person.view.match === 'skipped') return fail('skipped', 'Its person is skipped.');
      if (!out.employeeId) return fail('waiting', `Say who ${r.name || r.code} is first.`);
      const name = employeeById.get(out.employeeId)!.fullNameEn;
      const employment = covering(out.employeeId, r.asOf!, r.asOf!);
      if (!employment) return fail('problem', `${name} wasn’t employed on ${shownDate(r.asOf!)}: choose a day of their employment.`);
      out.employment = employment;
      if (!underLabourLaw(employment.employmentType)) return fail('problem', noLeaveMessage(employment.employmentType, name));
      const year = out.year!;
      if (closedYears.has(year)) return fail('problem', `${year}'s leave is closed: reopen its Year Closing to set a balance of that year.`);
      if (balanceYearClosed.has(`${employment.id}:${year}`)) return fail('problem', `${name}'s ${year} leave was paid on leaving, so the balance can’t change.`);
      return out;
    });
    // the same person and day twice; the same file again
    const seen = new Map<string, ResolvedBalance>();
    for (const b of [...balances].sort((x, y) => x.view.row - y.view.row)) {
      if (b.view.status !== 'ready') continue;
      const key = `${b.employment!.id}|${b.view.asOf}`;
      const earlier = seen.get(key);
      if (earlier) {
        if (earlier.view.balance === b.view.balance) {
          b.view.status = 'duplicate';
          b.view.reasons.push(sameRowText(earlier.view.row));
        } else {
          b.view.status = 'problem';
          b.view.reasons.push(`Row ${earlier.view.row} gives another balance as of the same day: keep one of them.`);
        }
        continue;
      }
      seen.set(key, b);
    }

    // ---- the balances' figures: what is left now (and as of each balance's day), with the file's leave counted ----
    // the leave (a work-from-home row has no balance, no pay)
    const readyLeaves = leaves.filter((l) => l.view.status === 'ready' && !l.hidden && !l.wfh);
    const annualRows = readyLeaves.filter((l) => takesFromAnnual(l.type!.balance));
    const readyBalances = balances.filter((b) => b.view.status === 'ready');
    const pairKey = (e: LeaveEmployment, y: number) => `${e.id}:${y}`;
    const pairs = new Map<string, { employment: LeaveEmployment; year: number }>();
    for (const l of readyLeaves) pairs.set(pairKey(l.employment!, Number(l.view.from!.slice(0, 4))), { employment: l.employment!, year: Number(l.view.from!.slice(0, 4)) });
    const nowFigures = await this.balances.yearFigures([...pairs.values()], today);
    // as of each balance's day, in its order: the system's left less the file's approved leave from the annual balance by
    // then, after the earlier balances of the year
    const byDay = new Map<string, ResolvedBalance[]>();
    for (const b of readyBalances) byDay.set(b.view.asOf!, [...(byDay.get(b.view.asOf!) ?? []), b]);
    const figuresOn = new Map<string, YearFigures>();
    for (const [day, list] of byDay) {
      const got = await this.balances.yearFigures(
        list.map((b) => ({ employment: b.employment!, year: b.year! })),
        day,
      );
      for (const b of list) figuresOn.set(`${b.view.row}`, got.get(pairKey(b.employment!, b.year!))!);
    }
    const added = new Map<string, number>();
    for (const b of [...readyBalances].sort((x, y) => x.employment!.id.localeCompare(y.employment!.id) || x.view.asOf!.localeCompare(y.view.asOf!))) {
      const f = figuresOn.get(`${b.view.row}`)!;
      const pk = pairKey(b.employment!, b.year!);
      const fileTaken = annualRows
        .filter((l) => !l.view.pending && l.employment!.id === b.employment!.id && l.view.from!.slice(0, 4) === String(b.year) && l.view.from! <= b.view.asOf!)
        .reduce((n, l) => n + l.view.days!, 0);
      const remaining = tenth(remainingOf(f) + (added.get(pk) ?? 0) - fileTaken);
      const days = openingAdjustment(b.view.balance!, remaining);
      b.view.adjustment = days;
      if (days === 0) {
        b.view.status = 'duplicate';
        b.view.reasons.push(ALREADY_AT_BALANCE);
        continue;
      }
      added.set(pk, (added.get(pk) ?? 0) + days);
      b.view.notes.push(`The system has ${signed(remaining)} left as of ${shownDate(b.view.asOf!)}: ${days > 0 ? 'adds' : 'takes off'} ${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'}.`);
    }

    // ---- the warnings that need the rows before them: the type's limits in the year and in service, the balance below 0 ----
    const balanceSet = new Set(readyBalances.filter((b) => b.view.status === 'ready').map((b) => pairKey(b.employment!, b.year!)));
    const left = new Map<string, number>();
    const usedSoFar = new Map<string, { year: Map<number, number>; times: number }>();
    for (const l of [...readyLeaves].sort((a, b) => a.view.from!.localeCompare(b.view.from!) || a.view.row - b.view.row)) {
      const t = l.type!;
      const year = Number(l.view.from!.slice(0, 4));
      const hk = `${l.employeeId}|${t.id}`;
      if (!usedSoFar.has(hk)) {
        const mine = existing.filter((x) => x.employeeId === l.employeeId && x.typeId === t.id);
        const byYear = new Map<number, number>();
        for (const x of mine) byYear.set(x.startDate.getUTCFullYear(), (byYear.get(x.startDate.getUTCFullYear()) ?? 0) + x.days.toNumber());
        usedSoFar.set(hk, { year: byYear, times: mine.length });
      }
      const h = usedSoFar.get(hk)!;
      const pk = pairKey(l.employment!, year);
      const f = nowFigures.get(pk);
      const findings = importedLeaveFindings(
        { startDate: l.view.from!, endDate: l.view.to!, halfDay: l.view.halfDay, days: l.view.days!, fileDays: null, halfDayRefused: null },
        rulesOf(t),
        {
          usedInYear: h.year.get(year) ?? 0,
          timesInService: h.times,
          serviceMonths: serviceMonths(l.employment!.joinDate, l.view.from!),
          gender: (employeeById.get(l.employeeId!)!.gender as LeaveGender | null) ?? null,
          usableFrom: f?.usableFrom ?? '0000-01-01',
        },
      );
      // the days compared and the half day were said on their own
      l.view.warnings.push(...findings.warnings);
      h.year.set(year, (h.year.get(year) ?? 0) + l.view.days!);
      h.times++;
      if (takesFromAnnual(t.balance) && f && !balanceSet.has(pk)) {
        const now = tenth((left.has(pk) ? left.get(pk)! : annualAvailable(f)) - l.view.days!);
        left.set(pk, now);
        if (now < 0) l.view.warnings.push(belowZeroText(annualType?.nameEn ?? 'Annual leave', now, f.entitlement));
      }
    }
    // the half day and the days counted otherwise first, before the type's own limits
    for (const l of leaves) l.view.warnings = [...new Set(l.view.warnings)];

    // ---- the payroll of each month: past its draft, it isn't changed ----
    const months = [...new Set(readyLeaves.filter((l) => !l.view.pending).flatMap((l) => monthsOf(l.view.from!, l.view.to!)))];
    const runs = months.length ? await this.prisma.payrollRun.findMany({ where: { month: { in: months.map((m) => toDateOnly(`${m}-01`)) } }, select: { month: true, status: true } }) : [];
    const runOf = new Map(runs.map((r) => [fromDateOnly(r.month).slice(0, 7), r.status]));
    for (const l of readyLeaves.filter((x) => !x.view.pending)) {
      for (const m of monthsOf(l.view.from!, l.view.to!)) {
        const status = runOf.get(m);
        if (status && status !== 'draft') l.view.notes.push(notInPayrollText(m, status));
        else if (status === 'draft' && l.type!.paid !== 'paid') l.view.notes.push(unpaidInDraftText(m));
      }
    }
    const noShowsToLeave = await this.noShowsToLeave(
      readyLeaves.filter((l) => !l.view.pending),
      [...runOf].filter(([, status]) => status === 'draft').map(([m]) => m),
    );

    // the same file imported before: every row of it a duplicate, still reviewed (owner, 21 October 2026)
    if (sameFile) {
      for (const r of [...leaves, ...balances]) {
        if (r.view.status !== 'ready' && r.view.status !== 'waiting' && r.view.status !== 'problem') continue;
        r.view.status = 'duplicate';
        r.view.reasons = [sameFile, ...r.view.reasons];
      }
    }

    // ---- the view ----
    const shownLeaves = leaves.filter((l) => !l.hidden);
    const shownBalances = balances.filter((b) => !b.hidden);
    const hiddenRows = leaves.length - shownLeaves.length + balances.length - shownBalances.length;
    const counts = Object.fromEntries(LEAVE_IMPORT_ROW_STATUSES.map((s) => [s, 0])) as Record<LeaveImportRowStatus, number>;
    for (const r of [...shownLeaves, ...shownBalances]) counts[r.view.status]++;
    const zohoTypes = source === 'zoho' ? [...new Set(storedLeaves.map((r) => r.typeText).filter(Boolean))] : [];
    const options = employees.filter((e) => !hiddenSet.has(e.id)).map((e) => ({ id: e.id, fullNameEn: e.fullNameEn, employeeCode: e.employeeCode }));
    const kept: Kept = { leaves: ownLeaves.size, adjustments: ownAdjustments.size, wfhDays: ownWfh.size };
    const undoable =
      kept.leaves + kept.adjustments + kept.wfhDays === 0
        ? 0
        : (await this.prisma.leaveRequest.findMany({ where: { importId: id }, select: { employeeId: true } })).filter((l) => mayImportFor(caller, l.employeeId)).length +
          (await this.prisma.leaveAdjustment.findMany({ where: { importId: id }, select: { employeeId: true } })).filter((a) => mayImportFor(caller, a.employeeId)).length +
          [...ownWfh.values()].filter((w) => mayImportFor(caller, w.employeeId)).length;
    const view: LeaveImportView = {
      id: imp.id,
      fileName: imp.fileName,
      source,
      sourceLabel: LEAVE_IMPORT_SOURCE_LABELS[source] ?? source,
      createdAt: imp.createdAt.toISOString(),
      createdBy: nameOf(imp.createdBy),
      appliedAt: imp.appliedAt?.toISOString() ?? null,
      appliedBy: nameOf(imp.appliedBy),
      undoneAt: imp.undoneAt?.toISOString() ?? null,
      undoneBy: nameOf(imp.undoneBy),
      sameFile,
      uploadedBefore,
      people: [...resolvedPeople.values()].map((p) => p.view).filter((p) => !(p.employee && hiddenSet.has(p.employee.id))),
      types: zohoTypes.map((zohoType) => {
        const d = defaultZohoType(zohoType, types);
        const chosen = typeMap[zohoType];
        const target = zohoTypeTarget(chosen, d);
        return {
          zohoType,
          rows: storedLeaves.filter((r) => r.typeText === zohoType).length,
          typeId: target.kind === 'leave' ? target.typeId : null,
          wfh: target.kind === 'wfh',
          chosen: chosen !== undefined,
          defaultTypeId: d.typeId,
          defaultWfh: d.wfh,
          // Working from home's note says it is imported as work-from-home days: not once HR skips it
          note: d.wfh && target.kind !== 'wfh' ? null : d.note,
        };
      }),
      leaves: shownLeaves.map((l) => l.view),
      balances: shownBalances.map((b) => b.view),
      counts: { ...counts, pending: shownLeaves.filter((l) => l.view.status === 'ready' && l.view.pending).length, hidden: hiddenRows },
      hidden: hiddenRows ? { rows: hiddenRows, label: `${confidentialPeople(new Set([...leaves, ...balances].filter((x) => x.hidden).map((x) => x.employeeId)).size)}: ${hiddenRows} ${hiddenRows === 1 ? 'row' : 'rows'}, imported by the CEO` } : null,
      holidaysHint: offInZohoYears.length ? holidaysHint(offInZohoYears) : null,
      noShowsToLeave,
      options,
      typeOptions: types.filter((t) => t.active).map((t) => ({ id: t.id, nameEn: t.nameEn, kind: t.kind, balance: t.balance })),
      canApply: [...shownLeaves, ...shownBalances].some((r) => r.view.status === 'ready' && r.view.yours),
      undoable,
      kept,
    };
    return { imp, view, leaves, balances };
  }

  /**
   * The days of the file's leave that a draft payroll has as no-shows now (owner, 21 October 2026: Zoho's attendance
   * counts a day absent when its leave wasn't in it): on the lines whose no-show days come from attendance (Zoho's import
   * or the attendance days), each absent day the leave covers. Applying makes them leave (LeavePayrollService.syncDrafts),
   * as a refresh does; each row says its own.
   */
  private async noShowsToLeave(rows: readonly ResolvedLeave[], draftMonths: readonly string[]): Promise<LeaveImportView['noShowsToLeave']> {
    if (!rows.length || !draftMonths.length) return null;
    const people = new Set<string>();
    let total = 0;
    for (const month of draftMonths) {
      const inMonth = rows.filter((l) => monthsOf(l.view.from!, l.view.to!).includes(month));
      if (!inMonth.length) continue;
      const ids = [...new Set(inMonth.map((l) => l.employeeId!))];
      const lines = await this.prisma.payrollLine.findMany({
        where: { run: { month: toDateOnly(`${month}-01`), status: 'draft' }, employeeId: { in: ids } },
        select: { employeeId: true, attendanceImport: true },
      });
      const filled = new Set(
        lines.filter((l) => (l.attendanceImport as unknown as AttendanceImportMark | null)?.fields?.includes('noShowDays')).map((l) => l.employeeId),
      );
      if (!filled.size) continue;
      const days = await this.attendanceDays.monthOf(month, [...filled]);
      for (const l of inMonth.filter((x) => filled.has(x.employeeId!))) {
        const absent = (days.get(l.employeeId!)?.days ?? []).filter((d) => d.status === 'absent' && d.date >= l.view.from! && d.date <= l.view.to!).length;
        if (!absent) continue;
        l.view.notes.push(rowNoShowsText(absent, month));
        total += absent;
        people.add(l.employeeId!);
      }
    }
    return total ? { days: total, people: people.size, text: noShowsToLeaveText(total, people.size) } : null;
  }

  /** The employment-years whose leave was paid on leaving (its balance closed with the final settlement). */
  private async paidOnLeaving(employmentIds: readonly string[]): Promise<Set<string>> {
    if (!employmentIds.length) return new Set();
    const rows = await this.prisma.leaveBalanceYear.findMany({ where: { employmentId: { in: [...employmentIds] }, closedOn: 'leaving' }, select: { employmentId: true, year: true } });
    return new Set(rows.map((r) => `${r.employmentId}:${r.year}`));
  }

  /** Works out again the draft payroll lines of the people and days given, as recorded leave does. */
  private async syncPayroll(changed: readonly { employeeId: string; from: string; to: string }[], user: SessionUser): Promise<void> {
    const span = new Map<string, { from: string; to: string }>();
    for (const c of changed) {
      const s = span.get(c.employeeId);
      span.set(c.employeeId, s ? { from: c.from < s.from ? c.from : s.from, to: c.to > s.to ? c.to : s.to } : { from: c.from, to: c.to });
    }
    for (const [employeeId, s] of span) await this.payroll.syncDrafts(employeeId, s.from, s.to, user);
  }
}

/** What the system has left of a year's annual balance as of the figures' day: earned, carried in and adjusted, less what was taken by then. */
const remainingOf = (f: YearFigures) => tenth(f.entitlement + f.carriedIn + f.adjustments - f.taken);

/** "a", "a and b", "a, b and c", the empty ones left out. */
function listed(items: readonly (string | null)[]): string {
  const xs = items.filter((x): x is string => !!x);
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** "5 days", "−2 days". */
const signed = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'}`;

/** "October 2026" for '2026-10'. */
const monthWords = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Whether the caller imports this person's leave: HR, a C-level person's the CEO; never their own, nor one hidden from them. */
function mayImportFor(caller: Caller, employeeId: string): boolean {
  if (caller.employeeId === employeeId) return false;
  if (caller.confidential?.hidden.has(employeeId)) return false;
  return importsLeaveFor(caller.user, caller.confidential?.all.has(employeeId) ?? false);
}
