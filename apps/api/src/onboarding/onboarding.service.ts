import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CLEARANCE_ITEM_STATUS_LABELS,
  clearanceChecklistProblems,
  clearanceItemProblems,
  clearanceProgress,
  DEFAULT_ONBOARDING_ITEMS,
  isClearanceOwner,
  ONBOARDING_AUTO_ITEMS,
  type ClearanceDefaultView,
  type ClearanceItemStatus,
  type ClearanceOwner,
  type OnboardingItemView,
  type OnboardingKind,
  type OnboardingStatus,
  type OnboardingSummary,
  type OnboardingView,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { holdsOwner, managesOffboarding, marksItem, offboardingCaller, type OffboardingCaller } from '../offboarding/offboarding-access.js';
import type { AddItemDto, ChecklistDto, MarkItemDto } from '../offboarding/offboarding.dto.js';
import { placeName, userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { accountOfEmployee } from '../users/employee-accounts.js';

// Onboarding (owner, 22 October 2026, the ATS's Phase 2; the original plan's spec §12: "onboarding checklist (incl. ID &
// documents, JD sign-off, KPI template assignment)"; packages/shared onboarding.ts), offboarding's mirror:
// - A checklist per employment: opened when an applicant is hired through an accepted job offer (openForHire, by the
//   recruitment's offer hooks, never failing them), or by HR from a new employee's profile.
// - Its items: three the system ticks while it is open, read live (the contract signed, the job title's KPI template
//   published, something handed over in custody), then HR's default items (Onboarding Checklist), each cleared by its
//   owner (HR, the direct manager, an Admin, Finance, the Assets custodians: offboarding-access.ts) or by HR, the CEO or a
//   Super Admin. Completed by them once every item is cleared; the system's are kept as they stood.
// - Those who handle checklists are HR, the CEO and a Super Admin; a C-level person's only the CEO and a Super Admin
//   (owner, 19 October 2026: "make C level Employees details not visible to HR"): 404 for anyone else. Those who only
//   clear items read the checklist alone.
// Every change is audited; the item owners are told when a checklist opens.

export const ONBOARDING_ENTITY = 'onboarding_checklist';
export const ONBOARDING_DEFAULTS_ENTITY = 'onboarding_defaults';

const MAX_ITEMS = 30;
const NOT_FOUND = 'Onboarding checklist not found.';
const USER = { select: { id: true, email: true } } as const;

const INCLUDE = {
  employment: {
    select: {
      id: true,
      employeeId: true,
      jobTitleId: true,
      joinDate: true,
      managerId: true,
      employee: { select: { id: true, employeeCode: true, fullNameEn: true } },
      jobTitle: { select: { titleEn: true } },
      department: { select: { nameEn: true, parent: { select: { nameEn: true } } } },
    },
  },
  application: { select: { id: true, number: true } },
  items: { orderBy: { position: 'asc' }, include: { doneBy: USER } },
  completedBy: USER,
} satisfies Prisma.OnboardingChecklistInclude;

type Row = Prisma.OnboardingChecklistGetPayload<{ include: typeof INCLUDE }>;

/** What the system knows for the items it ticks: the contract signed, the KPI template published, something in custody. */
interface Live {
  contract: boolean;
  kpiTemplate: boolean;
  assets: boolean;
}

function itemStatus(row: Row, item: Row['items'][number], live: Live): ClearanceItemStatus {
  if (row.status !== 'open' || item.kind === 'manual') return item.status as ClearanceItemStatus;
  if (item.kind === 'contract') return live.contract ? 'done' : 'pending';
  if (item.kind === 'kpi_template') return live.kpiTemplate ? 'done' : 'pending';
  if (item.kind === 'assets') return live.assets ? 'done' : 'pending';
  return item.status as ClearanceItemStatus;
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger('Onboarding');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly notifications: NotificationsService,
  ) {}

  async caller(user: SessionUser): Promise<OffboardingCaller> {
    const [selfId, row] = await Promise.all([this.confidential.selfId(user), this.prisma.user.findUnique({ where: { id: user.id }, select: { assetsAccess: true } })]);
    return offboardingCaller(user, selfId, row?.assetsAccess);
  }

  private assertManages(user: SessionUser): void {
    if (!managesOffboarding(user)) throw new ForbiddenException('Only HR, the CEO and a Super Admin handle onboarding.');
  }

  // ---------- opening ----------

  /**
   * An applicant was hired through an accepted job offer (or their profile was made from it later): their current
   * employment's checklist opens, linked to the application. Never throws into the offer's flow: a failure is logged,
   * and HR can open it by hand.
   */
  async openForHire(employeeId: string, applicationId: string | null, openedById: string | null): Promise<void> {
    try {
      const employment = await this.prisma.employment.findFirst({ where: { employeeId, endDate: null }, orderBy: { joinDate: 'desc' }, select: { id: true } });
      if (employment) await this.open(employment.id, applicationId, openedById);
    } catch (err) {
      this.logger.error(`The onboarding of employee ${employeeId} could not be opened: ${(err as Error).message}`);
    }
  }

  /** HR (the CEO, a Super Admin) opens a checklist by hand, for an employment without one. */
  async openByHand(employmentId: string, user: SessionUser): Promise<OnboardingView> {
    this.assertManages(user);
    const employment = await this.prisma.employment.findUnique({ where: { id: employmentId }, select: { employeeId: true, endDate: true } });
    if (!employment) throw new NotFoundException('Employment not found.');
    await this.confidential.assertVisible(user, employment.employeeId, 'Employment not found.');
    if (employment.endDate) throw new ConflictException('This employment has ended: there is nobody to onboard.');
    if (await this.prisma.onboardingChecklist.count({ where: { employmentId } })) throw new ConflictException('This employment has an onboarding checklist already. Open it from Onboarding.');
    const application = await this.prisma.jobApplication.findFirst({ where: { employeeId: employment.employeeId, stage: 'hired' }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
    const id = await this.open(employmentId, application?.id ?? null, user.id);
    return this.get(id, user);
  }

  /** Opens the employment's checklist (none when it has one): the system's three items, then the defaults in force. Answers its id. */
  private async open(employmentId: string, applicationId: string | null, openedById: string | null): Promise<string> {
    const done = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`people-system onboarding ${employmentId}`}))`;
      const existing = await tx.onboardingChecklist.findUnique({ where: { employmentId }, select: { id: true } });
      if (existing) return { id: existing.id, opened: false };
      await this.ensureDefaults(tx);
      const defaults = await tx.onboardingDefault.findMany({ where: { active: true }, orderBy: { position: 'asc' }, select: { label: true, owner: true } });
      const items = [
        ...ONBOARDING_AUTO_ITEMS.map((a) => ({ kind: a.kind as OnboardingKind, label: a.label, owner: a.owner })),
        ...defaults.map((d) => ({ kind: 'manual' as OnboardingKind, label: d.label, owner: d.owner as ClearanceOwner })),
      ];
      const made = await tx.onboardingChecklist.create({
        data: { employmentId, applicationId, openedById, items: { create: items.map((i, n) => ({ ...i, position: n + 1 })) } },
        select: { id: true },
      });
      return { id: made.id, opened: true };
    });
    if (done.opened) {
      await this.audit.record({ userId: openedById, action: 'open_onboarding', entityType: ONBOARDING_ENTITY, entityId: done.id, diff: { employmentId, applicationId, status: 'open' } });
      await this.tellOpened(done.id);
    }
    return done.id;
  }

  /** Tells each item owner how many items wait for them (a C-level person's: the CEO and the Super Admins). */
  private async tellOpened(id: string): Promise<void> {
    try {
      const row = await this.row(id);
      const live = (await this.live([row])).get(row.id)!;
      const pending = row.items.filter((i) => itemStatus(row, i, live) === 'pending');
      const out = new Map<string, number>();
      const add = (ids: readonly string[], n: number) => {
        for (const u of ids) out.set(u, (out.get(u) ?? 0) + n);
      };
      const count = (owner: ClearanceOwner) => pending.filter((i) => i.owner === owner).length;
      if ((await this.confidential.ids()).has(row.employment.employeeId)) {
        if (pending.length) add(await this.usersWithRoles(['ceo', 'super_admin']), pending.length);
      } else {
        if (count('hr')) add(await this.usersWithRoles(['hr']), count('hr'));
        if (count('admin')) add(await this.usersWithRoles(['admin', 'super_admin']), count('admin'));
        if (count('finance')) add(await this.usersWithRoles(['finance']), count('finance'));
        if (count('assets')) {
          const custodians = await this.prisma.user.findMany({
            where: { isActive: true, OR: [{ assetsAccess: { in: ['custodian', 'manager'] } }, { roles: { some: { role: { key: 'super_admin' } } } }] },
            select: { id: true },
          });
          add(
            custodians.map((u) => u.id),
            count('assets'),
          );
        }
        if (count('manager') && row.employment.managerId) {
          // the manager's account by its link (users.employee_id, 22 October 2026: never by email)
          const u = await accountOfEmployee(this.prisma, row.employment.managerId);
          if (u?.isActive) add([u.id], count('manager'));
        }
      }
      const name = row.employment.employee.fullNameEn;
      const groups = new Map<number, string[]>();
      for (const [userId, n] of out) groups.set(n, [...(groups.get(n) ?? []), userId]);
      for (const [n, userIds] of groups) {
        await this.notifications.notify(userIds, { kind: 'onboarding_items', title: `Onboarding for ${name}`, body: `${n} ${n === 1 ? 'item' : 'items'} for you`, link: `/onboarding/${id}` });
      }
    } catch (err) {
      this.logger.warn(`The owners of onboarding ${id} could not be told: ${(err as Error).message}`);
    }
  }

  private async usersWithRoles(keys: string[]): Promise<string[]> {
    const rows = await this.prisma.user.findMany({ where: { isActive: true, roles: { some: { role: { key: { in: keys } } } } }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  // ---------- reading ----------

  private async row(id: string): Promise<Row> {
    const row = await this.prisma.onboardingChecklist.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private async visibleRow(id: string, caller: OffboardingCaller): Promise<Row> {
    const row = await this.row(id);
    if (!caller.seesConfidential && (await this.confidential.ids()).has(row.employment.employeeId)) throw new NotFoundException(NOT_FOUND);
    if (caller.manages) return row;
    if (row.items.some((i) => isClearanceOwner(i.owner) && holdsOwner(caller, i.owner, row.employment.managerId))) return row;
    throw new NotFoundException(NOT_FOUND);
  }

  /** What the system reads for the three items it ticks, per checklist. */
  private async live(rows: readonly Row[]): Promise<Map<string, Live>> {
    const employmentIds = rows.map((r) => r.employment.id);
    const employeeIds = [...new Set(rows.map((r) => r.employment.employeeId))];
    const jobTitleIds = [...new Set(rows.map((r) => r.employment.jobTitleId).filter((x): x is string => !!x))];
    const [contracts, templates, held] = await Promise.all([
      employmentIds.length ? this.prisma.contract.findMany({ where: { employmentId: { in: employmentIds }, status: 'active' }, select: { employmentId: true } }) : [],
      jobTitleIds.length ? this.prisma.kpiTemplate.findMany({ where: { jobTitleId: { in: jobTitleIds }, status: 'published' }, select: { jobTitleId: true } }) : [],
      employeeIds.length ? this.prisma.asset.findMany({ where: { holderId: { in: employeeIds }, status: 'custody' }, select: { holderId: true } }) : [],
    ]);
    const signed = new Set(contracts.map((c) => c.employmentId));
    const published = new Set(templates.map((t) => t.jobTitleId));
    const holding = new Set(held.map((a) => a.holderId));
    return new Map(
      rows.map((r) => [
        r.id,
        { contract: signed.has(r.employment.id), kpiTemplate: !!r.employment.jobTitleId && published.has(r.employment.jobTitleId), assets: holding.has(r.employment.employeeId) },
      ]),
    );
  }

  private summaryOf(r: Row, live: Live): OnboardingSummary {
    return {
      id: r.id,
      status: r.status as OnboardingStatus,
      employee: { id: r.employment.employee.id, employeeCode: r.employment.employee.employeeCode, fullNameEn: r.employment.employee.fullNameEn },
      employmentId: r.employment.id,
      jobTitle: r.employment.jobTitle?.titleEn ?? null,
      department: placeName(r.employment.department),
      joinDate: fromDateOnly(r.employment.joinDate),
      openedAt: r.openedAt.toISOString(),
      application: r.application,
      progress: clearanceProgress(r.items.map((i) => ({ status: itemStatus(r, i, live) }))),
    };
  }

  /** The checklists: open ones unless `status` says otherwise, newest first; for HR, the CEO and a Super Admin (C-level ones for the CEO and a Super Admin). */
  async list(status: OnboardingStatus | 'all' | undefined, user: SessionUser): Promise<OnboardingSummary[]> {
    this.assertManages(user);
    const hidden = await this.confidential.hiddenFrom(user);
    const rows = await this.prisma.onboardingChecklist.findMany({
      where: { ...(status === 'all' ? {} : { status: status ?? 'open' }), ...(hidden.length && { employment: { employeeId: { notIn: hidden } } }) },
      orderBy: { openedAt: 'desc' },
      include: INCLUDE,
      take: 500,
    });
    const live = await this.live(rows);
    return rows.map((r) => this.summaryOf(r, live.get(r.id)!));
  }

  /** A person's latest checklist, for their profile (those who handle onboarding): null without one, or for a C-level person hidden from the caller. */
  async forEmployee(employeeId: string, user: SessionUser): Promise<OnboardingSummary | null> {
    this.assertManages(user);
    if (await this.confidential.isHidden(user, employeeId)) return null;
    const row = await this.prisma.onboardingChecklist.findFirst({ where: { employment: { employeeId } }, orderBy: { openedAt: 'desc' }, include: INCLUDE });
    if (!row) return null;
    return this.summaryOf(row, (await this.live([row])).get(row.id)!);
  }

  /** A checklist's page: in full for those who handle onboarding, for an item owner too (marking theirs); else 404. */
  async get(id: string, user: SessionUser): Promise<OnboardingView> {
    const caller = await this.caller(user);
    const row = await this.visibleRow(id, caller);
    const live = (await this.live([row])).get(row.id)!;
    const names = await userNames(this.prisma, [...row.items.map((i) => i.doneBy), row.completedBy]);
    const open = row.status === 'open';
    const items: OnboardingItemView[] = row.items.map((i) => {
      const status = itemStatus(row, i, live);
      const auto = i.kind !== 'manual';
      return {
        id: i.id,
        kind: i.kind as OnboardingKind,
        label: i.label,
        owner: i.owner as ClearanceOwner,
        status,
        doneBy: status === 'pending' ? null : auto && !i.doneBy ? 'The system' : i.doneBy ? (names.get(i.doneBy.id)?.name ?? i.doneBy.email) : null,
        doneAt: status === 'pending' ? null : (i.doneAt?.toISOString() ?? null),
        note: i.note,
        canMark: marksItem(caller, { kind: i.kind, owner: i.owner as ClearanceOwner }, row.employment.managerId, open),
      };
    });
    return {
      ...this.summaryOf(row, live),
      items,
      completedAt: row.completedAt?.toISOString() ?? null,
      completedBy: row.completedBy ? (names.get(row.completedBy.id)?.name ?? row.completedBy.email) : null,
      can: { manage: caller.manages, complete: caller.manages && open, addItem: caller.manages && open },
    };
  }

  // ---------- the items ----------

  /** Clears an item (done, not applicable) or puts it back to pending: its owner, or HR, the CEO, a Super Admin. */
  async markItem(id: string, itemId: string, dto: MarkItemDto, user: SessionUser): Promise<OnboardingView> {
    const caller = await this.caller(user);
    const row = await this.visibleRow(id, caller);
    const item = row.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Item not found.');
    if (row.status !== 'open') throw new ConflictException('This checklist is completed: its items can’t change.');
    if (item.kind !== 'manual') {
      throw new BadRequestException(
        item.kind === 'contract'
          ? '“Contract signed” is ticked by the system once their contract is signed.'
          : item.kind === 'kpi_template'
            ? '“KPI template in place” is ticked by the system once their job title’s KPI template is published.'
            : '“Equipment handed over” is ticked by the system once something is handed over to them on Custody.',
      );
    }
    if (!marksItem(caller, { kind: item.kind, owner: item.owner as ClearanceOwner }, row.employment.managerId, true)) throw new ForbiddenException('This item is cleared by someone else.');
    const note = dto.note === undefined ? item.note : dto.note;
    if (item.status === dto.status && note === item.note) return this.get(id, user);
    const cleared = dto.status !== 'pending';
    await this.prisma.onboardingItem.update({ where: { id: itemId }, data: { status: dto.status, note, doneById: cleared ? user.id : null, doneAt: cleared ? new Date() : null } });
    await this.audit.record({
      userId: user.id,
      action: 'mark_onboarding_item',
      entityType: ONBOARDING_ENTITY,
      entityId: id,
      diff: { item: item.label, status: { from: CLEARANCE_ITEM_STATUS_LABELS[item.status as ClearanceItemStatus], to: CLEARANCE_ITEM_STATUS_LABELS[dto.status] }, ...(note !== item.note && { note: { from: item.note, to: note } }) },
    });
    return this.get(id, user);
  }

  /** HR adds a one-off item to an open checklist. */
  async addItem(id: string, dto: AddItemDto, user: SessionUser): Promise<OnboardingView> {
    this.assertManages(user);
    const row = await this.visibleRow(id, await this.caller(user));
    if (row.status !== 'open') throw new ConflictException('Only an open checklist takes new items.');
    const label = dto.label.trim().replace(/\s+/g, ' ');
    const problems = clearanceItemProblems({ label, owner: dto.owner });
    if (problems.length) throw new BadRequestException(problems);
    if (row.items.length >= MAX_ITEMS) throw new BadRequestException(`A checklist takes at most ${MAX_ITEMS} items.`);
    if (row.items.some((i) => i.label.toLowerCase() === label.toLowerCase())) throw new BadRequestException('This checklist has an item with that name already.');
    const position = Math.max(0, ...row.items.map((i) => i.position)) + 1;
    await this.prisma.onboardingItem.create({ data: { checklistId: id, position, kind: 'manual', label, owner: dto.owner } });
    await this.audit.record({ userId: user.id, action: 'add_onboarding_item', entityType: ONBOARDING_ENTITY, entityId: id, diff: { item: label, owner: dto.owner } });
    return this.get(id, user);
  }

  /** Completes a checklist once every item is cleared; the system's items are kept as they stand. */
  async complete(id: string, user: SessionUser): Promise<OnboardingView> {
    this.assertManages(user);
    const row = await this.visibleRow(id, await this.caller(user));
    if (row.status !== 'open') throw new ConflictException('This checklist is completed already.');
    const live = (await this.live([row])).get(row.id)!;
    const statuses = row.items.map((i) => ({ item: i, status: itemStatus(row, i, live) }));
    const pending = statuses.filter((s) => s.status === 'pending');
    if (pending.length) throw new BadRequestException([`Still pending: ${pending.map((p) => p.item.label).join(', ')}. Clear every item first.`]);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const s of statuses) {
        if (s.item.kind === 'manual' || s.item.status !== 'pending') continue;
        await tx.onboardingItem.update({ where: { id: s.item.id }, data: { status: s.status, doneAt: now } });
      }
      const { count } = await tx.onboardingChecklist.updateMany({ where: { id, status: 'open' }, data: { status: 'completed', completedAt: now, completedById: user.id } });
      if (!count) throw new ConflictException('This checklist changed meanwhile. Reload the page.');
    });
    await this.audit.record({ userId: user.id, action: 'complete', entityType: ONBOARDING_ENTITY, entityId: id, diff: { status: { from: 'open', to: 'completed' } } });
    return this.get(id, user);
  }

  // ---------- HR's default items ----------

  async checklist(): Promise<ClearanceDefaultView[]> {
    await this.ensureDefaults();
    const rows = await this.prisma.onboardingDefault.findMany({ where: { active: true }, orderBy: { position: 'asc' } });
    return rows.map((r) => ({ id: r.id, label: r.label, owner: r.owner as ClearanceOwner }));
  }

  /** HR replaces the default items: those kept by id, new ones added, the others switched off. Open checklists keep theirs. */
  async saveChecklist(dto: ChecklistDto, user: SessionUser): Promise<ClearanceDefaultView[]> {
    this.assertManages(user);
    const items = (Array.isArray(dto.items) ? dto.items : []).map((i) => ({
      id: typeof i?.id === 'string' ? i.id : null,
      label: typeof i?.label === 'string' ? i.label.trim().replace(/\s+/g, ' ') : i?.label,
      owner: i?.owner,
    }));
    const problems = clearanceChecklistProblems(items);
    if (problems.length) throw new BadRequestException(problems);
    const before = await this.checklist();
    const known = new Set((await this.prisma.onboardingDefault.findMany({ select: { id: true } })).map((r) => r.id));
    await this.prisma.$transaction(async (tx) => {
      await tx.onboardingDefault.updateMany({ where: { active: true }, data: { active: false, updatedById: user.id } });
      let position = 1;
      for (const i of items) {
        const data = { label: i.label as string, owner: i.owner as ClearanceOwner, position: position++, active: true, updatedById: user.id };
        if (i.id && known.has(i.id)) await tx.onboardingDefault.update({ where: { id: i.id }, data });
        else await tx.onboardingDefault.create({ data });
      }
    });
    const after = await this.checklist();
    const words = (list: ClearanceDefaultView[]) => list.map((i) => `${i.label} (${i.owner})`);
    await this.audit.record({ userId: user.id, action: 'update', entityType: ONBOARDING_DEFAULTS_ENTITY, diff: { items: { from: words(before), to: words(after) } } });
    return after;
  }

  /** The brief's default items, made by the migration, and here when the table has no row at all (the tests' database). */
  private async ensureDefaults(db: PrismaService | Prisma.TransactionClient = this.prisma): Promise<void> {
    if (await db.onboardingDefault.count()) return;
    await db.onboardingDefault.createMany({ data: DEFAULT_ONBOARDING_ITEMS.map((d, i) => ({ position: i + 1, label: d.label, owner: d.owner })) });
  }
}
