import { toDateOnly } from '../../common/date-only.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { firstDay, lastDay } from '../months.js';

// Who did what, and who can be paid what in a month, for Additions / Deductions and Unsettled (owner, 17 October 2026).

/** A user as these pages name them: by the employee whose work email they sign in with, else by the email. */
export interface UserRef {
  id: string;
  name: string;
}

/** The names of the users given, by id: the employee's English name for a sign-in that is their work email. */
export async function userNames(prisma: PrismaService, users: readonly ({ id: string; email: string } | null)[]): Promise<Map<string, UserRef>> {
  const known = users.filter((u): u is { id: string; email: string } => !!u);
  const emails = [...new Set(known.map((u) => u.email.toLowerCase()))];
  const people = emails.length
    ? await prisma.employee.findMany({ where: { workEmail: { in: emails } }, select: { workEmail: true, fullNameEn: true } })
    : [];
  const byEmail = new Map(people.map((p) => [p.workEmail!.toLowerCase(), p.fullNameEn]));
  return new Map(known.map((u) => [u.id, { id: u.id, name: byEmail.get(u.email.toLowerCase()) ?? u.email }]));
}

/** A user's ref from the names looked up, or null. */
export const refOf = (names: ReadonlyMap<string, UserRef>, user: { id: string } | null) => (user ? (names.get(user.id) ?? null) : null);

/** The employments that are in a month (YYYY-MM): joined by its last day, not ended before its first. */
export const employedIn = (month: string): Prisma.EmploymentWhereInput => ({
  joinDate: { lte: toDateOnly(lastDay(month)) },
  OR: [{ endDate: null }, { endDate: { gte: toDateOnly(firstDay(month)) } }],
});

/** Where someone works, as a payroll line names it: a team as "Department › Team". */
export function placeName(d: { nameEn: string; parent: { nameEn: string } | null } | null): string | null {
  if (!d) return null;
  return d.parent ? `${d.parent.nameEn} › ${d.nameEn}` : d.nameEn;
}

const piastres = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** An amount as a message says it, always with two decimals (owner, 16 October 2026): 16700 → "EGP 16,700.00". */
export const egp = (amount: number) => `EGP ${piastres.format(amount)}`;
