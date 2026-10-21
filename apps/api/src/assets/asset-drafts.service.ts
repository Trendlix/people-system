import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ASSET_GROUPS,
  ASSET_VALUE_FIELDS,
  ASSETS_REFUSALS,
  assetProblems,
  assetValuesProblems,
  isAssetGroup,
  type AssetDraftSource,
  type AssetDraftStatus,
  type AssetDraftView,
  type AssetInput,
  type AssetValuesInput,
  type AssetView,
} from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { todayInCairo } from '../common/date-only.js';
import { Prisma } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AssetsCaller } from './assets-access.js';
import type { CreateAssetDto, UpdateAssetDto } from './assets.dto.js';
import { AssetsService, editedAssetInput, maskedValues, mergeValues, newAssetInput, NO_VALUES, sentForAnotherGroup } from './assets.service.js';

// The drafts from Claude (step 2; owner, 21 October 2026: "i might link a claude account for the assets section only to
// fetch data and help in the data entry"; the spec: "nothing is saved until a person presses Save"; packages/shared
// asset-drafts.ts). Claude, through the connector, drafts an asset with the Add form's fields, checked as the Add form's
// are (its group's fields, its room and kit, its values only from the CEO, Finance or a Super Admin); it has no code and
// is in no total or list but Drafts from Claude. A custodian or a manager confirms it in the system, from the Add form
// filled in with it (its code given then, in the transaction that marks it confirmed, so it is confirmed once), or
// discards it. Kept either way, for the audit log ('asset_draft'; the values only as set or changed, as on assets).

export const DRAFT_ENTITY = 'asset_draft';
const DRAFT_NOT_FOUND = 'Draft not found.';
const NO_STATUS = 'A draft has no status: it is available once it is confirmed.';

const alreadyDone = (status: string) =>
  status === 'confirmed' ? 'This draft was already confirmed: it is in the register.' : 'This draft was discarded: it can’t be changed or confirmed.';

const VIEW = {
  id: true,
  status: true,
  source: true,
  fields: true,
  values: true,
  createdAt: true,
  updatedAt: true,
  confirmedAt: true,
  discardedAt: true,
  createdBy: { select: { id: true, email: true } },
  confirmedBy: { select: { id: true, email: true } },
  discardedBy: { select: { id: true, email: true } },
  asset: { select: { code: true } },
} as const satisfies Prisma.AssetDraftSelect;

type Row = Prisma.AssetDraftGetPayload<{ select: typeof VIEW }>;

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A draft's fields as kept (JSON), read back as the Add form's; anything unexpected reads as empty. */
export function draftFields(json: unknown): AssetInput {
  const f = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const group = isAssetGroup(f.group) ? f.group : ASSET_GROUPS[0];
  return {
    name: text(f.name) ?? '',
    group,
    type: (text(f.type) ?? 'OTH') as AssetInput['type'],
    assetClass: (text(f.assetClass) ?? 'fixed') as AssetInput['assetClass'],
    brand: text(f.brand),
    model: text(f.model),
    serial: text(f.serial),
    condition: text(f.condition) as AssetInput['condition'],
    roomId: text(f.roomId),
    kitId: text(f.kitId),
    quantity: num(f.quantity),
    unit: text(f.unit),
    reorderLevel: num(f.reorderLevel),
    purchaseDate: text(f.purchaseDate),
    usefulLifeYears: num(f.usefulLifeYears),
    warrantyEnd: text(f.warrantyEnd),
    notes: text(f.notes),
  };
}

/** A draft's values as kept, or null when none were drafted. */
export function draftValues(json: unknown): AssetValuesInput | null {
  if (!json || typeof json !== 'object') return null;
  const v = json as Record<string, unknown>;
  const out: AssetValuesInput = {
    purchasePrice: num(v.purchasePrice),
    supplier: text(v.supplier),
    invoiceNo: text(v.invoiceNo),
    priceLow: num(v.priceLow),
    marketValue: num(v.marketValue),
    priceHigh: num(v.priceHigh),
    priceNote: text(v.priceNote),
  };
  return ASSET_VALUE_FIELDS.some((k) => out[k] !== null) ? out : null;
}

const given = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null));

@Injectable()
export class AssetDraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assets: AssetsService,
  ) {}

  /** GET /assets/drafts: the drafts waiting for a person, newest first. */
  async list(caller: AssetsCaller): Promise<AssetDraftView[]> {
    const rows = await this.prisma.assetDraft.findMany({ where: { status: 'open' }, select: VIEW, orderBy: { createdAt: 'desc' }, take: 200 });
    return this.views(rows, caller);
  }

  /** GET /assets/drafts/:id: one draft, whatever its status (its page says what became of it). */
  async get(id: string, caller: AssetsCaller): Promise<AssetDraftView> {
    const row = await this.prisma.assetDraft.findUnique({ where: { id }, select: VIEW });
    if (!row) throw new NotFoundException(DRAFT_NOT_FOUND);
    return (await this.views([row], caller))[0];
  }

  /** Claude drafts an asset (POST /assets/drafts): checked as the Add form is, no code yet. */
  async create(dto: CreateAssetDto, caller: AssetsCaller): Promise<AssetDraftView> {
    if (dto.status !== undefined) throw new BadRequestException([NO_STATUS]);
    if (dto.values && !caller.values) throw new ForbiddenException(ASSETS_REFUSALS.values);
    const input = newAssetInput(dto);
    const values = mergeValues(NO_VALUES, dto.values);
    const problems = [...sentForAnotherGroup(dto, dto.group), ...assetProblems(input, todayInCairo()), ...assetValuesProblems(values)];
    if (problems.length) throw new BadRequestException(problems);
    await this.assets.checkPlaces(input, null);
    const kept = draftValues(values);
    const row = await this.prisma.assetDraft.create({
      data: { fields: input as unknown as Prisma.InputJsonValue, values: kept ? (kept as unknown as Prisma.InputJsonValue) : Prisma.DbNull, createdById: caller.user.id },
      select: { id: true },
    });
    await this.audit.record({ userId: caller.user.id, action: 'create', entityType: DRAFT_ENTITY, entityId: row.id, diff: maskedValues(given({ ...input, ...values }), 'set') });
    return this.get(row.id, caller);
  }

  /** A draft still waiting changed (PATCH /assets/drafts/:id): only what is sent, checked again as a whole. */
  async update(id: string, dto: UpdateAssetDto, caller: AssetsCaller): Promise<AssetDraftView> {
    if (dto.status !== undefined) throw new BadRequestException([NO_STATUS]);
    if (dto.values && !caller.values) throw new ForbiddenException(ASSETS_REFUSALS.values);
    const draft = await this.open(id);
    const before = draftFields(draft.fields);
    const after = editedAssetInput(before, dto);
    const beforeValues = draftValues(draft.values) ?? NO_VALUES;
    const values = mergeValues(beforeValues, dto.values);
    const problems = [...sentForAnotherGroup(dto, after.group), ...assetProblems(after, todayInCairo()), ...(dto.values ? assetValuesProblems(values) : [])];
    if (problems.length) throw new BadRequestException(problems);
    await this.assets.checkPlaces(after, before);
    const fieldDiff = changes({ ...before }, { ...after });
    const valueDiff = changes({ ...beforeValues }, { ...values });
    if (Object.keys(fieldDiff).length || Object.keys(valueDiff).length) {
      const kept = draftValues(values);
      const { count } = await this.prisma.assetDraft.updateMany({
        where: { id, status: 'open' },
        data: { fields: after as unknown as Prisma.InputJsonValue, values: kept ? (kept as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
      });
      if (!count) throw new ConflictException(alreadyDone((await this.prisma.assetDraft.findUnique({ where: { id }, select: { status: true } }))?.status ?? 'discarded'));
      await this.audit.record({ userId: caller.user.id, action: 'update', entityType: DRAFT_ENTITY, entityId: id, diff: maskedValues({ ...fieldDiff, ...valueDiff }, 'changed') });
    }
    return this.get(id, caller);
  }

  /**
   * Confirm (POST /assets/drafts/:id/confirm, the website only): the Add form filled in from the draft, as the person
   * reviewed it, registered as any asset is (its code given now), and the draft marked confirmed in the same transaction:
   * once only, whoever presses it at the same moment. The values: those on the form from someone who sees them; else the
   * draft's own, kept as drafted (they were drafted by the CEO, Finance or a Super Admin).
   */
  async confirm(id: string, dto: CreateAssetDto, caller: AssetsCaller): Promise<AssetView> {
    const draft = await this.open(id);
    const kept = draftValues(draft.values);
    const now = new Date();
    const asset = await this.assets.create(dto, caller, {
      values: caller.values || !kept ? undefined : kept,
      audit: { draftId: id },
      within: async (tx, created) => {
        const { count } = await tx.assetDraft.updateMany({
          where: { id, status: 'open' },
          data: { status: 'confirmed', confirmedAt: now, confirmedById: caller.user.id, assetId: created.id },
        });
        if (!count) throw new ConflictException(alreadyDone('confirmed'));
      },
    });
    await this.audit.record({ userId: caller.user.id, action: 'confirm', entityType: DRAFT_ENTITY, entityId: id, diff: { code: asset.code, name: asset.name } });
    return asset;
  }

  /** Discard (POST /assets/drafts/:id/discard, the website only): set aside, kept for the audit log. */
  async discard(id: string, caller: AssetsCaller): Promise<AssetDraftView> {
    const draft = await this.open(id);
    const { count } = await this.prisma.assetDraft.updateMany({
      where: { id, status: 'open' },
      data: { status: 'discarded', discardedAt: new Date(), discardedById: caller.user.id },
    });
    if (!count) throw new ConflictException(alreadyDone((await this.prisma.assetDraft.findUnique({ where: { id }, select: { status: true } }))?.status ?? 'discarded'));
    await this.audit.record({ userId: caller.user.id, action: 'discard', entityType: DRAFT_ENTITY, entityId: id, diff: { name: draftFields(draft.fields).name } });
    return this.get(id, caller);
  }

  /** A draft still waiting, or 404 / 409 saying what became of it. */
  private async open(id: string) {
    const draft = await this.prisma.assetDraft.findUnique({ where: { id }, select: { status: true, fields: true, values: true } });
    if (!draft) throw new NotFoundException(DRAFT_NOT_FOUND);
    if (draft.status !== 'open') throw new ConflictException(alreadyDone(draft.status));
    return draft;
  }

  /** Drafts as answered: the room and kit by name, who did what by name, the values only to those who see them. */
  private async views(rows: Row[], caller: AssetsCaller): Promise<AssetDraftView[]> {
    const fields = rows.map((r) => draftFields(r.fields));
    const roomIds = [...new Set(fields.map((f) => f.roomId).filter((v): v is string => !!v))];
    const kitIds = [...new Set(fields.map((f) => f.kitId).filter((v): v is string => !!v))];
    const [rooms, kits, names] = await Promise.all([
      roomIds.length ? this.prisma.assetRoom.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true } }) : [],
      kitIds.length ? this.prisma.assetKit.findMany({ where: { id: { in: kitIds } }, select: { id: true, code: true, name: true } }) : [],
      userNames(this.prisma, rows.flatMap((r) => [r.createdBy, r.confirmedBy, r.discardedBy])),
    ]);
    const roomOf = new Map(rooms.map((r) => [r.id, r]));
    const kitOf = new Map(kits.map((k) => [k.id, k]));
    const person = (u: { id: string; email: string } | null) => (u ? { email: u.email, name: names.get(u.id)?.name ?? null } : null);
    return rows.map((r, i) => {
      const f = fields[i];
      const values = draftValues(r.values);
      const view: AssetDraftView = {
        id: r.id,
        status: r.status as AssetDraftStatus,
        source: r.source as AssetDraftSource,
        fields: f,
        room: f.roomId ? (roomOf.get(f.roomId) ?? null) : null,
        kit: f.kitId ? (kitOf.get(f.kitId) ?? null) : null,
        valuesSet: values !== null,
        createdAt: r.createdAt.toISOString(),
        createdBy: person(r.createdBy),
        updatedAt: r.updatedAt.toISOString(),
        confirmedAt: r.confirmedAt?.toISOString() ?? null,
        confirmedBy: person(r.confirmedBy),
        asset: r.asset ? { code: r.asset.code } : null,
        discardedAt: r.discardedAt?.toISOString() ?? null,
        discardedBy: person(r.discardedBy),
      };
      if (caller.values) view.values = values ?? NO_VALUES;
      return view;
    });
  }
}
