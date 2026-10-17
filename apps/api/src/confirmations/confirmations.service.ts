import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CHANGE_REQUEST_STATUS_LABELS, CONFIRM_FIELD_KEYS, PROFILE_DISCLAIMER, REQUESTABLE_FIELD_KEYS, type ChangeRequestStatus, type ConfirmField } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { validated } from '../common/validation.js';
import { isSelf } from '../employees/access.js';
import { UpdateEmployeeDto } from '../employees/employee.dto.js';
import { EmployeesService } from '../employees/employees.service.js';
import type { Employee, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ALL_CHANGE_REQUESTS, type ConfirmDto, type CreateChangeRequestDto, type DecisionNoteDto } from './confirmations.dto.js';
import {
  type Change,
  changeRequestView,
  CONFIRMATION_INCLUDE,
  confirmationView,
  confirmValue,
  REQUEST_INCLUDE,
  type RequestRow,
  snapshotOf,
} from './views.js';

const CONFIRMATION = 'profile_confirmation';
const REQUEST = 'profile_change_request';

/** The database, or a transaction in it. */
type Db = PrismaService | Prisma.TransactionClient;

/** How a change request stops waiting. */
type Closed = Exclude<ChangeRequestStatus, 'pending'>;

/** "approved", "cancelled" …: a change request's status inside a sentence. */
const statusText = (status: string) => (CHANGE_REQUEST_STATUS_LABELS[status as ChangeRequestStatus] ?? status).replace(/^\w/, (c) => c.toLowerCase());

const requestable = (field: string): field is ConfirmField => (REQUESTABLE_FIELD_KEYS as readonly string[]).includes(field);

/** A change request's changes as a profile edit: { field: the value asked for }. */
const editOf = (changes: Change[]) => Object.fromEntries(changes.map((c) => [c.field, c.to]));

// The employee's own check of their details (owner's decision, 15 October 2026): "An employee must validate their data
// and education once, and after each change, with a disclaimer that they're responsible for the data they approved.
// They can request an edit, which goes back to HR or an Admin to approve or reject."
// The employee is the user whose sign-in account is the profile's work email; only they confirm their details or ask
// for a change, not HR on their behalf. An approved change is made as HR's edit of the profile (EmployeesService.edit,
// the code path of an HR edit), so it is checked and audited the same way, and the employee then confirms again.
@Injectable()
export class ConfirmationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
  ) {}

  /** The employee confirms their details as they are now, accepting the statement. Answers where the confirmation stands. */
  async confirm(employeeId: string, dto: ConfirmDto, user: SessionUser) {
    const e = await this.own(employeeId, user, 'Only the employee can confirm their own details.');
    if (dto.accept !== true) throw new BadRequestException('Tick the statement to confirm your details.');
    // the page was read with another wording of the statement than the one in force
    if (dto.disclaimerVersion !== PROFILE_DISCLAIMER.version) throw new ConflictException('The statement has changed; read it again and confirm.');

    const row = await this.prisma.profileConfirmation.create({
      data: { employeeId, userId: user.id, disclaimerVersion: PROFILE_DISCLAIMER.version, snapshot: snapshotOf(e) },
      include: CONFIRMATION_INCLUDE,
    });
    await this.audit.record({
      userId: user.id,
      action: 'confirm',
      entityType: CONFIRMATION,
      entityId: row.id,
      diff: { employeeId, disclaimerVersion: row.disclaimerVersion },
    });
    return confirmationView(row, e);
  }

  /**
   * The employee asks for a change to the details they confirm. The new values are checked and tidied as HR's edit of
   * the profile would check them (the same DTO, then the checks across fields, nothing saved), and kept as they would
   * be saved; values the same as now are left out. One request waits per employee at a time.
   */
  async request(employeeId: string, dto: CreateChangeRequestDto, user: SessionUser) {
    const e = await this.own(employeeId, user, 'Only the employee can ask for a change to their own details.');
    const sent = Object.keys(dto.changes);
    // the work email is the company's, changed by HR together with the sign-in account
    if (sent.includes('workEmail')) throw new BadRequestException('The work email is set by the company. Ask HR to change it.');
    const other = sent.find((field) => !requestable(field));
    if (other !== undefined) throw new BadRequestException(`${other} can't be changed by request.`);
    await this.assertNoneWaiting(this.prisma, employeeId);

    const edit = await validated(UpdateEmployeeDto, dto.changes);
    const now = snapshotOf(e);
    const changes: Change[] = CONFIRM_FIELD_KEYS.filter((field) => sent.includes(field))
      .map((field) => ({ field, from: now[field], to: confirmValue(edit[field]) }))
      .filter((c) => c.from !== c.to);
    if (!changes.length) throw new BadRequestException('Nothing would change: the new values are the same as the current ones.');
    await this.employees.checkUpdate(employeeId, editOf(changes) as UpdateEmployeeDto);

    const row = await this.prisma.$transaction(async (tx) => {
      // one at a time, even when two are sent together: the employee's row is held until this one is saved
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      await this.assertNoneWaiting(tx, employeeId);
      return tx.profileChangeRequest.create({
        data: { employeeId, requestedById: user.id, changes: changes as unknown as Prisma.InputJsonValue, note: dto.note ?? null },
        include: REQUEST_INCLUDE,
      });
    });
    await this.audit.record({ userId: user.id, action: 'create', entityType: REQUEST, entityId: row.id, diff: { employeeId, changes, note: row.note, status: 'pending' } });
    return changeRequestView(row);
  }

  /**
   * Change requests with their employee, newest first: those waiting for HR unless `status` says otherwise; `all`, every
   * request whatever its status (the Details Changes page, under Requests: owner's decision, 17 October 2026).
   */
  async list(status: ChangeRequestStatus | typeof ALL_CHANGE_REQUESTS = 'pending') {
    const rows = await this.prisma.profileChangeRequest.findMany({
      where: status === ALL_CHANGE_REQUESTS ? {} : { status },
      // the same moment: the later id first, so the order is the same on every read
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      include: REQUEST_INCLUDE,
    });
    return rows.map(changeRequestView);
  }

  /**
   * HR or an Admin approves: the change is made as an HR edit of the profile, checked again (the data may have changed
   * since it was asked for, e.g. the work email taken by someone else) and audited as an edit. If the edit is refused
   * the request keeps waiting, and the refusal is the answer. The employee's confirmation is then stale.
   */
  async approve(id: string, dto: DecisionNoteDto, user: SessionUser) {
    const before = await this.row(id);
    this.assertWaiting(before, 'approved');
    const edit = await validated(UpdateEmployeeDto, editOf(before.changes as unknown as Change[]));
    await this.employees.edit(before.employeeId, edit, user);
    return this.decide(before, 'approved', user, dto.note ?? null);
  }

  /** HR or an Admin rejects, saying why. Nothing changes on the profile. */
  async reject(id: string, dto: DecisionNoteDto, user: SessionUser) {
    if (!dto.note) throw new BadRequestException('Say why the change is rejected.');
    const before = await this.row(id);
    this.assertWaiting(before, 'rejected');
    return this.decide(before, 'rejected', user, dto.note);
  }

  /** The employee who asked withdraws the request while it waits. */
  async cancel(id: string, user: SessionUser) {
    const before = await this.row(id);
    if (before.requestedById !== user.id) throw new ForbiddenException('Only the employee who asked for the change can cancel it.');
    this.assertWaiting(before, 'cancelled');
    return this.decide(before, 'cancelled', user, null);
  }

  // ---------- helpers ----------

  /** The employee's own profile: anyone else, HR included, is refused with `message`. */
  private async own(employeeId: string, user: SessionUser, message: string): Promise<Employee> {
    const e = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!e) throw new NotFoundException('Employee not found.');
    if (!isSelf(user, e)) throw new ForbiddenException(message);
    return e;
  }

  private async row(id: string): Promise<RequestRow> {
    const r = await this.prisma.profileChangeRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE });
    if (!r) throw new NotFoundException('Change request not found.');
    return r;
  }

  private async assertNoneWaiting(db: Db, employeeId: string) {
    const waiting = await db.profileChangeRequest.findFirst({ where: { employeeId, status: 'pending' }, select: { id: true } });
    if (waiting) throw new ConflictException('You already have a change request waiting for HR. Cancel it to send a new one.');
  }

  private assertWaiting(r: RequestRow, to: Closed) {
    if (r.status !== 'pending') throw new ConflictException(`Only a change request waiting for HR can be ${to}. This one is ${statusText(r.status)}.`);
  }

  /**
   * Closes a waiting request: approved, rejected, or cancelled by the employee (who is then the one who decided). Only
   * while it still waits, so two people deciding at once can't both close it.
   */
  private async decide(before: RequestRow, status: Closed, user: SessionUser, note: string | null) {
    const { count } = await this.prisma.profileChangeRequest.updateMany({
      where: { id: before.id, status: 'pending' },
      data: { status, decidedById: user.id, decidedAt: new Date(), decisionNote: note },
    });
    if (!count) {
      const now = await this.row(before.id);
      throw new ConflictException(`This change request was ${statusText(now.status)} meanwhile.`);
    }
    await this.audit.record({
      userId: user.id,
      action: { approved: 'approve', rejected: 'reject', cancelled: 'cancel' }[status],
      entityType: REQUEST,
      entityId: before.id,
      diff: { employeeId: before.employeeId, status: { from: 'pending', to: status }, ...(note !== null && { decisionNote: note }) },
    });
    return changeRequestView(await this.row(before.id));
  }
}
