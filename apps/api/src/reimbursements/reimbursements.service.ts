import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  adjustmentTaxed,
  decisionNeedsComment,
  decisionStepKind,
  firstReimbursementStatus,
  isOpenReimbursement,
  lowerAmountProblem,
  REIMBURSEMENT_OPEN_STATUSES,
  REIMBURSEMENT_STATUS_LABELS,
  reimbursementPayMonth,
  reimbursementProblems,
  reimbursementStage,
  statusAfterApproval,
  type ReimbursementStatus,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { seesEmployeeFile } from '../employees/access.js';
import type { Prisma } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { RunAdjustmentsService } from '../payroll/adjustments/run-adjustments.service.js';
import { ADJUSTMENT } from '../payroll/adjustments/views.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { decidesStage, isClaimant, isClaimManager, seesClaim, seesEveryClaim, waitingWhere, type Caller } from './access.js';
import { recordClaimStep } from './claim-steps.js';
import { checkedReceipts } from './receipts.js';
import { additionReason, mayClaimType, useOf, type CountedClaim } from './rules.js';
import type { CreateReimbursementDto, DecideReimbursementDto, ListReimbursementsDto } from './reimbursements.dto.js';
import { CLAIM_ENTITY, CLAIM_INCLUDE, claimView, myTypeView, RECEIPT_ENTITY, rulesOf, type ClaimRow, type ReimbursementClaimView } from './views.js';

/** The papers a profile's picture can be, as the employee profile shows it (employees.service.ts). */
const PHOTO = { kind: 'personal_photo', mimeType: { in: ['image/jpeg', 'image/png', 'image/webp'] } } satisfies Prisma.PaperworkItemWhereInput;

/** A status as a message says it: "with HR", "approved". */
const statusWords = (status: string) => {
  const label = REIMBURSEMENT_STATUS_LABELS[status as ReimbursementStatus] ?? status;
  return label[0].toLowerCase() + label.slice(1);
};

const NOT_FOUND = 'Reimbursement claim not found.';

// Reimbursement claims (owner, 18 October 2026: "allow the employee to add reimbursement request … for specific preset
// up conditions"; asked, the owner chose: the direct manager, then HR, then Finance, straight to HR without a manager;
// each approves, approves a lower amount with a comment, or rejects with one; paid with the next payroll). An employee
// claims a type they may claim (mayClaimType) under their current employment, with the receipts, and a claim that breaks
// one of the type's conditions is refused with every reason (reimbursementProblems), the caps counting their claims of
// the type still open or approved. The claim goes to the direct manager they had when they sent it (a manager who is the
// employee themself counts as none), HR and Finance in turn; nobody decides their own claim. Finance's approval adds it,
// untaxed, to the payroll of the month it is approved in, or of the first after it whose run isn't approved or paid
// (reimbursementPayMonth), as a Reimbursement addition in Additions / Deductions, in the same transaction; a draft run of
// that month takes it at once. The employee cancels it while it is open. Each step is logged on the claim
// (claim-steps.ts) and in the audit log, every view of a receipt too, as paperwork's restricted scans are. Those who may
// not see a claim (the employee, the manager it was sent to, HR, Finance, the CEO) are told it isn't there.
@Injectable()
export class ReimbursementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly runs: RunAdjustmentsService,
  ) {}

  // ---------- the employee's own ----------

  /**
   * The types the employee may claim now (on, and theirs to claim under their current employment), by name, with what
   * their claims of each already take of its caps in the month and year of `expenseDate` (today in Cairo unless sent).
   * None without a current employment.
   */
  async typesForMe(expenseDate: string | undefined, user: SessionUser) {
    const caller = await this.caller(user);
    const employment = caller.employeeId ? await this.currentEmployment(caller.employeeId) : null;
    if (!caller.employeeId || !employment) return [];
    const date = expenseDate ?? todayInCairo();
    const types = (await this.prisma.reimbursementType.findMany({ where: { active: true }, orderBy: { nameEn: 'asc' } })).filter((t) => mayClaimType(t, placeOf(employment)));
    if (!types.length) return [];
    const claims = await this.counted(this.prisma, caller.employeeId, types.map((t) => t.id), date);
    return types.map((t) => myTypeView(t, useOf(claims.get(t.id) ?? [], date)));
  }

  /** A claim by the employee, with its receipts. */
  async create(dto: CreateReimbursementDto, files: Express.Multer.File[] | undefined, user: SessionUser): Promise<ReimbursementClaimView> {
    const caller = await this.caller(user);
    if (!caller.employeeId) throw new ForbiddenException('Only an employee can claim a reimbursement: your sign-in has no employee profile.');
    const employeeId = caller.employeeId;
    const employment = await this.currentEmployment(employeeId);
    if (!employment) throw new ConflictException("You have no current employment, so you can't claim a reimbursement.");
    const type = await this.prisma.reimbursementType.findUnique({ where: { id: dto.typeId } });
    if (!type) throw new BadRequestException(['Choose a reimbursement type from the list.']);
    if (!type.active) throw new BadRequestException([`${type.nameEn} is turned off, so it can't be claimed. Choose another type.`]);
    if (!mayClaimType(type, placeOf(employment))) throw new BadRequestException([`${type.nameEn} isn't for your department, grade or employment type. Choose another type.`]);
    const { receipts, problems: receiptProblems } = checkedReceipts(files);
    const rules = rulesOf(type);
    // a direct manager who is the employee themself is none: it goes straight to HR
    const managerId = employment.managerId && employment.managerId !== employeeId ? employment.managerId : null;
    const status = firstReimbursementStatus(managerId !== null);
    // the receipts listed in the order attached: each a millisecond after the one before, as they are saved together
    const uploadedAt = Date.now();

    const id = await this.prisma.$transaction(async (tx) => {
      // the caps hold even when two claims are sent together: the employee's row is held until this one is saved
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      const counted = await this.counted(tx, employeeId, [type.id], dto.expenseDate);
      const problems = [
        ...receiptProblems,
        ...reimbursementProblems(
          { amount: dto.amount, expenseDate: dto.expenseDate, today: todayInCairo(), receipts: files?.length ?? 0 },
          rules,
          useOf(counted.get(type.id) ?? [], dto.expenseDate),
        ),
      ];
      if (problems.length) throw new BadRequestException(problems);
      const made = await tx.reimbursementClaim.create({
        data: {
          employeeId,
          employmentId: employment.id,
          typeId: type.id,
          expenseDate: toDateOnly(dto.expenseDate),
          amount: dto.amount,
          description: dto.description,
          status,
          managerId,
          createdById: user.id,
          receipts: {
            create: receipts.map((r, i) => ({ fileName: r.fileName, mimeType: r.mimeType, sizeBytes: r.sizeBytes, data: new Uint8Array(r.data), uploadedAt: new Date(uploadedAt + i) })),
          },
        },
        select: { id: true },
      });
      await recordClaimStep(tx, made.id, user.id, { kind: 'submitted', amount: dto.amount });
      if (!managerId) await recordClaimStep(tx, made.id, null, { kind: 'no_manager' });
      return made.id;
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: CLAIM_ENTITY,
      entityId: id,
      diff: {
        employeeId,
        typeId: type.id,
        type: type.nameEn,
        expenseDate: dto.expenseDate,
        amount: dto.amount,
        description: dto.description,
        receipts: receipts.map((r) => r.fileName),
        managerId,
        status,
      },
    });
    return this.one(id, user);
  }

  /** The employee's own claims, newest first; none without an employee profile. */
  async mine(user: SessionUser): Promise<ReimbursementClaimView[]> {
    const caller = await this.caller(user);
    if (!caller.employeeId) return [];
    const rows = await this.prisma.reimbursementClaim.findMany({ where: { employeeId: caller.employeeId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: CLAIM_INCLUDE });
    return this.views(rows, caller);
  }

  /** The employee cancels their own claim while it is being decided. Anyone else is told it isn't there. */
  async cancel(id: string, user: SessionUser): Promise<ReimbursementClaimView> {
    const caller = await this.caller(user);
    const before = await this.prisma.reimbursementClaim.findUnique({ where: { id }, select: { employeeId: true, managerId: true, status: true } });
    if (!before || !isClaimant(before, caller)) throw new NotFoundException(NOT_FOUND);
    if (!isOpenReimbursement(before.status)) throw new ConflictException(`This claim is ${statusWords(before.status)}, so it can't be cancelled.`);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.reimbursementClaim.updateMany({ where: { id, status: { in: [...REIMBURSEMENT_OPEN_STATUSES] } }, data: { status: 'cancelled' } });
      if (!count) throw new ConflictException("This claim was decided meanwhile, so it can't be cancelled. Reload the page to see where it is.");
      await recordClaimStep(tx, id, user.id, { kind: 'cancelled' });
    });
    await this.audit.record({ userId: user.id, action: 'cancel', entityType: CLAIM_ENTITY, entityId: id, diff: { employeeId: before.employeeId, status: { from: before.status, to: 'cancelled' } } });
    return this.one(id, user);
  }

  // ---------- deciding and seeing them ----------

  /**
   * The claims the caller sees, newest first: HR, Finance and the CEO everyone's; a manager those sent to them. `waiting`:
   * those waiting for the caller's decision.
   */
  async list(query: ListReimbursementsDto, user: SessionUser): Promise<ReimbursementClaimView[]> {
    const caller = await this.caller(user);
    const rows = await this.prisma.reimbursementClaim.findMany({
      where: {
        AND: [
          this.scope(caller),
          query.status === 'waiting' ? waitingWhere(caller) : query.status ? { status: query.status } : {},
          query.employeeId ? { employeeId: query.employeeId } : {},
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: CLAIM_INCLUDE,
    });
    return this.views(rows, caller);
  }

  /** How many claims wait for the caller's decision, for the menu's badges. */
  async counts(user: SessionUser): Promise<{ waiting: number }> {
    const caller = await this.caller(user);
    return { waiting: await this.prisma.reimbursementClaim.count({ where: waitingWhere(caller) }) };
  }

  /** One claim, for those who may see it. */
  async one(id: string, user: SessionUser): Promise<ReimbursementClaimView> {
    const caller = await this.caller(user);
    const row = await this.visible(id, caller);
    return (await this.views([row], caller))[0];
  }

  /** A receipt's file, for those who may see the claim; every view is in the audit log. */
  async receipt(id: string, receiptId: string, user: SessionUser) {
    const caller = await this.caller(user);
    const claim = await this.visible(id, caller);
    const file = await this.prisma.reimbursementReceipt.findFirst({ where: { id: receiptId, claimId: id }, select: { id: true, fileName: true, mimeType: true, data: true } });
    if (!file) throw new NotFoundException('Receipt not found.');
    await this.audit.record({
      userId: user.id,
      action: 'view_restricted',
      entityType: RECEIPT_ENTITY,
      entityId: file.id,
      diff: { claimId: id, employeeId: claim.employeeId, fields: ['file'] },
    });
    return { data: Buffer.from(file.data.buffer, file.data.byteOffset, file.data.byteLength), type: file.mimeType, fileName: file.fileName };
  }

  /**
   * The decision of the stage the claim is at, by its decider: its direct manager, HR, then Finance; never the
   * employee's own. Approve keeps the amount as it reached the stage; approve a lower amount (with a comment) lowers it;
   * reject (with a comment) ends it. Finance's approval adds it to the next payroll in the same transaction.
   */
  async decide(id: string, dto: DecideReimbursementDto, user: SessionUser): Promise<ReimbursementClaimView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    const stage = reimbursementStage(before.status);
    if (!stage) throw new ConflictException(`This claim is ${statusWords(before.status)}, so there is nothing left to decide. Reload the page to see it.`);
    if (isClaimant(before, caller)) throw new ForbiddenException('Someone else has to decide your own claim.');
    if (!decidesStage(stage, before, caller)) {
      // one of its deciders, on a page left open while it moved on (or not with them yet)
      const decider = isClaimManager(before, caller) || decidesStage('hr', before, caller) || decidesStage('finance', before, caller);
      if (decider) throw new ConflictException(`This claim is ${statusWords(before.status)} now, so it isn't waiting for your decision. Reload the page to see where it is.`);
      throw new ForbiddenException("Only the claim's direct manager, HR and Finance decide a reimbursement claim.");
    }
    const comment = dto.comment ?? null;
    if (decisionNeedsComment(dto.decision) && !comment) {
      throw new BadRequestException(dto.decision === 'reject' ? 'Write a comment: why the claim is rejected.' : 'Write a comment: why a lower amount is approved.');
    }
    const current = (before.approvedAmount ?? before.amount).toNumber();
    let approved: number | null = null;
    if (dto.decision === 'approve') approved = current;
    if (dto.decision === 'approve_other') {
      const problem = dto.amount === undefined || dto.amount === null ? 'Enter the amount approved, more than 0, e.g. 250 or 250.50.' : lowerAmountProblem(dto.amount, current);
      if (problem) throw new BadRequestException(problem);
      approved = dto.amount!;
    }
    const to: ReimbursementStatus = approved === null ? 'rejected' : statusAfterApproval(stage);
    const paying = to === 'approved' && approved !== null;
    const reason = additionReason(before.type.nameEn, before.description);

    const added = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.reimbursementClaim.updateMany({
        where: { id, status: before.status },
        data: approved === null ? { status: to, rejectedStage: stage, rejectReason: comment } : { status: to, approvedAmount: approved },
      });
      if (!count) throw new ConflictException('This claim was decided or cancelled meanwhile. Reload the page to see where it is.');
      await recordClaimStep(tx, id, user.id, { kind: decisionStepKind(stage), decision: dto.decision, amount: approved, comment });
      if (!paying) return null;
      // paid with the payroll of this month in Cairo, or of the first after it whose run isn't approved or paid yet
      const closed = await tx.payrollRun.findMany({ where: { status: { in: ['approved', 'paid'] } }, select: { month: true } });
      const payMonth = reimbursementPayMonth(todayInCairo(), closed.map((r) => fromDateOnly(r.month)));
      const adjustment = await tx.payrollAdjustment.create({
        data: {
          employeeId: before.employeeId,
          month: toDateOnly(payMonth),
          kind: 'addition',
          type: 'reimbursement',
          // never taxed: a reimbursement pays back what was spent (packages/shared payroll-adjustments.ts)
          taxed: adjustmentTaxed('addition', 'reimbursement', null) ?? false,
          amount: approved,
          reason,
          createdById: user.id,
        },
        select: { id: true },
      });
      await tx.reimbursementClaim.update({ where: { id }, data: { adjustmentId: adjustment.id, payMonth: toDateOnly(payMonth) } });
      await recordClaimStep(tx, id, user.id, { kind: 'added_to_payroll', amount: approved, payMonth });
      return { adjustmentId: adjustment.id, payMonth };
    });

    await this.audit.record({
      userId: user.id,
      action: approved === null ? 'reject' : 'approve',
      entityType: CLAIM_ENTITY,
      entityId: id,
      diff: {
        employeeId: before.employeeId,
        stage,
        decision: dto.decision,
        status: { from: before.status, to },
        ...(approved !== null && { amount: approved }),
        ...(comment && { comment }),
        ...(added && { payMonth: added.payMonth, adjustmentId: added.adjustmentId }),
      },
    });
    if (added) {
      const month = added.payMonth.slice(0, 7);
      // the addition's own entry, as Additions / Deductions logs one (the amount only as set)
      await this.audit.record({
        userId: user.id,
        action: 'create',
        entityType: ADJUSTMENT,
        entityId: added.adjustmentId,
        diff: { employeeCode: before.employee.employeeCode, month, kind: 'addition', type: 'reimbursement', taxed: false, amount: 'set', reason, reimbursementClaimId: id },
      });
      await this.runs.syncDrafts([month], [before.employeeId], user);
    }
    return this.one(id, user);
  }

  // ---------- helpers ----------

  /** The caller, with their own employee profile: the one whose work email they sign in with. */
  private async caller(user: SessionUser): Promise<Caller> {
    const me = await this.prisma.employee.findUnique({ where: { workEmail: user.email.toLowerCase() }, select: { id: true } });
    return { user, employeeId: me?.id ?? null };
  }

  /** The claims the caller sees: everyone's for HR, Finance and the CEO; a manager those sent to them; otherwise none. */
  private scope(caller: Caller): Prisma.ReimbursementClaimWhereInput {
    if (seesEveryClaim(caller.user)) return {};
    return caller.employeeId ? { managerId: caller.employeeId } : { id: { in: [] } };
  }

  /** A claim the caller may see; otherwise it isn't there. */
  private async visible(id: string, caller: Caller): Promise<ClaimRow> {
    const row = await this.prisma.reimbursementClaim.findUnique({ where: { id }, include: CLAIM_INCLUDE });
    if (!row || !seesClaim(row, caller)) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private currentEmployment(employeeId: string) {
    return this.prisma.employment.findFirst({
      where: { employeeId, endDate: null },
      orderBy: { joinDate: 'desc' },
      select: { id: true, managerId: true, departmentId: true, gradeId: true, employmentType: true, department: { select: { parentId: true } } },
    });
  }

  /** The employee's claims of the types in the year of `date`, by type, as their caps count them. */
  private async counted(db: Prisma.TransactionClient | PrismaService, employeeId: string, typeIds: string[], date: string): Promise<Map<string, CountedClaim[]>> {
    const year = date.slice(0, 4);
    const rows = await db.reimbursementClaim.findMany({
      where: { employeeId, typeId: { in: typeIds }, expenseDate: { gte: toDateOnly(`${year}-01-01`), lte: toDateOnly(`${year}-12-31`) } },
      select: { typeId: true, status: true, amount: true, approvedAmount: true, expenseDate: true },
    });
    const out = new Map<string, CountedClaim[]>();
    for (const r of rows) {
      const claim = { status: r.status, amount: r.amount.toNumber(), approvedAmount: r.approvedAmount?.toNumber() ?? null, expenseDate: fromDateOnly(r.expenseDate) };
      out.set(r.typeId, [...(out.get(r.typeId) ?? []), claim]);
    }
    return out;
  }

  /** The claims as the caller sees them: with who took each step, and for HR and the CEO each person's picture. */
  private async views(rows: readonly ClaimRow[], caller: Caller): Promise<ReimbursementClaimView[]> {
    if (!rows.length) return [];
    const [names, photos] = await Promise.all([
      userNames(this.prisma, rows.flatMap((r) => r.steps.map((s) => s.actor))),
      seesEmployeeFile(caller.user) ? this.photos([...new Set(rows.map((r) => r.employeeId))]) : null,
    ]);
    return rows.map((r) => claimView(r, caller, names, photos));
  }

  /** Each employee's picture: the personal photo uploaded last as an image, as its paper's id, as the profile shows it. */
  private async photos(employeeIds: string[]): Promise<Map<string, string>> {
    const items = await this.prisma.paperworkItem.findMany({
      where: { ...PHOTO, employeeId: { in: employeeIds } },
      select: { id: true, employeeId: true },
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
    });
    const latest = new Map<string, string>();
    for (const item of items) if (!latest.has(item.employeeId)) latest.set(item.employeeId, item.id);
    return latest;
  }
}

/** Where the employee works, as mayClaimType takes it. */
function placeOf(e: { departmentId: string | null; gradeId: string | null; employmentType: string; department: { parentId: string | null } | null }) {
  return { departmentId: e.departmentId, parentDepartmentId: e.department?.parentId ?? null, gradeId: e.gradeId, employmentType: e.employmentType };
}
