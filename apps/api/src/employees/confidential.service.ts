import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { isConfidentialGrade, seesConfidential, setsConfidentialGrade } from '@trendlix/shared';
import type { SessionUser } from '../auth/session-user.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The database, or a transaction in it. */
type Db = PrismaService | Prisma.TransactionClient;

/** Newest first, the current employment (no end date) before all ended ones: as the profile orders them. */
const NEWEST_FIRST = [{ endDate: { sort: 'desc', nulls: 'first' } }, { joinDate: 'desc' }] satisfies Prisma.EmploymentOrderByWithRelationInput[];

/** Why a C-level grade is refused: someone who doesn't see C-level people would hide or unhide a person by it. */
export const CONFIDENTIAL_GRADE_REFUSED = 'Only the CEO or a Super Admin sees C-level people, so only they give a C-level grade (or a user with HR and Super Admin).';

/**
 * Who is C-level, and whom that hides from the caller (owner, 19 October 2026: "make C level Employees details not
 * visible to HR"). C-level is everyone whose current employment, else their latest one (a former C-level person stays
 * one, their pay history with them), has a confidential grade (G9 · Executive: Grade.confidential), so it follows the
 * grade: changing someone's grade changes it. Hidden from everyone but the CEO, a Super Admin and the person themself
 * (packages/shared seesConfidential): those get only their directory card from GET /employees and GET /employees/:id,
 * and 404 for every record of their personal or pay data, as for anyone they may not see, so its existence isn't
 * confirmed. One helper for every module: the routes about one person's record ask ConfidentialGuard, the lists filter
 * with hiddenFrom / employeeWhere / ownedWhere, and the services check again where a route can't (a file upload's form).
 */
@Injectable()
export class ConfidentialService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every C-level person's employee id. A handful of people: read afresh on each request, so a grade change counts at once. */
  async ids(db: Db = this.prisma): Promise<Set<string>> {
    const rows = await db.employee.findMany({
      where: { employments: { some: { grade: { confidential: true } } } },
      select: { id: true, employments: { orderBy: NEWEST_FIRST, take: 1, select: { grade: { select: { confidential: true } } } } },
    });
    return new Set(rows.filter((r) => isConfidentialGrade(r.employments[0]?.grade)).map((r) => r.id));
  }

  /** Whether this person is C-level, whoever asks. */
  async isConfidential(employeeId: string): Promise<boolean> {
    return (await this.ids()).has(employeeId);
  }

  /** The caller's own employee profile: the one whose work email they sign in with, if any. */
  async selfId(user: SessionUser): Promise<string | null> {
    const me = await this.prisma.employee.findUnique({ where: { workEmail: user.email.toLowerCase() }, select: { id: true } });
    return me?.id ?? null;
  }

  /** The C-level people hidden from the caller: none for the CEO and a Super Admin; never the caller themself. */
  async hiddenFrom(user: SessionUser): Promise<string[]> {
    if (seesConfidential(user)) return [];
    const ids = await this.ids();
    if (!ids.size) return [];
    const self = await this.selfId(user);
    if (self) ids.delete(self);
    return [...ids];
  }

  /** The same as a set, with whether the caller sees every C-level person, for the services that ask per row. */
  async view(user: SessionUser): Promise<ConfidentialView> {
    if (seesConfidential(user)) return { sees: true, all: await this.ids(), hidden: new Set() };
    const all = await this.ids();
    const self = all.size ? await this.selfId(user) : null;
    return { sees: false, all, hidden: new Set([...all].filter((id) => id !== self)) };
  }

  /** The employees the caller may see in full, as a Prisma filter on employees: those not hidden from them. */
  async employeeWhere(user: SessionUser): Promise<Prisma.EmployeeWhereInput> {
    const hidden = await this.hiddenFrom(user);
    return hidden.length ? { id: { notIn: hidden } } : {};
  }

  /** The same for any record of a person (a contract's employment, a payroll line, a claim …): by its employeeId. */
  async ownedWhere(user: SessionUser): Promise<{ employeeId?: { notIn: string[] } }> {
    const hidden = await this.hiddenFrom(user);
    return hidden.length ? { employeeId: { notIn: hidden } } : {};
  }

  /** Whether this person's details are hidden from the caller. */
  async isHidden(user: SessionUser, employeeId: string): Promise<boolean> {
    if (seesConfidential(user)) return false;
    if (!(await this.ids()).has(employeeId)) return false;
    return (await this.selfId(user)) !== employeeId;
  }

  /** 404, as for anyone the caller may not see, when this person's details are hidden from them. */
  async assertVisible(user: SessionUser, employeeId: string, message = 'Employee not found.'): Promise<void> {
    if (await this.isHidden(user, employeeId)) throw new NotFoundException(message);
  }

  /**
   * The job offers the caller may see (owner, 19 October 2026): not one for a C-level grade, nor one made to a C-level
   * person (a former employee offered again, or the person hired from it), for anyone but the CEO and a Super Admin. An
   * offer's grade and person are optional: one without them is never hidden.
   */
  async offerWhere(user: SessionUser): Promise<Prisma.JobOfferWhereInput> {
    if (seesConfidential(user)) return {};
    const hidden = await this.hiddenFrom(user);
    return {
      AND: [
        { OR: [{ gradeId: null }, { grade: { confidential: false } }] },
        ...(hidden.length ? [{ OR: [{ employeeId: null }, { employeeId: { notIn: hidden } }] }] : []),
      ],
    };
  }

  /** Whether a job offer is hidden from the caller (offerWhere): 404 for them. */
  async assertOfferVisible(user: SessionUser, offerId: string): Promise<void> {
    if (seesConfidential(user)) return;
    const visible = await this.prisma.jobOffer.count({ where: { AND: [{ id: offerId }, await this.offerWhere(user)] } });
    if (!visible) throw new NotFoundException('Job offer not found.');
  }

  /**
   * A C-level grade is given (on an employment, a hire, a job offer, a raise's promotion) only by those who see C-level
   * people (owner, 19 October 2026: else HR could hide or unhide someone by their grade): 403 for anyone else. Null or
   * undefined: no grade is being given.
   */
  async assertMayGiveGrade(user: SessionUser, gradeId: string | null | undefined): Promise<void> {
    if (!gradeId || setsConfidentialGrade(user)) return;
    const grade = await this.prisma.grade.findUnique({ where: { id: gradeId }, select: { confidential: true } });
    if (isConfidentialGrade(grade)) throw new ForbiddenException(CONFIDENTIAL_GRADE_REFUSED);
  }
}

/** Who is C-level, and who of them is hidden from the caller (`sees`: the caller sees them all). */
export interface ConfidentialView {
  sees: boolean;
  /** Every C-level person. */
  all: ReadonlySet<string>;
  /** Those hidden from the caller: all but themself, or none. */
  hidden: ReadonlySet<string>;
}

/** Nobody hidden: for code that runs for no caller (the system), or before anyone is C-level. */
export const NONE_HIDDEN: ConfidentialView = { sees: true, all: new Set(), hidden: new Set() };
