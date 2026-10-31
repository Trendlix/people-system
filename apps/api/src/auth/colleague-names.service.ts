import { Injectable, Logger } from '@nestjs/common';
import { colleagueNameSwap, seesFullNames, type NamedPerson } from '@trendlix/shared';
import { PrismaService } from '../prisma/prisma.service.js';

/** How long the people's names are kept: a new person, or a display name changed, shows within a minute. */
const PEOPLE_TTL_MS = 60_000;

const SAME = (text: string) => text;

/**
 * Everyone's names for colleagues' display names (owner, 31 October 2026: "for employees, make them see their coleagues
 * display names, not full names"; packages/shared colleague-names.ts): the employees' full names and display names, read
 * a minute at a time, and each viewer's swap made once a minute. If the names can't be read, the text is left as it is
 * (logged): a page still answers, with full names, rather than fail. Emails and WhatsApp messages too (owner, 31 October
 * 2026: "make mails and whatsapp use display names too"): by the roles of whom they go to (forRoles), or for an email by
 * whose address it is (forAddress): an account's, else an employee's work or personal email; anyone else's (a candidate,
 * an applicant) isn't staff, so gets display names too.
 */
@Injectable()
export class ColleagueNamesService {
  private readonly logger = new Logger(ColleagueNamesService.name);
  private people: { at: number; value: Promise<NamedPerson[]>; swaps: Map<string, (text: string) => string> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** The swap of colleagues' full names for their display names, for the person `selfId` (their own name stays). */
  async swapFor(selfId: string | null | undefined): Promise<(text: string) => string> {
    const now = Date.now();
    if (!this.people || now - this.people.at > PEOPLE_TTL_MS) {
      this.people = { at: now, value: this.prisma.employee.findMany({ select: { id: true, fullNameEn: true, fullNameAr: true, displayName: true } }), swaps: new Map() };
    }
    const held = this.people;
    try {
      const people = await held.value;
      const key = selfId ?? '';
      let swap = held.swaps.get(key);
      if (!swap) held.swaps.set(key, (swap = colleagueNameSwap(people, selfId)));
      return swap;
    } catch (err) {
      if (this.people === held) this.people = null;
      this.logger.warn(`The names for colleagues' display names could not be read: ${(err as Error).message}`);
      return SAME;
    }
  }

  /** The swap for someone with these roles and this profile; null for those who see full names. */
  async forRoles(roles: readonly string[], employeeId: string | null | undefined): Promise<((text: string) => string) | null> {
    return seesFullNames(roles) ? null : this.swapFor(employeeId);
  }

  /**
   * The swap for an email to `address`: by the account it is (its roles and profile), else the employee whose work or
   * personal email it is (their account's roles, if any), else nobody's in the company (display names, nobody's own);
   * null for those who see full names. The address can't be read: the text as it is (logged).
   */
  async forAddress(address: string): Promise<((text: string) => string) | null> {
    const email = address.trim().toLowerCase();
    try {
      const roleKeys = { select: { role: { select: { key: true } } } } as const;
      const account = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { employeeId: true, roles: roleKeys } });
      if (account) return this.forRoles(account.roles.map((r) => r.role.key), account.employeeId);
      const employee = await this.prisma.employee.findFirst({
        where: { OR: [{ workEmail: { equals: email, mode: 'insensitive' } }, { personalEmail: { equals: email, mode: 'insensitive' } }] },
        select: { id: true, account: { select: { roles: roleKeys } } },
      });
      return this.forRoles(employee?.account?.roles.map((r) => r.role.key) ?? [], employee?.id ?? null);
    } catch (err) {
      this.logger.warn(`Whose address an email goes to could not be read: ${(err as Error).message}`);
      return null;
    }
  }
}
