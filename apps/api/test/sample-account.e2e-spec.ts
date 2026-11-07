import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addMonths, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// A sample account for the app stores' reviewers (owner, 7 November 2026: "the test account shows nothing after the
// login, allow apple testers to see some dummy data"): HR gives the email of an account made on the Users page; People
// makes it a test profile with a contract, its details confirmed, and a sample history, signed in as an Employee only.
// Every name is invented; this file deletes what it made.

describe('Sample account (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sessions: Record<string, string> = {};
  const emails: Record<string, string> = {};
  let shiftId: string | null = null;
  let sampleId: string;
  let realId: string;
  const api = () => request(app.getHttpServer());
  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const ids = (res: request.Response) => (res.body as { id: string }[]).map((e) => e.id);
  const today = todayInCairo();
  const lastMonth = addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    // a shift to work on, when the database has none
    if (!(await prisma.shift.count())) {
      shiftId = (
        await prisma.shift.create({
          data: { code: `SMP${Date.now().toString(36)}`, startTime: new Date('1970-01-01T09:00:00Z'), endTime: new Date('1970-01-01T18:00:00Z'), hoursPerDay: 8, workingDays: [0, 1, 2, 3, 4] },
          select: { id: true },
        })
      ).id;
    }
    for (const [key, roles] of [
      ['hr', ['hr']],
      ['finance', ['finance']],
      ['reviewer', ['employee', 'developer']],
      ['admin', ['admin']],
      ['real', ['employee']],
    ] as const) {
      emails[key] = await createUser(prisma, [...roles]);
      sessions[key] = await signIn(app, emails[key]);
    }
    // a real person's account
    realId = (
      await prisma.employee.create({
        data: { employeeCode: `REAL-${Date.now().toString(36)}`, fullNameEn: 'Real Person', fullNameAr: 'شخص', workEmail: `real.${Date.now()}@mail.test` },
        select: { id: true },
      })
    ).id;
    await prisma.user.update({ where: { email: emails.real }, data: { employeeId: realId } });
  });

  afterAll(async () => {
    const accounts = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } });
    await prisma.profileConfirmation.deleteMany({ where: { userId: { in: accounts.map((a) => a.id) } } });
    for (const id of [sampleId, realId].filter(Boolean)) {
      await prisma.employment.deleteMany({ where: { employeeId: id } });
      await prisma.employee.deleteMany({ where: { id } });
    }
    if (shiftId) await prisma.shift.deleteMany({ where: { id: shiftId } });
    await app.close();
  });

  it('is HR’s or a Super Admin’s, for an account with no other role than an employee’s, not anyone’s', async () => {
    await post('finance', '/employees/test-accounts/sample', { email: emails.reviewer }).expect(403);
    await post('hr', '/employees/test-accounts/sample', { email: 'not an email' }).expect(400);
    expect((await post('hr', '/employees/test-accounts/sample', { email: 'nobody.here@mail.test' }).expect(404)).body.message).toContain('Users page');
    expect((await post('hr', '/employees/test-accounts/sample', { email: emails.admin }).expect(409)).body.message).toContain('admin role');
    expect((await post('hr', '/employees/test-accounts/sample', { email: emails.real }).expect(409)).body.message).toContain('Real Person');
    expect((await post('hr', '/employees/test-accounts/sample', { email: emails.hr }).expect(403)).body.message).toContain('own account');
  });

  it('makes a test profile with a contract, links the account as an Employee only, and fills its history', async () => {
    const made = (await post('hr', '/employees/test-accounts/sample', { email: emails.reviewer.toUpperCase() }).expect(200)).body as { employeeId: string; created: boolean; days: number; requests: number };
    sampleId = made.employeeId;
    expect(made.created).toBe(true);
    expect(made.days).toBeGreaterThan(25);
    expect(made.requests).toBe(4);
    const account = await prisma.user.findUniqueOrThrow({ where: { email: emails.reviewer }, select: { employeeId: true, roles: { select: { role: { select: { key: true } } } } } });
    expect(account.employeeId).toBe(sampleId);
    expect(account.roles.map((r) => r.role.key)).toEqual(['employee']);
    const e = await prisma.employee.findUniqueOrThrow({ where: { id: sampleId }, select: { employeeCode: true, testAccount: true, fullNameEn: true, employments: { select: { workArrangement: true, contracts: { select: { number: true, status: true } } } } } });
    expect(e).toMatchObject({ testAccount: true, fullNameEn: 'Nour Hassan' });
    expect(e.employeeCode).toMatch(/^TEST-\d+$/);
    expect(e.employments[0].workArrangement).toBe('wfh');
    expect(e.employments[0].contracts[0]).toMatchObject({ status: 'active' });
    expect(await prisma.attendancePunch.count({ where: { employeeId: sampleId } })).toBe(made.days * 2);
    // in the audit log
    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'employee', entityId: sampleId, action: 'create' } });
    expect(audit?.diff).toMatchObject({ sampleAccount: { email: emails.reviewer } });
    // HR lists it apart; nobody else sees it
    expect(ids(await get('hr', '/employees').expect(200))).not.toContain(sampleId);
    expect(ids(await get('hr', '/employees?tests=only').expect(200))).toContain(sampleId);
    expect((await get('hr', `/employees/${sampleId}/access`).expect(200)).body).toMatchObject({ eligible: true, standing: { standing: 'active' } });
  });

  it('signed in, the reviewer sees their days, requests and balance, and may check in; no review first', async () => {
    sessions.reviewer = await signIn(app, emails.reviewer);
    expect((await get('reviewer', '/auth/me').expect(200)).body).toMatchObject({ employeeId: sampleId, roles: ['employee'] });
    expect((await get('reviewer', `/employees/${sampleId}`).expect(200)).body.confirmation).toMatchObject({ upToDate: true });
    expect((await get('reviewer', '/me/attendance/today').expect(200)).body).toMatchObject({ refusal: null, next: 'in' });
    // last month: worked, two days of annual leave, two hours' permission one morning
    const month = (await get('reviewer', `/attendance/me?month=${lastMonth}`).expect(200)).body as { person: { figures: { daysWorked: number; leaveDays: number; permissionHours: number } } };
    expect(month.person.figures.daysWorked).toBeGreaterThan(10);
    expect(month.person.figures).toMatchObject({ leaveDays: 2, permissionHours: 2 });
    const leave = (await get('reviewer', '/me/leave/requests').expect(200)).body as { status: string }[];
    expect(leave.map((r) => r.status).sort()).toEqual(['approved', 'approved', 'with_hr']);
    expect(((await get('reviewer', '/me/permissions').expect(200)).body as unknown[]).length).toBe(1);
    const balances = (await get('reviewer', `/me/leave/balances?year=${today.slice(0, 4)}`).expect(200)).body as { key?: string; type?: { key: string } }[];
    expect(JSON.stringify(balances)).toContain('annual');
  });

  it('again, makes its history afresh: what the reviewer did is replaced', async () => {
    await prisma.attendancePunch.create({ data: { employeeId: sampleId, date: new Date(`${today}T00:00:00Z`), kind: 'in', place: 'remote', expected: 'anywhere', flags: [] } });
    const again = (await post('hr', '/employees/test-accounts/sample', { email: emails.reviewer }).expect(200)).body as { employeeId: string; created: boolean; days: number };
    expect(again).toMatchObject({ employeeId: sampleId, created: false });
    expect(await prisma.attendancePunch.count({ where: { employeeId: sampleId } })).toBe(again.days * 2);
    expect(await prisma.leaveRequest.count({ where: { employeeId: sampleId } })).toBe(3);
    await post('hr', `/employees/${sampleId}/test-account/sample`).expect(200);
    // never a real profile's
    expect((await post('hr', `/employees/${realId}/test-account/sample`).expect(409)).body.message).toContain('real profile');
  });
});
