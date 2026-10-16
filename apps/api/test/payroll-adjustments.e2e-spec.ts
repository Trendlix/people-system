import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import { AdvancesService } from '../src/payroll/adjustments/advances.service.js';
import { firstDay, monthName, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Additions / Deductions and advances and loans (owner, 17 October 2026: one-off amounts per employee and month, not
// recurring; an advance or loan recovered by the deductions linked to it): who may do what, what is refused, the
// month's run locking them from the CEO's step on, what is outstanding, and the audit log, the amounts only as set or
// changed. These tests look at their own people (names end with RUN) and delete everything they made. Every name and
// amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const NEXT = monthsLater(CURRENT, 1);
/** A month whose run these tests send to the CEO, to see it lock the month. */
const LOCKED = monthsLater(CURRENT, -7);
const JOINED = firstDay(monthsLater(CURRENT, -10));

interface Adjustment {
  id: string;
  employee: { id: string; employeeCode: string; name: string };
  month: string;
  kind: string;
  type: string;
  taxed: boolean;
  amount: number;
  reason: string;
  advance: { id: string; kind: string; givenOn: string; amount: number } | null;
  status: string;
  createdBy: { id: string; name: string } | null;
  cancelledBy: { id: string; name: string } | null;
}

interface Advance {
  id: string;
  kind: string;
  amount: number;
  status: string;
  recovered: number;
  planned: number;
  outstanding: number;
  unplanned: number;
  settledBy: { id: string } | null;
  settledNote: string | null;
  recoveries: { id: string; month: string; amount: number; status: string }[];
}

describe('Payroll additions and deductions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrId: string;
  let finance: string;
  let ceo: string;
  let admin: string;
  let staff: string;
  const people: string[] = [];
  let alpha: { id: string; employeeCode: string };
  let beta: { id: string; employeeCode: string };
  let newcomer: { id: string; employeeCode: string }; // joins next month
  const api = () => request(app.getHttpServer());

  async function hire(name: string, joinDate = JOINED) {
    const person = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    await api().post(`/api/employees/${person.body.id}/employments`).set('Cookie', hr).send({ employmentType: 'full_time', joinDate }).expect(201);
    people.push(person.body.id);
    return { id: person.body.id as string, employeeCode: person.body.employeeCode as string };
  }

  const post = (body: object, session = hr) => api().post('/api/payroll/adjustments').set('Cookie', session).send(body);
  const patch = (id: string, body: object, session = hr) => api().patch(`/api/payroll/adjustments/${id}`).set('Cookie', session).send(body);
  const cancel = (id: string, session = hr) => api().post(`/api/payroll/adjustments/${id}/cancel`).set('Cookie', session).send({});
  const list = (query: string, session = hr) => api().get(`/api/payroll/adjustments?${query}`).set('Cookie', session);
  const advance = (body: object, session = hr) => api().post('/api/payroll/advances').set('Cookie', session).send(body);
  const getAdvance = (id: string, session = hr) => api().get(`/api/payroll/advances/${id}`).set('Cookie', session);
  const auditOf = (entityType: string, entityId: string) => prisma.auditLog.findMany({ where: { entityType, entityId }, orderBy: { id: 'asc' } });
  const bonus = (over: object = {}) => ({ employeeId: alpha.id, month: CURRENT, kind: 'addition', type: 'bonus', amount: 1500, reason: 'Invented target bonus', ...over });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } })).id;
    finance = await signIn(app, await createUser(prisma, ['finance']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    await prisma.payrollRun.deleteMany({ where: { month: new Date(`${LOCKED}-01T00:00:00Z`) } });
    alpha = await hire('Alpha');
    beta = await hire('Beta');
    newcomer = await hire('Newcomer', firstDay(NEXT));
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { month: new Date(`${LOCKED}-01T00:00:00Z`) } });
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.payrollAdvance.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await app.close();
  });

  describe('additions and deductions', () => {
    let entered: Adjustment;

    it('HR enters one; HR, Finance and the CEO see it; nobody else', async () => {
      for (const session of [finance, ceo, admin, staff]) await post(bonus(), session).expect(403);
      entered = (await post(bonus({ reason: '  Invented target bonus  ' })).expect(201)).body as Adjustment;
      expect(entered).toMatchObject({
        employee: { id: alpha.id, employeeCode: alpha.employeeCode, name: `Alpha ${RUN}` },
        month: CURRENT,
        kind: 'addition',
        type: 'bonus',
        taxed: true, // a bonus is taxed (the owner's list)
        amount: 1500,
        reason: 'Invented target bonus',
        advance: null,
        status: 'pending',
        createdBy: { id: hrId },
        cancelledBy: null,
      });
      for (const session of [hr, finance, ceo]) {
        expect((await list(`employeeId=${alpha.id}`, session).expect(200)).body.map((a: Adjustment) => a.id)).toEqual([entered.id]);
        expect((await api().get(`/api/payroll/adjustments/${entered.id}`).set('Cookie', session).expect(200)).body.id).toBe(entered.id);
      }
      for (const session of [admin, staff]) {
        await list('', session).expect(403);
        await api().get(`/api/payroll/adjustments/${entered.id}`).set('Cookie', session).expect(403);
      }
      // the amount only as set, as for a salary
      expect((await auditOf('payroll_adjustment', entered.id)).map((a) => [a.action, a.userId, a.diff])).toEqual([
        [
          'create',
          hrId,
          { employeeCode: alpha.employeeCode, month: CURRENT, kind: 'addition', type: 'bonus', taxed: true, amount: 'set', reason: 'Invented target bonus' },
        ],
      ]);
    });

    it('takes whether it is taxed from the type: a reimbursement never, Other as chosen, a deduction never', async () => {
      const reimbursed = (await post(bonus({ type: 'reimbursement', amount: 320.75 })).expect(201)).body as Adjustment;
      expect(reimbursed.taxed).toBe(false);
      const other = (await post(bonus({ type: 'other', taxed: false, amount: 99.99 })).expect(201)).body as Adjustment;
      expect(other.taxed).toBe(false);
      const penalty = (await post(bonus({ kind: 'deduction', type: 'penalty', amount: 250 })).expect(201)).body as Adjustment;
      expect(penalty).toMatchObject({ kind: 'deduction', type: 'penalty', taxed: false });

      const refused = async (body: object) => (await post(body).expect(400)).body.message as string | string[];
      expect(await refused(bonus({ type: 'other' }))).toBe('Say whether this other addition is taxed.');
      expect(await refused(bonus({ taxed: false }))).toBe('A bonus is always taxed.');
      expect(await refused(bonus({ type: 'reimbursement', taxed: true }))).toBe('A reimbursement is never taxed.');
      expect(await refused(bonus({ kind: 'deduction', type: 'penalty', taxed: true }))).toBe('A deduction is taken after tax, so it is never taxed.');
      expect(await refused(bonus({ type: 'penalty' }))).toBe('Choose the type of addition: Bonus, Commission, Incentive, Correction, Reimbursement or Other addition.');
      expect(await refused(bonus({ kind: 'deduction', type: 'bonus' }))).toBe(
        'Choose the type of deduction: Penalty, Damage or loss, Advance recovery, Loan installment or Other deduction.',
      );
    });

    it('refuses an amount, a reason, a month or a person it can’t take', async () => {
      const refused = async (body: object) => (await post(body).expect(400)).body.message as string | string[];
      const AMOUNT = ['Enter the amount in EGP, more than 0, e.g. 1500 or 1500.50.'];
      expect(await refused(bonus({ amount: 0 }))).toEqual(AMOUNT);
      expect(await refused(bonus({ amount: -5 }))).toEqual(AMOUNT);
      expect(await refused(bonus({ amount: 10.555 }))).toEqual(AMOUNT);
      expect(await refused(bonus({ amount: '100' }))).toContain(AMOUNT[0]);
      expect(await refused(bonus({ reason: '   ' }))).toEqual(['Say what it is for.']);
      expect(await refused(bonus({ month: '2026-13' }))).toEqual(['Choose the month, as YYYY-MM.']);
      expect(await refused(bonus({ kind: 'bonus' }))).toEqual(['Choose addition or deduction.']);
      expect(await refused(bonus({ month: monthsLater(CURRENT, 13) }))).toBe(`Choose a month from ${monthName(monthsLater(CURRENT, -12))} to ${monthName(monthsLater(CURRENT, 12))}.`);
      // not employed in the month: someone who joins next month, this month
      expect(await refused(bonus({ employeeId: newcomer.id }))).toBe(`Newcomer ${RUN} isn't employed in ${monthName(CURRENT)}.`);
      expect((await post(bonus({ employeeId: newcomer.id, month: NEXT })).expect(201)).body.month).toBe(NEXT);
      expect(await refused(bonus({ advanceId: '00000000-0000-4000-8000-000000000000' }))).toBe(
        "Only an advance's recovery or a loan's installment is linked to an advance or loan.",
      );
      await post(bonus({ employeeId: '00000000-0000-4000-8000-000000000000' })).expect(404);
      await post(bonus({ unknown: 1 })).expect(400);
    });

    it('HR changes a pending one: the audit log has what changed, the amount only as changed', async () => {
      for (const session of [finance, ceo]) await patch(entered.id, { amount: 2000 }, session).expect(403);
      const changed = (await patch(entered.id, { amount: 2000.5, month: NEXT, reason: 'Invented bonus, moved' }).expect(200)).body as Adjustment;
      expect(changed).toMatchObject({ amount: 2000.5, month: NEXT, reason: 'Invented bonus, moved', taxed: true });
      // the type within its kind: whether it is taxed follows it
      expect((await patch(entered.id, { type: 'reimbursement' }).expect(200)).body).toMatchObject({ type: 'reimbursement', taxed: false });
      expect((await patch(entered.id, { type: 'other', taxed: true }).expect(200)).body).toMatchObject({ type: 'other', taxed: true });
      expect((await patch(entered.id, { type: 'penalty' }).expect(400)).body.message).toMatch(/^Choose the type of addition/);
      expect((await patch(entered.id, { amount: 0 }).expect(400)).body.message).toEqual(['Enter the amount in EGP, more than 0, e.g. 1500 or 1500.50.']);
      expect((await patch(entered.id, { reason: null }).expect(400)).body.message).toContain('Say what it is for.');
      // nothing changed: nothing in the audit log
      const before = (await auditOf('payroll_adjustment', entered.id)).length;
      await patch(entered.id, { amount: 2000.5 }).expect(200);
      expect(await auditOf('payroll_adjustment', entered.id)).toHaveLength(before);

      const audit = await auditOf('payroll_adjustment', entered.id);
      expect(audit[1].diff).toEqual({
        employeeCode: alpha.employeeCode,
        kind: 'addition',
        month: { from: CURRENT, to: NEXT },
        amount: 'changed',
        reason: { from: 'Invented target bonus', to: 'Invented bonus, moved' },
      });
      expect(audit[2].diff).toMatchObject({ type: { from: 'bonus', to: 'reimbursement' }, taxed: { from: true, to: false } });
      expect(JSON.stringify(audit.map((a) => a.diff))).not.toContain('2000.5');
    });

    it('HR cancels a pending one: kept on record, never changed again', async () => {
      const one = (await post(bonus({ type: 'incentive', amount: 75 })).expect(201)).body as Adjustment;
      for (const session of [finance, ceo]) await cancel(one.id, session).expect(403);
      expect((await cancel(one.id).expect(200)).body).toMatchObject({ status: 'cancelled', cancelledBy: { id: hrId } });
      expect((await cancel(one.id).expect(409)).body.message).toBe("This addition is cancelled, so it can't be cancelled.");
      expect((await patch(one.id, { amount: 80 }).expect(409)).body.message).toBe("This addition is cancelled, so it can't be changed.");
      expect((await auditOf('payroll_adjustment', one.id)).at(-1)).toMatchObject({
        action: 'cancel',
        diff: { employeeCode: alpha.employeeCode, month: CURRENT, kind: 'addition', type: 'incentive', status: { from: 'pending', to: 'cancelled' } },
      });
      // an applied one is the run's: not changed or cancelled either
      const applied = (await post(bonus({ type: 'commission', amount: 10 })).expect(201)).body as Adjustment;
      await prisma.payrollAdjustment.update({ where: { id: applied.id }, data: { status: 'applied', appliedAt: new Date() } });
      expect((await cancel(applied.id).expect(409)).body.message).toBe("This addition is applied, so it can't be cancelled.");
    });

    it('filters by month, employee, kind, type and status', async () => {
      const ids = async (query: string) => ((await list(query).expect(200)).body as Adjustment[]).filter((a) => people.includes(a.employee.id));
      const current = await ids(`month=${CURRENT}`);
      expect(current.length).toBeGreaterThan(0);
      expect(current.every((a) => a.month === CURRENT)).toBe(true);
      expect((await ids(`month=${CURRENT}&kind=deduction`)).map((a) => a.type)).toEqual(['penalty']);
      expect((await ids(`type=incentive&status=cancelled&employeeId=${alpha.id}`)).map((a) => a.status)).toEqual(['cancelled']);
      expect((await ids(`employeeId=${newcomer.id}`)).map((a) => a.month)).toEqual([NEXT]);
      await list('month=2026-1').expect(400);
      await list('status=done').expect(400);
      expect((await list('kind=addition&type=penalty').expect(400)).body.message).toMatch(/^Choose the type of addition/);
    });

    it('lists the month’s people and their open advances and loans for the form', async () => {
      const choices = (await api().get(`/api/payroll/adjustments/choices?month=${CURRENT}`).set('Cookie', finance).expect(200)).body as {
        month: string;
        run: unknown;
        locked: string | null;
        people: { id: string }[];
      };
      expect(choices.month).toBe(CURRENT);
      const ids = choices.people.map((p) => p.id);
      expect(ids).toEqual(expect.arrayContaining([alpha.id, beta.id]));
      expect(ids).not.toContain(newcomer.id);
      expect((await api().get(`/api/payroll/adjustments/choices?month=${NEXT}`).set('Cookie', hr).expect(200)).body.people.map((p: { id: string }) => p.id)).toContain(
        newcomer.id,
      );
      await api().get('/api/payroll/adjustments/choices').set('Cookie', hr).expect(400);
      await api().get(`/api/payroll/adjustments/choices?month=${CURRENT}`).set('Cookie', admin).expect(403);
    });

    it('locks the month once its run is with the CEO, approved or paid: a draft’s month stays open', async () => {
      const pending = (await post(bonus({ month: LOCKED, amount: 300 })).expect(201)).body as Adjustment;
      const run = await prisma.payrollRun.create({ data: { month: new Date(`${LOCKED}-01T00:00:00Z`), rules: {}, status: 'draft' } });
      expect((await patch(pending.id, { amount: 301 }).expect(200)).body.amount).toBe(301);

      for (const [status, text] of [
        ['pending_ceo', 'is with the CEO'],
        ['approved', 'is approved'],
        ['paid', 'is marked paid'],
      ] as const) {
        await prisma.payrollRun.update({ where: { id: run.id }, data: { status } });
        const message = `The ${monthName(LOCKED)} payroll ${text}, so its additions and deductions can't be changed.${status === 'pending_ceo' ? ' Ask the CEO to return the run, or enter it for a later month.' : ' Enter it for a later month.'}`;
        expect((await post(bonus({ month: LOCKED })).expect(409)).body.message).toBe(message);
        expect((await patch(pending.id, { amount: 302 }).expect(409)).body.message).toBe(message);
        expect((await cancel(pending.id).expect(409)).body.message).toBe(message);
        // nor moved into it
        expect((await patch(entered.id, { month: LOCKED }).expect(409)).body.message).toBe(message);
        const choices = (await api().get(`/api/payroll/adjustments/choices?month=${LOCKED}`).set('Cookie', hr).expect(200)).body;
        expect(choices).toMatchObject({ run: { id: run.id, status }, locked: message });
      }
    });
  });

  describe('advances and loans', () => {
    let loan: Advance;
    let advanceGiven: Advance;
    const GIVEN = addDays(firstDay(CURRENT), -1); // the last day of last month
    const installment = (over: object = {}) => ({
      employeeId: alpha.id,
      month: CURRENT,
      kind: 'deduction',
      type: 'loan_installment',
      amount: 1000,
      reason: 'Invented installment',
      advanceId: loan.id,
      ...over,
    });

    it('HR records one; HR, Finance and the CEO see it; the amount only as set in the audit log', async () => {
      const body = { employeeId: alpha.id, kind: 'loan', amount: 6000, givenOn: GIVEN, reason: 'Invented car repair', plan: '6 installments of 1,000' };
      for (const session of [finance, ceo, admin, staff]) await advance(body, session).expect(403);
      loan = (await advance(body).expect(201)).body as Advance;
      expect(loan).toMatchObject({ kind: 'loan', amount: 6000, status: 'open', recovered: 0, planned: 0, outstanding: 6000, unplanned: 6000, recoveries: [] });
      for (const session of [hr, finance, ceo]) expect((await getAdvance(loan.id, session).expect(200)).body.id).toBe(loan.id);
      for (const session of [admin, staff]) await getAdvance(loan.id, session).expect(403);
      expect((await auditOf('payroll_advance', loan.id)).map((a) => [a.action, a.diff])).toEqual([
        ['create', { employeeCode: alpha.employeeCode, kind: 'loan', amount: 'set', givenOn: GIVEN, reason: 'Invented car repair', plan: '6 installments of 1,000' }],
      ]);
      advanceGiven = (await advance({ ...body, kind: 'advance', amount: 500, plan: null, reason: 'Invented salary advance' }).expect(201)).body as Advance;

      const refused = async (b: object) => (await advance({ ...body, ...b }).expect(400)).body.message as string | string[];
      expect(await refused({ givenOn: addDays(TODAY, 1) })).toBe("The day the loan was given can't be in the future.");
      expect(await refused({ amount: 0 })).toEqual(['Enter the amount given in EGP, more than 0, e.g. 6000.']);
      expect(await refused({ kind: 'gift' })).toEqual(['Choose advance or loan.']);
      expect(await refused({ reason: '' })).toEqual(['Say what it was given for.']);
      await advance({ ...body, employeeId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    });

    it('is recovered by deductions linked to it, never more than is left, only the employee’s own and of its kind', async () => {
      const first = (await post(installment()).expect(201)).body as Adjustment;
      expect(first.advance).toEqual({ id: loan.id, kind: 'loan', givenOn: GIVEN, amount: 6000 });
      await post(installment({ month: NEXT })).expect(201);
      // planned: the pending ones
      expect((await getAdvance(loan.id).expect(200)).body).toMatchObject({ recovered: 0, planned: 2000, outstanding: 6000, unplanned: 4000 });

      const refused = async (b: object) => (await post(installment(b)).expect(400)).body.message as string;
      expect(await refused({ amount: 4000.01 })).toBe('Only EGP 4,000.00 is left to recover of that loan: EGP 6,000.00 is outstanding, EGP 2,000.00 of it planned already.');
      expect(await refused({ advanceId: null })).toBe('Choose the loan it recovers.');
      expect(await refused({ advanceId: advanceGiven.id })).toBe('A loan installment recovers a loan: choose one.');
      expect(await refused({ type: 'advance_recovery' })).toBe('An advance recovery recovers an advance: choose one.');
      expect(await refused({ employeeId: beta.id })).toBe(`Choose one of Beta ${RUN}'s loans.`);
      expect(await refused({ month: monthsLater(CURRENT, -2) })).toMatch(/^That loan was given on \d{2}\/\d{2}\/\d{4}: recover it from /);
      // up to what is left exactly
      const rest = (await post(installment({ amount: 4000, month: monthsLater(CURRENT, 2) })).expect(201)).body as Adjustment;
      expect((await getAdvance(loan.id).expect(200)).body).toMatchObject({ planned: 6000, unplanned: 0 });
      // its own amount is free again when it is changed
      expect((await patch(rest.id, { amount: 3999.99 }).expect(200)).body.amount).toBe(3999.99);
      expect((await patch(rest.id, { amount: 4000.01 }).expect(400)).body.message).toMatch(/^Only EGP 4,000.00 is left to recover of that loan/);
      // a cancelled one frees what it planned
      await cancel(rest.id).expect(200);
      expect((await getAdvance(loan.id).expect(200)).body).toMatchObject({ planned: 2000, unplanned: 4000 });
      // the advance's recovery
      expect((await post(installment({ type: 'advance_recovery', advanceId: advanceGiven.id, amount: 500 })).expect(201)).body.advance.kind).toBe('advance');
    });

    it('counts the applied recoveries as recovered: outstanding is the amount less them, and the sums are the piaster’s', async () => {
      const mine = await prisma.payrollAdjustment.findMany({ where: { advanceId: loan.id, status: 'pending' }, orderBy: { month: 'asc' } });
      await prisma.payrollAdjustment.update({ where: { id: mine[0].id }, data: { status: 'applied', appliedAt: new Date() } });
      const after = (await getAdvance(loan.id).expect(200)).body as Advance;
      expect(after).toMatchObject({ recovered: 1000, planned: 1000, outstanding: 5000, unplanned: 4000, status: 'open' });
      expect(after.recoveries.map((r) => [r.month, r.amount, r.status])).toEqual([
        [CURRENT, 1000, 'applied'],
        [NEXT, 1000, 'pending'],
        [monthsLater(CURRENT, 2), 3999.99, 'cancelled'],
      ]);
      const listed = ((await api().get(`/api/payroll/advances?employeeId=${alpha.id}&status=open`).set('Cookie', ceo).expect(200)).body as Advance[]).map((a) => a.id);
      expect(listed).toEqual(expect.arrayContaining([loan.id, advanceGiven.id]));
      await api().get('/api/payroll/advances?status=closed').set('Cookie', hr).expect(400);
    });

    it('HR changes an open one: never below what is recovered and planned; the amount only as changed', async () => {
      for (const session of [finance, ceo]) await api().patch(`/api/payroll/advances/${loan.id}`).set('Cookie', session).send({ plan: 'x' }).expect(403);
      const lower = await api().patch(`/api/payroll/advances/${loan.id}`).set('Cookie', hr).send({ amount: 1999.99 }).expect(400);
      expect(lower.body.message).toBe("The amount can't be less than what is recovered and planned already: EGP 2,000.00.");
      const changed = (await api().patch(`/api/payroll/advances/${loan.id}`).set('Cookie', hr).send({ amount: 5000, plan: '5 installments of 1,000' }).expect(200)).body;
      expect(changed).toMatchObject({ amount: 5000, plan: '5 installments of 1,000', outstanding: 4000 });
      expect((await auditOf('payroll_advance', loan.id)).at(-1)!.diff).toEqual({
        employeeCode: alpha.employeeCode,
        amount: 'changed',
        plan: { from: '6 installments of 1,000', to: '5 installments of 1,000' },
      });
    });

    it('is settled automatically once nothing is outstanding', async () => {
      const advances = app.get(AdvancesService);
      expect(await advances.settleRecovered([advanceGiven.id])).toEqual([]); // its recovery is only planned
      const recovery = await prisma.payrollAdjustment.findFirstOrThrow({ where: { advanceId: advanceGiven.id } });
      await prisma.payrollAdjustment.update({ where: { id: recovery.id }, data: { status: 'applied', appliedAt: new Date() } });
      expect(await advances.settleRecovered([advanceGiven.id, loan.id])).toEqual([advanceGiven.id]);
      expect((await getAdvance(advanceGiven.id).expect(200)).body).toMatchObject({ status: 'settled', outstanding: 0, settledBy: null, settledNote: null });
      expect((await auditOf('payroll_advance', advanceGiven.id)).at(-1)).toMatchObject({ action: 'settle', userId: null, diff: { automatically: true } });
      // settled: nothing more is recovered from it, nor is it changed
      expect((await post(installment({ type: 'advance_recovery', advanceId: advanceGiven.id, amount: 1 })).expect(409)).body.message).toBe(
        'That advance is settled: nothing is left to recover.',
      );
      expect((await api().patch(`/api/payroll/advances/${advanceGiven.id}`).set('Cookie', hr).send({ plan: 'x' }).expect(409)).body.message).toBe(
        "This advance is settled, so it can't be changed.",
      );
    });

    it('HR marks one settled with a note, once nothing more is planned', async () => {
      const settle = (body: object, session = hr) => api().post(`/api/payroll/advances/${loan.id}/settle`).set('Cookie', session).send(body);
      for (const session of [finance, ceo]) await settle({ note: 'x' }, session).expect(403);
      expect((await settle({}).expect(400)).body.message).toContain('Say how it was settled.');
      expect((await settle({ note: 'Paid back in cash' }).expect(409)).body.message).toBe(
        'A recovery is still planned for this loan on Additions / Deductions: cancel it first, or let it be taken.',
      );
      const planned = await prisma.payrollAdjustment.findFirstOrThrow({ where: { advanceId: loan.id, status: 'pending' } });
      await cancel(planned.id).expect(200);
      const settled = (await settle({ note: ' Paid back in cash ' }).expect(200)).body as Advance;
      expect(settled).toMatchObject({ status: 'settled', settledBy: { id: hrId }, settledNote: 'Paid back in cash', outstanding: 4000 });
      expect((await auditOf('payroll_advance', loan.id)).at(-1)).toMatchObject({
        action: 'settle',
        diff: { employeeCode: alpha.employeeCode, status: { from: 'open', to: 'settled' }, note: 'Paid back in cash', outstanding: 'some' },
      });
      expect((await settle({ note: 'again' }).expect(409)).body.message).toBe("This loan is settled, so it can't be settled.");
    });
  });
});
