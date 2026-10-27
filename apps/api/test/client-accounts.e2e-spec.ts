import type { INestApplication } from '@nestjs/common';
import { calendarDaysInMonth, payrollLine, type PayrollInputs, type PayrollResult, type PayrollRules, type PayrollTerms } from '@trendlix/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { firstDay, lastDay, monthName, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { PDF } from '../src/recruitment/cv-file.js';
import { cvText } from '../src/recruitment/cv-text.js';
import { createApp, createUser, signIn } from './helpers.js';

// Clients → Client Accounts and the accounts allowance (owner, 25 October 2026: "if an employee has an allowance per
// account, how can we deal with it?"; asked, a "Client accounts list", the rate "variable", "By days"): the accounts
// and their sizes, the people assigned with dates and an amount each, who may do what, the amounts hidden as salaries
// are, C-level people's for the CEO, and payroll paying the month's accounts by days held as the Accounts allowance.
// Other test files leave people with signed contracts in the same database, so these tests look at their own people
// and accounts (names end with RUN). The run is for last month. Every name, account and amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const CURRENT = todayInCairo().slice(0, 7);
/** The run's month: last month. */
const MONTH = monthsLater(CURRENT, -1);
const MONTH_DAYS = calendarDaysInMonth(MONTH);
/** Employed well before the run's month. */
const JOINED = firstDay(monthsLater(CURRENT, -3));
const piasters = (n: number) => Math.round(n * 100) / 100;

interface Assignment {
  id: string;
  accountId: string;
  employee: { id: string; employeeCode: string; fullNameEn: string };
  fromDate: string;
  toDate: string | null;
  amount: number | null;
  contractAmount?: number | null;
  note: string | null;
  standing: string;
}

interface Account {
  id: string;
  nameEn: string;
  code: string | null;
  status: string;
  endedOn: string | null;
  tier: { id: string; nameEn: string } | null;
  defaultAmount: number | null;
  assignments: Assignment[];
  hidden: number;
}

interface Line {
  id: string;
  employeeId: string;
  terms: PayrollTerms;
  inputs: PayrollInputs;
  result: PayrollResult;
}

interface Person {
  id: string;
  employeeCode: string;
  employmentId: string;
}

/** Reads a response body as bytes, whatever its type. */
const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

describe('Client accounts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  let admin: string;
  let superAdmin: string;
  let hrSuper: string;
  let staff: string;
  let manager: string;
  let developer: string;
  let amalSession: string;
  let emailDomainBefore: string | null;
  let accountsKind: string;
  let transport: string;
  let departmentId: string;
  const grades = new Map<string, string>();
  const people: string[] = [];
  const api = () => request(app.getHttpServer());

  let amal: Person; // eligible: the Accounts allowance on her contract
  let bassem: Person; // no per-account allowance on his contract
  let carim: { id: string }; // no employment
  let dalia: Person; // C-level (G9), eligible
  let rania: Person; // paid per account only: a salary of 0, 3,000 an account on her contract (27 October 2026)
  let studio: Account;
  let acme: Account;
  let beta: Account;
  let acmeAmal: Assignment;
  let betaAmal: Assignment;
  let daliaAcme: Assignment;
  let runId: string;

  const list = async (session = hr) => (await api().get('/api/client-accounts').set('Cookie', session).expect(200)).body as { accounts: Account[]; tiers: { id: string; nameEn: string; defaultAmount: number | null }[]; seesAmounts: boolean; edits: boolean };
  const accountOf = async (id: string, session = hr) => (await list(session)).accounts.find((a) => a.id === id)!;
  const addAccount = (body: object, session = hr) => api().post('/api/client-accounts').set('Cookie', session).send(body);
  const assign = (accountId: string, body: object, session = hr) => api().post(`/api/client-accounts/${accountId}/assignments`).set('Cookie', session).send(body);
  const change = (id: string, body: object, session = hr) => api().patch(`/api/client-accounts/assignments/${id}`).set('Cookie', session).send(body);
  const getRun = async (id: string, session = hr) => (await api().get(`/api/payroll/runs/${id}`).set('Cookie', session).expect(200)).body as { status: string; lines: Line[] };
  const lineOf = async (p: Person, session = hr) => (await getRun(runId, session)).lines.find((l) => l.employeeId === p.id)!;
  const accountsOf = (l: Line) => l.terms.allowances.find((a) => a.accounts);
  const audit = (entityType: string, entityId: string) => prisma.auditLog.findMany({ where: { entityType, entityId }, orderBy: { id: 'asc' } });

  async function hire(name: string, session: string, employment: Record<string, unknown>, contract: Record<string, unknown> | null): Promise<Person> {
    const p = (await api().post('/api/employees').set('Cookie', session).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201)).body;
    people.push(p.id);
    const hired = await api().post(`/api/employees/${p.id}/employments`).set('Cookie', session).send({ employmentType: 'full_time', joinDate: JOINED, departmentId, ...employment }).expect(201);
    const employmentId = hired.body.employment.id as string;
    if (contract) {
      const draft = (await api().post(`/api/employees/${p.id}/employments/${employmentId}/contracts`).set('Cookie', session).send({ grossSalary: 15000, ...contract }).expect(201)).body;
      await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', session).send({ signedOn: draft.startDate }).expect(200);
    }
    return { id: p.id, employeeCode: p.employeeCode, employmentId };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    manager = await signIn(app, await createUser(prisma, ['employee', 'manager']));
    developer = await signIn(app, await createUser(prisma, ['developer']));
    await prisma.payrollRun.deleteMany();
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    for (const g of (await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]) grades.set(g.code, g.id);
    await prisma.grade.update({ where: { id: grades.get('G9')! }, data: { confidential: true } });

    const kinds = (await api().get('/api/allowance-types').set('Cookie', hr).expect(200)).body as { id: string; nameEn: string; basis: string }[];
    accountsKind = kinds.find((k) => k.nameEn === 'Accounts allowance' && k.basis === 'per_account')!.id;
    transport = (await api().post('/api/allowance-types').set('Cookie', hr).send({ nameEn: `Transport ${RUN}`, nameAr: 'بدل انتقال' }).expect(201)).body.id;
    departmentId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Accounts ${RUN}` }).expect(201)).body.id;

    amal = await hire('Amal Accounts', hr, {}, { allowances: [{ allowanceTypeId: transport, amount: 500 }, { allowanceTypeId: accountsKind }] });
    bassem = await hire('Bassem Plain', hr, {}, { allowances: [{ allowanceTypeId: transport, amount: 500 }] });
    carim = (await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `Carim Unhired ${RUN}`, fullNameAr: 'موظف' }).expect(201)).body;
    people.push(carim.id);
    // HR alone can't give the C-level grade: HR with Super Admin hires Dalia
    dalia = await hire('Dalia Chief', hrSuper, { gradeId: grades.get('G9') }, { grossSalary: 90000, allowances: [{ allowanceTypeId: accountsKind }] });
    // the owner's case (27 October 2026): "paid per account only", 3,000 EGP an account
    rania = await hire('Rania PerAccount', hr, {}, { grossSalary: 0, netSalary: 0, allowances: [{ allowanceTypeId: accountsKind, amount: 3000 }] });

    // Amal's own sign-in, linked to her profile
    const amalEmail = await createUser(prisma, ['employee']);
    await prisma.user.update({ where: { email: amalEmail }, data: { employeeId: amal.id } });
    amalSession = await signIn(app, amalEmail);
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany();
    await prisma.clientAccountAssignment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.clientAccount.deleteMany({ where: { nameEn: { endsWith: RUN } } });
    await prisma.clientAccountTier.deleteMany({ where: { nameEn: { endsWith: RUN } } });
    await prisma.offboardingCase.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.user.updateMany({ where: { employeeId: { in: people } }, data: { employeeId: null } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('accounts and their sizes', () => {
    it('HR and the CEO add them; a size fills in the default; Finance and a Super Admin read; others are refused', async () => {
      const large = await api().post('/api/client-accounts/tiers').set('Cookie', hr).send({ nameEn: `Large ${RUN}`, defaultAmount: 1500 }).expect(201);
      expect(large.body).toMatchObject({ nameEn: `Large ${RUN}`, defaultAmount: 1500, accounts: 0 });
      await api().post('/api/client-accounts/tiers').set('Cookie', finance).send({ nameEn: `Small ${RUN}`, defaultAmount: 500 }).expect(403);

      acme = (await addAccount({ nameEn: `Acme Foods ${RUN}`, nameAr: 'أكمي', code: `AC-${RUN}`.slice(0, 30), tierId: large.body.id, departmentId }).expect(201)).body;
      expect(acme).toMatchObject({ status: 'active', defaultAmount: 1500, tier: { nameEn: `Large ${RUN}` }, assignments: [], hidden: 0 });
      beta = (await addAccount({ nameEn: `Beta Labs ${RUN}`, defaultAmount: 900 }, ceo).expect(201)).body;
      expect(beta).toMatchObject({ defaultAmount: 900, tier: null, code: null });

      expect((await addAccount({ nameEn: `ACME FOODS ${RUN}`, defaultAmount: 100 }).expect(409)).body.message).toBe(`There is already a client account called Acme Foods ${RUN}. Choose another name.`);
      expect((await addAccount({ nameEn: `No Amount ${RUN}` }).expect(400)).body.message).toBe('Enter the default amount a month for the people on this account, or choose a size that has one.');
      await addAccount({ nameEn: `Bad ${RUN}`, defaultAmount: 0 }).expect(400);
      for (const session of [finance, admin, superAdmin, staff, manager, developer]) await addAccount({ nameEn: `Refused ${RUN}`, defaultAmount: 100 }, session).expect(403);

      // reading: HR, the CEO, Finance (amounts), a Super Admin (no amounts); never an Admin, an employee or a manager
      for (const session of [hr, ceo, finance]) expect(await list(session)).toMatchObject({ seesAmounts: true });
      expect((await list(finance)).edits).toBe(false);
      const bySuper = await list(superAdmin);
      expect(bySuper).toMatchObject({ seesAmounts: false, edits: false });
      expect(bySuper.accounts.find((a) => a.id === acme.id)!.defaultAmount).toBeNull();
      expect(bySuper.tiers.find((t) => t.id === large.body.id)!.defaultAmount).toBeNull();
      for (const session of [admin, staff, manager]) await api().get('/api/client-accounts').set('Cookie', session).expect(403);
      await api().get('/api/client-accounts').expect(401);

      const changed = await api().patch(`/api/client-accounts/${beta.id}`).set('Cookie', hr).send({ code: 'BETA-1', defaultAmount: 950 }).expect(200);
      expect(changed.body).toMatchObject({ code: 'BETA-1', defaultAmount: 950 });
      await api().patch(`/api/client-accounts/${beta.id}`).set('Cookie', hr).send({ defaultAmount: 900 }).expect(200);
    });
  });

  describe('assignments', () => {
    it('HR assigns a person under their current employment, at the account’s default unless another amount is typed', async () => {
      const res = await assign(acme.id, { employeeId: amal.id, fromDate: JOINED, note: 'Lead on the account' }).expect(201);
      acmeAmal = res.body;
      expect(acmeAmal).toMatchObject({ accountId: acme.id, employee: { id: amal.id }, fromDate: JOINED, toDate: null, amount: 1500, standing: 'current' });
      betaAmal = (await assign(beta.id, { employeeId: amal.id, fromDate: `${MONTH}-15`, amount: 1200 }).expect(201)).body;
      expect(betaAmal).toMatchObject({ amount: 1200, fromDate: `${MONTH}-15` });
      // several people share an account, a person holds many: Amal on both
      expect((await accountOf(acme.id)).assignments.map((a) => a.employee.id)).toEqual([amal.id]);
    });

    it('refuses an overlap on the same account, a person without an employment, and one without the Accounts allowance', async () => {
      const overlap = await assign(acme.id, { employeeId: amal.id, fromDate: `${MONTH}-10` }).expect(409);
      expect(overlap.body.message).toBe(`Amal Accounts ${RUN} is already on Acme Foods ${RUN} from ${JOINED.slice(8, 10)}/${JOINED.slice(5, 7)}/${JOINED.slice(0, 4)}: change that assignment, or date this one outside it.`);
      expect((await assign(acme.id, { employeeId: carim.id, fromDate: JOINED }).expect(400)).body.message).toBe(`Carim Unhired ${RUN} has no current employment, so they can't be assigned to an account.`);
      expect((await assign(acme.id, { employeeId: bassem.id, fromDate: JOINED }).expect(400)).body.message).toBe(
        `Bassem Plain ${RUN}'s contract has no Accounts allowance: add it to their contract (or the renewal or raise that adds it), then assign the account.`,
      );
      expect((await assign(acme.id, { employeeId: amal.id, fromDate: firstDay(monthsLater(CURRENT, -5)), toDate: firstDay(monthsLater(CURRENT, -4)) }).expect(400)).body.message).toContain('date the assignment from then on');
      expect((await change(betaAmal.id, { toDate: `${MONTH}-10` }).expect(400)).body.message).toBe('The end date must be on or after the start date.');
      for (const session of [finance, superAdmin, staff, manager, developer]) await assign(beta.id, { employeeId: amal.id, fromDate: firstDay(CURRENT) }, session).expect(403);
    });

    it('paid per account only: a salary of 0, the contract’s amount per account filled in and shown', async () => {
      const contract = await prisma.contract.findFirstOrThrow({ where: { employmentId: rania.employmentId }, include: { allowances: true } });
      expect(contract.grossSalary.toNumber()).toBe(0);
      expect(contract.allowances.map((a) => [a.basis, a.amount.toNumber(), a.perAccountAmount?.toNumber()])).toEqual([['per_account', 0, 3000]]);
      studio = (await addAccount({ nameEn: `Delta Studio ${RUN}`, defaultAmount: 1000 }).expect(201)).body;
      // no amount typed: her contract's 3,000, not the account's 1,000
      const own = (await assign(studio.id, { employeeId: rania.id, fromDate: JOINED }).expect(201)).body;
      expect(own).toMatchObject({ amount: 3000, contractAmount: 3000 });
      // another amount typed is kept, but her contract's is what is paid, and said so
      await change(own.id, { amount: 1000 }).expect(200);
      expect((await accountOf(studio.id)).assignments.find((a) => a.id === own.id)).toMatchObject({ amount: 1000, contractAmount: 3000 });
      // the amount a month never shows to someone who doesn't see salaries
      expect((await accountOf(studio.id, developer)).assignments.find((a) => a.id === own.id)).toMatchObject({ amount: null, contractAmount: null });
    });

    it('a C-level person’s are the CEO’s: hidden from HR, the account saying how many', async () => {
      daliaAcme = (await assign(acme.id, { employeeId: dalia.id, fromDate: JOINED, amount: 4000 }, ceo).expect(201)).body;
      expect((await accountOf(acme.id, ceo)).assignments.map((a) => a.employee.id).sort()).toEqual([amal.id, dalia.id].sort());
      const byHr = await accountOf(acme.id, hr);
      expect(byHr.assignments.map((a) => a.employee.id)).toEqual([amal.id]);
      expect(byHr.hidden).toBe(1);
      await change(daliaAcme.id, { amount: 4100 }, hr).expect(404);
      await assign(beta.id, { employeeId: dalia.id, fromDate: JOINED }, hr).expect(404);
      await api().get(`/api/employees/${dalia.id}/client-accounts`).set('Cookie', hr).expect(404);
      // HR with Super Admin sees C-level people, as on the payroll
      expect((await accountOf(acme.id, hrSuper)).hidden).toBe(0);
    });

    it('masks the amounts and the people for a developer', async () => {
      const dev = await accountOf(acme.id, developer);
      expect(dev.defaultAmount === null || dev.defaultAmount === 0).toBe(true);
      expect(dev.assignments.length).toBeGreaterThan(0);
      for (const a of dev.assignments) {
        expect(a.amount === null || a.amount === 0).toBe(true);
        expect(a.employee.fullNameEn).not.toContain(RUN);
      }
    });

    it('on the profile: everything with the amounts for HR; the person themself their current accounts’ names and dates', async () => {
      const byHr = (await api().get(`/api/employees/${amal.id}/client-accounts`).set('Cookie', hr).expect(200)).body;
      expect(byHr).toMatchObject({ full: true, seesAmounts: true });
      expect(byHr.assignments.map((a: { account: { nameEn: string }; amount: number }) => [a.account.nameEn, a.amount]).sort()).toEqual([
        [`Acme Foods ${RUN}`, 1500],
        [`Beta Labs ${RUN}`, 1200],
      ]);
      const own = (await api().get(`/api/employees/${amal.id}/client-accounts`).set('Cookie', amalSession).expect(200)).body;
      expect(own).toMatchObject({ full: false, seesAmounts: false });
      for (const a of own.assignments) expect(a).toMatchObject({ amount: null, note: null, standing: 'current', account: { code: null } });
      expect(own.assignments).toHaveLength(2);
      await api().get(`/api/employees/${amal.id}/client-accounts`).set('Cookie', staff).expect(404);
    });

    it('every write is in the audit log, the amounts only as changed', async () => {
      expect((await audit('client_account', acme.id))[0]).toMatchObject({ action: 'create', diff: { nameEn: `Acme Foods ${RUN}`, tier: `Large ${RUN}`, defaultAmount: 'changed' } });
      expect((await audit('client_account', beta.id)).map((a) => a.action)).toEqual(['create', 'update', 'update']);
      expect((await audit('client_account', beta.id))[1].diff).toMatchObject({ code: { from: null, to: 'BETA-1' }, defaultAmount: 'changed' });
      expect((await audit('client_account_assignment', acmeAmal.id))[0]).toMatchObject({
        action: 'create',
        diff: { accountId: acme.id, employeeId: amal.id, fromDate: JOINED, toDate: null, amount: 'changed', amountFrom: 'account_default', note: 'Lead on the account' },
      });
    });
  });

  describe('on the payroll', () => {
    it('a draft run’s line pays the month’s accounts by days held, as the Accounts allowance, taxed with the pay', async () => {
      // Bassem holds an account from before his contract lost the allowance (written straight to the database)
      await prisma.clientAccountAssignment.create({ data: { accountId: acme.id, employeeId: bassem.id, employmentId: bassem.employmentId, fromDate: new Date(JOINED), amount: 1500 } });
      runId = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: MONTH }).expect(201)).body.id;
      const line = await lineOf(amal);
      const betaShare = piasters((1200 * (MONTH_DAYS - 14)) / MONTH_DAYS);
      expect(accountsOf(line)).toEqual({
        name: 'Accounts allowance',
        amount: piasters(1500 + betaShare),
        taxable: true,
        insured: false,
        accounts: [
          { accountId: acme.id, name: `Acme Foods ${RUN}`, from: firstDay(MONTH), to: lastDay(MONTH), days: MONTH_DAYS, monthDays: MONTH_DAYS, monthly: 1500, amount: 1500 },
          { accountId: beta.id, name: `Beta Labs ${RUN}`, from: `${MONTH}-15`, to: lastDay(MONTH), days: MONTH_DAYS - 14, monthDays: MONTH_DAYS, monthly: 1200, amount: betaShare },
        ],
      });
      // the Transport and the accounts, the accounts as they are
      expect(line.result.allowances).toBe(piasters(500 + 1500 + betaShare));
      expect(line.result.taxableAllowances).toBe(line.result.allowances);
      // taxed: more tax than the same line without them
      const run = (await api().get(`/api/payroll/runs/${runId}`).set('Cookie', hr).expect(200)).body as { status: string; rules: PayrollRules };
      const without: PayrollTerms = {
        ...line.terms,
        allowances: line.terms.allowances.filter((a) => !a.accounts),
        segments: line.terms.segments!.map((s) => ({ ...s, allowances: s.allowances.filter((a) => !a.accounts) })),
      };
      expect(payrollLine(line.terms, line.inputs, run.rules).monthlyTax).toBe(line.result.monthlyTax);
      expect(line.result.monthlyTax).toBeGreaterThan(payrollLine(without, line.inputs, run.rules).monthlyTax);
      expect(run.status).toBe('draft');
      // never the insured wage: the gross and the Transport
      expect(line.terms.insuredWage).toBe(15500);
    });

    it('paid per account only: every account at the contract’s amount, the salary 0', async () => {
      const line = await lineOf(rania);
      expect(accountsOf(line)!.accounts!.map((a) => [a.monthly, a.amount])).toEqual([[3000, 3000]]);
      expect(line.result.earned).toBe(0);
      expect(line.result.allowances).toBe(3000);
      expect(line.result.net).toBeGreaterThan(0);
    });

    it('nothing for accounts held without the per-account allowance: a warning on the draft', async () => {
      const line = await lineOf(bassem);
      expect(accountsOf(line)).toBeUndefined();
      expect(line.terms.accountsWithoutAllowance).toBe(1);
      expect(line.result.warnings).toContain('Holds 1 client account this month, but the contract has no per-account allowance: nothing is paid for it');
    });

    it('a change on a draft month is taken when the run is refreshed', async () => {
      await change(betaAmal.id, { amount: 1000 }).expect(200);
      const before = accountsOf(await lineOf(amal))!;
      expect(before.accounts!.find((a) => a.accountId === beta.id)!.monthly).toBe(1200);
      await api().post(`/api/payroll/runs/${runId}/refresh`).set('Cookie', hr).expect(200);
      const after = accountsOf(await lineOf(amal))!;
      expect(after.accounts!.find((a) => a.accountId === beta.id)).toMatchObject({ monthly: 1000, amount: piasters((1000 * (MONTH_DAYS - 14)) / MONTH_DAYS) });
      expect((await audit('client_account_assignment', betaAmal.id)).at(-1)).toMatchObject({ action: 'update', diff: { amount: 'changed' } });
    });

    it('refuses dates and amounts inside a month with the CEO, approved or paid; the line never changes', async () => {
      await api().post(`/api/payroll/runs/${runId}/submit`).set('Cookie', hr).expect(200);
      const next = monthName(CURRENT).split(' ')[0];
      const gamma = (await addAccount({ nameEn: `Gamma Media ${RUN}`, defaultAmount: 700 }).expect(201)).body as Account;
      expect((await assign(gamma.id, { employeeId: amal.id, fromDate: `${MONTH}-20` }).expect(409)).body.message).toBe(
        `${monthName(MONTH)}'s payroll is with the CEO: date it from ${next}, or add the difference in Additions.`,
      );
      // from the month after: fine
      await assign(gamma.id, { employeeId: amal.id, fromDate: firstDay(CURRENT) }).expect(201);
      const held = accountsOf(await lineOf(amal))!.amount;

      await api().post(`/api/payroll/runs/${runId}/approve`).set('Cookie', ceo).expect(200);
      expect((await change(betaAmal.id, { amount: 1100 }).expect(409)).body.message).toBe(
        `${monthName(MONTH)}'s payroll is approved: end this assignment on ${lastDay(MONTH).slice(8, 10)}/${MONTH.slice(5, 7)}/${MONTH.slice(0, 4)} and add one from ${next} at the new amount, or add the difference in Additions.`,
      );
      expect((await change(acmeAmal.id, { toDate: `${MONTH}-20` }).expect(409)).body.message).toBe(
        `${monthName(MONTH)}'s payroll is approved: end it on ${lastDay(MONTH).slice(8, 10)}/${MONTH.slice(5, 7)}/${MONTH.slice(0, 4)} or later, or deduct the difference in Additions / Deductions.`,
      );
      expect((await change(betaAmal.id, { fromDate: `${MONTH}-16` }).expect(409)).body.message).toContain('date it from');
      await api().post(`/api/payroll/runs/${runId}/refresh`).set('Cookie', hr).expect(409);
      expect(accountsOf(await lineOf(amal))!.amount).toBe(held);
    });

    it('the payslip and the register show it', async () => {
      await api().post(`/api/payroll/runs/${runId}/paid`).set('Cookie', hr).send({ paidOn: todayInCairo() }).expect(200);
      const line = await lineOf(amal);
      const pdf = (await api().get(`/api/payroll/lines/${line.id}/payslip/en`).set('Cookie', hr).buffer(true).parse(bytes).expect(200)).body as Buffer;
      const text = (await cvText(pdf, PDF, { pages: 1, chars: 60_000 })).replace(/\s+/g, ' ');
      expect(text).toContain('Accounts allowance (2 accounts)');
      expect(text).toContain(`Acme Foods ${RUN}`);

      const register = (await api().get(`/api/payroll/runs/${runId}/files/register`).set('Cookie', hr).buffer(true).parse(bytes).expect(200)).body as Buffer;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(register as unknown as ArrayBuffer);
      const ws = wb.worksheets[0];
      const headers = (ws.getRow(4).values as unknown[]).slice(1);
      const column = headers.indexOf('Accounts allowance') + 1;
      expect(column).toBeGreaterThan(0);
      let found: unknown = null;
      ws.eachRow((row) => {
        if (row.getCell(3).value === amal.employeeCode) found = row.getCell(column).value;
      });
      expect(found).toBe(accountsOf(line)!.amount);
    });
  });

  describe('ending', () => {
    it('an account ended ends its open assignments that day', async () => {
      const omega = (await addAccount({ nameEn: `Omega Retail ${RUN}`, defaultAmount: 600 }).expect(201)).body as Account;
      const held = (await assign(omega.id, { employeeId: amal.id, fromDate: firstDay(CURRENT) }).expect(201)).body as Assignment;
      const ended = (await api().post(`/api/client-accounts/${omega.id}/end`).set('Cookie', hr).send({ endedOn: lastDay(CURRENT) }).expect(200)).body as Account;
      expect(ended).toMatchObject({ status: 'ended', endedOn: lastDay(CURRENT) });
      expect(ended.assignments.find((a) => a.id === held.id)!.toDate).toBe(lastDay(CURRENT));
      expect((await assign(omega.id, { employeeId: amal.id, fromDate: lastDay(CURRENT) }).expect(409)).body.message).toContain('so nobody can be assigned to it');
      expect((await audit('client_account_assignment', held.id)).at(-1)).toMatchObject({ action: 'end', diff: { reason: 'account_ended', toDate: { from: null, to: lastDay(CURRENT) } } });
    });

    it('an employment ending ends the person’s open assignments on its last day, in the audit log', async () => {
      const last = todayInCairo();
      await api().post(`/api/employees/${amal.id}/employments/${amal.employmentId}/end`).set('Cookie', hr).send({ endDate: last, endReason: 'resigned' }).expect(200);
      const rows = await prisma.clientAccountAssignment.findMany({ where: { employeeId: amal.id }, select: { id: true, fromDate: true, toDate: true } });
      for (const r of rows) {
        expect(r.toDate).not.toBeNull();
        expect(r.toDate!.toISOString().slice(0, 10) <= last).toBe(true);
      }
      expect((await audit('client_account_assignment', acmeAmal.id)).at(-1)).toMatchObject({ action: 'end', diff: { reason: 'employment_ended', toDate: { from: null, to: last } } });
      // a person no longer employed takes no new ones once the day has passed: today they still work
      expect((await prisma.auditLog.count({ where: { entityType: 'client_account_assignment', action: 'end', diff: { path: ['reason'], equals: 'employment_ended' } } })) >= 2).toBe(true);
    });
  });
});
