import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { SessionUser } from '../src/auth/session-user.js';
import { ConfidentialService } from '../src/employees/confidential.service.js';
import { NoticesService } from '../src/notifications/notices.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Test accounts (owner, 6 November 2026: an account for Google's and Apple's app reviewers "without real data"; asked,
// "Yes, build it"): HR or a Super Admin ticks a profile as one; it then leaves every list, count and report (the C-level
// filters: ConfidentialService), payroll runs, and its requests tell nobody (NoticesService), while HR and a Super Admin
// still open it and list it apart (?tests=only), and it sees itself. Every name is invented; this file deletes what it
// made.

const RUN = `ta${Date.now().toString(36)}`;

describe('Test accounts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  let reviewerId: string;
  let departmentId: string;
  const api = () => request(app.getHttpServer());
  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const patch = (as: string, path: string, body: object) => api().patch(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const ids = (res: request.Response) => (res.body as { id: string }[]).map((e) => e.id);
  const sessionUser = (key: string, roles: SessionUser['roles'], employeeId: string | null = null): SessionUser =>
    ({ id: users[key], email: `${key}@test.local`, roles, employeeId }) as SessionUser;

  async function account(key: string, roles: Parameters<typeof createUser>[1]) {
    const email = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    departmentId = (await prisma.department.create({ data: { nameEn: `App Review ${RUN}` }, select: { id: true } })).id;
    for (const [key, roles] of [
      ['hr', ['hr']],
      ['superAdmin', ['super_admin']],
      ['finance', ['finance']],
      ['ceo', ['ceo']],
      ['reviewer', ['employee']],
    ] as const) {
      await account(key, [...roles]);
    }
    const e = await prisma.employee.create({
      data: {
        employeeCode: `REV-${RUN}`,
        fullNameEn: `Play Reviewer ${RUN}`,
        fullNameAr: 'مراجع التطبيقات',
        workEmail: `reviewer.${RUN}@mail.test`,
        employments: { create: { employmentType: 'full_time', status: 'active', joinDate: new Date('2026-01-01'), departmentId, workArrangement: 'wfh' } },
      },
      select: { id: true },
    });
    reviewerId = e.id;
    await prisma.user.update({ where: { id: users.reviewer }, data: { employeeId: reviewerId } });
    // the sessions read the link when signing in
    sessions.reviewer = await signIn(app, (await prisma.user.findUniqueOrThrow({ where: { id: users.reviewer }, select: { email: true } })).email);
  });

  afterAll(async () => {
    await prisma.user.update({ where: { id: users.reviewer }, data: { employeeId: null } });
    await prisma.employment.deleteMany({ where: { employeeId: reviewerId } });
    await prisma.employee.deleteMany({ where: { id: reviewerId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await app.close();
  });

  it('HR or a Super Admin ticks it, in the audit log; nobody else', async () => {
    expect(ids(await get('hr', '/employees').expect(200))).toContain(reviewerId);
    await patch('finance', `/employees/${reviewerId}/test-account`, { testAccount: true }).expect(403);
    await patch('hr', `/employees/${reviewerId}/test-account`, { testAccount: 'yes' }).expect(400);
    const made = (await patch('hr', `/employees/${reviewerId}/test-account`, { testAccount: true }).expect(200)).body as { testAccount: boolean };
    expect(made.testAccount).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'employee', entityId: reviewerId, action: 'update' }, orderBy: { id: 'desc' } });
    expect(audit?.diff).toEqual({ testAccount: { from: false, to: true } });
  });

  it('leaves the list for everyone; HR and a Super Admin list it apart and still open it; it sees itself', async () => {
    for (const who of ['hr', 'superAdmin', 'ceo', 'finance']) expect(ids(await get(who, '/employees').expect(200)), who).not.toContain(reviewerId);
    expect(ids(await get('hr', '/employees?tests=only').expect(200))).toEqual([reviewerId]);
    // a Super Admin without HR sees no profiles at all (employees.service visibleTo), these neither
    expect(ids(await get('superAdmin', '/employees?tests=only').expect(200))).toEqual([]);
    expect(ids(await get('finance', '/employees?tests=only').expect(200))).toEqual([]);
    expect((await get('hr', `/employees/${reviewerId}`).expect(200)).body).toMatchObject({ id: reviewerId, testAccount: true });
    expect(ids(await get('reviewer', '/employees').expect(200))).toEqual([reviewerId]);
    await get('reviewer', `/employees/${reviewerId}`).expect(200);
  });

  it('is hidden from every list, count and report the C-level filters apply, never counted as C-level', async () => {
    const confidential = app.get(ConfidentialService);
    for (const roles of [['hr'], ['ceo'], ['super_admin'], ['manager']] as const) {
      const view = await confidential.view(sessionUser('hr', [...roles]));
      expect(view.hidden.has(reviewerId), roles.join()).toBe(true);
      expect(view.all.has(reviewerId)).toBe(false);
    }
    // its own records it sees
    expect((await confidential.view(sessionUser('reviewer', ['employee'], reviewerId))).hidden.has(reviewerId)).toBe(false);
    // HR and a Super Admin manage it; the CEO and a manager don't open it
    expect(await confidential.isHidden(sessionUser('hr', ['hr']), reviewerId)).toBe(false);
    expect(await confidential.isHidden(sessionUser('superAdmin', ['super_admin']), reviewerId)).toBe(false);
    expect(await confidential.isHidden(sessionUser('ceo', ['ceo']), reviewerId)).toBe(true);
  });

  it('its requests tell nobody', async () => {
    const notices = app.get(NoticesService);
    expect(await notices.stageDeciders('hr', reviewerId)).toEqual([]);
    expect(await notices.stageDeciders('finance', reviewerId)).toEqual([]);
  });

  it('made a real profile again, it is back everywhere', async () => {
    await patch('hr', `/employees/${reviewerId}/test-account`, { testAccount: false }).expect(200);
    expect(ids(await get('hr', '/employees').expect(200))).toContain(reviewerId);
    expect((await app.get(ConfidentialService).view(sessionUser('hr', ['hr']))).hidden.has(reviewerId)).toBe(false);
    expect((await app.get(NoticesService).stageDeciders('hr', reviewerId)).length).toBeGreaterThan(0);
  });
});
