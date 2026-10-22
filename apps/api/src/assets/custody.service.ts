import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  accessoriesBackProblems,
  accessoriesGoingOut,
  accessoriesOutOf,
  accessoriesText,
  accessoryText,
  attachedSkipReason,
  missingAccessories,
  type AccessoryOut,
  assetActionsOf,
  assetsAccessAtLeast,
  CUSTODY_CODE_PREFIX,
  CUSTODY_FILTERS,
  CUSTODY_PAGE_SIZE,
  createsCustodyDeduction,
  custodyCode,
  custodyStatusOf,
  handoverProblems,
  handOverProblem,
  isCustodyCode,
  isOverdue,
  kitQuickAdd,
  kitSkipReason,
  normalAssetCode,
  normalCustodyCode,
  returnedDamagedNote,
  STATUS_ON_RETURN,
  type AssetCondition,
  type AssetHistoryView,
  type AssetStatus,
  type CustodyFilter,
  type CustodyKind,
  type CustodyListView,
  type CustodyRecordView,
  type CustodyStatus,
  type HandoverChoices,
  type HandoverResult,
  type HolderCardView,
  type HoldingsView,
  type KitSkip,
  type MaintenanceEvent,
  type MaintenanceKind,
  type MyCustodyView,
  type ReturnCondition,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { nextCodeNumber } from './asset-codes.js';
import { AssetSettingsService } from './asset-settings.service.js';
import type { AssetsCaller } from './assets-access.js';
import { ASSET_ENTITY, ASSET_NOT_FOUND } from './assets.service.js';
import type { CustodyListQueryDto, HandoverDto, ReturnDto } from './custody.dto.js';
import { CustodyNoticesService } from './custody-notices.service.js';
import {
  FILE_REF,
  fileRef,
  HELD,
  heldView,
  ITEM,
  itemView,
  lateness,
  money,
  NEWEST_EMPLOYMENT,
  PERSON,
  PERSON_DETAIL,
  personView,
  RECORD_DETAIL,
  RECORD_ROW,
  returnsOf,
  rowView,
  sumOf,
  userRef,
  usersOf,
  type RecordDetail,
} from './custody-views.js';

// Custody (Assets step 3, owner, 21 October 2026: the "Asset Register" spec's custody, built the People System's way;
// packages/shared custody.ts has the rules). A custodian or a manager hands assets over to a current employee, for a
// shoot (with its return date) or as a long-term assignment: only available assets that aren't consumables (spec §6.1),
// a kit's available ones at once with the others skipped and said why (§6.3); the record gets its code CUS-0042 from the
// counters in the same transaction (race-safe), the terms in force as a snapshot, and each item its condition and
// accessories as it went out and its market value then (a value: shown to the CEO, Finance and a Super Admin only); the
// assets go into custody with their holder and record. They come back item by item (§6.4): good → available; damaged →
// under repair with a maintenance entry "Returned damaged on CUS-xxxx by {name}"; missing → lost; the holder cleared, who
// received it and when kept with notes; the record partly returned or closed. The lists (Active, Overdue, Not signed,
// Closed, All), a record's page, the holdings search and a person's holdings, an asset's custody history and
// maintenance log, and the person's own (owner, 21 October 2026: "Yes, My custody"), read only and without values. C-level
// people's records only for those who see them (owner, 19 October 2026: "make C level Employees details not visible to
// HR"): 404 and left out of every list for anyone else, and never handed over to by them. Every write is audited; the
// employee is told of their handover and returns.

export const CUSTODY_ENTITY = 'custody_record';
export const CUSTODY_NOT_FOUND = 'Custody record not found.';
const EMPLOYEE_NOT_FOUND = 'Employee not found.';
const OPEN: CustodyStatus[] = ['open', 'partial'];

/** An employment not ended by today: the person is a current employee. */
const currentEmployment = (today: string): Prisma.EmploymentWhereInput => ({ OR: [{ endDate: null }, { endDate: { gte: toDateOnly(today) } }] });

/**
 * An item that stays on the person's record (spec §6.4): returned damaged or missing, or (step 4, owner, 22 October
 * 2026: accessories) back without some of its accessories.
 */
function isIncident(i: { returnCondition: string | null; accessoriesMissing: Prisma.JsonValue | null }): boolean {
  return i.returnCondition === 'damaged' || i.returnCondition === 'missing' || (i.returnCondition !== null && accessoriesOutOf(i.accessoriesMissing).length > 0);
}

/** The records of the people the caller may see. */
const visibleRecords = (hidden: readonly string[]): Prisma.CustodyRecordWhereInput => (hidden.length ? { employeeId: { notIn: [...hidden] } } : {});

/** A filter of the Custody list as a query (packages/shared inCustodyFilter says the same in code). */
function filterWhere(filter: CustodyFilter, today: string): Prisma.CustodyRecordWhereInput {
  switch (filter) {
    case 'active':
      return { status: { in: OPEN } };
    case 'overdue':
      return { kind: 'shoot', status: { in: OPEN }, dueDate: { lt: toDateOnly(today) } };
    case 'unsigned':
      return { files: { none: {} } };
    case 'closed':
      return { status: 'closed' };
    case 'all':
      return {};
  }
}

/** The search: the record's code or purpose, or the name or code of whose it is. */
function searchWhere(q: string | undefined): Prisma.CustodyRecordWhereInput {
  if (!q) return {};
  const contains = { contains: q, mode: 'insensitive' as const };
  return { OR: [{ code: contains }, { purpose: contains }, { employee: { is: { OR: [{ fullNameEn: contains }, { fullNameAr: contains }, { employeeCode: contains }] } } }] };
}

@Injectable()
export class CustodyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: AssetSettingsService,
    private readonly confidential: ConfidentialService,
    private readonly notices: CustodyNoticesService,
  ) {}

  // ---------- the lists ----------

  /** GET /assets/custody: a page of the filter asked for (Active unless asked), with every filter's count over the search. */
  async list(q: CustodyListQueryDto, caller: AssetsCaller): Promise<CustodyListView> {
    const today = todayInCairo();
    const hidden = await this.confidential.hiddenFrom(caller.user);
    const base: Prisma.CustodyRecordWhereInput = { AND: [visibleRecords(hidden), searchWhere(q.q)] };
    const filter = q.filter ?? 'active';
    const where: Prisma.CustodyRecordWhereInput = { AND: [base, filterWhere(filter, today)] };
    const page = q.page ?? 1;
    const orderBy: Prisma.CustodyRecordOrderByWithRelationInput[] = filter === 'overdue' ? [{ dueDate: 'asc' }, { outAt: 'asc' }] : [{ outAt: 'desc' }, { code: 'desc' }];
    const [total, rows, counts] = await Promise.all([
      this.prisma.custodyRecord.count({ where }),
      this.prisma.custodyRecord.findMany({ where, select: RECORD_ROW, orderBy, skip: (page - 1) * CUSTODY_PAGE_SIZE, take: CUSTODY_PAGE_SIZE }),
      Promise.all(CUSTODY_FILTERS.map((f) => this.prisma.custodyRecord.count({ where: { AND: [base, filterWhere(f, today)] } }))),
    ]);
    return {
      items: rows.map((r) => rowView(r, today)),
      total,
      page,
      pageSize: CUSTODY_PAGE_SIZE,
      counts: Object.fromEntries(CUSTODY_FILTERS.map((f, i) => [f, counts[i]])) as Record<CustodyFilter, number>,
    };
  }

  // ---------- a record ----------

  /** GET /assets/custody/:code, its code as typed. */
  async get(code: string, caller: AssetsCaller): Promise<CustodyRecordView> {
    return this.view(await this.detail(code, caller.user), caller);
  }

  /** The record by its code, or 404: none with it, or a C-level person's for someone who may not see them. */
  async detail(code: string, user: SessionUser): Promise<RecordDetail> {
    const normal = normalCustodyCode(code);
    const row = isCustodyCode(normal) ? await this.prisma.custodyRecord.findUnique({ where: { code: normal }, select: RECORD_DETAIL }) : null;
    if (!row || (await this.confidential.isHidden(user, row.employeeId))) throw new NotFoundException(CUSTODY_NOT_FOUND);
    return row;
  }

  private async view(r: RecordDetail, caller: AssetsCaller): Promise<CustodyRecordView> {
    const names = await userNames(this.prisma, usersOf(r));
    const register = assetsAccessAtLeast(caller.access, 'custodian');
    const view: CustodyRecordView = {
      id: r.id,
      code: r.code,
      kind: r.kind as CustodyKind,
      status: r.status as CustodyStatus,
      employee: personView(r.employee),
      purpose: r.purpose,
      dueDate: r.dueDate ? fromDateOnly(r.dueDate) : null,
      outAt: r.outAt.toISOString(),
      closedAt: r.closedAt?.toISOString() ?? null,
      handedOverBy: r.handedOverByName,
      issuedBy: userRef(names, r.issuedBy),
      notes: r.outNotes,
      terms: r.terms ?? [],
      items: r.items.map((i) => itemView(i, caller, names)),
      returns: returnsOf(r.items, names),
      files: r.files.map((f) => fileRef(names, f)),
      signed: r.files.length > 0,
      ...lateness(r, todayInCairo()),
      can: {
        receive: register && r.status !== 'closed',
        attach: register,
        // HR decides a deduction (owner, 21 October 2026: "Record it; HR decides a deduction"), never made by itself
        deduction: createsCustodyDeduction(caller.user) && r.items.some((i) => isIncident(i)),
      },
    };
    if (caller.values) view.valueAtOut = sumOf(r.items.map((i) => money(i.valueAtOut)));
    return view;
  }

  // ---------- handing over ----------

  /** Who "Handed over by" starts with: the caller's own name (their employee profile's), else their email; and their profile. */
  private async handedOverByOf(user: SessionUser): Promise<{ name: string; employeeId: string | null }> {
    const me = await this.prisma.employee.findUnique({ where: { workEmail: user.email.toLowerCase() }, select: { id: true, fullNameEn: true } });
    return me ? { name: me.fullNameEn, employeeId: me.id } : { name: user.email, employeeId: null };
  }

  /** GET /assets/custody/choices: the current employees (C-level only for those who see them), the assets that can go, the kits, the terms. */
  async choices(caller: AssetsCaller): Promise<HandoverChoices> {
    const today = todayInCairo();
    const hidden = new Set(await this.confidential.hiddenFrom(caller.user));
    const [people, assets, kits, terms, me] = await Promise.all([
      this.prisma.employee.findMany({
        where: { AND: [{ employments: { some: currentEmployment(today) } }, hidden.size ? { id: { notIn: [...hidden] } } : {}] },
        select: { ...PERSON, employments: { orderBy: NEWEST_EMPLOYMENT, take: 1, select: { department: { select: { nameEn: true, parent: { select: { nameEn: true } } } } } } },
        orderBy: { fullNameEn: 'asc' },
      }),
      this.prisma.asset.findMany({
        where: { status: 'available', group: { not: 'consumable' } },
        select: {
          id: true,
          code: true,
          name: true,
          group: true,
          type: true,
          serial: true,
          condition: true,
          kit: { select: { id: true, code: true } },
          // step 4 (owner, 22 October 2026: accessories, "Both kinds"): its checklist, the assets attached to it, its main one
          accessories: { select: { id: true, name: true, quantity: true, serial: true, notes: true }, orderBy: { position: 'asc' } },
          attached: { where: { status: { not: 'disposed' } }, select: { id: true, code: true, name: true, status: true, holderId: true, holder: { select: { fullNameEn: true } }, custody: { select: { code: true } } }, orderBy: { code: 'asc' } },
          parent: { select: { code: true, name: true } },
        },
        orderBy: { code: 'asc' },
        take: 5000,
      }),
      this.kitsFor(hidden),
      this.settings.custodyTerms(),
      this.handedOverByOf(caller.user),
    ]);
    return {
      people: people.map((p) => {
        const d = p.employments[0]?.department ?? null;
        return { id: p.id, employeeCode: p.employeeCode, fullNameEn: p.fullNameEn, department: d ? (d.parent ? `${d.parent.nameEn} › ${d.nameEn}` : d.nameEn) : null };
      }),
      assets: assets.map((a) => ({
        ...a,
        group: a.group as HandoverChoices['assets'][number]['group'],
        type: a.type as HandoverChoices['assets'][number]['type'],
        condition: a.condition as AssetCondition | null,
        attached: a.attached.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          status: c.status as AssetStatus,
          why: attachedSkipReason({ status: c.status, holder: c.holder?.fullNameEn ?? null, custodyCode: c.holderId && hidden.has(c.holderId) ? null : (c.custody?.code ?? null) }),
        })),
      })),
      kits: kits.map((k) => ({
        id: k.id,
        code: k.code,
        name: k.name,
        items: k.items.map((i) => ({ id: i.id, code: i.code, name: i.name, status: i.status as AssetStatus, why: kitSkipReason(i) })),
      })),
      handedOverBy: me.name,
      terms,
    };
  }

  /** The kits (all, or those asked for) with their assets not disposed of, each with who holds it (the record's code only when the holder isn't hidden). */
  private async kitsFor(hidden: ReadonlySet<string>, ids?: readonly string[]) {
    const kits = await this.prisma.assetKit.findMany({
      where: ids ? { id: { in: [...ids] } } : {},
      select: {
        id: true,
        code: true,
        name: true,
        assets: {
          where: { status: { not: 'disposed' } },
          select: { id: true, code: true, name: true, status: true, group: true, holderId: true, holder: { select: { fullNameEn: true } }, custody: { select: { code: true } } },
          orderBy: { code: 'asc' },
        },
      },
      orderBy: { code: 'asc' },
    });
    return kits.map((k) => ({
      id: k.id,
      code: k.code,
      name: k.name,
      items: k.assets.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        status: a.status,
        group: a.group,
        holder: a.holder?.fullNameEn ?? null,
        custodyCode: a.holderId && hidden.has(a.holderId) ? null : (a.custody?.code ?? null),
      })),
    }));
  }

  /**
   * POST /assets/custody: a handover. The assets chosen and each kit's available ones (the others skipped, with why), at
   * most 100; refused unless every one is available and not a consumable when it is saved (the rows locked, so two
   * handovers of the same asset at once can't both take it). Its code given in the same transaction. Audited, the record
   * and each asset; the employee is told.
   */
  async handOver(dto: HandoverDto, caller: AssetsCaller): Promise<HandoverResult> {
    const today = todayInCairo();
    const me = await this.handedOverByOf(caller.user);
    const handedOverBy = dto.handedOverBy?.trim() || me.name;
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { id: true, employeeCode: true, fullNameEn: true, employments: { where: currentEmployment(today), select: { id: true }, take: 1 } },
    });
    if (!employee || (await this.confidential.isHidden(caller.user, employee.id))) throw new NotFoundException(EMPLOYEE_NOT_FOUND);

    const hidden = new Set(await this.confidential.hiddenFrom(caller.user));
    const kitIds = [...new Set(dto.kitIds ?? [])];
    let skipped: KitSkip[] = [];
    const chosen = new Map<string, { conditionOut: AssetCondition | null; accessories: string | null; accessoryIds?: string[] }>();
    for (const i of dto.items ?? []) {
      if (!chosen.has(i.assetId)) chosen.set(i.assetId, { conditionOut: i.conditionOut ?? null, accessories: i.accessories ?? null, accessoryIds: i.accessoryIds });
    }
    if (kitIds.length) {
      const kits = await this.kitsFor(hidden, kitIds);
      if (kits.length !== kitIds.length) throw new BadRequestException(['Choose the kits from the list.']);
      const quick = kitQuickAdd(kits.flatMap((k) => k.items));
      skipped = quick.skipped;
      for (const id of quick.add) if (!chosen.has(id)) chosen.set(id, { conditionOut: null, accessories: null });
    }
    // step 4 (owner, 22 October 2026: accessories, "Both kinds"): the assets attached to those chosen go with them, the
    // available ones; the others skipped, said why, as a kit's are
    if (chosen.size) {
      const attached = await this.prisma.asset.findMany({
        where: { parentAssetId: { in: [...chosen.keys()] }, status: { not: 'disposed' } },
        select: { id: true, code: true, name: true, status: true, holderId: true, holder: { select: { fullNameEn: true } }, custody: { select: { code: true } } },
        orderBy: { code: 'asc' },
      });
      for (const c of attached) {
        if (chosen.has(c.id)) continue;
        const why = attachedSkipReason({ status: c.status, holder: c.holder?.fullNameEn ?? null, custodyCode: c.holderId && hidden.has(c.holderId) ? null : (c.custody?.code ?? null) });
        if (why) skipped.push({ code: c.code, name: c.name, why });
        else chosen.set(c.id, { conditionOut: null, accessories: null });
      }
    }

    const input = { employeeId: dto.employeeId, kind: dto.kind, dueDate: dto.dueDate ?? null, purpose: dto.purpose ?? null, handedOverBy, notes: dto.notes ?? null, items: [...chosen.keys()] };
    const problems = handoverProblems(input, today);
    const none = problems.indexOf('Choose the assets to hand over.');
    if (none >= 0 && kitIds.length) {
      problems[none] = `None of the kit’s assets is available to hand over: ${skipped.map((s) => `${s.code} (${s.why})`).join(', ') || 'it has none'}.`;
    }
    if (!employee.employments.length) problems.push(`${employee.fullNameEn} has no current employment: only current employees receive assets.`);
    if (problems.length) throw new BadRequestException(problems);

    const ids = [...chosen.keys()].sort();
    const kind = dto.kind;
    const created = await this.prisma.$transaction(async (tx) => {
      // the assets' rows held until this commits: a second handover of one of them waits, then finds it in custody
      await tx.$queryRaw`SELECT id FROM assets WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
      const assets = await tx.asset.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          group: true,
          condition: true,
          marketValue: true,
          accessories: { select: { id: true, name: true, quantity: true, serial: true, notes: true }, orderBy: { position: 'asc' } },
        },
        orderBy: { code: 'asc' },
      });
      const refused = assets.map((a) => handOverProblem(a)).filter((p): p is string => !!p);
      if (assets.length !== ids.length) refused.unshift('Some of the assets chosen aren’t in the register. Reload the page and choose again.');
      if (refused.length) throw new BadRequestException(refused);
      const terms = await this.settings.custodyTerms(tx);
      const code = custodyCode(await nextCodeNumber(tx, CUSTODY_CODE_PREFIX));
      const record = await tx.custodyRecord.create({
        data: {
          code,
          kind,
          employeeId: employee.id,
          purpose: input.purpose,
          dueDate: kind === 'shoot' && input.dueDate ? toDateOnly(input.dueDate) : null,
          issuedById: caller.user.id,
          // the person handing over, when it is the one recording it (their own name left as it was)
          handedOverById: me.employeeId && handedOverBy === me.name ? me.employeeId : null,
          handedOverByName: handedOverBy,
          outNotes: input.notes,
          terms,
        },
        select: { id: true, code: true },
      });
      await tx.custodyItem.createMany({
        data: assets.map((a) => {
          // the checklist's lines going with it, as a snapshot (all of them unless the form left some behind)
          const out = accessoriesGoingOut(a.accessories, chosen.get(a.id)?.accessoryIds);
          return {
            custodyId: record.id,
            assetId: a.id,
            valueAtOut: a.marketValue,
            conditionOut: chosen.get(a.id)?.conditionOut ?? a.condition,
            accessories: chosen.get(a.id)?.accessories ?? null,
            accessoriesOut: out.length ? (out as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          };
        }),
      });
      const moved = await tx.asset.updateMany({ where: { id: { in: ids }, status: 'available' }, data: { status: 'custody', holderId: employee.id, custodyId: record.id } });
      if (moved.count !== ids.length) throw new ConflictException('Some of the assets were handed over meanwhile. Reload the page and choose again.');
      return { record, assets };
    });

    const { record, assets } = created;
    await this.audit.record({
      userId: caller.user.id,
      action: 'hand_over',
      entityType: CUSTODY_ENTITY,
      entityId: record.id,
      diff: {
        code: record.code,
        kind,
        employeeCode: employee.employeeCode,
        ...(input.dueDate && kind === 'shoot' && { dueDate: input.dueDate }),
        ...(input.purpose && { purpose: input.purpose }),
        handedOverBy,
        items: assets.map((a) => a.code),
        ...(skipped.length && { skipped: skipped.map((s) => s.code) }),
        ...(assets.some((a) => a.accessories.length) && {
          accessories: assets
            .map((a) => ({ code: a.code, out: accessoriesText(accessoriesGoingOut(a.accessories, chosen.get(a.id)?.accessoryIds)) }))
            .filter((x) => x.out)
            .map((x) => `${x.code}: ${x.out}`),
        }),
        // the values when they went out: only as the fact that they were kept (as the asset values are)
        ...(assets.some((a) => a.marketValue !== null) && { valueAtOut: 'set' }),
      },
    });
    for (const a of assets) {
      await this.audit.record({
        userId: caller.user.id,
        action: 'hand_over',
        entityType: ASSET_ENTITY,
        entityId: a.id,
        diff: { code: a.code, custody: record.code, holder: employee.employeeCode, status: { from: 'available', to: 'custody' } },
      });
    }
    await this.notices.handedOver(record.id);
    return { record: await this.get(record.code, caller), skipped };
  }

  // ---------- receiving back ----------

  /**
   * POST /assets/custody/:code/return: items received back, each good, damaged or missing, with notes (spec §6.4).
   * The record's row is held for it, so two people receiving at once don't both take the same item.
   */
  async receive(code: string, dto: ReturnDto, caller: AssetsCaller): Promise<CustodyRecordView> {
    const record = await this.detail(code, caller.user);
    if (record.status === 'closed') throw new ConflictException(`${record.code} is closed: everything on it is back.`);
    const lines = new Map(dto.lines.map((l) => [l.itemId, l]));
    if (lines.size !== dto.lines.length) throw new BadRequestException(['Receive each item once.']);
    const now = new Date();
    const today = todayInCairo();
    const name = record.employee.fullNameEn;

    const back = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM custody_records WHERE id = ${record.id}::uuid FOR UPDATE`;
      const items = await tx.custodyItem.findMany({
        where: { custodyId: record.id },
        select: { id: true, assetId: true, returnedAt: true, accessoriesOut: true, asset: { select: { code: true } } },
      });
      const byId = new Map(items.map((i) => [i.id, i]));
      if ([...lines.keys()].some((id) => !byId.has(id))) throw new BadRequestException(['Choose items of this custody record.']);
      const already = [...lines.keys()].map((id) => byId.get(id)!).filter((i) => i.returnedAt);
      if (already.length) throw new ConflictException(`${already.map((i) => i.asset.code).join(', ')} ${already.length === 1 ? 'is' : 'are'} back already.`);
      // step 4: each accessory that went out with an item, ticked again (how many came back); an item missing has all of
      // its accessories missing with it
      const accessoryProblems: string[] = [];
      for (const l of lines.values()) {
        const went = accessoriesOutOf(byId.get(l.itemId)!.accessoriesOut);
        if (l.accessoriesBack !== undefined && l.condition !== 'missing') {
          accessoryProblems.push(...accessoriesBackProblems(went, l.accessoriesBack).map((p) => `${byId.get(l.itemId)!.asset.code}: ${p}`));
        }
      }
      if (accessoryProblems.length) throw new BadRequestException(accessoryProblems);
      const out: { assetId: string; code: string; condition: ReturnCondition; status: AssetStatus; missing: AccessoryOut[] }[] = [];
      for (const l of lines.values()) {
        const i = byId.get(l.itemId)!;
        const status = STATUS_ON_RETURN[l.condition];
        const went = accessoriesOutOf(i.accessoriesOut);
        const missing = went.length ? missingAccessories(went, l.accessoriesBack ?? null, l.condition === 'missing') : [];
        await tx.custodyItem.update({
          where: { id: i.id },
          data: {
            returnedAt: now,
            returnCondition: l.condition,
            receivedById: caller.user.id,
            returnNotes: l.notes ?? null,
            accessoriesMissing: went.length ? (missing as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          },
        });
        const moved = await tx.asset.updateMany({ where: { id: i.assetId, custodyId: record.id }, data: { status, holderId: null, custodyId: null } });
        if (!moved.count) throw new ConflictException(`${i.asset.code} isn’t held on ${record.code} any more. Reload the page.`);
        if (l.condition === 'damaged') {
          await tx.assetMaintenance.create({
            data: {
              assetId: i.assetId,
              on: toDateOnly(today),
              kind: 'repair' satisfies MaintenanceKind,
              event: 'returned_damaged' satisfies MaintenanceEvent,
              notes: returnedDamagedNote(record.code, name, l.notes),
              custodyItemId: i.id,
              createdById: caller.user.id,
            },
          });
        }
        out.push({ assetId: i.assetId, code: i.asset.code, condition: l.condition, status, missing });
      }
      const status = custodyStatusOf(items.map((i) => ({ returned: !!i.returnedAt || lines.has(i.id) })));
      await tx.custodyRecord.update({ where: { id: record.id }, data: { status, closedAt: status === 'closed' ? now : null } });
      return { status, out };
    });

    await this.audit.record({
      userId: caller.user.id,
      action: 'receive_back',
      entityType: CUSTODY_ENTITY,
      entityId: record.id,
      diff: {
        code: record.code,
        employeeCode: record.employee.employeeCode,
        items: back.out.map((o) => ({ code: o.code, condition: o.condition, ...(o.missing.length && { missingAccessories: o.missing.map(accessoryText).join(', ') }) })),
        ...(back.status !== record.status && { status: { from: record.status, to: back.status } }),
      },
    });
    for (const o of back.out) {
      await this.audit.record({
        userId: caller.user.id,
        action: 'receive_back',
        entityType: ASSET_ENTITY,
        entityId: o.assetId,
        diff: {
          code: o.code,
          custody: record.code,
          condition: o.condition,
          status: { from: 'custody', to: o.status },
          ...(o.missing.length && { missingAccessories: o.missing.map(accessoryText).join(', ') }),
        },
      });
    }
    await this.notices.returned(record.id, back.out.length);
    return this.get(record.code, caller);
  }

  // ---------- holdings ----------

  /**
   * GET /assets/custody/people?q=: the people matching (a name or an employee code: current employees, or anyone with a
   * custody record), else everyone holding something now; each with what they hold, how much is overdue, their damaged
   * and missing items, and for those who see the values what they hold is worth (the values when it went out).
   */
  async people(q: string | undefined, caller: AssetsCaller): Promise<HolderCardView[]> {
    const today = todayInCairo();
    const hidden = await this.confidential.hiddenFrom(caller.user);
    const text = q?.trim() ?? '';
    const contains = { contains: text, mode: 'insensitive' as const };
    const people = await this.prisma.employee.findMany({
      where: {
        AND: [
          hidden.length ? { id: { notIn: hidden } } : {},
          text
            ? { OR: [{ fullNameEn: contains }, { fullNameAr: contains }, { employeeCode: contains }] }
            : { custodyRecords: { some: { items: { some: { returnedAt: null } } } } },
          text ? { OR: [{ employments: { some: currentEmployment(today) } }, { custodyRecords: { some: {} } }] } : {},
        ],
      },
      select: {
        ...PERSON,
        custodyRecords: { select: { kind: true, status: true, dueDate: true, items: { select: { returnedAt: true, returnCondition: true, valueAtOut: true, accessoriesMissing: true } } } },
      },
      orderBy: { fullNameEn: 'asc' },
      take: text ? 50 : 200,
    });
    return people.map((p) => {
      const open = p.custodyRecords.flatMap((r) => r.items.filter((i) => !i.returnedAt).map((i) => ({ i, r })));
      const card: HolderCardView = {
        employee: { id: p.id, employeeCode: p.employeeCode, fullNameEn: p.fullNameEn },
        holding: open.length,
        overdue: open.filter(({ r }) => isOverdue({ kind: r.kind, status: r.status, dueDate: r.dueDate ? fromDateOnly(r.dueDate) : null }, today)).length,
        damagedOrMissing: p.custodyRecords.flatMap((r) => r.items).filter((i) => isIncident(i)).length,
      };
      if (caller.values) card.value = sumOf(open.map(({ i }) => money(i.valueAtOut)));
      return card;
    });
  }

  /** GET /assets/custody/people/:employeeId: what they hold now, their damaged and missing items, all their records. */
  async holdings(employeeId: string, caller: AssetsCaller): Promise<HoldingsView> {
    const today = todayInCairo();
    const person = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { ...PERSON_DETAIL, _count: { select: { employments: { where: currentEmployment(today) } } } } });
    if (!person || (await this.confidential.isHidden(caller.user, employeeId))) throw new NotFoundException(EMPLOYEE_NOT_FOUND);
    const [held, incidents, records] = await Promise.all([
      this.prisma.custodyItem.findMany({ where: { returnedAt: null, custody: { employeeId } }, select: HELD, orderBy: [{ custody: { outAt: 'desc' } }, { asset: { code: 'asc' } }] }),
      // damaged or missing, or (step 4) back without some of its accessories
      this.prisma.custodyItem
        .findMany({
          where: { custody: { employeeId }, OR: [{ returnCondition: { in: ['damaged', 'missing'] } }, { returnedAt: { not: null }, accessoriesMissing: { not: Prisma.DbNull } }] },
          select: { ...ITEM, custody: { select: { code: true } } },
          orderBy: { returnedAt: 'desc' },
        })
        .then((rows) => rows.filter(isIncident)),
      this.prisma.custodyRecord.findMany({ where: { employeeId }, select: RECORD_ROW, orderBy: [{ outAt: 'desc' }, { code: 'desc' }] }),
    ]);
    const names = await userNames(this.prisma, incidents.map((i) => i.receivedBy));
    const view: HoldingsView = {
      employee: personView(person),
      current: held.map((h) => heldView(h, caller.values, today)),
      incidents: incidents.map((i) => {
        const item = itemView(i, caller, names);
        const missing = accessoriesOutOf(i.accessoriesMissing);
        return {
          itemId: i.id,
          asset: item.asset,
          custodyCode: i.custody.code,
          condition: i.returnCondition as ReturnCondition,
          ...(missing.length > 0 && { missingAccessories: missing }),
          returnedAt: i.returnedAt!.toISOString(),
          notes: i.returnNotes,
          receivedBy: item.receivedBy,
          ...(caller.values && { valueAtOut: money(i.valueAtOut) }),
          ...(item.deductions && { deductions: item.deductions }),
        };
      }),
      records: records.map((r) => rowView(r, today)),
      can: { handOver: assetsAccessAtLeast(caller.access, 'custodian') && person._count.employments > 0, deduction: createsCustodyDeduction(caller.user) && incidents.length > 0 },
    };
    if (caller.values) view.value = sumOf(held.map((h) => money(h.valueAtOut)));
    return view;
  }

  // ---------- my custody ----------

  /**
   * GET /me/custody (owner, 21 October 2026: "Yes, My custody"): what the signed-in person holds, since when and until
   * when, what is overdue, and their records with their signed forms. Read only, never a value. None without a profile.
   */
  async mine(user: SessionUser): Promise<MyCustodyView> {
    const today = todayInCairo();
    const self = await this.confidential.selfId(user);
    if (!self) return { employeeId: null, current: [], records: [], overdue: 0 };
    const [held, records] = await Promise.all([
      this.prisma.custodyItem.findMany({ where: { returnedAt: null, custody: { employeeId: self } }, select: HELD, orderBy: [{ custody: { outAt: 'desc' } }, { asset: { code: 'asc' } }] }),
      this.prisma.custodyRecord.findMany({ where: { employeeId: self }, select: { ...RECORD_ROW, files: { select: FILE_REF, orderBy: { uploadedAt: 'asc' } } }, orderBy: [{ outAt: 'desc' }, { code: 'desc' }] }),
    ]);
    const names = await userNames(this.prisma, records.flatMap((r) => r.files.map((f) => f.uploadedBy)));
    const current = held.map((h) => heldView(h, false, today));
    return {
      employeeId: self,
      current,
      records: records.map((r) => ({ ...rowView(r, today), files: r.files.map((f) => fileRef(names, f)) })),
      overdue: current.filter((c) => c.overdue).length,
    };
  }

  // ---------- an asset's page ----------

  /**
   * GET /assets/:code/history: the asset's custody history, newest first (C-level people's records left out for
   * those who don't see them, said as a count), its maintenance log (the cost only for those who see the values), and
   * what its page may do now (a viewer: nothing).
   */
  async assetHistory(code: string, caller: AssetsCaller): Promise<AssetHistoryView> {
    const asset = await this.prisma.asset.findUnique({ where: { code: normalAssetCode(code) }, select: { id: true, code: true, status: true, group: true } });
    if (!asset) throw new NotFoundException(ASSET_NOT_FOUND);
    const hidden = new Set(await this.confidential.hiddenFrom(caller.user));
    const USER = { select: { id: true, email: true } } as const;
    const [items, maintenance] = await Promise.all([
      this.prisma.custodyItem.findMany({
        where: { assetId: asset.id },
        select: {
          id: true,
          valueAtOut: true,
          conditionOut: true,
          returnedAt: true,
          returnCondition: true,
          returnNotes: true,
          accessoriesOut: true,
          accessoriesMissing: true,
          receivedBy: USER,
          custody: { select: { code: true, kind: true, outAt: true, dueDate: true, employeeId: true, employee: { select: PERSON } } },
        },
        orderBy: { custody: { outAt: 'desc' } },
      }),
      this.prisma.assetMaintenance.findMany({
        where: { assetId: asset.id },
        select: { id: true, on: true, kind: true, event: true, vendor: true, cost: true, notes: true, createdAt: true, createdBy: USER, custodyItem: { select: { custody: { select: { code: true, employeeId: true } } } } },
        orderBy: [{ on: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);
    const shown = items.filter((i) => !hidden.has(i.custody.employeeId));
    // step 4: a consumable's stock moves, newest first
    const moves =
      asset.group === 'consumable'
        ? await this.prisma.assetStockMove.findMany({ where: { assetId: asset.id }, select: { id: true, delta: true, quantityAfter: true, note: true, at: true, by: USER }, orderBy: { at: 'desc' }, take: 100 })
        : [];
    const names = await userNames(this.prisma, [...shown.map((i) => i.receivedBy), ...maintenance.map((m) => m.createdBy), ...moves.map((m) => m.by)]);
    const register = assetsAccessAtLeast(caller.access, 'custodian');
    const can = assetActionsOf(asset);
    return {
      custody: shown.map((i) => ({
        itemId: i.id,
        code: i.custody.code,
        kind: i.custody.kind as CustodyKind,
        employee: i.custody.employee,
        outAt: i.custody.outAt.toISOString(),
        dueDate: i.custody.dueDate ? fromDateOnly(i.custody.dueDate) : null,
        conditionOut: (i.conditionOut as AssetCondition | null) ?? null,
        returnedAt: i.returnedAt?.toISOString() ?? null,
        returnCondition: (i.returnCondition as ReturnCondition | null) ?? null,
        receivedBy: userRef(names, i.receivedBy),
        returnNotes: i.returnNotes,
        accessoriesOut: accessoriesOutOf(i.accessoriesOut),
        accessoriesMissing: i.accessoriesMissing === null ? null : accessoriesOutOf(i.accessoriesMissing),
        ...(caller.values && { valueAtOut: money(i.valueAtOut) }),
      })),
      hiddenRecords: items.length - shown.length,
      maintenance: maintenance.map((m) => {
        const recordCode = m.custodyItem && !hidden.has(m.custodyItem.custody.employeeId) ? m.custodyItem.custody.code : null;
        return {
          id: m.id,
          on: fromDateOnly(m.on),
          kind: m.kind as MaintenanceKind,
          event: (m.event as MaintenanceEvent | null) ?? null,
          vendor: m.vendor,
          ...(caller.values && { cost: money(m.cost) }),
          notes: m.notes,
          custodyCode: recordCode,
          createdAt: m.createdAt.toISOString(),
          createdBy: userRef(names, m.createdBy),
        };
      }),
      can: Object.fromEntries(Object.entries(can).map(([k, v]) => [k, register && v])) as AssetHistoryView['can'],
      stockMoves: moves.map((m) => ({
        id: m.id,
        delta: m.delta.toNumber(),
        quantityAfter: m.quantityAfter.toNumber(),
        note: m.note,
        by: userRef(names, m.by),
        at: m.at.toISOString(),
      })),
    };
  }
}
