import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  decidesConfidentialStage,
  effectiveFromProblem,
  OPEN_RAISE_REQUEST_STATUSES,
  payChangeOf,
  payStage,
  RAISE_REQUEST_STATUS_LABELS,
  RAISE_REQUESTS_ASKED_BY_HR,
  RAISE_REQUESTS_SEEN_BY_HR,
  raisedPay,
  raiseRequestAccess,
  seesRaiseRequests,
  suggestionKindsFor,
  type PayBasis,
  type PayChange,
  type RaiseFigureKind,
  type RaiseReason,
  type RaiseRequester,
  type RaiseRequestOrigin,
  type RaiseRequestStatus,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { actsAs } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { isSelf, seesSalary } from '../employees/access.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { EmployeesService } from '../employees/employees.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NoticesService } from '../notifications/notices.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { payOf, recordStep, STEP_INCLUDE, stepFigures, stepView, typedFigure, type RequestViewer } from './raise-request-steps.js';
import { commentOf, type CreateRaiseRequestDto, type RaiseCommentDto } from './raises.dto.js';

export type { RequestViewer } from './raise-request-steps.js';

const ENTITY = 'raise_request';

/**
 * The pay of the contract in force a request is weighed against: its gross, by the hour its rate and hours, and its
 * allowances as the net is worked out from them (the figures shown while asking or deciding, 17 October 2026).
 */
const IN_FORCE = {
  number: true,
  startDate: true,
  endDate: true,
  payBasis: true,
  grossSalary: true,
  hourlyRate: true,
  hoursPerWeek: true,
  allowances: { select: { amount: true, taxable: true, insured: true } },
} satisfies Prisma.ContractSelect;

type InForceRow = Prisma.ContractGetPayload<{ select: typeof IN_FORCE }>;

/**
 * The pay in force as the figures of a raise are worked out from it (owner, 17 October 2026: "while raising a request
 * show some figures regarding the raise (Gross and net) but mainly we are working on the gross salary"): the gross (by
 * the hour, the monthly estimate), the rate and hours, and the allowances with how each is taxed and insured. RESTRICTED:
 * sent only to HR, Finance and the CEO, and to the employee for their own pay ("allow the requestor raiser to see figures
 * too"); never to a manager ("No, only percent").
 */
export function payView(c: InForceRow) {
  return {
    number: c.number,
    startDate: fromDateOnly(c.startDate),
    endDate: fromDateOnly(c.endDate),
    payBasis: c.payBasis as PayBasis,
    grossSalary: c.grossSalary.toNumber(),
    hourlyRate: c.hourlyRate?.toNumber() ?? null,
    hoursPerWeek: c.hoursPerWeek?.toNumber() ?? null,
    allowances: c.allowances.map((a) => ({ amount: a.amount.toNumber(), taxable: a.taxable, insured: a.insured })),
  };
}

/**
 * What a request is shown with: its person, who asked and who declined it, the raise prepared from it, its log in order,
 * and its employment's contract in force (for the figures HR weighs it with).
 */
export const REQUEST_INCLUDE = {
  employee: { select: { id: true, employeeCode: true, fullNameEn: true } },
  requestedBy: { select: { email: true } },
  declinedBy: { select: { email: true } },
  contract: { select: { id: true, number: true, kind: true, version: true, employmentId: true, startDate: true, grossSalary: true, status: true, approval: true, returnedReason: true, approvedAt: true } },
  steps: { orderBy: { id: 'asc' }, include: STEP_INCLUDE },
  employment: { select: { endDate: true, contracts: { where: { status: 'active' }, orderBy: { version: 'desc' }, take: 1, select: IN_FORCE } } },
} satisfies Prisma.RaiseRequestInclude;

export type RequestRow = Prisma.RaiseRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

const money = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : d.toNumber());

/** How a request's raise was suggested: an amount, a percent, or (before 17 October 2026) the gross typed. */
export type SuggestionKind = RaiseFigureKind | 'gross';

/**
 * The raise suggested on a request as `viewer` may see it: HR, Finance and the CEO all of it (the figure typed and the
 * gross it came to); the one who asked, what they typed (the employee: their amount or percent, or the gross they typed
 * before 17 October 2026; a manager: their percent); anyone else nothing.
 */
export function suggestionView(r: Pick<RequestRow, 'suggestedIncrease' | 'suggestedPercent' | 'suggestedGross'>, viewer: RequestViewer, mine: boolean) {
  const amount = money(r.suggestedIncrease);
  const percent = money(r.suggestedPercent);
  const gross = money(r.suggestedGross);
  const kind: SuggestionKind | null = amount !== null ? 'amount' : percent !== null ? 'percent' : gross !== null ? 'gross' : null;
  if (!kind) return null;
  if (viewer === 'full') return { kind, amount, percent, gross };
  if (!mine) return null;
  if (viewer === 'self') return { kind, amount, percent, gross: kind === 'gross' ? gross : null };
  return kind === 'percent' ? { kind, amount: null, percent, gross: null } : null;
}

/** The version a request's raise replaces: its gross (HR, Finance and the CEO only) and its end, to tell a renewal. */
export interface PreviousVersion {
  grossSalary: number;
  endDate: string | null;
}

/**
 * What a request's raise is to the version it replaces: an amendment, a new contract within its term, or a renewal
 * after it (a renewal with new pay, prepared directly by HR, 19 October 2026). Without the version before, by its kind.
 */
export function raiseChangeOf(c: { kind: string; startDate: Date }, previous: Pick<PreviousVersion, 'endDate'> | null): Exclude<PayChange, 'hired'> {
  if (c.kind === 'amendment') return 'amendment';
  if (!previous) return 'new_contract';
  return payChangeOf({ kind: c.kind, startDate: fromDateOnly(c.startDate)! }, previous) === 'renewal' ? 'renewal' : 'new_contract';
}

/**
 * A raise request as `viewer` may see it; `userId`: the caller, to know the requests they made; `previous`: the version
 * the raise replaces (its gross for HR, Finance and the CEO). `reason` stays the requester's comment, as it was before
 * 17 October 2026, for the screens reading it; `raiseReason` is the reason from the list (none on a request from before;
 * the raise's own on one prepared directly by HR, 19 October 2026, which says so in `origin`).
 */
export function raiseRequestView(r: RequestRow, viewer: RequestViewer, userId: string | null, previous: PreviousVersion | null = null, confidential = false) {
  const full = viewer === 'full';
  const done = r.status === 'done';
  const mine = userId !== null && r.requestedById === userId;
  const c = r.contract;
  const inForce = r.employment.endDate === null ? (r.employment.contracts[0] ?? null) : null;
  const previousGross = previous?.grossSalary ?? null;
  return {
    id: r.id,
    employee: r.employee,
    employmentId: r.employmentId,
    requester: r.requester as RaiseRequester,
    // asked for, or prepared directly by HR (owner, 19 October 2026: every raise on Raise Requests)
    origin: r.origin as RaiseRequestOrigin,
    requestedBy: r.requestedBy && { email: r.requestedBy.email },
    reason: r.comment,
    raiseReason: r.raiseReason as RaiseReason | null,
    comment: r.comment,
    status: r.status as RaiseRequestStatus,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    // the month the raise is asked from (17 October 2026), for everyone who sees the request: a date, not a figure; null
    // on a request from before then
    effectiveFrom: fromDateOnly(r.effectiveFrom),
    // the gross suggested: the employee sees one only as they typed it themself (before 17 October 2026)
    suggestedGross: full || (viewer === 'self' && r.requester === 'self' && suggestionView(r, 'full', true)?.kind === 'gross') ? money(r.suggestedGross) : null,
    suggestion: suggestionView(r, viewer, mine),
    raise: c && {
      contractId: c.id,
      number: c.number,
      way: c.kind === 'amendment' ? ('amendment' as const) : ('contract' as const),
      // an amendment, a new contract, or a renewal with new pay (19 October 2026): not a figure
      change: raiseChangeOf(c, previous),
      stage: payStage(c),
      // when it takes effect: once signed for the employee and the manager, before then for HR, Finance and the CEO
      effectiveDate: full || done ? fromDateOnly(c.startDate) : null,
      previousGross: full ? previousGross : null,
      // the employee's own new salary once signed (owner: "Keep salaries private"); never the manager's to see
      newGross: full || (viewer === 'self' && done) ? c.grossSalary.toNumber() : null,
      returnedReason: full ? c.returnedReason : null,
      approvedAt: c.approvedAt,
    },
    decision: r.status === 'declined' ? { stage: r.declinedStage as 'hr' | 'ceo', reason: r.declineReason, at: r.declinedAt, by: r.declinedBy && { email: r.declinedBy.email } } : null,
    doneAt: r.doneAt,
    // the contract in force now, which a raise is weighed against, with what its net is worked out from (HR, Finance and
    // the CEO)
    inForce: full && inForce ? payView(inForce) : null,
    steps: r.steps.map((s) => stepView(s, viewer, { mine, done })),
    amountsHidden: !full,
    // a C-level person's (owner, 19 October 2026: "make C level Employees details not visible to HR"): HR's step is the
    // CEO's, or HR's with Super Admin
    confidential,
  };
}

export type RaiseRequestView = ReturnType<typeof raiseRequestView>;

// Raise requests (owner's decisions, 16 October 2026: "a place to request raise by employee, or his manager or the HR,
// with a reason and to be going through an approval cycle"; "HR → CEO"; reworked 17 October 2026: "requesting a raise
// should have a drop list reason first ( Annual Raise - Performance Raise - Counter Offer Raise - etc..) then add
// requester comment, suggest raise amount or percentage, then the approver to Approve - Approve with another raise amount
// or percentge - Reject, and add a comment, all the request steps to be logged in the request"). The employee asks for
// themself, their direct manager for a direct report, or HR for anyone: a reason from the list, a comment, and a raise
// suggested as an amount (the employee and HR) or a percent of the gross (anyone: a manager doesn't see salaries); one
// open per person. HR rejects it with a comment (here), or approves it as suggested or with another raise, which
// prepares the raise and sends it to the CEO (RaisesService.approveRequest, or the whole raise form); the CEO's decision
// on that raise is the request's (RaisesService), and it is done once the raise is signed (ContractsService.sign). The
// manager is told, not asked: they see their reports' requests and every decision. Each step is logged on the request
// (raise-request-steps.ts), in the transaction it is taken in; amounts stay private (RequestViewer). Every step is in
// the audit log too, an amount only as set. Since 17 October 2026 ("in the request their should be a tab called Effective
// from") a request also says the month the raise is asked from (Effective from, its 1st: this month in Cairo or a later
// one), required on a new one and logged with its submitted step; everyone who sees the request sees it, and HR's
// approval takes it as the raise's effective date unless HR sets another (RaisesService.approveRequest). Since 19 October
// 2026 ("when a raise request was sent to the CEO, is showed in approvals not raise requests, and after approved, it was
// not shown in the raise request history too") a raise HR prepares directly has its request too, prepared directly by HR
// (direct-requests.ts): listed with the others, following its raise, never rejected by HR (nobody asked for it), not the
// person's one open request, and seen by HR, Finance and the CEO only, as its raise is kept from the others until signed.
// Since 20 October 2026 (owner: "raises not to be visible to employee level for now", then "Hide from managers too"; the
// switch is EMPLOYEE_LEVEL_SEES_RAISES in packages/shared raises.ts) the employee level neither asks nor sees: an
// employee, a direct manager or an Admin is refused (403) asking for a raise and reading a person's requests; HR, Finance,
// the CEO and a Super Admin as before (raiseRequestAccess). Requests an employee or a manager asked for before carry on
// with HR and the CEO.
@Injectable()
export class RaiseRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
    private readonly confidential: ConfidentialService,
    private readonly notices: NoticesService,
  ) {}

  /**
   * A request for the employee, by themself, their direct manager or HR, from a month (Effective from, 17 October 2026:
   * the 1st of this month in Cairo or a later one). Refused to the employee level while it doesn't see raise requests
   * (20 October 2026): only HR, Finance, the CEO and a Super Admin ask then.
   */
  async create(employeeId: string, dto: CreateRaiseRequestDto, user: SessionUser) {
    if (!seesRaiseRequests(user)) throw new ForbiddenException(RAISE_REQUESTS_ASKED_BY_HR);
    const { employee, employment, requester, viewer } = await this.asker(employeeId, user);
    if (!requester || !viewer) throw new ForbiddenException('Only the employee themself, their direct manager or HR can ask for a raise for them.');
    if (!employment) throw new ConflictException(`${employee.fullNameEn} has no current employment: a raise is asked for under one.`);
    // refused when asked, not only when HR would prepare it: a trainee's pay is the agreement's stages, an intern has none
    // (owner, 19 October 2026: the unpaid internship, outside the labour law)
    if (employment.employmentType === 'intern') {
      throw new ConflictException(`${employee.fullNameEn} is an intern, paid no wage (an unpaid internship): there is no pay to raise. HR can convert the internship to a full-time contract instead.`);
    }
    if (employment.employmentType === 'trainee') {
      throw new ConflictException(`${employee.fullNameEn} is a trainee, paid by the stages of the training agreement (Labour Law Art. 29): HR changes the pay with a new training agreement, not a raise.`);
    }
    const effectiveProblem = effectiveFromProblem(dto.effectiveFrom, todayInCairo());
    if (effectiveProblem) throw new BadRequestException(effectiveProblem);
    const typed = typedFigure(dto.suggestedIncrease, dto.suggestedPercent);
    if (typed && !suggestionKindsFor(requester).includes(typed.kind)) {
      throw new BadRequestException("A manager suggests a raise as a percent only, as managers don't see salaries: HR and the CEO set the amount.");
    }
    // the gross the suggestion comes to, on the contract in force (none before one is signed)
    const inForce = employment.contracts[0] ?? null;
    const before = inForce ? inForce.grossSalary.toNumber() : null;
    const gross = typed && inForce ? raisedPay(payOf(inForce), typed).grossSalary : null;

    const row = await this.prisma.$transaction(async (tx) => {
      // one open at a time, even when two are sent together: the employee's row is held until this one is saved
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      const open = await tx.raiseRequest.findFirst({ where: { employeeId, origin: 'request', status: { in: [...OPEN_RAISE_REQUEST_STATUSES] } }, select: { status: true } });
      if (open) {
        throw new ConflictException(
          requester === 'self'
            ? 'A raise request for you is already open. It is decided first.'
            : `A raise request for ${employee.fullNameEn} is already open (${RAISE_REQUEST_STATUS_LABELS[open.status as RaiseRequestStatus].toLowerCase()}). It is decided first.`,
        );
      }
      const made = await tx.raiseRequest.create({
        data: {
          employeeId,
          employmentId: employment.id,
          requestedById: user.id,
          requester,
          raiseReason: dto.raiseReason,
          comment: dto.comment,
          suggestedIncrease: typed?.kind === 'amount' ? typed.value : null,
          suggestedPercent: typed?.kind === 'percent' ? typed.value : null,
          suggestedGross: gross,
          effectiveFrom: toDateOnly(dto.effectiveFrom),
        },
        select: { id: true },
      });
      await recordStep(tx, made.id, user.id, {
        kind: 'submitted',
        raiseReason: dto.raiseReason,
        comment: dto.comment,
        effectiveDate: dto.effectiveFrom,
        ...(typed && stepFigures(before, gross, typed)),
      });
      return tx.raiseRequest.findUniqueOrThrow({ where: { id: made.id }, include: REQUEST_INCLUDE });
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: ENTITY,
      entityId: row.id,
      // an amount only as set (restricted, as the contracts module logs salaries)
      diff: {
        employeeId,
        requester,
        raiseReason: dto.raiseReason,
        comment: dto.comment,
        effectiveFrom: dto.effectiveFrom,
        status: 'with_hr',
        ...(typed && { [typed.kind === 'amount' ? 'suggestedIncrease' : 'suggestedPercent']: 'set' }),
      },
    });
    // to HR (the CEO for a C-level person), never the one who asked (Phase 4: notifications)
    await this.notices.raiseRequestSent(row.id);
    return raiseRequestView(row, viewer, user.id, null, await this.confidential.isConfidential(employeeId));
  }

  /**
   * Every request (HR, Finance and the CEO), newest first, of a status unless all; a C-level person's only for the CEO
   * and a Super Admin (owner, 19 October 2026: "make C level Employees details not visible to HR").
   */
  async list(status: RaiseRequestStatus | undefined, user: SessionUser) {
    const confidential = await this.confidential.view(user);
    const rows = await this.prisma.raiseRequest.findMany({
      where: { ...(status && { status }), ...(confidential.hidden.size && { employeeId: { notIn: [...confidential.hidden] } }) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: REQUEST_INCLUDE,
    });
    const previous = await this.previousVersions(rows);
    return rows.map((r) => raiseRequestView(r, 'full', user.id, previous.get(r.id) ?? null, confidential.all.has(r.employeeId)));
  }

  /** One request, as HR, Finance and the CEO see it: what a step on it answers with. Not a C-level person's hidden from the caller. */
  async one(id: string, user: SessionUser) {
    const r = await this.row(id);
    await this.confidential.assertVisible(user, r.employeeId, 'Raise request not found.');
    const previous = await this.previousVersions([r]);
    return raiseRequestView(r, 'full', user.id, previous.get(r.id) ?? null, await this.confidential.isConfidential(r.employeeId));
  }

  /**
   * Whether the caller takes HR's step on this request (approve or reject it while it is with HR): HR; a C-level person's
   * the CEO (owner, 19 October 2026: their HR stages go to the CEO), or HR with Super Admin, never for themself. 403 for
   * anyone else; 404 for a request hidden from them.
   */
  async assertDecidesHrStep(id: string, user: SessionUser): Promise<void> {
    const r = await this.prisma.raiseRequest.findUnique({ where: { id }, select: { employeeId: true } });
    if (!r) throw new NotFoundException('Raise request not found.');
    await this.confidential.assertVisible(user, r.employeeId, 'Raise request not found.');
    if (await this.confidential.isConfidential(r.employeeId)) {
      if (!decidesConfidentialStage(user, ['hr'])) throw new ForbiddenException("A C-level person's raise request is decided by the CEO, not HR.");
      if ((await this.confidential.selfId(user)) === r.employeeId) throw new ForbiddenException('Someone else has to decide a raise request for you.');
      return;
    }
    if (!actsAs(user.roles, ['hr'])) throw new ForbiddenException("HR decides this raise request: the CEO takes HR's step only on a C-level person's.");
  }

  /**
   * The employee's requests as the caller may see them, newest first, and whether the caller may ask for one now: HR,
   * Finance and the CEO see all of them; the employee those they made; their direct manager all of them, without a
   * figure. Anyone else is refused. With what the caller may suggest, for HR the gross in force (to show what a
   * suggestion comes to), and the pay in force for the figures shown while asking (`pay`: HR, Finance, the CEO and the
   * employee themself, 17 October 2026; null for a manager). A request prepared directly by HR (19 October 2026) only for
   * HR, Finance and the CEO. Refused to the employee level while it doesn't see raise requests (20 October 2026): the
   * employee and their manager see nothing of them then.
   */
  async forEmployee(employeeId: string, user: SessionUser) {
    if (!seesRaiseRequests(user)) throw new ForbiddenException(RAISE_REQUESTS_SEEN_BY_HR);
    const { employee, employment, requester, viewer } = await this.asker(employeeId, user);
    if (!viewer) throw new ForbiddenException('Only the employee, their direct manager, HR, Finance and the CEO see raise requests.');
    const confidential = await this.confidential.isConfidential(employeeId);
    const rows = await this.prisma.raiseRequest.findMany({
      where: { employeeId, ...(viewer === 'self' && !seesSalary(user) && { requestedById: user.id }), ...(viewer !== 'full' && { origin: 'request' }) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: REQUEST_INCLUDE,
    });
    const previous = await this.previousVersions(rows);
    const open = await this.prisma.raiseRequest.count({ where: { employeeId, origin: 'request', status: { in: [...OPEN_RAISE_REQUEST_STATUSES] } } });
    const why = !requester
      ? 'Only the employee themself, their direct manager or HR can ask for a raise for them.'
      : !employment
        ? `${employee.fullNameEn} has no current employment.`
        : open
          ? requester === 'self'
            ? 'A raise request for you is open: it is decided first.'
            : `A raise request for ${employee.fullNameEn} is open: it is decided first.`
          : null;
    const inForce = employment?.contracts[0] ?? null;
    // the pay the figures of a raise are worked out from, while asking: HR, Finance and the CEO, and the employee for
    // their own (17 October 2026: "allow the requestor raiser to see figures too"); a manager never ("No, only percent")
    const seesPay = viewer === 'full' || (viewer === 'self' && requester === 'self');
    return {
      requests: rows.map((r) => raiseRequestView(r, viewer, user.id, previous.get(r.id) ?? null, confidential)),
      canRequest: why === null,
      cannotRequestBecause: why,
      // the employee and HR may suggest an amount; a manager never states one (a percent only)
      suggestsAmount: requester === 'self' || requester === 'hr',
      suggestionKinds: requester ? suggestionKindsFor(requester) : [],
      // what a suggestion comes to, for those who see salaries
      currentGross: viewer === 'full' && inForce ? inForce.grossSalary.toNumber() : null,
      pay: seesPay && inForce ? payView(inForce) : null,
    };
  }

  /**
   * HR rejects a request with HR, with a comment (the employee who asked and their manager see it). A raise prepared
   * from it and not yet sent (or returned by the CEO) goes with it.
   */
  async decline(id: string, dto: RaiseCommentDto, user: SessionUser) {
    const comment = commentOf(dto);
    await this.assertDecidesHrStep(id, user);
    const before = await this.row(id);
    if (before.origin === 'direct') {
      throw new ConflictException(
        'HR prepared this raise directly, so there is no request to reject: change the raise and send it to the CEO, or have a Super Admin delete the draft.',
      );
    }
    if (before.status !== 'with_hr') {
      throw new ConflictException(`This request is ${RAISE_REQUEST_STATUS_LABELS[before.status as RaiseRequestStatus].toLowerCase()}, so HR can't reject it now.`);
    }
    const draft = before.contract && before.contract.status === 'draft' ? before.contract : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.raiseRequest.update({
        where: { id },
        data: { status: 'declined', declinedStage: 'hr', declineReason: comment, declinedById: user.id, declinedAt: new Date(), contractId: null },
      });
      await recordStep(tx, id, user.id, { kind: 'hr_decision', decision: 'reject', comment });
      if (draft) await tx.contract.delete({ where: { id: draft.id } });
    });
    await this.audit.record({
      userId: user.id,
      action: 'decline',
      entityType: ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, status: { from: 'with_hr', to: 'declined' }, stage: 'hr', decision: 'reject', comment, ...(draft && { draftDeleted: draft.number }) },
    });
    if (draft) {
      await this.audit.record({ userId: user.id, action: 'delete', entityType: 'contract', entityId: draft.id, diff: { employmentId: draft.employmentId, number: draft.number, version: draft.version, request: id } });
    }
    return this.one(id, user);
  }

  // ---------- helpers ----------

  /**
   * The employee, their current employment (with its contract in force), and who the caller is to them: as one who may
   * ask (self, HR, their direct manager; in that order, so HR asking for themself asks as the employee) and as one who
   * may see (full: HR, Finance, the CEO; self; manager), by raiseRequestAccess (packages/shared raises.ts): neither for
   * the employee level while it doesn't see raise requests (20 October 2026). 404 for an employee the caller may not see
   * at all.
   */
  private async asker(employeeId: string, user: SessionUser) {
    const employee = await this.prisma.employee.findFirst({
      // not a C-level person hidden from the caller (owner, 19 October 2026), the employee themself excepted
      where: { AND: [{ id: employeeId }, await this.employees.visibleTo(user), await this.confidential.employeeWhere(user)] },
      select: {
        id: true,
        fullNameEn: true,
        workEmail: true,
        employments: {
          where: { endDate: null },
          select: { id: true, managerId: true, employmentType: true, contracts: { where: { status: 'active' }, orderBy: { version: 'desc' }, take: 1, select: IN_FORCE } },
          take: 1,
        },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found.');
    const employment = employee.employments[0] ?? null;
    const me = await this.prisma.employee.findUnique({ where: { workEmail: user.email.toLowerCase() }, select: { id: true } });
    const self = isSelf(user, employee);
    const manager = !!me && !!employment && employment.managerId === me.id;
    const { requester, viewer } = raiseRequestAccess({ roles: user.roles, self, manager });
    return { employee, employment, requester, viewer };
  }

  private async row(id: string): Promise<RequestRow> {
    const r = await this.prisma.raiseRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE });
    if (!r) throw new NotFoundException('Raise request not found.');
    return r;
  }

  /** The version each request's raise replaces, by request: its gross and its end. */
  private async previousVersions(rows: readonly RequestRow[]): Promise<Map<string, PreviousVersion>> {
    const raised = rows.filter((r) => r.contract);
    if (!raised.length) return new Map();
    const before = await this.prisma.contract.findMany({
      where: { OR: raised.map((r) => ({ employmentId: r.contract!.employmentId, version: r.contract!.version - 1 })) },
      select: { employmentId: true, version: true, grossSalary: true, endDate: true },
    });
    const out = new Map<string, PreviousVersion>();
    for (const r of raised) {
      const b = before.find((x) => x.employmentId === r.contract!.employmentId && x.version === r.contract!.version - 1);
      if (b) out.set(r.id, { grossSalary: b.grossSalary.toNumber(), endDate: fromDateOnly(b.endDate) });
    }
    return out;
  }
}
