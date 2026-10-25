import type { AuditService } from '../audit/audit.service.js';
import { fromDateOnly, toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/** The database, or a transaction in it. */
type Db = PrismaService | Prisma.TransactionClient;

/**
 * When an employment ends (owner's brief, 25 October 2026: offboarding, a contract ending without renewal, any ending
 * by hand or approved; EmploymentsService.close), the person's client accounts under it end on its last day: an open
 * one, or one ending later, is ended then; one that would only start after it is deleted, as it was never held. Each in
 * the audit log. A payroll run with the CEO, approved or paid keeps what it paid (it never changes); a draft takes it
 * when refreshed.
 */
export async function endAssignmentsForLeaving(db: Db, audit: AuditService, employmentId: string, lastDay: string, userId: string): Promise<void> {
  const open = await db.clientAccountAssignment.findMany({
    where: { employmentId, OR: [{ toDate: null }, { toDate: { gt: toDateOnly(lastDay) } }] },
    select: { id: true, accountId: true, employeeId: true, fromDate: true, toDate: true, account: { select: { nameEn: true } }, employee: { select: { employeeCode: true } } },
  });
  for (const a of open) {
    const from = fromDateOnly(a.fromDate);
    const base = { accountId: a.accountId, account: a.account.nameEn, employeeId: a.employeeId, employeeCode: a.employee.employeeCode, reason: 'employment_ended' };
    if (from > lastDay) {
      await db.clientAccountAssignment.delete({ where: { id: a.id } });
      await audit.record({ userId, action: 'delete', entityType: 'client_account_assignment', entityId: a.id, diff: { ...base, fromDate: from, toDate: fromDateOnly(a.toDate) } });
    } else {
      await db.clientAccountAssignment.update({ where: { id: a.id }, data: { toDate: toDateOnly(lastDay) } });
      await audit.record({ userId, action: 'end', entityType: 'client_account_assignment', entityId: a.id, diff: { ...base, toDate: { from: fromDateOnly(a.toDate), to: lastDay } } });
    }
  }
}
