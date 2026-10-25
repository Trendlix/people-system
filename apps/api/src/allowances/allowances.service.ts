import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { isPerAccount, ONE_PER_ACCOUNT_ALLOWANCE, type AllowanceBasis } from '@trendlix/shared';
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
    // fixed, or per client account (25 October 2026)
    basis: t.basis as AllowanceBasis,
    inUse: t._count.contracts + t._count.offers > 0,
  };
}

const COUNTS = { _count: { select: { contracts: true, offers: true } } } as const;

// The kinds of allowance (Organization → Allowances; owner's request, 15 October 2026): paid every month on top of the
// gross, each taxed or not and counted in the insured wage or not. HR or an Admin sets them up; anyone signed in reads
// them. A contract or an offer keeps each allowance's name and treatment as they were when drafted (snapshot), so a
// later change to a kind changes neither. A kind in use is made inactive, not deleted. A kind is paid a fixed amount a
// month, or per client account (owner, 25 October 2026: "if an employee has an allowance per account, how can we deal
// with it?"): a per-account one is chosen on a contract or an offer with no amount, and payroll pays the month's client
// accounts as it (packages/shared client-accounts.ts); its basis changes only while no contract or offer has it.
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
      data: { nameEn: dto.nameEn, nameAr: dto.nameAr, taxable: dto.taxable ?? true, insured: dto.insured ?? false, basis: dto.basis ?? 'fixed', sortOrder: (_max.sortOrder ?? 0) + 1 },
      include: COUNTS,
    });
    const result = view(row);
    const { nameEn, nameAr, taxable, insured, active, sortOrder, basis } = result;
    // the basis only when per client account, so a fixed kind's entry reads as before it existed
    await this.audit.record({ userId, action: 'create', entityType: ENTITY, entityId: row.id, diff: { nameEn, nameAr, taxable, insured, active, sortOrder, ...(basis !== 'fixed' && { basis }) } });
    return result;
  }

  /**
   * Changes a kind. Contracts and offers that have it keep the name and treatment they were drafted with; the next ones
   * drafted, or a draft whose allowances are changed, take the new ones.
   */
  async update(id: string, dto: UpdateAllowanceTypeDto, userId: string) {
    const before = await this.get(id);
    if (dto.nameEn !== undefined && dto.nameEn !== before.nameEn) await this.assertFree(dto.nameEn, id);
    // a contract or an offer has it with an amount, or as eligibility only: the basis stays (25 October 2026)
    if (dto.basis !== undefined && dto.basis !== before.basis && before.inUse) {
      throw new ConflictException(`${before.nameEn} is on contracts or offers, so how it is paid can't change. Add another allowance paid ${dto.basis === 'per_account' ? 'per client account' : 'a fixed amount'} instead.`);
    }
    const fields = { nameEn: dto.nameEn, nameAr: dto.nameAr, taxable: dto.taxable, insured: dto.insured, active: dto.active, sortOrder: dto.sortOrder, basis: dto.basis };
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
   * version it renews). A kind paid per client account (25 October 2026) takes no amount (stored as 0: the person is
   * eligible, and payroll pays their accounts), and a record has one such kind at most.
   */
  async snapshot(rows: readonly AllowanceInput[], options: { allowInactive?: readonly string[] } = {}): Promise<AllowanceSnapshot[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.allowanceTypeId);
    // an id that isn't a UUID can't be a kind (and the database would refuse it)
    const kinds = await this.prisma.allowanceType.findMany({ where: { id: { in: ids.filter((id) => UUID.test(id)) } }, orderBy: [...ORDER] });
    const byId = new Map(kinds.map((k) => [k.id, k]));
    const seen = new Set<string>();
    for (const r of rows) {
      const kind = byId.get(r.allowanceTypeId);
      if (!kind) throw new BadRequestException('One of the allowances is no longer on the list. Reload the page and choose it again.');
      // per client account: no amount to check, nothing but eligibility
      if (isPerAccount(kind)) continue;
      // the DTO checks these first; here for callers that don't use it (to the piaster: 0.29 × 100 isn't exactly 29)
      const amount = r.amount;
      if (typeof amount !== 'number' || !(amount > 0) || amount > MAX_MONEY || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) {
        throw new BadRequestException(AMOUNT_MESSAGE);
      }
    }
    for (const id of ids) {
      const kind = byId.get(id)!;
      if (seen.has(id)) throw new BadRequestException(`Add each allowance once: ${kind.nameEn} is there twice.`);
      seen.add(id);
      if (!kind.active && !options.allowInactive?.includes(id)) {
        throw new BadRequestException(`${kind.nameEn} is inactive, so it can't be added. Choose another allowance, or make it active again under Organization → Allowances.`);
      }
    }
    if (kinds.filter((k) => isPerAccount(k)).length > 1) throw new BadRequestException(ONE_PER_ACCOUNT_ALLOWANCE);
    const amounts = new Map(rows.map((r) => [r.allowanceTypeId, r.amount]));
    return kinds.map((k) => ({
      allowanceTypeId: k.id,
      nameEn: k.nameEn,
      nameAr: k.nameAr,
      taxable: k.taxable,
      insured: k.insured,
      basis: k.basis as AllowanceBasis,
      amount: isPerAccount(k) ? 0 : amounts.get(k.id)!,
    }));
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
