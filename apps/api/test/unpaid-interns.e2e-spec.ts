import type { INestApplication } from '@nestjs/common';
import type { PayrollResult, PayrollTerms } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, addMonths, todayInCairo, toDateOnly } from '../src/common/date-only.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { paragraphTexts, textParts } from '../src/templates/docx-tags.js';
import { readZip } from '../src/templates/zip.js';
import { docx, p, r } from './fixtures/docx.js';
import { createApp, createUser, signIn } from './helpers.js';

// The unpaid internship in payroll, leave, the documents, reimbursements and raises (owner, 19 October 2026: "in case
// of trainee, we are not paying them salary, its just transportation allowance. can i add the gross with 0?"): an
// intern's internship agreement pays no wage (the gross 0) and its allowances on top; outside the labour law, like
// freelance, so no social insurance, no salary tax or Martyrs' Fund, no leave and no raise; the owner's internship
// templates are the intern's, the paid trainee's have slots of their own. The interns and the trainee are put in the
// database as they would be hired, so these tests don't depend on the hiring forms. Months are counted from today in
// Cairo: the run is for last month. Everyone here is invented, and deleted at the end.

const RUN = `${Date.now().toString(36)}5`;
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
/** The run's month: last month. */
const MONTH = monthsLater(CURRENT, -1);
/** The agreements' start: well before the run's month. */
const JOINED = firstDay(monthsLater(CURRENT, -3));
const TRANSPORT = 1500;

interface Line {
  employeeId: string;
  employmentType: string;
  terms: PayrollTerms;
  result: PayrollResult;
}

interface Person {
  id: string;
  name: string;
  employmentId: string;
  contractId: string;
}

/** The printed text of a .docx: its paragraphs, in order, one per line. */
function textOf(file: Buffer): string {
  const zip = readZip(file);
  return textParts(zip.entries.map((e) => e.name))
    .flatMap((name) => paragraphTexts(zip.read(name)!.toString('utf8')))
    .join('\n');
}

describe('Unpaid interns (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let superAdmin: string;
  let internSession: string;
  let transportId: string;
  let intern: Person; // with a sign-in, flagged as registered with social insurance
  let trainee: Person; // a paid trainee, for the slots
  const api = () => request(app.getHttpServer());
  /** Everyone this file adds, deleted at the end with what was made for them. */
  const added: string[] = [];
  const versions: string[] = [];
  const reimbursementTypes: string[] = [];
  let n = 0;

  const messageOf = (res: request.Response) => res.body.message as string | string[];

  /** Someone hired as an intern (gross 0, the transportation allowance) or a trainee, signed, as the hiring forms would. */
  async function hired(name: string, type: 'intern' | 'trainee', workEmail?: string): Promise<Person> {
    const fullNameEn = `${name} ${RUN}`;
    const person = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn, fullNameAr: 'متدرب تجريبي' }).expect(201);
    added.push(person.body.id);
    if (workEmail) await prisma.employee.update({ where: { id: person.body.id }, data: { workEmail } });
    const employment = await prisma.employment.create({ data: { employeeId: person.body.id, employmentType: type, status: 'active', joinDate: toDateOnly(JOINED) } });
    const stages = [
      { name: 'Basics', months: 3, pay: 8000 },
      { name: 'Practice', months: 3, pay: 9000 },
    ];
    const contract = await prisma.contract.create({
      data: {
        number: `INT-${RUN}-${++n}`,
        employmentId: employment.id,
        version: 1,
        form: 'fixed',
        startDate: toDateOnly(JOINED),
        endDate: toDateOnly(addDays(addMonths(JOINED, 6), -1)),
        durationMonths: 6,
        probationMonths: 0,
        grossSalary: type === 'intern' ? 0 : 8000,
        insuredSalary: type === 'intern' ? 0 : 8000,
        payBasis: 'monthly',
        status: 'active',
        signedOn: toDateOnly(JOINED),
        ...(type === 'trainee' && { traineeStages: stages }),
        allowances: { create: [{ allowanceTypeId: transportId, nameEn: 'Transportation', nameAr: 'بدل انتقال', taxable: true, insured: false, amount: TRANSPORT }] },
      },
    });
    return { id: person.body.id, name: fullNameEn, employmentId: employment.id, contractId: contract.id };
  }

  /** A template uploaded and published by a Super Admin, who alone edits templates (owner, 19 October 2026). */
  async function publish(slot: string, body: string) {
    const upload = await api().post(`/api/templates/${slot}/versions`).set('Cookie', superAdmin).attach('file', docx({ body }), `${slot}.docx`).field('language', 'en').expect(201);
    versions.push(upload.body.id);
    await api().post(`/api/templates/versions/${upload.body.id}/publish`).set('Cookie', superAdmin).expect(200);
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    const internEmail = await createUser(prisma, ['employee']);
    internSession = await signIn(app, internEmail);
    await prisma.payrollRun.deleteMany();
    transportId = (await api().post('/api/allowance-types').set('Cookie', hr).send({ nameEn: `Transportation ${RUN}`, nameAr: 'بدل انتقال', taxable: true }).expect(201)).body.id;
    intern = await hired('Ilham Intern', 'intern', internEmail);
    await prisma.employee.update({ where: { id: intern.id }, data: { socialInsured: true } });
    trainee = await hired('Tarek Trainee', 'trainee');
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany();
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: added } } });
    await prisma.payrollAdvance.deleteMany({ where: { employeeId: { in: added } } });
    await prisma.employee.deleteMany({ where: { id: { in: added } } });
    await prisma.generatedDocument.deleteMany({ where: { templateVersionId: { in: versions } } });
    await prisma.templateVersion.deleteMany({ where: { id: { in: versions } } });
    await prisma.reimbursementType.deleteMany({ where: { id: { in: reimbursementTypes } } });
    await prisma.allowanceType.deleteMany({ where: { id: transportId } });
    await app.close();
  });

  describe('payroll', () => {
    it('pays an intern the transportation allowance alone: no salary, no social insurance, no tax or Martyrs’ Fund', async () => {
      const run = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: MONTH }).expect(201)).body as { lines: Line[] };
      const line = run.lines.find((l) => l.employeeId === intern.id)!;
      expect(line).toMatchObject({ employmentType: 'intern' });
      expect(line.terms).toMatchObject({
        gross: 0,
        statutory: false,
        insured: true,
        paidDays: 30,
        allowances: [{ name: 'Transportation', amount: TRANSPORT, taxable: true, insured: false }],
      });
      expect(line.result).toMatchObject({
        fixed: 0,
        variable: 0,
        earned: 0,
        allowances: TRANSPORT,
        insuredWage: 0,
        employeeInsurance: 0,
        employerInsurance: 0,
        monthlyTax: 0,
        martyrsFund: 0,
        deductions: 0,
        net: TRANSPORT,
        transfer: TRANSPORT,
        companyCost: TRANSPORT,
      });
      // a paid trainee under the law: the stage's pay, taxed
      const paid = run.lines.find((l) => l.employeeId === trainee.id)!;
      expect(paid.terms).toMatchObject({ gross: 8000, statutory: true });
      expect(paid.result.monthlyTax).toBeGreaterThan(0);
    });

    it('takes no installments from no wage: a plan, or a recovery by hand, is refused in plain words', async () => {
      const limit = (await api().get(`/api/payroll/advances/limit?employeeId=${intern.id}`).set('Cookie', hr).expect(200)).body;
      expect(limit).toEqual({ gross: 0, percent: 10, byMonth: {}, tax: 0, insurance: 0, recurring: [] });
      const advance = { employeeId: intern.id, kind: 'advance', amount: 600, givenOn: firstDay(CURRENT), reason: 'Invented advance' };
      expect(messageOf(await api().post('/api/payroll/advances').set('Cookie', hr).send({ ...advance, installments: { count: 3, firstMonth: CURRENT } }).expect(400))).toBe(
        'The current contract pays no wage (an unpaid internship), so there is no pay to take installments of advances and loans from: record it without installments, to be paid back otherwise.',
      );
      expect(await prisma.payrollAdvance.count({ where: { employeeId: intern.id } })).toBe(0);
      // recorded without installments, it isn't recovered by hand either
      const given = (await api().post('/api/payroll/advances').set('Cookie', hr).send(advance).expect(201)).body as { id: string };
      const recovery = { employeeId: intern.id, month: CURRENT, kind: 'deduction', type: 'advance_recovery', amount: 200, reason: 'Invented recovery', advanceId: given.id };
      expect(messageOf(await api().post('/api/payroll/adjustments').set('Cookie', hr).send(recovery).expect(400))).toBe(
        'The current contract pays no wage (an unpaid internship), so there is no pay to take installments of advances and loans from: settle the advance or loan as paid back otherwise.',
      );
      await api().post(`/api/payroll/advances/${given.id}/settle`).set('Cookie', hr).send({ how: 'paid_back', note: 'Invented: paid in cash' }).expect(200);
    });
  });

  describe('leave', () => {
    it('has no annual leave, and no leave to ask for or record', async () => {
      const leave = (await api().get(`/api/employees/${intern.id}/leave`).set('Cookie', hr).expect(200)).body as { annual: { entitlement: number; available: number } };
      expect(leave.annual).toMatchObject({ entitlement: 0, available: 0 });
      const annual = await prisma.leaveType.findUniqueOrThrow({ where: { key: 'annual' }, select: { id: true } });
      const start = addDays(TODAY, 14);
      const recorded = await api()
        .post('/api/leave/requests')
        .set('Cookie', hr)
        .field('employeeId', intern.id)
        .field('typeId', annual.id)
        .field('startDate', start)
        .field('endDate', start)
        .expect(400);
      expect(messageOf(recorded)).toEqual([`${intern.name} is an unpaid intern, outside the labour law: there is no leave to record for an unpaid internship.`]);
      const asked = await api().post('/api/me/leave/requests').set('Cookie', internSession).field('typeId', annual.id).field('startDate', start).field('endDate', start).expect(400);
      expect(messageOf(asked)).toEqual(['You are an unpaid intern, outside the labour law: there is no leave to ask for under an unpaid internship.']);
      expect(await prisma.leaveRequest.count({ where: { employeeId: intern.id } })).toBe(0);
    });
  });

  describe('the documents', () => {
    const tab = async (id: string) => {
      const res = (await api().get(`/api/employees/${id}/documents`).set('Cookie', hr).expect(200)).body as { sections: { key: string; items: { slotKey: string; name: string }[] }[] };
      return Object.fromEntries(res.sections.map((s) => [s.key, s.items.map((i) => i.slotKey)]));
    };

    it('offer an intern the owner’s internship agreement and offer, a trainee their own; the certificate to both', async () => {
      expect(await tab(intern.id)).toEqual({
        contract: ['contract_internship'],
        hiring: ['offer_internship', 'nda'],
        insurance: [],
        letters: ['bank_letter', 'hr_letter_ar', 'hr_letter_en', 'cert_experience', 'cert_internship'],
        leaving: [],
      });
      expect(await tab(trainee.id)).toMatchObject({ contract: ['contract_trainee'], hiring: ['offer_trainee', 'nda'], insurance: [] });
      expect((await tab(trainee.id)).letters).toContain('cert_internship');

      const check = (who: Person, slotKey: string) => api().get(`/api/employees/${who.id}/documents/check`).query({ slotKey, contractId: who.contractId }).set('Cookie', hr);
      expect(messageOf(await check(intern, 'contract_trainee').expect(400))).toBe(
        `Training agreement · Trainee is for trainee employments; ${intern.name}’s is unpaid internship (outside the labour law). Choose the document for an unpaid internship (outside the labour law) employment.`,
      );
      expect(messageOf(await check(trainee, 'contract_internship').expect(400))).toBe(
        `Internship agreement · Unpaid internship is for unpaid internship (outside the labour law) employments; ${trainee.name}’s is trainee. Choose the document for a trainee employment.`,
      );
    });

    it('print the intern’s type, the gross as 0 and the transportation allowance on the internship agreement', async () => {
      await publish('contract_internship', [p(r('{{full_name_en}}')), p(r('{{employment_type_en}}')), p(r('{{gross_salary}}')), p(r('{{allowances_en}}'))].join(''));
      expect((await api().get(`/api/employees/${intern.id}/documents/check`).query({ slotKey: 'contract_internship', contractId: intern.contractId }).set('Cookie', hr).expect(200)).body).toEqual({
        missing: [],
        usesRestricted: true,
      });
      const made = (await api().post(`/api/employees/${intern.id}/documents`).set('Cookie', hr).send({ slotKey: 'contract_internship', contractId: intern.contractId }).expect(201)).body as { id: string };
      const kept = await prisma.generatedDocument.findUniqueOrThrow({ where: { id: made.id }, select: { data: true } });
      expect(textOf(Buffer.from(kept.data))).toBe([intern.name, 'Unpaid internship (outside the labour law)', '0', 'Transportation: 1,500'].join('\n'));
    });
  });

  describe('reimbursement types', () => {
    it('may be for interns: offered to an intern, not one for trainees only', async () => {
      const create = (employmentTypes: string[]) =>
        api().post('/api/reimbursement-types').set('Cookie', hr).send({ nameEn: `Interns ${RUN} ${employmentTypes.join(' ')}`, nameAr: 'نوع', employmentTypes });
      const forInterns = (await create(['intern']).expect(201)).body as { id: string; employmentTypes: string[] };
      const forTrainees = (await create(['trainee']).expect(201)).body as { id: string };
      reimbursementTypes.push(forInterns.id, forTrainees.id);
      expect(forInterns.employmentTypes).toEqual(['intern']);
      const mine = ((await api().get('/api/me/reimbursement-types').set('Cookie', internSession).expect(200)).body as { id: string }[]).map((t) => t.id);
      expect(mine).toContain(forInterns.id);
      expect(mine).not.toContain(forTrainees.id);
      expect(messageOf(await create(['interns']).expect(400))).toEqual(['Choose the employment types from: full_time, part_time, trainee, intern, freelance; [] for every employment type.']);
    });
  });

  describe('raises', () => {
    it('are refused for an intern: there is no wage to raise', async () => {
      const raise = await api()
        .post(`/api/employees/${intern.id}/employments/${intern.employmentId}/raises`)
        .set('Cookie', hr)
        .send({ way: 'amendment', effectiveDate: firstDay(monthsLater(CURRENT, 1)), grossSalary: 5000, reason: 'annual' })
        .expect(400);
      expect(messageOf(raise)).toBe(
        'An intern is paid no wage (an unpaid internship, outside the labour law): there is no pay to raise. To pay a salary, convert the internship agreement to a full-time contract.',
      );
      expect(await prisma.contract.count({ where: { employmentId: intern.employmentId } })).toBe(1);
    });

    it('are refused when asked for an intern, not only when HR would prepare one', async () => {
      const asked = await api()
        .post(`/api/employees/${intern.id}/raise-requests`)
        .set('Cookie', hr)
        .send({ effectiveFrom: firstDay(monthsLater(CURRENT, 1)), raiseReason: 'annual', comment: 'Asked for an intern' })
        .expect(409);
      expect(messageOf(asked)).toMatch(/is an intern, paid no wage \(an unpaid internship\): there is no pay to raise\./);
      expect(await prisma.raiseRequest.count({ where: { employeeId: intern.id } })).toBe(0);
    });
  });
});
