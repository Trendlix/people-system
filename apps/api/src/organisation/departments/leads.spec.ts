import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { approverFor, assertLeadChosen, clearLeads, defaultManagerId, leadIds, leadsOf, NO_LEADS } from './leads.js';

// Department heads and team leads read from the database (owner, 19 October 2026: "i want to add department lead
// person, the person in charge"): leads.ts, against a stand-in for the database.

type Person = { id: string; fullNameEn: string; employments: { id: string }[] };
const current = (id: string, fullNameEn: string): Person => ({ id, fullNameEn, employments: [{ id: `e-${id}` }] });
const former = (id: string, fullNameEn: string): Person => ({ id, fullNameEn, employments: [] });

const DAN = current('dan', 'Dan Head');
const TIA = current('tia', 'Tia Lead');
const units: Record<string, { head: Person | null; parent: { head: Person | null } | null }> = {
  marketing: { head: DAN, parent: null },
  content: { head: TIA, parent: { head: DAN } },
  design: { head: null, parent: { head: DAN } },
  finance: { head: null, parent: null },
  sales: { head: former('old', 'Old Head'), parent: null },
};
const people: Record<string, Person> = { dan: DAN, tia: TIA, old: former('old', 'Old Head') };

function fakeDb() {
  const updated: unknown[] = [];
  const db = {
    department: {
      findUnique: async ({ where }: { where: { id: string } }) => units[where.id] ?? null,
      findMany: async ({ where }: { where: { headId: string } }) => (where.headId === 'dan' ? [{ id: 'marketing', nameEn: 'Marketing' }] : []),
      updateMany: async (args: unknown) => {
        updated.push(args);
        return { count: 1 };
      },
    },
    employee: { findUnique: async ({ where }: { where: { id: string } }) => people[where.id] ?? null },
  };
  return { db: db as unknown as PrismaService, updated };
}

describe('leadsOf', () => {
  it('a team: its lead and its department’s head; a department: its head only', async () => {
    const { db } = fakeDb();
    expect(await leadsOf(db, 'content')).toEqual({ teamLead: { id: 'tia', fullNameEn: 'Tia Lead' }, departmentHead: { id: 'dan', fullNameEn: 'Dan Head' } });
    expect(await leadsOf(db, 'design')).toEqual({ teamLead: null, departmentHead: { id: 'dan', fullNameEn: 'Dan Head' } });
    expect(await leadsOf(db, 'marketing')).toEqual({ teamLead: null, departmentHead: { id: 'dan', fullNameEn: 'Dan Head' } });
  });

  it('no place, an unknown one, no lead, or a lead no longer employed: no one', async () => {
    const { db } = fakeDb();
    expect(await leadsOf(db, null)).toEqual(NO_LEADS);
    expect(await leadsOf(db, 'nowhere')).toEqual(NO_LEADS);
    expect(await leadsOf(db, 'finance')).toEqual(NO_LEADS);
    expect(await leadsOf(db, 'sales')).toEqual(NO_LEADS);
    expect(leadIds(await leadsOf(db, 'content'))).toEqual({ teamLeadId: 'tia', departmentHeadId: 'dan' });
  });
});

describe('approverFor', () => {
  it('the direct manager, else the team lead, else the head; never the requester; nobody: null', async () => {
    const { db } = fakeDb();
    expect(await approverFor(db, { employeeId: 'ben', managerId: 'mona', departmentId: 'content' })).toEqual({ employeeId: 'mona', role: 'direct_manager' });
    expect(await approverFor(db, { employeeId: 'ben', managerId: null, departmentId: 'content' })).toEqual({ employeeId: 'tia', role: 'team_lead' });
    expect(await approverFor(db, { employeeId: 'ben', managerId: 'ben', departmentId: 'design' })).toEqual({ employeeId: 'dan', role: 'department_head' });
    expect(await approverFor(db, { employeeId: 'tia', managerId: null, departmentId: 'content' })).toEqual({ employeeId: 'dan', role: 'department_head' });
    expect(await approverFor(db, { employeeId: 'dan', managerId: null, departmentId: 'marketing' })).toBeNull();
    expect(await approverFor(db, { employeeId: 'ben', managerId: null, departmentId: 'finance' })).toBeNull();
    expect(await approverFor(db, { employeeId: 'ben', managerId: null, departmentId: null })).toBeNull();
  });
});

describe('defaultManagerId', () => {
  it('hiring into a team: its lead, else its department’s head; never the person hired', async () => {
    const { db } = fakeDb();
    expect(await defaultManagerId(db, 'content', 'ben')).toBe('tia');
    expect(await defaultManagerId(db, 'design', 'ben')).toBe('dan');
    expect(await defaultManagerId(db, 'content', 'tia')).toBe('dan');
    expect(await defaultManagerId(db, 'marketing', 'dan')).toBeNull();
    expect(await defaultManagerId(db, 'finance', null)).toBeNull();
    expect(await defaultManagerId(db, undefined, 'ben')).toBeNull();
  });
});

describe('assertLeadChosen', () => {
  it('a current employee may lead; anyone else is refused, worded by level', async () => {
    const { db } = fakeDb();
    await expect(assertLeadChosen(db, 'tia', true)).resolves.toBeUndefined();
    await expect(assertLeadChosen(db, 'old', false)).rejects.toThrow(new BadRequestException("Old Head has no current employment, so they can't be the head of department. Choose a current employee."));
    await expect(assertLeadChosen(db, 'old', true)).rejects.toThrow(/can't be the team lead/);
    await expect(assertLeadChosen(db, 'ghost', true)).rejects.toThrow('Employee not found. Choose the team lead from the list.');
  });
});

describe('clearLeads', () => {
  it('the departments a person led are left without a lead, each in the audit log; none led: nothing', async () => {
    const { db, updated } = fakeDb();
    const entries: unknown[] = [];
    const audit = { record: async (entry: unknown) => void entries.push(entry) };
    await clearLeads(db, audit as never, 'dan', 'user-1');
    expect(updated).toEqual([{ where: { headId: 'dan' }, data: { headId: null } }]);
    expect(entries).toEqual([
      { userId: 'user-1', action: 'update', entityType: 'department', entityId: 'marketing', diff: { headId: { from: 'dan', to: null }, reason: 'employment_ended' } },
    ]);
    await clearLeads(db, audit as never, 'tia', 'user-1');
    expect(updated).toHaveLength(1);
    expect(entries).toHaveLength(1);
  });
});
