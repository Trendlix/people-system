import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AdvanceKind, AdvanceStatus } from '@trendlix/shared';
import type { SessionUser } from '../../auth/session-user.js';
import { isSelf, seesSalary } from '../../employees/access.js';
import { ConfidentialService } from '../../employees/confidential.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AdvancesService } from './advances.service.js';
import type { RecurringStatus } from './plans.js';
import { RecurringDeductionsService } from './recurring.service.js';

/** An employee's loans and deductions, as their profile's Salary sub-tab shows them (owner, 18 October 2026). */
export interface DeductionPlans {
  /** Their advances and loans still being recovered, the latest given first. */
  advances: {
    id: string;
    kind: AdvanceKind;
    reason: string;
    amount: number;
    recovered: number;
    outstanding: number;
    nextInstallment: { month: string; amount: number } | null;
    status: AdvanceStatus;
  }[];
  /** Their recurring deductions running or still to come, the earliest first. */
  recurring: { id: string; name: string; amount: number; startMonth: string; endMonth: string | null; status: RecurringStatus }[];
}

// The employee's own loans and deductions (owner, 18 October 2026: "in the deductions i might have a loan of a medical
// subscription or something that needs to be deducted as installments on the employee. how will it be managed?"): on
// their profile, each advance or loan still being recovered with what was paid so far, what is left and the next
// installment, and the recurring deductions running. Salary data: HR, Finance and the CEO, and the employee themself
// (their own, like their payslips' lines); nobody else, their manager neither.
@Injectable()
export class DeductionPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly advances: AdvancesService,
    private readonly recurring: RecurringDeductionsService,
    private readonly confidential: ConfidentialService,
  ) {}

  async forEmployee(employeeId: string, user: SessionUser): Promise<DeductionPlans> {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, workEmail: true } });
    // a C-level person's only for the CEO, a Super Admin and themself (owner, 19 October 2026)
    if (!employee || (await this.confidential.isHidden(user, employeeId))) throw new NotFoundException('Employee not found.');
    if (!seesSalary(user) && !isSelf(user, employee)) {
      throw new ForbiddenException('Only the employee themself, HR, Finance and the CEO see their loans and deductions.');
    }
    const [advances, recurring] = await Promise.all([this.advances.list({ employeeId, status: 'open' }), this.recurring.forEmployee(employeeId)]);
    return {
      advances: advances.map((a) => ({
        id: a.id,
        kind: a.kind,
        reason: a.reason,
        amount: a.amount,
        recovered: a.recovered,
        outstanding: a.outstanding,
        nextInstallment: a.nextInstallment,
        status: a.status,
      })),
      recurring: recurring.map((r) => ({ id: r.id, name: r.name, amount: r.amount, startMonth: r.startMonth, endMonth: r.endMonth, status: r.status })),
    };
  }
}
