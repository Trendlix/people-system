import type { INestApplication } from '@nestjs/common';
import { zonedMoment } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo, toDateOnly } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Recount past days (owner, 26 October 2026, after changing the MORNING shift to 8:00 AM–8:00 PM, 9 hours, grace 0,
// counting until 8:00 PM: "i want to recount previous payrolls on the new shift run"; asked earlier, "Months not yet
// paid"). The system's days and Zoho People's (with pairs, and first and last only) of a draft month made again on the
// changed shift, the draft line refilled, a correction made again; an approved month skipped and listed; run twice, the
// second changes nothing; HR may run it, an employee and a developer are refused; audited. Own people and shifts, every
// name invented, deleted after.

const RUN = `rc${Date.now().toString(36).toLowerCase()}`;
const CURRENT = todayInCairo().slice(0, 7);
const DRAFT = monthsLater(CURRENT, -3);
const APPROVED = monthsLater(CURRENT, -4);

interface Line {
  employeeId: string;
  inputs: { workedHours: number | null };
}

describe('Recount past days (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrUserId: string;
  let deptId: string;
  let shiftId: string;
  let otherShiftId: string;
  let emailDomainBefore: string | null;
  const people: string[] = [];
  const ids: Record<string, string> = {};
  const runs: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const at = (date: string, time: string) => new Date(zonedMoment(date, time));
  const day = (month: string, n: number) => addDays(firstDay(month), n);
  const rowOf = (key: string, date: string, source: string) => prisma.attendanceDay.findUniqueOrThrow({ where: { employeeId_date_source: { employeeId: ids[key], date: toDateOnly(date), source } } });
  const lineOf = async (month: string, key: string) => ((await api().get(`/api/payroll/runs/${runs[month]}`).set('Cookie', hr).expect(200)).body.lines as Line[]).find((l) => l.employeeId === ids[key])!;
  const recount = (body: object) => api().post('/api/attendance/recount-days').set('Cookie', hr).send(body);
  const previewOf = (body: object) => api().post('/api/attendance/recount-days/preview').set('Cookie', hr).send(body);

  async function person(key: string, name: string, shift: string) {
    const email = await createUser(prisma, ['employee']);
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: firstDay(monthsLater(APPROVED, -2)), departmentId: deptId, shiftId: shift, workArrangement: 'office' })
      .expect(201);
    const draft = (await api().post(`/api/employees/${res.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', hr).send({ grossSalary: 15000, durationMonths: 36 }).expect(201)).body as { id: string; startDate: string };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
  }

  const sysDay = async (key: string, date: string, presses: [kind: 'in' | 'out', time: string][], hours: number) => {
    await prisma.attendancePunch.createMany({
      data: presses.map(([kind, time]) => ({ employeeId: ids[key], date: toDateOnly(date), kind, at: at(date, time), place: 'office', expected: 'office', flags: [], source: 'system', userId: hrUserId })),
    });
    await prisma.attendanceDay.create({
      data: { employeeId: ids[key], date: toDateOnly(date), status: 'worked', checkIn: at(date, presses[0][1]), checkOut: presses.at(-1)![0] === 'out' ? at(date, presses.at(-1)![1]) : null, place: 'office', hoursCounted: hours, source: 'system', importedById: hrUserId },
    });
  };
  const zohoDay = (key: string, date: string, pairs: { in: string; out: string }[] | null, hours: number) =>
    prisma.attendanceDay.create({
      data: {
        employeeId: ids[key],
        date: toDateOnly(date),
        status: 'worked',
        zohoStatus: 'Present',
        checkIn: at(date, '09:00'),
        checkOut: at(date, '21:00'),
        place: 'office',
        hoursCounted: hours,
        pairs: pairs ?? undefined,
        source: 'zoho',
        importedById: hrUserId,
      },
    });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrUserId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } })).id;
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Recount Dept ${RUN}` }).expect(201)).body.id;
    const make = async (code: string) =>
      (await prisma.shift.create({ data: { code: `${code}${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('19:00'), hoursPerDay: 9, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4, 5, 6] }, select: { id: true } })).id;
    shiftId = await make('R');
    otherShiftId = await make('O');
    await person('sys', 'Sami System', shiftId);
    await person('zp', 'Zaid Pairs', shiftId);
    await person('zx', 'Zeina Excel', shiftId);
    await person('oth', 'Omar Other', otherShiftId);

    const [a, b] = [day(DRAFT, 3), day(DRAFT, 4)];
    const pairsOf = (date: string) => [
      { in: at(date, '09:00').toISOString(), out: at(date, '13:00').toISOString() },
      { in: at(date, '14:00').toISOString(), out: at(date, '21:00').toISOString() },
    ];
    // kept on the old shift (9:00–19:00, 15 minutes' grace): 9 hours each
    await sysDay('sys', a, [['in', '09:00'], ['out', '13:00'], ['in', '14:00'], ['out', '21:00']], 9);
    await zohoDay('zp', a, pairsOf(a), 9);
    await zohoDay('zx', a, null, 9);
    await sysDay('oth', a, [['in', '09:00'], ['out', '13:00'], ['in', '14:00'], ['out', '21:00']], 9);
    // a day with a check-out forgotten, corrected to 9:00 PM
    await sysDay('sys', b, [['in', '09:00'], ['out', '13:00'], ['in', '14:00']], 4);
    await api().post('/api/attendance/corrections').set('Cookie', hr).send({ employeeId: ids.sys, date: b, kind: 'forgot_check_out', reason: 'Seen by HR', checkOut: '21:00' }).expect((r) => { if (r.status !== 201) throw new Error(JSON.stringify(r.body)); });
    // the approved month: left as it is
    await zohoDay('zp', day(APPROVED, 3), pairsOf(day(APPROVED, 3)), 9);

    for (const month of [APPROVED, DRAFT]) runs[month] = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month }).expect(201)).body.id;
    await prisma.payrollRun.update({ where: { id: runs[APPROVED] }, data: { status: 'approved', submittedAt: new Date(), approvedAt: new Date() } });
    // the owner changes the shift: 8:00 AM–8:00 PM, 9 hours, grace 0, counting until 8:00 PM
    await prisma.shift.update({ where: { id: shiftId }, data: { startTime: toTimeOfDay('08:00'), endTime: toTimeOfDay('20:00'), graceMinutes: 0, countUntil: toTimeOfDay('20:00') } });
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: { in: Object.values(runs) } } });
    await prisma.attendanceCorrection.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: { in: [shiftId, otherShiftId] } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  const range = { from: APPROVED, to: DRAFT };

  it('previews what would change and lists the month skipped, writing nothing', async () => {
    const res = await previewOf({ ...range, shiftId }).expect(200);
    expect(res.body).toMatchObject({ months: [DRAFT], skipped: [{ month: APPROVED, status: 'approved' }], days: 4, people: 3, zohoDays: 2, daysChanged: 4, hoursChanged: 3, hoursBefore: 31, hoursAfter: 37 });
    expect((await rowOf('sys', day(DRAFT, 3), 'system')).hoursCounted.toNumber()).toBe(9);
    expect((await rowOf('zx', day(DRAFT, 3), 'zoho')).hoursCounted.toNumber()).toBe(9);
    expect(await prisma.auditLog.count({ where: { action: 'recount_past_days', diff: { path: ['from'], equals: APPROVED } } })).toBe(0);
  });

  it('recounts the system’s and Zoho’s days on the shift as it is now, the corrected day again, the draft line refilled', async () => {
    const before = await lineOf(DRAFT, 'sys');
    const res = await recount({ ...range, shiftId }).expect(200);
    expect(res.body).toMatchObject({ months: [DRAFT], skipped: [{ month: APPROVED, status: 'approved' }], days: 4, daysChanged: 4, hoursChanged: 3, correctedDays: 1 });
    const a = day(DRAFT, 3);
    // 9:00–13:00 and 14:00–21:00: 9:00 to 8:00 PM, the break included (owner, 31 October 2026: "9:00, break included")
    expect((await rowOf('sys', a, 'system')).hoursCounted.toNumber()).toBe(11);
    const zp = await rowOf('zp', a, 'zoho');
    expect(zp.hoursCounted.toNumber()).toBe(11);
    expect(zp.breakMinutes).toBe(60);
    expect(zp.checkIn).toEqual(at(a, '09:00'));
    expect(zp.checkOut).toEqual(at(a, '21:00'));
    // first and last only: 9:00 to 8:00 PM
    expect((await rowOf('zx', a, 'zoho')).hoursCounted.toNumber()).toBe(11);
    // the other shift untouched
    expect((await rowOf('oth', a, 'system')).hoursCounted.toNumber()).toBe(9);
    // the corrected day made again over it: 9:00 to 8:00 PM, the break included
    expect((await rowOf('sys', day(DRAFT, 4), 'correction')).hoursCounted.toNumber()).toBe(11);
    // the line of someone who checks in on the system is filled from their days: 11 + the corrected day's 11 (a person with
    // only Zoho's days has their line filled from an import, as before)
    expect((await lineOf(DRAFT, 'sys')).inputs.workedHours).toBe(22);
    expect(before.inputs.workedHours).not.toBe(22);
    // the approved month as it was
    expect((await rowOf('zp', day(APPROVED, 3), 'zoho')).hoursCounted.toNumber()).toBe(9);
  });

  it('is audited once with its scope and counts', async () => {
    const logged = await prisma.auditLog.findMany({ where: { action: 'recount_past_days', userId: hrUserId } });
    expect(logged).toHaveLength(1);
    expect(logged[0].diff).toMatchObject({ from: APPROVED, to: DRAFT, shiftId, months: [DRAFT], monthsSkipped: [{ month: APPROVED, status: 'approved' }], daysRecounted: 4, daysWritten: 4, daysChanged: 3, hoursBefore: 31, hoursAfter: 37 });
  });

  it('run again changes nothing', async () => {
    const res = await recount({ ...range, shiftId }).expect(200);
    expect(res.body).toMatchObject({ days: 4, daysChanged: 0, hoursChanged: 0, linesRefilled: 0, hoursBefore: 37, hoursAfter: 37 });
    expect((await rowOf('zx', day(DRAFT, 3), 'zoho')).hoursCounted.toNumber()).toBe(11);
  });

  it('an approved month alone: nothing recounted, listed as skipped', async () => {
    const res = await recount({ from: APPROVED, to: APPROVED, shiftId }).expect(200);
    expect(res.body).toMatchObject({ months: [], days: 0, skipped: [{ month: APPROVED, status: 'approved' }] });
  });

  it('refuses a range that is too long, in the future or backwards', async () => {
    await recount({ from: monthsLater(CURRENT, -12), to: CURRENT }).expect(400);
    await recount({ from: DRAFT, to: monthsLater(CURRENT, 1) }).expect(400);
    await recount({ from: CURRENT, to: DRAFT }).expect(400);
  });

  it('is for HR and a Super Admin: an employee and a developer are refused', async () => {
    const employee = await signIn(app, await createUser(prisma, ['employee']));
    await api().post('/api/attendance/recount-days/preview').set('Cookie', employee).send({ ...range }).expect(403);
    await api().post('/api/attendance/recount-days').set('Cookie', employee).send({ ...range }).expect(403);
    const developer = await signIn(app, await createUser(prisma, ['employee', 'developer']));
    await api().post('/api/attendance/recount-days/preview').set('Cookie', developer).send({ ...range }).expect(403);
    await api().post('/api/attendance/recount-days').set('Cookie', developer).send({ ...range }).expect(403);
    const admin = await signIn(app, await createUser(prisma, ['admin']));
    await api().post('/api/attendance/recount-days/preview').set('Cookie', admin).send({ ...range, shiftId }).expect(200);
  });
});
