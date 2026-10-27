import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  form2Problem,
  grossToNet,
  RAISE_REASON_CHOICES,
  hrDecisionOf,
  insuredWageOf,
  payChangeOf,
  raiseEffectiveProblem,
  raisedPay,
  samePay,
  type ContractForm,
  type PayBasis,
  type RaiseDecision,
  type RaiseFigure,
  type RaiseReason,
  type RaiseWay,
  zeroSalaryProblem,
} from '@trendlix/shared';
import { AllowancesService } from '../allowances/allowances.service.js';
import { allowanceData, allowancesTotal, allowanceView, type AllowanceSnapshot } from '../allowances/rows.js';
import { AuditService, changes, type AuditEntry } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly } from '../common/date-only.js';
import { seesSalary } from '../employees/access.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NoticesService } from '../notifications/notices.service.js';
import { LawRatesService } from '../payroll/law-rates/law-rates.service.js';
import { PayrollService } from '../payroll/payroll.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertCurrent, comparable, ContractsService, deleteRefusal, fields, payTermsOf, salaryMasked, toData, type EmploymentRow } from './contracts.service.js';
import { MAX_MONEY } from './contracts.dto.js';
import { openDirectRequest, syncDirectRequest } from './direct-requests.js';
import { checkedPromotion, type Promotion } from './promotion.js';
import { payOf, recordStep, stepFigures, typedFigure, type StepInput } from './raise-request-steps.js';
import {
  commentOf,
  type ApproveRaiseDto,
  type ApproveRaiseRequestDto,
  type CreateRaiseDto,
  type RaiseCommentDto,
  type RaiseForm2Dto,
  type SendRaiseDto,
  type UpdateRaiseDto,
} from './raises.dto.js';
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

/**
 * The CEO's other reason for a raise when approving it (owner, 19 October 2026: "when approving a raise as a ceo, i might
 * want to ammend the raise reason, not only the money"): from → to, or null when none is sent or it is the same. Another
 * reason is one of those the forms offer (RAISE_REASON_CHOICES): adjustment stays only on a version that has it.
 */
export function ceoReasonChange(current: string | null, sent: RaiseReason | undefined): { from: string | null; to: RaiseReason } | null {
  if (!sent || sent === current) return null;
  if (!(RAISE_REASON_CHOICES as readonly string[]).includes(sent)) {
    throw new BadRequestException('Choose the reason from the list: annual, performance, counter_offer, promotion, market_adjustment, cost_of_living or other.');
  }
  return { from: current, to: sent };
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
  /** By the hour: the least paid a month (27 October 2026), pay like the rate; null: none. */
  hourlyMinimum: number | null;
  daysPerWeek: number | null;
  allowances: readonly AllowanceSnapshot[];
}

/** A raise request as HR prepares the raise from it: its state, reason, suggestion and the month it is asked from. */
const PREPARABLE = {
  id: true,
  employeeId: true,
  employmentId: true,
  status: true,
  contractId: true,
  raiseReason: true,
  suggestedIncrease: true,
  suggestedPercent: true,
  suggestedGross: true,
  effectiveFrom: true,
} satisfies Prisma.RaiseRequestSelect;

type Preparable = Prisma.RaiseRequestGetPayload<{ select: typeof PREPARABLE }>;

/** A raise's terms worked out (RaisesService.terms). */
type RaiseTerms = Awaited<ReturnType<RaisesService['terms']>>;

/** The pending raises' people, for Approvals. */
const PENDING_INCLUDE = {
  ...CONTRACT_INCLUDE,
  employment: { select: { id: true, employee: { select: { id: true, employeeCode: true, fullNameEn: true } }, jobTitle: { select: { titleEn: true } } } },
} satisfies Prisma.ContractInclude;

// Pay raises during a contract (owner's decisions, 16 October 2026; packages/shared raises.ts). HR enters a raise on the
// signed contract in force, one of two ways (an amendment, or a new contract), taking effect on the 1st of a month, with
// its reason and a promotion if any; it is a draft version of the contract, which HR sends to the CEO. From a raise
// request it is HR's approval of the request (owner, 17 October 2026: "Approve - Approve with another raise amount or
// percentge - Reject, and add a comment"): as suggested or with another raise, with HR's comment, prepared and sent to
// the CEO at once, either here with the pay in force raised by the figure (approveRequest) or in the whole raise form
// (create with the request). The CEO approves it as it reached them, approves it with another raise (its pay changed to
// that figure over the pay before it, the allowances as they are, and approved in the same step), or rejects it (the
// draft goes, and so does the request it came from), always with a comment; or returns it with a comment (HR changes it
// and sends it again). Only an approved one is signed (ContractsService.sign), which replaces the version in force from
// the effective date and applies the promotion. A renewal with new pay takes the same steps (sent, decided, returned
// here). HR records the Form 2 filed for an approved raise. Each step of a request is logged on it, in the transaction
// it is taken in (raise-request-steps.ts); every step is in the audit log, the salary only as changed. Since 19 October
// 2026 ("when a raise request was sent to the CEO, is showed in approvals not raise requests, and after approved, it was
// not shown in the raise request history too") a raise HR enters directly gets its request too, prepared directly by HR
// (direct-requests.ts), so every raise follows its steps on Raise Requests; and the CEO may change its reason when
// approving it ("when approving a raise as a ceo, i might want to ammend the raise reason, not only the money").
@Injectable()
export class RaisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly contracts: ContractsService,
    private readonly allowances: AllowancesService,
    private readonly lawRates: LawRatesService,
    private readonly confidential: ConfidentialService,
    private readonly notices: NoticesService,
    private readonly payroll: PayrollService,
  ) {}

  /**
   * A raise on the signed contract in force: a draft, one at a time, for HR to send to the CEO. From a raise request
   * (the whole raise form) it is HR's approval of the request, with HR's comment: as suggested when its gross is the one
   * the suggestion comes to, else with another raise; prepared and sent to the CEO at once.
   */
  async create(employeeId: string, employmentId: string, dto: CreateRaiseDto, user: SessionUser) {
    const employment = await this.contracts.employment(employeeId, employmentId, user);
    const current = await this.raisable(employment);
    const request = dto.requestId ? await this.preparable(dto.requestId, employeeId) : null;
    if (request && !dto.comment) throw new BadRequestException('Write your comment on the request: it goes with your approval, to the CEO and the requester.');

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
      // the minimum a month by the hour (27 October 2026) as it is unless another is sent
      hourlyMinimum: dto.hourlyMinimum !== undefined ? dto.hourlyMinimum : hourly ? (current.hourlyMinimum?.toNumber() ?? null) : null,
      daysPerWeek: dto.daysPerWeek !== undefined ? dto.daysPerWeek : current.daysPerWeek,
      allowances,
    });
    // a promotion to a C-level grade only from those who see C-level people (owner, 19 October 2026)
    await this.confidential.assertMayGiveGrade(user, dto.newGradeId);
    const promotion = await checkedPromotion(this.prisma, employment, { newJobTitleId: dto.newJobTitleId ?? null, newGradeId: dto.newGradeId ?? null });
    // approved as suggested: the figure suggested is the one decided
    const suggested = request && this.suggested(request, current);
    const decision = hrDecisionOf(suggested?.grossSalary ?? null, terms.grossSalary);
    const approval = request && { decision, comment: dto.comment!, figure: decision === 'approve' ? (suggested?.figure ?? null) : null };
    return this.insert(employment, current, { terms, way: dto.way, reason: dto.reason, allowances, promotion, note: dto.note ?? null }, user, request && approval && { request, ...approval });
  }

  /**
   * HR approves a raise request (owner, 17 October 2026: "Approve - Approve with another raise amount or percentge -
   * Reject, and add a comment"): as suggested, or with another raise (an amount or a percent of the gross in force), with
   * HR's comment, which also sets how the raise is made (the way, the effective date, a new contract's length). The
   * effective date is the request's Effective from unless HR sends another (17 October 2026: "in the request their
   * should be a tab called Effective from"); a request from before then has none, so HR gives one. The raise is prepared
   * from it, as the raise form would (the pay in force with the gross, or by the hour the rate, raised by the figure; the
   * allowances as they are; the request's reason) and sent to the CEO at once.
   */
  async approveRequest(requestId: string, dto: ApproveRaiseRequestDto, user: SessionUser) {
    const r = await this.prisma.raiseRequest.findUnique({ where: { id: requestId }, select: { employeeId: true, employmentId: true } });
    if (!r) throw new NotFoundException('Raise request not found.');
    const request = await this.preparable(requestId, r.employeeId);
    const employment = await this.contracts.employment(r.employeeId, r.employmentId, user);
    const current = await this.raisable(employment);

    const typed = typedFigure(dto.increaseAmount, dto.increasePercent);
    let pay: ReturnType<typeof raisedPay>;
    let figure: RaiseFigure | null;
    if (dto.decision === 'approve') {
      if (typed) throw new BadRequestException('Approving as suggested takes the raise suggested: to set another, approve it with another raise.');
      const suggested = this.suggested(request, current);
      if (!suggested) throw new BadRequestException('This request suggests no raise: approve it with another raise, and set the raise.');
      pay = suggested;
      figure = suggested.figure;
    } else {
      if (!typed) throw new BadRequestException('Enter the other raise, as an amount in EGP or a percent of the gross.');
      pay = raisedPay(payOf(current), typed);
      figure = typed;
    }
    const reason = dto.raiseReason ?? request.raiseReason;
    if (!reason) throw new BadRequestException('Choose why the pay changes: this request is from before the reasons were listed.');
    const effectiveDate = dto.effectiveDate ?? fromDateOnly(request.effectiveFrom);
    if (!effectiveDate) throw new BadRequestException('Enter the date the raise takes effect, the 1st of a month: this request is from before Effective from was asked.');

    const allowances = current.allowances.map(allowanceView);
    const effectiveYear = Number(effectiveDate.slice(0, 4));
    const terms = await this.terms(employment, current, {
      way: dto.way,
      effectiveDate,
      durationMonths: dto.durationMonths,
      basicPercent: current.basicPercent,
      // the net of the new pay, as the raise form works it out
      netSalary: grossToNet(pay.grossSalary, await this.lawRates.forYear(effectiveYear), allowances).net,
      payBasis: current.payBasis as PayBasis,
      grossSalary: pay.grossSalary,
      hourlyRate: pay.hourlyRate,
      hoursPerWeek: pay.hoursPerWeek,
      // the minimum a month by the hour (27 October 2026) as it is: the raise is on the rate
      hourlyMinimum: current.payBasis === 'hourly' ? (current.hourlyMinimum?.toNumber() ?? null) : null,
      daysPerWeek: current.daysPerWeek,
      allowances,
    });
    const view = await this.insert(
      employment,
      current,
      { terms, way: dto.way, reason, allowances, promotion: { jobTitle: null, grade: null }, note: null },
      user,
      { request, decision: dto.decision, comment: dto.comment, figure },
    );
    return view;
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
      hourlyMinimum: dto.hourlyMinimum !== undefined ? dto.hourlyMinimum : hourly ? was.hourlyMinimum : null,
      daysPerWeek: dto.daysPerWeek !== undefined ? dto.daysPerWeek : was.daysPerWeek,
      allowances: allowances ?? before.allowances.map(allowanceView),
    });
    // a promotion to a C-level grade only from those who see C-level people (owner, 19 October 2026)
    if (dto.newGradeId !== undefined && dto.newGradeId !== before.newGradeId) await this.confidential.assertMayGiveGrade(user, dto.newGradeId);
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
      if (back && before.raiseRequest) {
        await tx.raiseRequest.update({ where: { id: before.raiseRequest.id }, data: { status: 'with_hr' } });
        await recordStep(tx, before.raiseRequest.id, user.id, { kind: 'changed', gross: saved.grossSalary.toNumber(), contractNumber: saved.number });
      }
      // a raise HR prepared directly: its request says what HR changed (the reason, the note, the figures, the date)
      if (before.raiseRequest?.origin === 'direct') {
        await syncDirectRequest(tx, before.raiseRequest.id, { ...saved, employeeId: employment.employeeId }, current.grossSalary.toNumber());
      }
      return saved;
    });
    const diff = salaryMasked(changes(was, { ...values, ...(allowances && { allowances: comparable(allowances) }) }));
    if (Object.keys(diff).length) {
      await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, entityId: id, diff: { employmentId: before.employmentId, number: before.number, ...diff } });
    }
    return contractView(row, await this.contracts.context(user, employment));
  }

  /** HR sends a draft (or one returned, changed since) to the CEO, with a comment if HR wants (the CEO sees it). */
  async send(id: string, dto: SendRaiseDto, user: SessionUser) {
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
    const comment = dto.comment || null;
    const view = await this.step(before, { approval: 'pending_ceo', sentAt: new Date(), returnedReason: null }, 'submit', 'with_ceo', user, employment, comment ? { comment } : {}, {
      kind: 'sent',
      comment,
      gross: before.grossSalary.toNumber(),
    });
    // to the CEO (Phase 4: notifications)
    await this.notices.payRaiseSent(id);
    return view;
  }

  /** The CEO sends it back to HR with a comment (HR alone sees it); HR changes it and sends it again. */
  async returnToHr(id: string, dto: RaiseCommentDto, user: SessionUser) {
    const comment = commentOf(dto);
    const before = await this.raise(id);
    if (before.approval !== 'pending_ceo') throw this.wrongStep(before, 'returned');
    const view = await this.step(before, { approval: 'draft', returnedReason: comment }, 'return', 'with_hr', user, undefined, { reason: comment }, { kind: 'returned', comment });
    // to HR (Phase 4: notifications)
    await this.notices.payRaiseDecided(before.employmentId, 'returned', user.id);
    return view;
  }

  /**
   * The CEO approves it (the CEO only), with a comment (owner, 17 October 2026: "Approve - Approve with another raise
   * amount or percentge"): as it reached them, or with another raise, an amount or a percent over the pay before it,
   * which its pay is changed to (the gross, or by the hour the rate; the net and the insured salary worked out again; the
   * allowances as they are) and approved in the same step. HR signs it then. With another reason if the CEO wants (owner,
   * 19 October 2026: "when approving a raise as a ceo, i might want to ammend the raise reason, not only the money"):
   * the version's and its request's, changed in the same step, logged on the CEO's decision from → to, and audited.
   */
  async approve(id: string, dto: ApproveRaiseDto, user: SessionUser) {
    const before = await this.raise(id);
    if (before.approval !== 'pending_ceo') throw this.wrongStep(before, 'approved');
    const figure = typedFigure(dto.increaseAmount, dto.increasePercent);
    const reason = ceoReasonChange(before.raiseReason, dto.raiseReason);
    const previous = await this.replaced(before);
    const pay = figure ? await this.otherPay(before, previous, figure) : null;
    const decision: RaiseDecision = figure ? 'approve_other' : 'approve';
    const gross = pay?.grossSalary ?? before.grossSalary.toNumber();
    const view = await this.step(
      before,
      { approval: 'approved', approvedById: user.id, approvedAt: new Date(), returnedReason: null, ...pay, ...(reason && { raiseReason: reason.to }) },
      'approve',
      'approved',
      user,
      undefined,
      { decision, comment: dto.comment, ...(pay && { grossSalary: 'changed' }), ...(reason && { raiseReason: reason }) },
      {
        kind: 'ceo_decision',
        decision,
        comment: dto.comment,
        ...stepFigures(previous.grossSalary.toNumber(), gross, figure),
        ...(reason && { raiseReason: reason.to, raiseReasonFrom: reason.from }),
      },
      reason ? { raiseReason: reason.to } : {},
    );
    // to HR, who prepares it for signing (Phase 4: notifications)
    await this.notices.payRaiseDecided(before.employmentId, 'approved', user.id);
    return view;
  }

  /**
   * The CEO rejects it, with a comment: the draft goes (it was never signed), and the request it was prepared from is
   * declined with it. The audit log keeps what was declined. A draft whose signing was undone before 25 October 2026
   * may still have draft payroll lines on it: taken again first, as when a draft is deleted (ContractsService.remove).
   */
  async decline(id: string, dto: RaiseCommentDto, user: SessionUser) {
    const comment = commentOf(dto);
    const before = await this.raise(id);
    if (before.approval !== 'pending_ceo') throw this.wrongStep(before, 'rejected');
    const rebuilt = await this.prisma.$transaction(async (tx) => {
      const rebuilt = await this.payroll.freeContract(tx, id, (payroll, status) => deleteRefusal(before.number, payroll, status));
      if (before.raiseRequest) {
        await tx.raiseRequest.update({
          where: { id: before.raiseRequest.id },
          data: { status: 'declined', declinedStage: 'ceo', declineReason: comment, declinedById: user.id, declinedAt: new Date(), contractId: null },
        });
        await recordStep(tx, before.raiseRequest.id, user.id, { kind: 'ceo_decision', decision: 'reject', comment, contractNumber: before.number });
      }
      await tx.contract.delete({ where: { id } });
      return rebuilt;
    });
    await this.audit.record({
      userId: user.id,
      action: 'decline',
      entityType: ENTITY,
      entityId: id,
      diff: salaryMasked({ employmentId: before.employmentId, number: before.number, version: before.version, approval: { from: 'pending_ceo', to: null }, reason: comment, grossSalary: before.grossSalary.toNumber() }),
    });
    if (before.raiseRequest) {
      await this.audit.record({
        userId: user.id,
        action: 'decline',
        entityType: REQUEST,
        entityId: before.raiseRequest.id,
        diff: { contract: before.number, status: { from: before.raiseRequest.status, to: 'declined' }, stage: 'ceo', decision: 'reject', comment },
      });
    }
    await this.payroll.recordRebuilt(rebuilt, user, { draftDeleted: before.number });
    // to HR (Phase 4: notifications)
    await this.notices.payRaiseDecided(before.employmentId, 'rejected', user.id);
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
   * and the pay of the version it replaces: for Approvals (HR follows them, the CEO decides); without a C-level
   * person's for HR.
   */
  async pending(user: SessionUser) {
    // a C-level person's only for the CEO and a Super Admin (owner, 19 October 2026: "make C level Employees details not
    // visible to HR")
    const rows = await this.prisma.contract.findMany({
      where: { approval: 'pending_ceo', status: 'draft', employment: await this.confidential.ownedWhere(user) },
      orderBy: [{ sentAt: 'asc' }, { number: 'asc' }],
      include: PENDING_INCLUDE,
    });
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
          hoursPerWeek: before.hoursPerWeek?.toNumber() ?? null,
          hourlyMinimum: sees ? (before.hourlyMinimum?.toNumber() ?? null) : null,
          allowancesTotal: sees ? beforeAllowances : null,
          // how each was taxed and insured, for the net before and after the CEO's other raise (17 October 2026)
          allowances: sees ? before.allowances.map((a) => ({ amount: a.amount.toNumber(), taxable: a.taxable, insured: a.insured })) : null,
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
  async terms(employment: EmploymentRow, current: ContractRow, input: RaiseInput) {
    const problem = raiseEffectiveProblem(input.effectiveDate, { startDate: fromDateOnly(current.startDate), endDate: fromDateOnly(current.endDate) });
    if (problem) throw new BadRequestException(problem);
    const allowances = [...input.allowances];
    let terms;
    if (input.way === 'contract') {
      const { allowances: _rows, ...t } = await this.contracts.terms(employment, current, {
        // the contract's length as it is (owner, 18 October 2026): open-ended stays open-ended, a specific job its job
        // and the day it is expected to be done
        form: current.form as ContractForm,
        jobToDo: current.jobToDo,
        endDate: current.form === 'specific_job' ? fromDateOnly(current.endDate) : null,
        startDate: input.effectiveDate,
        durationMonths: input.durationMonths,
        probationMonths: 0,
        basicPercent: input.basicPercent,
        netSalary: input.netSalary,
        payBasis: input.payBasis,
        grossSalary: input.grossSalary,
        hourlyRate: input.hourlyRate,
        hoursPerWeek: input.hoursPerWeek,
        hourlyMinimum: input.hourlyMinimum,
        daysPerWeek: input.daysPerWeek,
        allowances,
      });
      terms = { ...t, kind: 'contract' as const };
    } else {
      const pay = this.contracts.pay({ ...input, allowances });
      // a salary of 0 only for someone paid per client account (owner, 27 October 2026)
      const zero = zeroSalaryProblem(pay.grossSalary, allowances);
      if (zero) throw new BadRequestException(zero);
      const total = allowancesTotal(allowances);
      if (input.netSalary !== null && Math.round(input.netSalary * 100) > Math.round((pay.grossSalary + total) * 100)) {
        throw new BadRequestException(allowances.length ? "The net salary can't be more than the gross salary and the allowances together." : "The net salary can't be more than the gross salary.");
      }
      terms = {
        kind: 'amendment' as const,
        // the contract's length and job as they are (an open-ended one has no end, Art. 87)
        form: current.form as ContractForm,
        jobToDo: current.jobToDo,
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

  /**
   * One of the CEO's steps (or HR's send): saved with the request it came from (its status, and `requestData`: the CEO's
   * other reason) and logged on it (`logged`), and in the audit log.
   */
  private async step(
    before: ContractRow,
    data: Prisma.ContractUncheckedUpdateInput,
    action: string,
    requestStatus: string,
    user: SessionUser,
    employment?: EmploymentRow,
    more: Record<string, unknown> = {},
    logged?: StepInput,
    requestData: Prisma.RaiseRequestUncheckedUpdateInput = {},
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.contract.update({ where: { id: before.id }, data, include: CONTRACT_INCLUDE });
      if (before.raiseRequest) {
        await tx.raiseRequest.update({ where: { id: before.raiseRequest.id }, data: { ...requestData, status: requestStatus } });
        if (logged) await recordStep(tx, before.raiseRequest.id, user.id, logged);
      }
      return saved;
    });
    await this.audit.record({
      userId: user.id,
      action,
      entityType: ENTITY,
      entityId: before.id,
      diff: { employmentId: before.employmentId, number: before.number, version: before.version, approval: { from: before.approval, to: row.approval }, ...more },
    });
    if (before.raiseRequest && (before.raiseRequest.status !== requestStatus || Object.keys(requestData).length > 0)) {
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
  private async preparable(requestId: string, employeeId: string): Promise<Preparable> {
    const r = await this.prisma.raiseRequest.findUnique({ where: { id: requestId }, select: PREPARABLE });
    if (!r || r.employeeId !== employeeId) throw new NotFoundException('Raise request not found for this employee.');
    if (r.status !== 'with_hr') throw new ConflictException('This raise request is no longer with HR, so a raise can’t be prepared from it.');
    if (r.contractId) {
      throw new ConflictException('A raise is already prepared from this request: change it with the contract and send it to the CEO, or reject the request.');
    }
    return r;
  }

  /** The contract in force a raise is made on: signed, with no draft after it, and no ending of the employment in progress. */
  private async raisable(employment: EmploymentRow): Promise<ContractRow> {
    assertCurrent(employment);
    // an intern is paid no wage (owner, 19 October 2026: the unpaid internship, outside the labour law): nothing to raise
    if (employment.employmentType === 'intern') {
      throw new BadRequestException(
        'An intern is paid no wage (an unpaid internship, outside the labour law): there is no pay to raise. To pay a salary, convert the internship agreement to a full-time contract.',
      );
    }
    const versions = await this.prisma.contract.findMany({ where: { employmentId: employment.id }, orderBy: { version: 'desc' }, include: CONTRACT_INCLUDE });
    const draft = versions.find((v) => v.status === 'draft');
    if (draft) throw new ConflictException(`Version ${draft.version} (${draft.number}) is still a draft. Sign or delete it before adding a raise.`);
    const current = versions[0];
    if (current?.status !== 'active') throw new ConflictException('A raise changes the signed contract in force: sign the contract first.');
    await this.assertNoEnding(employment.id);
    return current;
  }

  /**
   * The pay a request's suggestion comes to on the contract in force, with the figure suggested: an amount or a percent;
   * a gross typed before 17 October 2026 as it is, on a monthly salary. Null without a suggestion.
   */
  private suggested(r: Preparable, current: ContractRow): (ReturnType<typeof raisedPay> & { figure: RaiseFigure | null }) | null {
    const figure = typedFigure(r.suggestedIncrease?.toNumber(), r.suggestedPercent?.toNumber());
    if (figure) return { ...raisedPay(payOf(current), figure), figure };
    if (r.suggestedGross && current.payBasis !== 'hourly') return { grossSalary: r.suggestedGross.toNumber(), hourlyRate: null, hoursPerWeek: null, figure: null };
    return null;
  }

  /**
   * The CEO's other raise on a raise or renewal: its pay changed to the figure over the pay before it (the gross, or by
   * the hour the rate for its own hours), with the net and the insured salary worked out again for the year it starts
   * in, the allowances as they are. Refused when it comes to the pay before it, or for a raise that moves to pay by the
   * hour (its rate is HR's to set: return it).
   */
  private async otherPay(raise: ContractRow, previous: ContractRow, figure: RaiseFigure) {
    if (raise.payBasis === 'hourly' && previous.payBasis !== 'hourly') {
      throw new BadRequestException(`${raise.number} moves to pay by the hour: return it to HR to set the hourly rate.`);
    }
    const pay = raisedPay({ ...payOf(previous), payBasis: raise.payBasis }, figure, raise.hoursPerWeek?.toNumber() ?? null);
    if (pay.grossSalary > MAX_MONEY) throw new BadRequestException('That raise comes to more than a monthly salary can be. Check it.');
    const allowances = raise.allowances.map(allowanceView);
    if (samePay(payTermsOf(previous), payTermsOf({ ...raise, grossSalary: pay.grossSalary, hourlyRate: raise.payBasis === 'hourly' ? pay.hourlyRate : null, allowances }))) {
      throw new BadRequestException('That raise comes to the pay as it is now: a raise changes the pay.');
    }
    const rates = await this.lawRates.forYear(raise.startDate.getUTCFullYear());
    return {
      grossSalary: pay.grossSalary,
      ...(raise.payBasis === 'hourly' && { hourlyRate: pay.hourlyRate }),
      netSalary: grossToNet(pay.grossSalary, rates, allowances).net,
      insuredSalary: insuredWageOf(pay.grossSalary, allowances, rates),
    };
  }

  /**
   * Saves a raise: a draft for HR to send, with its request prepared directly by HR (19 October 2026); or, from a raise
   * request, HR's approval of it, sent to the CEO at once, with the request's steps logged in the same transaction (HR's
   * decision, the raise prepared, sent to the CEO).
   */
  private async insert(
    employment: EmploymentRow,
    current: ContractRow,
    raise: { terms: RaiseTerms; way: RaiseWay; reason: string; allowances: AllowanceSnapshot[]; promotion: Promotion; note: string | null },
    user: SessionUser,
    approval: { request: Preparable; decision: 'approve' | 'approve_other'; comment: string; figure: RaiseFigure | null } | null,
  ) {
    const { terms, allowances, promotion } = raise;
    const employmentId = employment.id;
    const values = {
      ...terms,
      number: raise.way === 'amendment' ? amendmentNumber(current.number) : await this.contracts.nextNumber(terms.startDate),
      version: current.version + 1,
      raiseReason: raise.reason,
      approval: approval ? 'pending_ceo' : 'draft',
      sentAt: approval ? new Date() : null,
      newJobTitleId: promotion.jobTitle?.id ?? null,
      newGradeId: promotion.grade?.id ?? null,
      note: raise.note,
    };
    const { row, direct } = await this.prisma.$transaction(async (tx): Promise<{ row: ContractRow; direct: { id: string; audit: AuditEntry } | null }> => {
      const made = await tx.contract.create({
        data: { ...toData({ ...values, employmentId }), allowances: { create: allowanceData(allowances) } },
        include: CONTRACT_INCLUDE,
      });
      if (!approval) {
        // entered directly (owner, 19 October 2026): its request, prepared directly by HR, so it is on Raise Requests too
        const opened = await openDirectRequest(tx, { ...made, employeeId: employment.employeeId }, current.grossSalary.toNumber(), user.id);
        return { row: await tx.contract.findUniqueOrThrow({ where: { id: made.id }, include: CONTRACT_INCLUDE }), direct: opened };
      }
      const { request } = approval;
      await tx.raiseRequest.update({ where: { id: request.id }, data: { contractId: made.id, status: 'with_ceo' } });
      // with the effective date HR chose (the request's Effective from unless HR set another, 17 October 2026)
      await recordStep(tx, request.id, user.id, {
        kind: 'hr_decision',
        decision: approval.decision,
        comment: approval.comment,
        effectiveDate: terms.startDate,
        ...stepFigures(current.grossSalary.toNumber(), terms.grossSalary, approval.figure),
      });
      await recordStep(tx, request.id, user.id, { kind: 'prepared', way: raise.way, effectiveDate: terms.startDate, contractNumber: made.number });
      await recordStep(tx, request.id, user.id, { kind: 'sent', gross: terms.grossSalary });
      return { row: await tx.contract.findUniqueOrThrow({ where: { id: made.id }, include: CONTRACT_INCLUDE }), direct: null };
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: ENTITY,
      entityId: row.id,
      diff: salaryMasked({
        employeeId: employment.employeeId,
        employmentId,
        way: raise.way,
        replaces: current.number,
        ...values,
        allowances: comparable(allowances),
        ...(approval && { request: approval.request.id }),
        ...(direct && { request: direct.id }),
      }),
    });
    if (direct) await this.audit.record(direct.audit);
    if (approval) {
      const { request, figure } = approval;
      await this.audit.record({
        userId: user.id,
        action: 'prepare',
        entityType: REQUEST,
        entityId: request.id,
        // a figure only as set (restricted)
        diff: {
          employeeId: employment.employeeId,
          contract: row.number,
          decision: approval.decision,
          comment: approval.comment,
          ...(figure && { [figure.kind === 'amount' ? 'increaseAmount' : 'increasePercent']: 'set' }),
        },
      });
      await this.audit.record({ userId: user.id, action: 'submit', entityType: REQUEST, entityId: request.id, diff: { contract: row.number, status: { from: 'with_hr', to: 'with_ceo' } } });
      // sent to the CEO at once (Phase 4: notifications)
      await this.notices.payRaiseSent(row.id);
    }
    return contractView(row, await this.contracts.context(user, employment));
  }
}
