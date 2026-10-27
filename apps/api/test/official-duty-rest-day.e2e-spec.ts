import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, weekday } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Official duty on a rest day or an official holiday, compensated (owner, 27 October 2026: "why cant i record this for an
// employee? it should count in the compensatories"; he chose "One step": the duty form asks for the compensation, a day
// off or cash instead, and saving records the duty and the compensatory day together, approved the same way), part of a
// day by the Compensatory Setup's hours ("Hours off for hours worked"; "up to 4 hours to be compensated by hours - minimum
// 6 hours can be compensated by a day"), and the Setup itself. The days are in the month after next, a Sunday to Thursday
// shift resting on Friday and Saturday. These tests look at their own people (names end with RUN) and delete what they
// made. Every name and place is invented.

const RUN = `odrest${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const MONTH = monthsLater(TODAY.slice(0, 7), 2);

interface Compensation {
  id: string;
  status: string;
  outcome: string;
  dayOff: string | null;
  hoursWorked: number | null;
  hoursOff: number | null;
}

interface OdView {
  id: string;
  status: string;
  compensation: Compensation | null;
}

interface CompView {
  id: string;
  status: string;
  outcome: string | null;
  dayOff: string | null;
  hoursWorked: number | null;
  hoursOff: number | null;
  od: { id: string; startDate: string; status: string } | null;
  waitingForYou: boolean;
  canCancel: boolean;
  hrCanCancel: boolean;
  steps: { kind: string; comment: string | null }[];
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

describe('Official duty on a rest day (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let emailDomainBefore: string | null;
  let deptId: string;
  let shiftId: string;
  let holidays: Set<string>;
  const sessions: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const people: string[] = [];
  const api = () => request(app.getHttpServer());

  /** The month's Fridays and its working days (Sunday to Thursday), official holidays left out. */
  const days = () => {
    const fridays: string[] = [];
    const working: string[] = [];
    for (let d = firstDay(MONTH); d.startsWith(MONTH); d = addDays(d, 1)) {
      if (holidays.has(d)) continue;
      if (weekday(d) === 5) fridays.push(d);
      else if (weekday(d) <= 4) working.push(d);
    }
    return { fridays, working };
  };

  async function person(key: string, who: string, employment: Record<string, unknown> = {}) {
    const email = await createUser(prisma, ['employee']);
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${who} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: '2024-01-01', departmentId: deptId, shiftId, workArrangement: 'office', ...employment })
      .expect(201);
  }

  const record = (body: Record<string, unknown>) => api().post('/api/official-duty').set('Cookie', hr).send({ employeeId: ids.ben, place: 'Shoot location, Sheikh Zayed', reason: 'The Friday shoot', ...body });
  const ask = (body: Record<string, unknown>) => api().post('/api/me/official-duty').set('Cookie', sessions.ben).send({ place: 'Shoot location, Sheikh Zayed', reason: 'The Friday shoot', ...body });
  const check = (query: Record<string, string>) => api().get(`/api/official-duty/check?${new URLSearchParams({ employeeId: ids.ben, ...query }).toString()}`).set('Cookie', hr);
  const comp = async (id: string, session = hr) => (await api().get(`/api/compensatory/${id}`).set('Cookie', session).expect(200)).body as CompView;
  const settings = (body: Record<string, unknown>) => api().patch('/api/compensatory/settings').set('Cookie', hr).send(body);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)!));
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Rest Day Duty ${RUN}` }).expect(201)).body.id;
    // Sunday to Thursday, 8 hours a day: Friday and Saturday are rest days
    shiftId = (
      await prisma.shift.create({
        data: { code: `S${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('18:00'), hoursPerDay: 8, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4] },
        select: { id: true },
      })
    ).id;
    await person('mona', 'Mona Manager');
    await person('ben', 'Ben Weekend', { managerId: ids.mona });
  });

  afterAll(async () => {
    await settings({ cashRate: 1.5, minHours: 2, hoursCap: 4, fullDayHours: 6, offWithinDays: null });
    await prisma.compensatoryRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.odRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  it('HR’s check says a Friday earns a whole day off and asks for it; a working day earns nothing', async () => {
    const [friday] = days().fridays;
    const asked = (await check({ startDate: friday }).expect(200)).body as { problems: string[]; compensation: unknown };
    expect(asked.compensation).toEqual({ onDayOff: true, needed: true, earned: { kind: 'day' }, cashDays: 1.5, already: null });
    expect(asked.problems).toEqual([`${shown(friday)} is a rest day of Ben Weekend ${RUN}'s shift: official duty on it earns a whole day off, so choose the day off or cash instead.`]);
    // 10:00 to 13:00: 3 hours off; cash instead 3 of 8 hours at 1.5
    const part = (await check({ startDate: friday, fullDay: 'false', fromTime: '10:00', toTime: '13:00' }).expect(200)).body as { compensation: unknown };
    expect(part.compensation).toMatchObject({ needed: true, earned: { kind: 'hours', hours: 3 }, cashDays: 0.56 });
    const working = days().working[0];
    expect(((await check({ startDate: working }).expect(200)).body as { compensation: unknown }).compensation).toMatchObject({ onDayOff: false, needed: false, earned: null });
  });

  it('HR records a Friday with a day off: both approved at once, linked, decided and cancelled only with the duty', async () => {
    const { fridays, working } = days();
    const friday = fridays[0];
    const dayOff = working.find((d) => d > friday)!;
    expect(said(await record({ startDate: friday }).expect(400))).toEqual([
      `${shown(friday)} is a rest day of Ben Weekend ${RUN}'s shift: official duty on it earns a whole day off, so choose the day off or cash instead.`,
    ]);
    const od = (await record({ startDate: friday, compensation: 'day_off', dayOff }).expect(201)).body as OdView;
    expect(od).toMatchObject({ status: 'approved', compensation: { status: 'approved', outcome: 'day_off', dayOff, hoursWorked: null, hoursOff: null } });
    const linked = await comp(od.compensation!.id);
    expect(linked).toMatchObject({ status: 'approved', outcome: 'day_off', dayOff, od: { id: od.id, startDate: friday, status: 'approved' }, canCancel: false, hrCanCancel: false });
    expect(linked.steps.map((s) => [s.kind, s.comment])).toEqual([['recorded_by_hr', 'With the official duty']]);
    // never by itself
    expect(said(await api().post(`/api/compensatory/${linked.id}/cancel`).set('Cookie', hr).send({ comment: 'By itself' }).expect(409))).toEqual([
      `This compensatory day goes with the official duty on ${shown(friday)}: cancel the official duty, and it is cancelled with it.`,
    ]);
    // a second compensation for the same Friday is refused; the day is compensated already
    const again = (await check({ startDate: friday }).expect(200)).body as { compensation: { already: string | null; needed: boolean } };
    expect(again.compensation).toMatchObject({ already: 'approved', needed: false });
    // HR cancels the duty: its compensatory day is cancelled with it
    await api().post(`/api/official-duty/${od.id}/cancel`).set('Cookie', hr).send({ comment: 'The shoot moved' }).expect(200);
    expect(await comp(linked.id)).toMatchObject({ status: 'cancelled' });
    const audit = await prisma.auditLog.findMany({ where: { entityType: 'compensatory_request', entityId: linked.id }, orderBy: { id: 'asc' }, select: { action: true } });
    expect(audit.map((a) => a.action)).toEqual(['record', 'cancel']);
  });

  it('an employee asks: the duty and its day off go to the manager, then HR, together; neither waits twice', async () => {
    const { fridays, working } = days();
    const friday = fridays[1];
    const dayOff = working.find((d) => d > friday)!;
    expect(said(await ask({ startDate: friday }).expect(400))).toEqual([`${shown(friday)} is a rest day of your shift: official duty on it earns a whole day off, so choose the day off or cash instead.`]);
    const od = (await ask({ startDate: friday, compensation: 'day_off', dayOff }).expect(201)).body as OdView;
    expect(od).toMatchObject({ status: 'with_manager', compensation: { status: 'with_manager' } });
    // the manager sees the duty waiting, not its compensatory day
    const waitingComp = (await api().get('/api/compensatory?status=waiting').set('Cookie', sessions.mona).expect(200)).body as CompView[];
    expect(waitingComp.find((c) => c.id === od.compensation!.id)).toBeUndefined();
    expect(((await api().get('/api/compensatory/counts').set('Cookie', sessions.mona).expect(200)).body as { waiting: number }).waiting).toBe(0);
    expect(said(await api().post(`/api/compensatory/${od.compensation!.id}/decide`).set('Cookie', sessions.mona).send({ decision: 'approve' }).expect(409))).toEqual([
      `This compensatory day goes with the official duty on ${shown(friday)}: it is decided with the official duty.`,
    ]);
    await api().post(`/api/official-duty/${od.id}/decide`).set('Cookie', sessions.mona).send({ decision: 'approve' }).expect(200);
    expect(await comp(od.compensation!.id)).toMatchObject({ status: 'with_hr' });
    await api().post(`/api/official-duty/${od.id}/decide`).set('Cookie', hr).send({ decision: 'approve' }).expect(200);
    const done = await comp(od.compensation!.id);
    expect(done).toMatchObject({ status: 'approved', outcome: 'day_off', dayOff });
    expect(done.steps.map((s) => s.kind)).toEqual(['submitted', 'manager_decision', 'hr_decision']);
  });

  it('a rejected duty rejects its day off; the employee’s cancel cancels it', async () => {
    const { fridays, working } = days();
    const friday = fridays[2];
    const dayOff = working.find((d) => d > friday)!;
    const od = (await ask({ startDate: friday, compensation: 'day_off', dayOff }).expect(201)).body as OdView;
    await api().post(`/api/official-duty/${od.id}/decide`).set('Cookie', sessions.mona).send({ decision: 'reject', comment: 'No shoot that Friday' }).expect(200);
    expect(await comp(od.compensation!.id)).toMatchObject({ status: 'rejected' });
    const saturday = addDays(fridays[2], 1);
    const other = (await ask({ startDate: saturday, compensation: 'cash' }).expect(201)).body as OdView;
    expect(other.compensation).toMatchObject({ outcome: 'cash', dayOff: null });
    await api().post(`/api/me/official-duty/${other.id}/cancel`).set('Cookie', sessions.ben).expect(200);
    expect(await comp(other.compensation!.id)).toMatchObject({ status: 'cancelled' });
  });

  it('part of a Friday paid in cash: its hours’ share at 1.5, the addition cancelled with the duty', async () => {
    const friday = days().fridays.at(-1)!;
    const od = (await record({ startDate: friday, fullDay: false, fromTime: '10:00', toTime: '14:00', compensation: 'cash' }).expect(201)).body as OdView;
    expect(od.compensation).toMatchObject({ status: 'approved', outcome: 'cash', dayOff: null, hoursWorked: 4, hoursOff: 4 });
    const row = await prisma.compensatoryRequest.findUniqueOrThrow({ where: { id: od.compensation!.id }, select: { adjustment: { select: { days: true, status: true, type: true } } } });
    // 4 of 8 hours at 1.5: 0.75 days' pay
    expect(row.adjustment).toMatchObject({ type: 'bonus_days', status: 'pending' });
    expect(row.adjustment!.days!.toNumber()).toBe(0.75);
    await api().post(`/api/official-duty/${od.id}/cancel`).set('Cookie', hr).send({ comment: 'Recorded twice' }).expect(200);
    const after = await prisma.compensatoryRequest.findUniqueOrThrow({ where: { id: od.compensation!.id }, select: { status: true, adjustment: { select: { status: true } } } });
    expect(after).toEqual({ status: 'cancelled', adjustment: { status: 'cancelled' } });
  });

  it('an hour on a Friday earns nothing: recorded without a compensation, refused with one', async () => {
    const saturday = addDays(days().fridays.at(-1)!, 1);
    const part = { startDate: saturday, fullDay: false, fromTime: '10:00', toTime: '11:00' };
    expect(said(await record({ ...part, compensation: 'cash' }).expect(400))).toEqual([
      `${shown(saturday)} is a rest day of Ben Weekend ${RUN}'s shift: 1 hour of official duty is fewer than the 2 hours that earn a compensation, so leave the compensation out.`,
    ]);
    const od = (await record(part).expect(201)).body as OdView;
    expect(od).toMatchObject({ status: 'approved', compensation: null });
  });

  it('a compensatory day for part of a day worked: hours off by the Setup; below its minimum refused', async () => {
    // last month: a day worked is one gone by
    const last = monthsLater(TODAY.slice(0, 7), -1);
    let saturday = firstDay(last);
    while (weekday(saturday) !== 6 || holidays.has(saturday)) saturday = addDays(saturday, 1);
    let dayOff = addDays(saturday, 1);
    while (weekday(dayOff) > 4 || holidays.has(dayOff)) dayOff = addDays(dayOff, 1);
    const base = { employeeId: ids.ben, dayWorked: saturday, dayOff, reason: 'Worked the Saturday morning' };
    expect(said(await api().post('/api/compensatory').set('Cookie', hr).send({ ...base, hoursWorked: 1 }).expect(400))[0]).toBe(
      `Ben Weekend ${RUN} worked 1 hour: fewer than the 2 hours that earn a compensation (Compensatory Setup).`,
    );
    // 5 hours: capped at 4 hours off
    const made = (await api().post('/api/compensatory').set('Cookie', hr).send({ ...base, hoursWorked: 5 }).expect(201)).body as CompView;
    expect(made).toMatchObject({ status: 'approved', hoursWorked: 5, hoursOff: 4, dayOff, od: null });
  });

  it('the Setup: HR changes it, refused when its hours don’t fit; the window lets the day off fall in the next month', async () => {
    expect(said(await settings({ minHours: 5 }).expect(400))).toEqual(['The most hours off can’t be fewer than the minimum hours to qualify.']);
    expect((await settings({ minHours: 3, offWithinDays: 10 }).expect(200)).body).toEqual({ cashRate: 1.5, minHours: 3, hoursCap: 4, fullDayHours: 6, offWithinDays: 10 });
    await api().patch('/api/compensatory/settings').set('Cookie', sessions.ben).send({ minHours: 1 }).expect(403);
    const log = await prisma.auditLog.findFirst({ where: { entityType: 'leave_settings' }, orderBy: { id: 'desc' }, select: { diff: true } });
    expect(log?.diff).toEqual({ compensatoryMinHours: { from: 2, to: 3 }, compensatoryOffWithinDays: { from: null, to: 10 } });
    // the last Friday of the month with a day off early next month: inside 10 days
    const friday = days().fridays.at(-1)!;
    const next = addDays(friday, 10);
    const checked = (await check({ startDate: friday, compensation: 'day_off', dayOff: next }).expect(200)).body as { problems: string[] };
    expect(checked.problems.filter((p) => p.includes('within') || p.includes('same month'))).toEqual([]);
    await settings({ minHours: 2, offWithinDays: null }).expect(200);
  });
});
