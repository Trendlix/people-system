import { BadRequestException } from '@nestjs/common';
import { approverInCharge, leadTitle, suggestedManager, type ApproverInCharge, type PlaceLeads } from '@trendlix/shared';
import type { AuditService } from '../../audit/audit.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

// Department heads and team leads (owner, 19 October 2026: "i want to add department lead person, the person in
// charge"): who is in charge of where someone works, read from the database, for the profile, hiring's default direct
// manager, and the approver of leave and reimbursements for someone without a direct manager. The rules themselves are
// packages/shared department-leads.ts. A lead counts only while they are a current employee (one with an employment
// that hasn't ended): their lead is cleared when their employment ends (clearLeads), and one left over is skipped.

type Db = PrismaService | Prisma.TransactionClient;

/** A lead as the profile names them. */
export interface LeadRef {
  id: string;
  fullNameEn: string;
}

/** The people in charge of where someone works: their team's lead and their department's head (none: null). */
export interface Leads {
  teamLead: LeadRef | null;
  departmentHead: LeadRef | null;
}

/** An employment that hasn't ended: what makes someone a current employee. */
const CURRENT = { where: { endDate: null }, select: { id: true }, take: 1 } as const;
const LEAD = { select: { id: true, fullNameEn: true, employments: CURRENT } } as const;

type LeadRow = { id: string; fullNameEn: string; employments: { id: string }[] } | null;
const current = (lead: LeadRow): LeadRef | null => (lead && lead.employments.length ? { id: lead.id, fullNameEn: lead.fullNameEn } : null);

export const NO_LEADS: Leads = { teamLead: null, departmentHead: null };

/** The leads of a department or team (none for no place): a team's lead and its department's head, or a department's head. */
export async function leadsOf(db: Db, departmentId: string | null | undefined): Promise<Leads> {
  if (!departmentId) return NO_LEADS;
  const unit = await db.department.findUnique({ where: { id: departmentId }, select: { head: LEAD, parent: { select: { head: LEAD } } } });
  if (!unit) return NO_LEADS;
  const unitLead = current(unit.head);
  return unit.parent ? { teamLead: unitLead, departmentHead: current(unit.parent.head) } : { teamLead: null, departmentHead: unitLead };
}

/** The leads by id, as the shared rules take them. */
export const leadIds = (leads: Leads): PlaceLeads => ({ teamLeadId: leads.teamLead?.id ?? null, departmentHeadId: leads.departmentHead?.id ?? null });

/**
 * Who decides the manager stage of a request from the employee: their direct manager, else their team lead, else their
 * department's head, never themself; null: straight to HR (approverInCharge).
 */
export async function approverFor(db: Db, who: { employeeId: string; managerId: string | null; departmentId: string | null }): Promise<ApproverInCharge | null> {
  // the direct manager first: the leads are only read when it can't decide
  if (who.managerId && who.managerId !== who.employeeId) return approverInCharge({ teamLeadId: null, departmentHeadId: null, managerId: who.managerId, requesterId: who.employeeId });
  return approverInCharge({ ...leadIds(await leadsOf(db, who.departmentId)), managerId: null, requesterId: who.employeeId });
}

/**
 * The direct manager someone hired into `departmentId` is given when none is chosen: its team lead, else its
 * department's head, never the person hired themself (`employeeId`; null for a person not made yet). Null: none.
 */
export async function defaultManagerId(db: Db, departmentId: string | null | undefined, employeeId: string | null): Promise<string | null> {
  return suggestedManager(leadIds(await leadsOf(db, departmentId)), employeeId)?.employeeId ?? null;
}

/**
 * The person chosen to lead a department or team must be a current employee (one with an employment that hasn't ended):
 * refused with 400 otherwise. `isTeam` words it by level.
 */
export async function assertLeadChosen(db: Db, headId: string, isTeam: boolean): Promise<void> {
  const title = leadTitle(isTeam).toLowerCase();
  const person = await db.employee.findUnique({ where: { id: headId }, select: { fullNameEn: true, employments: CURRENT } });
  if (!person) throw new BadRequestException(`Employee not found. Choose the ${title} from the list.`);
  if (!person.employments.length) {
    throw new BadRequestException(`${person.fullNameEn} has no current employment, so they can't be the ${title}. Choose a current employee.`);
  }
}

/**
 * When someone's employment ends they are no longer in charge: the departments they head and the teams they lead are
 * left without a lead until HR chooses another, each change in the audit log as a department change.
 */
export async function clearLeads(db: Db, audit: AuditService, employeeId: string, userId: string): Promise<void> {
  const led = await db.department.findMany({ where: { headId: employeeId }, select: { id: true, nameEn: true } });
  if (!led.length) return;
  await db.department.updateMany({ where: { headId: employeeId }, data: { headId: null } });
  for (const d of led) {
    await audit.record({ userId, action: 'update', entityType: 'department', entityId: d.id, diff: { headId: { from: employeeId, to: null }, reason: 'employment_ended' } });
  }
}
