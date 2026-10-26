import { Injectable, Logger } from '@nestjs/common';
import { cairoDay, decidesConfidentialStage, movesToStandIn, type Role, type WhatsAppRequestWhat, type WhatsAppSpan } from '@trendlix/shared';
import { actsAs } from '../auth/roles.js';
import { fromDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { standInOfApprover } from '../leave/stand-ins.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { activeAccountsOf } from '../users/employee-accounts.js';
import type { WhatsAppNotice } from '../whatsapp/whatsapp.service.js';
import { NotificationsService, type NotificationInput } from './notifications.service.js';
import {
  cancelledByHrText,
  claimDecidedText,
  claimPaidText,
  coverText,
  daysText,
  decidedText,
  homeDecidedText,
  homeWaitingText,
  leaveEditedText,
  payRaiseDecidedText,
  payRaiseWaitingText,
  payslipText,
  raiseRequestWaitingText,
  standInText,
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
// Each carries its WhatsApp message's facts too (owner, 24 October 2026: "how to make whatsapp notifications?";
// "Approvals waiting, Request decisions"): names, days and the month only, the requester's name in Arabic for an Arabic
// message, and whom it is about, so a C-level person's never shows in HR's log. The emitter sends it to those who opted in.
// Leave coverage (owner, 25 October 2026: "Required over 2 days", "To a stand-in"): the colleague named to cover a leave
// is told (and the one no longer covering it), on WhatsApp too for those who opted in; while an approver is on leave with
// a stand-in, what waits at their step is told to the stand-in instead (a person, or HR), never a C-level person's to a
// stand-in who doesn't see them; and the stand-in is told when the leave starts, with how many wait.

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
  // leave coverage (25 October 2026): what the caller covers, on My Requests; a stand-in's waiting requests, on My Team
  // (a person) or Leave Requests (HR)
  covering: '/my-requests#covering',
  myTeam: '/my-team',
  leaveWaiting: '/leave?status=waiting',
} as const;

/** A request as the notices read it: whose it is, who it was sent to, where it stands, its name and its days. */
interface RequestFacts {
  employeeId: string;
  managerId: string | null;
  status: string;
  name: string;
  /** Their name in Arabic, for an Arabic WhatsApp message (24 October 2026). */
  nameAr?: string | null;
  when: string;
  /** Its days, for the WhatsApp message (24 October 2026). */
  span: WhatsAppSpan;
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
        select: { employeeId: true, managerId: true, status: true, startDate: true, endDate: true, halfDay: true, employee: { select: { fullNameEn: true, fullNameAr: true } } },
      });
      if (!r) return;
      const span = { from: fromDateOnly(r.startDate), to: fromDateOnly(r.endDate), halfDay: r.halfDay };
      const when = daysText(span.from, span.to, r.halfDay);
      await this.leaveLike('leave', { ...r, name: r.employee.fullNameEn, nameAr: r.employee.fullNameAr, when, span, link: REQUEST_LINKS.leave(id) }, event);
    });
  }

  /** A Super Admin edited the employee's approved leave (owner, 26 October 2026): the employee is told, with its new days; the bell and push, no WhatsApp. */
  async leaveEdited(id: string): Promise<void> {
    await this.safely('leave edit', async () => {
      const r = await this.prisma.leaveRequest.findUnique({ where: { id }, select: { employeeId: true, status: true, startDate: true, endDate: true, halfDay: true } });
      if (!r || r.status !== 'approved') return;
      await this.toEmployee(r.employeeId, leaveEditedText(daysText(fromDateOnly(r.startDate), fromDateOnly(r.endDate), r.halfDay), REQUEST_LINKS.leave(id)));
    });
  }

  async permission(id: string, event: RequestEvent): Promise<void> {
    await this.safely('permission', async () => {
      const r = await this.prisma.permissionRequest.findUnique({ where: { id }, select: { employeeId: true, managerId: true, status: true, date: true, employee: { select: { fullNameEn: true, fullNameAr: true } } } });
      if (!r) return;
      const day = fromDateOnly(r.date);
      await this.leaveLike('permission', { ...r, name: r.employee.fullNameEn, nameAr: r.employee.fullNameAr, when: daysText(day, day), span: { from: day, to: day }, link: REQUEST_LINKS.permission(id) }, event);
    });
  }

  /** A work from home request (owner, 21 October 2026: "Manager, then HR"): told as a permission's is. */
  async wfh(id: string, event: RequestEvent): Promise<void> {
    await this.safely('work from home', async () => {
      const r = await this.prisma.wfhRequest.findUnique({ where: { id }, select: { employeeId: true, managerId: true, status: true, date: true, employee: { select: { fullNameEn: true, fullNameAr: true } } } });
      if (!r) return;
      const day = fromDateOnly(r.date);
      await this.leaveLike('wfh', { ...r, name: r.employee.fullNameEn, nameAr: r.employee.fullNameAr, when: daysText(day, day), span: { from: day, to: day }, link: REQUEST_LINKS.wfh(id) }, event);
    });
  }

  /** An official duty request (owner, 23 October 2026: "Manager, then HR"): told as a work from home request is, with its days. */
  async od(id: string, event: RequestEvent): Promise<void> {
    await this.safely('official duty', async () => {
      const r = await this.prisma.odRequest.findUnique({
        where: { id },
        select: { employeeId: true, managerId: true, status: true, startDate: true, endDate: true, employee: { select: { fullNameEn: true, fullNameAr: true } } },
      });
      if (!r) return;
      const span = { from: fromDateOnly(r.startDate), to: fromDateOnly(r.endDate) };
      await this.leaveLike('od', { ...r, name: r.employee.fullNameEn, nameAr: r.employee.fullNameAr, when: daysText(span.from, span.to), span, link: REQUEST_LINKS.od(id) }, event);
    });
  }

  async correction(id: string, event: Exclude<RequestEvent, 'cancelled_by_hr'>): Promise<void> {
    await this.safely('correction', async () => {
      const r = await this.prisma.attendanceCorrection.findUnique({ where: { id }, select: { employeeId: true, managerId: true, status: true, date: true, employee: { select: { fullNameEn: true, fullNameAr: true } } } });
      if (!r) return;
      const day = fromDateOnly(r.date);
      await this.leaveLike('correction', { ...r, name: r.employee.fullNameEn, nameAr: r.employee.fullNameAr, when: daysText(day, day), span: { from: day, to: day }, link: REQUEST_LINKS.correction(id) }, event);
    });
  }

  private async leaveLike(kind: LeaveLikeKind, r: RequestFacts, event: RequestEvent): Promise<void> {
    if (event === 'cancelled_by_hr') {
      if (kind !== 'correction' && r.status === 'cancelled') await this.toEmployee(r.employeeId, { ...cancelledByHrText(kind, r.when, r.link), whatsapp: updateOf(kind, r.span, 'cancelled') });
      return;
    }
    const stage = stageOf(r.status);
    if (stage) {
      await this.notifications.notify(await this.deciders(stage, r), { ...waitingText(kind, r.name, r.when, r.link), whatsapp: waitingOf(kind, r) });
      return;
    }
    if (event === 'decided' && (r.status === 'approved' || r.status === 'rejected')) {
      await this.toEmployee(r.employeeId, { ...decidedText(kind, r.status, r.when, r.link), whatsapp: updateOf(kind, r.span, r.status) });
    }
  }

  // ---------- reimbursement claims (the manager, HR, then Finance; paid with the payroll) ----------

  async reimbursement(id: string, event: Exclude<RequestEvent, 'cancelled_by_hr'>): Promise<void> {
    await this.safely('reimbursement', async () => {
      const r = await this.prisma.reimbursementClaim.findUnique({
        where: { id },
        select: { employeeId: true, managerId: true, status: true, expenseDate: true, payMonth: true, employee: { select: { fullNameEn: true, fullNameAr: true } } },
      });
      if (!r) return;
      const link = REQUEST_LINKS.reimbursement(id);
      const expenseDate = fromDateOnly(r.expenseDate);
      const span = { from: expenseDate, to: expenseDate };
      const stage = stageOf(r.status);
      if (stage) {
        const facts = { ...r, name: r.employee.fullNameEn, nameAr: r.employee.fullNameAr, when: daysText(expenseDate, expenseDate), span, link };
        await this.notifications.notify(await this.deciders(stage, facts), { ...waitingText('reimbursement', facts.name, facts.when, link), whatsapp: waitingOf('reimbursement', facts) });
        return;
      }
      if (event !== 'decided') return;
      if (r.status === 'approved' && r.payMonth) {
        const payMonth = fromDateOnly(r.payMonth);
        await this.toEmployee(r.employeeId, { ...claimDecidedText({ approved: true, payMonth }, link), whatsapp: updateOf('reimbursement', span, 'approved', { payMonth }) });
      }
      if (r.status === 'rejected') await this.toEmployee(r.employeeId, { ...claimDecidedText({ approved: false, expenseDate }, link), whatsapp: updateOf('reimbursement', span, 'rejected') });
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
        if (userId) await this.notifications.notify([userId], { ...payslipText(month, paidOn, REQUEST_LINKS.payslip(line.id)), whatsapp: { facts: { template: 'payslip_ready', month } } });
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
      const c = await this.prisma.contract.findUnique({ where: { id: contractId }, select: { approval: true, employment: { select: { employeeId: true, employee: { select: { fullNameEn: true, fullNameAr: true } } } } } });
      if (!c || c.approval !== 'pending_ceo') return;
      const own = await this.usersOf([c.employment.employeeId]);
      const ceos = (await this.usersWith((roles) => roles.includes('ceo'))).filter((id) => id !== own.get(c.employment.employeeId));
      const who = { en: c.employment.employee.fullNameEn, ar: c.employment.employee.fullNameAr };
      await this.notifications.notify(ceos, {
        ...payRaiseWaitingText(c.employment.employee.fullNameEn, REQUEST_LINKS.approvals),
        whatsapp: { facts: { template: 'approval_waiting', what: 'raise', who }, about: c.employment.employeeId },
      });
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
        select: {
          employeeId: true,
          status: true,
          createdAt: true,
          // Home Location, Remote Site or Client Location (24 October 2026), named so in the notice
          type: true,
          employee: { select: { fullNameEn: true, fullNameAr: true } },
          createdBy: { select: { roles: { select: { role: { select: { key: true } } } } } },
        },
      });
      if (!r) return;
      const link = REQUEST_LINKS.homeLocation(id);
      const askedOn = cairoDay(r.createdAt);
      const notActor = (ids: readonly string[]) => ids.filter((u) => u !== actorId);
      // a home location, a remote site or a client location, on WhatsApp by its type (24 October 2026)
      const what = placeWhat(r.type);
      const span = { from: askedOn, to: askedOn };
      const waiting = { facts: { template: 'approval_waiting', what, who: { en: r.employee.fullNameEn, ar: r.employee.fullNameAr }, span }, about: r.employeeId } as const;
      if (r.status === 'with_hr') {
        await this.notifications.notify(notActor(await this.stageDeciders('hr', r.employeeId)), { ...homeWaitingText(r.employee.fullNameEn, askedOn, link, r.type), whatsapp: waiting });
      } else if (r.status === 'with_ceo') {
        const own = (await this.usersOf([r.employeeId])).get(r.employeeId);
        const byCeo = r.createdBy?.roles.some((x) => x.role.key === 'ceo') ?? false;
        const ceos = await this.usersWith((roles) => roles.includes('ceo') || (byCeo && roles.includes('super_admin')));
        await this.notifications.notify(notActor(ceos.filter((u) => u !== own)), { ...homeWaitingText(r.employee.fullNameEn, askedOn, link, r.type), whatsapp: waiting });
      }
      if (event !== 'decided') return;
      if (r.status === 'with_ceo') {
        const actor = actorId ? await this.prisma.user.findUnique({ where: { id: actorId }, select: { roles: { select: { role: { select: { key: true } } } } } }) : null;
        const byTheCeo = (await this.confidential.isConfidential(r.employeeId)) && !!actor?.roles.some((x) => x.role.key === 'ceo');
        await this.toEmployee(r.employeeId, {
          ...homeDecidedText('first_step', askedOn, link, byTheCeo ? 'the CEO' : 'HR', r.type),
          whatsapp: updateOf(what, span, 'first_step', { firstStepBy: byTheCeo ? 'ceo' : 'hr' }),
        });
      } else if (r.status === 'approved' || r.status === 'rejected') {
        await this.toEmployee(r.employeeId, { ...homeDecidedText(r.status, askedOn, link, undefined, r.type), whatsapp: updateOf(what, span, r.status) });
      }
    });
  }

  // ---------- who ----------

  /**
   * The one in charge of a step: the manager it was sent to (their stand-in while they are on leave with one, 25 October
   * 2026); HR or Finance (the CEO for a C-level person's).
   */
  private async deciders(stage: Stage, r: Pick<RequestFacts, 'employeeId' | 'managerId'>): Promise<string[]> {
    if (stage === 'manager') {
      if (!r.managerId || r.managerId === r.employeeId) return [];
      const standIn = await standInOfApprover(this.prisma, r.managerId);
      if (standIn && movesToStandIn(r, standIn, await this.confidential.ids())) return this.standInUsers(standIn.employeeId, r.managerId, r.employeeId);
      const manager = (await this.usersOf([r.managerId])).get(r.managerId);
      return manager ? [manager] : [];
    }
    return this.stageDeciders(stage, r.employeeId);
  }

  /** A stand-in's accounts: the person's, or HR's (never the absent approver's own, nor the requester's). */
  private async standInUsers(standInId: string | null, approverId: string, requesterId: string): Promise<string[]> {
    if (standInId) {
      const user = (await this.usersOf([standInId])).get(standInId);
      return user ? [user] : [];
    }
    const away = (await this.usersOf([approverId])).get(approverId);
    return (await this.stageDeciders('hr', requesterId)).filter((id) => id !== away);
  }

  // ---------- leave coverage (25 October 2026) ----------

  /**
   * The colleague named to cover a leave (owner: "The colleague is told and can see what they cover"): its employee's
   * name and days, never its type; on WhatsApp too. `ended`: they no longer cover it (the cover changed).
   */
  async cover(requestId: string, coverId: string, ended = false): Promise<void> {
    await this.safely('cover', async () => {
      const r = await this.prisma.leaveRequest.findUnique({
        where: { id: requestId },
        select: { employeeId: true, startDate: true, endDate: true, halfDay: true, employee: { select: { fullNameEn: true, fullNameAr: true } } },
      });
      if (!r) return;
      const span = { from: fromDateOnly(r.startDate), to: fromDateOnly(r.endDate), halfDay: r.halfDay };
      const text = coverText(r.employee.fullNameEn, daysText(span.from, span.to, r.halfDay), REQUEST_LINKS.covering, ended);
      const user = (await this.usersOf([coverId])).get(coverId);
      if (!user) return;
      await this.notifications.notify([user], {
        ...text,
        whatsapp: ended ? null : { facts: { template: 'cover_assigned', who: { en: r.employee.fullNameEn, ar: r.employee.fullNameAr }, span }, about: r.employeeId },
      });
    });
  }

  /**
   * An approver's leave with a stand-in has started (told once: StandInSchedulerService): the stand-in (a person, or HR)
   * is told that what waits at the approver's step comes to them until its last day, and how many wait now (those that
   * move to them: movesToStandIn).
   */
  async standInStarted(requestId: string): Promise<void> {
    await this.safely('stand-in', async () => {
      const r = await this.prisma.leaveRequest.findUnique({ where: { id: requestId }, select: { employeeId: true, employee: { select: { fullNameEn: true } } } });
      if (!r) return;
      const standIn = await standInOfApprover(this.prisma, r.employeeId);
      if (!standIn) return;
      const cLevel = [...(await this.confidential.ids())];
      const moved = {
        status: 'with_manager',
        managerId: r.employeeId,
        AND: [
          ...(standIn.employeeId ? [{ employeeId: { not: standIn.employeeId } }] : []),
          ...(!standIn.seesConfidential && cLevel.length ? [{ employeeId: { notIn: cLevel } }] : []),
        ],
      };
      const counts = await Promise.all([
        this.prisma.leaveRequest.count({ where: moved }),
        this.prisma.permissionRequest.count({ where: moved }),
        this.prisma.wfhRequest.count({ where: moved }),
        this.prisma.odRequest.count({ where: moved }),
        this.prisma.attendanceCorrection.count({ where: moved }),
        this.prisma.reimbursementClaim.count({ where: moved }),
      ]);
      const waiting = counts.reduce((a, b) => a + b, 0);
      const users = await this.standInUsers(standIn.employeeId, r.employeeId, r.employeeId);
      const link = standIn.employeeId ? REQUEST_LINKS.myTeam : REQUEST_LINKS.leaveWaiting;
      await this.notifications.notify(users, standInText(r.employee.fullNameEn, standIn.until, waiting, link, !standIn.employeeId));
    });
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

// ---------- the WhatsApp facts (24 October 2026) ----------

/** A request waiting, on WhatsApp: its kind, the requester (in English and Arabic) and its days; about the requester. */
const waitingOf = (what: WhatsAppRequestWhat, r: Pick<RequestFacts, 'employeeId' | 'name' | 'nameAr' | 'span'>): WhatsAppNotice => ({
  facts: { template: 'approval_waiting', what, who: { en: r.name, ar: r.nameAr ?? null }, span: r.span },
  about: r.employeeId,
});

/** The employee's own request decided (or cancelled by HR), on WhatsApp: its kind, its days and the decision. */
const updateOf = (
  what: WhatsAppRequestWhat,
  span: WhatsAppSpan,
  outcome: 'approved' | 'rejected' | 'cancelled' | 'first_step',
  more: { payMonth?: string; firstStepBy?: 'hr' | 'ceo' } = {},
): WhatsAppNotice => ({ facts: { template: 'request_update', what, span, outcome, ...more } });

/** A requested check-in location's type as the WhatsApp message names it: a home location, a remote site, a client location. */
const placeWhat = (type: string | null | undefined): 'home' | 'remote_site' | 'client' => (type === 'remote_site' || type === 'client' ? type : 'home');
