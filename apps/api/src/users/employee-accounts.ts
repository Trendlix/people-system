import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// An employee's sign-in account is the one linked to them (users.employee_id; owner, 22 October 2026: "any active
// employee with active contract should have access"), never the one sharing their work email: the email they sign in
// with may be their personal one, and either may change. These are the lookups everything else uses.

type Db = PrismaService | Prisma.TransactionClient;

const ACCOUNT = { id: true, email: true, isActive: true, roles: { select: { role: { select: { key: true } } } } } as const satisfies Prisma.UserSelect;

export type EmployeeAccount = Prisma.UserGetPayload<{ select: typeof ACCOUNT }>;

/** The account of an employee, with its roles; null without one. */
export function accountOfEmployee(db: Db, employeeId: string | null | undefined): Promise<EmployeeAccount | null> {
  if (!employeeId) return Promise.resolve(null);
  return db.user.findUnique({ where: { employeeId }, select: ACCOUNT });
}

/** The active accounts of these employees: user id by employee id (an employee without one left out). */
export async function activeAccountsOf(db: Db, employeeIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(employeeIds)];
  if (!ids.length) return new Map();
  const rows = await db.user.findMany({ where: { employeeId: { in: ids }, isActive: true }, select: { id: true, employeeId: true } });
  return new Map(rows.map((r) => [r.employeeId!, r.id]));
}

/**
 * The names of these accounts' people, from the profiles they are linked to, by the account's email in lower case (for
 * the pages that name who did something by their email); an account without a profile left out.
 */
export async function namesByAccountEmail(db: Db, emails: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(emails.map((e) => e.toLowerCase()))];
  if (!wanted.length) return new Map();
  const rows = await db.user.findMany({
    where: { email: { in: wanted }, employee: { isNot: null } },
    select: { email: true, employee: { select: { fullNameEn: true } } },
  });
  return new Map(rows.map((r) => [r.email.toLowerCase(), r.employee!.fullNameEn]));
}
