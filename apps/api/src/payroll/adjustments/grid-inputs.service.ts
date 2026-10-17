import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { AdjustmentKind, AdjustmentType, PayrollRules, PayrollTerms, SavedPayrollInputs } from '@trendlix/shared';
import { AuditService } from '../../audit/audit.service.js';
import { fromDateOnly } from '../../common/date-only.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { json, savedInputs, withAdjustments, worked } from '../line-work.js';
import { runLawRates } from '../views.js';
import { RunAdjustmentsService } from './run-adjustments.service.js';
import { ADJUSTMENT } from './views.js';

const LINE = 'payroll_line';

/** The reason the additions and deductions made from a run's grid have. */
export const FROM_THE_GRID = "From the run's grid";

/** The grid's inputs that went to Additions / Deductions, in the order the grid had them. */
const EARLIER = ['penaltyDays', 'bonusDays', 'commission', 'settlements'] as const;

type Earlier = (typeof EARLIER)[number];

/** An addition or deduction a typed figure becomes. */
interface Made {
  from: Earlier;
  kind: AdjustmentKind;
  type: AdjustmentType;
  taxed: boolean;
  amount: number | null;
  days: number | null;
}

/** A figure typed: not given, or 0, is nothing to keep. */
const typed = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v !== 0;

/**
 * What a line's typed figures become (owner, 17 October 2026: "Yes, as proposed"): bonus days a Bonus (days) and penalty
 * days a Penalty (days), their days kept; a commission a Commission; a settlement a Correction, an addition, or a
 * deduction when it was negative (and a negative commission a Correction deduction, as it was taken off the pay).
 */
export function itemsFromInputs(inputs: SavedPayrollInputs): Made[] {
  const made: Made[] = [];
  if (typed(inputs.bonusDays) && inputs.bonusDays > 0) {
    made.push({ from: 'bonusDays', kind: 'addition', type: 'bonus_days', taxed: true, amount: null, days: inputs.bonusDays });
  }
  if (typed(inputs.penaltyDays) && inputs.penaltyDays > 0) {
    made.push({ from: 'penaltyDays', kind: 'deduction', type: 'penalty_days', taxed: false, amount: null, days: inputs.penaltyDays });
  }
  for (const [from, type] of [
    ['commission', 'commission'],
    ['settlements', 'correction'],
  ] as const) {
    const v = inputs[from];
    if (!typed(v)) continue;
    made.push(
      v > 0
        ? { from, kind: 'addition', type, taxed: true, amount: v, days: null }
        : { from, kind: 'deduction', type: 'correction', taxed: false, amount: Math.round(-v * 100) / 100, days: null },
    );
  }
  return made;
}

/** Whether a line's saved inputs still have any of the grid's figures that went to Additions / Deductions. */
const hasEarlier = (inputs: Prisma.JsonValue) => EARLIER.some((k) => k in ((inputs ?? {}) as object));

// The grid's bonus and penalty days, commission and settlements moved to Additions / Deductions (owner, 17 October
// 2026, pointing at those columns: "instead of there, i think earnings and deductions will be enough"; he chose "Yes,
// as proposed"), so nothing typed is lost: when the API starts, each draft run's line with any of them typed has them
// made pending additions and deductions for that person and month, with the reason "From the run's grid" and entered by
// nobody (the system), and the inputs cleared; the line is worked out again with them. Done here rather than in the
// migration as the lines are worked out in TypeScript (packages/shared payrollLine). Once done there is nothing left to
// do, so it does nothing the next time. A run with the CEO keeps its figures as the CEO sees them (payrollLine works a
// line saved with them out as it was); they are moved once the CEO returns it to HR (PayrollService.returnToHr), and an
// approved or paid run keeps them for good. Every addition and deduction made, and every line changed, is in the audit
// log, the amounts only as set.
@Injectable()
export class GridInputsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GridInputsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly runs: RunAdjustmentsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const done = await this.convert();
    if (done.items) this.logger.log(`Made ${done.items} additions and deductions from the payroll grid on ${done.lines} draft lines.`);
  }

  /**
   * Makes the typed grid figures of the draft runs' lines (or of the one run given, if a draft) pending additions and
   * deductions, clears them, and works the lines out again. One at a time across the API's instances. Answers how many
   * lines and additions and deductions it changed.
   */
  async convert(runId?: string): Promise<{ lines: number; items: number }> {
    const changed = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('people-system:payroll-grid-inputs'))`;
        const lines = await tx.payrollLine.findMany({
          where: { run: { status: 'draft', ...(runId && { id: runId }) } },
          select: { id: true, runId: true, employeeId: true, employeeCode: true, inputs: true, terms: true, run: { select: { month: true, rules: true, lawRates: true } } },
        });
        const out: { line: (typeof lines)[number]; month: string; made: (Made & { id: string })[]; cleared: Earlier[] }[] = [];
        const at = Date.now();
        let n = 0;
        for (const line of lines.filter((l) => hasEarlier(l.inputs))) {
          const month = fromDateOnly(line.run.month).slice(0, 7);
          const inputs = line.inputs as unknown as SavedPayrollInputs;
          const made: (Made & { id: string })[] = [];
          for (const item of itemsFromInputs(inputs)) {
            const row = await tx.payrollAdjustment.create({
              data: {
                employeeId: line.employeeId,
                month: line.run.month,
                kind: item.kind,
                type: item.type,
                taxed: item.taxed,
                amount: item.amount,
                days: item.days,
                reason: FROM_THE_GRID,
                createdById: null,
                // in the grid's order, one after another
                createdAt: new Date(at + n++),
              },
              select: { id: true },
            });
            made.push({ ...item, id: row.id });
          }
          // the inputs without them, the line worked out again with the month's pending ones
          const cleared = savedInputs(line.inputs);
          const pending = await this.runs.pendingByEmployee(month, [line.employeeId], tx);
          const terms = withAdjustments(line.terms as unknown as PayrollTerms, pending.get(line.employeeId));
          await tx.payrollLine.update({
            where: { id: line.id },
            data: { inputs: json(cleared), terms: json(terms), ...worked(terms, cleared, line.run.rules as unknown as PayrollRules, runLawRates(line.run)) },
          });
          out.push({ line, month, made, cleared: EARLIER.filter((k) => typed(inputs[k])) });
        }
        return out;
      },
      { timeout: 60_000 },
    );

    // a line with none typed only had them as not given: nothing to say
    for (const { line, month, made, cleared } of changed.filter((c) => c.made.length)) {
      for (const m of made) {
        await this.audit.record({
          userId: null,
          action: 'create',
          entityType: ADJUSTMENT,
          entityId: m.id,
          // the amount only as set (restricted, as a salary); the days as they are
          diff: {
            employeeCode: line.employeeCode,
            month,
            kind: m.kind,
            type: m.type,
            taxed: m.taxed,
            ...(m.days === null ? { amount: 'set' } : { days: m.days }),
            reason: FROM_THE_GRID,
            fromLine: line.id,
          },
        });
      }
      await this.audit.record({
        userId: null,
        action: 'update',
        entityType: LINE,
        entityId: line.id,
        diff: { runId: line.runId, month, employeeCode: line.employeeCode, movedToAdjustments: cleared, adjustments: 'changed' },
      });
    }
    return { lines: changed.filter((c) => c.made.length).length, items: changed.reduce((sum, c) => sum + c.made.length, 0) };
  }
}
