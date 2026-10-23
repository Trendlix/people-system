import { Injectable, Logger } from '@nestjs/common';
import { cairoDay, decidesConfidentialStage, type Role } from '@trendlix/shared';
import { actsAs } from '../auth/roles.js';
import { fromDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { activeAccountsOf } from '../users/employee-accounts.js';
import { NotificationsService, type NotificationInput } from './notifications.service.js';
import {
  cancelledByHrText,
  claimDecidedText,
  claimPaidText,
  daysText,
  decidedText,
  homeDecidedText,
  homeWaitingText,
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
//   for now", then "Hide from managers too"; packages/shared EMPLOYEE_LEVEL_SEES_RAISES);
// - home locations (owner, 20 October 2026: "then approved by the HR and CEO"): HR's step to HR (a C-level person's to
//   the CEO, or HR with Super Admin), then the CEO's to the CEO (a CEO's own to a Super Admin), never the person
//   themself nor the one who just decided; the employee once HR or the CEO decides, never with the point or the label.
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
  homeLocation: (id: string) => `/home-locations/${id}`,
  // working from home (owner, 21 October 2026): under Attendance, as the corrections are
  wfh: (id: string) => `/attendance/wfh/${id}`,
  // official duty (owner, 23 October 2026): under Attendance, beside working from home
  od: (id: string) => `/attendance/official-duty/${id}`,
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

  /** A work from home request (owner, 21 October 2026: "Manager, then HR"): told as a permission's is. */
  async wfh(id: string, event: RequestEvent): Promise<void> {
    await this.safely('work from home', async () => {
      const r = await this.prisma.wfhRequest.findUnique({ where: { id }, select: { employeeId: true, managerId: true, status: true, date: true, employee: { select: { fullNameEn: true } } } });
      if (!r) return;
      const day = fromDateOnly(r.date);
      await this.leaveLike('wfh', { ...r, name: r.employee.fullNameEn, when: daysText(day, day), link: REQUEST_LINKS.wfh(id) }, event);
    });
  }

  /** An official duty request (owner, 23 October 2026: "Manager, then HR"): told as a work from home request is, with its days. */
  async od(id: string, event: RequestEvent): Promise<void> {
    await this.safely('official duty', async () => {
      const r = await this.prisma.odRequest.findUnique({
        where: { id },
        select: { employeeId: true, managerId: true, status: true, startDate: true, endDate: true, employee: { select: { fullNameEn: true } } },
      });
      if (!r) return;
      await this.leaveLike('od', { ...r, name: r.employee.fullNameEn, when: daysText(fromDateOnly(r.startDate), fromDateOnly(r.endDate)), link: REQUEST_LINKS.od(id) }, event);
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

  // ---------- home locations: HR, then the CEO ----------

  /**
   * A home location sent, or a step decided (by `actorId`): the one in charge of the step it waits at now, as
   * packages/shared decidesHomeStage has it (HR's: HR, a C-level person's the CEO or HR with Super Admin; the CEO's: the
   * CEO, on a CEO's own request a Super Admin too), never the person themself nor the one who just decided; and, once
   * HR or the CEO decides, the employee (HR's step "by HR", a C-level person's "by the CEO" when the CEO took it). Names
   * and dates only.
   */
  async homeLocation(id: string, event: 'sent' | 'decided', actorId: string | null = null): Promise<void> {
    await this.safely('home location', async () => {
      const r = await this.prisma.homeLocationRequest.findUnique({
        where: { id },
        select: { employeeId: true, status: true, createdAt: true, employee: { select: { fullNameEn: true } }, createdBy: { select: { roles: { select: { role: { select: { key: true } } } } } } },
      });
      if (!r) return;
      const link = REQUEST_LINKS.homeLocation(id);
      const askedOn = cairoDay(r.createdAt);
      const notActor = (ids: readonly string[]) => ids.filter((u) => u !== actorId);
      if (r.status === 'with_hr') {
        await this.notifications.notify(notActor(await this.stageDeciders('hr', r.employeeId)), homeWaitingText(r.employee.fullNameEn, askedOn, link));
      } else if (r.status === 'with_ceo') {
        const own = (await this.usersOf([r.employeeId])).get(r.employeeId);
        const byCeo = r.createdBy?.roles.some((x) => x.role.key === 'ceo') ?? false;
        const ceos = await this.usersWith((roles) => roles.includes('ceo') || (byCeo && roles.includes('super_admin')));
        await this.notifications.notify(notActor(ceos.filter((u) => u !== own)), homeWaitingText(r.employee.fullNameEn, askedOn, link));
      }
      if (event !== 'decided') return;
      if (r.status === 'with_ceo') {
        const actor = actorId ? await this.prisma.user.findUnique({ where: { id: actorId }, select: { roles: { select: { role: { select: { key: true } } } } } }) : null;
        const byTheCeo = (await this.confidential.isConfidential(r.employeeId)) && !!actor?.roles.some((x) => x.role.key === 'ceo');
        await this.toEmployee(r.employeeId, homeDecidedText('first_step', askedOn, link, byTheCeo ? 'the CEO' : 'HR'));
      } else if (r.status === 'approved' || r.status === 'rejected') {
        await this.toEmployee(r.employeeId, homeDecidedText(r.status, askedOn, link));
      }
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
   * the role's holders who see C-level people: with Super Admin). Never the person themself. Public for the flows that
   * read it apart.
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

  /** The active account of each employee (users.employee_id, 22 October 2026: never by email), by employee id. */
  async usersOf(employeeIds: readonly string[]): Promise<Map<string, string>> {
    return activeAccountsOf(this.prisma, employeeIds);
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
