import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, changes } from '../audit/audit.service.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import type { AllowanceType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateAllowanceTypeDto, UpdateAllowanceTypeDto } from './allowances.dto.js';
import type { AllowanceInput, AllowanceSnapshot } from './rows.js';

const ENTITY = 'allowance_type';
/** decimal(12, 2) holds up to 9,999,999,999.99 */
const MAX_MONEY = 9_999_999_999.99;
const AMOUNT_MESSAGE = 'Enter each allowance as an amount of more than 0, e.g. 500 or 750.50.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The kinds in the order the lists show them. */
const ORDER = [{ sortOrder: 'asc' }, { nameEn: 'asc' }] as const;

/** A kind as the API sends it, with whether any contract or offer has it. */
function view(t: AllowanceType & { _count: { contracts: number; offers: number } }) {
  return {
    id: t.id,
    nameEn: t.nameEn,
    nameAr: t.nameAr,
    taxable: t.taxable,
    insured: t.insured,
    active: t.active,
    sortOrder: t.sortOrder,
    inUse: t._count.contracts + t._count.offers > 0,
  };
}

const COUNTS = { _count: { select: { contracts: true, offers: true } } } as const;

// The kinds of allowance (Organization → Allowances; owner's request, 15 October 2026): paid every month on top of the
// gross, each taxed or not and counted in the insured wage or not. HR or an Admin sets them up; anyone signed in reads
// them. A contract or an offer keeps each allowance's name and treatment as they were when drafted (snapshot), so a
// later change to a kind changes neither. A kind in use is made inactive, not deleted.
@Injectable()
export class AllowancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return (await this.prisma.allowanceType.findMany({ orderBy: [...ORDER], include: COUNTS })).map(view);
  }

  /** A new kind, last in the list. The English name is unique. */
  async create(dto: CreateAllowanceTypeDto, userId: string) {
    await this.assertFree(dto.nameEn);
    const { _max } = await this.prisma.allowanceType.aggregate({ _max: { sortOrder: true } });
    const row = await this.prisma.allowanceType.create({
      data: { nameEn: dto.nameEn, nameAr: dto.nameAr, taxable: dto.taxable ?? true, insured: dto.insured ?? false, sortOrder: (_max.sortOrder ?? 0) + 1 },
      include: COUNTS,
    });
    const result = view(row);
    const { nameEn, nameAr, taxable, insured, active, sortOrder } = result;
    await this.audit.record({ userId, action: 'create', entityType: ENTITY, entityId: row.id, diff: { nameEn, nameAr, taxable, insured, active, sortOrder } });
    return result;
  }

  /**
   * Changes a kind. Contracts and offers that have it keep the name and treatment they were drafted with; the next ones
   * drafted, or a draft whose allowances are changed, take the new ones.
   */
  async update(id: string, dto: UpdateAllowanceTypeDto, userId: string) {
    const before = await this.get(id);
    if (dto.nameEn !== undefined && dto.nameEn !== before.nameEn) await this.assertFree(dto.nameEn, id);
    const fields = { nameEn: dto.nameEn, nameAr: dto.nameAr, taxable: dto.taxable, insured: dto.insured, active: dto.active, sortOrder: dto.sortOrder };
    const row = await this.prisma.allowanceType.update({ where: { id }, data: fields, include: COUNTS });
    const diff = changes(before, fields);
    if (Object.keys(diff).length) await this.audit.record({ userId, action: 'update', entityType: ENTITY, entityId: id, diff: { nameEn: before.nameEn, ...diff } });
    return view(row);
  }

  /** Deletes a kind no contract or offer has (a Super Admin only, owner's decision, 15 October 2026). */
  async remove(id: string, user: SessionUser) {
    assertDeletes(user);
    const kind = await this.get(id);
    if (kind.inUse) throw new ConflictException(`${kind.nameEn} is on contracts or offers: make it inactive instead.`);
    await this.prisma.allowanceType.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'delete', entityType: ENTITY, entityId: id, diff: { nameEn: kind.nameEn, nameAr: kind.nameAr } });
  }

  /**
   * A contract's or an offer's allowances with each kind's name and treatment as they are now, to store with the
   * record: in the kinds' order. Refuses a kind that doesn't exist, the same kind twice, an amount that isn't more than
   * 0, and an inactive kind unless the record already has it (`allowInactive`: the kind ids on the record, or on the
   * version it renews).
   */
  async snapshot(rows: readonly AllowanceInput[], options: { allowInactive?: readonly string[] } = {}): Promise<AllowanceSnapshot[]> {
    if (!rows.length) return [];
    for (const r of rows) {
      // the DTO checks these first; here for callers that don't use it (to the piaster: 0.29 × 100 isn't exactly 29)
      if (typeof r.amount !== 'number' || !(r.amount > 0) || r.amount > MAX_MONEY || Math.abs(Math.round(r.amount * 100) - r.amount * 100) > 1e-6) {
        throw new BadRequestException(AMOUNT_MESSAGE);
      }
    }
    const ids = rows.map((r) => r.allowanceTypeId);
    // an id that isn't a UUID can't be a kind (and the database would refuse it)
    const kinds = await this.prisma.allowanceType.findMany({ where: { id: { in: ids.filter((id) => UUID.test(id)) } }, orderBy: [...ORDER] });
    const byId = new Map(kinds.map((k) => [k.id, k]));
    const seen = new Set<string>();
    for (const id of ids) {
      const kind = byId.get(id);
      if (!kind) throw new BadRequestException('One of the allowances is no longer on the list. Reload the page and choose it again.');
      if (seen.has(id)) throw new BadRequestException(`Add each allowance once: ${kind.nameEn} is there twice.`);
      seen.add(id);
      if (!kind.active && !options.allowInactive?.includes(id)) {
        throw new BadRequestException(`${kind.nameEn} is inactive, so it can't be added. Choose another allowance, or make it active again under Organization → Allowances.`);
      }
    }
    const amounts = new Map(rows.map((r) => [r.allowanceTypeId, r.amount]));
    return kinds.map((k) => ({ allowanceTypeId: k.id, nameEn: k.nameEn, nameAr: k.nameAr, taxable: k.taxable, insured: k.insured, amount: amounts.get(k.id)! }));
  }

  private async get(id: string) {
    const row = await this.prisma.allowanceType.findUnique({ where: { id }, include: COUNTS });
    if (!row) throw new NotFoundException('Allowance not found.');
    return view(row);
  }

  /** The English name is unique, whatever the case. */
  private async assertFree(nameEn: string, exceptId?: string) {
    const taken = await this.prisma.allowanceType.findFirst({
      where: { nameEn: { equals: nameEn, mode: 'insensitive' }, ...(exceptId && { id: { not: exceptId } }) },
      select: { nameEn: true },
    });
    if (taken) throw new ConflictException(`There is already an allowance called ${taken.nameEn}. Choose another name.`);
  }
}
