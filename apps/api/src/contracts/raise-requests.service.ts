import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  OPEN_RAISE_REQUEST_STATUSES,
  payStage,
  RAISE_REQUEST_STATUS_LABELS,
  raisedPay,
  suggestionKindsFor,
  type PayBasis,
  type RaiseFigureKind,
  type RaiseReasonChoice,
  type RaiseRequester,
  type RaiseRequestStatus,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly } from '../common/date-only.js';
import { editsEmployees, isSelf, seesSalary } from '../employees/access.js';
import { EmployeesService } from '../employees/employees.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { payOf, recordStep, STEP_INCLUDE, stepFigures, stepView, typedFigure, type RequestViewer } from './raise-request-steps.js';
import { commentOf, type CreateRaiseRequestDto, type RaiseCommentDto } from './raises.dto.js';

export type { RequestViewer } from './raise-request-steps.js';

const ENTITY = 'raise_request';

/** The pay of the contract in force a request is weighed against: its gross, and by the hour its rate and hours. */
const IN_FORCE = { number: true, startDate: true, endDate: true, payBasis: true, grossSalary: true, hourlyRate: true, hoursPerWeek: true } satisfies Prisma.ContractSelect;

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

/**
 * A raise request as `viewer` may see it; `userId`: the caller, to know the requests they made; `previousGross`: the
 * gross of the version the raise replaces (HR, Finance, CEO). `reason` stays the requester's comment, as it was before
 * 17 October 2026, for the screens reading it; `raiseReason` is the reason from the list (none on a request from before).
 */
export function raiseRequestView(r: RequestRow, viewer: RequestViewer, userId: string | null, previousGross: number | null = null) {
  const full = viewer === 'full';
  const done = r.status === 'done';
  const mine = userId !== null && r.requestedById === userId;
  const c = r.contract;
  const inForce = r.employment.endDate === null ? (r.employment.contracts[0] ?? null) : null;
  return {
    id: r.id,
    employee: r.employee,
    employmentId: r.employmentId,
    requester: r.requester as RaiseRequester,
    requestedBy: r.requestedBy && { email: r.requestedBy.email },
    reason: r.comment,
    raiseReason: r.raiseReason as RaiseReasonChoice | null,
    comment: r.comment,
    status: r.status as RaiseRequestStatus,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    // the gross suggested: the employee sees one only as they typed it themself (before 17 October 2026)
    suggestedGross: full || (viewer === 'self' && r.requester === 'self' && suggestionView(r, 'full', true)?.kind === 'gross') ? money(r.suggestedGross) : null,
    suggestion: suggestionView(r, viewer, mine),
    raise: c && {
      contractId: c.id,
      number: c.number,
      way: c.kind === 'amendment' ? ('amendment' as const) : ('contract' as const),
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
    // the contract in force now, which a raise is weighed against (HR, Finance and the CEO)
    inForce:
      full && inForce
        ? {
            number: inForce.number,
            startDate: fromDateOnly(inForce.startDate)!,
            endDate: fromDateOnly(inForce.endDate),
            payBasis: inForce.payBasis as PayBasis,
            grossSalary: inForce.grossSalary.toNumber(),
          }
        : null,
    steps: r.steps.map((s) => stepView(s, viewer, { mine, done })),
    amountsHidden: !full,
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
// the audit log too, an amount only as set.
@Injectable()
export class RaiseRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
  ) {}

  /** A request for the employee, by themself, their direct manager or HR. */
  async create(employeeId: string, dto: CreateRaiseRequestDto, user: SessionUser) {
    const { employee, employment, requester, viewer } = await this.asker(employeeId, user);
    if (!requester || !viewer) throw new ForbiddenException('Only the employee themself, their direct manager or HR can ask for a raise for them.');
    if (!employment) throw new ConflictException(`${employee.fullNameEn} has no current employment: a raise is asked for under one.`);
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
      const open = await tx.raiseRequest.findFirst({ where: { employeeId, status: { in: [...OPEN_RAISE_REQUEST_STATUSES] } }, select: { status: true } });
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
        },
        select: { id: true },
      });
      await recordStep(tx, made.id, user.id, { kind: 'submitted', raiseReason: dto.raiseReason, comment: dto.comment, ...(typed && stepFigures(before, gross, typed)) });
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
        status: 'with_hr',
        ...(typed && { [typed.kind === 'amount' ? 'suggestedIncrease' : 'suggestedPercent']: 'set' }),
      },
    });
    return raiseRequestView(row, viewer, user.id);
  }

  /** Every request (HR, Finance and the CEO), newest first, of a status unless all. */
  async list(status: RaiseRequestStatus | undefined, user: SessionUser) {
    const rows = await this.prisma.raiseRequest.findMany({ where: status ? { status } : {}, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: REQUEST_INCLUDE });
    const previous = await this.previousGross(rows);
    return rows.map((r) => raiseRequestView(r, 'full', user.id, previous.get(r.id) ?? null));
  }

  /** One request, as HR, Finance and the CEO see it: what a step on it answers with. */
  async one(id: string, user: SessionUser) {
    const r = await this.row(id);
    const previous = await this.previousGross([r]);
    return raiseRequestView(r, 'full', user.id, previous.get(r.id) ?? null);
  }

  /**
   * The employee's requests as the caller may see them, newest first, and whether the caller may ask for one now: HR,
   * Finance and the CEO see all of them; the employee those they made; their direct manager all of them, without a
   * figure. Anyone else is refused. With what the caller may suggest, and for HR the gross in force (to show what a
   * suggestion comes to).
   */
  async forEmployee(employeeId: string, user: SessionUser) {
    const { employee, employment, requester, viewer } = await this.asker(employeeId, user);
    if (!viewer) throw new ForbiddenException('Only the employee, their direct manager, HR, Finance and the CEO see raise requests.');
    const rows = await this.prisma.raiseRequest.findMany({
      where: { employeeId, ...(viewer === 'self' && !seesSalary(user) && { requestedById: user.id }) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: REQUEST_INCLUDE,
    });
    const previous = viewer === 'full' ? await this.previousGross(rows) : new Map<string, number>();
    const open = await this.prisma.raiseRequest.count({ where: { employeeId, status: { in: [...OPEN_RAISE_REQUEST_STATUSES] } } });
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
    return {
      requests: rows.map((r) => raiseRequestView(r, viewer, user.id, previous.get(r.id) ?? null)),
      canRequest: why === null,
      cannotRequestBecause: why,
      // the employee and HR may suggest an amount; a manager never states one (a percent only)
      suggestsAmount: requester === 'self' || requester === 'hr',
      suggestionKinds: requester ? suggestionKindsFor(requester) : [],
      // what a suggestion comes to, for those who see salaries
      currentGross: viewer === 'full' && inForce ? inForce.grossSalary.toNumber() : null,
    };
  }

  /**
   * HR rejects a request with HR, with a comment (the employee who asked and their manager see it). A raise prepared
   * from it and not yet sent (or returned by the CEO) goes with it.
   */
  async decline(id: string, dto: RaiseCommentDto, user: SessionUser) {
    const comment = commentOf(dto);
    const before = await this.row(id);
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
   * may see (full: HR, Finance, the CEO; self; manager). 404 for an employee the caller may not see at all.
   */
  private async asker(employeeId: string, user: SessionUser) {
    const employee = await this.prisma.employee.findFirst({
      where: { AND: [{ id: employeeId }, await this.employees.visibleTo(user)] },
      select: {
        id: true,
        fullNameEn: true,
        workEmail: true,
        employments: {
          where: { endDate: null },
          select: { id: true, managerId: true, contracts: { where: { status: 'active' }, orderBy: { version: 'desc' }, take: 1, select: IN_FORCE } },
          take: 1,
        },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found.');
    const employment = employee.employments[0] ?? null;
    const me = await this.prisma.employee.findUnique({ where: { workEmail: user.email.toLowerCase() }, select: { id: true } });
    const self = isSelf(user, employee);
    const manager = !!me && !!employment && employment.managerId === me.id;
    const requester: RaiseRequester | null = self ? 'self' : editsEmployees(user) ? 'hr' : manager ? 'manager' : null;
    const viewer: RequestViewer | null = seesSalary(user) ? 'full' : self ? 'self' : manager ? 'manager' : null;
    return { employee, employment, requester, viewer };
  }

  private async row(id: string): Promise<RequestRow> {
    const r = await this.prisma.raiseRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE });
    if (!r) throw new NotFoundException('Raise request not found.');
    return r;
  }

  /** The gross of the version each request's raise replaces, by request. */
  private async previousGross(rows: readonly RequestRow[]): Promise<Map<string, number>> {
    const raised = rows.filter((r) => r.contract);
    if (!raised.length) return new Map();
    const before = await this.prisma.contract.findMany({
      where: { OR: raised.map((r) => ({ employmentId: r.contract!.employmentId, version: r.contract!.version - 1 })) },
      select: { employmentId: true, version: true, grossSalary: true },
    });
    const out = new Map<string, number>();
    for (const r of raised) {
      const b = before.find((x) => x.employmentId === r.contract!.employmentId && x.version === r.contract!.version - 1);
      if (b) out.set(r.id, b.grossSalary.toNumber());
    }
    return out;
  }
}
