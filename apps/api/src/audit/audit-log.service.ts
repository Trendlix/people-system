import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { SessionUser } from '../auth/session-user.js';
import { shownDate, todayInCairo } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { monthName } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from './audit.service.js';
import { ACTION_LABELS, actionLabel, ENTITY_LABELS, entityLabel } from './audit-labels.js';
import { PAGE_SIZE, type AuditQueryDto } from './audit-log.dto.js';
import { auditWhere, type AuditFilters, type People } from './audit-query.js';
import { auditLogFileName, auditLogWorkbook, EXPORT_LIMIT, type FilterLine } from './audit-workbook.js';
import {
  codeIn,
  entryView,
  idsIn,
  isUuid,
  recordKey,
  shownMoment,
  type AuditEmployee,
  type AuditEntryView,
  type AuditPerson,
  type AuditRecord,
  type AuditRefs,
  type AuditRow,
} from './audit-view.js';

// The Audit Log (owner, 19 October 2026: "an Audit Log page showing who changed what and when"): every entry the
// services wrote to audit_log (AuditService), for the Super Admin and the CEO, newest first, ~50 a page, with filters (the
// days, who, the action, the kind of record, one record, one person's everything, text in what changed), and the same as
// an Excel workbook of up to 10,000 entries. Read only: nothing here writes the log but the download of the workbook,
// recorded as every other report's. The diffs are shown as written: the restricted values the services masked
// ("changed", "set") stay masked. Both roles see C-level people (packages/shared confidential.ts); the entries about
// those hidden from the caller are still left out through ConfidentialService, for safety, should another role come.

/** A page of the log, as GET /audit answers it. */
export interface AuditPage {
  entries: AuditEntryView[];
  /** How many entries match, on every page. */
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  /** The id of the last entry shown when older ones match (send it as `before` for the next page), else null. */
  next: string | null;
}

/** What the page's filters offer: who, the actions, the kinds of record and the people, each with its words. */
export interface AuditOptions {
  users: (AuditPerson & { active: boolean })[];
  actions: { value: string; label: string }[];
  entityTypes: { value: string; label: string }[];
  employees: AuditEmployee[];
}

/** Ids per query: Postgres takes at most 65,535 bound values in one, and an export names up to tens of thousands. */
const CHUNK = 5000;

async function chunked<T>(values: Iterable<string>, read: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const all = [...new Set(values)];
  const out: T[] = [];
  for (let i = 0; i < all.length; i += CHUNK) out.push(...(await read(all.slice(i, i + CHUNK))));
  return out;
}

const monthOf = (d: Date) => monthName(d.toISOString().slice(0, 7));

const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, 'en');

/** Reads records of one kind by their ids: whom each belongs to and its own words. */
type Lookup = (ids: string[]) => Promise<[string, AuditRecord][]>;

const personName = (p: AuditPerson) => (p.name ? `${p.name} (${p.email})` : p.email);

@Injectable()
export class AuditLogService {
  /** How each kind of record an entry is on is read (recordLookups). */
  private readonly lookups: Readonly<Record<string, Lookup>>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
  ) {
    this.lookups = recordLookups(prisma);
  }

  /** A page of the entries asked for, newest first. */
  async list(query: AuditQueryDto, user: SessionUser): Promise<AuditPage> {
    const { where, hidden } = await this.where(query, user);
    const pageSize = query.limit ?? PAGE_SIZE;
    const page = query.page ?? 1;
    const [rows, total] = await Promise.all([this.rows(where, pageSize + 1, (page - 1) * pageSize), this.count(where)]);
    const shown = rows.slice(0, pageSize);
    return {
      entries: await this.views(shown, user, hidden),
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      next: rows.length > pageSize ? String(shown[shown.length - 1].id) : null,
    };
  }

  /**
   * The same entries as an Excel workbook, newest first, up to EXPORT_LIMIT (the page and its size don't count); the
   * download is written to the log, as every report's is.
   */
  async workbook(query: AuditQueryDto, user: SessionUser): Promise<{ fileName: string; data: Buffer }> {
    const { where, hidden } = await this.where(query, user);
    const [rows, total] = await Promise.all([this.rows(where, EXPORT_LIMIT, 0), this.count(where)]);
    const entries = await this.views(rows, user, hidden);
    const filters = await this.filterLines(query);
    const data = await auditLogWorkbook(entries, total, filters, shownMoment(new Date()));
    await this.audit.record({
      userId: user.id,
      action: 'audit_log_file',
      entityType: 'audit_log',
      diff: { ...filtersOf(query), ...(query.employeeId && { employeeId: query.employeeId }), entries: entries.length, total },
    });
    return { fileName: auditLogFileName(todayInCairo()), data };
  }

  /** The filters' choices: every user, action, kind of record and person (those hidden from the caller left out). */
  async options(user: SessionUser): Promise<AuditOptions> {
    const [users, employees, hidden] = await Promise.all([
      this.prisma.user.findMany({ select: { id: true, email: true, isActive: true } }),
      this.prisma.employee.findMany({ select: { id: true, employeeCode: true, fullNameEn: true }, orderBy: [{ fullNameEn: 'asc' }, { employeeCode: 'asc' }] }),
      this.confidential.hiddenFrom(user),
    ]);
    const named = await this.people(users.map((u) => u.id));
    const out = new Set(hidden);
    return {
      users: users
        .map((u) => ({ ...(named.get(u.id) ?? { id: u.id, email: u.email, name: null }), active: u.isActive }))
        .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email, 'en')),
      actions: Object.entries(ACTION_LABELS)
        .map(([value, label]) => ({ value, label }))
        .sort(byLabel),
      entityTypes: Object.entries(ENTITY_LABELS)
        .map(([value, label]) => ({ value, label }))
        .sort(byLabel),
      employees: employees.filter((e) => !out.has(e.id)),
    };
  }

  // ---------- the query ----------

  /** The WHERE for what is asked, as the caller may see it, and the people hidden from them. */
  private async where(query: AuditQueryDto, user: SessionUser): Promise<{ where: Prisma.Sql; hidden: ReadonlySet<string> }> {
    if (query.from && query.to && query.from > query.to) throw new BadRequestException('Choose a first day on or before the last day.');
    const [about, hidden] = await Promise.all([this.about(query.employeeId, user), this.hiddenPeople(user)]);
    return { where: auditWhere(filtersOf(query), about, hidden), hidden: new Set(hidden?.ids ?? []) };
  }

  /** One person's entries (their History): 404 for someone not on record, or hidden from the caller. */
  private async about(employeeId: string | undefined, user: SessionUser): Promise<People | null> {
    if (!employeeId) return null;
    await this.confidential.assertVisible(user, employeeId);
    const e = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, employeeCode: true } });
    if (!e) throw new NotFoundException('Employee not found.');
    return { ids: [e.id], codes: [e.employeeCode] };
  }

  /** The C-level people hidden from the caller (none for the CEO and a Super Admin), with their codes. */
  private async hiddenPeople(user: SessionUser): Promise<People | null> {
    const ids = await this.confidential.hiddenFrom(user);
    if (!ids.length) return null;
    const rows = await this.prisma.employee.findMany({ where: { id: { in: ids } }, select: { employeeCode: true } });
    return { ids, codes: rows.map((r) => r.employeeCode) };
  }

  private rows(where: Prisma.Sql, limit: number, offset: number): Promise<AuditRow[]> {
    // newest first by when it was written: the id follows the order of writing (audit_log.at is now() then too)
    return this.prisma.$queryRaw<AuditRow[]>`
      SELECT a.id, a.user_id AS "userId", a.on_behalf_by AS "onBehalfById", a.via, a.action, a.entity_type AS "entityType",
        a.entity_id AS "entityId", a.diff, a.at
      FROM audit_log a
      ${where}
      ORDER BY a.id DESC
      LIMIT ${Prisma.raw(String(Math.trunc(limit)))} OFFSET ${Prisma.raw(String(Math.trunc(offset)))}`;
  }

  private async count(where: Prisma.Sql): Promise<number> {
    const [{ n }] = await this.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log a ${where}`;
    return Number(n);
  }

  // ---------- the entries in words ----------

  /** The rows for reading; one about a person hidden from the caller is left out (none for the two roles here). */
  private async views(rows: AuditRow[], user: SessionUser, hidden: ReadonlySet<string>): Promise<AuditEntryView[]> {
    const read = rows.map((r) => ({ ...r, at: r.at instanceof Date ? r.at : new Date(r.at) }));
    const refs = await this.refs(read);
    return read.map((r) => entryView(r, refs, user.roles)).filter((e) => !(e.employee && hidden.has(e.employee.id)));
  }

  /** What the rows name, read in a few queries per kind of record. */
  private async refs(rows: AuditRow[]): Promise<AuditRefs> {
    const byType = new Map<string, Set<string>>();
    const add = (type: string, id: string | null | undefined) => {
      if (!isUuid(id)) return;
      if (!byType.has(type)) byType.set(type, new Set());
      byType.get(type)!.add(id.toLowerCase());
    };
    const inDiffs = new Set<string>();
    const codes = new Set<string>();
    const userIds = new Set<string>();
    for (const r of rows) {
      add(r.entityType, r.entityId);
      const diff = r.diff as Record<string, unknown> | null;
      if (diff && typeof diff === 'object' && !Array.isArray(diff)) add('employment', diff.employmentId as string | undefined);
      idsIn(r.diff, inDiffs);
      const code = codeIn(r.diff);
      if (code) codes.add(code);
      if (r.userId) userIds.add(r.userId);
      if (r.onBehalfById) userIds.add(r.onBehalfById);
    }

    const records = new Map<string, AuditRecord>();
    await Promise.all(
      [...byType].map(async ([type, ids]) => {
        const read = this.lookups[type];
        if (!read) return;
        for (const [id, record] of await chunked(ids, read)) records.set(recordKey(type, id), record);
      }),
    );

    const employeeIds = new Set<string>([...(byType.get('employee') ?? []), ...inDiffs]);
    for (const r of records.values()) if (r.employeeId) employeeIds.add(r.employeeId);
    const select = { id: true, employeeCode: true, fullNameEn: true } as const;
    const [byId, byCode, people, names] = await Promise.all([
      chunked(employeeIds, (ids) => this.prisma.employee.findMany({ where: { id: { in: ids } }, select })),
      chunked(codes, (part) => this.prisma.employee.findMany({ where: { employeeCode: { in: part } }, select })),
      this.people([...userIds, ...inDiffs]),
      this.names(inDiffs),
    ]);
    const employees = new Map(byId.map((e) => [e.id, e]));
    for (const e of byCode) employees.set(e.id, e);
    for (const e of employees.values()) names.set(e.id, `${e.fullNameEn} (${e.employeeCode})`);
    for (const p of people.values()) names.set(p.id, personName(p));
    return { users: people, employees, employeesByCode: new Map([...employees.values()].map((e) => [e.employeeCode, e])), records, names };
  }

  /** Accounts by id, each with the name of the employee whose work email it is. Ids that aren't accounts are skipped. */
  private async people(ids: Iterable<string>): Promise<Map<string, AuditPerson>> {
    const users = await chunked(ids, (part) => this.prisma.user.findMany({ where: { id: { in: part } }, select: { id: true, email: true } }));
    const owners = await chunked(
      users.map((u) => u.email.toLowerCase()),
      (part) => this.prisma.employee.findMany({ where: { workEmail: { in: part } }, select: { workEmail: true, fullNameEn: true } }),
    );
    const nameOf = new Map(owners.map((o) => [o.workEmail!, o.fullNameEn]));
    return new Map(users.map((u) => [u.id, { id: u.id, email: u.email, name: nameOf.get(u.email.toLowerCase()) ?? null }]));
  }

  /** The names of the organisation's records an entry's diff names by id: a department, a job title, a grade … */
  private async names(ids: ReadonlySet<string>): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!ids.size) return out;
    const p = this.prisma;
    const where = (part: string[]) => ({ where: { id: { in: part } } });
    const [departments, jobTitles, grades, shifts, runs, allowances, leaveTypes, reimbursementTypes, assets, rooms, kits] = await Promise.all([
      chunked(ids, (part) => p.department.findMany({ ...where(part), select: { id: true, nameEn: true } })),
      chunked(ids, (part) => p.jobTitle.findMany({ ...where(part), select: { id: true, titleEn: true } })),
      chunked(ids, (part) => p.grade.findMany({ ...where(part), select: { id: true, code: true, levelEn: true } })),
      chunked(ids, (part) => p.shift.findMany({ ...where(part), select: { id: true, code: true } })),
      chunked(ids, (part) => p.payrollRun.findMany({ ...where(part), select: { id: true, month: true } })),
      chunked(ids, (part) => p.allowanceType.findMany({ ...where(part), select: { id: true, nameEn: true } })),
      chunked(ids, (part) => p.leaveType.findMany({ ...where(part), select: { id: true, nameEn: true } })),
      chunked(ids, (part) => p.reimbursementType.findMany({ ...where(part), select: { id: true, nameEn: true } })),
      // Assets (21 October 2026): a photo's asset, an asset's room and kit
      chunked(ids, (part) => p.asset.findMany({ ...where(part), select: { id: true, code: true, name: true } })),
      chunked(ids, (part) => p.assetRoom.findMany({ ...where(part), select: { id: true, name: true } })),
      chunked(ids, (part) => p.assetKit.findMany({ ...where(part), select: { id: true, code: true, name: true } })),
    ]);
    for (const d of departments) out.set(d.id, d.nameEn);
    for (const a of assets) out.set(a.id, `${a.code} · ${a.name}`);
    for (const r of rooms) out.set(r.id, r.name);
    for (const k of kits) out.set(k.id, `${k.code} · ${k.name}`);
    for (const j of jobTitles) out.set(j.id, j.titleEn);
    for (const g of grades) out.set(g.id, `${g.code} · ${g.levelEn}`);
    for (const s of shifts) out.set(s.id, `Shift ${s.code}`);
    for (const r of runs) out.set(r.id, `Payroll ${monthOf(r.month)}`);
    for (const a of [...allowances, ...leaveTypes, ...reimbursementTypes]) out.set(a.id, a.nameEn);
    return out;
  }

  /** The filters asked for in words, for the workbook's About sheet. */
  private async filterLines(query: AuditQueryDto): Promise<FilterLine[]> {
    const lines: FilterLine[] = [];
    if (query.from) lines.push({ label: 'From', value: shownDate(query.from) });
    if (query.to) lines.push({ label: 'To', value: shownDate(query.to) });
    if (query.userId) {
      const who = (await this.people([query.userId])).get(query.userId);
      lines.push({ label: 'Who', value: who ? personName(who) : query.userId });
    }
    if (query.action) lines.push({ label: 'Action', value: actionLabel(query.action) });
    if (query.entityType) lines.push({ label: 'Record', value: entityLabel(query.entityType) });
    if (query.entityId) lines.push({ label: 'Record ID', value: query.entityId });
    if (query.employeeId) {
      const e = await this.prisma.employee.findUnique({ where: { id: query.employeeId }, select: { employeeCode: true, fullNameEn: true } });
      lines.push({ label: 'Employee', value: e ? `${e.fullNameEn} (${e.employeeCode})` : query.employeeId });
    }
    if (query.q) lines.push({ label: 'Search', value: query.q });
    if (query.before) lines.push({ label: 'Older than entry', value: query.before });
    return lines;
  }
}

/**
 * How each kind of record is read: the person it belongs to and its own words, by its ids (those deleted since aren't
 * found). A final settlement's entries are on its employment's id.
 */
function recordLookups(p: PrismaService): Readonly<Record<string, Lookup>> {
  const by = (ids: string[]) => ({ where: { id: { in: ids } } });
  const owned = (rows: { id: string; employeeId: string | null }[]): [string, AuditRecord][] => rows.map((r) => [r.id, { employeeId: r.employeeId }]);
  const named = (rows: { id: string; nameEn: string }[]): [string, AuditRecord][] => rows.map((r) => [r.id, { reference: r.nameEn }]);
  const owner = { id: true, employeeId: true } as const;
  const employment = async (ids: string[]) => owned(await p.employment.findMany({ ...by(ids), select: owner }));
  return {
    employment,
    final_settlement: employment,
    contract: async (ids) =>
      (await p.contract.findMany({ ...by(ids), select: { id: true, number: true, employment: { select: { employeeId: true } } } })).map((r) => [
        r.id,
        { employeeId: r.employment.employeeId, reference: r.number },
      ]),
    employment_ending: async (ids) =>
      (await p.employmentEnding.findMany({ ...by(ids), select: { id: true, employment: { select: { employeeId: true } } } })).map((r) => [r.id, { employeeId: r.employment.employeeId }]),
    raise_request: async (ids) => owned(await p.raiseRequest.findMany({ ...by(ids), select: owner })),
    generated_document: async (ids) => owned(await p.generatedDocument.findMany({ ...by(ids), select: owner })),
    paperwork: async (ids) => owned(await p.paperworkItem.findMany({ ...by(ids), select: owner })),
    payroll_adjustment: async (ids) => owned(await p.payrollAdjustment.findMany({ ...by(ids), select: owner })),
    payroll_advance: async (ids) => owned(await p.payrollAdvance.findMany({ ...by(ids), select: owner })),
    recurring_deduction: async (ids) => owned(await p.recurringDeduction.findMany({ ...by(ids), select: owner })),
    leave_request: async (ids) => owned(await p.leaveRequest.findMany({ ...by(ids), select: owner })),
    permission_request: async (ids) => owned(await p.permissionRequest.findMany({ ...by(ids), select: owner })),
    wfh_request: async (ids) => owned(await p.wfhRequest.findMany({ ...by(ids), select: owner })),
    attendance_correction: async (ids) => owned(await p.attendanceCorrection.findMany({ ...by(ids), select: owner })),
    attendance_day: async (ids) => owned(await p.attendanceDay.findMany({ ...by(ids), select: owner })),
    leave_adjustment: async (ids) => owned(await p.leaveAdjustment.findMany({ ...by(ids), select: owner })),
    reimbursement_claim: async (ids) => owned(await p.reimbursementClaim.findMany({ ...by(ids), select: owner })),
    profile_confirmation: async (ids) => owned(await p.profileConfirmation.findMany({ ...by(ids), select: owner })),
    profile_change_request: async (ids) => owned(await p.profileChangeRequest.findMany({ ...by(ids), select: owner })),
    payroll_line: async (ids) =>
      (await p.payrollLine.findMany({ ...by(ids), select: { id: true, employeeId: true, runId: true, run: { select: { month: true } } } })).map((r) => [
        r.id,
        { employeeId: r.employeeId, runId: r.runId, reference: monthOf(r.run.month) },
      ]),
    payroll_run: async (ids) => (await p.payrollRun.findMany({ ...by(ids), select: { id: true, month: true } })).map((r) => [r.id, { reference: monthOf(r.month) }]),
    attendance_import: async (ids) =>
      (await p.attendanceImport.findMany({ ...by(ids), select: { id: true, runId: true, month: true } })).map((r) => [r.id, { runId: r.runId, reference: monthOf(r.month) }]),
    leave_document: async (ids) =>
      (await p.leaveDocument.findMany({ ...by(ids), select: { id: true, requestId: true, request: { select: { employeeId: true } } } })).map((r) => [
        r.id,
        { employeeId: r.request.employeeId, parentId: r.requestId },
      ]),
    reimbursement_receipt: async (ids) =>
      (await p.reimbursementReceipt.findMany({ ...by(ids), select: { id: true, claimId: true, claim: { select: { employeeId: true } } } })).map((r) => [
        r.id,
        { employeeId: r.claim.employeeId, parentId: r.claimId },
      ]),
    job_offer: async (ids) =>
      (await p.jobOffer.findMany({ ...by(ids), select: { id: true, number: true, employeeId: true } })).map((r) => [r.id, { employeeId: r.employeeId, reference: r.number }]),
    template_version: async (ids) => (await p.templateVersion.findMany({ ...by(ids), select: { id: true, slotKey: true } })).map((r) => [r.id, { slot: r.slotKey, reference: r.slotKey }]),
    user: async (ids) => (await p.user.findMany({ ...by(ids), select: { id: true, email: true } })).map((r) => [r.id, { reference: r.email }]),
    department: async (ids) => named(await p.department.findMany({ ...by(ids), select: { id: true, nameEn: true } })),
    job_title: async (ids) => (await p.jobTitle.findMany({ ...by(ids), select: { id: true, titleEn: true } })).map((r) => [r.id, { reference: r.titleEn }]),
    // KPIs (owner, 21 October 2026): a scorecard's person and month; a template's job title and version
    kpi_scorecard: async (ids) =>
      (await p.kpiScorecard.findMany({ ...by(ids), select: { id: true, employeeId: true, month: true } })).map((r) => [r.id, { employeeId: r.employeeId, reference: monthOf(r.month) }]),
    kpi_template: async (ids) =>
      (await p.kpiTemplate.findMany({ ...by(ids), select: { id: true, jobTitleId: true, version: true, jobTitle: { select: { titleEn: true } } } })).map((r) => [
        r.id,
        { parentId: r.jobTitleId, reference: `${r.jobTitle.titleEn} v${r.version}` },
      ]),
    // Assets (21 October 2026): an asset's code; a photo's asset (its code); a room's name; a kit's code and name
    asset: async (ids) => (await p.asset.findMany({ ...by(ids), select: { id: true, code: true } })).map((r) => [r.id, { reference: r.code }]),
    asset_photo: async (ids) =>
      (await p.assetPhoto.findMany({ ...by(ids), select: { id: true, assetId: true, asset: { select: { code: true } } } })).map((r) => [r.id, { parentId: r.assetId, reference: r.asset.code }]),
    asset_room: async (ids) => (await p.assetRoom.findMany({ ...by(ids), select: { id: true, name: true } })).map((r) => [r.id, { reference: r.name }]),
    asset_kit: async (ids) => (await p.assetKit.findMany({ ...by(ids), select: { id: true, code: true, name: true } })).map((r) => [r.id, { reference: `${r.code} · ${r.name}` }]),
    // custody (Assets step 3, 21 October 2026): a record's person and code
    custody_record: async (ids) =>
      (await p.custodyRecord.findMany({ ...by(ids), select: { id: true, code: true, employeeId: true } })).map((r) => [r.id, { employeeId: r.employeeId, reference: r.code }]),
    grade: async (ids) => (await p.grade.findMany({ ...by(ids), select: { id: true, code: true, levelEn: true } })).map((r) => [r.id, { reference: `${r.code} · ${r.levelEn}` }]),
    shift: async (ids) => (await p.shift.findMany({ ...by(ids), select: { id: true, code: true } })).map((r) => [r.id, { reference: `Shift ${r.code}` }]),
    allowance_type: async (ids) => named(await p.allowanceType.findMany({ ...by(ids), select: { id: true, nameEn: true } })),
    leave_type: async (ids) => named(await p.leaveType.findMany({ ...by(ids), select: { id: true, nameEn: true } })),
    reimbursement_type: async (ids) => named(await p.reimbursementType.findMany({ ...by(ids), select: { id: true, nameEn: true } })),
  };
}

/** The query's filters for auditWhere (the person apart: `about`). */
function filtersOf(q: AuditQueryDto): AuditFilters {
  const out: AuditFilters = {};
  for (const key of ['from', 'to', 'userId', 'action', 'entityType', 'entityId', 'q', 'before'] as const) if (q[key]) out[key] = q[key];
  return out;
}
