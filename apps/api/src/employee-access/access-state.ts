import {
  accessStandingOf,
  accessStateOf,
  SIGNED_CONTRACT_STATUSES,
  signInEmailOf,
  type AccessStandingInput,
  type AccessStandingResult,
  type RowAccessView,
} from '@trendlix/shared';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// Who should have access, and where each employee stands (owner, 22 October 2026: "any active employee with active
// contract should have access"; then, 23 October 2026, "Active - Grace - Hold - No Access": packages/shared
// employee-access.ts). Shared by the Access tab, the Employees list's Access column, the sweep that makes the accounts
// and records the standings, and the guard that holds a session. No DI: a Prisma client is passed in.

type Db = PrismaService | Prisma.TransactionClient;

const SIGNED = [...SIGNED_CONTRACT_STATUSES];

/** A current employment on `day`: not ended, or ending that day or later. */
const currentOn = (day: Date): Prisma.EmploymentWhereInput => ({ OR: [{ endDate: null }, { endDate: { gte: day } }] });

/**
 * "An active employee with an active contract": a current employment (not ended, or ending today or later) with a
 * signed contract in force today (a signed version started, and not past its end). A version replaced by a later one
 * signed ahead of its start (a renewal, a raise from the 1st of next month) is in force until that one starts: its
 * status is superseded from the signing (23 October 2026: so it is read as signed, as payroll reads it). A renewal
 * waiting to be signed, a draft, or a fixed term past its end isn't one.
 */
export function inForceEmployment(today: string = todayInCairo()): Prisma.EmploymentWhereInput {
  const day = toDateOnly(today);
  return {
    ...currentOn(day),
    contracts: { some: { status: { in: SIGNED }, startDate: { lte: day }, OR: [{ endDate: null }, { endDate: { gte: day } }] } },
  };
}

/**
 * Who gets an account: a current employment whose contract was signed and has started, in force today (Active) or not
 * any more (Grace, Hold: owner, 23 October 2026, "Check-in/out only" on Hold, so they keep an account to check in and
 * out with). A new hire's draft, or a contract starting later, gives none yet.
 */
export function accountableEmployment(today: string = todayInCairo()): Prisma.EmploymentWhereInput {
  const day = toDateOnly(today);
  return { ...currentOn(day), contracts: { some: { status: { in: SIGNED }, startDate: { lte: day } } } };
}

/** Of these employees (all when left out), those with an active contract today. */
export async function eligibleIds(db: Db, employeeIds?: readonly string[], today: string = todayInCairo()): Promise<Set<string>> {
  const rows = await db.employee.findMany({
    where: { ...(employeeIds && { id: { in: [...employeeIds] } }), employments: { some: inForceEmployment(today) } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/** Of these employees (all when left out), those who get an account: Active, Grace or Hold by their contract. */
export async function accountableIds(db: Db, employeeIds?: readonly string[], today: string = todayInCairo()): Promise<Set<string>> {
  const rows = await db.employee.findMany({
    where: { ...(employeeIds && { id: { in: [...employeeIds] } }), employments: { some: accountableEmployment(today) } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/** Why someone isn't eligible, in words, for the Access tab. */
export async function notEligibleReason(db: Db, employeeId: string, today: string = todayInCairo()): Promise<string> {
  const day = toDateOnly(today);
  const current = await db.employment.findFirst({
    where: { employeeId, ...currentOn(day) },
    select: { id: true, contracts: { orderBy: { version: 'desc' }, take: 1, select: { status: true, startDate: true } } },
  });
  if (!current) return 'They have no current employment.';
  const c = current.contracts[0];
  if (!c) return 'Their employment has no contract yet.';
  if (c.status === 'draft') return 'Their contract isn’t signed yet.';
  if (c.status === 'active' && c.startDate > day) return 'Their contract starts later.';
  return 'Their contract isn’t in force today (a renewal to sign?).';
}

// ---------- the standing ----------

/** What an employee's standing is read with, in one query: their account, the current employment's signed versions, the graces. */
export function standingSelect(today: string) {
  return {
    id: true,
    account: { select: { id: true, isActive: true, roles: { select: { role: { select: { key: true } } } } } },
    employments: {
      where: currentOn(toDateOnly(today)),
      // at most one is current (the API checks it); the one without an end first
      orderBy: [{ endDate: { sort: 'desc', nulls: 'first' } }, { joinDate: 'desc' }],
      take: 1,
      select: {
        id: true,
        contracts: { where: { status: { in: SIGNED } }, select: { id: true, number: true, status: true, startDate: true, endDate: true, version: true } },
      },
    },
    accessGraces: { select: { id: true, contractId: true, employmentId: true, until: true, grantedAt: true, grantedById: true, remindedAt: true } },
    // no contract entered (23 October 2026: "Hold them after 7 days"): the day first recorded, and whether they were
    // ever employed (with no current employment: they left, else never employed)
    noContractSince: true,
    _count: { select: { employments: true } },
  } satisfies Prisma.EmployeeSelect;
}

export type StandingRow = Prisma.EmployeeGetPayload<{ select: ReturnType<typeof standingSelect> }>;

/** The pure standing's input from a row (packages/shared accessStandingOf). */
export function standingInputOf(row: StandingRow): AccessStandingInput {
  const e = row.employments[0];
  return {
    account: row.account && { isActive: row.account.isActive, roles: row.account.roles.map((r) => r.role.key) },
    employment: e
      ? {
          id: e.id,
          contracts: e.contracts.map((c) => ({ id: c.id, status: c.status, startDate: fromDateOnly(c.startDate), endDate: fromDateOnly(c.endDate), version: c.version })),
        }
      : null,
    graces: row.accessGraces.map((g) => ({ contractId: g.contractId, employmentId: g.employmentId, until: fromDateOnly(g.until), grantedAt: g.grantedAt.toISOString() })),
    everEmployed: row._count.employments > 0,
    noContractSince: fromDateOnly(row.noContractSince),
  };
}

/** An employee's standing, with the row it was read from (their contract numbers, who gave a grace). */
export interface Standing {
  result: AccessStandingResult;
  row: StandingRow;
}

/** The standing of these employees on `today`, by employee id (one missing from the database left out). */
export async function standingsOf(db: Db, employeeIds: readonly string[], today: string = todayInCairo()): Promise<Map<string, Standing>> {
  const out = new Map<string, Standing>();
  if (!employeeIds.length) return out;
  const rows = await db.employee.findMany({ where: { id: { in: [...new Set(employeeIds)] } }, select: standingSelect(today) });
  for (const row of rows) out.set(row.id, { result: accessStandingOf(standingInputOf(row), today), row });
  return out;
}

/** One employee's standing on `today`; null when there is no such employee. */
export async function standingOf(db: Db, employeeId: string, today: string = todayInCairo()): Promise<Standing | null> {
  return (await standingsOf(db, [employeeId], today)).get(employeeId) ?? null;
}

// ---------- the account's state ----------

/** An employee as the access state reads them. */
export interface AccessPerson {
  id: string;
  workEmail: string | null;
  personalEmail: string | null;
  signInEmail: string | null;
}

/**
 * Each employee's access: the account's state (whether one should be made, invited, set up …), their standing
 * (Active, Grace, Hold, No Access) and a grace's last day while on Grace, by employee id.
 */
export async function accessStates(db: Db, people: readonly AccessPerson[], now: Date = new Date(), today: string = todayInCairo()): Promise<Map<string, RowAccessView>> {
  const out = new Map<string, RowAccessView>();
  if (!people.length) return out;
  const ids = people.map((p) => p.id);
  const [accountable, accounts, standings] = await Promise.all([
    accountableIds(db, ids, today),
    db.user.findMany({ where: { employeeId: { in: ids } }, select: { id: true, email: true, employeeId: true, isActive: true, passwordHash: true } }),
    standingsOf(db, ids, today),
  ]);
  const accountOf = new Map(accounts.map((a) => [a.employeeId!, a]));
  const waiting = await db.accessLink.findMany({
    where: { userId: { in: accounts.map((a) => a.id) }, usedAt: null, cancelledAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
    select: { userId: true, expiresAt: true },
  });
  const linkOf = new Map<string, Date>();
  for (const l of waiting) if (!linkOf.has(l.userId)) linkOf.set(l.userId, l.expiresAt);
  // the emails wanted by those without an account, and the accounts that already have them
  const wanted = new Map<string, string>();
  for (const p of people) {
    if (accountOf.has(p.id)) continue;
    const e = signInEmailOf(p);
    if (e) wanted.set(p.id, e.email);
  }
  const taken = wanted.size ? await db.user.findMany({ where: { email: { in: [...new Set(wanted.values())] } }, select: { email: true, employeeId: true } }) : [];
  const takenBy = new Map(taken.map((t) => [t.email.toLowerCase(), t.employeeId]));
  for (const p of people) {
    const a = accountOf.get(p.id) ?? null;
    const email = a ? a.email : (wanted.get(p.id) ?? null);
    const owner = !a && email ? takenBy.get(email) : undefined;
    // an account with the email, linked to someone else (an unlinked one is taken over by the sweep: no clash)
    const clash = owner !== undefined && owner !== null && owner !== p.id;
    const link = a ? linkOf.get(a.id) : undefined;
    const state = accessStateOf(
      { account: a && { isActive: a.isActive, passwordSet: !!a.passwordHash }, link: link ? { expiresAt: link.toISOString() } : null, eligible: accountable.has(p.id), email, clash },
      now.toISOString(),
    );
    const s = standings.get(p.id)?.result;
    out.set(p.id, {
      state,
      standing: s?.standing ?? 'no_access',
      graceUntil: s?.standing === 'grace' ? s.grace!.until : null,
      noContract: s?.noContract ? { since: s.noContract.since, holdFrom: s.noContract.holdFrom } : null,
    });
  }
  return out;
}
