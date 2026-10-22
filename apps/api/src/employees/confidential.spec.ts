import { ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@trendlix/shared';
import type { SessionUser } from '../auth/session-user.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CONFIDENTIAL_CHECKS, ConfidentialGuard } from './confidential.guard.js';
import { ConfidentialService } from './confidential.service.js';

// C-level people kept from HR (owner, 19 October 2026: "make C level Employees details not visible to HR"): who is
// C-level (their current employment's grade, else their latest's), whom that hides from the caller, and the guard of
// the routes about one person's record (404, as for a record that isn't there).

// a session carries its account's link to the profile (22 October 2026): the person whose work email it is, here
const user = (roles: Role[], email = 'someone@trendlix.com'): SessionUser => ({ id: 'u', email, roles, employeeId: PEOPLE.find((p) => p.email === email)?.id ?? null });

/** Employees with their employments newest first, as the service reads them; `email`: their work email. */
const PEOPLE = [
  // the CEO: G9 now
  { id: 'ceo-1', email: 'ceo@trendlix.com', employments: [{ grade: { confidential: true } }] },
  // was G9, now G5: no longer C-level (the current employment's grade counts)
  { id: 'demoted', email: 'demoted@trendlix.com', employments: [{ grade: { confidential: false } }, { grade: { confidential: true } }] },
  // left as G9: stays C-level, with their pay history
  { id: 'former', email: 'former@trendlix.com', employments: [{ grade: { confidential: true } }] },
];

function prismaStub() {
  return {
    employee: {
      findMany: async () => PEOPLE.map((p) => ({ id: p.id, employments: p.employments.slice(0, 1) })),
      // their own profile is found by their account's link (22 October 2026)
      findUnique: async ({ where }: { where: { id: string } }) => {
        const p = PEOPLE.find((x) => x.id === where.id);
        return p ? { id: p.id } : null;
      },
    },
    grade: { findUnique: async ({ where }: { where: { id: string } }) => ({ confidential: where.id === 'g9' }) },
    contract: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === '11111111-1111-4111-8111-111111111111' ? { employment: { employeeId: 'ceo-1' } } : null) },
  } as unknown as PrismaService;
}

describe('ConfidentialService', () => {
  const service = new ConfidentialService(prismaStub());

  it('takes C-level from the current (else the latest) employment’s grade', async () => {
    expect([...(await service.ids())].sort()).toEqual(['ceo-1', 'former']);
    expect(await service.isConfidential('demoted')).toBe(false);
  });

  it('hides them from HR, Finance and Admin, not from the CEO, a Super Admin or themself', async () => {
    expect((await service.hiddenFrom(user(['hr']))).sort()).toEqual(['ceo-1', 'former']);
    expect(await service.hiddenFrom(user(['finance', 'admin']))).toHaveLength(2);
    expect(await service.hiddenFrom(user(['ceo']))).toEqual([]);
    expect(await service.hiddenFrom(user(['super_admin']))).toEqual([]);
    // the former C-level person signing in sees their own, not the CEO's
    expect(await service.hiddenFrom(user(['employee'], 'former@trendlix.com'))).toEqual(['ceo-1']);
    expect(await service.isHidden(user(['hr']), 'ceo-1')).toBe(true);
    expect(await service.isHidden(user(['hr']), 'demoted')).toBe(false);
    await expect(service.assertVisible(user(['hr']), 'ceo-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.assertVisible(user(['ceo']), 'ceo-1')).resolves.toBeUndefined();
  });

  it('filters lists by them, and says who is hidden per row', async () => {
    expect(await service.employeeWhere(user(['ceo']))).toEqual({});
    expect(await service.ownedWhere(user(['hr']))).toEqual({ employeeId: { notIn: expect.arrayContaining(['ceo-1', 'former']) } });
    const view = await service.view(user(['hr']));
    expect(view.sees).toBe(false);
    expect(view.hidden.has('ceo-1')).toBe(true);
    expect((await service.view(user(['super_admin']))).hidden.size).toBe(0);
  });

  it('lets only those who see C-level people give a C-level grade', async () => {
    await expect(service.assertMayGiveGrade(user(['hr']), 'g9')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.assertMayGiveGrade(user(['hr']), 'g4')).resolves.toBeUndefined();
    await expect(service.assertMayGiveGrade(user(['hr']), null)).resolves.toBeUndefined();
    await expect(service.assertMayGiveGrade(user(['hr', 'super_admin']), 'g9')).resolves.toBeUndefined();
  });
});

describe('ConfidentialGuard', () => {
  const prisma = prismaStub();
  const guard = new ConfidentialGuard(new Reflector(), prisma, new ConfidentialService(prisma));
  const handler = () => undefined;

  const contextOf = (checks: unknown, req: object): ExecutionContext => {
    Reflect.defineMetadata(CONFIDENTIAL_CHECKS, checks, handler);
    return { getHandler: () => handler, switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  };
  const CEO_CONTRACT = '11111111-1111-4111-8111-111111111111';

  it('answers 404 for a C-level person’s record to those it is hidden from', async () => {
    const req = { user: user(['hr']), params: { id: CEO_CONTRACT } };
    await expect(guard.canActivate(contextOf([{ subject: 'contract', from: 'id' }], req))).rejects.toThrow('Contract not found.');
  });

  it('lets the CEO through, and anyone to a record that isn’t a C-level person’s or isn’t there', async () => {
    await expect(guard.canActivate(contextOf([{ subject: 'contract', from: 'id' }], { user: user(['ceo']), params: { id: CEO_CONTRACT } }))).resolves.toBe(true);
    const other = '22222222-2222-4222-8222-222222222222';
    await expect(guard.canActivate(contextOf([{ subject: 'contract', from: 'id' }], { user: user(['hr']), params: { id: other } }))).resolves.toBe(true);
  });

  it('reads the id from the query or the body too, and every id of a list', async () => {
    const employee = (from: unknown, req: object) => guard.canActivate(contextOf([{ subject: 'employee', from }], { user: user(['hr']), params: {}, ...req }));
    await expect(employee({ query: 'employeeId' }, { query: { employeeId: 'not-an-id' } })).resolves.toBe(true);
    await expect(employee({ query: 'employeeId' }, { query: {} })).resolves.toBe(true);
    const ceoId = '33333333-3333-4333-8333-333333333333';
    const hidden = new ConfidentialService(prisma);
    hidden.hiddenFrom = async () => [ceoId];
    const strict = new ConfidentialGuard(new Reflector(), prisma, hidden);
    const run = (from: unknown, req: object) => strict.canActivate(contextOf([{ subject: 'employee', from }], { user: user(['hr']), params: {}, ...req }));
    await expect(run({ body: 'employeeId' }, { body: { employeeId: ceoId } })).rejects.toThrow('Employee not found.');
    await expect(run({ query: 'employeeId' }, { query: { employeeId: ceoId } })).rejects.toThrow('Employee not found.');
  });
});
