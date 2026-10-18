import type { INestApplication } from '@nestjs/common';
import { annualEntitlement, LEAVE_RULE_DEFAULTS, leavePayoutMonth, reimbursementPayMonth } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Leave (owner, 18 October 2026: "can you apply the leaves according to the law?", and on unused leave: "make it with
// decision with the year closing"): the law's leave types and the Leave Setup; the annual leave's days by the law (Art.
// 124: a first year pro-rata and usable after six months, 21 from the second, 30 after 10 years with one or more
// employers or over 50, 45 with a disability, 7 more for hazardous work); requests to the direct manager then HR,
// straight to HR without one, HR recording on an employee's behalf; casual leave's limits (Art. 128); cancelling and the
// balance back; days already taken refused; documents; the Year Closing (carry and pay adding up to the unused, the days
// carried three years paid, the Unused leave paid addition, reopening); the unused leave paid on leaving; and the payroll
// lines' leave and unpaid leave days. These tests look at their own people (names end with RUN) and delete what they
// made. Every name and amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const YEAR = Number(TODAY.slice(0, 4));
const CURRENT = TODAY.slice(0, 7);
const NEXT = monthsLater(CURRENT, 1);
const CLOSING_YEAR = YEAR - 1;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

/** The first Sunday `ahead` days or more from `from`. */
function sundayFrom(from: string, ahead: number): string {
  let day = addDays(from, ahead);
  while (weekday(day) !== 0) day = addDays(day, 1);
  return day;
}

interface View {
  id: string;
  employee: { id: string; fullNameEn: string; department: string | null; team: string | null };
  type: { id: string; key: string; nameEn: string; paid: string };
  startDate: string;
  endDate: string;
  halfDay: boolean;
  days: number;
  status: string;
  stage: string | null;
  waitingForYou: boolean;
  canCancel: boolean;
  hrCanCancel: boolean;
  manager: { id: string; fullNameEn: string } | null;
  rejectedStage: string | null;
  rejectReason: string | null;
  recordedByHr: boolean;
  documents: { id: string; fileName: string; mimeType: string; sizeBytes: number }[];
  steps: { kind: string; decision: string | null; comment: string | null; actor: string | null }[];
  balanceAfter: number | null;
}

interface Balances {
  year: number;
  annual: { entitlement: number; usableFrom: string; carriedIn: number; adjustments: number; taken: number; booked: number; pending: number; available: number };
  types: { typeId: string; nameEn: string; used: number; timesInService: number; left: number | null }[];
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
const kinds = (v: View) => v.steps.map((s) => (s.decision ? `${s.kind}:${s.decision}` : s.kind));

describe('Leave (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  let superAdmin: string;
  let mona: string; // Ben's direct manager
  let ben: string;
  let nora: string; // no manager
  let sam: string; // no part in anything here
  let emailDomainBefore: string | null;
  let deptId: string;
  const people: string[] = [];
  const ids: Record<string, string> = {};
  const employments: Record<string, string> = {};
  const types: Record<string, string> = {};
  const madeRuns: string[] = [];
  const api = () => request(app.getHttpServer());

  async function person(key: string, name: string, email: string | null, extra: Record<string, unknown>, employment: Record<string, unknown> | null) {
    const res = await api()
      .post('/api/employees')
      .set('Cookie', hr)
      .send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', ...(email && { workEmail: email }), ...extra })
      .expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    if (employment) {
      const hired = await api().post(`/api/employees/${res.body.id}/employments`).set('Cookie', hr).send({ employmentType: 'full_time', departmentId: deptId, ...employment }).expect(201);
      employments[key] = hired.body.employment.id;
    }
    return res.body.id as string;
  }

  async function sign(key: string, grossSalary: number, durationMonths: number) {
    const draft = (await api().post(`/api/employees/${ids[key]}/employments/${employments[key]}/contracts`).set('Cookie', hr).send({ grossSalary, durationMonths }).expect(201)).body as {
      id: string;
      startDate: string;
    };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
  }

  async function account(roles: Parameters<typeof createUser>[1]) {
    const email = await createUser(prisma, roles);
    return { email, session: await signIn(app, email) };
  }

  const ask = (session: string, f: { type: string; startDate: string; endDate?: string; halfDay?: boolean; reason?: string }, documents: [Buffer, string][] = []) => {
    let req = api()
      .post('/api/me/leave/requests')
      .set('Cookie', session)
      .field('typeId', types[f.type])
      .field('startDate', f.startDate)
      .field('endDate', f.endDate ?? f.startDate)
      .field('halfDay', String(f.halfDay ?? false));
    if (f.reason) req = req.field('reason', f.reason);
    for (const [data, name] of documents) req = req.attach('documents', data, name);
    return req;
  };
  const record = (employeeId: string, f: { type: string; startDate: string; endDate?: string }, documents: [Buffer, string][] = [], session = hr) => {
    let req = api()
      .post('/api/leave/requests')
      .set('Cookie', session)
      .field('employeeId', employeeId)
      .field('typeId', types[f.type])
      .field('startDate', f.startDate)
      .field('endDate', f.endDate ?? f.startDate);
    for (const [data, name] of documents) req = req.attach('documents', data, name);
    return req;
  };
  const decide = (id: string, body: object, session: string) => api().post(`/api/leave/requests/${id}/decide`).set('Cookie', session).send(body);
  const balances = async (employeeId: string, year: number, session = hr) => (await api().get(`/api/employees/${employeeId}/leave?year=${year}`).set('Cookie', session).expect(200)).body as Balances & { requests: View[] };
  const mine = async (session: string, year = YEAR) => (await api().get(`/api/me/leave/balances?year=${year}`).set('Cookie', session).expect(200)).body as Balances;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = (await account(['hr'])).session;
    ceo = (await account(['ceo'])).session;
    finance = (await account(['finance'])).session;
    superAdmin = (await account(['super_admin'])).session;
    const monaAccount = await account(['manager']);
    mona = monaAccount.session;
    const benAccount = await account(['employee']);
    ben = benAccount.session;
    const noraAccount = await account(['employee']);
    nora = noraAccount.session;
    const samAccount = await account(['employee']);
    sam = samAccount.session;

    // sign-in accounts here are @test.local: no company email domain while these tests run
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Leave ${RUN}` }).expect(201)).body.id;

    await person('mona', 'Mona Manager', monaAccount.email, { gender: 'female' }, { joinDate: '2024-01-01' });
    await person('ben', 'Ben Leaving', benAccount.email, { gender: 'male' }, { joinDate: '2024-01-01', managerId: ids.mona });
    await person('nora', 'Nora Alone', noraAccount.email, { gender: 'female' }, { joinDate: '2024-01-01' });
    await person('sam', 'Sam Stranger', samAccount.email, {}, { joinDate: '2024-01-01' });

    for (const t of (await api().get('/api/leave/types').set('Cookie', hr).expect(200)).body as { id: string; key: string }[]) types[t.key] = t.id;
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: { in: madeRuns } } });
    await prisma.leaveYearClosing.deleteMany({ where: { year: CLOSING_YEAR } });
    await prisma.leaveBalanceYear.updateMany({ where: { year: CLOSING_YEAR + 1, employeeId: { notIn: people } }, data: { carriedIn: 0, carriedInByYear: {} } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveBalanceYear.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveType.deleteMany({ where: { nameEn: { endsWith: RUN } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('Leave Setup', () => {
    it('has the law’s types: everyone signed in reads those on, HR every one with its requests', async () => {
      const all = (await api().get('/api/leave/types').set('Cookie', hr).expect(200)).body as { key: string; active: boolean; requests: number }[];
      expect(all.map((t) => t.key)).toEqual(expect.arrayContaining(['annual', 'casual', 'sick', 'birth', 'exam', 'maternity', 'hajj', 'childcare', 'unpaid']));
      expect(all.find((t) => t.key === 'childcare')).toMatchObject({ active: false, requests: 0 });
      expect(all.find((t) => t.key === 'casual')).toMatchObject({ balance: 'from_annual', daysPerYear: 7, maxPerRequest: 2, paid: 'paid' });
      const offered = (await api().get('/api/leave/types').set('Cookie', ben).expect(200)).body as { key: string; requests?: number }[];
      expect(offered.map((t) => t.key)).not.toContain('childcare');
      expect(offered[0]).not.toHaveProperty('requests');
    });

    it('HR adds a type and changes one; the annual leave stays paid, the annual balance and on; a Super Admin deletes one never asked for', async () => {
      const made = (await api().post('/api/leave/types').set('Cookie', hr).send({ nameEn: `Marriage leave ${RUN}`, nameAr: 'إجازة زواج', maxPerRequest: 3, maxTimesInService: 1 }).expect(201)).body;
      expect(made).toMatchObject({ kind: 'custom', paid: 'paid', balance: 'none', maxPerRequest: 3, active: true });
      expect(made.key).toMatch(/^custom-marriage-leave-/);
      expect(said(await api().post('/api/leave/types').set('Cookie', hr).send({ nameEn: `Odd ${RUN}`, nameAr: 'غريب', paid: 'partly' }).expect(400))).toEqual([
        'Enter the pay percent of a partly paid type, from 0 to 100, e.g. 75.',
      ]);
      expect(said(await api().patch(`/api/leave/types/${types.annual}`).set('Cookie', hr).send({ balance: 'none', active: false }).expect(400))).toEqual([
        'Annual leave is the annual balance itself (Art. 124): its balance stays The annual balance.',
        "Annual leave is the law's (Art. 124): it can't be turned off.",
      ]);
      await api().post('/api/leave/types').set('Cookie', ben).send({ nameEn: `No ${RUN}`, nameAr: 'لا' }).expect(403);
      await api().delete(`/api/leave/types/${made.id}`).set('Cookie', hr).expect(403);
      await api().delete(`/api/leave/types/${types.annual}`).set('Cookie', superAdmin).expect(409);
      await api().delete(`/api/leave/types/${made.id}`).set('Cookie', superAdmin).expect(204);
    });

    it('the annual leave’s numbers: everyone reads them, HR changes them', async () => {
      expect((await api().get('/api/leave/settings').set('Cookie', ben).expect(200)).body).toMatchObject(LEAVE_RULE_DEFAULTS);
      await api().patch('/api/leave/settings').set('Cookie', ben).send({ standardDays: 22 }).expect(403);
      expect((await api().patch('/api/leave/settings').set('Cookie', hr).send({ standardDays: 22 }).expect(200)).body.standardDays).toBe(22);
      expect((await balances(ids.sam, 2025)).annual.entitlement).toBe(22);
      await api().patch('/api/leave/settings').set('Cookie', hr).send({ standardDays: 21 }).expect(200);
    });
  });

  describe('the annual leave’s days (Art. 124)', () => {
    it('a first year is pro-rata, usable six months after joining; 21 once a year is served', async () => {
      await person('ola', 'Ola First', null, {}, { joinDate: '2025-03-15' });
      expect((await balances(ids.ola, 2025)).annual).toMatchObject({ entitlement: 12, usableFrom: '2025-09-15', carriedIn: 0, available: 12 });
      // 15 a year until March 2026, then 21
      expect((await balances(ids.ola, 2026)).annual).toMatchObject({ entitlement: 20, usableFrom: '2026-01-01' });
      expect((await balances(ids.sam, 2025)).annual.entitlement).toBe(21);
    });

    it('30 after 10 years with one or more employers, earlier employers counted, or over 50; 45 with a disability; 7 more for hazardous work', async () => {
      await person('pia', 'Pia Prior', null, { priorServiceMonths: 90 }, { joinDate: '2024-01-01' });
      expect((await balances(ids.pia, 2026)).annual.entitlement).toBe(25.5);
      expect((await balances(ids.pia, 2027)).annual.entitlement).toBe(30);
      await person('abe', 'Abe Age', null, { dateOfBirth: '1976-06-10' }, { joinDate: '2020-01-01' });
      expect((await balances(ids.abe, 2026)).annual.entitlement).toBe(26.5);
      await person('dina', 'Dina Disability', null, { disability: true }, { joinDate: '2020-01-01' });
      expect((await balances(ids.dina, 2025)).annual.entitlement).toBe(45);
      await person('hadi', 'Hadi Hazard', null, {}, { joinDate: '2020-01-01' });
      await api().patch(`/api/employees/${ids.hadi}/employments/${employments.hadi}`).set('Cookie', hr).send({ hazardousWork: true }).expect(200);
      expect((await balances(ids.hadi, 2025)).annual.entitlement).toBe(28);
    });

    it('the profile’s prior service and disability are HR’s to set, seen by HR, the CEO and the employee, not the manager', async () => {
      await api().patch(`/api/employees/${ids.ben}`).set('Cookie', hr).send({ priorServiceMonths: 12, disability: false }).expect(200);
      expect((await api().get(`/api/employees/${ids.ben}`).set('Cookie', hr).expect(200)).body).toMatchObject({ priorServiceMonths: 12, disability: false });
      expect((await api().get(`/api/employees/${ids.ben}`).set('Cookie', ben).expect(200)).body).toMatchObject({ priorServiceMonths: 12 });
      expect((await api().get(`/api/employees/${ids.ben}`).set('Cookie', mona).expect(200)).body).not.toHaveProperty('disability');
      expect(said(await api().patch(`/api/employees/${ids.ben}`).set('Cookie', hr).send({ priorServiceMonths: 700 }).expect(400))[0]).toMatch(/0 to 600/);
      await api().patch(`/api/employees/${ids.ben}`).set('Cookie', hr).send({ priorServiceMonths: null }).expect(200);
    });
  });

  describe('requests', () => {
    // two working days a fortnight ahead, and more weeks after, each a Sunday and Monday
    const week = (n: number) => sundayFrom(TODAY, 14 + 7 * n);
    let first: View;

    it('goes to the direct manager, then HR; each step logged; the balance counts it pending, then booked', async () => {
      const start = week(0);
      const res = await ask(ben, { type: 'annual', startDate: start, endDate: addDays(start, 1), reason: 'Family visit' }).expect(201);
      first = res.body;
      expect(first).toMatchObject({ status: 'with_manager', stage: 'manager', days: 2, waitingForYou: false, canCancel: true, hrCanCancel: false, manager: { id: ids.mona }, recordedByHr: false });
      expect(kinds(first)).toEqual(['submitted']);
      const year = Number(start.slice(0, 4));
      const before = (await mine(ben, year)).annual;
      expect(before).toMatchObject({ entitlement: 21, pending: 2, available: 19 });
      expect(first.balanceAfter).toBe(19);
      expect((await api().get('/api/leave/requests/counts').set('Cookie', mona).expect(200)).body).toEqual({ waiting: 1 });
      await decide(first.id, { decision: 'approve' }, ben).expect(403);
      await decide(first.id, { decision: 'approve' }, hr).expect(409);
      first = (await decide(first.id, { decision: 'approve' }, mona).expect(200)).body;
      expect(first).toMatchObject({ status: 'with_hr', stage: 'hr' });
      await decide(first.id, { decision: 'approve' }, mona).expect(409);
      const waiting = (await api().get('/api/leave/requests?status=waiting').set('Cookie', hr).expect(200)).body as View[];
      expect(waiting.map((v) => v.id)).toContain(first.id);
      first = (await decide(first.id, { decision: 'approve' }, hr).expect(200)).body;
      expect(first).toMatchObject({ status: 'approved', stage: null, hrCanCancel: true });
      expect(kinds(first)).toEqual(['submitted', 'manager_decision:approve', 'hr_decision:approve']);
      expect((await mine(ben, year)).annual).toMatchObject({ booked: 2, pending: 0, available: 19 });
    });

    it('refuses days another request already takes', async () => {
      const res = await ask(ben, { type: 'annual', startDate: addDays(first.startDate, 1) }).expect(409);
      expect(said(res)[0]).toMatch(/^You already have Annual leave from .* \(approved\) on some of these days/);
    });

    it('a rejection needs a comment, and is logged with its stage', async () => {
      const r = (await ask(ben, { type: 'annual', startDate: week(1) }).expect(201)).body as View;
      await decide(r.id, { decision: 'reject' }, mona).expect(400);
      const rejected = (await decide(r.id, { decision: 'reject', comment: 'Busy week' }, mona).expect(200)).body as View;
      expect(rejected).toMatchObject({ status: 'rejected', rejectedStage: 'manager', rejectReason: 'Busy week', balanceAfter: null });
    });

    it('without a direct manager it goes straight to HR', async () => {
      const r = (await ask(nora, { type: 'annual', startDate: week(1) }).expect(201)).body as View;
      expect(r).toMatchObject({ status: 'with_hr', manager: null });
      expect(kinds(r)).toEqual(['submitted', 'no_manager']);
    });

    it('casual leave: 2 days at a time, 7 a year, from the annual balance (Art. 128)', async () => {
      const start = week(2);
      expect(said(await ask(ben, { type: 'casual', startDate: start, endDate: addDays(start, 2) }).expect(400))).toContain('Casual leave is at most 2 days at a time; this is 3 days.');
      // HR records 6 days of it on the employee's behalf, approved at once
      for (const n of [2, 3, 4]) {
        const r = (await record(ids.ben, { type: 'casual', startDate: week(n), endDate: addDays(week(n), 1) }).expect(201)).body as View;
        expect(r).toMatchObject({ status: 'approved', recordedByHr: true, days: 2 });
        expect(kinds(r)).toEqual(['recorded_by_hr']);
      }
      const casualYear = Number(week(5).slice(0, 4));
      const sameYear = [2, 3, 4].every((n) => Number(week(n).slice(0, 4)) === casualYear);
      if (sameYear) {
        expect(said(await ask(ben, { type: 'casual', startDate: week(5), endDate: addDays(week(5), 1) }).expect(400))).toContain("Only 1 day left of casual leave's 7 days a year.");
        const casual = (await mine(ben, casualYear)).types.find((t) => t.typeId === types.casual)!;
        expect(casual).toMatchObject({ used: 6, left: 1 });
      }
    });

    it('the employee cancels an approved leave not started, HR one with a comment: the days are back', async () => {
      const year = Number(first.startDate.slice(0, 4));
      const before = (await mine(ben, year)).annual.available;
      const cancelled = (await api().post(`/api/me/leave/requests/${first.id}/cancel`).set('Cookie', ben).send({}).expect(200)).body as View;
      expect(cancelled).toMatchObject({ status: 'cancelled', canCancel: false });
      expect((await mine(ben, year)).annual.available).toBe(before + 2);
      await api().post(`/api/me/leave/requests/${first.id}/cancel`).set('Cookie', ben).send({}).expect(409);
      // HR's cancel of an approved one: a comment needed
      const casual = ((await balances(ids.ben, Number(week(2).slice(0, 4)))).requests as View[]).find((r) => r.type.key === 'casual' && r.status === 'approved')!;
      await api().post(`/api/leave/requests/${casual.id}/cancel`).set('Cookie', hr).send({}).expect(400);
      const byHr = (await api().post(`/api/leave/requests/${casual.id}/cancel`).set('Cookie', hr).send({ comment: 'Came in after all' }).expect(200)).body as View;
      expect(byHr.status).toBe('cancelled');
      expect(byHr.steps.at(-1)).toMatchObject({ kind: 'cancelled', comment: 'Came in after all' });
    });

    it('documents: a type that needs one refuses a request without; those who see the request see them, every view logged', async () => {
      const start = week(6);
      expect(said(await ask(ben, { type: 'sick', startDate: start }).expect(400))).toEqual(['Attach a document: sick leave needs one.']);
      const r = (await ask(ben, { type: 'sick', startDate: start }, [[PNG, 'certificate.png']]).expect(201)).body as View;
      expect(r.documents).toEqual([{ id: r.documents[0].id, fileName: 'certificate.png', mimeType: 'image/png', sizeBytes: PNG.length }]);
      const file = await api().get(`/api/leave/requests/${r.id}/documents/${r.documents[0].id}`).set('Cookie', mona).expect(200);
      expect(Buffer.from(file.body as Buffer).equals(PNG)).toBe(true);
      await api().get(`/api/leave/requests/${r.id}/documents/${r.documents[0].id}`).set('Cookie', sam).expect(404);
      await api().get(`/api/leave/requests/${r.id}`).set('Cookie', finance).expect(404);
      expect(await prisma.auditLog.count({ where: { action: 'view_restricted', entityType: 'leave_document', entityId: r.documents[0].id } })).toBe(1);
    });

    it('the law’s other rules: maternity for a woman, exam leave’s ten days’ notice (not for HR recording it)', async () => {
      expect(said(await ask(ben, { type: 'maternity', startDate: week(7) }, [[PNG, 'medical.png']]).expect(400))).toEqual(['Maternity leave is for female employees only.']);
      const soon = addDays(TODAY, 3);
      expect(said(await ask(ben, { type: 'exam', startDate: soon }, [[PNG, 'exam.png']]).expect(400))[0]).toMatch(/^Exam leave needs 10 days' notice/);
      await record(ids.ben, { type: 'exam', startDate: soon }, [[PNG, 'exam.png']]).expect(201);
      await record(ids.ben, { type: 'exam', startDate: addDays(soon, 1) }, [], ben).expect(403);
    });

    it('who sees what: HR and the CEO everyone’s, the manager their team’s, the employee their own; the calendar the same', async () => {
      const forMona = (await api().get('/api/leave/requests').set('Cookie', mona).expect(200)).body as View[];
      expect(forMona.length).toBeGreaterThan(0);
      expect(forMona.every((v) => v.employee.id === ids.ben)).toBe(true);
      expect((await api().get('/api/leave/requests').set('Cookie', sam).expect(200)).body).toEqual([]);
      const ceoList = (await api().get(`/api/leave/requests?employeeId=${ids.nora}`).set('Cookie', ceo).expect(200)).body as View[];
      expect(ceoList).toHaveLength(1);
      const from = TODAY;
      const to = addDays(TODAY, 120);
      const hrCalendar = (await api().get(`/api/leave/calendar?from=${from}&to=${to}&departmentId=${deptId}`).set('Cookie', hr).expect(200)).body as { employee: { id: string }; status: string }[];
      // Nora's request with HR is on HR's calendar, being decided
      expect(hrCalendar.some((c) => c.employee.id === ids.nora && c.status === 'with_hr')).toBe(true);
      const benCalendar = (await api().get(`/api/leave/calendar?from=${from}&to=${to}`).set('Cookie', ben).expect(200)).body as { employee: { id: string }; status: string }[];
      expect(benCalendar.every((c) => c.employee.id === ids.ben && c.status === 'approved')).toBe(true);
      await api().get(`/api/employees/${ids.ben}/leave?year=${YEAR}`).set('Cookie', finance).expect(200);
      await api().get(`/api/employees/${ids.ben}/leave?year=${YEAR}`).set('Cookie', mona).expect(200);
      await api().get(`/api/employees/${ids.ben}/leave?year=${YEAR}`).set('Cookie', sam).expect(404);
    });

    it('HR adjusts a balance with a reason, never their own', async () => {
      const after = (await api().post(`/api/employees/${ids.sam}/leave/adjustments`).set('Cookie', hr).send({ year: YEAR, days: 1.5, reason: 'Worked a holiday' }).expect(201)).body as Balances;
      expect(after.annual.adjustments).toBe(1.5);
      expect(said(await api().post(`/api/employees/${ids.sam}/leave/adjustments`).set('Cookie', hr).send({ year: YEAR, days: 1.25, reason: 'Odd' }).expect(400))[0]).toMatch(/whole or half days/);
      await api().post(`/api/employees/${ids.sam}/leave/adjustments`).set('Cookie', mona).send({ year: YEAR, days: 1, reason: 'No' }).expect(403);
    });
  });

  describe('Year Closing (Art. 125)', () => {
    let cara: string;

    beforeAll(async () => {
      cara = await person('cara', 'Cara Closing', null, {}, { joinDate: '2022-01-01' });
      await sign('cara', 9000, 60);
      // 7 days carried into the year, 6 of them earned three years before it
      await prisma.leaveBalanceYear.create({
        data: { employeeId: cara, employmentId: employments.cara, year: CLOSING_YEAR, carriedIn: 7, carriedInByYear: { [CLOSING_YEAR - 2]: 6, [CLOSING_YEAR - 1]: 1 } },
      });
      // 5 days of annual leave taken in the year, recorded by HR
      let start = `${CLOSING_YEAR}-06-01`;
      while (weekday(start) !== 0) start = addDays(start, 1);
      await record(cara, { type: 'annual', startDate: start, endDate: addDays(start, 4) }).expect(201);
    });

    it('lists each employee employed at the year’s end: the unused days by the year earned, what must be paid, the day rate', async () => {
      const view = (await api().get(`/api/leave/year-closing/${CLOSING_YEAR}`).set('Cookie', ceo).expect(200)).body;
      expect(view).toMatchObject({ year: CLOSING_YEAR, closed: false });
      const row = view.rows.find((r: { employee: { id: string } }) => r.employee.id === cara);
      // 21 + 7 carried − 5 taken; the oldest used first, so 1 of the 6 earned three years before is left
      expect(row).toMatchObject({ unused: 23, carriedByYear: { [CLOSING_YEAR - 2]: 1, [CLOSING_YEAR - 1]: 1, [CLOSING_YEAR]: 21 }, mustSettle: 1, carry: 22, pay: 1, dayRate: 300, payAmount: 300 });
      await api().get(`/api/leave/year-closing/${CLOSING_YEAR}`).set('Cookie', ben).expect(403);
    });

    it('refuses carry and pay not adding up to the unused, and days carried three years carried again', async () => {
      const view = (await api().get(`/api/leave/year-closing/${CLOSING_YEAR}`).set('Cookie', hr).expect(200)).body;
      const rows = (over: { carry: number; pay: number }) =>
        view.rows.map((r: { employee: { id: string }; carry: number; pay: number }) => (r.employee.id === cara ? { employeeId: cara, ...over } : { employeeId: r.employee.id, carry: r.carry, pay: r.pay }));
      const name = `Cara Closing ${RUN}`;
      expect(said(await api().post(`/api/leave/year-closing/${CLOSING_YEAR}`).set('Cookie', hr).send({ rows: rows({ carry: 20, pay: 2 }) }).expect(400))).toEqual([
        `${name}: The days carried and paid must add up to the 23 days unused: leave can't be lost (Art. 125).`,
      ]);
      expect(said(await api().post(`/api/leave/year-closing/${CLOSING_YEAR}`).set('Cookie', hr).send({ rows: rows({ carry: 23, pay: 0 }) }).expect(400))).toEqual([
        `${name}: 1 day has been carried for three years and must be paid now (Art. 125): pay at least 1 day.`,
      ]);
      expect(said(await api().post(`/api/leave/year-closing/${CLOSING_YEAR}`).set('Cookie', hr).send({ rows: [] }).expect(400))[0]).toMatch(/^Decide every employee/);
      await api().post(`/api/leave/year-closing/${YEAR + 1}`).set('Cookie', hr).send({ rows: [] }).expect(400);
    });

    it('closes the year: the next year’s carried in, the days paid an Unused leave paid addition in January (or the next open month); a closed year takes no leave', async () => {
      const view = (await api().get(`/api/leave/year-closing/${CLOSING_YEAR}`).set('Cookie', hr).expect(200)).body;
      const rows = view.rows.map((r: { employee: { id: string }; carry: number; pay: number }) =>
        r.employee.id === cara ? { employeeId: cara, carry: 20, pay: 3 } : { employeeId: r.employee.id, carry: r.carry, pay: r.pay },
      );
      const closedRuns = await prisma.payrollRun.findMany({ where: { status: { in: ['approved', 'paid'] } }, select: { month: true } });
      const closed = (await api().post(`/api/leave/year-closing/${CLOSING_YEAR}`).set('Cookie', hr).send({ rows }).expect(200)).body;
      expect(closed.closed).toBe(true);
      const row = closed.rows.find((r: { employee: { id: string } }) => r.employee.id === cara);
      expect(row).toMatchObject({ unused: 23, carry: 20, pay: 3, dayRate: 300, payAmount: 900, payout: { status: 'pending' } });
      const payout = await prisma.payrollAdjustment.findUniqueOrThrow({ where: { id: row.payout.adjustmentId } });
      expect(payout).toMatchObject({ kind: 'addition', type: 'leave_payout', taxed: true, status: 'pending' });
      expect(payout.amount?.toNumber()).toBe(900);
      expect(fromDateOnly(payout.month)).toBe(leavePayoutMonth(CLOSING_YEAR, closedRuns.map((r) => fromDateOnly(r.month))));
      // only Year Closing and the final settlement pay unused leave: never entered, nor made another type, by hand
      const byHand = { employeeId: cara, month: fromDateOnly(payout.month).slice(0, 7), kind: 'addition', type: 'leave_payout', amount: 300, reason: 'Leave' };
      expect((await api().post('/api/payroll/adjustments').set('Cookie', hr).send(byHand).expect(400)).body.message).toMatch(/^Unused leave is paid from Year Closing/);
      expect((await api().patch(`/api/payroll/adjustments/${payout.id}`).set('Cookie', hr).send({ type: 'bonus' }).expect(400)).body.message).toBe(
        'Unused leave paid stays Unused leave paid: cancel it instead.',
      );
      expect((await balances(cara, CLOSING_YEAR + 1)).annual.carriedIn).toBe(20);
      const next = await prisma.leaveBalanceYear.findUniqueOrThrow({ where: { employmentId_year: { employmentId: employments.cara, year: CLOSING_YEAR + 1 } } });
      expect(next.carriedInByYear).toEqual({ [CLOSING_YEAR]: 20 });
      await api().post(`/api/leave/year-closing/${CLOSING_YEAR}`).set('Cookie', hr).send({ rows }).expect(409);
      expect(said(await record(cara, { type: 'annual', startDate: `${CLOSING_YEAR}-11-01` }).expect(409))[0]).toMatch(/annual leave is closed/);
      await api().post(`/api/employees/${cara}/leave/adjustments`).set('Cookie', hr).send({ year: CLOSING_YEAR, days: 1, reason: 'Late' }).expect(409);
    });

    it('HR reopens it until its payouts are applied: the pending ones cancelled, the next year’s carried in undone', async () => {
      await api().post(`/api/leave/year-closing/${CLOSING_YEAR}/reopen`).set('Cookie', ceo).expect(403);
      const reopened = (await api().post(`/api/leave/year-closing/${CLOSING_YEAR}/reopen`).set('Cookie', hr).expect(200)).body;
      expect(reopened.closed).toBe(false);
      const row = reopened.rows.find((r: { employee: { id: string } }) => r.employee.id === cara);
      expect(row).toMatchObject({ unused: 23, mustSettle: 1, payout: null });
      expect(await prisma.payrollAdjustment.count({ where: { employeeId: cara, type: 'leave_payout', status: 'pending' } })).toBe(0);
      expect((await balances(cara, CLOSING_YEAR + 1)).annual.carriedIn).toBe(0);
    });
  });

  describe('leaving: the unused leave paid with the final settlement', () => {
    it('lists the days unused on the last working day with the day rate and amount; HR records it paid in the final month', async () => {
      const leaver = await person('fin', 'Fin Leaver', null, {}, { joinDate: '2025-01-01' });
      await sign('fin', 12000, 36);
      const end = addDays(TODAY, -10);
      await api().post(`/api/employees/${leaver}/employments/${employments.fin}/end`).set('Cookie', hr).send({ endDate: end, endReason: 'resigned' }).expect(200);
      const expected = annualEntitlement({
        year: Number(end.slice(0, 4)),
        joinDate: '2025-01-01',
        endDate: end,
        dateOfBirth: null,
        priorServiceMonths: null,
        disability: false,
        hazardousWork: false,
        rules: LEAVE_RULE_DEFAULTS,
      }).days;
      const settlement = (await api().get(`/api/payroll/final-settlements/${employments.fin}`).set('Cookie', finance).expect(200)).body;
      expect(settlement.unusedLeave).toEqual({ year: Number(end.slice(0, 4)), days: expected, dayRate: 400, amount: Math.round(expected * 400 * 100) / 100, paid: null });
      await api().post(`/api/payroll/final-settlements/${employments.fin}/unused-leave`).set('Cookie', finance).expect(403);
      const closedRuns = await prisma.payrollRun.findMany({ where: { status: { in: ['approved', 'paid'] } }, select: { month: true } });
      const paid = (await api().post(`/api/payroll/final-settlements/${employments.fin}/unused-leave`).set('Cookie', hr).expect(200)).body;
      expect(paid.unusedLeave.paid).toMatchObject({ status: 'pending', days: expected, amount: Math.round(expected * 400 * 100) / 100 });
      expect(`${paid.unusedLeave.paid.month}-01`).toBe(reimbursementPayMonth(end, closedRuns.map((r) => fromDateOnly(r.month))));
      const adjustment = await prisma.payrollAdjustment.findFirstOrThrow({ where: { employeeId: leaver, type: 'leave_payout' } });
      expect(adjustment).toMatchObject({ kind: 'addition', taxed: true, status: 'pending' });
      await api().post(`/api/payroll/final-settlements/${employments.fin}/unused-leave`).set('Cookie', hr).expect(409);
    });
  });

  describe('payroll: the month’s leave days and unpaid leave days', () => {
    it('fills in the line’s leave days from approved paid leave and its unpaid leave days from unpaid leave, cut a day of the gross each; HR’s typed days win', async () => {
      const payee = await person('pay', 'Paula Payroll', null, {}, { joinDate: firstDay(monthsLater(CURRENT, -7)) });
      await sign('pay', 12000, 24);
      // two working days (a Sunday and Monday) and an unpaid Tuesday in next month's second week, no holidays among them
      const holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)));
      let sunday = sundayFrom(firstDay(NEXT), 7);
      while ([0, 1, 2, 3].some((n) => holidays.has(addDays(sunday, n)))) sunday = addDays(sunday, 7);
      await record(payee, { type: 'annual', startDate: sunday, endDate: addDays(sunday, 1) }).expect(201);
      await record(payee, { type: 'unpaid', startDate: addDays(sunday, 2) }).expect(201);

      await prisma.payrollRun.deleteMany({ where: { month: toDateOnly(firstDay(NEXT)) } });
      const run = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: NEXT }).expect(201)).body;
      madeRuns.push(run.id);
      const lineOf = async () =>
        ((await api().get(`/api/payroll/runs/${run.id}`).set('Cookie', hr).expect(200)).body.lines as { id: string; employeeId: string; terms: { leave?: object }; inputs: object; result: { unpaidLeaveCut: number; leaveHours: number } }[]).find(
          (l) => l.employeeId === payee,
        )!;
      let line = lineOf ? await lineOf() : null;
      expect(line!.terms.leave).toEqual({ paidDays: 2, unpaidDays: 1 });
      expect(line!.inputs).toMatchObject({ leaveDays: null, unpaidLeaveDays: null });
      expect(line!.result.unpaidLeaveCut).toBe(400);

      // another unpaid day approved while the run is a draft: the line is worked out again at once
      await record(payee, { type: 'unpaid', startDate: addDays(sunday, 3) }).expect(201);
      line = await lineOf();
      expect(line.terms.leave).toEqual({ paidDays: 2, unpaidDays: 2 });
      expect(line.result.unpaidLeaveCut).toBe(800);

      // HR's typed days win
      await api().patch(`/api/payroll/runs/${run.id}/lines`).set('Cookie', hr).send({ lines: [{ id: line.id, inputs: { unpaidLeaveDays: 0.5 } }] }).expect(200);
      line = await lineOf();
      expect(line.result.unpaidLeaveCut).toBe(200);
      expect(line.terms.leave).toEqual({ paidDays: 2, unpaidDays: 2 });
    });
  });
});
