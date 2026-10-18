import type { INestApplication } from '@nestjs/common';
import { installmentLimitWarning } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { firstDay, lastDay, monthName, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Installments and recurring deductions (owner, 18 October 2026: "in the deductions i might have a loan of a medical
// subscription or something that needs to be deducted as installments on the employee. how will it be managed?"): a
// loan's installments made at once, moved and changed by HR but never in a month whose run is with the CEO, approved or
// paid; a recurring deduction added once to each month's run it is due in, while the employee is employed, until it
// ends or is stopped, stopped too when the employment ends; what is left of a leaver's loans "taken from the final
// settlement, unless waived"; the share of pay warning set in Payroll Setup; and the employee's own plans. Other test
// files leave people with signed contracts in the same database, who are on the runs too: these tests look at their own
// people (names end with RUN), and delete everything they made. Every name and amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const C = TODAY.slice(0, 7);
const m = (n: number) => monthsLater(C, n);
/** The loan's first month: its run is sent to the CEO, then approved. */
const F = m(-5);
/** The months whose runs these tests make. */
const MONTHS = [m(-5), m(-4), m(-3), m(-2), m(-1), m(0)];
const JOINED = firstDay(m(-11));

interface Installment {
  id: string;
  month: string;
  amount: number;
  status: string;
  locked: boolean;
}

interface Advance {
  id: string;
  employee: { id: string };
  kind: string;
  amount: number;
  plan: string | null;
  status: string;
  recovered: number;
  planned: number;
  outstanding: number;
  settledHow: string | null;
  settledNote: string | null;
  installments: Installment[];
  nextInstallment: { month: string; amount: number } | null;
}

interface Recurring {
  id: string;
  employee: { id: string; employeeCode: string; fullNameEn: string; department: string | null; team: string | null };
  name: string;
  amount: number;
  startMonth: string;
  endMonth: string | null;
  stoppedFrom: string | null;
  stopNote: string | null;
  status: string;
  deducted: { month: string; amount: number; status: string }[];
}

interface Line {
  id: string;
  employeeId: string;
  terms: { adjustments?: { id: string; kind: string; type: string; amount: number | null; reason: string }[] };
  result: { warnings: string[]; adjustmentDeductions?: number };
}

interface Run {
  id: string;
  status: string;
  lines: Line[];
}

interface Person {
  id: string;
  employeeCode: string;
  employmentId: string;
}

describe('Installments and recurring deductions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let finance: string;
  let ceo: string;
  let staff: string;
  let alphaSelf: string; // Alpha's own sign-in, an employee
  const people: string[] = [];
  let alpha: Person; // a loan in installments; on the runs
  let beta: Person; // a medical subscription; on the runs
  let newcomer: Person; // joins this month
  let leaver: Person; // leaves at the end of last month, with a loan and a subscription
  let loan: Advance;
  const runs = new Map<string, string>(); // month → run id
  const api = () => request(app.getHttpServer());

  async function hire(name: string, joinDate = JOINED, gross: number | null = 9000): Promise<Person> {
    const person = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    const hired = await api().post(`/api/employees/${person.body.id}/employments`).set('Cookie', hr).send({ employmentType: 'full_time', joinDate }).expect(201);
    const p = { id: person.body.id as string, employeeCode: person.body.employeeCode as string, employmentId: hired.body.employment.id as string };
    people.push(p.id);
    if (gross !== null) {
      const draft = (await api().post(`/api/employees/${p.id}/employments/${p.employmentId}/contracts`).set('Cookie', hr).send({ grossSalary: gross }).expect(201)).body as {
        id: string;
        startDate: string;
      };
      await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
    }
    return p;
  }

  const advance = (body: object, session = hr) => api().post('/api/payroll/advances').set('Cookie', session).send(body);
  const getAdvance = async (id: string, session = hr) => (await api().get(`/api/payroll/advances/${id}`).set('Cookie', session).expect(200)).body as Advance;
  const postpone = (id: string, body: object, session = hr) => api().post(`/api/payroll/advances/${id}/installments/postpone`).set('Cookie', session).send(body);
  const change = (id: string, body: object, session = hr) => api().post(`/api/payroll/advances/${id}/installments/change`).set('Cookie', session).send(body);
  const settle = (id: string, body: object, session = hr) => api().post(`/api/payroll/advances/${id}/settle`).set('Cookie', session).send(body);
  const recurring = (body: object, session = hr) => api().post('/api/payroll/recurring-deductions').set('Cookie', session).send(body);
  const getRecurring = async (id: string) => (await api().get(`/api/payroll/recurring-deductions/${id}`).set('Cookie', hr).expect(200)).body as Recurring;
  const months = (a: Advance) => a.installments.map((i) => [i.month, i.amount, i.status]);
  const auditOf = (entityType: string, entityId: string) => prisma.auditLog.findMany({ where: { entityType, entityId }, orderBy: { id: 'asc' } });
  const settings = (body: object, session = hr) => api().patch('/api/payroll/settings').set('Cookie', session).send(body);

  /** The month's run, made or refreshed. */
  async function runOf(month: string): Promise<Run> {
    const id = runs.get(month);
    if (id) return (await api().post(`/api/payroll/runs/${id}/refresh`).set('Cookie', hr).send({}).expect(200)).body as Run;
    const made = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month }).expect(201)).body as Run;
    runs.set(month, made.id);
    return made;
  }
  const getRun = async (month: string) => (await api().get(`/api/payroll/runs/${runs.get(month)}`).set('Cookie', hr).expect(200)).body as Run;
  const lineOf = (run: Run, p: Person) => run.lines.find((l) => l.employeeId === p.id);
  const recurringOn = (line: Line | undefined) => (line?.terms.adjustments ?? []).filter((a) => a.type === 'recurring').map((a) => [a.amount, a.reason]);
  const deductionsOf = (recurringId: string) =>
    prisma.payrollAdjustment.findMany({ where: { recurringId }, orderBy: { month: 'asc' }, select: { month: true, status: true, amount: true, type: true } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    const alphaEmail = await createUser(prisma, ['employee']);
    alphaSelf = await signIn(app, alphaEmail);
    await prisma.payrollRun.deleteMany({ where: { month: { in: MONTHS.map((x) => new Date(`${x}-01T00:00:00Z`)) } } });
    alpha = await hire('Alpha');
    // Alpha's sign-in is their work email
    await prisma.employee.update({ where: { id: alpha.id }, data: { workEmail: alphaEmail } });
    beta = await hire('Beta');
    newcomer = await hire('Newcomer', firstDay(C), null);
    leaver = await hire('Leaver', JOINED, null);
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { month: { in: MONTHS.map((x) => new Date(`${x}-01T00:00:00Z`)) } } });
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.recurringDeduction.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.payrollAdvance.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.payrollSettings.update({ where: { id: 1 }, data: { installmentWarnPercent: 10 } });
    await app.close();
  });

  describe('a loan in installments', () => {
    it('is recorded with every installment at once: 6,000 in 6 from a month, the plan in words', async () => {
      const body = { employeeId: alpha.id, kind: 'loan', amount: 6000, givenOn: firstDay(m(-6)), reason: 'Invented car repair', installments: { count: 6, firstMonth: F } };
      for (const session of [finance, ceo, staff]) await advance(body, session).expect(403);
      loan = (await advance(body).expect(201)).body as Advance;
      expect(loan).toMatchObject({
        kind: 'loan',
        amount: 6000,
        plan: '6 installments of EGP 1,000.00',
        status: 'open',
        recovered: 0,
        planned: 6000,
        outstanding: 6000,
        settledHow: null,
        nextInstallment: { month: F, amount: 1000 },
      });
      expect(loan.installments.map((i) => [i.month, i.amount, i.status, i.locked])).toEqual([0, 1, 2, 3, 4, 5].map((n) => [monthsLater(F, n), 1000, 'pending', false]));
      const rows = await prisma.payrollAdjustment.findMany({ where: { advanceId: loan.id }, orderBy: { month: 'asc' } });
      expect(rows.map((r) => [r.kind, r.type, r.taxed, r.reason])).toEqual([1, 2, 3, 4, 5, 6].map((n) => ['deduction', 'loan_installment', false, `Loan installment ${n} of 6`]));
      // the amounts only as set, as for a salary
      expect((await auditOf('payroll_advance', loan.id)).map((a) => [a.action, a.diff])).toEqual([
        [
          'create',
          {
            employeeCode: alpha.employeeCode,
            kind: 'loan',
            amount: 'set',
            givenOn: firstDay(m(-6)),
            reason: 'Invented car repair',
            plan: '6 installments of EGP 1,000.00',
            installments: { count: 6, firstMonth: F },
          },
        ],
      ]);
      expect((await auditOf('payroll_adjustment', rows[0].id))[0].diff).toMatchObject({ month: F, type: 'loan_installment', amount: 'set', reason: 'Loan installment 1 of 6', advanceId: loan.id });
    });

    it('refuses a plan that can’t be made', async () => {
      const body = { employeeId: alpha.id, kind: 'advance', amount: 500, givenOn: firstDay(m(-6)), reason: 'Invented advance' };
      const refused = async (b: object) => (await advance({ ...body, ...b }).expect(400)).body.message as string | string[];
      expect(await refused({ installments: { count: 0, firstMonth: F } })).toEqual(['Enter how many monthly installments, 1 to 60.']);
      expect(await refused({ installments: { count: 2, firstMonth: '2026-13' } })).toEqual(['Choose the month of the first installment, as YYYY-MM.']);
      expect(await refused({ amount: 0.05, installments: { count: 6, firstMonth: F } })).toBe('The total is too small to split into that many installments.');
      expect(await refused({ installments: { count: 2, firstMonth: m(-7) } })).toBe(
        `The advance was given on ${firstDay(m(-6)).split('-').reverse().join('/')}: start the installments from ${monthName(m(-6))} on.`,
      );
      expect(await refused({ employeeId: newcomer.id, installments: { count: 2, firstMonth: m(-1) } })).toBe(
        `Newcomer ${RUN} isn't employed in ${monthName(m(-1))}: start the installments from a month they are.`,
      );
    });

    it('HR moves one to a later month: it and every later one move a month on', async () => {
      for (const session of [finance, ceo]) await postpone(loan.id, { month: m(-4) }, session).expect(403);
      expect((await postpone(loan.id, { month: m(1) }).expect(400)).body.message).toBe(`This loan has no installment in ${monthName(m(1))}.`);
      loan = (await postpone(loan.id, { month: m(-4) }).expect(200)).body as Advance;
      expect(months(loan)).toEqual([
        [m(-5), 1000, 'pending'],
        [m(-3), 1000, 'pending'],
        [m(-2), 1000, 'pending'],
        [m(-1), 1000, 'pending'],
        [m(0), 1000, 'pending'],
        [m(1), 1000, 'pending'],
      ]);
      expect((await auditOf('payroll_advance', loan.id)).at(-1)).toMatchObject({ action: 'postpone_installment', diff: { month: m(-4), moved: 5 } });
    });

    it('HR changes one’s amount: the later ones share what is left; a lowered last one adds a month', async () => {
      expect((await change(loan.id, { month: m(-3), amount: 5000.01 }).expect(400)).body.message).toBe(
        // the shared rule's words (packages/shared installments.ts)
        'The installment can be at most EGP 5,000.00, what is left from that month on.',
      );
      expect((await change(loan.id, { month: m(-3), amount: 0 }).expect(400)).body.message).toEqual(['Enter the installment in EGP, more than 0, e.g. 1000 or 1000.50.']);
      loan = (await change(loan.id, { month: m(-3), amount: 1500 }).expect(200)).body as Advance;
      expect(months(loan)).toEqual([
        [m(-5), 1000, 'pending'],
        [m(-3), 1500, 'pending'],
        [m(-2), 875, 'pending'],
        [m(-1), 875, 'pending'],
        [m(0), 875, 'pending'],
        [m(1), 875, 'pending'],
      ]);
      loan = (await change(loan.id, { month: m(1), amount: 375 }).expect(200)).body as Advance;
      expect(months(loan).slice(-2)).toEqual([
        [m(1), 375, 'pending'],
        [m(2), 500, 'pending'],
      ]);
      expect(loan).toMatchObject({ amount: 6000, planned: 6000, outstanding: 6000 });
      // numbered again: 7 now
      const reasons = (await prisma.payrollAdjustment.findMany({ where: { advanceId: loan.id }, orderBy: { month: 'asc' } })).map((r) => r.reason);
      expect(reasons).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => `Loan installment ${n} of 7`));
      expect((await auditOf('payroll_advance', loan.id)).at(-1)).toMatchObject({ action: 'change_installment', diff: { month: m(1), amount: 'changed', installments: { from: 6, to: 7 } } });
    });

    it('never in a month whose run is with the CEO or approved; an applied one never', async () => {
      const run = await runOf(F);
      // the run takes the month's installment, and warns: 1,000 is more than 10% of the 9,000 pay
      const line = lineOf(run, alpha)!;
      expect(line.terms.adjustments?.map((a) => [a.type, a.amount])).toEqual([['loan_installment', 1000]]);
      expect(line.result.warnings).toContain(installmentLimitWarning(1000, 9000, 10));
      await api().post(`/api/payroll/runs/${run.id}/submit`).set('Cookie', hr).send({}).expect(200);

      expect((await getAdvance(loan.id)).installments[0]).toMatchObject({ month: F, locked: true });
      expect((await postpone(loan.id, { month: F }).expect(409)).body.message).toBe(`The ${monthName(F)} payroll is with the CEO, so its installment can't be moved.`);
      expect((await change(loan.id, { month: F, amount: 500 }).expect(409)).body.message).toBe(`The ${monthName(F)} payroll is with the CEO, so its installment can't be changed.`);
      expect(
        (await advance({ employeeId: beta.id, kind: 'loan', amount: 1000, givenOn: firstDay(F), reason: 'Invented', installments: { count: 2, firstMonth: F } }).expect(400)).body.message,
      ).toBe(`The ${monthName(F)} payroll is with the CEO, so it can't take an installment: start the installments from a later month.`);

      await api().post(`/api/payroll/runs/${run.id}/approve`).set('Cookie', ceo).send({}).expect(200);
      loan = await getAdvance(loan.id);
      expect(loan.installments[0]).toMatchObject({ month: F, status: 'applied', locked: true });
      expect(loan).toMatchObject({ recovered: 1000, outstanding: 5000, nextInstallment: { month: m(-3), amount: 1500 } });
      expect((await postpone(loan.id, { month: F }).expect(409)).body.message).toBe(`The ${monthName(F)} installment is applied, so it can't be moved.`);
      expect((await change(loan.id, { month: F, amount: 500 }).expect(409)).body.message).toBe(`The ${monthName(F)} installment is applied, so it can't be changed.`);
    });

    it('the plan form’s warning: the current gross, Payroll Setup’s share, the installments by month', async () => {
      for (const session of [hr, finance, ceo]) {
        expect((await api().get(`/api/payroll/advances/limit?employeeId=${alpha.id}`).set('Cookie', session).expect(200)).body).toEqual({
          gross: 9000,
          percent: 10,
          byMonth: { [m(-5)]: 1000, [m(-3)]: 1500, [m(-2)]: 875, [m(-1)]: 875, [m(0)]: 875, [m(1)]: 375, [m(2)]: 500 },
        });
      }
      await api().get(`/api/payroll/advances/limit?employeeId=${alpha.id}`).set('Cookie', staff).expect(403);
      await api().get('/api/payroll/advances/limit?employeeId=x').set('Cookie', hr).expect(400);
      // someone without a contract or installments
      expect((await api().get(`/api/payroll/advances/limit?employeeId=${leaver.id}`).set('Cookie', hr).expect(200)).body).toEqual({ gross: null, percent: 10, byMonth: {} });
    });
  });

  describe('the share of pay warning', () => {
    const PERCENT = "Enter the share of the pay a month's installments may take before a warning, from 1 to 100 percent, e.g. 10, or leave it empty for no warning.";

    it('is set in Payroll Setup, 10% to start with; the run’s lines warn with it', async () => {
      expect((await api().get('/api/payroll/settings').set('Cookie', finance).expect(200)).body.installmentWarnPercent).toBe(10);
      for (const session of [finance, ceo, staff]) await settings({ installmentWarnPercent: 20 }, session).expect(403);
      for (const bad of [0, 100.5, 1.234, '10']) expect([...new Set((await settings({ installmentWarnPercent: bad }).expect(400)).body.message)]).toEqual([PERCENT]);

      // the month's 1,500 is more than 10% of 9,000, not more than 20%
      let line = lineOf(await runOf(m(-3)), alpha)!;
      expect(line.result.warnings).toContain(installmentLimitWarning(1500, 9000, 10));
      const since = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
      expect((await settings({ installmentWarnPercent: 20 }).expect(200)).body.installmentWarnPercent).toBe(20);
      line = lineOf(await getRun(m(-3)), alpha)!;
      expect(line.result.warnings.filter((w) => w.startsWith("This month's installments"))).toEqual([]);
      expect((await settings({ installmentWarnPercent: 16.5 }).expect(200)).body.installmentWarnPercent).toBe(16.5);
      line = lineOf(await getRun(m(-3)), alpha)!;
      expect(line.result.warnings).toContain(installmentLimitWarning(1500, 9000, 16.5));
      // empty: no warning
      expect((await settings({ installmentWarnPercent: null }).expect(200)).body.installmentWarnPercent).toBeNull();
      line = lineOf(await getRun(m(-3)), alpha)!;
      expect(line.result.warnings.filter((w) => w.startsWith("This month's installments"))).toEqual([]);
      expect((await settings({ installmentWarnPercent: 10 }).expect(200)).body.installmentWarnPercent).toBe(10);
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'payroll_settings', id: { gt: since } }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.diff)).toEqual([
        { installmentWarnPercent: { from: 10, to: 20 } },
        { installmentWarnPercent: { from: 20, to: 16.5 } },
        { installmentWarnPercent: { from: 16.5, to: null } },
        { installmentWarnPercent: { from: null, to: 10 } },
      ]);
    });
  });

  describe('a recurring deduction', () => {
    let medical: Recurring; // Beta's, from m(-4) to m(-2)
    let raised: Recurring; // the same from m(-3), changed

    it('HR sets one up; HR, Finance and the CEO see it; the amount only as set', async () => {
      const body = { employeeId: beta.id, name: ' Medical subscription (family) ', amount: 350, startMonth: m(-4), endMonth: m(-2) };
      for (const session of [finance, ceo, staff]) await recurring(body, session).expect(403);
      const refused = async (b: object) => (await recurring({ ...body, ...b }).expect(400)).body.message as string | string[];
      expect(await refused({ endMonth: m(-5) })).toBe("The last month can't be before the first.");
      expect(await refused({ amount: 0 })).toEqual(['Enter the amount a month in EGP, more than 0, e.g. 350 or 350.50.']);
      expect(await refused({ name: '' })).toEqual(['Say what it is for, e.g. Medical subscription (family).']);
      expect(await refused({ name: 'x'.repeat(101) })).toEqual(['Keep the name to 100 characters or fewer.']);
      // a month whose run is approved never takes it
      expect((await recurring({ ...body, startMonth: F }).expect(409)).body.message).toBe(
        `The ${monthName(F)} payroll is approved, so its deductions can't be changed: start it from a later month.`,
      );

      medical = (await recurring(body).expect(201)).body as Recurring;
      expect(medical).toMatchObject({
        employee: { id: beta.id, employeeCode: beta.employeeCode, fullNameEn: `Beta ${RUN}`, department: null, team: null },
        name: 'Medical subscription (family)',
        amount: 350,
        startMonth: m(-4),
        endMonth: m(-2),
        stoppedFrom: null,
        status: 'ended', // its last month is before this one
        // the m(-3) draft, made before, takes it at once
        deducted: [{ month: m(-3), amount: 350, status: 'pending' }],
      });
      for (const session of [hr, finance, ceo]) {
        const listed = (await api().get(`/api/payroll/recurring-deductions?employeeId=${beta.id}`).set('Cookie', session).expect(200)).body as Recurring[];
        expect(listed.map((r) => r.id)).toEqual([medical.id]);
      }
      await api().get('/api/payroll/recurring-deductions').set('Cookie', staff).expect(403);
      expect(((await api().get(`/api/payroll/recurring-deductions?employeeId=${beta.id}&status=running`).set('Cookie', hr).expect(200)).body as Recurring[]).length).toBe(0);
      expect(((await api().get(`/api/payroll/recurring-deductions?employeeId=${beta.id}&status=ended`).set('Cookie', hr).expect(200)).body as Recurring[]).length).toBe(1);
      expect((await auditOf('recurring_deduction', medical.id)).map((a) => [a.action, a.diff])).toEqual([
        ['create', { employeeCode: beta.employeeCode, name: 'Medical subscription (family)', amount: 'set', startMonth: m(-4), endMonth: m(-2) }],
      ]);
    });

    it('a draft run of its months takes it once, however often it is refreshed; not before its first month nor after its last', async () => {
      expect(recurringOn(lineOf(await getRun(m(-3)), beta))).toEqual([[350, 'Medical subscription (family)']]);

      // before its first month (the approved run's), and after its last
      expect(recurringOn(lineOf(await getRun(F), beta))).toEqual([]);
      expect(recurringOn(lineOf(await runOf(m(-1)), beta))).toEqual([]);
      // its months: once each, refreshed twice
      for (let i = 0; i < 2; i++) expect(recurringOn(lineOf(await runOf(m(-4)), beta))).toEqual([[350, 'Medical subscription (family)']]);
      await runOf(m(-3));
      expect((await deductionsOf(medical.id)).map((d) => [d.month.toISOString().slice(0, 7), d.status, d.type])).toEqual([
        [m(-4), 'pending', 'recurring'],
        [m(-3), 'pending', 'recurring'],
      ]);
      const created = await prisma.payrollAdjustment.findFirstOrThrow({ where: { recurringId: medical.id, month: new Date(`${m(-4)}-01T00:00:00Z`) } });
      expect((await auditOf('payroll_adjustment', created.id))[0]).toMatchObject({
        action: 'create',
        diff: { month: m(-4), type: 'recurring', amount: 'set', reason: 'Medical subscription (family)', recurringId: medical.id, automatically: true },
      });
      // taken after tax, as every deduction
      expect(lineOf(await getRun(m(-4)), beta)!.result.adjustmentDeductions).toBe(350);
    });

    it('isn’t entered by hand, nor given a second deduction in a month', async () => {
      const add = { employeeId: beta.id, month: m(-1), kind: 'deduction', type: 'recurring', amount: 350, reason: 'Medical' };
      expect((await api().post('/api/payroll/adjustments').set('Cookie', hr).send(add).expect(400)).body.message).toBe(
        "A recurring deduction is added to each month's payroll by itself: set it up as a recurring deduction, or choose Other deduction for a one-off.",
      );
      const pending = await prisma.payrollAdjustment.findFirstOrThrow({ where: { recurringId: medical.id, month: new Date(`${m(-4)}-01T00:00:00Z`) } });
      expect((await api().post('/api/payroll/adjustments/move').set('Cookie', hr).send({ ids: [pending.id], month: m(-3) }).expect(409)).body.message).toBe(
        `Medical subscription (family) is deducted in ${monthName(m(-3))} already: it is deducted once a month.`,
      );
      expect((await api().patch(`/api/payroll/adjustments/${pending.id}`).set('Cookie', hr).send({ type: 'other' }).expect(400)).body.message).toBe(
        "A recurring deduction's month stays a Recurring deduction: cancel it instead.",
      );
    });

    it('HR changes its amount from a month on: this one stops then, a new one starts then', async () => {
      for (const session of [finance, ceo]) await api().post(`/api/payroll/recurring-deductions/${medical.id}/change`).set('Cookie', session).send({ amount: 400, fromMonth: m(-3) }).expect(403);
      const changeIt = (body: object) => api().post(`/api/payroll/recurring-deductions/${medical.id}/change`).set('Cookie', hr).send(body);
      expect((await changeIt({ amount: 400, fromMonth: m(-5) }).expect(400)).body.message).toBe(`It starts in ${monthName(m(-4))}: change it from then on.`);
      expect((await changeIt({ amount: 400, fromMonth: m(-1) }).expect(409)).body.message).toBe(`It isn't deducted in ${monthName(m(-1))}: its last month is ${monthName(m(-2))}.`);
      expect((await changeIt({ amount: 350, fromMonth: m(-3) }).expect(400)).body.message).toBe('It is EGP 350.00 a month already.');

      raised = (await changeIt({ amount: 400, fromMonth: m(-3) }).expect(200)).body as Recurring;
      expect(raised).toMatchObject({ name: 'Medical subscription (family)', amount: 400, startMonth: m(-3), endMonth: m(-2), stoppedFrom: null });
      // the m(-3) draft takes the new one, the old one's cancelled
      expect(raised.deducted).toEqual([{ month: m(-3), amount: 400, status: 'pending' }]);
      const old = await getRecurring(medical.id);
      expect(old).toMatchObject({ stoppedFrom: m(-3), stopNote: `Amount changed from ${monthName(m(-3))}`, status: 'ended' });
      expect(old.deducted).toEqual([
        { month: m(-4), amount: 350, status: 'pending' },
        { month: m(-3), amount: 350, status: 'cancelled' },
      ]);
      expect(recurringOn(lineOf(await getRun(m(-3)), beta))).toEqual([[400, 'Medical subscription (family)']]);
      expect(recurringOn(lineOf(await getRun(m(-4)), beta))).toEqual([[350, 'Medical subscription (family)']]);
      expect((await auditOf('recurring_deduction', medical.id)).at(-1)).toMatchObject({ action: 'change', diff: { amount: 'changed', stoppedFrom: m(-3), replacedBy: raised.id } });
      expect((await auditOf('recurring_deduction', raised.id))[0]).toMatchObject({ action: 'create', diff: { amount: 'set', startMonth: m(-3), replaces: medical.id } });
    });

    it('HR stops it from a month on: no longer deducted then', async () => {
      const stop = (id: string, body: object, session = hr) => api().post(`/api/payroll/recurring-deductions/${id}/stop`).set('Cookie', session).send(body);
      await stop(raised.id, { fromMonth: m(-2) }, finance).expect(403);
      expect((await stop(raised.id, { fromMonth: m(-1) }).expect(409)).body.message).toBe(`Its last month is ${monthName(m(-2))}: nothing is deducted from ${monthName(m(-1))} on.`);
      const stopped = (await stop(raised.id, { fromMonth: m(-2), note: ' Moved to the family plan ' }).expect(200)).body as Recurring;
      expect(stopped).toMatchObject({ stoppedFrom: m(-2), stopNote: 'Moved to the family plan', status: 'ended' });
      expect(recurringOn(lineOf(await runOf(m(-2)), beta))).toEqual([]);
      expect((await stop(raised.id, { fromMonth: m(-2) }).expect(409)).body.message).toBe(`It is stopped from ${monthName(m(-2))} already.`);
      expect((await auditOf('recurring_deduction', raised.id)).at(-1)).toMatchObject({ action: 'stop', diff: { stoppedFrom: { from: null, to: m(-2) }, note: 'Moved to the family plan' } });
    });

    it('is added only for the months the employee is employed', async () => {
      const gym = (await recurring({ employeeId: newcomer.id, name: 'Gym membership', amount: 120.5, startMonth: m(-1) }).expect(201)).body as Recurring;
      // the m(-1) draft: not employed yet; this month's: employed
      expect(gym.deducted).toEqual([]);
      await runOf(m(-1));
      await runOf(m(0));
      expect((await getRecurring(gym.id)).deducted).toEqual([{ month: m(0), amount: 120.5, status: 'pending' }]);
      // HR renames it: the month's pending one says so too
      const renamed = (await api().patch(`/api/payroll/recurring-deductions/${gym.id}`).set('Cookie', hr).send({ name: 'Gym membership (club)' }).expect(200)).body as Recurring;
      expect(renamed.name).toBe('Gym membership (club)');
      expect((await prisma.payrollAdjustment.findFirstOrThrow({ where: { recurringId: gym.id } })).reason).toBe('Gym membership (club)');
      // and gives it a last month: none after
      expect((await api().patch(`/api/payroll/recurring-deductions/${gym.id}`).set('Cookie', hr).send({ endMonth: m(-1) }).expect(200)).body).toMatchObject({
        endMonth: m(-1),
        status: 'ended',
        deducted: [{ month: m(0), amount: 120.5, status: 'cancelled' }],
      });
    });
  });

  describe('leaving', () => {
    let subscription: Recurring;
    let leaverLoan: Advance;
    let leaverAdvance: Advance;
    const LEFT = lastDay(m(-1));

    it('an employment ending stops its recurring deductions from the month after the last working day', async () => {
      subscription = (await recurring({ employeeId: leaver.id, name: 'Medical subscription', amount: 200, startMonth: m(-2) }).expect(201)).body as Recurring;
      // the drafts of its months took it (Leaver has no contract, so no line)
      expect(subscription.deducted.map((d) => [d.month, d.status])).toEqual([
        [m(-2), 'pending'],
        [m(-1), 'pending'],
        [m(0), 'pending'],
      ]);
      leaverLoan = (
        await advance({ employeeId: leaver.id, kind: 'loan', amount: 3000, givenOn: firstDay(m(-1)), reason: 'Invented laptop', installments: { count: 3, firstMonth: m(-1) } }).expect(201)
      ).body as Advance;
      leaverAdvance = (await advance({ employeeId: leaver.id, kind: 'advance', amount: 500, givenOn: firstDay(m(-1)), reason: 'Invented advance' }).expect(201)).body as Advance;

      await api().post(`/api/employees/${leaver.id}/employments/${leaver.employmentId}/end`).set('Cookie', hr).send({ endDate: LEFT, endReason: 'resigned' }).expect(200);
      const stopped = await getRecurring(subscription.id);
      expect(stopped).toMatchObject({ stoppedFrom: m(0), stopNote: 'Left the company', status: 'ended' });
      expect(stopped.deducted.map((d) => [d.month, d.status])).toEqual([
        [m(-2), 'pending'],
        [m(-1), 'pending'],
        [m(0), 'cancelled'],
      ]);
      expect((await auditOf('recurring_deduction', subscription.id)).at(-1)).toMatchObject({
        action: 'stop',
        diff: { stoppedFrom: { from: null, to: m(0) }, note: 'Left the company', automatically: true },
      });
      // a refresh adds nothing back
      await runOf(m(0));
      expect((await getRecurring(subscription.id)).deducted.map((d) => d.status)).toEqual(['pending', 'pending', 'cancelled']);
    });

    it('lists what is left of their advances and loans on the final settlement: deducted from it, or waived with a note', async () => {
      const settlement = async () => (await api().get(`/api/payroll/final-settlements/${leaver.employmentId}`).set('Cookie', finance).expect(200)).body;
      expect((await settlement()).outstanding).toEqual([
        { advanceId: leaverLoan.id, kind: 'loan', reason: 'Invented laptop', outstanding: 3000 },
        { advanceId: leaverAdvance.id, kind: 'advance', reason: 'Invented advance', outstanding: 500 },
      ]);
      const unsettled = (await api().get('/api/payroll/unsettled').set('Cookie', hr).expect(200)).body;
      expect(unsettled.settlements.rows.find((r: { employmentId: string }) => r.employmentId === leaver.employmentId).outstanding).toHaveLength(2);

      // deducted from the final settlement: settled so, its installments still pending cancelled
      for (const session of [finance, ceo]) await settle(leaverLoan.id, { how: 'final_settlement' }, session).expect(403);
      expect((await settle(leaverLoan.id, { how: 'cash', note: 'x' }).expect(400)).body.message).toEqual(['Choose how it is settled: deducted from the final settlement, waived or paid back.']);
      const deducted = (await settle(leaverLoan.id, { how: 'final_settlement' }).expect(200)).body as Advance;
      expect(deducted).toMatchObject({ status: 'settled', settledHow: 'final_settlement', settledNote: null, nextInstallment: null });
      expect(deducted.installments.map((i) => i.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
      expect((await auditOf('payroll_advance', leaverLoan.id)).at(-1)).toMatchObject({
        action: 'settle',
        diff: { status: { from: 'open', to: 'settled' }, how: 'final_settlement', note: null, outstanding: 'some', installmentsCancelled: 3 },
      });

      // waived: a note why, required
      expect((await settle(leaverAdvance.id, { how: 'waived' }).expect(400)).body.message).toContain('Say why it is waived.');
      expect((await settle(leaverAdvance.id, { how: 'waived', note: '  ' }).expect(400)).body.message).toContain('Say why it is waived.');
      const waived = (await settle(leaverAdvance.id, { how: 'waived', note: ' Approved by the CEO on leaving ' }).expect(200)).body as Advance & { settledBy: { id: string } | null };
      expect(waived).toMatchObject({ status: 'settled', settledHow: 'waived', settledNote: 'Approved by the CEO on leaving' });
      expect(waived.settledBy).not.toBeNull();
      expect((await auditOf('payroll_advance', leaverAdvance.id)).at(-1)).toMatchObject({ action: 'settle', diff: { how: 'waived', note: 'Approved by the CEO on leaving' } });
      expect((await settlement()).outstanding).toEqual([]);
    });
  });

  describe('the employee’s own plans', () => {
    it('Alpha sees their own loans and recurring deductions; HR, Finance and the CEO too; nobody else', async () => {
      await recurring({ employeeId: alpha.id, name: 'Club membership', amount: 99.99, startMonth: m(1) }).expect(201);
      for (const session of [alphaSelf, hr, finance, ceo]) {
        const plans = (await api().get(`/api/employees/${alpha.id}/deduction-plans`).set('Cookie', session).expect(200)).body;
        expect(plans).toEqual({
          advances: [
            {
              id: loan.id,
              kind: 'loan',
              reason: 'Invented car repair',
              amount: 6000,
              recovered: 1000,
              outstanding: 5000,
              nextInstallment: { month: m(-3), amount: 1500 },
              status: 'open',
            },
          ],
          recurring: [{ id: expect.any(String), name: 'Club membership', amount: 99.99, startMonth: m(1), endMonth: null, status: 'upcoming' }],
        });
      }
      // another employee's: not theirs; nor anyone's for someone else
      expect((await api().get(`/api/employees/${beta.id}/deduction-plans`).set('Cookie', alphaSelf).expect(403)).body.message).toBe(
        'Only the employee themself, HR, Finance and the CEO see their loans and deductions.',
      );
      await api().get(`/api/employees/${alpha.id}/deduction-plans`).set('Cookie', staff).expect(403);
      await api().get('/api/employees/00000000-0000-4000-8000-000000000000/deduction-plans').set('Cookie', hr).expect(404);
    });
  });

});
