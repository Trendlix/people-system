import type { INestApplication } from '@nestjs/common';
import type { Role } from '@trendlix/shared';
import { zonedMoment } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// HR records official duty for someone (owner, 26 October 2026, asked "how to apply or import official duty": "HR
// records it"), modelled on Record a WFH day: what it would meet checked first; several days approved at once with a
// "recorded by HR" step, past the 3-day limit with the warning (the reason required, as every official duty's), the
// month's draft payroll line refilled (its days attended, no longer no-shows), the employee told, audited; HR's cancel
// works on it; refused for HR's own, over leave or a work from home day, in a month whose payroll is approved; a C-level
// person's hidden from HR and recorded by the CEO. These tests look at their own people (names end with RUN) and delete
// what they made. Every name and place is invented.

const RUN = `odr${Date.now().toString(36)}`;
const TODAY = todayInCairo();

interface View {
  id: string;
  employee: { id: string; fullNameEn: string };
  startDate: string;
  endDate: string;
  fullDay: boolean;
  dutyPlace: string;
  reason: string;
  late: boolean;
  recordedByHr: boolean;
  warnings: string[];
  imported: boolean;
  status: string;
  stage: string | null;
  confidential: boolean;
  hrCanCancel: boolean;
  manager: { id: string; role: string } | null;
  steps: { kind: string; decision: string | null; comment: string | null; actor: string | null }[];
}

interface Check {
  employee: { id: string; fullNameEn: string };
  problems: string[];
  warnings: string[];
  shift: { startTime: string; endTime: string; graceMinutes: number } | null;
}

interface Line {
  employeeId: string;
  inputs: { workedHours: number | null; noShowDays: number | null };
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

describe('HR records official duty (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let owner: string; // HR and a Super Admin, as the owner is
  let emailDomainBefore: string | null;
  let g9: { id: string; confidential: boolean };
  let deptId: string;
  let shiftId: string;
  let holidays: Set<string>;
  const runs: string[] = [];
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const people: string[] = [];
  const api = () => request(app.getHttpServer());

  /** The first day from `from` on (or back, with `step` -1) that isn't an official holiday. */
  const free = (from: string, step = 1) => {
    let d = from;
    while (holidays.has(d)) d = addDays(d, step);
    return d;
  };

  /** A profile with a sign-in account (`roles`), hired from 2024 under the every-day shift unless said; a signed contract if `signed`. */
  async function person(key: string, who: string, employment: Record<string, unknown> = {}, opts: { roles?: Role[]; signed?: boolean; session?: () => string } = {}) {
    const session = opts.session ?? (() => hr);
    const email = await createUser(prisma, opts.roles ?? ['employee']);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    const res = await api().post('/api/employees').set('Cookie', session()).send({ fullNameEn: `${who} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', session())
      .send({ employmentType: 'full_time', joinDate: '2024-01-01', departmentId: deptId, shiftId, workArrangement: 'office', ...employment })
      .expect(201);
    if (opts.signed) {
      const draft = (await api().post(`/api/employees/${res.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', session()).send({ grossSalary: 15000, durationMonths: 24 }).expect(201))
        .body as { id: string; startDate: string };
      await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', session()).send({ signedOn: draft.startDate }).expect(200);
    }
  }

  const record = (body: Record<string, unknown>, session = hr) => api().post('/api/official-duty').set('Cookie', session).send({ place: 'Client office, New Cairo', reason: 'Site visit agreed by phone', ...body });
  const check = (query: Record<string, string>, session = hr) => api().get(`/api/official-duty/check?${new URLSearchParams(query).toString()}`).set('Cookie', session);
  const inbox = (key: string) =>
    prisma.notification.findMany({ where: { userId: users[key], kind: { startsWith: 'od_' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { kind: true, title: true, body: true, link: true } });
  const lineOf = async (runId: string, key: string) => ((await api().get(`/api/payroll/runs/${runId}`).set('Cookie', hr).expect(200)).body as { lines: Line[] }).lines.find((l) => l.employeeId === ids[key])!;

  /** Two days in a row, more than 3 days ago, in one month, neither an official holiday. */
  function pastPair(): [string, string] {
    for (let n = 5; n < 40; n++) {
      const a = addDays(TODAY, -n - 1);
      const b = addDays(TODAY, -n);
      if (a.slice(0, 7) === b.slice(0, 7) && !holidays.has(a) && !holidays.has(b)) return [a, b];
    }
    throw new Error('No two days in a row without a holiday in the last 40 days.');
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    owner = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)));
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Official Duty Record ${RUN}` }).expect(201)).body.id;
    // a shift working every day, so the days these tests pick are working days whatever the weekday
    shiftId = (
      await prisma.shift.create({
        data: { code: `R${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('19:00'), hoursPerDay: 9, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4, 5, 6] },
        select: { id: true },
      })
    ).id;
    // Cleo is C-level: G9, a grade marked confidential (owner, 19 October 2026)
    g9 = (await prisma.grade.findFirst({ where: { code: 'G9' }, select: { id: true, confidential: true } }))!;
    await prisma.grade.update({ where: { id: g9.id }, data: { confidential: true } });
    await person('mona', 'Mona Manager');
    // under a signed contract from 6 months ago, so the month's payroll run has his line
    await person('ben', 'Ben Away', { managerId: ids.mona, joinDate: firstDay(monthsLater(TODAY.slice(0, 7), -6)) }, { signed: true });
    await person('lina', 'Lina Leave', { managerId: ids.mona });
    // in HR, with an employee profile of her own
    await person('hana', 'Hana HR', {}, { roles: ['hr'] });
    await person('cleo', 'Cleo Chief', { departmentId: null, gradeId: g9.id }, { session: () => owner });
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: { in: runs } } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.odRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.wfhRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.grade.update({ where: { id: g9.id }, data: { confidential: g9.confidential } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  it('says first what the days would meet: nothing refusing them, the 3-day limit as a warning, the shift', async () => {
    const [a, b] = pastPair();
    const past = (await check({ employeeId: ids.ben, startDate: a, endDate: b }).expect(200)).body as Check;
    expect(past).toEqual({
      employee: { id: ids.ben, fullNameEn: `Ben Away ${RUN}` },
      problems: [],
      warnings: [`${shown(a)} is ${Math.round((Date.parse(TODAY) - Date.parse(a)) / 86_400_000)} days ago, past the 3 days an employee may ask after: recorded by HR after the limit.`],
      shift: { startTime: '09:00', endTime: '19:00', graceMinutes: 15 },
    });
    const ahead = free(addDays(TODAY, 3));
    expect((await check({ employeeId: ids.ben, startDate: ahead }).expect(200)).body).toMatchObject({ problems: [], warnings: [] });
    // part of a day outside the shift is refused, by name
    expect((await check({ employeeId: ids.ben, startDate: ahead, fullDay: 'false', fromTime: '07:00', toTime: '08:00' }).expect(200)).body).toMatchObject({
      problems: [`Choose times within Ben Away ${RUN}'s shift, 9:00 AM to 7:00 PM.`],
    });
    // an employee or a manager doesn't check, nor record
    await check({ employeeId: ids.ben, startDate: ahead }, sessions.mona).expect(403);
    await record({ employeeId: ids.ben, startDate: ahead }, sessions.mona).expect(403);
    await record({ employeeId: ids.ben, startDate: ahead }, sessions.ben).expect(403);
  });

  it('records several days at once, approved and recorded by HR, past the 3-day limit only with a reason; the draft line refilled, the employee told, audited', async () => {
    const [a, b] = pastPair();
    const month = a.slice(0, 7);
    // Ben checks in on the system from before them: from then on a working day with no press is absent
    const first = addDays(a, -3);
    const at = (d: string, h: number) => new Date(zonedMoment(d, `${String(h).padStart(2, '0')}:00`));
    await prisma.attendanceDay.create({
      data: { employeeId: ids.ben, date: toDateOnly(first), status: 'worked', checkIn: at(first, 9), checkOut: at(first, 18), place: 'office', hoursCounted: 9, source: 'system' },
    });
    const existing = await prisma.payrollRun.findUnique({ where: { month: toDateOnly(firstDay(month)) }, select: { id: true } });
    if (existing) throw new Error(`A payroll run for ${month} is left by another test: these tests need its month free.`);
    const runId = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month }).expect(201)).body.id as string;
    runs.push(runId);
    const was = await lineOf(runId, 'ben');

    // the reason is required, as every official duty's is: past the limit too
    expect(said(await record({ employeeId: ids.ben, startDate: a, endDate: b, reason: '' }).expect(400))).toEqual([
      'Write what the official duty is for, e.g. a site visit for the client’s launch.',
    ]);
    expect(await prisma.odRequest.count({ where: { employeeId: ids.ben } })).toBe(0);

    const made = (await record({ employeeId: ids.ben, startDate: a, endDate: b }).expect(201)).body as View;
    expect(made).toMatchObject({
      employee: { id: ids.ben },
      startDate: a,
      endDate: b,
      fullDay: true,
      dutyPlace: 'Client office, New Cairo',
      reason: 'Site visit agreed by phone',
      late: true,
      recordedByHr: true,
      imported: false,
      status: 'approved',
      stage: null,
      hrCanCancel: true,
      manager: { id: ids.mona, role: 'direct_manager' },
    });
    expect(made.warnings).toEqual([expect.stringMatching(new RegExp(`^${shown(a).replace(/\//g, '\\/')} is \\d+ days ago, past the 3 days an employee may ask after`))]);
    expect(made.steps.map((s) => s.kind)).toEqual(['recorded_by_hr']);
    // the draft line: both days attended for the shift's 9 hours, no longer no-shows
    const now = await lineOf(runId, 'ben');
    expect(now.inputs.noShowDays).toBe((was.inputs.noShowDays ?? 0) - 2);
    expect(now.inputs.workedHours).toBe((was.inputs.workedHours ?? 0) + 18);
    // Ben is told; Mona isn't asked anything
    expect(await inbox('ben')).toEqual([{ kind: 'od_decided', title: 'Official duty recorded by HR', body: `${shown(a)}–${shown(b)}`, link: `/attendance/official-duty/${made.id}` }]);
    expect(await inbox('mona')).toEqual([]);
    const logged = await prisma.auditLog.findFirst({ where: { entityType: 'od_request', entityId: made.id }, select: { action: true, diff: true } });
    expect(logged?.action).toBe('record');
    expect(logged?.diff).toMatchObject({ employeeId: ids.ben, startDate: a, endDate: b, recordedByHr: true, status: 'approved', warnings: made.warnings });

    // in Ben's own, and HR's list
    expect(((await api().get('/api/me/official-duty').set('Cookie', sessions.ben).expect(200)).body as View[]).map((r) => r.id)).toEqual([made.id]);
    // the same days again: refused as another official duty
    expect(said(await record({ employeeId: ids.ben, startDate: a }).expect(400))).toEqual([`Ben Away ${RUN} has an official duty on ${shown(a)} already (approved).`]);

    // HR's cancel works on it: the days are no-shows again
    await api().post(`/api/official-duty/${made.id}/cancel`).set('Cookie', hr).send({ comment: 'Recorded for the wrong person' }).expect(200);
    expect((await lineOf(runId, 'ben')).inputs.noShowDays).toBe(was.inputs.noShowDays);
    expect((await inbox('ben')).at(-1)).toMatchObject({ kind: 'od_decided', title: 'Official duty cancelled by HR' });

    // a month whose payroll is approved is refused, as leave edits are
    await prisma.payrollRun.update({ where: { id: runId }, data: { status: 'approved' } });
    expect(said(await record({ employeeId: ids.ben, startDate: a }).expect(400))).toEqual([
      `The ${new Date(`${month}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })} payroll is approved, so its days can't change. Ask the CEO to return the payroll to HR first, or record days in another month.`,
    ]);
    expect((await check({ employeeId: ids.ben, startDate: a }).expect(200)).body.problems).toEqual([expect.stringMatching(/payroll is approved, so its days can't change/)]);
    await prisma.payrollRun.update({ where: { id: runId }, data: { status: 'draft' } });
  });

  it('is refused for HR’s own, and over leave or a work from home day', async () => {
    const day = free(addDays(TODAY, 8));
    expect(said(await record({ employeeId: ids.hana, startDate: day }, sessions.hana).expect(403))).toEqual([
      'Someone else in HR has to record your own official duty, or ask for it from My Requests.',
    ]);
    // someone else in HR records hers
    expect((await record({ employeeId: ids.hana, startDate: day }).expect(201)).body).toMatchObject({ status: 'approved', recordedByHr: true });

    const types = Object.fromEntries(((await api().get('/api/leave/types').set('Cookie', hr).expect(200)).body as { id: string; key: string }[]).map((t) => [t.key, t.id]));
    const leaveDay = free(addDays(TODAY, 10));
    await api().post('/api/leave/requests').set('Cookie', hr).field('employeeId', ids.lina).field('typeId', types.annual).field('startDate', leaveDay).field('endDate', leaveDay).expect(201);
    const wfhDay = free(addDays(leaveDay, 1));
    await api().post('/api/wfh').set('Cookie', hr).send({ employeeId: ids.lina, date: wfhDay, reason: 'Asked by phone' }).expect(201);
    expect(said(await record({ employeeId: ids.lina, startDate: leaveDay, endDate: wfhDay }).expect(400))).toEqual([
      `Lina Leave ${RUN} has Annual leave on ${shown(leaveDay)} (approved): an official duty can't be on a day of leave.`,
      `Lina Leave ${RUN} has a work from home day on ${shown(wfhDay)} (approved): ask for one or the other.`,
    ]);
    expect(await prisma.odRequest.count({ where: { employeeId: ids.lina } })).toBe(0);
  });

  it('a C-level person’s is hidden from HR and recorded by the CEO, who records nobody else’s', async () => {
    const day = free(addDays(TODAY, 5));
    await check({ employeeId: ids.cleo, startDate: day }).expect(404);
    await record({ employeeId: ids.cleo, startDate: day }).expect(404);
    const made = (await record({ employeeId: ids.cleo, startDate: day }, ceo).expect(201)).body as View;
    expect(made).toMatchObject({ status: 'approved', recordedByHr: true, confidential: true });
    await api().get(`/api/official-duty/${made.id}`).set('Cookie', hr).expect(404);
    expect(((await api().get('/api/official-duty?status=approved').set('Cookie', hr).expect(200)).body as View[]).map((r) => r.id)).not.toContain(made.id);
    // HR who sees C-level people (with Super Admin) does too
    expect((await check({ employeeId: ids.cleo, startDate: free(addDays(day, 1)) }, owner).expect(200)).body).toMatchObject({ problems: [] });
    expect(said(await record({ employeeId: ids.ben, startDate: free(addDays(TODAY, 12)) }, ceo).expect(403))).toEqual(['Only HR records an official duty for someone.']);
  });
});
