import { Injectable, Logger } from '@nestjs/common';
import { decidesConfidentialStage, type Role } from '@trendlix/shared';
import { actsAs } from '../auth/roles.js';
import { fromDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService, type NotificationInput } from './notifications.service.js';
import {
  cancelledByHrText,
  claimDecidedText,
  claimPaidText,
  daysText,
  decidedText,
  payRaiseDecidedText,
  payRaiseWaitingText,
  payslipText,
  raiseRequestWaitingText,
  waitingText,
  type LeaveLikeKind,
} from './texts.js';

// Who is told what, as each flow takes a step (owner, 20 October 2026: "Push notifications: yes (decisions, things
// waiting for someone, a check-in reminder)"; apps/mobile/README.md, Phase 4). Each method is called by its flow once its
// step has committed, reads the request as it is now, and tells:
// - the one in charge of the step it waits at: the direct manager it was sent to (or the team lead or the department's
//   head standing in: approverInCharge, kept in its managerId), then HR, then Finance for a claim; a C-level person's HR
//   and Finance steps the CEO's (or HR's / Finance's with Super Admin), so HR and Finance are never told of a C-level
//   person's (owner, 19 October 2026: "make C level Employees details not visible to HR"); never the requester themself;
// - the employee, once their own request is approved or rejected (a claim also when it is paid, a leave or a permission
//   when HR cancels it), and when their payslip is issued;
// - raise requests and raises, HR and the CEO only (owner, 20 October 2026: "raises not to be visible to employee level
//   for now", then "Hide from managers too"; packages/shared EMPLOYEE_LEVEL_SEES_RAISES).
// None of it ever throws into the flow: a failure is logged and the step stands.

/** A request's steps as leave's are (with_manager → with_hr), and a claim's (… → with_finance). */
type Stage = 'manager' | 'hr' | 'finance';

const stageOf = (status: string): Stage | null => (status === 'with_manager' ? 'manager' : status === 'with_hr' ? 'hr' : status === 'with_finance' ? 'finance' : null);

/** Where each kind of request opens on the site (the phone pages open their own page for it: lib/surface.ts toAppHref). */
export const REQUEST_LINKS = {
  leave: (id: string) => `/leave/${id}`,
  permission: (id: string) => `/leave/permissions/${id}`,
  correction: (id: string) => `/attendance/corrections/${id}`,
  reimbursement: (id: string) => `/reimbursements/${id}`,
  raiseRequests: '/raise-requests?status=with_hr',
  approvals: '/approvals',
  payslip: (lineId: string) => `/app/payslips/${lineId}`,
  myAttendance: '/my-attendance',
} as const;

/** A request as the notices read it: whose it is, who it was sent to, where it stands, its name and its days. */
interface RequestFacts {
  employeeId: string;
  managerId: string | null;
  status: string;
  name: string;
  when: string;
  link: string;
}

/** What happened to a request: sent, a step decided, or (leave and permission) cancelled by HR once approved. */
export type RequestEvent = 'sent' | 'decided' | 'cancelled_by_hr';

const DECIDING_ROLES: Role[] = ['hr', 'finance', 'ceo', 'super_admin'];

@Injectable()
export class NoticesService {
  private readonly logger = new Logger('Notices');

  constructor(
    private readonly prisma: PrismaService,
    private readonly confidential: ConfidentialService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- leave, permission and attendance corrections (decided as leave is) ----------

  async leave(id: string, event: RequestEvent): Promise<void> {
    await this.safely('leave', async () => {
      const r = await this.prisma.leaveRequest.findUnique({
        where: { id },
        select: { employeeId: true, managerId: true, status: true, startDate: true, endDate: true, halfDay: true, employee: { select: { fullNameEn: true } } },
      });
      if (!r) return;
      const when = daysText(fromDateOnly(r.startDate), fromDateOnly(r.endDate), r.halfDay);
      await this.leaveLike('leave', { ...r, name: r.employee.fullNameEn, when, link: REQUEST_LINKS.leave(id) }, event);
    });
  }

  async permission(id: string, event: RequestEvent): Promise<void> {
    await this.safely('permission', async () => {
      const r = await this.prisma.permissionRequest.findUnique({ where: { id }, select: { employeeId: true, managerId: true, status: true, date: true, employee: { select: { fullNameEn: true } } } });
      if (!r) return;
      const day = fromDateOnly(r.date);
      await this.leaveLike('permission', { ...r, name: r.employee.fullNameEn, when: daysText(day, day), link: REQUEST_LINKS.permission(id) }, event);
    });
  }

  async correction(id: string, event: Exclude<RequestEvent, 'cancelled_by_hr'>): Promise<void> {
    await this.safely('correction', async () => {
      const r = await this.prisma.attendanceCorrection.findUnique({ where: { id }, select: { employeeId: true, managerId: true, status: true, date: true, employee: { select: { fullNameEn: true } } } });
      if (!r) return;
      const day = fromDateOnly(r.date);
      await this.leaveLike('correction', { ...r, name: r.employee.fullNameEn, when: daysText(day, day), link: REQUEST_LINKS.correction(id) }, event);
    });
  }

  private async leaveLike(kind: LeaveLikeKind, r: RequestFacts, event: RequestEvent): Promise<void> {
    if (event === 'cancelled_by_hr') {
      if (kind !== 'correction' && r.status === 'cancelled') await this.toEmployee(r.employeeId, cancelledByHrText(kind, r.when, r.link));
      return;
    }
    const stage = stageOf(r.status);
    if (stage) {
      await this.notifications.notify(await this.deciders(stage, r), waitingText(kind, r.name, r.when, r.link));
      return;
    }
    if (event === 'decided' && (r.status === 'approved' || r.status === 'rejected')) await this.toEmployee(r.employeeId, decidedText(kind, r.status, r.when, r.link));
  }

  // ---------- reimbursement claims (the manager, HR, then Finance; paid with the payroll) ----------

  async reimbursement(id: string, event: Exclude<RequestEvent, 'cancelled_by_hr'>): Promise<void> {
    await this.safely('reimbursement', async () => {
      const r = await this.prisma.reimbursementClaim.findUnique({
        where: { id },
        select: { employeeId: true, managerId: true, status: true, expenseDate: true, payMonth: true, employee: { select: { fullNameEn: true } } },
      });
      if (!r) return;
      const link = REQUEST_LINKS.reimbursement(id);
      const expenseDate = fromDateOnly(r.expenseDate);
      const stage = stageOf(r.status);
      if (stage) {
        const facts = { ...r, name: r.employee.fullNameEn, when: daysText(expenseDate, expenseDate), link };
        await this.notifications.notify(await this.deciders(stage, facts), waitingText('reimbursement', facts.name, facts.when, link));
        return;
      }
      if (event !== 'decided') return;
      if (r.status === 'approved' && r.payMonth) await this.toEmployee(r.employeeId, claimDecidedText({ approved: true, payMonth: fromDateOnly(r.payMonth) }, link));
      if (r.status === 'rejected') await this.toEmployee(r.employeeId, claimDecidedText({ approved: false, expenseDate }, link));
    });
  }

  // ---------- a payroll run marked paid: the payslips, and the claims paid with it ----------

  /** Once a run is marked paid: each person paid (not on hold) is told their payslip is ready, and of each claim paid with it. */
  async payrollPaid(runId: string): Promise<void> {
    await this.safely('payroll', async () => {
      const run = await this.prisma.payrollRun.findUnique({ where: { id: runId }, select: { month: true, paidOn: true, status: true } });
      if (!run || run.status !== 'paid') return;
      const month = fromDateOnly(run.month).slice(0, 7);
      const lines = await this.prisma.payrollLine.findMany({ where: { runId, onHold: false }, select: { id: true, employeeId: true } });
      if (!lines.length) return;
      const users = await this.usersOf(lines.map((l) => l.employeeId));
      const paidOn = run.paidOn ? fromDateOnly(run.paidOn) : null;
      for (const line of lines) {
        const userId = users.get(line.employeeId);
        if (userId) await this.notifications.notify([userId], payslipText(month, paidOn, REQUEST_LINKS.payslip(line.id)));
      }
      const claims = await this.prisma.reimbursementClaim.findMany({
        where: { status: 'approved', payMonth: run.month, employeeId: { in: lines.map((l) => l.employeeId) } },
        select: { id: true, employeeId: true },
      });
      for (const c of claims) {
        const userId = users.get(c.employeeId);
        if (userId) await this.notifications.notify([userId], claimPaidText(month, REQUEST_LINKS.reimbursement(c.id)));
      }
    });
  }

  // ---------- raise requests and raises: HR and the CEO only ----------

  /** A raise request sent: HR's step (the CEO's for a C-level person), never the one who asked. */
  async raiseRequestSent(requestId: string): Promise<void> {
    await this.safely('raise request', async () => {
      const r = await this.prisma.raiseRequest.findUnique({ where: { id: requestId }, select: { employeeId: true, requestedById: true, status: true, employee: { select: { fullNameEn: true } } } });
      if (!r || r.status !== 'with_hr') return;
      const deciders = (await this.stageDeciders('hr', r.employeeId)).filter((id) => id !== r.requestedById);
      await this.notifications.notify(deciders, raiseRequestWaitingText(r.employee.fullNameEn, REQUEST_LINKS.raiseRequests));
    });
  }

  /** A raise sent to the CEO (from a raise request HR approved, or a raise HR prepared): the CEO decides it. */
  async payRaiseSent(contractId: string): Promise<void> {
    await this.safely('raise', async () => {
      const c = await this.prisma.contract.findUnique({ where: { id: contractId }, select: { approval: true, employment: { select: { employeeId: true, employee: { select: { fullNameEn: true } } } } } });
      if (!c || c.approval !== 'pending_ceo') return;
      const own = await this.usersOf([c.employment.employeeId]);
      const ceos = (await this.usersWith((roles) => roles.includes('ceo'))).filter((id) => id !== own.get(c.employment.employeeId));
      await this.notifications.notify(ceos, payRaiseWaitingText(c.employment.employee.fullNameEn, REQUEST_LINKS.approvals));
    });
  }

  /**
   * The CEO approved, rejected or returned a raise: HR is told (they prepare it for signing, or change it); a C-level
   * person's, only those who take HR's step for them (HR with Super Admin), never the CEO who decided.
   */
  async payRaiseDecided(employmentId: string, decision: 'approved' | 'rejected' | 'returned', actorId: string): Promise<void> {
    await this.safely('raise', async () => {
      const employment = await this.prisma.employment.findUnique({ where: { id: employmentId }, select: { employeeId: true, employee: { select: { fullNameEn: true } } } });
      if (!employment) return;
      const hr = (await this.stageDeciders('hr', employment.employeeId)).filter((id) => id !== actorId);
      await this.notifications.notify(hr, payRaiseDecidedText(decision, employment.employee.fullNameEn, REQUEST_LINKS.raiseRequests));
    });
  }

  // ---------- who ----------

  /** The one in charge of a step: the manager it was sent to; HR or Finance (the CEO for a C-level person's). */
  private async deciders(stage: Stage, r: Pick<RequestFacts, 'employeeId' | 'managerId'>): Promise<string[]> {
    if (stage === 'manager') {
      if (!r.managerId || r.managerId === r.employeeId) return [];
      const manager = (await this.usersOf([r.managerId])).get(r.managerId);
      return manager ? [manager] : [];
    }
    return this.stageDeciders(stage, r.employeeId);
  }

  /**
   * Those who take HR's or Finance's step on someone's request: those holding the role; a C-level person's, the CEO (or
   * the role's holders who see C-level people: with Super Admin). Never the person themself. Public for flows wired
   * later (the home locations' HR step).
   */
  async stageDeciders(stage: 'hr' | 'finance', employeeId: string): Promise<string[]> {
    const [confidential, own] = await Promise.all([this.confidential.isConfidential(employeeId), this.usersOf([employeeId])]);
    const self = own.get(employeeId);
    const ids = await this.usersWith((roles) => (confidential ? decidesConfidentialStage({ roles }, [stage]) : actsAs(roles, [stage])));
    return ids.filter((id) => id !== self);
  }

  /** The active users with roles that pass `test` (e.g. the CEO: `(roles) => roles.includes('ceo')`). */
  async usersWith(test: (roles: Role[]) => boolean): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, roles: { some: { role: { key: { in: DECIDING_ROLES } } } } },
      select: { id: true, roles: { select: { role: { select: { key: true } } } } },
    });
    return users.filter((u) => test(u.roles.map((r) => r.role.key as Role))).map((u) => u.id);
  }

  /** The active user signing in as each employee (the one with their work email), by employee id. */
  async usersOf(employeeIds: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const ids = [...new Set(employeeIds)];
    if (!ids.length) return out;
    const employees = await this.prisma.employee.findMany({ where: { id: { in: ids }, workEmail: { not: null } }, select: { id: true, workEmail: true } });
    const emails = employees.map((e) => e.workEmail!.toLowerCase());
    if (!emails.length) return out;
    const users = await this.prisma.user.findMany({ where: { email: { in: emails }, isActive: true }, select: { id: true, email: true } });
    const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
    for (const e of employees) {
      const userId = byEmail.get(e.workEmail!.toLowerCase());
      if (userId) out.set(e.id, userId);
    }
    return out;
  }

  private async toEmployee(employeeId: string, n: NotificationInput): Promise<void> {
    const userId = (await this.usersOf([employeeId])).get(employeeId);
    if (userId) await this.notifications.notify([userId], n);
  }

  /** Runs a notice; a failure is logged, never thrown into the flow. */
  private async safely(what: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      this.logger.error(`The ${what} notification could not be sent: ${(err as Error).message}`);
    }
  }
}
