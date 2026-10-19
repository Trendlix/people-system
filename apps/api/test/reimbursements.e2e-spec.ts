import type { INestApplication } from '@nestjs/common';
import { reimbursementPayMonth } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly } from '../src/common/date-only.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Reimbursements (owner, 18 October 2026: "allow the employee to add reimbursement request … for specific preset up
// conditions", "in the setup i need to enter for it a cap"): HR setting up the types with their conditions; an employee
// claiming one with a receipt; the direct manager, HR and Finance deciding it in turn (approving, approving a lower
// amount with a comment, rejecting with one), straight to HR without a manager; Finance's approval adding it, untaxed,
// to the next payroll; the caps, the deadline and who may claim; nobody deciding their own claim; cancelling while open;
// and who sees a claim and its receipts. These tests look at their own people and types (names end with RUN) and delete
// everything they made. Every name and amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const JOINED = firstDay(monthsLater(CURRENT, -6));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');

interface TypeView {
  id: string;
  nameEn: string;
  nameAr: string;
  description: string | null;
  receiptRequired: boolean;
  capPerClaim: number | null;
  capPerMonth: number | null;
  capPerYear: number | null;
  claimWithinDays: number | null;
  departmentIds: string[];
  gradeIds: string[];
  employmentTypes: string[];
  active: boolean;
  claims: number;
}

type MyType = Omit<TypeView, 'departmentIds' | 'gradeIds' | 'employmentTypes' | 'claims'> & { usedInMonth: number; usedInYear: number };

interface Claim {
  id: string;
  employee: { id: string; fullNameEn: string; fullNameAr: string | null; photoId?: string | null; department: string | null; team?: string | null };
  type: { id: string; nameEn: string; nameAr: string; receiptRequired: boolean };
  expenseDate: string;
  amount: number;
  approvedAmount: number | null;
  description: string;
  status: string;
  stage: string | null;
  waitingForYou: boolean;
  canCancel: boolean;
  manager: { id: string; fullNameEn: string; role: string } | null;
  rejectedStage: string | null;
  rejectReason: string | null;
  payMonth: string | null;
  payroll: { status: string; runMonth: string } | null;
  receipts: { id: string; fileName: string; mimeType: string; sizeBytes: number }[];
  steps: { id: string; kind: string; decision: string | null; amount: number | null; comment: string | null; payMonth: string | null; actor: string | null; at: string }[];
  createdAt: string;
}

/** A refusal's messages, one or a list, together. */
const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
const kinds = (c: Claim) => c.steps.map((s) => (s.decision ? `${s.kind}:${s.decision}` : s.kind));

describe('Reimbursements (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string; // HR without a profile of their own
  let hana: string; // HR with a profile, claiming for herself
  let finance: string;
  let ceo: string;
  let superAdmin: string;
  let mona: string; // Ben's direct manager
  let ben: string;
  let nora: string; // no manager
  let ivy: string; // in another department
  let sam: string; // no part in anything here
  let emailDomainBefore: string | null;
  let claimsId: string; // the department Mobile is for
  let otherId: string;
  let madeRun: string | null = null;
  const people: string[] = [];
  const typeIds: string[] = [];
  const ids: Record<string, string> = {};
  const api = () => request(app.getHttpServer());

  let mobile: TypeView; // receipt needed, caps, 30 days, Claims department only
  let travel: TypeView; // no conditions

  async function person(name: string, email: string | null, employment: Record<string, unknown> | null) {
    const res = await api()
      .post('/api/employees')
      .set('Cookie', hr)
      .send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', ...(email && { workEmail: email }) })
      .expect(201);
    people.push(res.body.id);
    if (employment) await api().post(`/api/employees/${res.body.id}/employments`).set('Cookie', hr).send({ employmentType: 'full_time', joinDate: JOINED, ...employment }).expect(201);
    return res.body.id as string;
  }

  async function account(roles: Parameters<typeof createUser>[1]) {
    const email = await createUser(prisma, roles);
    return { email, session: await signIn(app, email) };
  }

  const createType = (body: object, session = hr) => api().post('/api/reimbursement-types').set('Cookie', session).send(body);
  const patchType = (id: string, body: object, session = hr) => api().patch(`/api/reimbursement-types/${id}`).set('Cookie', session).send(body);
  const myTypes = async (session: string, query = '') => (await api().get(`/api/me/reimbursement-types${query}`).set('Cookie', session).expect(200)).body as MyType[];
  const send = (session: string, fields: { typeId: string; expenseDate?: string; amount?: number | string; description?: string }, receipts: [Buffer, string][] = [[PNG, 'taxi.png']]) => {
    let req = api()
      .post('/api/me/reimbursements')
      .set('Cookie', session)
      .field('typeId', fields.typeId)
      .field('expenseDate', fields.expenseDate ?? TODAY)
      .field('amount', String(fields.amount ?? 100))
      .field('description', fields.description ?? 'Taxi to the client');
    for (const [data, name] of receipts) req = req.attach('receipts', data, name);
    return req;
  };
  const decide = (id: string, body: object, session: string) => api().post(`/api/reimbursements/${id}/decide`).set('Cookie', session).send(body);
  const cancel = (id: string, session: string) => api().post(`/api/me/reimbursements/${id}/cancel`).set('Cookie', session).send({});
  const one = (id: string, session: string) => api().get(`/api/reimbursements/${id}`).set('Cookie', session);
  const list = async (session: string, query = '') => (await api().get(`/api/reimbursements${query}`).set('Cookie', session).expect(200)).body as Claim[];
  const waiting = async (session: string) => (await api().get('/api/reimbursements/counts').set('Cookie', session).expect(200)).body.waiting as number;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = (await account(['hr'])).session;
    const hanaAccount = await account(['hr']);
    hana = hanaAccount.session;
    finance = (await account(['finance'])).session;
    ceo = (await account(['ceo'])).session;
    superAdmin = (await account(['super_admin'])).session;
    const monaAccount = await account(['manager']);
    mona = monaAccount.session;
    const benAccount = await account(['employee']);
    ben = benAccount.session;
    const noraAccount = await account(['employee']);
    nora = noraAccount.session;
    const ivyAccount = await account(['employee']);
    ivy = ivyAccount.session;
    const samAccount = await account(['employee']);
    sam = samAccount.session;

    // sign-in accounts here are @test.local: no company email domain while these tests run
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);

    claimsId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Claims ${RUN}` }).expect(201)).body.id;
    otherId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Elsewhere ${RUN}` }).expect(201)).body.id;

    ids.mona = await person('Mona Manager', monaAccount.email, { departmentId: claimsId });
    ids.ben = await person('Ben Claiming', benAccount.email, { departmentId: claimsId, managerId: ids.mona });
    ids.nora = await person('Nora Alone', noraAccount.email, { departmentId: claimsId });
    ids.ivy = await person('Ivy Elsewhere', ivyAccount.email, { departmentId: otherId });
    ids.hana = await person('Hana HR', hanaAccount.email, { departmentId: claimsId });
    ids.sam = await person('Sam Stranger', samAccount.email, { departmentId: otherId });

    // the month's run approved, unless one is there already: Finance's approval then goes to the next month
    const month = toDateOnly(firstDay(CURRENT));
    if (!(await prisma.payrollRun.findUnique({ where: { month } }))) madeRun = (await prisma.payrollRun.create({ data: { month, rules: {}, status: 'approved' } })).id;
  });

  afterAll(async () => {
    await prisma.reimbursementClaim.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.reimbursementType.deleteMany({ where: { OR: [{ id: { in: typeIds } }, { nameEn: { endsWith: RUN } }] } });
    if (madeRun) await prisma.payrollRun.deleteMany({ where: { id: madeRun } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.department.deleteMany({ where: { id: { in: [claimsId, otherId].filter(Boolean) } } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('the types', () => {
    it('HR sets one up with its caps, receipt, deadline and who may claim it; the audit log has it', async () => {
      mobile = (
        await createType({
          nameEn: `Mobile ${RUN}`,
          nameAr: 'فاتورة المحمول',
          description: 'The work line',
          capPerClaim: 500,
          capPerMonth: 800,
          capPerYear: 2000,
          claimWithinDays: 30,
          departmentIds: [claimsId, claimsId],
        }).expect(201)
      ).body;
      typeIds.push(mobile.id);
      expect(mobile).toEqual({
        id: mobile.id,
        nameEn: `Mobile ${RUN}`,
        nameAr: 'فاتورة المحمول',
        description: 'The work line',
        receiptRequired: true,
        capPerClaim: 500,
        capPerMonth: 800,
        capPerYear: 2000,
        claimWithinDays: 30,
        departmentIds: [claimsId],
        gradeIds: [],
        employmentTypes: [],
        active: true,
        claims: 0,
      });
      travel = (await createType({ nameEn: `Travel ${RUN}`, nameAr: 'انتقالات', receiptRequired: false }).expect(201)).body;
      typeIds.push(travel.id);
      expect(travel).toMatchObject({ receiptRequired: false, capPerClaim: null, capPerMonth: null, capPerYear: null, claimWithinDays: null, departmentIds: [], active: true });

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'reimbursement_type', entityId: mobile.id } });
      expect(audit.map((a) => a.action)).toEqual(['create']);
      expect(audit[0].diff).toMatchObject({ nameEn: `Mobile ${RUN}`, capPerClaim: 500, departmentIds: [claimsId] });
    });

    it('Finance, the CEO and the Super Admin read them; only HR adds or changes one', async () => {
      for (const session of [hr, finance, ceo, superAdmin]) {
        const types = (await api().get('/api/reimbursement-types').set('Cookie', session).expect(200)).body as TypeView[];
        expect(types.find((t) => t.id === mobile.id)).toMatchObject({ nameEn: `Mobile ${RUN}`, claims: 0 });
      }
      await api().get('/api/reimbursement-types').set('Cookie', ben).expect(403);
      await createType({ nameEn: `Other ${RUN}`, nameAr: 'أخرى' }, finance).expect(403);
      await patchType(mobile.id, { active: false }, ceo).expect(403);
    });

    it('refuses a name taken (whatever the case), caps that don’t fit together, a deadline out of range and departments not on the list', async () => {
      expect(said(await createType({ nameEn: `MOBILE ${RUN}`, nameAr: 'تكرار' }).expect(409))).toEqual([`There is already a reimbursement type called Mobile ${RUN}. Choose another name.`]);
      expect(said(await createType({ nameEn: `Caps ${RUN}`, nameAr: 'حدود', capPerClaim: 600, capPerMonth: 500 }).expect(400))).toEqual([
        "The cap a claim (EGP 600.00) can't be more than the cap a month (EGP 500.00).",
      ]);
      expect(said(await createType({ nameEn: `Caps ${RUN}`, nameAr: 'حدود', capPerClaim: 0 }).expect(400))[0]).toMatch(/^Enter the cap a claim/);
      expect(said(await createType({ nameEn: `Days ${RUN}`, nameAr: 'أيام', claimWithinDays: 0 }).expect(400))[0]).toMatch(/^Enter the days after the expense/);
      expect(said(await createType({ nameEn: `Days ${RUN}`, nameAr: 'أيام', claimWithinDays: 366 }).expect(400))[0]).toMatch(/^Enter the days after the expense/);
      expect(said(await createType({ nameEn: `Kinds ${RUN}`, nameAr: 'أنواع', employmentTypes: ['contractor'] }).expect(400))[0]).toMatch(/^Choose the employment types from/);
      expect(said(await createType({ nameEn: `Gone ${RUN}`, nameAr: 'محذوف', departmentIds: ['00000000-0000-4000-8000-000000000000'] }).expect(400))).toEqual([
        'One of the departments chosen is no longer on the list. Reload the page and choose again.',
      ]);
      // a change checked with what the type has: the month's cap below its cap a claim
      expect(said(await patchType(mobile.id, { capPerMonth: 400 }).expect(400))).toEqual(["The cap a claim (EGP 500.00) can't be more than the cap a month (EGP 400.00)."]);
    });
  });

  describe('a claim from the employee to Finance', () => {
    let claim: Claim;

    it('offers the employee the types they may claim, with what they used of the caps; none without a current employment', async () => {
      const mine = await myTypes(ben);
      expect(mine.find((t) => t.id === mobile.id)).toEqual({
        id: mobile.id,
        nameEn: `Mobile ${RUN}`,
        nameAr: 'فاتورة المحمول',
        description: 'The work line',
        receiptRequired: true,
        capPerClaim: 500,
        capPerMonth: 800,
        capPerYear: 2000,
        claimWithinDays: 30,
        active: true,
        usedInMonth: 0,
        usedInYear: 0,
      });
      expect(mine.find((t) => t.id === travel.id)).toBeTruthy();
      // no employee profile: nothing to claim
      expect(await myTypes(finance)).toEqual([]);
      expect(said(await send(finance, { typeId: travel.id }).expect(403))).toEqual(['Only an employee can claim a reimbursement: your sign-in has no employee profile.']);
    });

    it('the employee claims with a receipt: it goes to their direct manager', async () => {
      claim = (await send(ben, { typeId: mobile.id, amount: '450', description: 'October bill' }, [[PNG, 'bill.png']]).expect(201)).body;
      expect(claim).toMatchObject({
        employee: { id: ids.ben, fullNameEn: `Ben Claiming ${RUN}`, department: `Claims ${RUN}`, team: null },
        type: { id: mobile.id, nameEn: `Mobile ${RUN}`, receiptRequired: true },
        expenseDate: TODAY,
        amount: 450,
        approvedAmount: null,
        description: 'October bill',
        status: 'with_manager',
        stage: 'manager',
        waitingForYou: false,
        canCancel: true,
        manager: { id: ids.mona, fullNameEn: `Mona Manager ${RUN}`, role: 'direct_manager' },
        payMonth: null,
        payroll: null,
      });
      expect(claim.receipts).toEqual([{ id: claim.receipts[0].id, fileName: 'bill.png', mimeType: 'image/png', sizeBytes: PNG.length }]);
      expect(kinds(claim)).toEqual(['submitted']);
      expect(claim.steps[0]).toMatchObject({ amount: 450, actor: `Ben Claiming ${RUN}` });
      // what it takes of the caps, while it is being decided
      expect((await myTypes(ben)).find((t) => t.id === mobile.id)).toMatchObject({ usedInMonth: 450, usedInYear: 450 });
      expect((await api().get('/api/me/reimbursements').set('Cookie', ben).expect(200)).body.map((c: Claim) => c.id)).toContain(claim.id);
    });

    it('waits for the manager, not for HR yet', async () => {
      expect((await list(mona, '?status=waiting')).map((c) => c.id)).toEqual([claim.id]);
      expect(await waiting(mona)).toBe(1);
      expect((await one(claim.id, mona).expect(200)).body).toMatchObject({ waitingForYou: true, canCancel: false });
      expect((await list(hr, '?status=waiting')).map((c) => c.id)).not.toContain(claim.id);
      // HR's page left open on it: not HR's turn yet
      expect(said(await decide(claim.id, { decision: 'approve' }, hr).expect(409))[0]).toMatch(/^This claim is with the manager now/);
    });

    it('the manager approves it: on to HR, the amount as claimed', async () => {
      claim = (await decide(claim.id, { decision: 'approve' }, mona).expect(200)).body;
      expect(claim).toMatchObject({ status: 'with_hr', stage: 'hr', approvedAmount: 450, waitingForYou: false });
      expect(kinds(claim)).toEqual(['submitted', 'manager_decision:approve']);
      // a stale page: the manager can't decide it again
      expect(said(await decide(claim.id, { decision: 'approve' }, mona).expect(409))).toEqual([
        "This claim is with HR now, so it isn't waiting for your decision. Reload the page to see where it is.",
      ]);
      expect(await waiting(mona)).toBe(0);
    });

    it('HR approves a lower amount: with a comment, and less than the amount it reached them with', async () => {
      expect(said(await decide(claim.id, { decision: 'approve_other', amount: 400 }, hr).expect(400))).toEqual(['Write a comment: why a lower amount is approved.']);
      expect(said(await decide(claim.id, { decision: 'approve_other', comment: 'Personal calls' }, hr).expect(400))).toEqual(['Enter the amount approved, more than 0, e.g. 250 or 250.50.']);
      expect(said(await decide(claim.id, { decision: 'approve_other', amount: 450, comment: 'Personal calls' }, hr).expect(400))).toEqual([
        'The amount approved must be less than 450.00. To approve the whole amount, choose Approve.',
      ]);
      claim = (await decide(claim.id, { decision: 'approve_other', amount: 400, comment: 'Personal calls left out' }, hr).expect(200)).body;
      expect(claim).toMatchObject({ status: 'with_finance', stage: 'finance', amount: 450, approvedAmount: 400 });
      expect(claim.steps.at(-1)).toMatchObject({ kind: 'hr_decision', decision: 'approve_other', amount: 400, comment: 'Personal calls left out' });
      // the caps count it at the amount approved
      expect((await myTypes(ben)).find((t) => t.id === mobile.id)).toMatchObject({ usedInMonth: 400 });
    });

    it('Finance approves it: added, untaxed, to the next payroll whose run isn’t approved or paid', async () => {
      const closed = await prisma.payrollRun.findMany({ where: { status: { in: ['approved', 'paid'] } }, select: { month: true } });
      const expected = reimbursementPayMonth(TODAY, closed.map((r) => fromDateOnly(r.month)));
      if (madeRun) expect(expected > firstDay(CURRENT)).toBe(true); // this month's run is approved

      claim = (await decide(claim.id, { decision: 'approve', amount: 1 }, finance).expect(200)).body;
      expect(claim).toMatchObject({ status: 'approved', stage: null, approvedAmount: 400, payMonth: expected, payroll: { status: 'pending', runMonth: expected } });
      expect(kinds(claim)).toEqual(['submitted', 'manager_decision:approve', 'hr_decision:approve_other', 'finance_decision:approve', 'added_to_payroll']);
      expect(claim.steps.at(-1)).toMatchObject({ amount: 400, payMonth: expected });

      const row = await prisma.reimbursementClaim.findUniqueOrThrow({ where: { id: claim.id }, include: { adjustment: true } });
      expect(row.adjustment).toMatchObject({ employeeId: ids.ben, kind: 'addition', type: 'reimbursement', taxed: false, status: 'pending', reason: `Mobile ${RUN}: October bill` });
      expect(row.adjustment!.amount!.toNumber()).toBe(400);
      expect(fromDateOnly(row.adjustment!.month)).toBe(expected);
      // and Additions / Deductions shows it as a Reimbursement addition
      const additions = (await api().get(`/api/payroll/adjustments?employeeId=${ids.ben}&type=reimbursement`).set('Cookie', finance).expect(200)).body;
      expect(additions).toMatchObject([{ kind: 'addition', type: 'reimbursement', taxed: false, amount: 400, month: expected.slice(0, 7), status: 'pending' }]);

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'reimbursement_claim', entityId: claim.id }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => [a.action, (a.diff as { stage?: string }).stage ?? null])).toEqual([
        ['create', null],
        ['approve', 'manager'],
        ['approve', 'hr'],
        ['approve', 'finance'],
      ]);
      expect(audit[3].diff).toMatchObject({ payMonth: expected, adjustmentId: row.adjustmentId, amount: 400 });
      expect(await prisma.auditLog.count({ where: { entityType: 'payroll_adjustment', entityId: row.adjustmentId!, action: 'create' } })).toBe(1);
      // decided: nothing more to decide, nor to cancel
      expect(said(await decide(claim.id, { decision: 'approve' }, finance).expect(409))[0]).toMatch(/^This claim is approved, so there is nothing left to decide/);
      expect(said(await cancel(claim.id, ben).expect(409))).toEqual(["This claim is approved, so it can't be cancelled."]);
      expect((await api().get('/api/reimbursement-types').set('Cookie', hr).expect(200)).body.find((t: TypeView) => t.id === mobile.id).claims).toBe(1);
    });

    it('refuses a claim over the caps: a claim’s, and what is left of the month’s', async () => {
      const over = said(await send(ben, { typeId: mobile.id, amount: 501 }).expect(400));
      expect(over).toContain('At most EGP 500.00 can be claimed at once for this type.');
      expect(said(await send(ben, { typeId: mobile.id, amount: 450 }).expect(400))).toEqual(["Only EGP 400.00 is left of this type's EGP 800.00 for the expense's month."]);
    });

    it('refuses an expense older than the deadline, one after today, and one without the receipt the type needs', async () => {
      expect(said(await send(ben, { typeId: mobile.id, amount: 50, expenseDate: addDays(TODAY, -31) }).expect(400))).toContain(
        'This type must be claimed within 30 days of the expense; this one was 31 days ago.',
      );
      expect(said(await send(ben, { typeId: mobile.id, amount: 50, expenseDate: addDays(TODAY, 1) }).expect(400))).toEqual(["The expense's date can't be after today."]);
      expect(said(await send(ben, { typeId: mobile.id, amount: 50 }, []).expect(400))).toEqual(['Attach the receipt: this type needs one.']);
      // a receipt that is neither a photo nor a PDF, by its content
      expect(said(await send(ben, { typeId: mobile.id, amount: 50 }, [[Buffer.from('GIF89a......'), 'bill.png']]).expect(400))).toEqual([
        'Receipt 1 (bill.png) must be a JPEG, PNG or WebP photo, or a PDF.',
      ]);
      expect(said(await send(ben, { typeId: mobile.id, amount: 'abc' }).expect(400))).toEqual(['Enter the amount spent, more than 0, e.g. 250 or 250.50.']);
      expect(said(await send(ben, { typeId: mobile.id, amount: 0 }).expect(400))).toEqual(['Enter the amount spent, more than 0, e.g. 250 or 250.50.']);
    });

    it('takes five receipts at most', async () => {
      const six: [Buffer, string][] = Array.from({ length: 6 }, (_, i) => [PNG, `r${i}.png`]);
      expect(said(await send(nora, { typeId: travel.id }, six).expect(400))).toEqual(['Attach at most 5 receipts.']);
      const seven: [Buffer, string][] = Array.from({ length: 7 }, (_, i) => [PNG, `r${i}.png`]);
      expect(said(await send(nora, { typeId: travel.id }, seven).expect(400))).toEqual(['Attach at most 5 receipts.']);
    });

    it('an employee the type isn’t for doesn’t see it and can’t claim it', async () => {
      const theirs = await myTypes(ivy);
      expect(theirs.map((t) => t.id)).not.toContain(mobile.id);
      expect(theirs.map((t) => t.id)).toContain(travel.id);
      expect(said(await send(ivy, { typeId: mobile.id, amount: 50 }).expect(400))).toEqual([`Mobile ${RUN} isn't for your department, grade or employment type. Choose another type.`]);
    });
  });

  describe('without a manager, rejected, one’s own, cancelled', () => {
    it('goes straight to HR without a direct manager; a rejection needs a comment', async () => {
      const claim = (await send(nora, { typeId: travel.id, amount: 120.5, description: 'Bus to the warehouse' }, []).expect(201)).body as Claim;
      expect(claim).toMatchObject({ status: 'with_hr', stage: 'hr', manager: null, amount: 120.5, receipts: [] });
      expect(kinds(claim)).toEqual(['submitted', 'no_manager']);
      expect(claim.steps[1].actor).toBeNull();
      expect((await list(hr, '?status=waiting')).map((c) => c.id)).toContain(claim.id);

      expect(said(await decide(claim.id, { decision: 'reject' }, hr).expect(400))).toEqual(['Write a comment: why the claim is rejected.']);
      expect(said(await decide(claim.id, { decision: 'reject', comment: '   ' }, hr).expect(400))).toEqual(['Write a comment: why the claim is rejected.']);
      const rejected = (await decide(claim.id, { decision: 'reject', comment: 'Paid by the company card' }, hr).expect(200)).body as Claim;
      expect(rejected).toMatchObject({ status: 'rejected', stage: null, rejectedStage: 'hr', rejectReason: 'Paid by the company card', approvedAmount: null, payroll: null });
      expect(rejected.steps.at(-1)).toMatchObject({ kind: 'hr_decision', decision: 'reject', amount: null, comment: 'Paid by the company card' });
      expect(said(await cancel(claim.id, nora).expect(409))).toEqual(["This claim is rejected, so it can't be cancelled."]);
      expect((await prisma.auditLog.findMany({ where: { entityType: 'reimbursement_claim', entityId: claim.id }, orderBy: { id: 'asc' } })).map((a) => a.action)).toEqual(['create', 'reject']);
    });

    it('nobody decides their own claim: HR’s own goes to another HR', async () => {
      const claim = (await send(hana, { typeId: travel.id, amount: 80 }, []).expect(201)).body as Claim;
      expect(claim).toMatchObject({ status: 'with_hr', waitingForYou: false, canCancel: true });
      expect(said(await decide(claim.id, { decision: 'approve' }, hana).expect(403))).toEqual(['Someone else has to decide your own claim.']);
      expect((await list(hana, '?status=waiting')).map((c) => c.id)).not.toContain(claim.id);
      expect((await list(hr, '?status=waiting')).map((c) => c.id)).toContain(claim.id);
      expect((await decide(claim.id, { decision: 'approve' }, hr).expect(200)).body).toMatchObject({ status: 'with_finance', approvedAmount: 80 });
      // the employee deciding their own, at their manager's stage
      const bens = (await send(ben, { typeId: travel.id, amount: 60 }, []).expect(201)).body as Claim;
      expect(said(await decide(bens.id, { decision: 'approve' }, ben).expect(403))).toEqual(['Someone else has to decide your own claim.']);
      // the CEO reads claims, never decides one
      expect(said(await decide(bens.id, { decision: 'approve' }, ceo).expect(403))).toEqual(["Only the claim's direct manager, HR and Finance decide a reimbursement claim."]);
      await cancel(bens.id, ben).expect(200);
    });

    it('the employee cancels their claim while it is open, only theirs and only then', async () => {
      const claim = (await send(ben, { typeId: travel.id, amount: 45 }, []).expect(201)).body as Claim;
      await cancel(claim.id, mona).expect(404);
      await cancel(claim.id, hr).expect(404);
      const cancelled = (await cancel(claim.id, ben).expect(200)).body as Claim;
      expect(cancelled).toMatchObject({ status: 'cancelled', stage: null, canCancel: false });
      expect(kinds(cancelled)).toEqual(['submitted', 'cancelled']);
      expect(said(await cancel(claim.id, ben).expect(409))).toEqual(["This claim is cancelled, so it can't be cancelled."]);
      expect(said(await decide(claim.id, { decision: 'approve' }, mona).expect(409))[0]).toMatch(/^This claim is cancelled, so there is nothing left to decide/);
      // a cancelled claim takes nothing of the caps
      expect((await myTypes(ben)).find((t) => t.id === travel.id)).toMatchObject({ usedInMonth: 0 });
    });
  });

  describe('who sees a claim and its receipts', () => {
    let claim: Claim;

    beforeAll(async () => {
      claim = (await send(ben, { typeId: travel.id, amount: 30, description: 'Parking' }, [
        [PNG, 'parking.png'],
        [PDF, 'إيصال.pdf'],
      ]).expect(201)).body;
    });

    it('is the employee, the manager it was sent to, HR, Finance and the CEO; nobody else finds it', async () => {
      for (const session of [ben, mona, hr, finance, ceo]) expect((await one(claim.id, session).expect(200)).body.id).toBe(claim.id);
      for (const session of [sam, ivy, nora, superAdmin]) expect(said(await one(claim.id, session).expect(404))).toEqual(['Reimbursement claim not found.']);
      for (const session of [sam, superAdmin]) await decide(claim.id, { decision: 'approve' }, session).expect(404);
    });

    it('downloads a receipt, inline with its type and name, for those who see the claim; each view in the audit log', async () => {
      const [png, pdf] = claim.receipts;
      const res = await api().get(`/api/reimbursements/${claim.id}/receipts/${png.id}`).set('Cookie', mona).expect(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-disposition']).toBe(`inline; filename="parking.png"; filename*=UTF-8''parking.png`);
      expect(Buffer.from(res.body as Buffer).equals(PNG)).toBe(true);
      const arabic = await api().get(`/api/reimbursements/${claim.id}/receipts/${pdf.id}`).set('Cookie', finance).expect(200);
      expect(arabic.headers['content-type']).toBe('application/pdf');
      expect(arabic.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('إيصال.pdf')}`);
      for (const session of [ben, hr, ceo]) await api().get(`/api/reimbursements/${claim.id}/receipts/${png.id}`).set('Cookie', session).expect(200);
      for (const session of [sam, ivy, superAdmin]) await api().get(`/api/reimbursements/${claim.id}/receipts/${png.id}`).set('Cookie', session).expect(404);
      // a receipt of another claim isn't this one's
      const mine = (await api().get('/api/me/reimbursements').set('Cookie', ben).expect(200)).body as Claim[];
      const other = mine.find((c) => c.receipts.length && c.id !== claim.id)!;
      await api().get(`/api/reimbursements/${claim.id}/receipts/${other.receipts[0].id}`).set('Cookie', hr).expect(404);
      expect(await prisma.auditLog.count({ where: { entityType: 'reimbursement_receipt', entityId: png.id, action: 'view_restricted' } })).toBe(4);
    });

    it('lists everyone’s for HR, Finance and the CEO; a manager the ones sent to them; nobody else any', async () => {
      for (const session of [hr, finance, ceo]) {
        const all = (await list(session, `?employeeId=${ids.ben}`)).map((c) => c.id);
        expect(all).toContain(claim.id);
      }
      const monas = await list(mona);
      expect(monas.length).toBeGreaterThan(0);
      expect(monas.every((c) => c.manager?.id === ids.mona)).toBe(true);
      expect(await list(sam)).toEqual([]);
      expect(await list(ben)).toEqual([]); // their own are under My Requests
      const approved = await list(hr, `?status=approved&employeeId=${ids.ben}`);
      expect(approved.map((c) => c.status)).toEqual(['approved']);
      await api().get('/api/reimbursements?status=unknown').set('Cookie', hr).expect(400);
    });
  });

  describe('turning a type off and deleting one', () => {
    it('HR turns a type off: no longer offered nor claimed; the claims sent stay', async () => {
      const off = (await patchType(travel.id, { active: false }).expect(200)).body as TypeView;
      expect(off).toMatchObject({ active: false });
      expect((await myTypes(nora)).map((t) => t.id)).not.toContain(travel.id);
      expect(said(await send(nora, { typeId: travel.id }, []).expect(400))).toEqual([`Travel ${RUN} is turned off, so it can't be claimed. Choose another type.`]);
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'reimbursement_type', entityId: travel.id, action: 'update' } });
      expect(audit.map((a) => a.diff)).toEqual([{ nameEn: `Travel ${RUN}`, active: { from: true, to: false } }]);
      // the ones on come first
      const types = (await api().get('/api/reimbursement-types').set('Cookie', hr).expect(200)).body as TypeView[];
      expect(types.findIndex((t) => t.id === mobile.id)).toBeLessThan(types.findIndex((t) => t.id === travel.id));
    });

    it('only a Super Admin deletes a type, and only one without claims', async () => {
      expect(said(await api().delete(`/api/reimbursement-types/${mobile.id}`).set('Cookie', superAdmin).expect(409))).toEqual([
        `Mobile ${RUN} has 1 claim, so it can't be deleted. Turn it off instead.`,
      ]);
      const unused = (await createType({ nameEn: `Unused ${RUN}`, nameAr: 'غير مستخدم' }).expect(201)).body as TypeView;
      expect(said(await api().delete(`/api/reimbursement-types/${unused.id}`).set('Cookie', hr).expect(403))).toEqual(['Only a Super Admin can delete records.']);
      await api().delete(`/api/reimbursement-types/${unused.id}`).set('Cookie', superAdmin).expect(204);
      expect(await prisma.reimbursementType.count({ where: { id: unused.id } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { entityType: 'reimbursement_type', entityId: unused.id, action: 'delete' } })).toBe(1);
    });
  });
});
