import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  form2Problem,
  insuredWageOf,
  payChangeOf,
  raiseEffectiveProblem,
  samePay,
  type PayBasis,
  type RaiseWay,
} from '@trendlix/shared';
import { AllowancesService } from '../allowances/allowances.service.js';
import { allowanceData, allowancesTotal, allowanceView, type AllowanceSnapshot } from '../allowances/rows.js';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly } from '../common/date-only.js';
import { seesSalary } from '../employees/access.js';
import type { Prisma } from '../generated/prisma/client.js';
import { LawRatesService } from '../payroll/law-rates/law-rates.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertCurrent, comparable, ContractsService, fields, payTermsOf, salaryMasked, toData, type EmploymentRow } from './contracts.service.js';
import { checkedPromotion } from './promotion.js';
import type { CreateRaiseDto, RaiseForm2Dto, RaiseReasonDto, UpdateRaiseDto } from './raises.dto.js';
import { CONTRACT_INCLUDE, contractView, type ContractRow } from './views.js';

const ENTITY = 'contract';
const REQUEST = 'raise_request';

/**
 * An amendment's number: the contract's it amends with -A1, then -A2 … (owner's decisions, 16 October 2026: a salary
 * amendment is part of the contract it changes). CON-2026-0007 → CON-2026-0007-A1; CON-2026-0007-A1 → CON-2026-0007-A2.
 */
export function amendmentNumber(replaced: string): string {
  const m = /^(.*)-A(\d+)$/.exec(replaced);
  return m ? `${m[1]}-A${Number(m[2]) + 1}` : `${replaced}-A1`;
}

/** What a raise is worked out from: its way and date, and its pay as sent or as the draft has it. */
interface RaiseInput {
  way: RaiseWay;
  effectiveDate: string;
  durationMonths?: number;
  basicPercent: number;
  netSalary: number | null;
  payBasis: PayBasis;
  grossSalary: number | null;
  hourlyRate: number | null;
  hoursPerWeek: number | null;
  daysPerWeek: number | null;
  allowances: readonly AllowanceSnapshot[];
}

/** The pending raises' people, for Approvals. */
const PENDING_INCLUDE = {
  ...CONTRACT_INCLUDE,
  employment: { select: { id: true, employee: { select: { id: true, employeeCode: true, fullNameEn: true } }, jobTitle: { select: { titleEn: true } } } },
} satisfies Prisma.ContractInclude;

// Pay raises during a contract (owner's decisions, 16 October 2026; packages/shared raises.ts). HR enters a raise on the
// signed contract in force, one of two ways (an amendment, or a new contract), taking effect on the 1st of a month, with
// its reason and a promotion if any, from a raise request or not; it is a draft version of the contract. HR sends it to
// the CEO, who approves it, returns it with a reason (HR changes it and sends it again) or declines it (the draft goes,
// and so does the request it came from). Only an approved one is signed (ContractsService.sign), which replaces the
// version in force from the effective date and applies the promotion. A renewal with new pay takes the same steps (sent,
// approved, returned, declined here). HR records the Form 2 filed for an approved raise. Every step is in the audit log,
// the salary only as changed.
@Injectable()
export class RaisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly contracts: ContractsService,
    private readonly allowances: AllowancesService,
    private readonly lawRates: LawRatesService,
  ) {}

  /** A raise on the signed contract in force: a draft, one at a time, for HR to send to the CEO. */
  async create(employeeId: string, employmentId: string, dto: CreateRaiseDto, user: SessionUser) {
    const employment = await this.contracts.employment(employeeId, employmentId, user);
    assertCurrent(employment);
    const versions = await this.prisma.contract.findMany({ where: { employmentId }, orderBy: { version: 'desc' }, include: CONTRACT_INCLUDE });
    const draft = versions.find((v) => v.status === 'draft');
    if (draft) throw new ConflictException(`Version ${draft.version} (${draft.number}) is still a draft. Sign or delete it before adding a raise.`);
    const current = versions[0];
    if (current?.status !== 'active') throw new ConflictException('A raise changes the signed contract in force: sign the contract first.');
    await this.assertNoEnding(employmentId);
    const request = dto.requestId ? await this.preparable(dto.requestId, employeeId) : null;

    const allowances =
      dto.allowances !== undefined
        ? await this.allowances.snapshot(dto.allowances, { allowInactive: current.allowances.map((a) => a.allowanceTypeId) })
        : current.allowances.map(allowanceView);
    const payBasis = dto.payBasis ?? (current.payBasis as PayBasis);
    const hourly = payBasis === 'hourly';
    const terms = await this.terms(employment, current, {
      way: dto.way,
      effectiveDate: dto.effectiveDate,
      durationMonths: dto.durationMonths,
      basicPercent: dto.basicPercent ?? current.basicPercent,
      netSalary: dto.netSalary ?? null,
      payBasis,
      grossSalary: dto.grossSalary ?? (hourly ? null : current.grossSalary.toNumber()),
      hourlyRate: dto.hourlyRate !== undefined ? dto.hourlyRate : hourly ? (current.hourlyRate?.toNumber() ?? null) : null,
      hoursPerWeek: dto.hoursPerWeek !== undefined ? dto.hoursPerWeek : hourly ? (current.hoursPerWeek?.toNumber() ?? null) : null,
      daysPerWeek: dto.daysPerWeek !== undefined ? dto.daysPerWeek : current.daysPerWeek,
      allowances,
    });
    const promotion = await checkedPromotion(this.prisma, employment, { newJobTitleId: dto.newJobTitleId ?? null, newGradeId: dto.newGradeId ?? null });
    const values = {
      ...terms,
      number: dto.way === 'amendment' ? amendmentNumber(current.number) : await this.contracts.nextNumber(terms.startDate),
      version: current.version + 1,
      raiseReason: dto.reason,
      approval: 'draft',
      newJobTitleId: promotion.jobTitle?.id ?? null,
      newGradeId: promotion.grade?.id ?? null,
      note: dto.note ?? null,
    };
    const row = await this.prisma.$transaction(async (tx) => {
      const made = await tx.contract.create({
        data: { ...toData({ ...values, employmentId }), allowances: { create: allowanceData(allowances) } },
        include: CONTRACT_INCLUDE,
      });
      if (!request) return made;
      await tx.raiseRequest.update({ where: { id: request.id }, data: { contractId: made.id } });
      return tx.contract.findUniqueOrThrow({ where: { id: made.id }, include: CONTRACT_INCLUDE });
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: ENTITY,
      entityId: row.id,
      diff: salaryMasked({ employeeId, employmentId, way: dto.way, replaces: current.number, ...values, allowances: comparable(allowances), ...(request && { request: request.id }) }),
    });
    if (request) {
      await this.audit.record({ userId: user.id, action: 'prepare', entityType: REQUEST, entityId: request.id, diff: { employeeId, contract: row.number } });
    }
    return contractView(row, await this.contracts.context(user, employment));
  }

  /**
   * Changes a raise not with the CEO: a draft, a returned one (sent again once changed), or an approved one, which goes
   * back to a draft for HR to send again once anything but its note changes. A renewal with new pay is changed as a
   * contract draft.
   */
  async update(id: string, dto: UpdateRaiseDto, user: SessionUser) {
    const before = await this.contracts.row(id);
    if (before.status !== 'draft') throw new ConflictException(`${before.number} is signed, so it isn't changed. For other terms, add a new version.`);
    if (before.approval === null) throw new BadRequestException(`${before.number} doesn't change the pay: change it as a contract draft (Edit).`);
    const employment = await this.contracts.employmentOf(before);
    assertCurrent(employment);
    const current = await this.replaced(before);
    if (payChangeOf({ kind: before.kind, startDate: fromDateOnly(before.startDate) }, { endDate: fromDateOnly(current.endDate) }) === 'renewal') {
      throw new BadRequestException(`${before.number} is a renewal: change it as a contract draft (Edit).`);
    }
    if (before.approval === 'pending_ceo') throw new ConflictException(`${before.number} is with the CEO: it can't be changed unless the CEO returns it.`);

    const was = fields(before);
    const allowances =
      dto.allowances !== undefined ? await this.allowances.snapshot(dto.allowances, { allowInactive: before.allowances.map((a) => a.allowanceTypeId) }) : undefined;
    const way: RaiseWay = dto.way ?? (before.kind === 'amendment' ? 'amendment' : 'contract');
    const payBasis = dto.payBasis ?? (was.payBasis as PayBasis);
    const hourly = payBasis === 'hourly';
    const terms = await this.terms(employment, current, {
      way,
      effectiveDate: dto.effectiveDate ?? was.startDate,
      durationMonths: dto.durationMonths ?? was.durationMonths ?? undefined,
      basicPercent: dto.basicPercent ?? was.basicPercent,
      netSalary: dto.netSalary !== undefined ? dto.netSalary : was.netSalary,
      payBasis,
      grossSalary: dto.grossSalary ?? was.grossSalary,
      hourlyRate: dto.hourlyRate !== undefined ? dto.hourlyRate : hourly ? was.hourlyRate : null,
      hoursPerWeek: dto.hoursPerWeek !== undefined ? dto.hoursPerWeek : hourly ? was.hoursPerWeek : null,
      daysPerWeek: dto.daysPerWeek !== undefined ? dto.daysPerWeek : was.daysPerWeek,
      allowances: allowances ?? before.allowances.map(allowanceView),
    });
    const promotion = await checkedPromotion(this.prisma, employment, {
      newJobTitleId: dto.newJobTitleId !== undefined ? dto.newJobTitleId : before.newJobTitleId,
      newGradeId: dto.newGradeId !== undefined ? dto.newGradeId : before.newGradeId,
    });
    // an amendment is numbered after the contract it amends; a new contract by its start year
    const number =
      terms.kind === before.kind && (terms.kind === 'amendment' || terms.startDate.slice(0, 4) === was.startDate.slice(0, 4))
        ? before.number
        : terms.kind === 'amendment'
          ? amendmentNumber(current.number)
          : await this.contracts.nextNumber(terms.startDate);
    const proposed = {
      ...terms,
      number,
      raiseReason: dto.reason ?? before.raiseReason,
      newJobTitleId: promotion.jobTitle?.id ?? null,
      newGradeId: promotion.grade?.id ?? null,
    };
    const termsChanged = Object.keys(changes(was, { ...proposed, ...(allowances && { allowances: comparable(allowances) }) })).length > 0;
    const back = before.approval === 'approved' && termsChanged;
    const values: Record<string, unknown> = { ...proposed, note: dto.note, ...(back && { approval: 'draft', approvedById: null, approvedAt: null }) };

    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.contract.update({
        where: { id },
        data: { ...toData(values), ...(allowances && { allowances: { deleteMany: {}, create: allowanceData(allowances) } }) },
        include: CONTRACT_INCLUDE,
      });
      if (back && before.raiseRequest) await tx.raiseRequest.update({ where: { id: before.raiseRequest.id }, data: { status: 'with_hr' } });
      return saved;
    });
    const diff = salaryMasked(changes(was, { ...values, ...(allowances && { allowances: comparable(allowances) }) }));
    if (Object.keys(diff).length) {
      await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, entityId: id, diff: { employmentId: before.employmentId, number: before.number, ...diff } });
    }
    return contractView(row, await this.contracts.context(user, employment));
  }

  /** HR sends a draft (or one returned, changed since) to the CEO. */
  async send(id: string, user: SessionUser) {
    const before = await this.raise(id);
    if (before.status !== 'draft' || before.approval !== 'draft') throw this.wrongStep(before, 'sent to the CEO');
    const employment = await this.contracts.employmentOf(before);
    assertCurrent(employment);
    // the contract in force may have changed since it was drafted (a signing undone): checked again
    const current = await this.replaced(before);
    if (before.kind === 'amendment' || payChangeOf({ kind: before.kind, startDate: fromDateOnly(before.startDate) }, { endDate: fromDateOnly(current.endDate) }) !== 'renewal') {
      const problem = raiseEffectiveProblem(fromDateOnly(before.startDate), { startDate: fromDateOnly(current.startDate), endDate: fromDateOnly(current.endDate) });
      if (problem) throw new BadRequestException(problem);
    }
    return this.step(before, { approval: 'pending_ceo', sentAt: new Date(), returnedReason: null }, 'submit', 'with_ceo', user, employment);
  }

  /** The CEO sends it back to HR, saying why; HR changes it and sends it again. */
  async returnToHr(id: string, dto: RaiseReasonDto, user: SessionUser) {
    const before = await this.raise(id);
    if (before.approval !== 'pending_ceo') throw this.wrongStep(before, 'returned');
    return this.step(before, { approval: 'draft', returnedReason: dto.reason }, 'return', 'with_hr', user, undefined, { reason: dto.reason });
  }

  /** The CEO approves it (the CEO only): HR signs it then. */
  async approve(id: string, user: SessionUser) {
    const before = await this.raise(id);
    if (before.approval !== 'pending_ceo') throw this.wrongStep(before, 'approved');
    return this.step(before, { approval: 'approved', approvedById: user.id, approvedAt: new Date(), returnedReason: null }, 'approve', 'approved', user);
  }

  /**
   * The CEO declines it, saying why: the draft goes (it was never signed), and the request it was prepared from is
   * declined with the reason. The audit log keeps what was declined.
   */
  async decline(id: string, dto: RaiseReasonDto, user: SessionUser) {
    const before = await this.raise(id);
    if (before.approval !== 'pending_ceo') throw this.wrongStep(before, 'declined');
    await this.prisma.$transaction(async (tx) => {
      if (before.raiseRequest) {
        await tx.raiseRequest.update({
          where: { id: before.raiseRequest.id },
          data: { status: 'declined', declinedStage: 'ceo', declineReason: dto.reason, declinedById: user.id, declinedAt: new Date(), contractId: null },
        });
      }
      await tx.contract.delete({ where: { id } });
    });
    await this.audit.record({
      userId: user.id,
      action: 'decline',
      entityType: ENTITY,
      entityId: id,
      diff: salaryMasked({ employmentId: before.employmentId, number: before.number, version: before.version, approval: { from: 'pending_ceo', to: null }, reason: dto.reason, grossSalary: before.grossSalary.toNumber() }),
    });
    if (before.raiseRequest) {
      await this.audit.record({
        userId: user.id,
        action: 'decline',
        entityType: REQUEST,
        entityId: before.raiseRequest.id,
        diff: { contract: before.number, status: { from: before.raiseRequest.status, to: 'declined' }, stage: 'ceo', reason: dto.reason },
      });
    }
  }

  /**
   * HR records the Form 2 filed for an approved raise (owner's decision, 16 October 2026: "From the next January unless
   * amended in Form 2"): the insured wage follows its pay from that 1st of a month; null when none was filed after all.
   */
  async form2(id: string, dto: RaiseForm2Dto, user: SessionUser) {
    const before = await this.raise(id);
    if (before.approval !== 'approved') throw new ConflictException(`Form 2 is recorded for a raise the CEO approved: ${before.number} isn't approved yet.`);
    const date = dto.form2From ?? null;
    if (date) {
      const problem = form2Problem(date, fromDateOnly(before.startDate));
      if (problem) throw new BadRequestException(problem);
    }
    const row = await this.prisma.contract.update({ where: { id }, data: { form2From: date ? toDateOnly(date) : null }, include: CONTRACT_INCLUDE });
    const diff = changes({ form2From: fromDateOnly(before.form2From) }, { form2From: date });
    if (Object.keys(diff).length) {
      await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, entityId: id, diff: { employmentId: before.employmentId, number: before.number, ...diff } });
    }
    return contractView(row, await this.contracts.context(user, await this.contracts.employmentOf(before)));
  }

  /**
   * The changes of pay waiting for the CEO (raises and renewals with new pay), oldest sent first, each with its person
   * and the pay of the version it replaces: for Approvals (HR follows them, the CEO decides).
   */
  async pending(user: SessionUser) {
    const rows = await this.prisma.contract.findMany({ where: { approval: 'pending_ceo', status: 'draft' }, orderBy: [{ sentAt: 'asc' }, { number: 'asc' }], include: PENDING_INCLUDE });
    const previous = rows.length
      ? await this.prisma.contract.findMany({ where: { OR: rows.map((r) => ({ employmentId: r.employmentId, version: r.version - 1 })) }, include: CONTRACT_INCLUDE })
      : [];
    const sees = seesSalary(user);
    return rows.map((r) => {
      const before = previous.find((p) => p.employmentId === r.employmentId && p.version === r.version - 1) ?? null;
      const view = contractView(r, { seesSalary: sees, workingDays: null, nonRenewal: null });
      const beforeAllowances = before ? allowancesTotal(before.allowances.map(allowanceView)) : null;
      return {
        ...view,
        change: payChangeOf({ kind: r.kind, startDate: view.startDate }, before && { endDate: fromDateOnly(before.endDate) }),
        employee: r.employment.employee,
        employmentId: r.employment.id,
        jobTitleEn: r.employment.jobTitle?.titleEn ?? null,
        previous: before && {
          id: before.id,
          number: before.number,
          version: before.version,
          startDate: fromDateOnly(before.startDate),
          endDate: fromDateOnly(before.endDate),
          payBasis: before.payBasis as PayBasis,
          grossSalary: sees ? before.grossSalary.toNumber() : null,
          hourlyRate: sees ? (before.hourlyRate?.toNumber() ?? null) : null,
          allowancesTotal: sees ? beforeAllowances : null,
          totalSalary: sees && beforeAllowances !== null ? Math.round((before.grossSalary.toNumber() + beforeAllowances) * 100) / 100 : null,
        },
      };
    });
  }

  // ---------- helpers ----------

  /**
   * A raise's terms: the way, from the effective date (the 1st of a month within the term of the version in force) and
   * the pay. An amendment keeps the contract's term (its end, no length of its own) without probation; a new contract
   * has its own term from the effective date (ContractsService.terms). Refused when the pay is the same as now.
   */
  private async terms(employment: EmploymentRow, current: ContractRow, input: RaiseInput) {
    const problem = raiseEffectiveProblem(input.effectiveDate, { startDate: fromDateOnly(current.startDate), endDate: fromDateOnly(current.endDate) });
    if (problem) throw new BadRequestException(problem);
    const allowances = [...input.allowances];
    let terms;
    if (input.way === 'contract') {
      const { allowances: _rows, ...t } = await this.contracts.terms(employment, current, {
        startDate: input.effectiveDate,
        durationMonths: input.durationMonths,
        probationMonths: 0,
        basicPercent: input.basicPercent,
        netSalary: input.netSalary,
        payBasis: input.payBasis,
        grossSalary: input.grossSalary,
        hourlyRate: input.hourlyRate,
        hoursPerWeek: input.hoursPerWeek,
        daysPerWeek: input.daysPerWeek,
        allowances,
      });
      terms = { ...t, kind: 'contract' as const };
    } else {
      const pay = this.contracts.pay({ ...input, allowances });
      const total = allowancesTotal(allowances);
      if (input.netSalary !== null && Math.round(input.netSalary * 100) > Math.round((pay.grossSalary + total) * 100)) {
        throw new BadRequestException(allowances.length ? "The net salary can't be more than the gross salary and the allowances together." : "The net salary can't be more than the gross salary.");
      }
      terms = {
        kind: 'amendment' as const,
        form: 'fixed' as const,
        startDate: input.effectiveDate,
        // the contract's term as it is: its end, no length or probation of its own
        durationMonths: null,
        endDate: fromDateOnly(current.endDate),
        probationMonths: 0,
        probationEnd: null,
        ...pay,
        basicPercent: input.basicPercent,
        netSalary: input.netSalary,
        insuredSalary: insuredWageOf(pay.grossSalary, allowances, await this.lawRates.forYear(Number(input.effectiveDate.slice(0, 4)))),
      };
    }
    if (samePay(payTermsOf(current), payTermsOf({ ...terms, allowances }))) {
      throw new BadRequestException('The new pay is the same as now: a raise changes the pay. A promotion alone is changed on the employment.');
    }
    return terms;
  }

  /** The version a raise (or renewal) replaces: the one before it, the employment's contract in force. */
  private async replaced(c: ContractRow): Promise<ContractRow> {
    const previous = await this.prisma.contract.findFirst({ where: { employmentId: c.employmentId, version: c.version - 1 }, include: CONTRACT_INCLUDE });
    if (previous?.status !== 'active') {
      throw new ConflictException(`Version ${c.version - 1} is no longer the contract in force, so ${c.number} can't go ahead. Delete it and enter the change again.`);
    }
    return previous;
  }

  /** A version with the CEO's step (a raise, or a renewal with new pay), not signed yet. */
  private async raise(id: string): Promise<ContractRow> {
    const c = await this.contracts.row(id);
    if (c.approval === null) throw new BadRequestException(`${c.number} doesn't change the pay, so it has no CEO approval: sign it as it is.`);
    if (c.status !== 'draft' && c.approval !== 'approved') throw new ConflictException(`${c.number} is signed.`);
    return c;
  }

  private wrongStep(c: ContractRow, doing: string) {
    const where = c.status !== 'draft' ? 'is signed' : c.approval === 'pending_ceo' ? 'is with the CEO' : c.approval === 'approved' ? 'is approved' : 'is with HR';
    return new ConflictException(`${c.number} ${where}, so it can't be ${doing}.`);
  }

  /** One of the CEO's steps (or HR's send): saved with the request it came from, and in the audit log. */
  private async step(
    before: ContractRow,
    data: Prisma.ContractUncheckedUpdateInput,
    action: string,
    requestStatus: string,
    user: SessionUser,
    employment?: EmploymentRow,
    more: Record<string, unknown> = {},
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.contract.update({ where: { id: before.id }, data, include: CONTRACT_INCLUDE });
      if (before.raiseRequest) await tx.raiseRequest.update({ where: { id: before.raiseRequest.id }, data: { status: requestStatus } });
      return saved;
    });
    await this.audit.record({
      userId: user.id,
      action,
      entityType: ENTITY,
      entityId: before.id,
      diff: { employmentId: before.employmentId, number: before.number, version: before.version, approval: { from: before.approval, to: row.approval }, ...more },
    });
    if (before.raiseRequest && before.raiseRequest.status !== requestStatus) {
      await this.audit.record({
        userId: user.id,
        action,
        entityType: REQUEST,
        entityId: before.raiseRequest.id,
        diff: { contract: before.number, status: { from: before.raiseRequest.status, to: requestStatus }, ...more },
      });
    }
    return contractView(row, await this.contracts.context(user, employment ?? (await this.contracts.employmentOf(before))));
  }

  /** No raise while an ending of the employment is waiting for the CEO or approved. */
  private async assertNoEnding(employmentId: string) {
    const ending = await this.prisma.employmentEnding.findFirst({ where: { employmentId, status: { in: ['pending_ceo', 'approved'] } }, select: { id: true } });
    if (ending) throw new ConflictException('An ending of this employment is in progress: no raise while it is. Withdraw the ending first.');
  }

  /** A raise request HR may prepare the raise from: this employee's, with HR, none prepared yet. */
  private async preparable(requestId: string, employeeId: string) {
    const r = await this.prisma.raiseRequest.findUnique({ where: { id: requestId }, select: { id: true, employeeId: true, status: true, contractId: true } });
    if (!r || r.employeeId !== employeeId) throw new NotFoundException('Raise request not found for this employee.');
    if (r.status !== 'with_hr') throw new ConflictException('This raise request is no longer with HR, so a raise can’t be prepared from it.');
    if (r.contractId) throw new ConflictException('A raise is already prepared from this request.');
    return r;
  }
}
