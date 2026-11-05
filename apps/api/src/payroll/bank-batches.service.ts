import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PayrollStatus } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly, todayInCairo } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { userNames } from './adjustments/people.js';
import { achAccount, cleanBankDetails, inFile, lineBank, type BankFileKind } from './bank.js';
import { BATCH_INCLUDE, batchFileName, batchUsers, batchView, FILE_NAMES, sumAmounts, type BatchRow, type PayrollBankBatchView } from './bank-batches.js';
import { achWorkbook, cibWorkbook } from './bank-files.js';
import { monthName } from './months.js';
import type { MakeBankBatchDto } from './payroll.dto.js';
import { PayrollSettingsService } from './payroll-settings.service.js';
import { STATUS_TEXT } from './status.js';
import { isApproved, monthOf } from './views.js';

// Bank transfer batches (owner, 5 November 2026: "allow me to select a group of people for the transfer", "and to
// confirm each batch sent to be recorded"; asked, "Tick names", "Show it, still pickable"). Once the CEO approved a
// run, whoever makes the bank files (HR, Finance, the CEO, a Super Admin) ticks the people one file pays and makes a
// batch of them: numbered within the run, with each one's amount, its file made from the bank details copied at the
// approval. Someone already in a batch may be ticked again (the page starts them unticked). A batch is confirmed once
// it is sent to the bank, and kept from then on; until then it may be discarded. The C-level people's lines are never
// in a batch made by someone they are hidden from (19 October 2026), and a batch with them in it is downloaded,
// confirmed or discarded only by someone who sees them. Every step is in the audit log, as the run's.

const RUN = 'payroll_run';

/** The bank details a line of an approved run is paid to: those copied at the approval. */
const approvedDetails = (l: { bankShort: string | null; accountNo: string | null; iban: string | null; holderName: string | null }) =>
  cleanBankDetails({ bank: l.bankShort, accountNo: l.accountNo, iban: l.iban, holderName: l.holderName });

const RUN_LINES = { lines: { select: { id: true, employeeId: true, employeeCode: true, nameEn: true, onHold: true, transfer: true, bankShort: true, accountNo: true, iban: true, holderName: true } } } satisfies Prisma.PayrollRunInclude;

@Injectable()
export class BankBatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: PayrollSettingsService,
    private readonly confidential: ConfidentialService,
  ) {}

  /** A batch of the people ticked for one bank file of an approved run. */
  async make(runId: string, dto: MakeBankBatchDto, user: SessionUser): Promise<PayrollBankBatchView> {
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId }, include: RUN_LINES });
    if (!run) throw new NotFoundException('Payroll not found.');
    const month = monthOf(run);
    this.assertApproved(run, month);
    const kind = dto.file;
    if (kind === 'cib') await this.cibAccount();

    const hidden = new Set(await this.confidential.hiddenFrom(user));
    const byId = new Map(run.lines.filter((l) => !hidden.has(l.employeeId)).map((l) => [l.id, l]));
    const picked = [...new Set(dto.lineIds)].map((id) => {
      const line = byId.get(id);
      if (!line) throw new BadRequestException(`Someone ticked isn't on the ${monthName(month)} payroll. Reload the page and tick again.`);
      const transfer = line.transfer.toNumber();
      const bank = lineBank(approvedDetails(line));
      if (!inFile({ onHold: line.onHold, transfer, bank }, kind)) {
        throw new BadRequestException(`${line.nameEn} isn't paid through the ${FILE_NAMES[kind]} file this month.`);
      }
      return { line, amount: transfer };
    });
    const total = sumAmounts(picked.map((p) => p.amount));
    const valueDate = kind === 'cib' ? (dto.valueDate ?? todayInCairo()) : null;

    let batch: BatchRow;
    try {
      batch = await this.prisma.$transaction(async (tx) => {
        const last = await tx.payrollBankBatch.aggregate({ where: { runId }, _max: { number: true } });
        return tx.payrollBankBatch.create({
          data: {
            runId,
            number: (last._max.number ?? 0) + 1,
            file: kind,
            valueDate: valueDate ? toDateOnly(valueDate) : null,
            total,
            madeById: user.id,
            lines: { create: picked.map((p) => ({ lineId: p.line.id, amount: p.amount })) },
          },
          include: BATCH_INCLUDE,
        });
      });
    } catch (err) {
      // two made at once: the second takes the next number when tried again
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException('Another batch was made at the same moment. Try again.');
      throw err;
    }
    await this.audit.record({
      userId: user.id,
      action: 'payroll_bank_batch',
      entityType: RUN,
      entityId: runId,
      diff: { month, batch: batch.number, file: kind, employees: picked.map((p) => p.line.employeeCode), total, ...(valueDate && { valueDate }) },
    });
    return this.view(batch, hidden);
  }

  /** The batch's bank file, made from the bank details copied at the approval and the amounts in the batch. */
  async file(runId: string, batchId: string, user: SessionUser): Promise<{ fileName: string; data: Buffer }> {
    const { run, batch, hidden } = await this.batch(runId, batchId, user);
    this.assertActs(batch, hidden, 'download');
    const month = monthOf(run);
    const kind = batch.file as BankFileKind;
    const lines = await this.prisma.payrollBankBatchLine.findMany({
      where: { batchId },
      select: { amount: true, line: { select: { nameEn: true, employeeCode: true, bankShort: true, accountNo: true, iban: true, holderName: true } } },
      orderBy: [{ line: { department: { sort: 'asc', nulls: 'last' } } }, { line: { nameEn: 'asc' } }],
    });
    const rows = lines.map((l) => {
      const details = approvedDetails(l.line);
      return { name: details.holderName ?? l.line.nameEn, details, amount: l.amount.toNumber() };
    });

    let data: Buffer;
    if (kind === 'cib') {
      const s = await this.cibAccount();
      data = await cibWorkbook({
        fileDate: todayInCairo(),
        valueDate: fromDateOnly(batch.valueDate) ?? todayInCairo(),
        month,
        debitAccount: s.cibDebitAccount,
        debitAccountName: s.cibDebitAccountName,
        lines: rows.map((r) => ({ account: r.details.accountNo!, name: r.name, amount: r.amount })),
      });
    } else {
      const s = await this.settings.row();
      data = await achWorkbook({
        month,
        purpose: s.achPurpose,
        lines: rows.map((r) => ({ name: r.name, account: achAccount(r.details)!, bankShort: lineBank(r.details).bankShort!, amount: r.amount })),
      });
    }
    await this.audit.record({
      userId: user.id,
      action: 'payroll_bank_file',
      entityType: RUN,
      entityId: runId,
      diff: { month, batch: batch.number, file: kind, employees: lines.map((l) => l.line.employeeCode), ...(kind === 'cib' && { valueDate: fromDateOnly(batch.valueDate) }) },
    });
    return { fileName: batchFileName(kind, month, batch.number), data };
  }

  /** Confirms the batch was sent to the bank: kept from then on. */
  async sent(runId: string, batchId: string, user: SessionUser): Promise<PayrollBankBatchView> {
    const { run, batch, hidden } = await this.batch(runId, batchId, user);
    this.assertActs(batch, hidden, 'confirm');
    if (batch.sentAt) throw new ConflictException(`Batch ${batch.number} was already confirmed sent to the bank.`);
    const updated = await this.prisma.payrollBankBatch.update({ where: { id: batchId }, data: { sentAt: new Date(), sentById: user.id }, include: BATCH_INCLUDE });
    await this.audit.record({
      userId: user.id,
      action: 'payroll_bank_batch_sent',
      entityType: RUN,
      entityId: runId,
      diff: { month: monthOf(run), batch: batch.number, file: batch.file, people: batch.lines.length, total: batch.total.toNumber() },
    });
    return this.view(updated, hidden);
  }

  /** Discards a batch that wasn't sent to the bank: its people may be ticked again, as before. */
  async discard(runId: string, batchId: string, user: SessionUser): Promise<void> {
    const { run, batch, hidden } = await this.batch(runId, batchId, user);
    this.assertActs(batch, hidden, 'discard');
    if (batch.sentAt) throw new ConflictException(`Batch ${batch.number} was sent to the bank, so it is kept.`);
    await this.prisma.payrollBankBatch.delete({ where: { id: batchId } });
    await this.audit.record({
      userId: user.id,
      action: 'payroll_bank_batch_discarded',
      entityType: RUN,
      entityId: runId,
      diff: { month: monthOf(run), batch: batch.number, file: batch.file, employees: batch.lines.map((l) => l.line.employeeCode), total: batch.total.toNumber() },
    });
  }

  // ---------- helpers ----------

  private async batch(runId: string, batchId: string, user: SessionUser) {
    const batch = await this.prisma.payrollBankBatch.findFirst({ where: { id: batchId, runId }, include: { ...BATCH_INCLUDE, run: { select: { id: true, month: true, status: true } } } });
    if (!batch) throw new NotFoundException('Batch not found.');
    return { run: batch.run, batch, hidden: new Set(await this.confidential.hiddenFrom(user)) };
  }

  private assertApproved(run: { month: Date; status: string }, month: string) {
    if (!isApproved(run.status)) {
      throw new ConflictException(`The ${monthName(month)} payroll ${STATUS_TEXT[run.status as PayrollStatus]}: the bank files are made once the CEO approves it.`);
    }
  }

  /** Someone the C-level people are hidden from doesn't act on a batch with them in it. */
  private assertActs(batch: BatchRow, hidden: ReadonlySet<string>, doing: 'download' | 'confirm' | 'discard') {
    if (batch.lines.some((l) => hidden.has(l.line.employeeId))) {
      throw new ForbiddenException(`Batch ${batch.number} pays people whose pay is hidden from you, so only someone who sees them can ${doing} it.`);
    }
  }

  /** The company's CIB account the CIB file pays from: refused until the payroll settings have it. */
  private async cibAccount() {
    const s = await this.settings.row();
    if (!s.cibDebitAccount || !s.cibDebitAccountName) {
      throw new ConflictException("Enter the company's CIB account and its name in the payroll settings first: the CIB file pays the salaries from it.");
    }
    return { cibDebitAccount: s.cibDebitAccount, cibDebitAccountName: s.cibDebitAccountName };
  }

  private async view(batch: BatchRow, hidden: ReadonlySet<string>): Promise<PayrollBankBatchView> {
    return batchView(batch, hidden, await userNames(this.prisma, batchUsers([batch])));
  }
}
