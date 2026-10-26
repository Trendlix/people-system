import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, weekday } from '../src/common/date-only.js';
import { firstDay, lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Only a Super Admin adds leave beyond the balance, and casual leave's days a year are a share in the year someone joins
// (owner, 26 October 2026: "only allow super admin to add leaves with a negative balance"; asked, "Yes, a share").
// Every name is invented; these tests look at their own people (names end with RUN) and delete what they made.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const NEXT = monthsLater(CURRENT, 1);
const YEAR = Number(TODAY.slice(0, 4));

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

describe('Leave beyond the balance and casual leave’s share (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let owner: string; // HR, the CEO and a Super Admin, as the owner is
  let emailDomainBefore: string | null;
  let deptId: string;
  const sessions: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const people: string[] = [];
  const types: Record<string, string> = {};
  const holidays = new Set<string>();
  const api = () => request(app.getHttpServer());

  const working = (month: string) => {
    const out: string[] = [];
    for (let d = firstDay(month); d <= lastDay(month); d = addDays(d, 1)) if (weekday(d) <= 4 && !holidays.has(d)) out.push(d);
    return out;
  };
  const day = (month: string, n: number) => working(month)[n];

  async function person(key: string, name: string, joinDate = '2025-01-01') {
    const email = await createUser(prisma, ['employee']);
    userIds[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email, gender: 'female' }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    const hired = await api().post(`/api/employees/${res.body.id}/employments`).set('Cookie', hr).send({ employmentType: 'full_time', departmentId: deptId, joinDate }).expect(201);
    const draft = (await api().post(`/api/employees/${res.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', hr).send({ grossSalary: 12000, durationMonths: 60 }).expect(201)).body as { id: string; startDate: string };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
  }

  const record = (key: string, type: string, startDate: string, endDate = startDate, session = hr) =>
    api().post('/api/leave/requests').set('Cookie', session).field('employeeId', ids[key]).field('typeId', types[type]).field('startDate', startDate).field('endDate', endDate);
  const available = async (key: string, year = Number(NEXT.slice(0, 4))) =>
    ((await api().get(`/api/employees/${ids[key]}/leave?year=${year}`).set('Cookie', hr).expect(200)).body as { annual: { available: number } }).annual.available;
  const audits = (id: string) => prisma.auditLog.findMany({ where: { entityType: 'leave_request', entityId: id }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    owner = await signIn(app, await createUser(prisma, ['hr', 'ceo', 'super_admin']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Beyond ${RUN}` }).expect(201)).body.id;
    for (const h of await prisma.holiday.findMany({ select: { date: true } })) holidays.add(fromDateOnly(h.date));
    for (const t of (await api().get('/api/leave/types').set('Cookie', hr).expect(200)).body as { id: string; key: string }[]) types[t.key] = t.id;
    await person('ova', 'Ova Over');
    await person('jo', 'Jo July', `${YEAR}-07-01`);
  });

  afterAll(async () => {
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

  it('HR is refused leave beyond the balance; a Super Admin records it, the step and the audit log say by how much', async () => {
    const free = await available('ova');
    await api().post(`/api/employees/${ids.ova}/leave/adjustments`).set('Cookie', hr).send({ year: Number(NEXT.slice(0, 4)), days: -(free - 1), reason: 'Test' }).expect(201);
    const [d1, d2] = [day(NEXT, 3), day(NEXT, 4)];
    const refused = await record('ova', 'annual', d1, d2).expect(400);
    expect(said(refused)).toEqual(['Only 1 day left of the annual balance.']);
    expect(await prisma.leaveRequest.count({ where: { employeeId: ids.ova } })).toBe(0);

    const made = (await record('ova', 'annual', d1, d2, owner).expect(201)).body as { id: string; status: string; steps: { kind: string; comment: string | null }[] };
    expect(made.status).toBe('approved');
    expect(made.steps).toMatchObject([{ kind: 'recorded_by_hr', comment: 'Over the balance by 1 day: allowed by a Super Admin' }]);
    expect(await available('ova')).toBe(-1);
    expect((await audits(made.id))[0].diff).toMatchObject({ overBalanceDays: 1, days: 2 });
  });

  it('a Super Admin’s edit may take the balance below 0 too, and says so; within the balance it says nothing', async () => {
    const [e1] = [day(NEXT, 8)];
    const own = (await record('ova', 'annual', e1, e1, owner).expect(201)).body as { id: string; steps: { comment: string | null }[] };
    // already at -1 and one day more: over by 2 in all (the leave itself, left out of the balance, takes it from -1 + 1)
    const edited = (await api().patch(`/api/leave/requests/${own.id}`).set('Cookie', owner).send({ endDate: day(NEXT, 9) }).expect(200)).body as { days: number; steps: { comment: string | null }[] };
    expect(edited.days).toBe(2);
    expect(edited.steps.at(-1)?.comment).toMatch(/\nOver the balance by \d+(\.5)? days?: allowed by a Super Admin$/);
    expect((await audits(own.id)).at(-1)?.diff).toMatchObject({ overBalanceDays: expect.any(Number) });
    // HR still cannot edit at all
    await api().patch(`/api/leave/requests/${own.id}`).set('Cookie', hr).send({ reason: 'No' }).expect(403);
  });

  it('casual leave’s days a year are a share in the year someone joins: a July joiner has 3.5 of 7', async () => {
    const month = `${YEAR}-08`;
    const [c1, c2, c3] = [day(month, 0), day(month, 2), day(month, 4)];
    await record('jo', 'casual', c1, day(month, 1)).expect(201); // 2 days
    await record('jo', 'casual', c2).expect(201); // 3 days in all
    // 3.5 is the year: a fourth day is beyond it, for HR and for a Super Admin (the type's own days stay a limit)
    for (const session of [hr, owner]) {
      expect(said(await record('jo', 'casual', c3, c3, session).expect(400))).toEqual(["Only 0.5 days left of casual leave's 3.5 days a year."]);
    }
    // half a day still fits
    await api().post('/api/leave/requests').set('Cookie', hr).field('employeeId', ids.jo).field('typeId', types.casual).field('startDate', c3).field('endDate', c3).field('halfDay', 'true').expect(201);
    // the balances page shows the share
    const view = (await api().get(`/api/employees/${ids.jo}/leave?year=${YEAR}`).set('Cookie', hr).expect(200)).body as { types: { typeId: string; daysPerYear: number | null; left: number | null }[] };
    expect(view.types.find((t) => t.typeId === types.casual)).toMatchObject({ daysPerYear: 3.5, left: 0 });
    // a full year is 7: Ova, who joined earlier, has all 7
    const ova = (await api().get(`/api/employees/${ids.ova}/leave?year=${YEAR}`).set('Cookie', hr).expect(200)).body as typeof view;
    expect(ova.types.find((t) => t.typeId === types.casual)).toMatchObject({ daysPerYear: 7, left: 7 });
  });
});
