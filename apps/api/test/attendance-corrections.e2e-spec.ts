import type { INestApplication } from '@nestjs/common';
import { correctionAskFrom, zonedMoment } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { vi } from 'vitest';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { firstDay, lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Attendance corrections (owner, 19 October 2026, "Proceed with those": "Attendance corrections with approval ("I forgot
// to check out")"). An employee asks to correct a day (what was wrong, the right times, why), decided as leave is: the
// direct manager (else the team lead, else the department's head) then HR, a C-level person's HR stage by the CEO; every
// step logged; cancelled while open; refused for a day still to come, a month whose payroll is approved, a day already
// asked for. Approved, the day is kept as source 'correction' over the day it corrects (which stays), shown corrected
// from it, its hours counted again, the month's draft payroll line refilled, in the audit log; never while the month's
// payroll is with the CEO. HR corrects a day directly. A correction of today takes a later check-out. These tests look
// at their own people (names end with RUN) and delete what they made. Every name is invented.

// These tests ask about days months gone by (each month's payroll in its own state), so the time to ask (owner, 31
// October 2026: "locked after 2 working days"; correction-window.ts) is held open for them; 'the time to ask' tests it.
const window = vi.hoisted(() => ({ open: true }));
vi.mock('../src/attendance/correction-window.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/attendance/correction-window.js')>();
  return { ...real, correctionAskFromFor: (...args: Parameters<typeof real.correctionAskFromFor>) => (window.open ? Promise.resolve('2000-01-01') : real.correctionAskFromFor(...args)) };
});

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const PAST = monthsLater(CURRENT, -2); // its days are past; a draft run
const LOCKED = monthsLater(CURRENT, -5); // its run approved
const WITH_CEO = monthsLater(CURRENT, -6); // its run with the CEO

interface Correction {
  id: string;
  kind: 'correction';
  employee: { id: string; fullNameEn: string };
  date: string;
  correctionKind: string;
  checkIn: string | null;
  checkOut: string | null;
  reason: string;
  dayBefore: { status: string; checkIn: string | null; checkOut: string | null; source: string } | null;
  status: string;
  stage: string | null;
  waitingForYou: boolean;
  canCancel: boolean;
  confidential: boolean;
  manager: { id: string; role: string } | null;
  rejectedStage: string | null;
  rejectReason: string | null;
  recordedByHr: boolean;
  appliedAt: string | null;
  steps: { kind: string; decision: string | null; comment: string | null }[];
}

interface PersonView {
  person: { days: { date: string; source: string; status: string; checkIn: string | null; checkOut: string | null; hoursCounted: number; correctedFrom?: unknown; correctionId?: string | null }[] };
  corrections: { id: string; date: string; status: string }[];
  correctable: { allowed: boolean; reason: string | null };
  canCorrect: boolean;
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

describe('Attendance corrections (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  let hrSuper: string;
  let hrUserId: string;
  let hrEmployeeId: string;
  let emailDomainBefore: string | null;
  let deptId: string;
  let teamId: string;
  let shiftId: string;
  let pastRun: string;
  const runs: string[] = [];
  const sessions: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const people: string[] = [];
  const work: Record<string, string[]> = {}; // each month's Sundays to Thursdays, none of them a holiday
  const api = () => request(app.getHttpServer());
  const at = (date: string, time: string) => new Date(zonedMoment(date, time)).toISOString();

  /** A profile with a sign-in account, employed from a year before PAST, under a signed contract when `signed`. */
  async function person(key: string, who: string, employment: Record<string, unknown> = {}, opts: { signed?: boolean; roles?: ('employee' | 'manager')[]; session?: () => string } = {}) {
    const email = await createUser(prisma, opts.roles ?? ['employee']);
    const session = opts.session ?? (() => hr);
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${who} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', session())
      .send({ employmentType: 'full_time', joinDate: firstDay(monthsLater(LOCKED, -6)), departmentId: deptId, shiftId, ...employment })
      .expect(201);
    if (opts.signed) {
      const draft = (await api().post(`/api/employees/${res.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', session()).send({ grossSalary: 15000, durationMonths: 24 }).expect(201))
        .body as { id: string; startDate: string };
      await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', session()).send({ signedOn: draft.startDate }).expect(200);
    }
  }

  /** A day kept straight in attendance_days, as a source keeps it: times in Cairo. */
  function kept(key: string, date: string, source: 'zoho' | 'system', status: string, more: { in?: string; out?: string; hours?: number } = {}) {
    return {
      employeeId: ids[key],
      date: toDateOnly(date),
      status,
      checkIn: more.in ? new Date(at(date, more.in)) : null,
      checkOut: more.out ? new Date(at(date, more.out)) : null,
      place: more.in ? 'office' : null,
      hoursCounted: more.hours ?? 0,
      source,
      importedById: hrUserId,
    };
  }

  const ask = (key: string, body: Record<string, unknown>) => api().post('/api/me/attendance/corrections').set('Cookie', sessions[key]).send(body);
  const decide = (id: string, session: string, decision: 'approve' | 'reject', comment?: string) => api().post(`/api/attendance/corrections/${id}/decide`).set('Cookie', session).send({ decision, comment });
  const waiting = async (session: string) => ((await api().get('/api/attendance/corrections?status=waiting').set('Cookie', session).expect(200)).body as Correction[]).filter((c) => people.includes(c.employee.id));
  const personMonth = async (key: string, month: string, session = hr) => (await api().get(`/api/attendance/employees/${ids[key]}?month=${month}`).set('Cookie', session).expect(200)).body as PersonView;
  const lineOf = async (runId: string, key: string) =>
    ((await api().get(`/api/payroll/runs/${runId}`).set('Cookie', hr).expect(200)).body.lines as { employeeId: string; inputs: { workedHours: number | null; noShowDays: number | null }; attendanceImport: { source: string } | null }[]).find(
      (l) => l.employeeId === ids[key],
    )!;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrUserId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } })).id;
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    // HR's own profile, for "never their own"
    hrEmployeeId = (await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `Hana Hr ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: hrEmail }).expect(201)).body.id;
    people.push(hrEmployeeId);

    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Corrections Dept ${RUN}` }).expect(201)).body.id;
    teamId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Desk Team', parentId: deptId }).expect(201)).body.id;
    // the MORNING shift: 9 hours within 9:00–19:00, 15 minutes' grace, Sunday to Thursday
    shiftId = (
      await prisma.shift.create({
        data: { code: `K${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('19:00'), hoursPerDay: 9, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4] },
        select: { id: true },
      })
    ).id;
    await api().post(`/api/employees/${hrEmployeeId}/employments`).set('Cookie', hrSuper).send({ employmentType: 'full_time', joinDate: firstDay(monthsLater(LOCKED, -6)), departmentId: deptId, shiftId }).expect(201);

    await person('mona', 'Mona Manager', {}, { roles: ['employee', 'manager'] });
    await person('rami', 'Rami Report', { managerId: ids.mona }, { signed: true });
    await person('tia', 'Tia Lead', { departmentId: teamId, managerId: ids.mona });
    await person('lea', 'Lea Unmanaged', { departmentId: teamId });
    await api().patch(`/api/departments/${teamId}`).set('Cookie', hr).send({ headId: ids.tia }).expect(200);
    await person('zed', 'Zed Nobody', {}, { signed: true });
    await person('fay', 'Fay Freelance', { employmentType: 'freelance', managerId: ids.mona });
    const g9 = ((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((g) => g.code === 'G9')!;
    await person('cleo', 'Cleo Chief', { managerId: ids.mona, gradeId: g9.id }, { session: () => hrSuper });

    const holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)));
    for (const m of [PAST, LOCKED, WITH_CEO, CURRENT]) {
      work[m] = [];
      for (let d = firstDay(m); d <= lastDay(m); d = addDays(d, 1)) if (weekday(d) <= 4 && !holidays.has(d)) work[m].push(d);
    }
    // Rami checks in on the system: in PAST's first working day he forgot to check out
    await prisma.attendanceDay.createMany({
      data: [kept('rami', work[PAST][0], 'system', 'worked', { in: '09:05' }), kept('rami', work[PAST][1], 'system', 'worked', { in: '09:00', out: '18:00', hours: 9 }), kept('zed', work[PAST][0], 'zoho', 'absent')],
    });
    pastRun = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: PAST }).expect(201)).body.id;
    runs.push(pastRun);
    // a month whose payroll is approved, and one whose payroll is with the CEO (made straight: nobody on them)
    for (const [m, status] of [
      [LOCKED, 'approved'],
      [WITH_CEO, 'pending_ceo'],
    ] as const) {
      if (await prisma.payrollRun.findUnique({ where: { month: toDateOnly(firstDay(m)) } })) throw new Error(`A payroll run for ${m} is left by another test.`);
      runs.push((await prisma.payrollRun.create({ data: { month: toDateOnly(firstDay(m)), status, rules: {} }, select: { id: true } })).id);
    }
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: { in: runs } } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendanceCorrection.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.department.updateMany({ where: { id: teamId }, data: { headId: null } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people }, managerId: { not: null } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.department.deleteMany({ where: { id: teamId } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('asking', () => {
    it('refuses a day still to come, no reason, a month whose payroll is approved, a freelancer, a day not employed', async () => {
      const tomorrow = addDays(TODAY, 1);
      expect(said(await ask('rami', { date: tomorrow, kind: 'forgot_check_in', checkIn: '09:00', reason: 'Forgot' }).expect(400))[0]).toContain('is still to come');
      expect(said(await ask('rami', { date: work[PAST][0], kind: 'forgot_check_out', checkOut: '18:30' }).expect(400))).toEqual([
        'Write why the day needs correcting, e.g. I left for a client meeting and forgot to check out.',
      ]);
      expect(said(await ask('rami', { date: work[LOCKED][0], kind: 'forgot_check_in', checkIn: '09:00', reason: 'Forgot' }).expect(400))[0]).toContain('payroll is approved');
      expect(said(await ask('fay', { date: work[PAST][0], kind: 'forgot_check_in', checkIn: '09:00', reason: 'Forgot' }).expect(400))[0]).toContain('You work freelance');
      expect(said(await ask('rami', { date: '2020-01-05', kind: 'forgot_check_in', checkIn: '09:00', reason: 'Forgot' }).expect(400))[0]).toContain('You had no employment on that day');
      expect(said(await ask('rami', { date: work[PAST][0], kind: 'forgot_check_out', checkOut: '6:30 PM', reason: 'Forgot' }).expect(400))).toEqual([
        'Enter the time of the check-out as HH:MM, e.g. 18:30.',
      ]);
      // what the day already has
      expect(said(await ask('rami', { date: work[PAST][1], kind: 'forgot_check_out', checkOut: '18:30', reason: 'Forgot' }).expect(400))[0]).toContain('You checked out at 6:00 PM');
    });
  });

  describe('the direct manager, then HR', () => {
    let id: string;

    it('sends the request to the direct manager, with the day as it was shown', async () => {
      const res = (await ask('rami', { date: work[PAST][0], kind: 'forgot_check_out', checkOut: '18:30', reason: 'Left for a client meeting' }).expect(201)).body as Correction;
      id = res.id;
      expect(res).toMatchObject({
        status: 'with_manager',
        stage: 'manager',
        correctionKind: 'forgot_check_out',
        checkIn: null,
        checkOut: at(work[PAST][0], '18:30'),
        manager: { id: ids.mona, role: 'direct_manager' },
        canCancel: true,
        recordedByHr: false,
      });
      expect(res.dayBefore).toMatchObject({ status: 'worked', checkIn: at(work[PAST][0], '09:05'), checkOut: null, source: 'system' });
      expect(res.steps.map((s) => s.kind)).toEqual(['submitted']);
      // the same day again while it is being decided
      expect(said(await ask('rami', { date: work[PAST][0], kind: 'forgot_check_out', checkOut: '18:00', reason: 'Again' }).expect(400))).toEqual([
        `You asked to correct ${work[PAST][0].split('-').reverse().join('/')} already: wait for it to be decided, or cancel it.`,
      ]);
    });

    it('lists it for the manager to decide, on the employee’s requests and their month; nobody else sees it', async () => {
      expect((await waiting(sessions.mona)).map((c) => c.id)).toEqual([id]);
      expect((await api().get('/api/attendance/corrections/counts').set('Cookie', sessions.mona).expect(200)).body.waiting).toBe(1);
      expect((await waiting(hr)).map((c) => c.id)).not.toContain(id);
      const mine = (await api().get('/api/me/attendance/corrections').set('Cookie', sessions.rami).expect(200)).body as Correction[];
      expect(mine.map((c) => c.id)).toEqual([id]);
      const month = (await api().get(`/api/attendance/me?month=${PAST}`).set('Cookie', sessions.rami).expect(200)).body as PersonView;
      expect(month.corrections).toEqual([expect.objectContaining({ id, date: work[PAST][0], status: 'with_manager' })]);
      expect(month.correctable).toEqual({ allowed: true, reason: null });
      expect(month.canCorrect).toBe(false);
      await api().get(`/api/attendance/corrections/${id}`).set('Cookie', sessions.zed).expect(404);
      // the employee doesn't decide their own, HR not before the manager
      await decide(id, sessions.rami, 'approve').expect(403);
      expect(said(await decide(id, hr, 'approve').expect(409))[0]).toContain('isn’t waiting for your decision'.replace('’', "'"));
    });

    it('goes to HR once the manager approves, and HR’s approval changes the day, keeping the one it corrects', async () => {
      const lineBefore = await lineOf(pastRun, 'rami');
      expect((await decide(id, sessions.mona, 'approve').expect(200)).body).toMatchObject({ status: 'with_hr', stage: 'hr' });
      expect((await waiting(hr)).map((c) => c.id)).toContain(id);
      const done = (await decide(id, hr, 'approve').expect(200)).body as Correction;
      expect(done.status).toBe('approved');
      expect(done.appliedAt).not.toBeNull();
      expect(done.steps.map((s) => `${s.kind} ${s.decision ?? ''}`.trim())).toEqual(['submitted', 'manager_decision approve', 'hr_decision approve']);

      const view = await personMonth('rami', PAST);
      const day = view.person.days.find((d) => d.date === work[PAST][0])!;
      // 9:05 to 6:30 PM: 9 hours counted, at most the shift's
      expect(day).toMatchObject({ source: 'correction', checkIn: at(work[PAST][0], '09:05'), checkOut: at(work[PAST][0], '18:30'), hoursCounted: 9, correctionId: id });
      expect(day.correctedFrom).toMatchObject({ source: 'system', status: 'worked', checkIn: at(work[PAST][0], '09:05'), checkOut: null });
      // the day it corrects stays as it was
      const original = await prisma.attendanceDay.findUniqueOrThrow({ where: { employeeId_date_source: { employeeId: ids.rami, date: toDateOnly(work[PAST][0]), source: 'system' } } });
      expect(original.checkOut).toBeNull();
      // the draft line refilled
      const line = await lineOf(pastRun, 'rami');
      expect(line.attendanceImport?.source).toBe('attendance');
      // the day missing its check-out counted half the shift until corrected (owner, 27 October 2026: "open check ins with
      // half day": 4:30 of its 9, beside the other day's 9); corrected, it counts its own 9 hours: 4:30 more on the line
      expect(lineBefore.inputs.workedHours).toBe(13.5);
      expect(line.inputs.workedHours).toBe(18);
      // in the audit log: the day's change
      const logged = await prisma.auditLog.findFirst({ where: { action: 'correct', entityType: 'attendance_day' }, orderBy: { at: 'desc' } });
      expect(logged?.diff).toMatchObject({ employeeId: ids.rami, date: work[PAST][0], correctionId: id, from: { checkOut: null }, to: { hoursCounted: 9 } });
    });
  });

  describe('the lead when there is no direct manager; rejected; cancelled', () => {
    it('sends a request of someone without a manager to their team lead, who rejects it with a comment', async () => {
      const res = (await ask('lea', { date: work[PAST][2], kind: 'forgot_check_in', checkIn: '09:00', checkOut: '17:00', reason: 'Phone was dead' }).expect(201)).body as Correction;
      expect(res.manager).toMatchObject({ id: ids.tia, role: 'team_lead' });
      expect(said(await decide(res.id, sessions.tia, 'reject').expect(400))).toEqual(['Write a comment: why the correction is rejected.']);
      const rejected = (await decide(res.id, sessions.tia, 'reject', 'You were at the office: the guard saw you leave at 3 PM').expect(200)).body as Correction;
      expect(rejected).toMatchObject({ status: 'rejected', rejectedStage: 'manager', rejectReason: 'You were at the office: the guard saw you leave at 3 PM' });
    });

    it('goes straight to HR with nobody in charge, and is cancelled by its employee while open', async () => {
      const res = (await ask('zed', { date: work[PAST][0], kind: 'forgot_check_in', checkIn: '09:30', checkOut: '18:30', reason: 'Came by the client first' }).expect(201)).body as Correction;
      expect(res).toMatchObject({ status: 'with_hr', manager: null });
      expect(res.steps.map((s) => s.kind)).toEqual(['submitted', 'no_manager']);
      expect((await api().post(`/api/me/attendance/corrections/${res.id}/cancel`).set('Cookie', sessions.zed).expect(200)).body.status).toBe('cancelled');
      expect(said(await api().post(`/api/me/attendance/corrections/${res.id}/cancel`).set('Cookie', sessions.zed).expect(409))[0]).toContain("is cancelled, so it can't be cancelled");
    });
  });

  describe('the time to ask', () => {
    it('refuses a day after its 2nd working day, not one still open; work away from the office is official duty', async () => {
      window.open = false;
      try {
        const holidays = (await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date));
        const from = correctionAskFrom(TODAY, [0, 1, 2, 3, 4], holidays);
        const late = said(await ask('rami', { date: addDays(from, -1), kind: 'forgot_check_in', checkIn: '09:00', reason: 'Forgot' }).expect(400));
        expect(late).toEqual([`It’s too late to ask to correct ${addDays(from, -1).split('-').reverse().join('/')}: ask within 2 working days of the day. HR can still correct it for you.`]);
        // the earliest day still open: refused for something else (no reason), never for the time
        const open = said(await ask('rami', { date: from, kind: 'forgot_check_in', checkIn: '09:00' }).expect(400));
        expect(open.join(' ')).not.toContain('too late');
        // their month says from when they can ask
        const mine = (await api().get(`/api/attendance/me?month=${CURRENT}`).set('Cookie', sessions.rami).expect(200)).body as { ask: { from: string; workingDays: number } | null };
        expect(mine.ask).toEqual({ from, workingDays: 2 });
      } finally {
        window.open = true;
      }
      const away = said(await ask('rami', { date: work[PAST][4], kind: 'worked_remotely', checkIn: '10:00', reason: 'At the client' }).expect(400));
      expect(away).toEqual(['Working away from the office (at a client, a shoot, an errand) is official duty: ask for official duty instead, or work from home for a day at home.']);
    });
  });

  describe('a C-level person’s', () => {
    it('is decided by the manager, then the CEO: HR doesn’t see it', async () => {
      const res = (await ask('cleo', { date: work[PAST][3], kind: 'forgot_check_in', checkIn: '10:00', checkOut: '19:00', reason: 'Board meeting at the client' }).expect(201)).body as Correction;
      expect(res.confidential).toBe(true);
      await decide(res.id, sessions.mona, 'approve').expect(200);
      await api().get(`/api/attendance/corrections/${res.id}`).set('Cookie', hr).expect(404);
      expect((await waiting(hr)).map((c) => c.id)).not.toContain(res.id);
      expect((await waiting(ceo)).map((c) => c.id)).toContain(res.id);
      const done = (await decide(res.id, ceo, 'approve').expect(200)).body as Correction;
      expect(done.status).toBe('approved');
      const day = (await personMonth('cleo', PAST, ceo)).person.days.find((d) => d.date === work[PAST][3])!;
      expect(day).toMatchObject({ source: 'correction', status: 'worked', hoursCounted: 9 });
    });
  });

  describe('HR correcting a day directly', () => {
    it('is approved at once, the day changed and the line refilled from attendance', async () => {
      await api().post('/api/attendance/corrections').set('Cookie', finance).send({ employeeId: ids.zed, date: work[PAST][0], kind: 'forgot_check_in', checkIn: '09:00', checkOut: '17:00', reason: 'Seen at the office' }).expect(403);
      expect((await lineOf(pastRun, 'zed')).attendanceImport).toBeNull();
      const res = (
        await api()
          .post('/api/attendance/corrections')
          .set('Cookie', hr)
          .send({ employeeId: ids.zed, date: work[PAST][0], kind: 'forgot_check_in', checkIn: '09:00', checkOut: '17:00', reason: 'Seen at the office by HR' })
          .expect(201)
      ).body as Correction;
      expect(res).toMatchObject({ status: 'approved', recordedByHr: true });
      expect(res.steps.map((s) => s.kind)).toEqual(['recorded_by_hr']);
      // Zed's day was Zoho's (absent): corrected, and his line now from attendance
      const day = (await personMonth('zed', PAST)).person.days.find((d) => d.date === work[PAST][0])!;
      expect(day).toMatchObject({ source: 'correction', hoursCounted: 8, correctedFrom: { source: 'zoho', status: 'absent' } });
      const line = await lineOf(pastRun, 'zed');
      expect(line.attendanceImport?.source).toBe('attendance');
      expect(line.inputs).toMatchObject({ workedHours: 8, noShowDays: 0 });
      // the person page says HR corrects
      expect((await personMonth('zed', PAST)).canCorrect).toBe(true);
    });

    it('never HR’s own, a C-level person’s only HR with Super Admin', async () => {
      const body = { date: work[PAST][4], kind: 'forgot_check_in', checkIn: '09:00', checkOut: '17:00', reason: 'Fixing' };
      expect(said(await api().post('/api/attendance/corrections').set('Cookie', hr).send({ ...body, employeeId: hrEmployeeId }).expect(403))[0]).toContain('Someone else in HR');
      await api().post('/api/attendance/corrections').set('Cookie', hr).send({ ...body, employeeId: ids.cleo }).expect(404);
      await api().post('/api/attendance/corrections').set('Cookie', hrSuper).send({ ...body, employeeId: ids.cleo }).expect(201);
    });
  });

  describe('the month’s payroll', () => {
    it('can be asked for while the month’s payroll is with the CEO, never applied then', async () => {
      const res = (await ask('zed', { date: work[WITH_CEO][0], kind: 'forgot_check_in', checkIn: '09:00', checkOut: '17:00', reason: 'Forgot' }).expect(201)).body as Correction;
      expect(said(await decide(res.id, hr, 'approve').expect(409))[0]).toContain('is with the CEO, so the correction would miss it');
      expect((await api().get(`/api/attendance/corrections/${res.id}`).set('Cookie', hr).expect(200)).body.status).toBe('with_hr');
      expect((await personMonth('zed', LOCKED)).correctable).toEqual({ allowed: false, reason: expect.stringContaining('payroll is approved') });
    });
  });

  // Today by a clock pinned in the test (Date alone, as src/documents/values.spec.ts pins it), never the real one: run
  // before 08:55 in Cairo, the check-out made "now" came before the check-in corrected to 08:55, so the day kept none
  // (26 October 2026). Days before the real today: a clock ahead of the real one would end HR's session as idle.
  describe('a correction of today', () => {
    /** Runs `steps` with the clock stopped at `time` in Cairo on `day`, which is today meanwhile. */
    async function withClockAt(day: string, time: string, steps: () => Promise<void>): Promise<void> {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(zonedMoment(day, time));
      try {
        expect(todayInCairo()).toBe(day);
        await steps();
      } finally {
        vi.useRealTimers();
      }
    }
    const corrected = (day: string) => prisma.attendanceDay.findUniqueOrThrow({ where: { employeeId_date_source: { employeeId: ids.rami, date: toDateOnly(day), source: 'correction' } } });

    it('takes a check-out made after it was approved', async () => {
      const day = addDays(TODAY, -1);
      await withClockAt(day, '18:30', async () => {
        const res = (await ask('rami', { date: day, kind: 'forgot_check_in', checkIn: '08:55', reason: 'Forgot this morning' }).expect(201)).body as Correction;
        await decide(res.id, sessions.mona, 'approve').expect(200);
        await decide(res.id, hr, 'approve').expect(200);
        const before = await corrected(day);
        expect(before.checkIn?.toISOString()).toBe(at(day, '08:55'));
        expect(before.checkOut).toBeNull();
        // he checks out on the system now
        await api().post('/api/me/attendance/punches').set('Cookie', sessions.rami).send({ kind: 'out', locationError: 'denied' }).expect(200);
        const after = await corrected(day);
        expect(after.checkIn?.toISOString()).toBe(at(day, '08:55'));
        expect(after.checkOut?.toISOString()).toBe(at(day, '18:30'));
        expect(after.correctedFrom).toMatchObject({ source: 'system', checkIn: null });
      });
    });

    // pinned to 00:30 in Cairo, when Cairo's day is a day ahead of UTC's: asked for, and checked out, on Cairo's day
    it('takes one at 00:30 in Cairo, on Cairo’s day and not the UTC day before', async () => {
      const day = addDays(TODAY, -2);
      await withClockAt(day, '00:30', async () => {
        const res = (await ask('rami', { date: day, kind: 'forgot_check_in', checkIn: '00:10', reason: 'Came in after midnight' }).expect(201)).body as Correction;
        await decide(res.id, sessions.mona, 'approve').expect(200);
        await decide(res.id, hr, 'approve').expect(200);
        await api().post('/api/me/attendance/punches').set('Cookie', sessions.rami).send({ kind: 'out', locationError: 'denied' }).expect(200);
        const after = await corrected(day);
        expect([after.checkIn?.toISOString(), after.checkOut?.toISOString()]).toEqual([at(day, '00:10'), at(day, '00:30')]);
        const punches = await prisma.attendancePunch.findMany({ where: { employeeId: ids.rami, date: { in: [toDateOnly(addDays(day, -1)), toDateOnly(day)] } }, select: { date: true, at: true } });
        expect(punches.map((p) => [fromDateOnly(p.date), p.at.toISOString()])).toEqual([[day, at(day, '00:30')]]);
      });
    });

    // reported 25 October 2026: asked at 00:30 to set that day's check-in to 08:55, it was taken (owner, 26 October 2026:
    // "yes", refuse a time not yet come): asked, corrected by HR directly, and at each approval again
    it('refuses a time not yet come today, asked or corrected by HR; takes one that has passed', async () => {
      const day = addDays(TODAY, -3);
      const notYet = "Choose a time that has passed: 8:55 AM today hasn't come yet.";
      await withClockAt(day, '00:30', async () => {
        expect(said(await ask('rami', { date: day, kind: 'forgot_check_in', checkIn: '08:55', reason: 'Forgot this morning' }).expect(400))).toEqual([notYet]);
        expect(
          said(
            await api()
              .post('/api/attendance/corrections')
              .set('Cookie', hr)
              .send({ employeeId: ids.zed, date: day, kind: 'forgot_check_in', checkIn: '08:55', checkOut: '17:00', reason: 'Seen at the office by HR' })
              .expect(400),
          ),
        ).toEqual([notYet, "Choose a time that has passed: 5:00 PM today hasn't come yet."]);
        expect(await prisma.attendanceCorrection.count({ where: { employeeId: { in: [ids.rami, ids.zed] }, date: toDateOnly(day) } })).toBe(0);
        // one that has passed, the same night
        const passed = (await ask('rami', { date: day, kind: 'forgot_check_in', checkIn: '00:10', reason: 'Came in after midnight' }).expect(201)).body as Correction;
        await api().post(`/api/me/attendance/corrections/${passed.id}/cancel`).set('Cookie', sessions.rami).expect(200);
      });
      await withClockAt(day, '09:00', async () => {
        const res = (await ask('rami', { date: day, kind: 'forgot_check_in', checkIn: '08:55', reason: 'Forgot this morning' }).expect(201)).body as Correction;
        expect(res).toMatchObject({ status: 'with_manager', checkIn: at(day, '08:55') });
        const hrs = (await api().post('/api/attendance/corrections').set('Cookie', hr).send({ employeeId: ids.zed, date: day, kind: 'forgot_check_in', checkIn: '08:55', reason: 'Seen at the office by HR' }).expect(201))
          .body as Correction;
        expect(hrs).toMatchObject({ status: 'approved', checkIn: at(day, '08:55') });
      });
    });

    it('checks an approval again: one asked for earlier isn’t approved before its time', async () => {
      const day = addDays(TODAY, -4);
      const notYet = "Approve it once the time has passed: 8:55 AM today hasn't come yet.";
      // asked for at 09:00 (by a clock ahead), decided by the manager and HR at 00:30
      let id = '';
      await withClockAt(day, '09:00', async () => {
        id = ((await ask('rami', { date: day, kind: 'forgot_check_in', checkIn: '08:55', reason: 'Forgot this morning' }).expect(201)).body as Correction).id;
      });
      await withClockAt(day, '00:30', async () => {
        expect(said(await decide(id, sessions.mona, 'approve').expect(409))).toEqual([notYet]);
        // still with the manager
        expect((await api().get(`/api/attendance/corrections/${id}`).set('Cookie', sessions.mona).expect(200)).body.status).toBe('with_manager');
      });
      await withClockAt(day, '09:00', async () => {
        await decide(id, sessions.mona, 'approve').expect(200);
      });
      await withClockAt(day, '00:30', async () => {
        expect(said(await decide(id, hr, 'approve').expect(409))).toEqual([notYet]);
        expect((await api().get(`/api/attendance/corrections/${id}`).set('Cookie', hr).expect(200)).body.status).toBe('with_hr');
        expect((await decide(id, hr, 'reject', 'Not yet: ask again once the day has come').expect(200)).body.status).toBe('rejected');
      });
    });
  });
});
