import { CONFIRM_FIELDS, CONFIRM_FIELD_KEYS, type ChangeRequestStatus, type ConfirmField } from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import type { Employee, Prisma } from '../generated/prisma/client.js';

// The employee's own check of their details as the API sends it (owner's decision, 15 October 2026). Used by the
// confirmations module and by the employee profile, which shows the confirmation and the change requests.

/**
 * A confirmed field's value as compared, stored and shown: text and numbers as saved, dates as YYYY-MM-DD, empty as null;
 * a switch (still studying: owner, 25 October 2026) as true or false.
 */
export type ConfirmValue = string | number | boolean | null;

/** The confirmed fields' values, as a confirmation keeps them. */
export type Snapshot = Record<ConfirmField, ConfirmValue>;

/** One field of a change request: the value when it was asked for, and the value asked for. */
export interface Change {
  field: ConfirmField;
  from: ConfirmValue;
  to: ConfirmValue;
}

/** A value as confirmations compare it: a date as YYYY-MM-DD, and nothing (or empty text) as null. */
export function confirmValue(value: unknown): ConfirmValue {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return fromDateOnly(value);
  return value as string | number | boolean;
}

/** The same value confirmed and now: a switch turned off is the same as one confirmed before it existed (null). */
const same = (a: ConfirmValue, b: ConfirmValue) => a === b || ((a === null || a === false) && (b === null || b === false));

/** The confirmed fields' values on the profile now. */
export function snapshotOf(e: Employee): Snapshot {
  return Object.fromEntries(CONFIRM_FIELD_KEYS.map((key) => [key, confirmValue(e[key])])) as Snapshot;
}

/**
 * The fields whose value now differs from the one confirmed, in CONFIRM_FIELDS order. A field added to CONFIRM_FIELDS
 * after the confirmation counts as confirmed empty (a switch: off).
 */
export function changedFields(confirmed: Partial<Snapshot>, now: Snapshot): ConfirmField[] {
  return CONFIRM_FIELD_KEYS.filter((key) => !same(confirmValue(confirmed[key]), now[key]));
}

/** What a confirmation is shown with: who confirmed. */
export const CONFIRMATION_INCLUDE = { user: { select: { email: true } } } satisfies Prisma.ProfileConfirmationInclude;

export type ConfirmationRow = Prisma.ProfileConfirmationGetPayload<{ include: typeof CONFIRMATION_INCLUDE }>;

/**
 * Where the employee's confirmation stands, from their latest one: up to date while every confirmed field still has
 * the value confirmed (an HR edit makes it stale; changing the field back makes it up to date again). Never
 * confirmed: no date, not up to date, and no changed fields.
 */
export function confirmationView(latest: ConfirmationRow | null, e: Employee) {
  if (!latest) return { confirmedAt: null, confirmedBy: null, upToDate: false, changedFields: [], disclaimerVersion: null };
  const changed = changedFields(latest.snapshot as Partial<Snapshot>, snapshotOf(e));
  return {
    confirmedAt: latest.confirmedAt,
    confirmedBy: { email: latest.user.email },
    upToDate: changed.length === 0,
    changedFields: changed,
    disclaimerVersion: latest.disclaimerVersion,
  };
}

export type ConfirmationView = ReturnType<typeof confirmationView>;

const LABELS = new Map<string, string>(CONFIRM_FIELDS.map((f) => [f.key, f.label]));

/** What a change request is shown with: whose profile it is, who asked, and who decided. */
export const REQUEST_INCLUDE = {
  employee: { select: { id: true, employeeCode: true, fullNameEn: true } },
  requestedBy: { select: { email: true } },
  decidedBy: { select: { email: true } },
} satisfies Prisma.ProfileChangeRequestInclude;

export type RequestRow = Prisma.ProfileChangeRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

/** A change request, each change with its field's label; values as saved (dates YYYY-MM-DD, codes such as gender as stored). */
export function changeRequestView(r: RequestRow) {
  return {
    id: r.id,
    employee: r.employee,
    changes: (r.changes as unknown as Change[]).map((c) => ({ field: c.field, label: LABELS.get(c.field) ?? c.field, from: c.from, to: c.to })),
    note: r.note,
    status: r.status as ChangeRequestStatus,
    requestedBy: { email: r.requestedBy.email },
    requestedAt: r.requestedAt,
    decidedBy: r.decidedBy && { email: r.decidedBy.email },
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
  };
}

export type ChangeRequestView = ReturnType<typeof changeRequestView>;
