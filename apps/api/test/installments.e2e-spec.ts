import type { INestApplication } from '@nestjs/common';
import { damageLimitWarning, deductionLimitWarning, grossToNet, installmentLimitWarning, monthlySalaryTax } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { LawRatesService } from '../src/payroll/law-rates/law-rates.service.js';
import { firstDay, lastDay, monthName, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Installments and recurring deductions (owner, 18 October 2026: "in the deductions i might have a loan of a medical
// subscription or something that needs to be deducted as installments on the employee. how will it be managed?"): a
// loan's installments made at once, moved and changed by HR but never in a month whose run is with the CEO, approved or
// paid; a recurring deduction added once to each month's run it is due in, while the employee is employed, until it
// ends or is stopped, stopped too when the employment ends; what is left of a leaver's loans "taken from the final
// settlement, unless waived"; the employee's own plans; and the Labour Law's limits (owner, 18 October 2026, after
// reading the law: "Block above 10%", "Warn above 25%, record the consent"): installments past 10% of the wage (or
// Payroll Setup's lower limit) refused, planned, changed, moved or entered by hand, and warned of on the run's line;
// recurring deductions set up only with the employee's signed consent on file, and warned of past 25% after tax,
// insurance and installments; damage past 5 days' wage warned of. Other test files leave people with signed contracts
// in the same database, who are on the runs too: these tests look at their own people (names end with RUN), and delete
// everything they made. Every name and amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const C = TODAY.slice(0, 7);
const m = (n: number) => monthsLater(C, n);
/** The loan's first month: its run is sent to the CEO, then approved. */
const F = m(-5);
/** The months whose runs these tests make. */
const MONTHS = [m(-5), m(-4), m(-3), m(-2), m(-1), m(0)];
const JOINED = firstDay(m(-11));
/** Alpha's monthly gross: a month's installments may take EGP 1,500.00 of it (10%). */
const ALPHA_GROSS = 15_000;
/** The law's limit, as the API says it (Labour Law Art. 113). */
const LIMIT_MESSAGE = `Enter the most a month's installments of advances and loans may take, from 1 to 10 percent of the wage, e.g. 10: the law allows at most 10% (Labour Law Art. 113).`;
const CONSENT_MESSAGE =
  "Tick that the employee's signed consent to this deduction is on file: a deduction from the pay they agree to needs their written consent (Labour Law Art. 114).";
/** A real 1×1 PNG and a PDF's first bytes: the signed consent, as a photo or a scan. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n% the signed consent\n%%EOF\n');

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
  consent: { recordedAt: string; recordedBy: { id: string; name: string } | null; paper: { id: string; fileName: string } | null } | null;
}

interface Line {
  id: string;
  employeeId: string;
  terms: { gross: number; adjustments?: { id: string; kind: string; type: string; amount: number | null; reason: string }[] };
  result: { warnings: string[]; adjustmentDeductions?: number; earned: number; allowances: number; monthlyTax: number; employeeInsurance: number };
}

interface Run {
  id: string;
  status: string;
  rules: { dayDivisor: number };
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
  const ocrUrlBefore = process.env.OCR_URL;
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
  /** Sets one up, the employee's signed consent on file unless the body says otherwise. */
  const recurring = (body: object, session = hr) => api().post('/api/payroll/recurring-deductions').set('Cookie', session).send({ consentOnFile: true, ...body });
  const adjust = (body: object) => api().post('/api/payroll/adjustments').set('Cookie', hr).send(body);
  const getRecurring = async (id: string) => (await api().get(`/api/payroll/recurring-deductions/${id}`).set('Cookie', hr).expect(200)).body as Recurring;
  const months = (a: Advance) => a.installments.map((i) => [i.month, i.amount, i.status]);
  const auditOf = (entityType: string, entityId: string) => prisma.auditLog.findMany({ where: { entityType, entityId }, orderBy: { id: 'asc' } });
  const settings = (body: object, session = hr) => api().patch('/api/payroll/settings').set('Cookie', session).send(body);
  const limitOf = async (p: Person) => (await api().get(`/api/payroll/advances/limit?employeeId=${p.id}`).set('Cookie', hr).expect(200)).body;

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
    // no OCR service: the signed consents are kept unread
    process.env.OCR_URL = '';
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    const alphaEmail = await createUser(prisma, ['employee']);
    alphaSelf = await signIn(app, alphaEmail);
    await prisma.payrollRun.deleteMany({ where: { month: { in: MONTHS.map((x) => new Date(`${x}-01T00:00:00Z`)) } } });
    alpha = await hire('Alpha', JOINED, ALPHA_GROSS);
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
    await prisma.payrollSettings.update({ where: { id: 1 }, data: { installmentLimitPercent: 10 } });
    await app.close();
    if (ocrUrlBefore === undefined) delete process.env.OCR_URL;
    else process.env.OCR_URL = ocrUrlBefore;
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

    it('refuses a plan that takes a month past 10% of the wage, all the employee’s installments together (Labour Law Art. 113)', async () => {
      // Beta's 9,000: at most 900 a month; 6,000 in 6 is 1,000
      const body = { employeeId: beta.id, kind: 'loan', amount: 6000, givenOn: firstDay(m(-6)), reason: 'Invented loan', installments: { count: 6, firstMonth: m(1) } };
      expect((await advance(body).expect(400)).body.message).toBe(
        `In ${monthName(m(1))} the installments of advances and loans would be EGP 1,000.00, more than 10% of the gross pay of EGP 9,000.00 (EGP 900.00), the most the law allows (Labour Law Art. 113). Spread it over more months: 7 monthly installments would keep every month within the limit.`,
      );
      // with Alpha's loan: 1,000 a month of the 1,500 taken from F to this month, so 3,000 more fits from m(-2) only in 6
      const more = { employeeId: alpha.id, kind: 'advance', amount: 3000, givenOn: firstDay(m(-6)), reason: 'Invented advance', installments: { count: 3, firstMonth: m(-2) } };
      expect((await advance(more).expect(400)).body.message).toBe(
        `In ${monthName(m(-2))} the installments of advances and loans would be EGP 2,000.00, more than 10% of the gross pay of EGP 15,000.00 (EGP 1,500.00), the most the law allows (Labour Law Art. 113). Spread it over more months: 6 monthly installments would keep every month within the limit.`,
      );
      // nothing was made
      expect(await prisma.payrollAdvance.count({ where: { employeeId: { in: [alpha.id, beta.id] } } })).toBe(1);
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
      // past 10% of Alpha's 15,000 (Labour Law Art. 113): refused, nothing changed
      expect((await change(loan.id, { month: m(-3), amount: 1500.01 }).expect(400)).body.message).toBe(
        `In ${monthName(m(-3))} the installments of advances and loans would be EGP 1,500.01, more than 10% of the gross pay of EGP 15,000.00 (EGP 1,500.00), the most the law allows (Labour Law Art. 113). Choose another amount, so that no month takes more.`,
      );
      expect(months(await getAdvance(loan.id)).map(([, amount]) => amount)).toEqual([1000, 1000, 1000, 1000, 1000, 1000]);
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

    it('refuses a move to a later month that takes that month past 10% of the wage', async () => {
      // another advance's 1,200 in m(3): moving the loan's last (500, m(2)) there would make it 1,700
      const other = (
        await advance({ employeeId: alpha.id, kind: 'advance', amount: 1200, givenOn: firstDay(m(-1)), reason: 'Invented advance', installments: { count: 1, firstMonth: m(3) } }).expect(201)
      ).body as Advance;
      expect((await postpone(loan.id, { month: m(2) }).expect(400)).body.message).toBe(
        `In ${monthName(m(3))} the installments of advances and loans would be EGP 1,700.00, more than 10% of the gross pay of EGP 15,000.00 (EGP 1,500.00), the most the law allows (Labour Law Art. 113). Change the installments' amounts instead, so that no month takes more.`,
      );
      expect(months(await getAdvance(loan.id)).at(-1)).toEqual([m(2), 500, 'pending']);
      await settle(other.id, { how: 'paid_back', note: 'Invented: paid in cash' }).expect(200);
    });

    it('refuses a recovery entered by hand on Additions / Deductions past 10% of the wage, changed or moved there too', async () => {
      const given = (await advance({ employeeId: alpha.id, kind: 'advance', amount: 2000, givenOn: firstDay(m(-6)), reason: 'Invented advance by hand' }).expect(201)).body as Advance;
      const recovery = { employeeId: alpha.id, month: m(-2), kind: 'deduction', type: 'advance_recovery', amount: 625.01, reason: 'Invented recovery', advanceId: given.id };
      // m(-2) has the loan's 875
      const tooMuch = `In ${monthName(m(-2))} the installments of advances and loans would be EGP 1,500.01, more than 10% of the gross pay of EGP 15,000.00 (EGP 1,500.00), the most the law allows (Labour Law Art. 113). Enter a smaller amount, and recover the rest in a later month.`;
      expect((await adjust(recovery).expect(400)).body.message).toBe(tooMuch);
      const entered = (await adjust({ ...recovery, amount: 625 }).expect(201)).body as { id: string };
      expect((await api().patch(`/api/payroll/adjustments/${entered.id}`).set('Cookie', hr).send({ amount: 625.01 }).expect(400)).body.message).toBe(tooMuch);
      // m(-3) has 1,500 already
      expect((await api().post('/api/payroll/adjustments/move').set('Cookie', hr).send({ ids: [entered.id], month: m(-3) }).expect(400)).body.message).toBe(
        `In ${monthName(m(-3))} the installments of advances and loans would be EGP 2,125.00, more than 10% of the gross pay of EGP 15,000.00 (EGP 1,500.00), the most the law allows (Labour Law Art. 113). Move them to another month, or change their amounts.`,
      );
      // another deduction isn't an installment
      await adjust({ ...recovery, type: 'other', amount: 5000, advanceId: undefined }).expect(201);
      // its pending recovery cancelled with it
      await settle(given.id, { how: 'paid_back', note: 'Invented: paid in cash' }).expect(200);
      await prisma.payrollAdjustment.deleteMany({ where: { employeeId: alpha.id, type: 'other' } });
    });

    it('never in a month whose run is with the CEO or approved; an applied one never', async () => {
      const run = await runOf(F);
      // the run takes the month's installment: 1,000 is within 10% of the 15,000 pay, no warning
      const line = lineOf(run, alpha)!;
      expect(line.terms.adjustments?.map((a) => [a.type, a.amount])).toEqual([['loan_installment', 1000]]);
      expect(line.result.warnings.filter((w) => w.includes('Art. 113'))).toEqual([]);
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

    it('the forms’ figures: the current gross, the limit, the installments by month, about the tax and insurance, the recurring deductions', async () => {
      // this year's rates; Alpha isn't registered with social insurance: no insurance, the tax on the whole gross
      const rates = await app.get(LawRatesService).forYear(Number(C.slice(0, 4)));
      const tax = monthlySalaryTax({ taxedPay: ALPHA_GROSS, employeeInsurance: 0 }, rates).monthlyTax;
      for (const session of [hr, finance, ceo]) {
        expect((await api().get(`/api/payroll/advances/limit?employeeId=${alpha.id}`).set('Cookie', session).expect(200)).body).toEqual({
          gross: ALPHA_GROSS,
          percent: 10,
          // the cancelled ones of the advances paid back left out
          byMonth: { [m(-5)]: 1000, [m(-3)]: 1500, [m(-2)]: 875, [m(-1)]: 875, [m(0)]: 875, [m(1)]: 375, [m(2)]: 500 },
          tax,
          insurance: 0,
          recurring: [],
        });
      }
      expect(tax).toBeGreaterThan(0);
      // registered: the employee's share, as the gross comes to
      await prisma.employee.update({ where: { id: alpha.id }, data: { socialInsured: true } });
      expect(await limitOf(alpha)).toMatchObject({ insurance: grossToNet(ALPHA_GROSS, rates).employeeInsurance, tax: grossToNet(ALPHA_GROSS, rates).monthlyTax });
      await prisma.employee.update({ where: { id: alpha.id }, data: { socialInsured: false } });
      await api().get(`/api/payroll/advances/limit?employeeId=${alpha.id}`).set('Cookie', staff).expect(403);
      await api().get('/api/payroll/advances/limit?employeeId=x').set('Cookie', hr).expect(400);
      // someone without a contract or installments: nothing to check against
      expect(await limitOf(leaver)).toEqual({ gross: null, percent: 10, byMonth: {}, tax: null, insurance: null, recurring: [] });
    });
  });

  describe('the law’s limit in Payroll Setup', () => {
    it('is 10% to start with, lower if set so, never above the law’s; plans are refused past it and the run’s lines warn', async () => {
      expect((await api().get('/api/payroll/settings').set('Cookie', finance).expect(200)).body.installmentLimitPercent).toBe(10);
      for (const session of [finance, ceo, staff]) await settings({ installmentLimitPercent: 5 }, session).expect(403);
      for (const bad of [0, 0.5, 10.01, 20, 100, 1.234, '10', null]) expect([...new Set((await settings({ installmentLimitPercent: bad }).expect(400)).body.message)]).toEqual([LIMIT_MESSAGE]);
      // the old name is gone
      await settings({ installmentWarnPercent: 10 }).expect(400);

      // the month's 1,500 is 10% of 15,000 exactly: no warning
      let line = lineOf(await runOf(m(-3)), alpha)!;
      expect(line.result.warnings.filter((w) => w.includes('Art. 113'))).toEqual([]);
      const since = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
      expect((await settings({ installmentLimitPercent: 5 }).expect(200)).body.installmentLimitPercent).toBe(5);
      // planned within 10%, the line warns past the lower limit set
      line = lineOf(await getRun(m(-3)), alpha)!;
      expect(line.result.warnings).toContain(installmentLimitWarning(1500, ALPHA_GROSS, 5));
      expect(installmentLimitWarning(1500, ALPHA_GROSS, 5)).toContain('the limit set in Payroll Setup (the law allows at most 10%, Labour Law Art. 113)');
      // a new plan past it is refused: 1,000 in m(3) is more than 750
      expect(
        (await advance({ employeeId: alpha.id, kind: 'advance', amount: 1000, givenOn: firstDay(m(-1)), reason: 'Invented', installments: { count: 1, firstMonth: m(3) } }).expect(400)).body.message,
      ).toBe(
        `In ${monthName(m(3))} the installments of advances and loans would be EGP 1,000.00, more than 5% of the gross pay of EGP 15,000.00 (EGP 750.00), the limit set in Payroll Setup (the law allows at most 10%, Labour Law Art. 113). Spread it over more months: 2 monthly installments would keep every month within the limit.`,
      );
      expect((await settings({ installmentLimitPercent: 10 }).expect(200)).body.installmentLimitPercent).toBe(10);
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'payroll_settings', id: { gt: since } }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.diff)).toEqual([{ installmentLimitPercent: { from: 10, to: 5 } }, { installmentLimitPercent: { from: 5, to: 10 } }]);
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
      // the employee's signed consent on file (Labour Law Art. 114), required
      expect(await refused({ consentOnFile: false })).toEqual([CONSENT_MESSAGE]);
      expect((await api().post('/api/payroll/recurring-deductions').set('Cookie', hr).send(body).expect(400)).body.message).toEqual([CONSENT_MESSAGE]);
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
        consent: { recordedAt: expect.any(String), recordedBy: { id: expect.any(String), name: expect.any(String) }, paper: null },
      });
      for (const session of [hr, finance, ceo]) {
        const listed = (await api().get(`/api/payroll/recurring-deductions?employeeId=${beta.id}`).set('Cookie', session).expect(200)).body as Recurring[];
        expect(listed.map((r) => r.id)).toEqual([medical.id]);
      }
      await api().get('/api/payroll/recurring-deductions').set('Cookie', staff).expect(403);
      expect(((await api().get(`/api/payroll/recurring-deductions?employeeId=${beta.id}&status=running`).set('Cookie', hr).expect(200)).body as Recurring[]).length).toBe(0);
      expect(((await api().get(`/api/payroll/recurring-deductions?employeeId=${beta.id}&status=ended`).set('Cookie', hr).expect(200)).body as Recurring[]).length).toBe(1);
      expect((await auditOf('recurring_deduction', medical.id)).map((a) => [a.action, a.diff])).toEqual([
        ['create', { employeeCode: beta.employeeCode, name: 'Medical subscription (family)', amount: 'set', startMonth: m(-4), endMonth: m(-2), consent: 'recorded' }],
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
      // more needs the employee's signed consent to it (Labour Law Art. 114)
      expect((await changeIt({ amount: 400, fromMonth: m(-3) }).expect(400)).body.message).toBe(
        "Tick that the employee's signed consent to the new amount is on file: a deduction from the pay they agree to needs their written consent (Labour Law Art. 114).",
      );

      raised = (await changeIt({ amount: 400, fromMonth: m(-3), consentOnFile: true }).expect(200)).body as Recurring;
      expect(raised.consent).toMatchObject({ recordedAt: expect.any(String), paper: null });
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

    it('HR records the consent of one set up before it was asked, and attaches the signed consent, kept in the employee file', async () => {
      const old = (await recurring({ employeeId: newcomer.id, name: 'Old canteen share', amount: 50, startMonth: m(1) }).expect(201)).body as Recurring;
      // as one set up before 18 October 2026
      await prisma.recurringDeduction.update({ where: { id: old.id }, data: { consentRecordedAt: null, consentRecordedById: null } });
      expect((await getRecurring(old.id)).consent).toBeNull();
      const consent = (id: string, session = hr) => api().post(`/api/payroll/recurring-deductions/${id}/consent`).set('Cookie', session);
      for (const session of [finance, ceo, staff]) await consent(old.id, session).expect(403);
      const recorded = (await consent(old.id).expect(200)).body as Recurring;
      expect(recorded.consent).toMatchObject({ recordedAt: expect.any(String), recordedBy: { id: expect.any(String) }, paper: null });
      expect((await consent(old.id).expect(409)).body.message).toBe('Its consent is recorded already. Attach the signed consent to keep it with it.');
      // a file that isn't a photo or a PDF: refused, nothing changed
      expect((await consent(old.id).attach('consentFile', Buffer.from('just text'), 'consent.txt').expect(400)).body.message).toBe('The file must be a JPEG, PNG or WebP image, or a PDF.');
      const attached = (await consent(old.id).attach('consentFile', PDF, 'موافقة.pdf').expect(200)).body as Recurring;
      expect(attached.consent).toMatchObject({ recordedAt: recorded.consent!.recordedAt, paper: { id: expect.any(String), fileName: 'موافقة.pdf' } });
      // in the employee file, as a signed deduction consent
      const paper = await prisma.paperworkItem.findUniqueOrThrow({ where: { id: attached.consent!.paper!.id } });
      expect(paper).toMatchObject({ employeeId: newcomer.id, kind: 'deduction_consent', mimeType: 'application/pdf' });
      expect((await api().get(`/api/paperwork/${paper.id}/file`).set('Cookie', hr).expect(200)).headers['content-type']).toBe('application/pdf');
      expect((await auditOf('recurring_deduction', old.id)).map((a) => a.diff)).toEqual([
        expect.objectContaining({ consent: 'recorded' }),
        { employeeCode: newcomer.employeeCode, name: 'Old canteen share', consent: { from: 'not recorded', to: 'recorded' } },
        { employeeCode: newcomer.employeeCode, name: 'Old canteen share', consent: 'as before', consentFile: 'موافقة.pdf', consentPaperworkId: { from: null, to: paper.id } },
      ]);
    });

    it('is set up with the signed consent attached, as a form: refused whole when the file isn’t a photo or a PDF', async () => {
      const form = (file: Buffer, name: string) =>
        api()
          .post('/api/payroll/recurring-deductions')
          .set('Cookie', hr)
          .field('employeeId', newcomer.id)
          .field('name', 'Parking share')
          .field('amount', '75.50')
          .field('startMonth', m(2))
          .field('endMonth', '')
          .field('consentOnFile', 'true')
          .attach('consentFile', file, name);
      const before = await prisma.recurringDeduction.count({ where: { employeeId: newcomer.id } });
      await form(Buffer.from('not a scan'), 'consent.png').expect(400);
      expect(await prisma.recurringDeduction.count({ where: { employeeId: newcomer.id } })).toBe(before);
      const made = (await form(PNG, 'consent.png').expect(201)).body as Recurring;
      expect(made).toMatchObject({ name: 'Parking share', amount: 75.5, startMonth: m(2), endMonth: null, consent: { paper: { fileName: 'consent.png' } } });
      expect((await prisma.paperworkItem.findUniqueOrThrow({ where: { id: made.consent!.paper!.id } })).kind).toBe('deduction_consent');
      expect((await auditOf('recurring_deduction', made.id))[0].diff).toMatchObject({ consent: 'recorded', consentFile: 'consent.png' });
      // without the tick, refused even with the file
      await api()
        .post('/api/payroll/recurring-deductions')
        .set('Cookie', hr)
        .field('employeeId', newcomer.id)
        .field('name', 'Parking share')
        .field('amount', '75.50')
        .field('startMonth', m(2))
        .attach('consentFile', PNG, 'consent.png')
        .expect(400);
    });

    it('warns on the run’s line when the month’s recurring deductions pass 25% of the pay after tax, insurance and installments (Art. 114)', async () => {
      // Beta's 9,000 less about the tax: 2,500 a month is more than a quarter of what is left
      const gym = (await recurring({ employeeId: beta.id, name: 'Invented gym', amount: 2500, startMonth: m(0), endMonth: m(0) }).expect(201)).body as Recurring;
      expect(gym.deducted).toEqual([{ month: m(0), amount: 2500, status: 'pending' }]);
      const line = lineOf(await getRun(m(0)), beta)!;
      const expected = deductionLimitWarning(2500, {
        pay: line.result.earned + line.result.allowances,
        tax: line.result.monthlyTax,
        insurance: line.result.employeeInsurance,
        installments: 0,
      });
      expect(expected).toMatch(/^This month's recurring deductions, EGP 2,500\.00, are more than 25% /);
      expect(line.result.warnings).toContain(expected);
      // the forms read it: Beta's recurring deductions not ended
      expect((await limitOf(beta)).recurring).toEqual([{ id: gym.id, amount: 2500, startMonth: m(0), endMonth: m(0), stoppedFrom: null }]);
      await api().post(`/api/payroll/recurring-deductions/${gym.id}/stop`).set('Cookie', hr).send({ fromMonth: m(0) }).expect(200);
      expect(lineOf(await getRun(m(0)), beta)!.result.warnings.filter((w) => w.includes('Art. 114'))).toEqual([]);
    });

    it('warns on Additions / Deductions and the run’s line when a month’s damage or loss passes 5 days’ wage (Art. 151)', async () => {
      // 9,000 ÷ 30 × 5 = 1,500
      const damage = { employeeId: beta.id, month: m(-1), kind: 'deduction', type: 'damage_loss', amount: 1000, reason: 'Invented broken screen' };
      const entered = [((await adjust(damage).expect(201)).body as { id: string }).id];
      const choices = async () => (await api().get(`/api/payroll/adjustments/choices?month=${m(-1)}`).set('Cookie', finance).expect(200)).body.warnings as { employeeId: string; text: string }[];
      expect((await choices()).filter((w) => w.employeeId === beta.id)).toEqual([]);
      entered.push(((await adjust({ ...damage, amount: 500.01, reason: 'Invented lost charger' }).expect(201)).body as { id: string }).id);
      const run = await getRun(m(-1));
      const text = damageLimitWarning(1500.01, 9000, run.rules.dayDivisor);
      expect(text).toMatch(/^This month's damage or loss deductions, EGP 1,500\.01, are more than 5 days' wage/);
      expect((await choices()).filter((w) => w.employeeId === beta.id)).toEqual([{ employeeId: beta.id, text }]);
      expect(lineOf(run, beta)!.result.warnings).toContain(text);
      // a warning only: it stays
      expect(lineOf(run, beta)!.result.adjustmentDeductions).toBe(1500.01);
      for (const id of entered) await api().post(`/api/payroll/adjustments/${id}/cancel`).set('Cookie', hr).send({}).expect(200);
      expect(lineOf(await getRun(m(-1)), beta)!.result.warnings.filter((w) => w.includes('Art. 151'))).toEqual([]);
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
