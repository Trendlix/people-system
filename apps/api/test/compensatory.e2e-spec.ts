import type { INestApplication } from '@nestjs/common';
import { zonedMoment } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { KpiAttendanceService } from '../src/kpis/kpi-attendance.service.js';
import { firstDay, lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Compensatory days (owner, 26 October 2026: "my compensatory is a compensation with another day in the same month. and
// rarely to be compensated in cash"; "if paid in cash make it 1.5"; "if the day is compensated with a day, we pay
// nothing"; packages/shared compensatory.ts): asked from My Requests, decided by the approver in charge then HR (a
// C-level person's HR stage the CEO's), HR approving it as a day off or cash instead; the day off a full paid day in the
// attendance and the draft payroll with no money added anywhere (the line's figures equal those of the same month when
// the day off is simply worked); cash instead a Bonus (days) addition of 1.5 days on the month's draft; the refusals
// (another month, a working day worked, a locked month); HR recording a past one; cancelling; a developer masked. These
// tests look at their own people (names end with RUN) and delete what they made. Every name and reason is invented.

const RUN = `cp${Date.now().toString(36).toLowerCase()}`;
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const NEXT = monthsLater(CURRENT, 1);
const MONTH = monthsLater(CURRENT, -4); // its days past; a draft run
const PAID = monthsLater(CURRENT, -7); // a paid run
// asking needs a day worked up to today and a day off from tomorrow, in one month
const CAN_ASK = addDays(TODAY, 1).startsWith(CURRENT);

interface View {
  id: string;
  kind: 'compensatory';
  employee: { id: string; fullNameEn: string };
  type: { nameEn: string };
  dayWorked: string;
  dayOff: string | null;
  reason: string | null;
  status: string;
  stage: string | null;
  outcome: string | null;
  cashDays: number;
  noCheckIn: boolean | null;
  waitingForYou: boolean;
  confidential: boolean;
  canCancel: boolean;
  hrCanCancel: boolean;
  manager: { id: string; role: string } | null;
  rejectReason: string | null;
  recordedByHr: boolean;
  warnings: string[];
  steps: { kind: string; decision: string | null; comment: string | null }[];
}

interface DayView {
  date: string;
  status: string;
  hoursCounted: number;
  shortHours: number;
  exempt: boolean;
  compensatory: boolean;
  compensated: boolean;
  checkIn: string | null;
}

interface Line {
  employeeId: string;
  inputs: { workedHours: number | null; noShowDays: number | null };
  terms: { adjustments?: { id: string; type: string; days?: number; reason: string }[] };
  result: { earned: number; net: number; attendanceScore: number; noShowCut: number; overtime: number; adjustments: { id: string; amount: number }[] };
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

describe('Compensatory days (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrUserId: string;
  let hrSuper: string;
  let ceo: string;
  let ceoUserId: string;
  let developer: string;
  let deptId: string;
  let emailDomainBefore: string | null;
  let holidayCurrent = false;
  const shifts: Record<string, string> = {};
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const people: string[] = [];
  const runs: Record<string, string> = {};
  const holidaysMade: string[] = [];
  const work: string[] = []; // MONTH's Sundays to Thursdays, none a holiday
  let rest: string; // a Friday of MONTH
  const api = () => request(app.getHttpServer());
  const at = (date: string, time: string) => new Date(zonedMoment(date, time));

  /** A person hired with a signed contract (`contract` null: hired with none). */
  async function person(key: string, name: string, shift: string, employment: Record<string, unknown> = {}, by = () => hr, contract: Record<string, unknown> | null = null) {
    const email = await createUser(prisma, ['employee']);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    const res = await api().post('/api/employees').set('Cookie', by()).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', by())
      .send({ employmentType: 'full_time', joinDate: contract ? firstDay(monthsLater(PAID, -2)) : '2024-01-01', departmentId: deptId, shiftId: shifts[shift], workArrangement: 'office', ...employment })
      .expect(201);
    if (!contract) return;
    const draft = (await api().post(`/api/employees/${res.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', by()).send({ grossSalary: 15000, durationMonths: 36, ...contract }).expect(201)).body as {
      id: string;
      startDate: string;
    };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', by()).send({ signedOn: draft.startDate }).expect(200);
  }

  const ask = (key: string, body: Record<string, unknown>) => api().post('/api/me/compensatory').set('Cookie', sessions[key]).send(body);
  const record = (key: string, body: Record<string, unknown>, session = hr) => api().post('/api/compensatory').set('Cookie', session).send({ employeeId: ids[key], ...body });
  const decide = (id: string, session: string, body: object = { decision: 'approve' }) => api().post(`/api/compensatory/${id}/decide`).set('Cookie', session).send(body);
  const one = async (id: string, session = hr) => (await api().get(`/api/compensatory/${id}`).set('Cookie', session).expect(200)).body as View;
  const inbox = (key: string | { userId: string }) =>
    prisma.notification.findMany({ where: { userId: typeof key === 'string' ? users[key] : key.userId, kind: { startsWith: 'compensatory_' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { kind: true, title: true, body: true, link: true } });
  const monthOf = async (key: string, month = MONTH) =>
    (await api().get(`/api/attendance/employees/${ids[key]}?month=${month}`).set('Cookie', hr).expect(200)).body as { person: { days: DayView[]; figures: { absentDays: number; shortHours: number; compensatoryDays: number; exemptDays: number } } };
  const lineOf = async (key: string, month = MONTH) =>
    ((await api().get(`/api/payroll/runs/${runs[month]}`).set('Cookie', hrSuper).expect(200)).body.lines as Line[]).find((l) => l.employeeId === ids[key])!;
  const adjustments = (key: string) => prisma.payrollAdjustment.findMany({ where: { employeeId: ids[key] }, orderBy: { createdAt: 'asc' } });
  /** A kept 9-hour day on the system. */
  const kept = (key: string, date: string) =>
    prisma.attendanceDay.create({
      data: {
        employeeId: ids[key],
        date: toDateOnly(date),
        status: 'worked',
        checkIn: at(date, '09:00'),
        checkOut: at(date, '18:00'),
        place: 'office',
        hoursCounted: 9,
        source: 'system',
        importedById: hrUserId,
        pairs: [{ in: at(date, '09:00').toISOString(), out: at(date, '18:00').toISOString() }],
        breakMinutes: 0,
      },
    });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrUserId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } })).id;
    const ceoEmail = await createUser(prisma, ['ceo']);
    ceo = await signIn(app, ceoEmail);
    ceoUserId = (await prisma.user.findUniqueOrThrow({ where: { email: ceoEmail } })).id;
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    developer = await signIn(app, await createUser(prisma, ['employee', 'developer']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Compensatory Dept ${RUN}` }).expect(201)).body.id;
    const shift = async (key: string, workingDays: number[]) => {
      shifts[key] = (
        await prisma.shift.create({
          data: { code: `${key}${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('19:00'), hoursPerDay: 9, graceMinutes: 15, workingDays },
          select: { id: true },
        })
      ).id;
    };
    // Sunday to Thursday (Friday and Saturday rest); and every day of the week
    await shift('M', [0, 1, 2, 3, 4]);
    await shift('W', [0, 1, 2, 3, 4, 5, 6]);
    // the owner's cash rate, whatever an earlier test left
    await api().patch('/api/compensatory/settings').set('Cookie', hr).send({ cashRate: 1.5 }).expect(200);
    const holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)));
    for (let d = firstDay(MONTH); d <= lastDay(MONTH); d = addDays(d, 1)) if (weekday(d) <= 4 && !holidays.has(d)) work.push(d);
    rest = [...Array(7).keys()].map((n) => addDays(firstDay(MONTH), n)).find((d) => weekday(d) === 5 && !holidays.has(d))!;
    // an official holiday on the first of this month, the day worked of the requests asked here
    if (!holidays.has(firstDay(CURRENT))) {
      await prisma.holiday.create({ data: { date: toDateOnly(firstDay(CURRENT)), nameEn: `Compensatory Day ${RUN}` } });
      holidaysMade.push(firstDay(CURRENT));
    }
    holidayCurrent = true;

    // payroll: two people with the same contract, Pam (the day off compensated) and Cal (the control: the day off worked)
    await person('pam', 'Pam Payroll', 'M', {}, () => hr, {});
    await person('cal', 'Cal Control', 'M', {}, () => hr, {});
    // the cash ones
    await person('cash', 'Cash Payroll', 'M', {}, () => hr, {});
    await person('cleo2', 'Cora Cashnone', 'M', {}, () => hr, {});
    for (const d of work) {
      if (d !== work[5]) await kept('pam', d);
      await kept('cal', d);
      if (d !== work[6]) await kept('cash', d);
      if (d !== work[6]) await kept('cleo2', d);
    }
    // Pam also worked a rest day (Friday): kept, earning nothing on its own
    await kept('pam', rest);
    runs[MONTH] = (await api().post('/api/payroll/runs').set('Cookie', hrSuper).send({ month: MONTH }).expect(201)).body.id;
    runs[PAID] = (await api().post('/api/payroll/runs').set('Cookie', hrSuper).send({ month: PAID }).expect(201)).body.id;
    await prisma.payrollRun.update({ where: { id: runs[PAID] }, data: { status: 'paid', submittedAt: new Date(), approvedAt: new Date() } });

    // asking: the approver in charge, a team without a manager, a C-level person, a freelancer
    await person('mona', 'Mona Manager', 'W');
    await person('ben', 'Ben Asking', 'W', { managerId: ids.mona });
    await person('bea', 'Bea Cash', 'W', { managerId: ids.mona });
    await person('wid', 'Wid Withdraws', 'W', { managerId: ids.mona });
    await person('nia', 'Nia Notice', 'W', { managerId: ids.mona });
    await person('lee', 'Lee Leave', 'W', { managerId: ids.mona });
    await person('hana', 'Hana Hr', 'W', { managerId: ids.mona });
  });

  afterAll(async () => {
    await prisma.compensatoryRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.payrollRun.deleteMany({ where: { id: { in: Object.values(runs) } } });
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: { in: Object.values(shifts) } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    if (holidayCurrent) for (const d of holidaysMade) await prisma.holiday.deleteMany({ where: { date: toDateOnly(d) } });
    await api().patch('/api/compensatory/settings').set('Cookie', hr).send({ cashRate: 1.5 }).expect(200);
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('Leave Setup', () => {
    it('has the owner’s 1.5 days’ pay for cash instead; HR changes it, audited; an employee can read it only', async () => {
      expect((await api().get('/api/compensatory/settings').set('Cookie', sessions.ben).expect(200)).body).toEqual({ cashRate: 1.5 });
      await api().patch('/api/compensatory/settings').set('Cookie', sessions.ben).send({ cashRate: 2 }).expect(403);
      expect(said(await api().patch('/api/compensatory/settings').set('Cookie', hr).send({ cashRate: 1.25 }).expect(400))).toEqual([
        "Enter the days' pay for cash instead in whole or half days from 0.5 to 5, e.g. 1.5.",
      ]);
      expect((await api().patch('/api/compensatory/settings').set('Cookie', hr).send({ cashRate: 2 }).expect(200)).body).toEqual({ cashRate: 2 });
      const log = await prisma.auditLog.findFirst({ where: { entityType: 'leave_settings', userId: hrUserId }, orderBy: { id: 'desc' } });
      expect(log?.diff).toEqual({ compensatoryCashRate: { from: 1.5, to: 2 } });
      await api().patch('/api/compensatory/settings').set('Cookie', hr).send({ cashRate: 1.5 }).expect(200);
    });
  });

  describe('a day off: HR records one in a past month', () => {
    let recorded: View;

    it('refuses what the rules refuse, every reason: a working day worked, another month, a rest day off, either in a paid month', async () => {
      // the day worked is a working day, the day off another month
      const nextSunday = weekdayOn(monthsLater(MONTH, 1), 0);
      expect(said(await record('pam', { dayWorked: work[1], dayOff: nextSunday, reason: 'Tried' }).expect(400))).toEqual([
        `${shown(work[1])} is a working day of Pam Payroll ${RUN}'s shift, not a rest day or an official holiday: there is nothing to compensate.`,
        `The day off must be in the same month as the day worked: ${shown(work[1])} is in ${shownMonth(MONTH)}, ${shown(nextSunday)} in ${shownMonth(monthsLater(MONTH, 1))}.`,
      ]);
      // the day off a rest day
      expect(said(await record('pam', { dayWorked: rest, dayOff: addDays(rest, 1), reason: 'Tried' }).expect(400))[0]).toContain('is a rest day of Pam Payroll');
      // a month whose payroll is paid
      const paidRest = [...Array(7).keys()].map((n) => addDays(firstDay(PAID), n)).find((d) => weekday(d) === 5)!;
      const paidWork = [...Array(14).keys()].map((n) => addDays(firstDay(PAID), n)).find((d) => weekday(d) === 1)!;
      expect(said(await record('pam', { dayWorked: paidRest, dayOff: paidWork, reason: 'Late' }).expect(409))[0]).toMatch(/payroll is marked paid, so its days can't change/);
      // a reason is required of HR; not their own; an employee can't record
      expect(said(await record('pam', { dayWorked: rest, dayOff: work[5] }).expect(400))).toEqual(['Write why HR records this compensatory day.']);
      await record('pam', { dayWorked: rest, dayOff: work[5], reason: 'x' }, sessions.ben).expect(403);
    });

    it('before it, Pam’s line has the day off as a no-show and the rest day’s hours counted', async () => {
      const line = await lineOf('pam');
      expect(line.inputs.noShowDays).toBe(1);
      expect(line.inputs.workedHours).toBe(9 * work.length);
      const control = await lineOf('cal');
      expect(control.inputs).toMatchObject({ noShowDays: 0, workedHours: 9 * work.length });
    });

    it('records it approved at once, with a warning for the day off past, audited; the draft line is refilled', async () => {
      recorded = (await record('pam', { dayWorked: rest, dayOff: work[5], reason: `Worked the Friday ${RUN}` }).expect(201)).body as View;
      expect(recorded).toMatchObject({
        kind: 'compensatory',
        type: { nameEn: 'Compensatory day off' },
        dayWorked: rest,
        dayOff: work[5],
        status: 'approved',
        outcome: 'day_off',
        recordedByHr: true,
        hrCanCancel: true,
        warnings: [`${shown(work[5])} has gone by: it is recorded without a day's notice.`],
      });
      expect(recorded.steps.map((s) => s.kind)).toEqual(['recorded_by_hr']);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'compensatory_request', entityId: recorded.id } });
      expect(audit).toMatchObject({ action: 'record', userId: hrUserId });
      expect(audit.diff).toMatchObject({ employeeId: ids.pam, dayWorked: rest, dayOff: work[5], outcome: 'day_off' });
      // the same day claimed twice, or the same day off twice
      expect(said(await record('pam', { dayWorked: rest, dayOff: work[4], reason: 'Again' }).expect(400))[0]).toContain(`asked to compensate ${shown(rest)} already`);
    });

    it('shows the day off as Compensatory day off, a full paid day: never absent or short; the day worked keeps its check-in', async () => {
      const month = await monthOf('pam');
      const off = month.person.days.find((d) => d.date === work[5])!;
      expect(off).toMatchObject({ status: 'worked', hoursCounted: 9, exempt: true, compensatory: true, shortHours: 0 });
      expect(month.person.figures).toMatchObject({ absentDays: 0, shortHours: 0, compensatoryDays: 1, exemptDays: 0 });
      expect(month.person.days.find((d) => d.date === rest)).toMatchObject({ status: 'worked', checkIn: at(rest, '09:00').toISOString(), compensated: true, compensatory: false });
      const history = (await api().get(`/api/attendance/employees/${ids.pam}/history?period=custom&from=${firstDay(MONTH)}&to=${lastDay(MONTH)}`).set('Cookie', hr).expect(200)).body;
      expect(history.figures).toMatchObject({ compensatoryDays: 1, absences: 0, lateDays: 0 });
      expect(history.log.days.find((d: { date: string }) => d.date === work[5])).toMatchObject({ mode: 'compensatory', onTime: true });
    });

    it('pays nothing for it: the draft line equals the control’s, who simply worked the day (no-show gone, hours not above)', async () => {
      const pam = await lineOf('pam');
      const cal = await lineOf('cal');
      expect(pam.inputs).toEqual(cal.inputs);
      expect(pam.inputs).toMatchObject({ noShowDays: 0, workedHours: 9 * work.length });
      expect(pam.result.earned).toBe(cal.result.earned);
      expect(pam.result.net).toBe(cal.result.net);
      expect(pam.result).toMatchObject({ noShowCut: 0, overtime: 0, attendanceScore: 1 });
      expect(pam.terms.adjustments ?? []).toEqual([]);
      // the KPIs' attendance ignores the day off: full
      expect((await app.get(KpiAttendanceService).readMonth(MONTH, [ids.pam])).get(ids.pam)).toMatchObject({ source: 'payroll', score: 1 });
      expect(await adjustments('pam')).toEqual([]);
      // nothing comes off any leave balance: no leave was made
      expect(await prisma.leaveRequest.count({ where: { employeeId: ids.pam } })).toBe(0);
    });

    it('keeps the figures equal even if overtime were paid: the day worked’s hours are left out of the month', async () => {
      const month = await monthOf('pam');
      const hours = month.person.days.filter((d) => d.status === 'worked' && !d.compensated).reduce((n, d) => n + d.hoursCounted, 0);
      expect(hours).toBe(9 * work.length);
    });

    it('is shown on the leave calendar and the lists', async () => {
      const items = (await api().get(`/api/compensatory/calendar?from=${firstDay(MONTH)}&to=${lastDay(MONTH)}`).set('Cookie', hr).expect(200)).body as { kind: string; startDate: string; type: { nameEn: string } }[];
      expect(items).toEqual([expect.objectContaining({ kind: 'compensatory', startDate: work[5], type: expect.objectContaining({ nameEn: 'Compensatory day off' }) })]);
      const listed = (await api().get(`/api/compensatory?employeeId=${ids.pam}&from=${firstDay(MONTH)}&to=${lastDay(MONTH)}`).set('Cookie', hr).expect(200)).body as View[];
      expect(listed.map((r) => r.id)).toEqual([recorded.id]);
      expect((await api().get(`/api/compensatory?employeeId=${ids.pam}&status=waiting`).set('Cookie', hr).expect(200)).body).toEqual([]);
    });

    it('is cancelled by HR with a reason: the day off is a working day again (a no-show), the hours count again', async () => {
      expect(said(await api().post(`/api/compensatory/${recorded.id}/cancel`).set('Cookie', hr).send({ comment: '' }).expect(400))).toEqual(['Write why the compensatory day is cancelled.']);
      await api().post(`/api/compensatory/${recorded.id}/cancel`).set('Cookie', sessions.ben).send({ comment: 'No' }).expect(403);
      const cancelled = (await api().post(`/api/compensatory/${recorded.id}/cancel`).set('Cookie', hr).send({ comment: 'Recorded for the wrong day' }).expect(200)).body as View;
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.steps.at(-1)).toMatchObject({ kind: 'cancelled', comment: 'Recorded for the wrong day' });
      expect((await monthOf('pam')).person.days.find((d) => d.date === work[5])).toMatchObject({ status: 'absent', compensatory: false });
      expect(await lineOf('pam')).toMatchObject({ inputs: { noShowDays: 1, workedHours: 9 * work.length } });
      expect(await prisma.auditLog.count({ where: { entityType: 'compensatory_request', entityId: recorded.id, action: 'cancel' } })).toBe(1);
      // and it can be recorded again
      await record('pam', { dayWorked: rest, dayOff: work[5], reason: 'Right day this time' }).expect(201);
      expect(await lineOf('pam')).toMatchObject({ inputs: { noShowDays: 0 } });
    });
  });

  describe('cash instead', () => {
    let cashDays: View;

    it('is recorded by HR without a day off: an addition of 1.5 days on the month’s draft, the day off still a no-show', async () => {
      const before = await lineOf('cash');
      expect(before.inputs.noShowDays).toBe(1);
      cashDays = (await record('cash', { dayWorked: rest, outcome: 'cash', reason: `Cash please ${RUN}` }).expect(201)).body as View;
      expect(cashDays).toMatchObject({ status: 'approved', outcome: 'cash', dayOff: null, cashDays: 1.5 });
      const [row] = await adjustments('cash');
      expect(row).toMatchObject({ kind: 'addition', type: 'bonus_days', taxed: true, status: 'pending', reason: `Compensation for working ${shown(cashDays.dayWorked)}` });
      expect(row.days?.toNumber()).toBe(1.5);
      expect(fromDateOnly(row.month)).toBe(firstDay(MONTH));
      const after = await lineOf('cash');
      expect(after.terms.adjustments).toEqual([expect.objectContaining({ id: row.id, type: 'bonus_days', days: 1.5 })]);
      const paid = after.result.adjustments.find((a) => a.id === row.id)!.amount;
      expect(paid).toBeGreaterThan(0);
      expect(after.result.net).toBeGreaterThan(before.result.net);
      // the day off is not counted: still a no-show
      expect(after.inputs.noShowDays).toBe(1);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'payroll_adjustment', entityId: row.id } });
      expect(audit.diff).toMatchObject({ month: MONTH, kind: 'addition', type: 'bonus_days', days: 1.5, compensatoryId: cashDays.id });
    });

    it('is the payroll’s day-pay rule: 1.5 days is one and a half of a day’s pay', async () => {
      const [row] = await adjustments('cash');
      // a day of the same rule, entered by hand beside it
      const manual = (
        await api().post('/api/payroll/adjustments').set('Cookie', hrSuper).send({ employeeId: ids.cash, month: MONTH, kind: 'addition', type: 'bonus_days', days: 3, reason: 'A comparison' }).expect(201)
      ).body as { id: string };
      const line = await lineOf('cash');
      const cash = line.result.adjustments.find((a) => a.id === row.id)!.amount;
      const three = line.result.adjustments.find((a) => a.id === manual.id)!.amount;
      expect(cash).toBeCloseTo(three / 2, 1);
      await api().post(`/api/payroll/adjustments/${manual.id}/cancel`).set('Cookie', hrSuper).expect(200);
    });

    it('is cancelled by HR with the addition: the line is back as it was', async () => {
      const [row] = await adjustments('cash');
      await api().post(`/api/compensatory/${cashDays.id}/cancel`).set('Cookie', hr).send({ comment: 'Not paid after all' }).expect(200);
      expect((await prisma.payrollAdjustment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('cancelled');
      const line = await lineOf('cash');
      expect(line.terms.adjustments ?? []).toEqual([]);
      expect(line.result.adjustments ?? []).toEqual([]);
    });

    it('follows the Leave Setup’s rate', async () => {
      await api().patch('/api/compensatory/settings').set('Cookie', hr).send({ cashRate: 2 }).expect(200);
      const made = (await record('cleo2', { dayWorked: weekdayOn(MONTH, 6), outcome: 'cash', reason: 'Rate test' }).expect(201)).body as View;
      expect(made.cashDays).toBe(2);
      const [row] = await adjustments('cleo2');
      expect(row.days?.toNumber()).toBe(2);
      await api().patch('/api/compensatory/settings').set('Cookie', hr).send({ cashRate: 1.5 }).expect(200);
    });
  });

  describe.skipIf(!CAN_ASK)('asking from My Requests, this month', () => {
    const dayWorked = firstDay(CURRENT);
    const tomorrow = addDays(TODAY, 1);
    let asked: View;

    it('offers the form: the shift’s working days, the holidays, the days taken', async () => {
      const form = (await api().get('/api/me/compensatory/form').set('Cookie', sessions.ben).expect(200)).body;
      expect(form).toMatchObject({ refusal: null, offered: true, today: TODAY, cashDays: 1.5, workingDays: [0, 1, 2, 3, 4, 5, 6] });
      expect(form.holidays).toEqual(expect.arrayContaining([expect.objectContaining({ date: dayWorked })]));
    });

    it('goes to the direct manager, then HR, every step logged and told; a day worked with no check-in needs HR’s confirmation', async () => {
      asked = (await ask('ben', { dayWorked, dayOff: tomorrow, reason: 'Worked the holiday' }).expect(201)).body as View;
      expect(asked).toMatchObject({ status: 'with_manager', stage: 'manager', dayWorked, dayOff: tomorrow, canCancel: true, hrCanCancel: false, manager: { id: ids.mona, role: 'direct_manager' }, noCheckIn: true, outcome: null });
      expect(asked.steps.map((s) => s.kind)).toEqual(['submitted']);
      expect((await inbox('mona')).at(-1)).toMatchObject({ kind: 'compensatory_waiting', title: 'A compensatory day request is waiting for you', link: `/attendance/compensatory/${asked.id}` });
      // not HR's yet, nor anyone else's
      await decide(asked.id, sessions.ben).expect(403);
      expect(said(await decide(asked.id, hr).expect(409))[0]).toContain("isn't waiting for your decision");
      expect((await decide(asked.id, sessions.mona).expect(200)).body).toMatchObject({ status: 'with_hr', stage: 'hr' });
      // HR: the day worked has no check-in kept
      expect(said(await decide(asked.id, hr).expect(409))[0]).toContain(`No check-in is kept on ${shown(dayWorked)}`);
      // a check-in kept: no confirmation is needed
      const approved = (await decide(asked.id, hr, { decision: 'approve', confirmNoCheckIn: true }).expect(200)).body as View;
      expect(approved).toMatchObject({ status: 'approved', outcome: 'day_off', hrCanCancel: true });
      expect(approved.steps.map((s) => (s.decision ? `${s.kind}:${s.decision}` : s.kind))).toEqual(['submitted', 'manager_decision:approve', 'hr_decision:approve']);
      expect((await inbox('ben')).at(-1)).toMatchObject({ kind: 'compensatory_decided', title: 'Compensatory day request approved' });
      expect(await prisma.auditLog.count({ where: { entityType: 'compensatory_request', entityId: asked.id, action: 'approve' } })).toBe(2);
      // the day off is on the calendar, nothing was added to any payroll
      const items = (await api().get(`/api/compensatory/calendar?from=${tomorrow}&to=${tomorrow}`).set('Cookie', hr).expect(200)).body as { employee: { id: string } }[];
      expect(items.map((i) => i.employee.id)).toContain(ids.ben);
      expect(await adjustments('ben')).toEqual([]);
    });

    it('refuses the same day worked, and the same day off, a second time', async () => {
      expect(said(await ask('ben', { dayWorked, dayOff: addDays(tomorrow, 1) }).expect(400))[0]).toContain(`asked to compensate ${shown(dayWorked)} already`);
    });

    it('is refused with every reason: a day off in another month, today, a past day, a working day worked', async () => {
      // another month
      expect(said(await ask('nia', { dayWorked, dayOff: addDays(firstDay(NEXT), 4) }).expect(400))).toEqual([
        `The day off must be in the same month as the day worked: ${shown(dayWorked)} is in ${shownMonth(CURRENT)}, ${shown(addDays(firstDay(NEXT), 4))} in ${shownMonth(NEXT)}.`,
      ]);
      // today and the past: the notice
      expect(said(await ask('nia', { dayWorked, dayOff: TODAY }).expect(400))).toEqual([`${shown(TODAY)} is today: ask for a compensatory day a day before the day off at the latest.`]);
      // a day still to come as the day worked, which is also a working day
      const later = addDays(firstDay(NEXT), 2);
      expect(said(await ask('nia', { dayWorked: later, dayOff: addDays(later, 1) }).expect(400))[0]).toContain('is a working day of your shift');
    });

    it('is refused when the day off is already leave, work from home, official duty or another day off', async () => {
      const type = await prisma.leaveType.findUniqueOrThrow({ where: { key: 'unpaid' }, select: { id: true } });
      const employment = await prisma.employment.findFirstOrThrow({ where: { employeeId: ids.lee, endDate: null }, select: { id: true } });
      await prisma.leaveRequest.create({ data: { employeeId: ids.lee, employmentId: employment.id, typeId: type.id, startDate: toDateOnly(tomorrow), endDate: toDateOnly(tomorrow), days: 1, status: 'approved', createdById: hrUserId } });
      expect(said(await ask('lee', { dayWorked, dayOff: tomorrow }).expect(400))).toEqual([`You have Unpaid leave on ${shown(tomorrow)} (approved): it is a day off already.`]);
      await prisma.wfhRequest.create({
        data: { employeeId: ids.nia, employmentId: (await prisma.employment.findFirstOrThrow({ where: { employeeId: ids.nia, endDate: null }, select: { id: true } })).id, date: toDateOnly(tomorrow), status: 'approved', recordedByHr: true },
      });
      expect(said(await ask('nia', { dayWorked, dayOff: tomorrow }).expect(400))).toEqual([`You have a work from home day on ${shown(tomorrow)} already.`]);
      await prisma.wfhRequest.deleteMany({ where: { employeeId: ids.nia } });
    });

    it('is withdrawn by the employee while it is being decided, never once approved; rejected with a comment', async () => {
      const mine = (await ask('wid', { dayWorked, dayOff: tomorrow }).expect(201)).body as View;
      const withdrawn = (await api().post(`/api/me/compensatory/${mine.id}/cancel`).set('Cookie', sessions.wid).expect(200)).body as View;
      expect(withdrawn).toMatchObject({ status: 'cancelled', canCancel: false });
      const again = (await ask('wid', { dayWorked, dayOff: tomorrow }).expect(201)).body as View;
      expect(said(await decide(again.id, sessions.mona, { decision: 'reject' }).expect(400))).toEqual(['Write a comment: why the compensatory day is rejected.']);
      expect((await decide(again.id, sessions.mona, { decision: 'reject', comment: 'We need you that day' }).expect(200)).body).toMatchObject({ status: 'rejected', rejectReason: 'We need you that day' });
      expect((await inbox('wid')).at(-1)).toMatchObject({ kind: 'compensatory_decided', title: 'Compensatory day request rejected' });
      expect(said(await api().post(`/api/me/compensatory/${asked.id}/cancel`).set('Cookie', sessions.ben).expect(409))[0]).toContain('approved, so it can no longer be cancelled here');
    });

    it('is approved by HR as cash instead: no day off taken, the addition on this month’s payroll', async () => {
      const mine = (await ask('bea', { dayWorked, dayOff: tomorrow }).expect(201)).body as View;
      await decide(mine.id, sessions.mona).expect(200);
      expect(said(await decide(mine.id, hr, { decision: 'approve', outcome: 'cash' }).expect(409))[0]).toContain('No check-in is kept');
      const approved = (await decide(mine.id, hr, { decision: 'approve', outcome: 'cash', confirmNoCheckIn: true }).expect(200)).body as View;
      expect(approved).toMatchObject({ status: 'approved', outcome: 'cash', cashDays: 1.5 });
      const [row] = await adjustments('bea');
      expect(row).toMatchObject({ type: 'bonus_days', status: 'pending', reason: `Compensation for working ${shown(dayWorked)}` });
      expect(fromDateOnly(row.month)).toBe(firstDay(CURRENT));
      // its day off is free again: a cash one takes no day
      const items = (await api().get(`/api/compensatory/calendar?from=${tomorrow}&to=${tomorrow}`).set('Cookie', hr).expect(200)).body as { employee: { id: string } }[];
      expect(items.map((i) => i.employee.id)).not.toContain(ids.bea);
      await api().post(`/api/compensatory/${mine.id}/cancel`).set('Cookie', hr).send({ comment: 'Not cash' }).expect(200);
      expect((await prisma.payrollAdjustment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('cancelled');
    });

    it('is a C-level person’s to the CEO: HR neither sees, decides nor is told of it', async () => {
      const g9 = ((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((g) => g.code === 'G9')!;
      await person('cleo', 'Cleo Chief', 'W', { departmentId: null, gradeId: g9.id }, () => hrSuper);
      const mine = (await ask('cleo', { dayWorked, dayOff: tomorrow }).expect(201)).body as View;
      expect(mine).toMatchObject({ status: 'with_hr', confidential: true });
      await api().get(`/api/compensatory/${mine.id}`).set('Cookie', hr).expect(404);
      await decide(mine.id, hr).expect(404);
      expect(((await api().get('/api/compensatory').set('Cookie', hr).expect(200)).body as View[]).map((r) => r.id)).not.toContain(mine.id);
      expect((await inbox({ userId: ceoUserId })).map((n) => n.link)).toContain(`/attendance/compensatory/${mine.id}`);
      expect((await inbox({ userId: hrUserId })).map((n) => n.link)).not.toContain(`/attendance/compensatory/${mine.id}`);
      expect((await decide(mine.id, ceo, { decision: 'approve', confirmNoCheckIn: true }).expect(200)).body).toMatchObject({ status: 'approved', confidential: true });
    });

    it('counts what waits for the approver', async () => {
      const mine = (await ask('hana', { dayWorked, dayOff: tomorrow }).expect(201)).body as View;
      expect((await api().get('/api/compensatory/counts').set('Cookie', sessions.mona).expect(200)).body).toEqual({ waiting: 1 });
      expect(((await api().get('/api/compensatory?status=waiting').set('Cookie', sessions.mona).expect(200)).body as View[]).map((r) => r.id)).toEqual([mine.id]);
      await api().post(`/api/me/compensatory/${mine.id}/cancel`).set('Cookie', sessions.hana).expect(200);
    });
  });

  describe('a developer', () => {
    it('sees pseudonyms and no reasons, comments or amounts, and decides nothing', async () => {
      const [first] = (await api().get(`/api/compensatory?employeeId=${ids.pam}`).set('Cookie', developer).expect(200)).body as View[];
      expect(first.reason).toBe('••••');
      expect(first.employee.fullNameEn).not.toContain(RUN);
      const text = JSON.stringify((await api().get(`/api/compensatory?employeeId=${ids.cash}`).set('Cookie', developer).expect(200)).body);
      expect(text).not.toMatch(/amount/i);
      expect(text).not.toContain(RUN);
      expect((await api().get('/api/compensatory/settings').set('Cookie', developer).expect(200)).body).toEqual({ cashRate: 1.5 });
      await api().post(`/api/compensatory/${first.id}/decide`).set('Cookie', developer).send({ decision: 'approve' }).expect(403);
      await api().post('/api/compensatory').set('Cookie', developer).send({ employeeId: ids.pam, dayWorked: rest, dayOff: work[4], reason: 'x' }).expect(403);
    });
  });
});

/** "November 2026". */
function shownMonth(month: string): string {
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** The first date of `month` on the weekday `wd` (0 = Sunday). */
function weekdayOn(month: string, wd: number): string {
  return [...Array(7).keys()].map((n) => addDays(firstDay(month), n)).find((d) => weekday(d) === wd)!;
}
