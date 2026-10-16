import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  OPEN_RAISE_REQUEST_STATUSES,
  payStage,
  RAISE_REQUEST_STATUS_LABELS,
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
import type { CreateRaiseRequestDto, RaiseReasonDto } from './raises.dto.js';

const ENTITY = 'raise_request';

/** What a request is shown with: its person, who asked and who declined it, and the raise prepared from it. */
const REQUEST_INCLUDE = {
  employee: { select: { id: true, employeeCode: true, fullNameEn: true } },
  requestedBy: { select: { email: true } },
  declinedBy: { select: { email: true } },
  contract: { select: { id: true, number: true, kind: true, version: true, employmentId: true, startDate: true, grossSalary: true, status: true, approval: true, returnedReason: true, approvedAt: true } },
} satisfies Prisma.RaiseRequestInclude;

type RequestRow = Prisma.RaiseRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

/**
 * Who is looking at a request, as far as its amounts go ("Keep salaries private", owner's decision, 16 October 2026):
 * HR, Finance and the CEO see everything; the employee their own request, with their own suggestion and, once the raise
 * is signed, their new salary; the direct manager the reason, the status and the decisions, never a figure.
 */
export type RequestViewer = 'full' | 'self' | 'manager';

const money = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : d.toNumber());

/** A raise request as `viewer` may see it; `previousGross`: the gross of the version the raise replaces (HR, Finance, CEO). */
export function raiseRequestView(r: RequestRow, viewer: RequestViewer, previousGross: number | null = null) {
  const full = viewer === 'full';
  const done = r.status === 'done';
  const c = r.contract;
  return {
    id: r.id,
    employee: r.employee,
    employmentId: r.employmentId,
    requester: r.requester as RaiseRequester,
    requestedBy: r.requestedBy && { email: r.requestedBy.email },
    reason: r.reason,
    status: r.status as RaiseRequestStatus,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    // the employee sees the amount they suggested themself, never one HR suggested
    suggestedGross: full || (viewer === 'self' && r.requester === 'self') ? money(r.suggestedGross) : null,
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
    amountsHidden: !full,
  };
}

export type RaiseRequestView = ReturnType<typeof raiseRequestView>;

// Raise requests (owner's decisions, 16 October 2026: "a place to request raise by employee, or his manager or the HR,
// with a reason and to be going through an approval cycle"; "HR → CEO"). The employee asks for themself, their direct
// manager for a direct report, or HR for anyone, with a reason and (the employee or HR) a suggested gross; one open per
// person. HR declines it with a reason, or prepares the raise from it (RaisesService.create with the request), which HR
// sends to the CEO; the CEO's approval, return or decline of that raise is the request's (RaisesService), and it is done
// once the raise is signed (ContractsService.sign). The manager is told, not asked: they see their reports' requests and
// every decision. Amounts stay private (see RequestViewer). Every step is in the audit log, an amount only as set.
@Injectable()
export class RaiseRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
  ) {}

  /** A request for the employee, by themself, their direct manager or HR. */
  async create(employeeId: string, dto: CreateRaiseRequestDto, user: SessionUser) {
    const { employee, employment, requester } = await this.asker(employeeId, user);
    if (!requester) throw new ForbiddenException('Only the employee themself, their direct manager or HR can ask for a raise for them.');
    if (!employment) throw new ConflictException(`${employee.fullNameEn} has no current employment: a raise is asked for under one.`);
    const suggested = dto.suggestedGross ?? null;
    if (requester === 'manager' && suggested !== null) {
      throw new BadRequestException("A manager's request has no amount: say why in the reason. HR and the CEO set the amount.");
    }

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
      return tx.raiseRequest.create({
        data: { employeeId, employmentId: employment.id, requestedById: user.id, requester, reason: dto.reason, suggestedGross: suggested },
        include: REQUEST_INCLUDE,
      });
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: ENTITY,
      entityId: row.id,
      // an amount only as set (restricted, as the contracts module logs salaries)
      diff: { employeeId, requester, reason: row.reason, status: 'with_hr', ...(suggested !== null && { suggestedGross: 'set' }) },
    });
    return raiseRequestView(row, requester === 'self' ? 'self' : requester === 'manager' ? 'manager' : 'full');
  }

  /** Every request (HR, Finance and the CEO), newest first, of a status unless all. */
  async list(status: RaiseRequestStatus | undefined) {
    const rows = await this.prisma.raiseRequest.findMany({ where: status ? { status } : {}, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: REQUEST_INCLUDE });
    const previous = await this.previousGross(rows);
    return rows.map((r) => raiseRequestView(r, 'full', previous.get(r.id) ?? null));
  }

  /**
   * The employee's requests as the caller may see them, newest first, and whether the caller may ask for one now: HR,
   * Finance and the CEO see all of them; the employee those they made; their direct manager all of them, without a
   * figure. Anyone else is refused.
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
    return {
      requests: rows.map((r) => raiseRequestView(r, viewer, previous.get(r.id) ?? null)),
      canRequest: why === null,
      cannotRequestBecause: why,
      // the employee and HR may suggest a gross; a manager never states an amount
      suggestsAmount: requester === 'self' || requester === 'hr',
    };
  }

  /**
   * HR declines a request with HR, saying why (the employee and the manager see it). A raise prepared from it and not
   * yet sent goes with it.
   */
  async decline(id: string, dto: RaiseReasonDto, user: SessionUser) {
    const before = await this.row(id);
    if (before.status !== 'with_hr') {
      throw new ConflictException(`This request is ${RAISE_REQUEST_STATUS_LABELS[before.status as RaiseRequestStatus].toLowerCase()}, so HR can't decline it now.`);
    }
    const draft = before.contract && before.contract.status === 'draft' ? before.contract : null;
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.raiseRequest.update({
        where: { id },
        data: { status: 'declined', declinedStage: 'hr', declineReason: dto.reason, declinedById: user.id, declinedAt: new Date(), contractId: null },
        include: REQUEST_INCLUDE,
      });
      if (draft) await tx.contract.delete({ where: { id: draft.id } });
      return saved;
    });
    await this.audit.record({
      userId: user.id,
      action: 'decline',
      entityType: ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, status: { from: 'with_hr', to: 'declined' }, stage: 'hr', reason: dto.reason, ...(draft && { draftDeleted: draft.number }) },
    });
    if (draft) {
      await this.audit.record({ userId: user.id, action: 'delete', entityType: 'contract', entityId: draft.id, diff: { employmentId: draft.employmentId, number: draft.number, version: draft.version, request: id } });
    }
    return raiseRequestView(row, 'full');
  }

  // ---------- helpers ----------

  /**
   * The employee, their current employment, and who the caller is to them: as one who may ask (self, HR, their direct
   * manager; in that order, so HR asking for themself asks as the employee) and as one who may see (full: HR, Finance,
   * the CEO; self; manager). 404 for an employee the caller may not see at all.
   */
  private async asker(employeeId: string, user: SessionUser) {
    const employee = await this.prisma.employee.findFirst({
      where: { AND: [{ id: employeeId }, await this.employees.visibleTo(user)] },
      select: { id: true, fullNameEn: true, workEmail: true, employments: { where: { endDate: null }, select: { id: true, managerId: true }, take: 1 } },
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
