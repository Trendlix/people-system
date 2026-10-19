import { directRequestFields, type RaiseRequestStatus } from '@trendlix/shared';
import type { AuditEntry } from '../audit/audit.service.js';
import { fromDateOnly, toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { recordStep, stepFigures } from './raise-request-steps.js';

// A raise HR prepares directly has its raise request (owner, 19 October 2026: "when a raise request was sent to the CEO,
// is showed in approvals not raise requests, and after approved, it was not shown in the raise request history too"):
// whenever a version gets the CEO's step for a change of pay without a request it was prepared from (a raise entered on
// the contract in force, RaisesService.create; a renewal with new pay, ContractsService.draft and .update), it gets one
// prepared directly by HR, in the same transaction, linked by its contract: by HR, with the raise's reason, its note as
// the comment (else "Prepared directly by HR"), the raise as suggested and its effective date (directRequestFields),
// logged as prepared. From then on it follows its raise as an asked one does (sent, returned, the CEO's decision, signed:
// RaisesService and ContractsService move every linked request), so Raise Requests has every raise at every stage. While
// HR changes the draft its figures follow it; it goes when the raise stops changing the pay, or its draft is deleted (it
// would point at nothing: nobody asked for it). The audit log has each, the amounts only as set.

const ENTITY = 'raise_request';

/** The database, or a transaction in it. */
type Db = PrismaService | Prisma.TransactionClient;

/** The version a direct request is made from: the one with the CEO's step, and its person. */
export interface DirectRaise {
  id: string;
  employeeId: string;
  employmentId: string;
  number: string;
  kind: string;
  startDate: Date;
  grossSalary: Prisma.Decimal;
  raiseReason: string | null;
  note: string | null;
  approval: string | null;
}

/** Where a direct request stands by its raise's CEO step, as an asked one would: with HR, with the CEO, approved. */
export function directStatusOf(approval: string | null): RaiseRequestStatus {
  return approval === 'pending_ceo' ? 'with_ceo' : approval === 'approved' ? 'approved' : 'with_hr';
}

/** A direct request's fields from its raise, as Prisma writes them. */
function fieldsOf(raise: DirectRaise, previousGross: number) {
  const f = directRequestFields({ raiseReason: raise.raiseReason ?? 'other', note: raise.note, grossSalary: raise.grossSalary.toNumber(), startDate: fromDateOnly(raise.startDate)! }, previousGross);
  return { ...f, effectiveFrom: toDateOnly(f.effectiveFrom) };
}

/**
 * Gives a version with the CEO's step and no request its request, prepared directly by `userId` (HR), logged as
 * prepared with the raise's way, date, number and figures over `previousGross` (the gross of the version it replaces).
 * Answers its id and the audit entry, which the caller records once the transaction is saved.
 */
export async function openDirectRequest(db: Db, raise: DirectRaise, previousGross: number, userId: string): Promise<{ id: string; audit: AuditEntry }> {
  const fields = fieldsOf(raise, previousGross);
  const status = directStatusOf(raise.approval);
  const made = await db.raiseRequest.create({
    data: { employeeId: raise.employeeId, employmentId: raise.employmentId, requestedById: userId, requester: 'hr', origin: 'direct', ...fields, status, contractId: raise.id },
    select: { id: true },
  });
  const effectiveDate = fromDateOnly(raise.startDate);
  await recordStep(db, made.id, userId, {
    kind: 'prepared',
    raiseReason: fields.raiseReason,
    comment: fields.comment,
    way: raise.kind === 'amendment' ? 'amendment' : 'contract',
    effectiveDate,
    contractNumber: raise.number,
    ...stepFigures(previousGross, raise.grossSalary.toNumber()),
  });
  return {
    id: made.id,
    audit: {
      userId,
      action: 'create',
      entityType: ENTITY,
      entityId: made.id,
      // an amount only as set (restricted, as the contracts module logs salaries)
      diff: {
        employeeId: raise.employeeId,
        origin: 'direct',
        requester: 'hr',
        contract: raise.number,
        raiseReason: fields.raiseReason,
        comment: fields.comment,
        effectiveFrom: effectiveDate,
        status,
        ...(fields.suggestedIncrease !== null && { suggestedIncrease: 'set' }),
      },
    },
  };
}

/** A direct request follows its draft as HR changes it: the reason, the comment from the note, the figures, the date. */
export async function syncDirectRequest(db: Db, requestId: string, raise: DirectRaise, previousGross: number): Promise<void> {
  await db.raiseRequest.update({ where: { id: requestId }, data: fieldsOf(raise, previousGross) });
}

/**
 * A direct request goes with its raise (its draft deleted, or no longer changing the pay): it was never asked for, so
 * nothing is left to decide. Answers the audit entry for the caller to record.
 */
export async function dropDirectRequest(db: Db, requestId: string, raise: Pick<DirectRaise, 'employeeId' | 'number'>, userId: string, why: 'raise_deleted' | 'no_pay_change'): Promise<AuditEntry> {
  await db.raiseRequest.delete({ where: { id: requestId } });
  return { userId, action: 'delete', entityType: ENTITY, entityId: requestId, diff: { employeeId: raise.employeeId, origin: 'direct', contract: raise.number, why } };
}
