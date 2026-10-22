import { accessStateOf, signInEmailOf, type AccessState } from '@trendlix/shared';
import { todayInCairo, toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// Who should have access, and where each employee stands (owner, 22 October 2026: "any active employee with active
// contract should have access"; packages/shared employee-access.ts). Shared by the Access tab, the Employees list's
// Access column and the sweep that makes the accounts. No DI: a Prisma client is passed in.

type Db = PrismaService | Prisma.TransactionClient;

/**
 * "An active employee with an active contract": a current employment (not ended, or ending today or later) with a
 * signed contract (active) in force today (started, and not past its end). A renewal waiting to be signed, a draft, or
 * a fixed term past its end isn't one.
 */
export function inForceEmployment(today: string = todayInCairo()): Prisma.EmploymentWhereInput {
  const day = toDateOnly(today);
  return {
    OR: [{ endDate: null }, { endDate: { gte: day } }],
    contracts: { some: { status: 'active', startDate: { lte: day }, OR: [{ endDate: null }, { endDate: { gte: day } }] } },
  };
}

/** Of these employees (all when left out), those with an active contract today. */
export async function eligibleIds(db: Db, employeeIds?: readonly string[], today: string = todayInCairo()): Promise<Set<string>> {
  const rows = await db.employee.findMany({
    where: { ...(employeeIds && { id: { in: [...employeeIds] } }), employments: { some: inForceEmployment(today) } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/** Why someone isn't eligible, in words, for the Access tab. */
export async function notEligibleReason(db: Db, employeeId: string, today: string = todayInCairo()): Promise<string> {
  const day = toDateOnly(today);
  const current = await db.employment.findFirst({
    where: { employeeId, OR: [{ endDate: null }, { endDate: { gte: day } }] },
    select: { id: true, contracts: { orderBy: { version: 'desc' }, take: 1, select: { status: true, startDate: true } } },
  });
  if (!current) return 'They have no current employment.';
  const c = current.contracts[0];
  if (!c) return 'Their employment has no contract yet.';
  if (c.status === 'draft') return 'Their contract isn’t signed yet.';
  if (c.status === 'active' && c.startDate > day) return 'Their contract starts later.';
  return 'Their contract isn’t in force today (a renewal to sign?).';
}

/** An employee as the access state reads them. */
export interface AccessPerson {
  id: string;
  workEmail: string | null;
  personalEmail: string | null;
  signInEmail: string | null;
}

/** Each employee's access state, and whether they have an active account without an active contract (by employee id). */
export async function accessStates(
  db: Db,
  people: readonly AccessPerson[],
  now: Date = new Date(),
): Promise<Map<string, { state: AccessState; withoutContract: boolean }>> {
  const out = new Map<string, { state: AccessState; withoutContract: boolean }>();
  if (!people.length) return out;
  const ids = people.map((p) => p.id);
  const [eligible, accounts] = await Promise.all([
    eligibleIds(db, ids),
    db.user.findMany({ where: { employeeId: { in: ids } }, select: { id: true, email: true, employeeId: true, isActive: true, passwordHash: true } }),
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
      { account: a && { isActive: a.isActive, passwordSet: !!a.passwordHash }, link: link ? { expiresAt: link.toISOString() } : null, eligible: eligible.has(p.id), email, clash },
      now.toISOString(),
    );
    out.set(p.id, { state, withoutContract: !!a && a.isActive && !eligible.has(p.id) });
  }
  return out;
}
