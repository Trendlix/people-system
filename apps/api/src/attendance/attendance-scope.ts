import { approverInCharge } from '@trendlix/shared';
import { actsAs } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// Whose attendance each person sees (owner's brief, 19 October 2026: the Attendance section): HR, the CEO and Finance
// everyone's (Finance read only, as there is nothing to change there), a C-level person's only the CEO, the Super Admin
// and the person themself (ConfidentialService); a manager or a lead their team's, as My Team decides it; everyone their
// own. Hiding a page is the web's convenience: these decide every request.

/** HR, the CEO and Finance see everyone's attendance. */
export const seesEveryonesAttendance = (user: SessionUser) => actsAs(user.roles, ['hr', 'ceo', 'finance']);

/** A current employment: one that hasn't ended. */
const CURRENT = { endDate: null } as const;

/**
 * The people whose attendance a manager or a lead sees (owner's brief, 19 October 2026: "follow how My Team decides who
 * is shown"): their direct reports now (whose current employment names them its direct manager: My Team's people), and
 * the people without a direct manager of a team they lead or a department they head, whose leave and claims they decide
 * (owner, 19 October 2026: "i want to add department lead person, the person in charge"; packages/shared
 * approverInCharge: the team's lead, else the department's head, never the person themself). Never themself.
 */
export async function teamOf(db: PrismaService, me: string): Promise<string[]> {
  const direct = await db.employment.findMany({ where: { ...CURRENT, managerId: me, employeeId: { not: me } }, select: { employeeId: true } });
  const team = new Set(direct.map((d) => d.employeeId));

  // the departments and teams they are in charge of, and a department's teams with it (their people without a manager
  // go to the team's lead first, else to the department's head)
  const led = await db.department.findMany({ where: { headId: me }, select: { id: true, children: { select: { id: true } } } });
  const units = [...new Set(led.flatMap((d) => [d.id, ...d.children.map((c) => c.id)]))];
  if (units.length) {
    const lead = { select: { id: true, employments: { where: CURRENT, select: { id: true }, take: 1 } } } as const;
    const unmanaged = await db.employment.findMany({
      where: { ...CURRENT, departmentId: { in: units }, employeeId: { not: me }, OR: [{ managerId: null }, { managerId: { equals: db.employment.fields.employeeId } }] },
      select: { employeeId: true, department: { select: { head: lead, parent: { select: { head: lead } } } } },
    });
    // a lead counts while a current employee (organisation/departments/leads.ts)
    const current = (h: { id: string; employments: { id: string }[] } | null) => (h && h.employments.length ? h.id : null);
    for (const u of unmanaged) {
      const unit = u.department;
      if (!unit) continue;
      const leads = unit.parent
        ? { teamLeadId: current(unit.head), departmentHeadId: current(unit.parent.head) }
        : { teamLeadId: null, departmentHeadId: current(unit.head) };
      if (approverInCharge({ ...leads, managerId: null, requesterId: u.employeeId })?.employeeId === me) team.add(u.employeeId);
    }
  }
  return [...team];
}
