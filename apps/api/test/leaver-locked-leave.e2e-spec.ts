import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { zonedMoment } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { firstDay, lastDay, monthName, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Two payroll-integrity rules (owner's brief, 27 October 2026, after the proofs of the night before).
// 1. A leaver's last working day: an employee with an approved ending whose last working day is the 20th, not yet
//    completed, was paid 30/30 days with expected hours for the whole month and 8 no-shows after they left. Now the
//    approved ending's last working day ends the employment for the payroll and the attendance (employment-end.ts): 20/30
//    days, the shift's hours to the 20th, no no-shows after it; withdrawn, the whole month again; an ending still waiting
//    for the CEO changes nothing; a changed agreed day sends it back to the CEO, and the CEO's approval cuts the month
//    on the new day.
// 2. Leave in a month whose payroll has moved on: with the run with the CEO, HR recording leave answered 201 with no
//    warning and the line unchanged. Now it is flagged, never silent: the API warns, the request carries the month, HR and
//    Finance are told, Unsettled lists it until HR marks it handled, or the run returned to HR is refreshed.
// Other test files leave people in the same database, so these look at their own (names end with RUN) and delete
// everything they made. Everyone here is invented.

const RUN = `lp${Date.now().toString(36).toLowerCase()}`;
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const DRAFT = monthsLater(CURRENT, -3); // its days past; a draft run
const LOCK = monthsLater(CURRENT, -4); // a run with the CEO
const JOINED = '2025-01-01';
const GROSS = 20000;
const BASIC = 80;

interface Line {
  id: string;
  employeeId: string;
  terms: { expectedHours?: number | null; paidDays: number; leavingOn?: string; leave?: { paidDays: number; unpaidDays: number } };
  inputs: { workedHours: number | null; expectedHours: number | null; noShowDays: number | null; leaveDays: number | null };
  result: { expectedHours: number | null; attendanceRatio: number | null; attendanceCut: number; noShowCut: number; earned: number };
}

interface Flagged {
  id: string;
  status: string;
  payrollLocked?: string[];
  warnings?: string[];
}

interface LockedChangeRow {
  id: string;
  employee: { id: string };
  month: string;
  runStatus: string;
  kind: string;
  requestId: string;
  action: string;
  summary: string;
  handled: null | { how: string; note: string | null };
}

interface Unsettled {
  lockedChanges: { count: number; rows: LockedChangeRow[] };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** The API's warning on a change in the month with the CEO. */
const LOCKED = `${monthName(LOCK)}'s payroll is with the CEO: it isn't changed. Correct it by hand on the next payroll.`;

describe('A leaver’s last working day on the payroll, and leave changed after the payroll moved on (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrUserId: string;
  let finance: string;
  let ceo: string;
  let staff: string;
  let deptId: string;
  let shiftId: string;
  const types: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const employments: Record<string, string> = {};
  const people: string[] = [];
  const runs: Record<string, string> = {};
  const holidays = new Set<string>();
  const work: string[] = []; // DRAFT's Sundays to Thursdays, no holiday
  const workL: string[] = []; // LOCK's
  let n: number;
  let H: number;
  let upTo20: number;
  const api = () => request(app.getHttpServer());
  const at = (date: string, time: string) => new Date(zonedMoment(date, time));

  async function person(key: string, name: string) {
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: JOINED, departmentId: deptId, shiftId, workArrangement: 'office' })
      .expect(201);
    employments[key] = hired.body.employment.id;
    const draft = (
      await api().post(`/api/employees/${res.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', hr).send({ grossSalary: GROSS, basicPercent: BASIC, durationMonths: 36 }).expect(201)
    ).body as { id: string; startDate: string };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
  }

  /** A system day kept with its pair, 08:00–17:00 (9 hours). */
  const kept = (key: string, date: string, inT = '08:00', outT = '17:00') => ({
    employeeId: ids[key],
    date: toDateOnly(date),
    status: 'worked',
    checkIn: at(date, inT),
    checkOut: at(date, outT),
    place: 'office',
    hoursCounted: r2((mins(outT) - mins(inT)) / 60),
    source: 'system',
    importedById: hrUserId,
    pairs: [{ in: at(date, inT).toISOString(), out: at(date, outT).toISOString() }],
    breakMinutes: 0,
  });

  async function present(key: string, days: readonly string[]) {
    await prisma.attendanceDay.createMany({ data: days.map((d) => kept(key, d)) });
  }

  const recordLeave = (key: string, type: string, startDate: string, endDate = startDate) =>
    api().post('/api/leave/requests').set('Cookie', hr).field('employeeId', ids[key]).field('typeId', types[type]).field('startDate', startDate).field('endDate', endDate);
  const runOf = async (month: string) => (await api().get(`/api/payroll/runs/${runs[month]}`).set('Cookie', hr).expect(200)).body as { status: string; lines: Line[] };
  const lineOf = async (key: string, month = DRAFT) => (await runOf(month)).lines.find((l) => l.employeeId === ids[key])!;
  const refresh = (month: string) => api().post(`/api/payroll/runs/${runs[month]}/refresh`).set('Cookie', hr).expect(200);
  const unsettled = async (session = hr) => (await api().get('/api/payroll/unsettled').set('Cookie', session).expect(200)).body as Unsettled;
  const rowsOf = (u: Unsettled, requestId: string) => u.lockedChanges.rows.filter((r) => r.requestId === requestId);
  const notificationsOf = async (session: string) => (await api().get('/api/me/notifications').set('Cookie', session).expect(200)).body.items as { kind: string; title: string; body: string; link: string | null }[];
  const daysOf = async (key: string, month: string) => (await api().get(`/api/attendance/employees/${ids[key]}?month=${month}`).set('Cookie', hr).expect(200)).body.person.days as { date: string }[];

  const ending = (key: string, lastDay: string) =>
    api()
      .post(`/api/employees/${ids[key]}/employments/${employments[key]}/endings`)
      .set('Cookie', hr)
      .send({ ruleKey: 'mutual_agreement', initiator: 'employee', noticeGivenOn: `${DRAFT}-10`, agreedLastWorkingDay: lastDay, reason: 'Invented' });

  /**
   * The leaver's line as the brief expects it once the ending is approved: 20/30 days, the shift's hours to the 20th, no
   * no-shows after it; the pay 20/30 of the gross, its fixed and variable parts each rounded to the piaster (13,333.34).
   */
  function expectCutOnThe20th(l: Line) {
    expect(l.terms.paidDays).toBe(20);
    expect(l.terms.leavingOn).toBe(`${DRAFT}-20`);
    expect(l.terms.expectedHours).toBe(9 * upTo20);
    expect(l.inputs).toMatchObject({ workedHours: 9 * upTo20, noShowDays: 0 });
    const earned = r2(r2((GROSS * (BASIC / 100) * 20) / 30) + r2((GROSS * (1 - BASIC / 100) * 20) / 30));
    expect(l.result).toMatchObject({ expectedHours: 9 * upTo20, attendanceRatio: 1, attendanceCut: 0, noShowCut: 0, earned });
  }

  /** The leaver's line while no approved ending ends the month: 30/30 days, every working day expected, the days after the 20th no-shows. */
  function expectWholeMonth(l: Line) {
    expect(l.terms.paidDays).toBe(30);
    expect(l.terms.leavingOn).toBeUndefined();
    expect(l.terms.expectedHours).toBe(H);
    expect(l.inputs).toMatchObject({ workedHours: 9 * upTo20, noShowDays: n - upTo20 });
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrUserId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } })).id;
    finance = await signIn(app, await createUser(prisma, ['finance']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `LP Dept ${RUN}` }).expect(201)).body.id;
    // 08:00–20:00, 9 hours a day, Sunday to Thursday
    shiftId = (
      await prisma.shift.create({
        data: { code: `L${RUN}`.slice(0, 20), startTime: toTimeOfDay('08:00'), endTime: toTimeOfDay('20:00'), hoursPerDay: 9, graceMinutes: 0, countUntil: toTimeOfDay('20:00'), workingDays: [0, 1, 2, 3, 4] },
        select: { id: true },
      })
    ).id;
    for (const t of (await api().get('/api/leave/types').set('Cookie', hr).expect(200)).body as { id: string; key: string }[]) types[t.key] = t.id;
    for (const h of await prisma.holiday.findMany({ select: { date: true } })) holidays.add(fromDateOnly(h.date));
    const working = (month: string, into: string[]) => {
      for (let d = firstDay(month); d <= lastDay(month); d = addDays(d, 1)) if (weekday(d) <= 4 && !holidays.has(d)) into.push(d);
    };
    working(DRAFT, work);
    working(LOCK, workL);
    n = work.length;
    H = 9 * n;
    upTo20 = work.filter((d) => d <= `${DRAFT}-20`).length;

    await person('leaver', 'Lea Leaver');
    await person('draftp', 'Dra Draftmonth');
    await person('lockp', 'Loc Lockedmonth');
    // the leaver came in up to the 20th, nothing after; the locked month's person missed one day
    await present('leaver', work.filter((d) => d <= `${DRAFT}-20`));
    await present('draftp', work);
    await present('lockp', workL.filter((d) => d !== workL[3]));

    // the runs: LOCK with the CEO, DRAFT a draft (a stale run of either month from a run that stopped is cleared first)
    await prisma.payrollRun.deleteMany({ where: { month: { in: [toDateOnly(firstDay(LOCK)), toDateOnly(firstDay(DRAFT))] } } });
    runs[LOCK] = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: LOCK }).expect(201)).body.id;
    await api().post(`/api/payroll/runs/${runs[LOCK]}/submit`).set('Cookie', hr).expect(200);
    runs[DRAFT] = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: DRAFT }).expect(201)).body.id;
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: { in: Object.values(runs) } } });
    await prisma.payrollLockedChange.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employmentEnding.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.odRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.wfhRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.permissionRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveBalanceYear.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await app.close();
  });

  // ---------- 1. the leaver ----------

  it('pays the whole month, with no-shows after the 20th, while the ending is still waiting for the CEO', async () => {
    expectWholeMonth(await lineOf('leaver'));
    const made = (await ending('leaver', `${DRAFT}-20`).expect(201)).body as { id: string; status: string; lastWorkingDay: string };
    expect(made).toMatchObject({ status: 'pending_ceo', lastWorkingDay: `${DRAFT}-20` });
    // approved only (the CEO may still reject it): a refresh changes nothing
    await refresh(DRAFT);
    expectWholeMonth(await lineOf('leaver'));
    ids.ending1 = made.id;
  });

  it('ends the month on the approved ending’s last working day: 20/30 days, no no-shows after it, the line saying why', async () => {
    await api().post(`/api/endings/${ids.ending1}/approve`).set('Cookie', ceo).send({}).expect(200);
    // the employment isn't ended yet (Complete is refused before the last working day has come, and it hasn't been pressed)
    const employment = await prisma.employment.findUniqueOrThrow({ where: { id: employments.leaver }, select: { status: true, endDate: true } });
    expect(employment).toMatchObject({ status: 'notice_period', endDate: null });
    // the CEO's approval took the draft's line again at once
    expectCutOnThe20th(await lineOf('leaver'));
    // and a refresh says the same
    await refresh(DRAFT);
    expectCutOnThe20th(await lineOf('leaver'));
    // Daily Attendance: no day after the 20th, as not employed then
    const days = await daysOf('leaver', DRAFT);
    expect(days.length).toBeGreaterThan(0);
    expect(days.every((d) => d.date <= `${DRAFT}-20`)).toBe(true);
    // the audit log has the line taken again for the ending
    const audit = await prisma.auditLog.findMany({ where: { entityType: 'payroll_line', diff: { path: ['endingApproved'], equals: ids.ending1 } } });
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it('restores the whole month when the ending is withdrawn, at once and on the next refresh', async () => {
    await api().post(`/api/endings/${ids.ending1}/withdraw`).set('Cookie', hr).send({ note: 'Stays after all' }).expect(200);
    expectWholeMonth(await lineOf('leaver'));
    await refresh(DRAFT);
    expectWholeMonth(await lineOf('leaver'));
    const days = await daysOf('leaver', DRAFT);
    expect(days.some((d) => d.date > `${DRAFT}-20`)).toBe(true);
  });

  it('a changed agreed day sends the ending back to the CEO (the whole month again) and the new approval cuts the month on the new day', async () => {
    const made = (await ending('leaver', `${DRAFT}-20`).expect(201)).body as { id: string };
    await api().post(`/api/endings/${made.id}/approve`).set('Cookie', ceo).send({}).expect(200);
    expectCutOnThe20th(await lineOf('leaver'));
    const changed = (await api().patch(`/api/endings/${made.id}/last-day`).set('Cookie', hr).send({ agreedLastWorkingDay: `${DRAFT}-25`, note: 'A few days more' }).expect(200)).body as { status: string; lastWorkingDay: string };
    expect(changed).toMatchObject({ status: 'pending_ceo', lastWorkingDay: `${DRAFT}-25` });
    expectWholeMonth(await lineOf('leaver'));
    await api().post(`/api/endings/${made.id}/approve`).set('Cookie', ceo).send({}).expect(200);
    const l = await lineOf('leaver');
    const upTo25 = work.filter((d) => d <= `${DRAFT}-25`).length;
    expect(l.terms).toMatchObject({ paidDays: 25, leavingOn: `${DRAFT}-25`, expectedHours: 9 * upTo25 });
    // the working days from the 21st to the 25th had no check-in: no-shows, as employed then
    expect(l.inputs).toMatchObject({ workedHours: 9 * upTo20, noShowDays: upTo25 - upTo20 });
    await api().post(`/api/endings/${made.id}/withdraw`).set('Cookie', hr).send({ note: 'Stays' }).expect(200);
    expectWholeMonth(await lineOf('leaver'));
  });

  // ---------- 2. leave changed after the payroll moved on ----------

  it('HR recording leave in a month with the CEO is allowed, warned, flagged on the request, told to HR and Finance, and listed on Unsettled', async () => {
    const run = await runOf(LOCK);
    expect(run.status).toBe('pending_ceo');
    const before = run.lines.find((l) => l.employeeId === ids.lockp)!;
    expect(before.inputs.noShowDays).toBe(1);

    const res = await recordLeave('lockp', 'annual', workL[3]).expect(201);
    const made = res.body as Flagged;
    expect(made.status).toBe('approved');
    expect(made.warnings).toEqual([LOCKED]);
    expect(made.payrollLocked).toEqual([LOCK]);
    ids.leave = made.id;
    // the request's page says so, without the warning of the action
    const page = (await api().get(`/api/leave/requests/${made.id}`).set('Cookie', hr).expect(200)).body as Flagged;
    expect(page.payrollLocked).toEqual([LOCK]);
    expect(page.warnings).toBeUndefined();
    // the run with the CEO is unchanged
    const after = (await runOf(LOCK)).lines.find((l) => l.employeeId === ids.lockp)!;
    expect(after).toEqual(before);
    // HR and Finance told, to correct by hand
    for (const session of [hr, finance]) {
      const notice = (await notificationsOf(session)).find((x) => x.kind === 'payroll_locked_change');
      expect(notice).toBeDefined();
      expect(notice!.title).toBe('Leave recorded by HR for a month whose payroll is locked: correct by hand');
      expect(notice!.body).toContain(`Loc Lockedmonth ${RUN}: the ${monthName(LOCK)} payroll is with the CEO`);
      expect(notice!.link).toBe('/payroll/unsettled#locked');
    }
    // Unsettled lists it, for Finance too
    const rows = rowsOf(await unsettled(), made.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ employee: { id: ids.lockp }, month: LOCK, runStatus: 'pending_ceo', kind: 'leave', action: 'recorded', handled: null });
    expect(rows[0].summary).toMatch(/^Annual leave, \d{2}\/\d{2}\/\d{4}$/);
    expect(rowsOf(await unsettled(finance), made.id)).toHaveLength(1);
    await api().get('/api/payroll/unsettled').set('Cookie', staff).expect(403);
  });

  it('the same for a permission and a work from home day recorded by HR, and an official duty approved; HR marks one handled by hand', async () => {
    const permission = (await api().post('/api/leave/permissions').set('Cookie', hr).send({ employeeId: ids.lockp, date: workL[6], hours: 2 }).expect(201)).body as Flagged;
    expect(permission.warnings).toEqual([LOCKED]);
    expect(permission.payrollLocked).toEqual([LOCK]);
    // a work from home day's own warnings (recorded for a day gone by) stay, the payroll's after them
    const wfh = (await api().post('/api/wfh').set('Cookie', hr).send({ employeeId: ids.lockp, date: workL[5], reason: 'Recorded by HR' }).expect(201)).body as Flagged;
    expect(wfh.warnings).toContain(LOCKED);
    expect(wfh.warnings!.at(-1)).toBe(LOCKED);
    expect(wfh.payrollLocked).toEqual([LOCK]);
    // an official duty waiting for HR (recording one in such a month is refused already), approved
    const od = await prisma.odRequest.create({
      data: { employeeId: ids.lockp, employmentId: employments.lockp, startDate: toDateOnly(workL[7]), endDate: toDateOnly(workL[7]), fullDay: true, place: 'Client office', reason: `Shoot ${RUN}`, status: 'with_hr', createdById: hrUserId },
      select: { id: true },
    });
    const approved = (await api().post(`/api/official-duty/${od.id}/decide`).set('Cookie', hr).send({ decision: 'approve' }).expect(200)).body as Flagged;
    expect(approved.status).toBe('approved');
    expect(approved.warnings).toContain(LOCKED);
    expect(approved.payrollLocked).toEqual([LOCK]);

    let u = await unsettled();
    expect(rowsOf(u, permission.id)[0]).toMatchObject({ kind: 'permission', action: 'recorded', month: LOCK });
    expect(rowsOf(u, wfh.id)[0]).toMatchObject({ kind: 'wfh', action: 'recorded', month: LOCK });
    expect(rowsOf(u, od.id)[0]).toMatchObject({ kind: 'od', action: 'approved', month: LOCK });

    // HR marks the permission's handled, with a note; Finance and the staff can't
    const rowId = rowsOf(u, permission.id)[0].id;
    await api().post(`/api/payroll/locked-changes/${rowId}/handled`).set('Cookie', finance).send({ note: 'x' }).expect(403);
    await api().post(`/api/payroll/locked-changes/${rowId}/handled`).set('Cookie', staff).send({}).expect(403);
    const handled = (await api().post(`/api/payroll/locked-changes/${rowId}/handled`).set('Cookie', hr).send({ note: `Corrected on the ${monthName(DRAFT)} payroll` }).expect(200)).body as LockedChangeRow;
    expect(handled.handled).toMatchObject({ how: 'by_hand', note: `Corrected on the ${monthName(DRAFT)} payroll` });
    u = await unsettled();
    expect(rowsOf(u, permission.id)).toHaveLength(0);
    expect(rowsOf(u, wfh.id)).toHaveLength(1);
    const page = (await api().get(`/api/leave/permissions/${permission.id}`).set('Cookie', hr).expect(200)).body as Flagged;
    expect(page.payrollLocked).toEqual([]);
    await api().post(`/api/payroll/locked-changes/${randomUUID()}/handled`).set('Cookie', hr).send({}).expect(404);
    ids.wfh = wfh.id;
    ids.od = od.id;
  });

  it('HR cancelling the leave in that month is flagged too', async () => {
    const cancelled = (await api().post(`/api/leave/requests/${ids.leave}/cancel`).set('Cookie', hr).send({ comment: 'Came in after all' }).expect(200)).body as Flagged;
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.warnings).toEqual([LOCKED]);
    expect(cancelled.payrollLocked).toEqual([LOCK]);
    const rows = rowsOf(await unsettled(), ids.leave);
    expect(rows.map((r) => r.action).sort()).toEqual(['cancelled', 'recorded']);
    const audit = await prisma.auditLog.findMany({ where: { entityType: 'payroll_locked_change' } });
    expect(audit.filter((a) => a.action === 'create').length).toBeGreaterThanOrEqual(5);
    expect(audit.filter((a) => a.action === 'handled').length).toBeGreaterThanOrEqual(1);
  });

  it('the run returned to HR and refreshed handles its month’s changes, which leave Unsettled and the requests', async () => {
    await api().post(`/api/payroll/runs/${runs[LOCK]}/return`).set('Cookie', ceo).send({ reason: 'Take the leave' }).expect(200);
    await refresh(LOCK);
    const u = await unsettled();
    expect(u.lockedChanges.rows.filter((r) => r.employee.id === ids.lockp)).toHaveLength(0);
    for (const [path, id] of [
      ['leave/requests', ids.leave],
      ['wfh', ids.wfh],
      ['official-duty', ids.od],
    ]) {
      const page = (await api().get(`/api/${path}/${id}`).set('Cookie', hr).expect(200)).body as Flagged;
      expect(page.payrollLocked).toEqual([]);
    }
    const rows = await prisma.payrollLockedChange.findMany({ where: { employeeId: ids.lockp }, select: { handledHow: true } });
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.every((r) => r.handledHow === 'by_hand' || r.handledHow === 'refilled')).toBe(true);
    expect(rows.filter((r) => r.handledHow === 'refilled').length).toBeGreaterThanOrEqual(4);
    // the draft is worked out with the requests as they are now: the leave was cancelled again, so its day is a no-show
    // once more; the work from home day and the official duty fall on days the person came in anyway
    const line = (await runOf(LOCK)).lines.find((l) => l.employeeId === ids.lockp)!;
    expect(line.inputs.noShowDays).toBe(1);
    expect(line.terms.leave).toBeUndefined();
  });

  it('says nothing for a month whose payroll is still a draft', async () => {
    const made = (await recordLeave('draftp', 'annual', work[3]).expect(201)).body as Flagged;
    expect(made.warnings).toBeUndefined();
    expect(made.payrollLocked).toEqual([]);
    expect(rowsOf(await unsettled(), made.id)).toHaveLength(0);
    const l = await lineOf('draftp');
    expect(l.terms.leave).toEqual({ paidDays: 1, unpaidDays: 0 });
  });
});
