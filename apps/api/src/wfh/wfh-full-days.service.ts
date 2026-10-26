import { Injectable, Logger } from '@nestjs/common';
import { AttendanceFillService } from '../attendance/attendance-fill.service.js';
import { AuditService } from '../audit/audit.service.js';
import { fromDateOnly } from '../common/date-only.js';
import { PrismaService } from '../prisma/prisma.service.js';

// An approved work from home day without a check-in counts the shift's full hours (owner, 26 October 2026: "Full day,
// always"; packages/shared wfh.ts wfhFullDays, read wherever a month's days are read: AttendanceDaysService.monthOf).
// A draft payroll run made before that has its lines filled the old way (such a day 0 hours: September's attendance cut
// for EMP-0006), so once, on deploy, the lines of the DRAFT runs of people with an approved work from home day in the
// run's month are filled again from the attendance days (AttendanceFillService, each line changed in the audit log), as
// the hours by pairs' pass did (25 October 2026). A run with the CEO, approved or paid never changes (the fill leaves
// any run that is not a draft as it is). Idempotent: a line already as the days make it is left, so run again it changes
// nothing and writes nothing. Under an advisory lock held for its transaction (another process finding it held does
// nothing). The pass as one audit entry with its counts, written only when a line changed. Later approvals and
// cancellations refill the person's drafts themselves (WfhService). The people are those with an approved day in the
// run's month, whatever kept their days: a month of Zoho's Excel-imported rows (no zohoRunId) is looked at too, and since
// 26 October 2026 such a month counts as the system's own once it has an approved work from home day (AttendanceDaysService
// ownDays), so the pass on the next deploy fills the lines the first pass could only recount no-shows on, their hours too.

/** The advisory lock's name: hashtext() of it is the key every process takes. */
const LOCK_NAME = 'people-system wfh full days';

/** What a pass did: the draft months looked at, the people with an approved day in them, and the lines changed. */
export interface WfhRefillResult {
  months: string[];
  people: number;
  linesRefilled: number;
}

@Injectable()
export class WfhFullDaysService {
  private readonly logger = new Logger('WfhFullDays');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fill: AttendanceFillService,
  ) {}

  /** The pass once, on deploy (main.ts, once the API listens; the tests run it themselves). Never throws. */
  start(): void {
    void this.refill()
      .then((r) => {
        if (r?.linesRefilled) this.logger.log(`Refilled ${r.linesRefilled} draft payroll lines for approved work from home days (${r.people} people, ${r.months.join(', ')}).`);
      })
      .catch((err: unknown) => this.logger.error(`The work from home days could not be refilled: ${(err as Error).message}`));
  }

  /** Refills the draft runs' lines of the people with an approved work from home day in their month. Null when another process holds the lock. */
  async refill(): Promise<WfhRefillResult | null> {
    const held = await this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_NAME})) AS locked`;
        if (!lock?.locked) return null;
        const runs = await tx.payrollRun.findMany({ where: { status: 'draft' }, select: { id: true, month: true } });
        const out: { id: string; month: string; people: string[] }[] = [];
        for (const run of runs) {
          const month = fromDateOnly(run.month).slice(0, 7);
          const first = new Date(`${month}-01T00:00:00Z`);
          const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
          const rows = await tx.wfhRequest.findMany({ where: { status: 'approved', date: { gte: first, lt: next } }, distinct: ['employeeId'], select: { employeeId: true } });
          if (rows.length) out.push({ id: run.id, month, people: rows.map((r) => r.employeeId) });
        }
        return out;
      },
      { timeout: 60_000 },
    );
    if (!held) return null;
    let linesRefilled = 0;
    const people = new Set<string>();
    for (const run of held.sort((a, b) => a.month.localeCompare(b.month))) {
      const filled = await this.fill.fillRun(run.id, null, run.people);
      const changed = filled.filled + filled.cleared + filled.leaveCounted;
      if (changed) for (const p of run.people) people.add(p);
      linesRefilled += changed;
    }
    const result: WfhRefillResult = { months: held.map((h) => h.month).sort(), people: people.size, linesRefilled };
    if (linesRefilled) await this.audit.record({ userId: null, action: 'refill_wfh_days', entityType: 'wfh_request', diff: { rule: 'wfh_full_day', ...result } });
    return result;
  }
}
