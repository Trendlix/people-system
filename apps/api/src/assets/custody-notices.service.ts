import { Injectable, Logger } from '@nestjs/common';
import { assetsAccessAtLeast, assetsAccessOf, custodyRecordPath, MY_CUSTODY_PATH, seesConfidential, type Role } from '@trendlix/shared';
import { dayInCairo, fromDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { NoticesService } from '../notifications/notices.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { custodyHandoverText, custodyOverdueText, custodyReturnText, custodyUnsignedText } from '../notifications/texts.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Who is told what of custody (Assets step 3, the brief: "Notifications through NotificationsService/NoticesService"):
// the employee of their handover ("You received 3 items: CUS-0042") and of each return, linked to My custody; a shoot's
// return overdue, the employee and the custodians, once a day (the daily check, custody-scheduler.service.ts); a record
// whose signed copy is still not attached 3 days on, the custodians, once. The custodians: the users with Assets access
// of a custodian or a manager (a Super Admin always is one); a C-level person's record only those of them who see
// C-level people (the CEO, a Super Admin), as everywhere (owner, 19 October 2026: "make C level Employees details not
// visible to HR"); never the person themself. Short and general: codes, names and dates, never a value. None of it
// ever throws into the flow: a failure is logged and the step stands.

@Injectable()
export class CustodyNoticesService {
  private readonly logger = new Logger('CustodyNotices');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly notices: NoticesService,
    private readonly confidential: ConfidentialService,
  ) {}

  /** The employee received the record's assets. */
  async handedOver(recordId: string): Promise<void> {
    await this.safely('handover', async () => {
      const r = await this.prisma.custodyRecord.findUnique({ where: { id: recordId }, select: { code: true, employeeId: true, dueDate: true, _count: { select: { items: true } } } });
      if (!r) return;
      await this.toEmployee(r.employeeId, custodyHandoverText(r._count.items, r.code, r.dueDate ? fromDateOnly(r.dueDate) : null, MY_CUSTODY_PATH));
    });
  }

  /** `count` of the record's items were received back. */
  async returned(recordId: string, count: number): Promise<void> {
    await this.safely('return', async () => {
      const r = await this.prisma.custodyRecord.findUnique({ where: { id: recordId }, select: { code: true, employeeId: true, _count: { select: { items: { where: { returnedAt: null } } } } } });
      if (!r) return;
      await this.toEmployee(r.employeeId, custodyReturnText(count, r.code, r._count.items, MY_CUSTODY_PATH));
    });
  }

  /** A shoot's return is overdue (the daily check, once a day for the record): the employee, then the custodians. */
  async overdue(recordId: string): Promise<void> {
    await this.safely('overdue', async () => {
      const r = await this.prisma.custodyRecord.findUnique({ where: { id: recordId }, select: { code: true, employeeId: true, dueDate: true, employee: { select: { fullNameEn: true } } } });
      if (!r?.dueDate) return;
      const due = fromDateOnly(r.dueDate);
      await this.toEmployee(r.employeeId, custodyOverdueText(r.code, due, null, MY_CUSTODY_PATH));
      await this.notifications.notify(await this.custodians(r.employeeId), custodyOverdueText(r.code, due, r.employee.fullNameEn, custodyRecordPath(r.code)));
    });
  }

  /** A record's signed copy is still not attached 3 days on: the custodians, once. */
  async unsigned(recordId: string): Promise<void> {
    await this.safely('not signed', async () => {
      const r = await this.prisma.custodyRecord.findUnique({ where: { id: recordId }, select: { code: true, employeeId: true, outAt: true, employee: { select: { fullNameEn: true } } } });
      if (!r) return;
      await this.notifications.notify(await this.custodians(r.employeeId), custodyUnsignedText(r.code, r.employee.fullNameEn, dayInCairo(r.outAt), custodyRecordPath(r.code)));
    });
  }

  /**
   * The custodians to tell of someone's record: the active users with an Assets custodian's or manager's access in
   * effect; for a C-level person, only those who see C-level people. Never the person themself.
   */
  async custodians(employeeId: string): Promise<string[]> {
    const [confidential, own] = await Promise.all([this.confidential.isConfidential(employeeId), this.notices.usersOf([employeeId])]);
    const self = own.get(employeeId);
    const users = await this.prisma.user.findMany({
      where: { isActive: true, OR: [{ assetsAccess: { in: ['custodian', 'manager'] } }, { roles: { some: { role: { key: 'super_admin' } } } }] },
      select: { id: true, assetsAccess: true, roles: { select: { role: { select: { key: true } } } } },
    });
    return users
      .filter((u) => {
        const roles = u.roles.map((r) => r.role.key as Role);
        if (!assetsAccessAtLeast(assetsAccessOf({ roles, assetsAccess: u.assetsAccess }), 'custodian')) return false;
        return !confidential || seesConfidential({ roles });
      })
      .map((u) => u.id)
      .filter((id) => id !== self);
  }

  private async toEmployee(employeeId: string, n: Parameters<NotificationsService['notify']>[1]): Promise<void> {
    const userId = (await this.notices.usersOf([employeeId])).get(employeeId);
    if (userId) await this.notifications.notify([userId], n);
  }

  /** Runs a notice; a failure is logged, never thrown into the flow. */
  private async safely(what: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      this.logger.error(`The custody ${what} notification could not be sent: ${(err as Error).message}`);
    }
  }
}
