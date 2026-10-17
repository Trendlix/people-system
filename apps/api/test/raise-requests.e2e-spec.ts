import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { monthlyFromHourly, nextFirstOfMonth } from '@trendlix/shared';
import pg from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';
import { assertTestDatabase } from './test-env.js';

// Raise requests reworked (owner, 17 October 2026: "requesting a raise should have a drop list reason first ( Annual
// Raise - Performance Raise - Counter Offer Raise - etc..) then add requester comment, suggest raise amount or
// percentage, then the approver to Approve - Approve with another raise amount or percentge - Reject, and add a comment,
// all the request steps to be logged in the request"): the employee, their manager and HR asking; HR approving as
// suggested, with another raise (in a few fields, or in the whole raise form) or rejecting; the CEO approving as it
// reached them, with another raise, rejecting or returning; signing; the log on each request; what each viewer sees
// ("Keep salaries private", 16 October 2026); a request from before still readable; and the migration's backfill of
// the steps known. Effective from (17 October 2026: "in the request their should be a tab called Effective from"): the
// month a request is asked from, required, a 1st of this month or a later one, seen by everyone who sees the request,
// and HR's approval taking it as the raise's effective date unless HR sets another. Everything made here is deleted at
// the end. Every name and amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const today = todayInCairo();
const CURRENT = today.slice(0, 7);
/** Hired four months ago: the contract in force since then, for 12 months. */
const JOINED = firstDay(monthsLater(CURRENT, -4));
/** A raise as an amendment from this month's 1st; a new contract from next month's. */
const EFFECTIVE = firstDay(CURRENT);
const NEXT_EFFECTIVE = nextFirstOfMonth(today);
/** The month a request is asked from unless a test says otherwise: next month (the form's default). */
const ASKED_FROM = NEXT_EFFECTIVE;

interface Person {
  id: string;
  employmentId: string;
}

interface Step {
  id: string;
  kind: string;
  decision: string | null;
  raiseReason: string | null;
  comment: string | null;
  figure: string | null;
  increaseAmount: number | null;
  increasePercent: number | null;
  gross: number | null;
  way: string | null;
  effectiveDate: string | null;
  contractNumber: string | null;
  by: { email: string } | null;
  at: string;
}

interface Request {
  id: string;
  status: string;
  requester: string;
  reason: string;
  raiseReason: string | null;
  comment: string;
  effectiveFrom: string | null;
  suggestedGross: number | null;
  suggestion: { kind: string; amount: number | null; percent: number | null; gross: number | null } | null;
  raise: { contractId: string; number: string; way: string; stage: string; effectiveDate: string | null; previousGross: number | null; newGross: number | null } | null;
  decision: { stage: string; reason: string | null } | null;
  inForce: ({ startDate: string } & Pay) | null;
  steps: Step[];
  amountsHidden: boolean;
}

/** The pay in force, as the figures shown while asking are worked out from it. */
interface Pay {
  payBasis: string;
  grossSalary: number;
  hourlyRate: number | null;
  hoursPerWeek: number | null;
  allowances: { amount: number; taxable: boolean; insured: boolean }[];
}

interface ForEmployee {
  requests: Request[];
  canRequest: boolean;
  suggestsAmount: boolean;
  suggestionKinds: string[];
  currentGross: number | null;
  pay: Pay | null;
}

/** A step's figures: [figure, amount, percent, gross]. */
const figures = (s: Step) => [s.figure, s.increaseAmount, s.increasePercent, s.gross];
/** A refusal's message: one, or a field's messages together. */
const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message).join(' ');
const kinds = (r: Request) => r.steps.map((s) => (s.decision ? `${s.kind}:${s.decision}` : s.kind));

describe('Raise requests (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrEmail: string;
  let ceo: string;
  let ceoEmail: string;
  let finance: string;
  let superAdmin: string;
  let manager: string; // Mona, Ben's direct manager
  let managerEmail: string;
  let ben: string; // Ben's own sign-in
  let benEmail: string;
  let stranger: string;
  let emailDomainBefore: string | null;
  let departmentId: string;
  let titleId: string;
  let transport: string;
  const people: string[] = [];
  const api = () => request(app.getHttpServer());

  let benP: Person; // asks for himself, and his manager for him
  let dana: Person; // HR's requests, with an allowance
  let omar: Person; // by the hour

  async function employee(name: string, profile: Record<string, unknown> = {}) {
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', ...profile }).expect(201);
    people.push(res.body.id);
    return res.body as { id: string };
  }

  async function hire(name: string, contract: Record<string, unknown>, employment: Record<string, unknown> = {}, profile: Record<string, unknown> = {}): Promise<Person> {
    const e = await employee(name, profile);
    const hired = await api()
      .post(`/api/employees/${e.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: JOINED, departmentId, jobTitleId: titleId, ...employment })
      .expect(201);
    const p = { id: e.id, employmentId: hired.body.employment.id as string };
    const draft = await api().post(`/api/employees/${p.id}/employments/${p.employmentId}/contracts`).set('Cookie', hr).send(contract).expect(201);
    await sign(draft.body.id).expect(200);
    return p;
  }

  const sign = (id: string) => api().post(`/api/contracts/${id}/sign`).set('Cookie', hr).send({ signedOn: today });
  /** Asks from next month unless the body says another (`effectiveFrom: undefined` sends none). */
  const ask = (p: Person, body: object, session: string) =>
    api().post(`/api/employees/${p.id}/raise-requests`).set('Cookie', session).send({ effectiveFrom: ASKED_FROM, ...body });
  const requestsOf = async (p: Person, session: string) => (await api().get(`/api/employees/${p.id}/raise-requests`).set('Cookie', session).expect(200)).body as ForEmployee;
  const requestOf = async (p: Person, id: string, session: string) => (await requestsOf(p, session)).requests.find((r) => r.id === id)!;
  const hrApprove = (id: string, body: object, session = hr) => api().post(`/api/raise-requests/${id}/approve`).set('Cookie', session).send(body);
  const hrReject = (id: string, body: object, session = hr) => api().post(`/api/raise-requests/${id}/decline`).set('Cookie', session).send(body);
  const ceoStep = (contractId: string, action: 'approve' | 'return' | 'decline', body: object, session = ceo) =>
    api().post(`/api/raises/${contractId}/${action}`).set('Cookie', session).send(body);
  /** One of the person's contract versions, as HR sees it. */
  const contractOf = async <T>(p: Person, id: string) =>
    ((await api().get(`/api/employees/${p.id}/employments/${p.employmentId}/contracts`).set('Cookie', hr).expect(200)).body as (T & { id: string })[]).find((c) => c.id === id)!;
  const auditOf = (entityId: string) => prisma.auditLog.findMany({ where: { entityType: 'raise_request', entityId }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    ceoEmail = await createUser(prisma, ['ceo']);
    ceo = await signIn(app, ceoEmail);
    finance = await signIn(app, await createUser(prisma, ['finance']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    managerEmail = await createUser(prisma, ['manager']);
    manager = await signIn(app, managerEmail);
    benEmail = await createUser(prisma, ['employee']);
    ben = await signIn(app, benEmail);
    const strangerEmail = await createUser(prisma, ['employee']);
    stranger = await signIn(app, strangerEmail);

    // sign-in accounts here are @test.local: no company email domain while these tests run
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);

    departmentId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Requests ${RUN}` }).expect(201)).body.id;
    titleId = (await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId, titleEn: 'Analyst' }).expect(201)).body.id;
    transport = (await api().post('/api/allowance-types').set('Cookie', hr).send({ nameEn: `Transport ${RUN}`, nameAr: 'بدل انتقال', taxable: true }).expect(201)).body.id;

    await employee('Chief Officer', { workEmail: ceoEmail });
    const monaId = (await employee('Mona Manager', { workEmail: managerEmail })).id;
    await employee('Sam Stranger', { workEmail: strangerEmail });
    benP = await hire('Ben Asking', { grossSalary: 10000 }, { managerId: monaId }, { workEmail: benEmail });
    dana = await hire('Dana Decided', { grossSalary: 9000, allowances: [{ allowanceTypeId: transport, amount: 500 }] });
    omar = await hire('Omar Hourly', { payBasis: 'hourly', hourlyRate: 150, hoursPerWeek: 20 }, { employmentType: 'part_time' });
  });

  afterAll(async () => {
    // the employments first (their contracts, raise requests and steps go with them), then the people and what they used
    await prisma.generatedDocument.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    if (titleId) await prisma.jobTitle.deleteMany({ where: { id: titleId } });
    if (departmentId) await prisma.department.deleteMany({ where: { id: departmentId } });
    if (transport) await prisma.allowanceType.deleteMany({ where: { id: transport } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('the employee asks; HR approves with another raise; the CEO returns, then approves with another; signed', () => {
    let q: Request;
    let raiseId: string;

    it('a reason from the list first, a comment, then an amount or a percent', async () => {
      const body = { raiseReason: 'performance', comment: 'Led the yearly audit', suggestedIncrease: 1500 };
      expect(said(await ask(benP, { ...body, raiseReason: undefined }, ben).expect(400))).toMatch(/Choose why the raise is asked for/);
      // adjustment stays for the raises from before; it isn't asked for
      await ask(benP, { ...body, raiseReason: 'adjustment' }, ben).expect(400);
      expect(said(await ask(benP, { ...body, comment: '  ' }, ben).expect(400))).toMatch(/Write a comment/);
      expect((await ask(benP, { ...body, suggestedPercent: 10 }, ben).expect(400)).body.message).toBe('Give the raise as an amount or a percent, not both.');
      // Effective from: required, the 1st of a month, this month or a later one
      expect(said(await ask(benP, { ...body, effectiveFrom: undefined }, ben).expect(400))).toMatch(/Choose the month the raise is to take effect from/);
      expect(said(await ask(benP, { ...body, effectiveFrom: '2026-11-31' }, ben).expect(400))).toMatch(/Choose the month the raise is to take effect from/);
      expect(said(await ask(benP, { ...body, effectiveFrom: addDays(NEXT_EFFECTIVE, 1) }, ben).expect(400))).toMatch(/takes effect on the 1st of a month/);
      expect(said(await ask(benP, { ...body, effectiveFrom: firstDay(monthsLater(CURRENT, -1)) }, ben).expect(400))).toMatch(/from this month or a later one/);
      await ask(benP, { ...body, suggestedIncrease: undefined, suggestedPercent: 101 }, ben).expect(400);
      await ask(benP, { ...body, suggestedIncrease: 10.005 }, ben).expect(400);
      // the old shape is refused
      await ask(benP, { reason: 'A year of good reviews', suggestedGross: 11000 }, ben).expect(400);

      q = (await ask(benP, body, ben).expect(201)).body as Request;
      expect(q).toMatchObject({
        status: 'with_hr',
        requester: 'self',
        raiseReason: 'performance',
        comment: 'Led the yearly audit',
        reason: 'Led the yearly audit',
        effectiveFrom: ASKED_FROM,
        // his own suggestion, not the gross it comes to
        suggestion: { kind: 'amount', amount: 1500, percent: null, gross: null },
        suggestedGross: null,
        raise: null,
        amountsHidden: true,
      });
      expect(kinds(q)).toEqual(['submitted']);
      expect(q.steps[0]).toMatchObject({ raiseReason: 'performance', comment: 'Led the yearly audit', effectiveDate: ASKED_FROM, by: { email: benEmail } });
      expect(figures(q.steps[0])).toEqual(['amount', 1500, null, null]);
      expect((await ask(benP, body, ben).expect(409)).body.message).toBe('A raise request for you is already open. It is decided first.');
      // the amount only as set in the audit log
      const [created] = await auditOf(q.id);
      expect(created.diff).toEqual({
        employeeId: benP.id,
        requester: 'self',
        raiseReason: 'performance',
        comment: 'Led the yearly audit',
        effectiveFrom: ASKED_FROM,
        status: 'with_hr',
        suggestedIncrease: 'set',
      });
      // a request's Effective from is always a 1st, in the database too
      await expect(prisma.$executeRaw`UPDATE raise_requests SET effective_from = ${addDays(ASKED_FROM, 1)}::date WHERE id = ${q.id}::uuid`).rejects.toThrow(
        /raise_requests_effective_from_check/,
      );
    });

    it('who sees what: HR, Finance and the CEO everything; the manager no figure; nobody else', async () => {
      for (const session of [hr, finance, ceo]) {
        const view = await requestOf(benP, q.id, session);
        expect(view).toMatchObject({ suggestion: { kind: 'amount', amount: 1500, gross: 11500 }, suggestedGross: 11500, inForce: { grossSalary: 10000 }, amountsHidden: false });
        expect(figures(view.steps[0])).toEqual(['amount', 1500, 15, 11500]);
      }
      const forHr = await requestsOf(benP, hr);
      expect(forHr).toMatchObject({ suggestsAmount: true, suggestionKinds: ['amount', 'percent'], currentGross: 10000, canRequest: false });
      const forManager = await requestsOf(benP, manager);
      expect(forManager).toMatchObject({ suggestsAmount: false, suggestionKinds: ['percent'], currentGross: null });
      // the pay the figures are worked out from while asking (17 October 2026): HR, Finance, the CEO and the employee
      // for his own; never the manager ("No, only percent")
      const benPay = { payBasis: 'monthly', grossSalary: 10000, hourlyRate: null, allowances: [] };
      for (const session of [hr, finance, ceo, ben]) expect((await requestsOf(benP, session)).pay).toMatchObject(benPay);
      expect(forManager.pay).toBeNull();
      // with the allowances, as the net needs them: Dana's transport, taxed, not insured
      expect((await requestsOf(dana, hr)).pay).toMatchObject({ grossSalary: 9000, allowances: [{ amount: 500, taxable: true, insured: false }] });
      // his own only: nobody else's, and nowhere else (the request itself and his contracts keep the salary from him)
      await api().get(`/api/employees/${dana.id}/raise-requests`).set('Cookie', ben).expect(404);
      expect((await requestOf(benP, q.id, ben)).inForce).toBeNull();
      const benContracts = (await api().get(`/api/employees/${benP.id}/employments/${benP.employmentId}/contracts`).set('Cookie', ben).expect(200)).body as { grossSalary: number | null }[];
      expect(benContracts.length).toBeGreaterThan(0);
      expect(benContracts.every((c) => c.grossSalary === null)).toBe(true);
      // the request as HR, Finance and the CEO see it: the pay in force with what the net needs, for the figures when deciding
      expect((await requestOf(benP, q.id, hr)).inForce).toMatchObject(benPay);
      expect(forManager.requests[0]).toMatchObject({ id: q.id, raiseReason: 'performance', comment: 'Led the yearly audit', suggestion: null, suggestedGross: null, inForce: null });
      expect(figures(forManager.requests[0].steps[0])).toEqual([null, null, null, null]);
      // Effective from is a date, not a figure: everyone who sees the request sees it, on it and its submitted step
      for (const session of [ben, manager, hr, finance, ceo]) {
        const view = await requestOf(benP, q.id, session);
        expect(view.effectiveFrom).toBe(ASKED_FROM);
        expect(view.steps[0].effectiveDate).toBe(ASKED_FROM);
      }
      expect(await requestsOf(benP, ben)).toMatchObject({ suggestionKinds: ['amount', 'percent'], currentGross: null });
      await api().get(`/api/employees/${benP.id}/raise-requests`).set('Cookie', stranger).expect(404);
      await ask(benP, { raiseReason: 'annual', comment: 'Me too' }, stranger).expect(404);
      const all = (await api().get('/api/raise-requests?status=with_hr').set('Cookie', finance).expect(200)).body as Request[];
      expect(all.find((x) => x.id === q.id)).toMatchObject({ suggestedGross: 11500 });
      await api().get('/api/raise-requests').set('Cookie', manager).expect(403);
    });

    it('HR alone decides it, with a comment; as suggested takes the suggestion, another raise needs one', async () => {
      const body = { decision: 'approve_other', increasePercent: 10, comment: 'Within the band', way: 'amendment', effectiveDate: EFFECTIVE };
      for (const session of [ceo, finance, manager, ben]) await hrApprove(q.id, body, session).expect(403);
      await hrApprove(q.id, { ...body, comment: '' }).expect(400);
      expect((await hrApprove(q.id, { ...body, decision: 'approve' }).expect(400)).body.message).toMatch(/approve it with another raise/);
      expect((await hrApprove(q.id, { ...body, increasePercent: undefined }).expect(400)).body.message).toBe('Enter the other raise, as an amount in EGP or a percent of the gross.');
      expect((await hrApprove(q.id, { ...body, effectiveDate: addDays(EFFECTIVE, 1) }).expect(400)).body.message).toMatch(/1st of a month/);
      await hrApprove(q.id, { ...body, decision: 'reject' }).expect(400);
    });

    it('HR approves it with another raise (+10%) as an amendment: the raise is prepared and sent to the CEO', async () => {
      const approved = (await hrApprove(q.id, { decision: 'approve_other', increasePercent: 10, comment: 'Within the band', way: 'amendment', effectiveDate: EFFECTIVE }).expect(200))
        .body as Request;
      expect(approved).toMatchObject({ status: 'with_ceo', raise: { way: 'amendment', stage: 'pending_ceo', effectiveDate: EFFECTIVE, previousGross: 10000, newGross: 11000 } });
      expect(kinds(approved)).toEqual(['submitted', 'hr_decision:approve_other', 'prepared', 'sent']);
      // HR set another date than the request's: HR's step logs the one chosen
      expect(approved.steps[1]).toMatchObject({ comment: 'Within the band', effectiveDate: EFFECTIVE, by: { email: hrEmail } });
      expect(figures(approved.steps[1])).toEqual(['percent', 1000, 10, 11000]);
      expect(approved.steps[2]).toMatchObject({ way: 'amendment', effectiveDate: EFFECTIVE, contractNumber: approved.raise!.number });
      expect(approved.steps[3].gross).toBe(11000);
      raiseId = approved.raise!.contractId;

      // the raise as the raise form would have it: the request's reason, the gross raised, the net worked out
      const raise = await contractOf<{ grossSalary: number; netSalary: number; raise: { reason: string; requestId: string; approval: string } }>(benP, raiseId);
      expect(raise).toMatchObject({ grossSalary: 11000, raise: { reason: 'performance', requestId: q.id, approval: 'pending_ceo' } });
      expect(raise.netSalary).toBeGreaterThan(0);
      expect(raise.netSalary).toBeLessThan(11000);
      const pending = (await api().get('/api/raises/pending').set('Cookie', ceo).expect(200)).body as { id: string; previous: { grossSalary: number; allowances: unknown[] } | null }[];
      expect(pending.map((p) => p.id)).toContain(raiseId);
      // the pay before it with its allowances, for the figures of the CEO's other raise (17 October 2026)
      expect(pending.find((p) => p.id === raiseId)!.previous).toMatchObject({ grossSalary: 10000, hoursPerWeek: null, allowances: [] });
      // once decided, HR doesn't decide it again
      await hrApprove(q.id, { decision: 'approve_other', increasePercent: 5, comment: 'Again', way: 'amendment', effectiveDate: EFFECTIVE }).expect(409);
      await hrReject(q.id, { comment: 'Changed my mind' }).expect(409);

      // the employee and the manager: HR's decision and comment, no figure, no date yet
      for (const session of [ben, manager]) {
        const view = await requestOf(benP, q.id, session);
        expect(kinds(view)).toEqual(['submitted', 'hr_decision:approve_other', 'prepared', 'sent']);
        expect(view.steps[1].comment).toBe('Within the band');
        for (const s of view.steps.slice(1)) expect(figures(s)).toEqual([null, null, null, null]);
        expect(view.steps[2]).toMatchObject({ way: 'amendment', effectiveDate: null });
        expect(view.raise).toMatchObject({ effectiveDate: null, newGross: null, previousGross: null });
        // the raise's date stays HR's, Finance's and the CEO's until it is signed; the request's month is everyone's
        expect(view.steps[1].effectiveDate).toBeNull();
        expect(view.effectiveFrom).toBe(ASKED_FROM);
        expect(view.steps[0]).toMatchObject({ kind: 'submitted', effectiveDate: ASKED_FROM });
      }
      // the audit log: the figure only as set
      const audit = await auditOf(q.id);
      expect(audit.map((a) => a.action)).toEqual(['create', 'prepare', 'submit']);
      expect(audit[1].diff).toMatchObject({ decision: 'approve_other', comment: 'Within the band', increasePercent: 'set' });
    });

    it('the CEO returns it with a comment HR alone reads; HR changes it and sends it again with a note', async () => {
      await ceoStep(raiseId, 'return', {}).expect(400);
      await ceoStep(raiseId, 'return', { comment: 'Make it a round figure' }, hr).expect(403);
      await ceoStep(raiseId, 'return', { comment: 'Make it a round figure' }).expect(200);
      expect((await requestOf(benP, q.id, hr)).status).toBe('with_hr');
      // the old body still works
      await api().patch(`/api/raises/${raiseId}`).set('Cookie', hr).send({ grossSalary: 11500 }).expect(200);
      await api().post(`/api/raises/${raiseId}/send`).set('Cookie', hr).send({ comment: 'Rounded up' }).expect(200);
      const forHr = await requestOf(benP, q.id, hr);
      expect(kinds(forHr)).toEqual(['submitted', 'hr_decision:approve_other', 'prepared', 'sent', 'returned', 'sent']);
      expect(forHr.steps[4]).toMatchObject({ comment: 'Make it a round figure', by: { email: ceoEmail } });
      expect(forHr.steps[5]).toMatchObject({ comment: 'Rounded up', gross: 11500 });
      const forBen = await requestOf(benP, q.id, ben);
      expect(forBen.steps[4].comment).toBeNull();
      expect(forBen.steps[5].comment).toBeNull();
    });

    it('the CEO alone decides it, with a comment; approves it with another raise (+EGP 1,200): its pay is changed to it', async () => {
      await ceoStep(raiseId, 'approve', { comment: 'Well earned' }, hr).expect(403);
      await ceoStep(raiseId, 'approve', {}).expect(400);
      await ceoStep(raiseId, 'approve', { comment: 'Well earned', increaseAmount: 1200, increasePercent: 12 }).expect(400);
      await ceoStep(raiseId, 'approve', { comment: 'Well earned', increasePercent: 0 }).expect(400);
      const approved = (await ceoStep(raiseId, 'approve', { comment: 'Well earned', increaseAmount: 1200 }).expect(200)).body as { grossSalary: number; stage: string };
      expect(approved).toMatchObject({ grossSalary: 11200, stage: 'approved' });
      const forHr = await requestOf(benP, q.id, hr);
      expect(forHr).toMatchObject({ status: 'approved', raise: { newGross: 11200, stage: 'approved' } });
      expect(kinds(forHr).at(-1)).toBe('ceo_decision:approve_other');
      expect(forHr.steps.at(-1)).toMatchObject({ comment: 'Well earned', by: { email: ceoEmail } });
      expect(figures(forHr.steps.at(-1)!)).toEqual(['amount', 1200, 12, 11200]);
      const forManager = await requestOf(benP, q.id, manager);
      expect(forManager.steps.at(-1)).toMatchObject({ decision: 'approve_other', comment: 'Well earned', increaseAmount: null, increasePercent: null, gross: null });
      // decided: no more decisions
      await ceoStep(raiseId, 'approve', { comment: 'Again' }).expect(409);
      await ceoStep(raiseId, 'decline', { comment: 'No' }).expect(409);
    });

    it('signed (no second approval): done; the employee sees their new salary, the manager never a figure', async () => {
      await sign(raiseId).expect(200);
      const forHr = await requestOf(benP, q.id, hr);
      expect(forHr).toMatchObject({ status: 'done', raise: { stage: 'signed', previousGross: 10000, newGross: 11200 } });
      expect(kinds(forHr)).toEqual(['submitted', 'hr_decision:approve_other', 'prepared', 'sent', 'returned', 'sent', 'ceo_decision:approve_other', 'signed']);
      expect(forHr.steps.at(-1)).toMatchObject({ gross: 11200, effectiveDate: EFFECTIVE, by: { email: hrEmail } });

      const forBen = await requestOf(benP, q.id, ben);
      expect(forBen).toMatchObject({ status: 'done', raise: { newGross: 11200, effectiveDate: EFFECTIVE, previousGross: null } });
      expect(figures(forBen.steps.at(-1)!)).toEqual([null, null, null, 11200]);
      expect(forBen.steps.slice(1, -1).every((s) => s.gross === null && s.increaseAmount === null && s.increasePercent === null)).toBe(true);
      const forManager = await requestOf(benP, q.id, manager);
      expect(forManager.raise).toMatchObject({ newGross: null, previousGross: null, effectiveDate: EFFECTIVE });
      expect(forManager.steps.every((s) => s.gross === null && s.increaseAmount === null && s.increasePercent === null)).toBe(true);
      expect((await auditOf(q.id)).map((a) => a.action)).toEqual(['create', 'prepare', 'submit', 'return', 'submit', 'approve', 'done']);
    });

    it('a signing undone (a Super Admin) is logged, and signed again', async () => {
      await api().post(`/api/contracts/${raiseId}/unsign`).set('Cookie', superAdmin).expect(200);
      const undone = await requestOf(benP, q.id, ben);
      expect(undone.status).toBe('approved');
      expect(kinds(undone).at(-1)).toBe('unsigned');
      // not signed any more: the new salary is hidden again
      expect(undone.steps.every((s) => s.gross === null || s.kind === 'submitted')).toBe(true);
      await sign(raiseId).expect(200);
      expect(kinds(await requestOf(benP, q.id, hr)).slice(-3)).toEqual(['signed', 'unsigned', 'signed']);
    });
  });

  describe('the manager asks, a percent only; HR approves it as suggested, a new contract; the CEO rejects it', () => {
    let q: Request;

    it('a manager suggests a percent, never an amount, and sees their own percent back', async () => {
      expect((await ask(benP, { raiseReason: 'counter_offer', comment: 'An offer from a competitor', suggestedIncrease: 1000 }, manager).expect(400)).body.message).toBe(
        "A manager suggests a raise as a percent only, as managers don't see salaries: HR and the CEO set the amount.",
      );
      q = (await ask(benP, { raiseReason: 'counter_offer', comment: 'An offer from a competitor', suggestedPercent: 8 }, manager).expect(201)).body as Request;
      expect(q).toMatchObject({ requester: 'manager', suggestion: { kind: 'percent', percent: 8, amount: null, gross: null }, suggestedGross: null });
      expect(figures(q.steps[0])).toEqual(['percent', null, 8, null]);
      // HR: on the 11,200 in force, +8% is 12,096
      expect((await requestOf(benP, q.id, hr)).suggestion).toEqual({ kind: 'percent', amount: null, percent: 8, gross: 12096 });
      // the employee doesn't see the manager's request
      expect((await requestsOf(benP, ben)).requests.map((r) => r.id)).not.toContain(q.id);
    });

    it('HR approves it as suggested as a new contract, from the month it is asked from (no date given): the raise takes the suggestion', async () => {
      expect(q.effectiveFrom).toBe(NEXT_EFFECTIVE);
      const approved = (await hrApprove(q.id, { decision: 'approve', comment: 'Keep him', way: 'contract' }).expect(200)).body as Request;
      expect(approved).toMatchObject({ status: 'with_ceo', raise: { way: 'contract', effectiveDate: NEXT_EFFECTIVE, previousGross: 11200, newGross: 12096 } });
      expect(kinds(approved)).toEqual(['submitted', 'hr_decision:approve', 'prepared', 'sent']);
      expect(figures(approved.steps[1])).toEqual(['percent', 896, 8, 12096]);
      expect(approved.steps[1].effectiveDate).toBe(NEXT_EFFECTIVE);
      expect(approved.steps[2]).toMatchObject({ way: 'contract', effectiveDate: NEXT_EFFECTIVE });
      // the manager: their own percent back, nothing of HR's
      const forManager = await requestOf(benP, q.id, manager);
      expect(figures(forManager.steps[0])).toEqual(['percent', null, 8, null]);
      expect(figures(forManager.steps[1])).toEqual([null, null, null, null]);
    });

    it('the CEO rejects it with a comment: the draft goes, the request is declined, the manager reads why', async () => {
      const raise = (await requestOf(benP, q.id, hr)).raise!;
      await ceoStep(raise.contractId, 'decline', {}).expect(400);
      await ceoStep(raise.contractId, 'decline', { comment: 'Not matching offers this year' }).expect(204);
      expect(await prisma.contract.findUnique({ where: { id: raise.contractId } })).toBeNull();
      const forManager = await requestOf(benP, q.id, manager);
      expect(forManager).toMatchObject({ status: 'declined', raise: null, decision: { stage: 'ceo', reason: 'Not matching offers this year' } });
      expect(kinds(forManager)).toEqual(['submitted', 'hr_decision:approve', 'prepared', 'sent', 'ceo_decision:reject']);
      expect(forManager.steps.at(-1)).toMatchObject({ comment: 'Not matching offers this year', contractNumber: raise.number, by: { email: ceoEmail } });
      expect((await auditOf(q.id)).at(-1)).toMatchObject({ action: 'decline', diff: { stage: 'ceo', decision: 'reject', comment: 'Not matching offers this year' } });
    });
  });

  describe('HR asks, rejects, and approves in the whole raise form; the CEO approves as it reached them', () => {
    it('HR rejects a request with a comment (the old body too)', async () => {
      const q = (await ask(dana, { raiseReason: 'cost_of_living', comment: 'Inflation this year', suggestedIncrease: 2000 }, hr).expect(201)).body as Request;
      expect(q).toMatchObject({ requester: 'hr', suggestion: { kind: 'amount', amount: 2000, gross: 11000 }, amountsHidden: false });
      await hrReject(q.id, {}).expect(400);
      await hrReject(q.id, { comment: 'x' }, ceo).expect(403);
      const rejected = (await hrReject(q.id, { reason: 'Covered by the yearly review' }).expect(200)).body as Request;
      expect(rejected).toMatchObject({ status: 'declined', decision: { stage: 'hr', reason: 'Covered by the yearly review' } });
      expect(kinds(rejected)).toEqual(['submitted', 'hr_decision:reject']);
      expect(rejected.steps[1].comment).toBe('Covered by the yearly review');
    });

    it('in the whole raise form, HR’s comment is required; the same gross as suggested is approving it as suggested; sent at once', async () => {
      const q = (await ask(dana, { raiseReason: 'annual', comment: 'Due for review', suggestedIncrease: 1000 }, hr).expect(201)).body as Request;
      const body = { way: 'amendment', effectiveDate: EFFECTIVE, reason: 'annual', grossSalary: 10000, requestId: q.id };
      expect((await api().post(`/api/employees/${dana.id}/employments/${dana.employmentId}/raises`).set('Cookie', hr).send(body).expect(400)).body.message).toMatch(/Write your comment/);
      const raise = (await api().post(`/api/employees/${dana.id}/employments/${dana.employmentId}/raises`).set('Cookie', hr).send({ ...body, comment: 'As asked' }).expect(201))
        .body as { id: string; stage: string; allowancesTotal: number };
      expect(raise).toMatchObject({ stage: 'pending_ceo', allowancesTotal: 500 });
      const forHr = await requestOf(dana, q.id, hr);
      expect(forHr.status).toBe('with_ceo');
      expect(kinds(forHr)).toEqual(['submitted', 'hr_decision:approve', 'prepared', 'sent']);
      expect(figures(forHr.steps[1])).toEqual(['amount', 1000, 11.11, 10000]);

      // the CEO approves it as it reached them: the figures worked out from the pay before it
      const approved = (await ceoStep(raise.id, 'approve', { comment: 'Fine' }).expect(200)).body as { grossSalary: number; allowancesTotal: number };
      expect(approved).toMatchObject({ grossSalary: 10000, allowancesTotal: 500 });
      const decided = await requestOf(dana, q.id, hr);
      expect(decided.status).toBe('approved');
      expect(kinds(decided).at(-1)).toBe('ceo_decision:approve');
      expect(figures(decided.steps.at(-1)!)).toEqual([null, 1000, 11.11, 10000]);

      // a Super Admin deletes the draft: logged, and the request is HR's again, to reject
      await api().delete(`/api/contracts/${raise.id}`).set('Cookie', superAdmin).expect(204);
      const back = await requestOf(dana, q.id, hr);
      expect(back).toMatchObject({ status: 'with_hr', raise: null });
      expect(kinds(back).at(-1)).toBe('raise_deleted');
      await hrReject(q.id, { comment: 'Entered by mistake' }).expect(200);
    });

    it('a request suggesting nothing: HR can’t approve it as suggested; with another raise, on the allowances as they are', async () => {
      const q = (await ask(dana, { raiseReason: 'market_adjustment', comment: 'Below the market' }, hr).expect(201)).body as Request;
      expect(q.suggestion).toBeNull();
      expect((await hrApprove(q.id, { decision: 'approve', comment: 'Yes', way: 'amendment', effectiveDate: EFFECTIVE }).expect(400)).body.message).toBe(
        'This request suggests no raise: approve it with another raise, and set the raise.',
      );
      const approved = (await hrApprove(q.id, { decision: 'approve_other', increaseAmount: 750.5, comment: 'Yes', way: 'amendment', effectiveDate: EFFECTIVE }).expect(200)).body as Request;
      expect(approved.raise).toMatchObject({ newGross: 9750.5, previousGross: 9000 });
      expect(figures(approved.steps[1])).toEqual(['amount', 750.5, 8.34, 9750.5]);
      const raise = await contractOf<{ allowancesTotal: number }>(dana, approved.raise!.contractId);
      expect(raise.allowancesTotal).toBe(500);
      // tidy: the CEO rejects it
      await ceoStep(approved.raise!.contractId, 'decline', { comment: 'Later' }).expect(204);
    });
  });

  describe('by the hour', () => {
    it('a percent raises the rate; the CEO’s other amount a month is spread over the hours', async () => {
      const q = (await ask(omar, { raiseReason: 'annual', comment: 'A year with us', suggestedPercent: 10 }, hr).expect(201)).body as Request;
      // 150 × 20 hours × 52 ÷ 12 = 13,000 a month; +10%: 165 an hour, 14,300
      expect(q.suggestion).toMatchObject({ kind: 'percent', percent: 10, gross: 14300 });
      const approved = (await hrApprove(q.id, { decision: 'approve', comment: 'Yes', way: 'amendment', effectiveDate: EFFECTIVE }).expect(200)).body as Request;
      const raise = await contractOf<{ hourlyRate: number; grossSalary: number }>(omar, approved.raise!.contractId);
      expect(raise).toMatchObject({ hourlyRate: 165, grossSalary: 14300 });
      // the CEO: +1,000 a month over 86.67 hours is 11.54 an hour more than the 150 before
      const decided = (await ceoStep(approved.raise!.contractId, 'approve', { comment: 'A round thousand', increaseAmount: 1000 }).expect(200)).body as { hourlyRate: number; grossSalary: number };
      expect(decided).toMatchObject({ hourlyRate: 161.54, grossSalary: monthlyFromHourly(161.54, 20) });
      await sign(approved.raise!.contractId).expect(200);
    });
  });

  describe('a request from before 17 October 2026', () => {
    it('stays readable: its text the comment, the gross typed as before, its submitted step', async () => {
      const benUser = await prisma.user.findUniqueOrThrow({ where: { email: benEmail }, select: { id: true } });
      const old = await prisma.raiseRequest.create({
        data: {
          employeeId: benP.id,
          employmentId: benP.employmentId,
          requestedById: benUser.id,
          requester: 'self',
          comment: 'A year of good reviews',
          suggestedGross: 12000,
          status: 'declined',
          declinedStage: 'hr',
          declineReason: 'After the review',
          declinedAt: new Date('2026-10-16T10:00:00Z'),
          createdAt: new Date('2026-10-16T09:00:00Z'),
          // as the migration logs it
          steps: {
            create: [
              { kind: 'submitted', comment: 'A year of good reviews', gross: 12000, actorId: benUser.id, at: new Date('2026-10-16T09:00:00Z') },
              { kind: 'hr_decision', decision: 'reject', comment: 'After the review', at: new Date('2026-10-16T10:00:00Z') },
            ],
          },
        },
      });
      const forBen = await requestOf(benP, old.id, ben);
      expect(forBen).toMatchObject({
        reason: 'A year of good reviews',
        comment: 'A year of good reviews',
        raiseReason: null,
        // asked for before Effective from: none
        effectiveFrom: null,
        suggestedGross: 12000,
        suggestion: { kind: 'gross', gross: 12000 },
        decision: { stage: 'hr', reason: 'After the review' },
      });
      expect(kinds(forBen)).toEqual(['submitted', 'hr_decision:reject']);
      expect(figures(forBen.steps[0])).toEqual([null, null, null, 12000]);
      const forManager = await requestOf(benP, old.id, manager);
      expect(forManager).toMatchObject({ suggestedGross: null, suggestion: null });
      expect(figures(forManager.steps[0])).toEqual([null, null, null, null]);
      expect((await requestOf(benP, old.id, hr)).suggestedGross).toBe(12000);
    });

    it('HR gives the raise’s date on one with HR: it has no Effective from to take', async () => {
      const old = await prisma.raiseRequest.create({
        data: { employeeId: dana.id, employmentId: dana.employmentId, requester: 'hr', raiseReason: 'annual', comment: 'Asked before Effective from', suggestedPercent: 5, status: 'with_hr' },
      });
      expect((await requestOf(dana, old.id, hr)).effectiveFrom).toBeNull();
      expect((await hrApprove(old.id, { decision: 'approve', comment: 'Yes', way: 'amendment' }).expect(400)).body.message).toMatch(/Enter the date the raise takes effect/);
      // tidy: HR rejects it
      await hrReject(old.id, { comment: 'Asked again with a month' }).expect(200);
    });
  });

  describe('the migration: the steps known of the requests asked for before it', () => {
    const MIGRATIONS = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
    const SCHEMA = 'raise_request_steps_check';
    let db: pg.Client;

    beforeAll(async () => {
      db = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      assertTestDatabase((await db.query<{ name: string }>('SELECT current_database() AS name')).rows[0].name);
    });

    afterAll(async () => {
      await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await db.end();
    });

    it('submitted from each request; then the audit log’s steps, or what the request and its raise say', async () => {
      const migration = readdirSync(MIGRATIONS).find((m) => m.endsWith('_raise_request_steps'))!;
      await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; SET search_path TO ${SCHEMA}`);
      for (const m of readdirSync(MIGRATIONS).filter((x) => /^\d{14}_/.test(x) && x < migration).sort()) {
        await db.query(readFileSync(`${MIGRATIONS}${m}/migration.sql`, 'utf8'));
      }
      const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
      await db.query(`
        INSERT INTO users (id, email, updated_at) VALUES ('${id(1)}', 'hr@x.test', now()), ('${id(2)}', 'ceo@x.test', now()), ('${id(3)}', 'ben@x.test', now());
        INSERT INTO employees (id, employee_code, full_name_en, full_name_ar, updated_at) VALUES ('${id(10)}', 'EMP-0001', 'Ben', 'بن', now());
        INSERT INTO employments (id, employee_id, employment_type, join_date, updated_at) VALUES ('${id(20)}', '${id(10)}', 'full_time', '2026-01-01', now());
        INSERT INTO contracts (id, employment_id, number, version, form, start_date, end_date, duration_months, probation_months, gross_salary, insured_salary, status, updated_at)
          VALUES ('${id(30)}', '${id(20)}', 'CON-2026-0001', 1, 'fixed', '2026-01-01', '2026-12-31', 12, 3, 10000, 10000, 'superseded', now());
        INSERT INTO contracts (id, employment_id, number, version, form, kind, start_date, end_date, probation_months, gross_salary, insured_salary, status, raise_reason, approval, approved_by, approved_at, created_at, updated_at)
          VALUES ('${id(31)}', '${id(20)}', 'CON-2026-0001-A1', 2, 'fixed', 'amendment', '2026-11-01', '2026-12-31', 0, 11000, 10000, 'active', 'annual', 'approved', '${id(2)}', '2026-10-16T12:00:00Z', '2026-10-16T10:30:00Z', now());
        -- done, with its audit trail
        INSERT INTO raise_requests (id, employee_id, employment_id, requested_by, requester, reason, suggested_gross, status, contract_id, done_at, created_at, updated_at)
          VALUES ('${id(40)}', '${id(10)}', '${id(20)}', '${id(3)}', 'self', 'A good year', 11500, 'done', '${id(31)}', '2026-10-16T14:00:00Z', '2026-10-16T09:00:00Z', now());
        INSERT INTO audit_log (user_id, action, entity_type, entity_id, diff, at) VALUES
          ('${id(3)}', 'create', 'raise_request', '${id(40)}', '{"reason":"A good year"}', '2026-10-16T09:00:00Z'),
          ('${id(1)}', 'prepare', 'raise_request', '${id(40)}', '{"contract":"CON-2026-0001-A1"}', '2026-10-16T10:30:00Z'),
          ('${id(1)}', 'submit', 'raise_request', '${id(40)}', '{"contract":"CON-2026-0001-A1"}', '2026-10-16T10:31:00Z'),
          ('${id(2)}', 'return', 'raise_request', '${id(40)}', '{"contract":"CON-2026-0001-A1","reason":"Round it"}', '2026-10-16T11:00:00Z'),
          ('${id(1)}', 'submit', 'raise_request', '${id(40)}', '{"contract":"CON-2026-0001-A1"}', '2026-10-16T11:30:00Z'),
          ('${id(2)}', 'approve', 'raise_request', '${id(40)}', '{"contract":"CON-2026-0001-A1"}', '2026-10-16T12:00:00Z'),
          ('${id(1)}', 'done', 'raise_request', '${id(40)}', '{"contract":"CON-2026-0001-A1"}', '2026-10-16T14:00:00Z'),
          ('${id(1)}', 'update', 'raise_request', '${id(40)}', '{"contract":"CON-2026-0001-A1"}', '2026-10-16T14:30:00Z');
        -- declined by HR, the audit log without its steps (only the create)
        INSERT INTO raise_requests (id, employee_id, employment_id, requested_by, requester, reason, status, declined_by, declined_at, declined_stage, decline_reason, created_at, updated_at)
          VALUES ('${id(41)}', '${id(10)}', '${id(20)}', '${id(1)}', 'hr', 'Market', 'declined', '${id(1)}', '2026-10-16T08:00:00Z', 'hr', 'Not now', '2026-10-16T07:00:00Z', now());
        -- declined by the CEO, as the audit log has it
        INSERT INTO raise_requests (id, employee_id, employment_id, requester, reason, status, declined_by, declined_at, declined_stage, decline_reason, created_at, updated_at)
          VALUES ('${id(42)}', '${id(10)}', '${id(20)}', 'manager', 'Took over the team', 'declined', '${id(2)}', '2026-10-16T06:00:00Z', 'ceo', 'Next year', '2026-10-16T05:00:00Z', now());
        INSERT INTO audit_log (user_id, action, entity_type, entity_id, diff, at) VALUES
          ('${id(2)}', 'decline', 'raise_request', '${id(42)}', '{"stage":"ceo","reason":"Next year"}', '2026-10-16T06:00:00Z');
      `);
      await db.query(readFileSync(`${MIGRATIONS}${migration}/migration.sql`, 'utf8'));

      const { rows } = await db.query<{ request: string; kind: string; decision: string | null; comment: string | null; gross: string | null; way: string | null; date: string | null; number: string | null; actor: string | null; at: Date }>(`
        SELECT right(s.request_id::text, 2) AS request, s.kind, s.decision, s.comment, s.gross::text, s.way, to_char(s.effective_date, 'YYYY-MM-DD') AS date,
          s.contract_number AS number, u.email AS actor, s.at
        FROM raise_request_steps s LEFT JOIN users u ON u.id = s.actor_id ORDER BY s.request_id, s.id`);
      const row = (r: (typeof rows)[number]) => [r.request, r.kind, r.decision, r.comment, r.gross, r.way, r.date, r.number, r.actor];
      expect(rows.map(row)).toEqual([
        ['40', 'submitted', null, 'A good year', '11500.00', null, null, null, 'ben@x.test'],
        ['40', 'prepared', null, null, null, 'amendment', '2026-11-01', 'CON-2026-0001-A1', 'hr@x.test'],
        ['40', 'sent', null, null, null, null, null, 'CON-2026-0001-A1', 'hr@x.test'],
        ['40', 'returned', null, 'Round it', null, null, null, 'CON-2026-0001-A1', 'ceo@x.test'],
        ['40', 'sent', null, null, null, null, null, 'CON-2026-0001-A1', 'hr@x.test'],
        ['40', 'ceo_decision', 'approve', null, null, null, null, 'CON-2026-0001-A1', 'ceo@x.test'],
        ['40', 'signed', null, null, null, null, '2026-11-01', 'CON-2026-0001-A1', 'hr@x.test'],
        ['41', 'submitted', null, 'Market', null, null, null, null, 'hr@x.test'],
        ['41', 'hr_decision', 'reject', 'Not now', null, null, null, null, 'hr@x.test'],
        ['42', 'submitted', null, 'Took over the team', null, null, null, null, null],
        ['42', 'ceo_decision', 'reject', 'Next year', null, null, null, null, 'ceo@x.test'],
      ]);
      expect(rows[1].at.toISOString()).toBe('2026-10-16T10:30:00.000Z');
      // the request's text is its comment now; the new columns are empty on what was there
      const { rows: requests } = await db.query('SELECT comment, raise_reason, suggested_increase, suggested_percent FROM raise_requests ORDER BY id');
      expect(requests.map((r) => r.comment)).toEqual(['A good year', 'Market', 'Took over the team']);
      expect(requests.every((r) => r.raise_reason === null && r.suggested_increase === null && r.suggested_percent === null)).toBe(true);
      // the new reasons on raises, and adjustment still there for the old ones
      await db.query(`UPDATE contracts SET raise_reason = 'counter_offer' WHERE id = '${id(31)}'`);
      await db.query(`UPDATE contracts SET raise_reason = 'adjustment' WHERE id = '${id(31)}'`);
      await expect(db.query(`UPDATE contracts SET raise_reason = 'bonus' WHERE id = '${id(31)}'`)).rejects.toThrow(/contracts_raise_reason_check/);
      // a request's reason is from the list, without adjustment; a manager suggests no amount
      await expect(db.query(`UPDATE raise_requests SET raise_reason = 'adjustment' WHERE id = '${id(41)}'`)).rejects.toThrow(/raise_requests_raise_reason_check/);
      await expect(db.query(`UPDATE raise_requests SET suggested_increase = 500 WHERE id = '${id(42)}'`)).rejects.toThrow(/raise_requests_manager_suggestion_check/);
      await expect(db.query(`UPDATE raise_requests SET suggested_increase = 500, suggested_percent = 5 WHERE id = '${id(41)}'`)).rejects.toThrow(/raise_requests_suggestion_check/);
      await db.query(`UPDATE raise_requests SET suggested_percent = 5, suggested_gross = 10500 WHERE id = '${id(42)}'`);
    });
  });
});
