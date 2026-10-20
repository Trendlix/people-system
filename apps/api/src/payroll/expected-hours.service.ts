import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { PayrollInputs, PayrollRules, PayrollTerms } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { fromDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { json, worked } from './line-work.js';
import { runLawRates } from './views.js';

const LINE = 'payroll_line';

/** The expected hours typed in a line's saved inputs (before 20 October 2026); null when none. */
export function typedExpectedHours(inputs: Prisma.JsonValue): number | null {
  const v = inputs && typeof inputs === 'object' && !Array.isArray(inputs) ? (inputs as { expectedHours?: unknown }).expectedHours : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// The expected hours locked (owner, 20 October 2026, on the inputs grid's Expected hours cell, "153:00 · from the
// shift": "expected hours to be locked based on shifts and attendance data"): always worked out from the shift, the
// holidays and the no-show and leave days (packages/shared expectedHoursOf), never typed; the API refuses any sent
// (payroll.dto.ts). So that no draft keeps a figure HR typed before then: when the API starts, each draft run's line with
// expected hours typed has them cleared and is worked out again with the shift's, its other inputs as they are (the
// grid's figures that went to Additions / Deductions included, which grid-inputs.service.ts moves in its own time).
// Done here rather than in a migration as the lines are worked out in TypeScript (payrollLine), as the grid's figures
// were. Once done there is nothing left to do, so it does nothing the next time. A run with the CEO keeps them as the
// CEO sees them (payrollLine works a line saved with them out as it was, the CEO's waiver too); they are cleared once
// the CEO returns it to HR (PayrollService.returnToHr), and an approved or paid run keeps them for good. Each line
// changed is in the audit log, by nobody (the system), with the hours it had.
@Injectable()
export class ExpectedHoursService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExpectedHoursService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const cleared = await this.clear();
    if (cleared) this.logger.log(`Cleared the expected hours typed on ${cleared} draft payroll lines: they are worked out from the shift.`);
  }

  /**
   * Clears the expected hours typed on the draft runs' lines (or on the one run given, if a draft), and works the lines
   * out again. One at a time across the API's instances. Answers how many lines it changed.
   */
  async clear(runId?: string): Promise<number> {
    const changed = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('people-system:payroll-expected-hours'))`;
        const lines = await tx.payrollLine.findMany({
          where: { run: { status: 'draft', ...(runId && { id: runId }) } },
          select: { id: true, runId: true, employeeCode: true, inputs: true, terms: true, run: { select: { month: true, rules: true, lawRates: true } } },
        });
        const out: { line: (typeof lines)[number]; typed: number }[] = [];
        for (const line of lines) {
          const typed = typedExpectedHours(line.inputs);
          if (typed === null) continue;
          // only the expected hours go: every other input stays as saved, so it is worked out as it was but for them
          const inputs = { ...(line.inputs as object), expectedHours: null } as PayrollInputs;
          await tx.payrollLine.update({
            where: { id: line.id },
            data: { inputs: json(inputs), ...worked(line.terms as unknown as PayrollTerms, inputs, line.run.rules as unknown as PayrollRules, runLawRates(line.run)) },
          });
          out.push({ line, typed });
        }
        return out;
      },
      { timeout: 60_000 },
    );

    for (const { line, typed } of changed) {
      await this.audit.record({
        userId: null,
        action: 'update',
        entityType: LINE,
        entityId: line.id,
        diff: {
          runId: line.runId,
          month: fromDateOnly(line.run.month).slice(0, 7),
          employeeCode: line.employeeCode,
          expectedHours: { from: typed, to: null },
          workedOut: 'from the shift',
        },
      });
    }
    return changed.length;
  }
}
