import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, shownDate, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { EDIT_SUPER_ADMIN_ONLY, NOTHING_TO_EDIT } from '../src/leave/leave-edit.js';
import { firstDay, lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// A Super Admin edits a leave, and Leave Requests are filtered by employee and type (owner, 26 October 2026: "as a
// superadmin i need to edit the leaves" and "i need to filter either by employee or typ"; asked, the dates, the type, the
// reason and who covers it, in any status, Super Admin only). Every name and amount is invented; these tests look at
// their own people (names end with RUN) and delete what they made.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const NEXT = monthsLater(CURRENT, 1);

interface View {
  id: string;
  employee: { id: string };
  type: { id: string; key: string; nameEn: string };
  startDate: string;
  endDate: string;
  halfDay: boolean;
  days: number;
  reason: string | null;
  status: string;
  manager: { id: string } | null;
  cover: { id: string; fullNameEn: string } | null;
  canEdit: boolean;
  steps: { kind: string; comment: string | null; actor: string | null }[];
  balanceAfter: number | null;
}

interface Balances {
  annual: { available: number };
  requests: View[];
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

describe('Leave edits and filters (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let developer: string;
  let superAdmin: string; // a Super Admin alone
  let owner: string; // HR, the CEO and a Super Admin, as the owner is
  let superId: string;
  let otherSuperId: string;
  let emailDomainBefore: string | null;
  let deptId: string;
  const sessions: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const employments: Record<string, string> = {};
  const types: Record<string, string> = {};
  const names: Record<string, string> = {};
  const people: string[] = [];
  const runs: string[] = [];
  const holidays = new Set<string>();
  const api = () => request(app.getHttpServer());

  /** The month's working days (Sunday to Thursday, no official holiday), in order. */
  const working = (month: string) => {
    const out: string[] = [];
    for (let d = firstDay(month); d <= lastDay(month); d = addDays(d, 1)) if (weekday(d) <= 4 && !holidays.has(d)) out.push(d);
    return out;
  };
  /** The nth working day of the month; two of them that follow one another have nothing but rest days or holidays between. */
  const day = (month: string, n: number) => working(month)[n];

  async function person(key: string, name: string, manager: string | null = null, contract = true) {
    const email = await createUser(prisma, ['employee']);
    userIds[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email, gender: 'female' }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    names[key] = `${name} ${RUN}`;
    sessions[key] = await signIn(app, email);
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', departmentId: deptId, joinDate: '2025-01-01', ...(manager && { managerId: manager }) })
      .expect(201);
    employments[key] = hired.body.employment.id;
    if (!contract) return;
    const draft = (await api().post(`/api/employees/${res.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', hr).send({ grossSalary: 12000, durationMonths: 60 }).expect(201)).body as { id: string; startDate: string };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
  }

  const record = (key: string, type: string, startDate: string, endDate = startDate) =>
    api().post('/api/leave/requests').set('Cookie', hr).field('employeeId', ids[key]).field('typeId', types[type]).field('startDate', startDate).field('endDate', endDate);
  const edit = (id: string, body: object, session = superAdmin) => api().patch(`/api/leave/requests/${id}`).set('Cookie', session).send(body);
  const balances = async (key: string, year = Number(NEXT.slice(0, 4))) => (await api().get(`/api/employees/${ids[key]}/leave?year=${year}`).set('Cookie', hr).expect(200)).body as Balances;
  const one = async (id: string) => (await api().get(`/api/leave/requests/${id}`).set('Cookie', owner).expect(200)).body as View;
  const noticesOf = (key: string, kind: string) => prisma.notification.findMany({ where: { userId: userIds[key], kind }, orderBy: { createdAt: 'asc' } });
  const audits = (id: string) => prisma.auditLog.findMany({ where: { entityType: 'leave_request', entityId: id, action: 'update' }, orderBy: { id: 'asc' } });
  const lineOf = async (runId: string, key: string) =>
    ((await api().get(`/api/payroll/runs/${runId}`).set('Cookie', owner).expect(200)).body.lines as { employeeId: string; terms: { leave?: object } }[]).find((l) => l.employeeId === ids[key])!;

  let annualId: string;
  let unpaidName: string;
  let annualName: string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    developer = await signIn(app, await createUser(prisma, ['employee', 'developer']));
    const superEmail = await createUser(prisma, ['super_admin']);
    superId = (await prisma.user.findUniqueOrThrow({ where: { email: superEmail } })).id;
    superAdmin = await signIn(app, superEmail);
    otherSuperId = (await prisma.user.findUniqueOrThrow({ where: { email: await createUser(prisma, ['super_admin']) } })).id;
    owner = await signIn(app, await createUser(prisma, ['hr', 'ceo', 'super_admin']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Edits ${RUN}` }).expect(201)).body.id;
    for (const h of await prisma.holiday.findMany({ select: { date: true } })) holidays.add(fromDateOnly(h.date));
    for (const t of (await api().get('/api/leave/types').set('Cookie', hr).expect(200)).body as { id: string; key: string; nameEn: string }[]) {
      types[t.key] = t.id;
      if (t.key === 'annual') annualName = t.nameEn;
      if (t.key === 'unpaid') unpaidName = t.nameEn;
    }
    annualId = types.annual;
    await person('mona', 'Mona Manager');
    await person('ana', 'Ana Edited');
    await person('ben', 'Ben Pending', ids.mona);
    await person('cora', 'Cora Cover');
    await person('dan', 'Dan Cover');
    await person('lena', 'Lena Locked');
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

  describe('an approved leave', () => {
    let first: View;
    let secondId: string;
    let runNext: string;
    const [a1, a2] = [day(NEXT, 2), day(NEXT, 3)];
    const [b1, b2] = [day(NEXT, 6), day(NEXT, 7)];

    beforeAll(async () => {
      first = (await record('ana', 'annual', a1, a2).expect(201)).body;
      secondId = ((await record('ana', 'annual', day(NEXT, 12)).expect(201)).body as View).id;
      await prisma.payrollRun.deleteMany({ where: { month: toDateOnly(firstDay(NEXT)) } });
      runNext = (await api().post('/api/payroll/runs').set('Cookie', owner).send({ month: NEXT }).expect(201)).body.id;
      runs.push(runNext);
    });

    it('is edited by a Super Admin: the type and the days, the balance moves, the draft payroll is filled again, the step, the audit log and the employee tell it', async () => {
      expect((await lineOf(runNext, 'ana')).terms.leave).toEqual({ paidDays: 3, unpaidDays: 0 });
      const before = (await balances('ana')).annual.available;
      const edited = (await edit(first.id, { typeId: types.unpaid, note: 'Imported as annual by mistake' }).expect(200)).body as View;
      expect(edited).toMatchObject({ status: 'approved', days: 2, startDate: a1, endDate: a2, type: { key: 'unpaid' }, canEdit: true });
      // annual days given back, and the draft's line read again
      expect((await balances('ana')).annual.available).toBe(before + 2);
      expect((await lineOf(runNext, 'ana')).terms.leave).toEqual({ paidDays: 1, unpaidDays: 2 });
      expect(edited.steps.at(-1)).toMatchObject({ kind: 'edited', comment: `Type ${annualName} → ${unpaidName}\nWhy: Imported as annual by mistake` });

      // the days moved, and the type back: charged again
      const moved = (await edit(first.id, { typeId: annualId, startDate: b1, endDate: b2 }).expect(200)).body as View;
      expect(moved).toMatchObject({ status: 'approved', days: 2, startDate: b1, endDate: b2, type: { key: 'annual' } });
      expect((await balances('ana')).annual.available).toBe(before);
      expect((await lineOf(runNext, 'ana')).terms.leave).toEqual({ paidDays: 3, unpaidDays: 0 });
      expect(moved.steps.map((s) => s.kind)).toEqual(['recorded_by_hr', 'edited', 'edited']);
      expect(moved.steps.at(-1)?.comment).toBe(`Dates ${shownDate(a1)}–${shownDate(a2)} → ${shownDate(b1)}–${shownDate(b2)}; type ${unpaidName} → ${annualName}`);

      // the audit log: before and after
      const logs = await audits(first.id);
      expect(logs).toHaveLength(2);
      expect(logs[1].diff).toMatchObject({
        employeeId: ids.ana,
        status: 'approved',
        before: { type: unpaidName, startDate: a1, endDate: a2, days: 2 },
        after: { type: annualName, startDate: b1, endDate: b2, days: 2 },
      });
      // the employee is told (the bell), as when HR cancels
      const told = await noticesOf('ana', 'leave_decided');
      expect(told.map((n) => n.title)).toEqual(['Leave edited by a Super Admin', 'Leave edited by a Super Admin']);
      expect(told[1].link).toBe(`/leave/${first.id}`);
    });

    it('the owner (HR, the CEO and a Super Admin) edits too; the reason, with a note', async () => {
      const edited = (await edit(first.id, { reason: 'Family visit' }, owner).expect(200)).body as View;
      expect(edited.reason).toBe('Family visit');
      expect(edited.steps.at(-1)?.comment).toBe('Reason none → “Family visit”');
      expect(edited.steps.at(-1)?.actor).toEqual(expect.any(String));
    });

    it('refuses a request that changes nothing, and what is not a valid change', async () => {
      expect(said(await edit(first.id, { reason: 'Family visit', typeId: annualId, startDate: b1 }).expect(400))).toEqual([NOTHING_TO_EDIT]);
      expect(said(await edit(first.id, { note: 'only a note' }).expect(400))).toEqual([NOTHING_TO_EDIT]);
      expect(said(await edit(first.id, { endDate: addDays(b1, -1) }).expect(400))).toEqual(["The last day can't be before the first."]);
      expect(said(await edit(first.id, { halfDay: true }).expect(400))[0]).toMatch(/half day/);
      await edit(first.id, { typeId: 'x' }).expect(400);
      await edit('0b6f2f5e-8d0e-4c9a-9a39-6f0f5a1d2c3e', { reason: 'x' }).expect(404);
    });

    it('a negative balance is refused as recording refuses it, with nothing changed; a leave over it already can still change its reason', async () => {
      const available = (await balances('ana')).annual.available;
      // down to 1 day left with the leave counted, so 3 are free to it
      await api().post(`/api/employees/${ids.ana}/leave/adjustments`).set('Cookie', hr).send({ year: Number(NEXT.slice(0, 4)), days: -(available - 1), reason: 'Test' }).expect(201);
      const days = working(NEXT);
      const longEnd = days[days.indexOf(b1) + 3];
      const res = await edit(first.id, { endDate: longEnd }).expect(400);
      expect(said(res)[0]).toMatch(/^Only 3 days left of the annual balance\.$/);
      expect(await one(first.id)).toMatchObject({ startDate: b1, endDate: b2, days: 2 });
      expect(await audits(first.id)).toHaveLength(3);
      await edit(first.id, { reason: 'Family visit, again' }).expect(200);
      await api().post(`/api/employees/${ids.ana}/leave/adjustments`).set('Cookie', hr).send({ year: Number(NEXT.slice(0, 4)), days: available - 1, reason: 'Test back' }).expect(201);
    });

    it('never on days another request takes, the leave itself left out', async () => {
      const second = await one(secondId);
      const res = await edit(secondId, { startDate: b2, endDate: b2 }).expect(409);
      expect(said(res)[0]).toMatch(/^Ana Edited .* already has Annual leave from .* \(approved\) on some of these days/);
      expect(await one(secondId)).toMatchObject({ startDate: second.startDate });
      // its own days are not a clash: the first leave moves one working day on
      const later = working(NEXT)[working(NEXT).indexOf(b2) + 1];
      await edit(first.id, { startDate: b2, endDate: later }).expect(200);
      await edit(first.id, { startDate: b1, endDate: b2 }).expect(200);
    });

    it('the colleague who covers: never the employee, told when named and no more when changed or removed', async () => {
      await edit(first.id, { coverId: ids.ana }).expect(400);
      const named = (await edit(first.id, { coverId: ids.cora, note: 'Cora is back' }).expect(200)).body as View;
      expect(named.cover).toEqual({ id: ids.cora, fullNameEn: names.cora });
      expect(named.steps.at(-1)?.comment).toBe(`Covered by nobody → ${names.cora}\nWhy: Cora is back`);
      expect((await noticesOf('cora', 'leave_cover')).map((n) => n.title)).toEqual([`${names.ana} named you to cover their leave`]);
      await edit(first.id, { coverId: ids.dan }).expect(200);
      expect((await noticesOf('cora', 'leave_cover')).map((n) => n.title)).toEqual([`${names.ana} named you to cover their leave`, `You no longer cover ${names.ana}`]);
      expect((await noticesOf('dan', 'leave_cover')).map((n) => n.title)).toEqual([`${names.ana} named you to cover their leave`]);
      expect(((await edit(first.id, { coverId: null }).expect(200)).body as View).cover).toBeNull();
    });
  });

  describe('a month whose payroll is with the CEO, approved or paid', () => {
    it('refuses the old days and the new days, naming the month, with nothing changed; a reason can still change', async () => {
      const [l1, l2] = [day(CURRENT, 2), day(CURRENT, 3)];
      const inLater = ((await record('lena', 'annual', l1, l2).expect(201)).body as View).id;
      const n1 = day(NEXT, 3);
      const inNext = ((await record('lena', 'annual', n1).expect(201)).body as View).id;
      await prisma.payrollRun.deleteMany({ where: { month: toDateOnly(firstDay(CURRENT)) } });
      const run = (await api().post('/api/payroll/runs').set('Cookie', owner).send({ month: CURRENT }).expect(201)).body.id as string;
      runs.push(run);
      await prisma.payrollRun.update({ where: { id: run }, data: { status: 'paid', submittedAt: new Date(), approvedAt: new Date() } });
      const month = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${CURRENT}-01T00:00:00Z`));
      const refusal = `The ${month} payroll is paid, so the days of this leave can't change. Ask the CEO to return the payroll to HR first, or leave these days as they are.`;
      // the old days are in the month, the new elsewhere
      expect(said(await edit(inLater, { startDate: day(NEXT, 9), endDate: day(NEXT, 9) }).expect(409))).toEqual([refusal]);
      // the old days are elsewhere, the new in the month; and a type change of the days in it
      expect(said(await edit(inNext, { startDate: day(CURRENT, 8), endDate: day(CURRENT, 8) }).expect(409))).toEqual([refusal]);
      expect(said(await edit(inLater, { typeId: types.unpaid }).expect(409))).toEqual([refusal]);
      expect(await one(inLater)).toMatchObject({ startDate: l1, endDate: l2, type: { key: 'annual' } });
      expect(await one(inNext)).toMatchObject({ startDate: n1, type: { key: 'annual' } });
      expect(await audits(inLater)).toHaveLength(0);
      expect((await one(inLater)).steps.map((s) => s.kind)).toEqual(['recorded_by_hr']);
      // what the payroll doesn't read is not locked
      await edit(inLater, { reason: 'Recorded for the wrong week' }).expect(200);
    });
  });

  describe('a leave being decided, rejected or cancelled', () => {
    it('pending stays at its step with its approver, the new days are what the manager sees; the employee is not told', async () => {
      const [p1, p2] = [day(NEXT, 8), day(NEXT, 9)];
      const asked = (await api().post('/api/me/leave/requests').set('Cookie', sessions.ben).field('typeId', annualId).field('startDate', p1).field('endDate', p1).field('halfDay', 'false').field('coverId', ids.cora).expect(201)).body as View;
      expect(asked).toMatchObject({ status: 'with_manager', manager: { id: ids.mona } });
      const before = (await balances('ben')).annual.available;
      const edited = (await edit(asked.id, { startDate: p1, endDate: p2, reason: 'A longer visit' }).expect(200)).body as View;
      expect(edited).toMatchObject({ status: 'with_manager', manager: { id: ids.mona }, days: 2, reason: 'A longer visit', canEdit: true });
      expect(edited.steps.map((s) => s.kind)).toEqual(['submitted', 'edited']);
      // pending days count against the balance (pending)
      expect((await balances('ben')).annual.available).toBe(before - 1);
      const forMona = (await api().get('/api/leave/requests?status=waiting').set('Cookie', sessions.mona).expect(200)).body as View[];
      expect(forMona.find((v) => v.id === asked.id)).toMatchObject({ endDate: p2, days: 2 });
      expect(await noticesOf('ben', 'leave_decided')).toEqual([]);
      // the manager can go on to decide it
      await api().post(`/api/leave/requests/${asked.id}/decide`).set('Cookie', sessions.mona).send({ decision: 'approve' }).expect(200);
      expect((await one(asked.id)).status).toBe('with_hr');
    });

    it('a rejected and a cancelled leave change their fields only: no balance, no payroll', async () => {
      const r1 = day(NEXT, 10);
      const rejectedAsk = (await api().post('/api/me/leave/requests').set('Cookie', sessions.ben).field('typeId', annualId).field('startDate', r1).field('endDate', r1).field('halfDay', 'false').field('coverId', ids.cora).expect(201)).body as View;
      await api().post(`/api/leave/requests/${rejectedAsk.id}/decide`).set('Cookie', sessions.mona).send({ decision: 'reject', comment: 'Busy' }).expect(200);
      const c1 = day(NEXT, 11);
      const cancelled = (await record('ben', 'annual', c1).expect(201)).body as View;
      await api().post(`/api/leave/requests/${cancelled.id}/cancel`).set('Cookie', hr).send({ comment: 'Came in' }).expect(200);
      const before = (await balances('ben')).annual.available;
      const a = (await edit(cancelled.id, { reason: 'Corrected', typeId: types.unpaid }).expect(200)).body as View;
      const b = (await edit(rejectedAsk.id, { reason: 'Corrected' }).expect(200)).body as View;
      expect(a).toMatchObject({ status: 'cancelled', reason: 'Corrected', type: { key: 'unpaid' } });
      expect(b).toMatchObject({ status: 'rejected', reason: 'Corrected' });
      expect((await balances('ben')).annual.available).toBe(before);
      // days that a cancelled leave doesn't take can be anyone's: no clash is asked of it
      expect(a.steps.at(-1)?.kind).toBe('edited');
      expect(await noticesOf('ben', 'leave_decided').then((n) => n.filter((x) => x.title === 'Leave edited by a Super Admin'))).toEqual([]);
    });
  });

  describe('who edits', () => {
    it('only a Super Admin in their own session: HR, the CEO, an employee, a developer and a Super Admin viewing as someone are refused', async () => {
      const leave = (await balances('ana')).requests.find((r) => r.status === 'approved')!;
      for (const session of [hr, ceo, sessions.ana, sessions.mona]) {
        const res = await edit(leave.id, { reason: 'No' }, session).expect(403);
        expect(said(res)).toEqual([EDIT_SUPER_ADMIN_ONLY]);
      }
      await edit(leave.id, { reason: 'No' }, developer).expect(403);
      // viewing as another Super Admin, acting as them: still not an edit
      const viewing = await api().post('/api/auth/view-as').set('Cookie', superAdmin).send({ userId: otherSuperId }).expect(200);
      let cookie = (([] as string[]).concat(viewing.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session=')) ?? '').split(';')[0];
      const acting = await api().post('/api/auth/view-as/act').set('Cookie', cookie).send({ act: true }).expect(200);
      cookie = (([] as string[]).concat(acting.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session=')) ?? '').split(';')[0];
      expect(said(await edit(leave.id, { reason: 'No' }, cookie).expect(403))).toEqual([EDIT_SUPER_ADMIN_ONLY]);
      expect((await one(leave.id)).reason).not.toBe('No');
      expect(superId).not.toBe(otherSuperId);
    });
  });

  describe('a stand-in', () => {
    it('is told again when the first day moves', async () => {
      const [s1, s2] = [day(NEXT, 4), day(NEXT, 5)];
      const leave = (await record('mona', 'annual', s1, s2).expect(201)).body as View;
      await prisma.leaveRequest.update({ where: { id: leave.id }, data: { standInHr: true, standInToldAt: new Date() } });
      await edit(leave.id, { reason: 'Only the reason' }).expect(200);
      expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } })).standInToldAt).not.toBeNull();
      const [t1, t2] = [day(NEXT, 14), day(NEXT, 15)];
      await edit(leave.id, { startDate: t1, endDate: t2 }).expect(200);
      const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } });
      expect(row).toMatchObject({ standInHr: true, standInToldAt: null });
      expect(fromDateOnly(row.startDate)).toBe(t1);
    });
  });

  describe('Leave Requests filtered by employee and type', () => {
    let cleo: string;

    beforeAll(async () => {
      const g9 = ((await api().get('/api/grades').set('Cookie', owner).expect(200)).body as { id: string; code: string }[]).find((g) => g.code === 'G9')!;
      const res = await api().post('/api/employees').set('Cookie', owner).send({ fullNameEn: `Cleo Chief ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
      cleo = res.body.id;
      people.push(cleo);
      const hired = await api().post(`/api/employees/${cleo}/employments`).set('Cookie', owner).send({ employmentType: 'full_time', joinDate: '2025-01-01', gradeId: g9.id }).expect(201);
      const c1 = day(NEXT, 13);
      await prisma.leaveRequest.create({
        data: { employeeId: cleo, employmentId: hired.body.employment.id, typeId: annualId, startDate: toDateOnly(c1), endDate: toDateOnly(c1), days: 1, status: 'approved', createdById: superId },
      });
    });

    const list = async (query: string, session = hr) => (await api().get(`/api/leave/requests${query}`).set('Cookie', session).expect(200)).body as View[];

    it('by employee, by type, and both, with the status', async () => {
      const all = await list('');
      const ana = await list(`?employeeId=${ids.ana}`);
      expect(ana.length).toBeGreaterThan(0);
      expect(ana.every((v) => v.employee.id === ids.ana)).toBe(true);
      expect(all.length).toBeGreaterThan(ana.length);
      const unpaid = await list(`?typeId=${types.unpaid}`);
      expect(unpaid.length).toBeGreaterThan(0);
      expect(unpaid.every((v) => v.type.key === 'unpaid')).toBe(true);
      expect(unpaid.some((v) => v.employee.id === ids.ben)).toBe(true);
      const both = await list(`?employeeId=${ids.ben}&typeId=${annualId}&status=with_hr`);
      expect(both.length).toBeGreaterThan(0);
      expect(both.every((v) => v.employee.id === ids.ben && v.type.key === 'annual' && v.status === 'with_hr')).toBe(true);
      expect(await list(`?employeeId=${ids.ana}&typeId=${types.sick}`)).toEqual([]);
      expect(said(await api().get('/api/leave/requests?typeId=permission').set('Cookie', hr).expect(400))).toEqual(['Choose the leave type.']);
      expect(said(await api().get('/api/leave/requests?employeeId=ben').set('Cookie', hr).expect(400))).toEqual(['Choose the employee.']);
    });

    it('a C-level person’s leave stays hidden from HR, in any filter, and shows to the CEO', async () => {
      expect((await list(`?typeId=${annualId}`)).map((v) => v.employee.id)).not.toContain(cleo);
      expect(await list(`?employeeId=${cleo}`)).toEqual([]);
      expect((await list(`?employeeId=${cleo}`, ceo)).map((v) => v.employee.id)).toEqual([cleo]);
      expect((await list(`?typeId=${annualId}`, owner)).map((v) => v.employee.id)).toContain(cleo);
    });
  });
});
