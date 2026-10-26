import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { RESTORE_SUPER_ADMIN_ONLY } from '../src/leave/leave-edit.js';
import { firstDay, lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// A Super Admin undoes a cancellation (owner, 26 October 2026: "when cancelling or editing or cancelling leaves it
// cancells wrong dates ,, allow superadmin to undo cancellation and go through the edit to prevent this mistake").
// Every name is invented; these tests look at their own people (names end with RUN) and delete what they made.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const NEXT = monthsLater(CURRENT, 1);

interface View {
  id: string;
  type: { key: string };
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  manager: { id: string } | null;
  canRestore: boolean;
  balanceBeforeRestore: number | null;
  steps: { kind: string; comment: string | null }[];
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

describe('Undoing a cancellation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let owner: string; // HR, the CEO and a Super Admin, as the owner is
  let superAdmin: string;
  let emailDomainBefore: string | null;
  let deptId: string;
  const sessions: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const people: string[] = [];
  const runs: string[] = [];
  const types: Record<string, string> = {};
  const holidays = new Set<string>();
  const api = () => request(app.getHttpServer());

  const working = (month: string) => {
    const out: string[] = [];
    for (let d = firstDay(month); d <= lastDay(month); d = addDays(d, 1)) if (weekday(d) <= 4 && !holidays.has(d)) out.push(d);
    return out;
  };
  const day = (month: string, n: number) => working(month)[n];

  async function person(key: string, name: string, manager: string | null = null) {
    const email = await createUser(prisma, ['employee']);
    userIds[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email, gender: 'female' }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', departmentId: deptId, joinDate: '2025-01-01', ...(manager && { managerId: manager }) })
      .expect(201);
    const draft = (await api().post(`/api/employees/${res.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', hr).send({ grossSalary: 12000, durationMonths: 60 }).expect(201)).body as { id: string; startDate: string };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
  }

  const record = (key: string, type: string, startDate: string, endDate = startDate) =>
    api().post('/api/leave/requests').set('Cookie', hr).field('employeeId', ids[key]).field('typeId', types[type]).field('startDate', startDate).field('endDate', endDate);
  const hrCancel = (id: string) => api().post(`/api/leave/requests/${id}/cancel`).set('Cookie', hr).send({ comment: 'Cancelled the wrong dates' }).expect(200);
  const restore = (id: string, body: object = {}, session = owner) => api().post(`/api/leave/requests/${id}/restore`).set('Cookie', session).send(body);
  const available = async (key: string) =>
    ((await api().get(`/api/employees/${ids[key]}/leave?year=${NEXT.slice(0, 4)}`).set('Cookie', hr).expect(200)).body as { annual: { available: number } }).annual.available;
  const one = async (id: string) => (await api().get(`/api/leave/requests/${id}`).set('Cookie', owner).expect(200)).body as View;
  const noticesOf = (key: string, kind: string) => prisma.notification.findMany({ where: { userId: userIds[key], kind }, orderBy: { createdAt: 'asc' } });
  const audits = (id: string) => prisma.auditLog.findMany({ where: { entityType: 'leave_request', entityId: id, action: 'update' }, orderBy: { id: 'asc' } });
  const lineOf = async (runId: string, key: string) =>
    ((await api().get(`/api/payroll/runs/${runId}`).set('Cookie', owner).expect(200)).body.lines as { employeeId: string; terms: { leave?: object } }[]).find((l) => l.employeeId === ids[key])!;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    owner = await signIn(app, await createUser(prisma, ['hr', 'ceo', 'super_admin']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Restores ${RUN}` }).expect(201)).body.id;
    for (const h of await prisma.holiday.findMany({ select: { date: true } })) holidays.add(fromDateOnly(h.date));
    for (const t of (await api().get('/api/leave/types').set('Cookie', hr).expect(200)).body as { id: string; key: string }[]) types[t.key] = t.id;
    await person('mona', 'Mona Manager');
    await person('ana', 'Ana Restored');
    await person('ben', 'Ben Withdrawn', ids.mona);
    await person('cora', 'Cora Cover');
    await person('lena', 'Lena Locked');
    await person('zed', 'Zed Over');
    await person('kim', 'Kim Clash');
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: { in: runs } } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(userIds) } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveBalanceYear.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveAdjustment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  it('restores an approved leave HR cancelled: balances, the draft payroll, the step, the audit log, the employee and the cover are told', async () => {
    const [a1, a2] = [day(NEXT, 2), day(NEXT, 3)];
    const leave = (await record('ana', 'annual', a1, a2).expect(201)).body as View;
    await api().patch(`/api/leave/requests/${leave.id}`).set('Cookie', owner).send({ coverId: ids.cora }).expect(200);
    await prisma.payrollRun.deleteMany({ where: { month: toDateOnly(firstDay(NEXT)) } });
    const run = (await api().post('/api/payroll/runs').set('Cookie', owner).send({ month: NEXT }).expect(201)).body.id as string;
    runs.push(run);
    const start = await available('ana');
    await hrCancel(leave.id);
    expect(await available('ana')).toBe(start + 2);
    expect((await lineOf(run, 'ana')).terms.leave).toBeUndefined();
    const cancelled = await one(leave.id);
    expect(cancelled).toMatchObject({ status: 'cancelled', canRestore: true });
    const coverBefore = (await noticesOf('cora', 'leave_cover')).length;

    const back = (await restore(leave.id, { note: 'HR cancelled the wrong dates' }).expect(200)).body as View;
    expect(back).toMatchObject({ status: 'approved', canRestore: false, startDate: a1, endDate: a2, days: 2 });
    expect(back.steps.map((s) => s.kind)).toEqual(['recorded_by_hr', 'edited', 'cancelled', 'restored']);
    expect(back.steps.at(-1)?.comment).toBe('Back to approved\nWhy: HR cancelled the wrong dates');
    expect(await available('ana')).toBe(start);
    expect((await lineOf(run, 'ana')).terms.leave).toEqual({ paidDays: 2, unpaidDays: 0 });
    const logs = await audits(leave.id);
    expect(logs.at(-1)?.diff).toMatchObject({ employeeId: ids.ana, restored: true, before: { status: 'cancelled' }, after: { status: 'approved' }, note: 'HR cancelled the wrong dates' });
    expect((await noticesOf('ana', 'leave_decided')).map((n) => n.title)).toContain('Leave restored by a Super Admin');
    expect((await noticesOf('cora', 'leave_cover')).length).toBe(coverBefore + 1);
    // the edit is there as usual, so the dates can be fixed
    expect((await one(leave.id)).canRestore).toBe(false);
  });

  it('restores a withdrawn pending request to its step, with the same approver, and tells the approver', async () => {
    const p1 = day(NEXT, 8);
    const asked = (await api().post('/api/me/leave/requests').set('Cookie', sessions.ben).field('typeId', types.annual).field('startDate', p1).field('endDate', p1).field('halfDay', 'false').field('coverId', ids.cora).expect(201)).body as View;
    await api().post(`/api/me/leave/requests/${asked.id}/cancel`).set('Cookie', sessions.ben).send({}).expect(200);
    expect((await one(asked.id)).status).toBe('cancelled');
    const told = (await noticesOf('mona', 'leave_waiting')).length;
    const back = (await restore(asked.id).expect(200)).body as View;
    expect(back).toMatchObject({ status: 'with_manager', manager: { id: ids.mona } });
    expect(back.steps.map((s) => s.kind)).toEqual(['submitted', 'cancelled', 'restored']);
    expect((await noticesOf('mona', 'leave_waiting')).length).toBe(told + 1);
    // and the manager goes on to decide it
    await api().post(`/api/leave/requests/${asked.id}/decide`).set('Cookie', sessions.mona).send({ decision: 'approve' }).expect(200);
  });

  it('is refused in a month whose payroll is with the CEO, approved or paid, for the Super Admin too, with nothing changed', async () => {
    const [l1, l2] = [day(CURRENT, 2), day(CURRENT, 3)];
    const leave = (await record('lena', 'annual', l1, l2).expect(201)).body as View;
    await hrCancel(leave.id);
    await prisma.payrollRun.deleteMany({ where: { month: toDateOnly(firstDay(CURRENT)) } });
    const run = (await api().post('/api/payroll/runs').set('Cookie', owner).send({ month: CURRENT }).expect(201)).body.id as string;
    runs.push(run);
    await prisma.payrollRun.update({ where: { id: run }, data: { status: 'paid', submittedAt: new Date(), approvedAt: new Date() } });
    const month = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${CURRENT}-01T00:00:00Z`));
    const res = await restore(leave.id).expect(409);
    expect(said(res)[0]).toContain(`The ${month} payroll is paid`);
    expect((await one(leave.id)).status).toBe('cancelled');
    expect((await one(leave.id)).steps.map((s) => s.kind)).toEqual(['recorded_by_hr', 'cancelled']);
    expect(await audits(leave.id)).toHaveLength(0);
  });

  it('is refused on days another leave or a permission takes now', async () => {
    const k1 = day(NEXT, 4);
    const leave = (await record('kim', 'annual', k1).expect(201)).body as View;
    await hrCancel(leave.id);
    await record('kim', 'unpaid', k1).expect(201);
    expect(said(await restore(leave.id).expect(409))[0]).toContain('already has');
    expect((await one(leave.id)).status).toBe('cancelled');
  });

  it('only a cancelled leave is restored: an approved, a rejected one are refused; and only a Super Admin restores', async () => {
    const approved = (await record('ana', 'annual', day(NEXT, 12)).expect(201)).body as View;
    expect(said(await restore(approved.id).expect(409))[0]).toContain('only a cancelled leave can be restored');
    const r1 = day(NEXT, 14);
    const asked = (await api().post('/api/me/leave/requests').set('Cookie', sessions.ben).field('typeId', types.annual).field('startDate', r1).field('endDate', r1).field('halfDay', 'false').field('coverId', ids.cora).expect(201)).body as View;
    await api().post(`/api/leave/requests/${asked.id}/decide`).set('Cookie', sessions.mona).send({ decision: 'reject', comment: 'Busy' }).expect(200);
    expect(said(await restore(asked.id).expect(409))[0]).toContain('A rejected leave stays rejected');
    // a cancelled leave: HR, the CEO and the employee can't
    const c = (await record('ana', 'annual', day(NEXT, 15)).expect(201)).body as View;
    await hrCancel(c.id);
    for (const session of [hr, ceo, sessions.ana, sessions.mona]) {
      expect(said(await restore(c.id, {}, session).expect(403))).toEqual([RESTORE_SUPER_ADMIN_ONLY]);
    }
    expect((await one(c.id)).status).toBe('cancelled');
    // a Super Admin alone can
    await restore(c.id, {}, superAdmin).expect(200);
  });

  it('may take the annual balance below 0, which the step says; the page shows the balance it would be restored into', async () => {
    const z1 = day(NEXT, 6);
    const leave = (await record('zed', 'annual', z1).expect(201)).body as View;
    await hrCancel(leave.id);
    const free = await available('zed');
    await api().post(`/api/employees/${ids.zed}/leave/adjustments`).set('Cookie', hr).send({ year: Number(NEXT.slice(0, 4)), days: -(free - 0.5), reason: 'Test' }).expect(201);
    expect(await one(leave.id)).toMatchObject({ canRestore: true, balanceBeforeRestore: 0.5, days: 1 });
    const back = (await restore(leave.id).expect(200)).body as View;
    expect(back.status).toBe('approved');
    expect(back.steps.at(-1)?.comment).toBe('Back to approved\nOver the balance by 0.5 days: allowed by a Super Admin');
    expect(await available('zed')).toBe(-0.5);
    expect((await audits(leave.id)).at(-1)?.diff).toMatchObject({ overBalanceDays: 0.5 });
  });
});
