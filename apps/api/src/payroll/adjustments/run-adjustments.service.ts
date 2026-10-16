import { Injectable } from '@nestjs/common';
import type { AdjustmentKind, AdjustmentType, PayrollAdjustmentItem, PayrollRules, PayrollTerms } from '@trendlix/shared';
import { AuditService } from '../../audit/audit.service.js';
import type { SessionUser } from '../../auth/session-user.js';
import { toDateOnly } from '../../common/date-only.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { json, savedInputs, withAdjustments, worked } from '../line-work.js';
import { firstDay } from '../months.js';
import { runLawRates } from '../views.js';
import { AdvancesService } from './advances.service.js';
import { ADJUSTMENT } from './views.js';

const LINE = 'payroll_line';

/** An addition or deduction as a line keeps it. */
export const itemOf = (a: { id: string; kind: string; type: string; taxed: boolean; amount: Prisma.Decimal; reason: string }): PayrollAdjustmentItem => ({
  id: a.id,
  kind: a.kind as AdjustmentKind,
  type: a.type as AdjustmentType,
  taxed: a.taxed,
  amount: a.amount.toNumber(),
  reason: a.reason,
});

/** The ids of the additions and deductions a line's terms hold. */
export const itemIds = (terms: Prisma.JsonValue) => ((terms as unknown as PayrollTerms | null)?.adjustments ?? []).map((a) => a.id);

// The month's run and its additions and deductions (owner, 17 October 2026: Additions / Deductions, one-off amounts per
// employee and month, added to that month's run). A run takes each line's pending ones with its terms when it is made
// or refreshed (payroll.service.ts), and a draft's line is worked out again whenever one of its person's changes, is
// moved or is cancelled, so the run HR sends to the CEO has them as they are. From the CEO's step on they can't change
// (adjustments.service.ts); when the CEO approves the run each is applied to its line, and an advance or loan they
// recover is settled once nothing of it is outstanding. An approved run never changes.
@Injectable()
export class RunAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly advances: AdvancesService,
  ) {}

  /** The month's pending additions and deductions, by employee, each person's in the order entered. */
  async pendingByEmployee(month: string, employeeIds?: readonly string[], tx: Prisma.TransactionClient = this.prisma): Promise<Map<string, PayrollAdjustmentItem[]>> {
    const rows = await tx.payrollAdjustment.findMany({
      where: { month: toDateOnly(firstDay(month)), status: 'pending', ...(employeeIds && { employeeId: { in: [...employeeIds] } }) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const out = new Map<string, PayrollAdjustmentItem[]>();
    for (const r of rows) out.set(r.employeeId, [...(out.get(r.employeeId) ?? []), itemOf(r)]);
    return out;
  }

  /**
   * Works out again the lines of these people on these months' draft runs, with their additions and deductions as they
   * are now; a line whose additions and deductions are the same is left as it is. Every line changed is in the audit
   * log, the amounts only as changed.
   */
  async syncDrafts(months: readonly string[], employeeIds: readonly string[], user: SessionUser | null): Promise<void> {
    for (const month of new Set(months)) {
      const run = await this.prisma.payrollRun.findUnique({
        where: { month: toDateOnly(firstDay(month)) },
        include: { lines: { where: { employeeId: { in: [...employeeIds] } } } },
      });
      if (!run || run.status !== 'draft' || !run.lines.length) continue;
      const pending = await this.pendingByEmployee(month, employeeIds);
      const rules = run.rules as unknown as PayrollRules;
      const law = runLawRates(run);
      for (const line of run.lines) {
        const before = line.terms as unknown as PayrollTerms;
        const terms = withAdjustments(before, pending.get(line.employeeId));
        if (JSON.stringify(before.adjustments ?? []) === JSON.stringify(terms.adjustments ?? [])) continue;
        await this.prisma.payrollLine.update({ where: { id: line.id }, data: { terms: json(terms), ...worked(terms, savedInputs(line.inputs), rules, law) } });
        await this.audit.record({
          userId: user?.id ?? null,
          action: 'update',
          entityType: LINE,
          entityId: line.id,
          diff: { runId: run.id, month, employeeCode: line.employeeCode, adjustments: 'changed' },
        });
      }
    }
  }

  /**
   * On the CEO's approval, within its transaction: each line's additions and deductions applied to it (still pending:
   * nothing changes them from the CEO's step on), and the advances and loans they recover settled when nothing of them
   * is outstanding. Answers what was applied, for the audit log once the approval is saved.
   */
  async applyRun(runId: string, tx: Prisma.TransactionClient): Promise<{ applied: { id: string; lineId: string; employeeCode: string }[]; settled: string[] }> {
    const lines = await tx.payrollLine.findMany({ where: { runId }, select: { id: true, employeeCode: true, terms: true } });
    const applied: { id: string; lineId: string; employeeCode: string }[] = [];
    const at = new Date();
    for (const line of lines) {
      const ids = itemIds(line.terms);
      if (!ids.length) continue;
      const pending = await tx.payrollAdjustment.findMany({ where: { id: { in: ids }, status: 'pending' }, select: { id: true } });
      if (!pending.length) continue;
      await tx.payrollAdjustment.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { status: 'applied', lineId: line.id, appliedAt: at } });
      applied.push(...pending.map((p) => ({ id: p.id, lineId: line.id, employeeCode: line.employeeCode })));
    }
    const recovering = applied.length
      ? await tx.payrollAdjustment.findMany({ where: { id: { in: applied.map((a) => a.id) }, advanceId: { not: null } }, select: { advanceId: true } })
      : [];
    const settled = await this.advances.settleRecovered([...new Set(recovering.map((r) => r.advanceId!))], tx);
    return { applied, settled };
  }

  /** The audit entries of what applyRun applied: one for each addition or deduction. */
  async recordApplied(runId: string, month: string, applied: readonly { id: string; lineId: string; employeeCode: string }[], user: SessionUser): Promise<void> {
    for (const a of applied) {
      await this.audit.record({
        userId: user.id,
        action: 'apply',
        entityType: ADJUSTMENT,
        entityId: a.id,
        diff: { runId, lineId: a.lineId, month, employeeCode: a.employeeCode, status: { from: 'pending', to: 'applied' } },
      });
    }
  }
}
