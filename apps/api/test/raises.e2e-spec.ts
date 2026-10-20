import type { INestApplication } from '@nestjs/common';
import { firstJanuaryFrom, insuredSalary, lawRatesFor, nextFirstOfMonth, type PayrollTerms } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, addMonths, todayInCairo } from '../src/common/date-only.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { paragraphTexts, textParts } from '../src/templates/docx-tags.js';
import { readZip } from '../src/templates/zip.js';
import { docx, p, r } from './fixtures/docx.js';
import { createApp, createUser, signIn } from './helpers.js';

// Pay raises during a contract (owner's decisions, 16 October 2026): both ways (an amendment, a new contract), HR then
// the CEO (send, return, send again, approve, sign; decline), a renewal with new pay going the same way, the promotion,
// payroll before and after with the insured wage until January or the Form 2 date, the documents, the salary history,
// and the CEO's decisions with a comment (17 October 2026; raise requests are in raise-requests.e2e-spec.ts). Since 19
// October 2026 ("when a raise request was sent to the CEO, is showed in approvals not raise requests, and after
// approved, it was not shown in the raise request history too") each of these raises has its request, prepared directly
// by HR, following it at every step on Raise Requests; and the CEO may change a raise's reason when approving it ("i
// might want to ammend the raise reason, not only the money"). Dates are counted from today in Cairo: the amendment
// takes effect on this month's 1st. Everything made here is deleted at the end. Every name and amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const today = todayInCairo();
const CURRENT = today.slice(0, 7);
const PREVIOUS = monthsLater(CURRENT, -1);
const NEXT = monthsLater(CURRENT, 1);
/** Hired four months ago: the contract in force since then, for 12 months. */
const JOINED = firstDay(monthsLater(CURRENT, -4));
/** The amendment takes effect on this month's 1st; its insured wage from the next 1 January. */
const EFFECTIVE = firstDay(CURRENT);
const JANUARY = firstJanuaryFrom(EFFECTIVE);
/** The new contract from next month's 1st. */
const NEXT_EFFECTIVE = nextFirstOfMonth(today);
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

interface Contract {
  id: string;
  number: string;
  version: number;
  kind: string;
  status: string;
  stage: string;
  startDate: string;
  endDate: string | null;
  durationMonths: number | null;
  probationMonths: number;
  grossSalary: number | null;
  jobTitleEn: string | null;
  gradeCode: string | null;
  raise: {
    reason: string;
    approval: string;
    returnedReason: string | null;
    approvedBy: { email: string } | null;
    newJobTitle: { id: string; titleEn: string } | null;
    newGrade: { id: string; code: string } | null;
    form2From: string | null;
    insuredWageFrom: string;
    requestId: string | null;
    requestOrigin: string | null;
  } | null;
  [key: string]: unknown;
}

/** A raise request as HR, Finance and the CEO see it on Raise Requests. */
interface RaiseRequest {
  id: string;
  origin: string;
  requester: string;
  status: string;
  requestedBy: { email: string } | null;
  raiseReason: string | null;
  comment: string;
  effectiveFrom: string | null;
  suggestion: { kind: string; amount: number | null; percent: number | null; gross: number | null } | null;
  raise: { contractId: string; number: string; way: string; change: string; stage: string; previousGross: number | null; newGross: number | null } | null;
  decision: { stage: string; reason: string | null } | null;
  steps: { kind: string; decision: string | null; raiseReason: string | null; raiseReasonFrom: string | null; comment: string | null; increaseAmount: number | null; increasePercent: number | null; gross: number | null; contractNumber: string | null; by: { email: string } | null }[];
}

/** A request's steps, a decision with it: "ceo_decision:approve". */
const kinds = (q: RaiseRequest) => q.steps.map((s) => (s.decision ? `${s.kind}:${s.decision}` : s.kind));

interface Person {
  id: string;
  employmentId: string;
  employeeCode: string;
}

/** The printed text of a .docx: its paragraphs, in order, one per line. */
function textOf(file: Buffer): string {
  const zip = readZip(file);
  return textParts(zip.entries.map((e) => e.name))
    .flatMap((name) => paragraphTexts(zip.read(name)!.toString('utf8')))
    .join('\n');
}

describe('Pay raises (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrEmail: string;
  let ceo: string;
  let ceoEmail: string;
  let finance: string;
  let superAdmin: string;
  let manager: string; // Mona, Ben's direct manager
  let ben: string; // Ben's own sign-in
  let emailDomainBefore: string | null;
  let departmentId: string;
  let accountant: string; // job title, grades G3 to G5
  let senior: string; // job title, grades G4 to G6
  let grades: Record<string, string>;
  let transport: string;
  const people: string[] = [];
  const titles: string[] = [];
  const api = () => request(app.getHttpServer());

  // the people
  let amy: Person; // an amendment raise with a promotion
  let benP: Person; // a new contract, the CEO's decisions
  let cara: Person; // a renewal with new pay
  let monaId: string;
  let amyV1: Contract;

  async function employee(name: string, profile: Record<string, unknown> = {}) {
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', ...profile }).expect(201);
    people.push(res.body.id);
    return res.body as { id: string; employeeCode: string };
  }

  async function hire(name: string, employment: Record<string, unknown> = {}, profile: Record<string, unknown> = {}): Promise<Person> {
    const e = await employee(name, profile);
    const hired = await api()
      .post(`/api/employees/${e.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: JOINED, departmentId, jobTitleId: accountant, gradeId: grades.G3, ...employment })
      .expect(201);
    return { id: e.id, employeeCode: e.employeeCode, employmentId: hired.body.employment.id };
  }

  const contractsOf = (e: Person, session = hr) => api().get(`/api/employees/${e.id}/employments/${e.employmentId}/contracts`).set('Cookie', session);
  const postContract = (e: Person, body: object, session = hr) => api().post(`/api/employees/${e.id}/employments/${e.employmentId}/contracts`).set('Cookie', session).send(body);
  const sign = (id: string, session = hr) => api().post(`/api/contracts/${id}/sign`).set('Cookie', session).send({ signedOn: today });
  const postRaise = (e: Person, body: object, session = hr) => api().post(`/api/employees/${e.id}/employments/${e.employmentId}/raises`).set('Cookie', session).send(body);
  const patchRaise = (id: string, body: object, session = hr) => api().patch(`/api/raises/${id}`).set('Cookie', session).send(body);
  const step = (id: string, action: 'send' | 'approve' | 'return' | 'decline', session: string, body: object = {}) => api().post(`/api/raises/${id}/${action}`).set('Cookie', session).send(body);
  const form2 = (id: string, form2From: string | null, session = hr) => api().patch(`/api/raises/${id}/form2`).set('Cookie', session).send({ form2From });
  const auditOf = (entityType: string, entityId: string) => prisma.auditLog.findMany({ where: { entityType, entityId }, orderBy: { id: 'asc' } });
  /** Raise Requests, of a status unless all, as `session` sees it (HR unless said). */
  const requests = async (status = '', session = hr) => (await api().get(`/api/raise-requests${status ? `?status=${status}` : ''}`).set('Cookie', session).expect(200)).body as RaiseRequest[];
  const requestOf = async (id: string, session = hr) => (await requests('', session)).find((q) => q.id === id)!;
  /** The request a raise has, from the raise. */
  const requestFor = async (raise: Contract) => requestOf(raise.raise!.requestId!);

  async function signedContract(e: Person, body: object): Promise<Contract> {
    const draft = (await postContract(e, body).expect(201)).body as Contract;
    return (await sign(draft.id).expect(200)).body as Contract;
  }

  /** The person's line on a month's run, made afresh. */
  async function lineOn(month: string, e: Person) {
    await prisma.payrollRun.deleteMany({ where: { month: new Date(`${month}-01T00:00:00Z`) } });
    const run = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month }).expect(201)).body as { id: string; lines: { employeeId: string; terms: PayrollTerms }[] };
    return { run, line: run.lines.find((l) => l.employeeId === e.id)! };
  }

  const insured = (total: number, month: string) => insuredSalary(total, lawRatesFor(Number(month.slice(0, 4))));

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    ceoEmail = await createUser(prisma, ['ceo']);
    ceo = await signIn(app, ceoEmail);
    finance = await signIn(app, await createUser(prisma, ['finance']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    const managerEmail = await createUser(prisma, ['manager']);
    manager = await signIn(app, managerEmail);
    const benEmail = await createUser(prisma, ['employee']);
    ben = await signIn(app, benEmail);
    await prisma.payrollRun.deleteMany({ where: { month: { in: [PREVIOUS, CURRENT, NEXT].map((m) => new Date(`${m}-01T00:00:00Z`)) } } });

    // sign-in accounts here are @test.local: no company email domain while these tests run
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);

    departmentId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Raises ${RUN}` }).expect(201)).body.id;
    grades = Object.fromEntries(((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).map((g) => [g.code, g.id]));
    accountant = (await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId, titleEn: 'Accountant', titleAr: 'محاسب', minGradeId: grades.G3, maxGradeId: grades.G5 }).expect(201)).body.id;
    senior = (await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId, titleEn: 'Senior Accountant', titleAr: 'محاسب أول', minGradeId: grades.G4, maxGradeId: grades.G6 }).expect(201)).body.id;
    titles.push(accountant, senior);
    transport = (await api().post('/api/allowance-types').set('Cookie', hr).send({ nameEn: `Transport ${RUN}`, nameAr: 'بدل انتقال', taxable: true }).expect(201)).body.id;

    // the CEO's own profile, so the approval names them; Ben's manager Mona
    await employee('Chief Officer', { workEmail: ceoEmail });
    monaId = (await employee('Mona Manager', { workEmail: managerEmail })).id;

    amy = await hire('Amy Amended');
    amyV1 = await signedContract(amy, { grossSalary: 10000, allowances: [{ allowanceTypeId: transport, amount: 500 }] });
    benP = await hire('Ben Raised', { managerId: monaId }, { workEmail: benEmail });
    await signedContract(benP, { grossSalary: 9000 });
    cara = await hire('Cara Renewed');
    await signedContract(cara, { grossSalary: 8000 });
  });

  afterAll(async () => {
    // runs keep their people on record, documents their template versions: those go first, then the people with their
    // employments, contracts, requests and documents, then what they used
    await prisma.payrollRun.deleteMany({ where: { month: { in: [PREVIOUS, CURRENT, NEXT].map((m) => new Date(`${m}-01T00:00:00Z`)) } } });
    await prisma.generatedDocument.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.templateVersion.deleteMany({ where: { slotKey: 'contract_amendment' } });
    // the employments first: one reports to another of these people
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.jobTitle.deleteMany({ where: { id: { in: titles } } });
    if (departmentId) await prisma.department.deleteMany({ where: { id: departmentId } });
    if (transport) await prisma.allowanceType.deleteMany({ where: { id: transport } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('an amendment, HR then the CEO', () => {
    let raise: Contract;
    const body = () => ({
      way: 'amendment',
      effectiveDate: EFFECTIVE,
      reason: 'promotion',
      grossSalary: 12500,
      allowances: [{ allowanceTypeId: transport, amount: 700 }],
      newJobTitleId: senior,
      newGradeId: grades.G5,
      note: 'Promoted after the audit season',
    });

    it('HR only enters it; on the 1st of a month within the term; new pay; a grade the new job title takes', async () => {
      for (const session of [ceo, finance, manager, ben]) await postRaise(amy, body(), session).expect(403);
      expect((await postRaise(amy, { ...body(), effectiveDate: addDays(EFFECTIVE, 1) }).expect(400)).body.message).toMatch(/1st of a month/);
      expect((await postRaise(amy, { ...body(), effectiveDate: JOINED }).expect(400)).body.message).toBe(
        `The contract in force started on ${shown(JOINED)}: a raise takes effect on a later 1st of a month.`,
      );
      const after = firstDay(monthsLater(amyV1.endDate!.slice(0, 7), 1));
      expect((await postRaise(amy, { ...body(), effectiveDate: after }).expect(400)).body.message).toMatch(/is a renewal with the new pay/);
      expect((await postRaise(amy, { ...body(), grossSalary: 10000, allowances: [{ allowanceTypeId: transport, amount: 500 }] }).expect(400)).body.message).toBe(
        'The new pay is the same as now: a raise changes the pay. A promotion alone is changed on the employment.',
      );
      expect((await postRaise(amy, { ...body(), newGradeId: grades.G3 }).expect(400)).body.message).toBe('Senior Accountant takes grades G4 to G6. Choose a grade in that range.');
      await postRaise(amy, { ...body(), reason: 'bonus' }).expect(400);
    });

    it('is a draft version: the contract’s number with -A1, its term and end, no probation, with the CEO’s step to come', async () => {
      raise = (await postRaise(amy, body()).expect(201)).body as Contract;
      expect(raise).toMatchObject({
        number: `${amyV1.number}-A1`,
        version: 2,
        kind: 'amendment',
        status: 'draft',
        stage: 'draft',
        startDate: EFFECTIVE,
        endDate: amyV1.endDate,
        durationMonths: null,
        probationMonths: 0,
        grossSalary: 12500,
        raise: {
          reason: 'promotion',
          approval: 'draft',
          returnedReason: null,
          newJobTitle: { id: senior, titleEn: 'Senior Accountant' },
          newGrade: { id: grades.G5, code: 'G5' },
          form2From: null,
          insuredWageFrom: JANUARY,
          // its request, prepared directly by HR (19 October 2026)
          requestId: expect.any(String),
          requestOrigin: 'direct',
        },
      });
      // the salary only as changed in the audit log, as for contracts
      const [created] = await auditOf('contract', raise.id);
      expect(created.diff).toMatchObject({ way: 'amendment', replaces: amyV1.number, grossSalary: 'changed', allowances: 'changed', raiseReason: 'promotion', approval: 'draft' });
    });

    it('is on Raise Requests at once: prepared directly by HR, with HR, its reason, note, raise and date, logged as prepared', async () => {
      const q = await requestFor(raise);
      expect(q).toMatchObject({
        origin: 'direct',
        requester: 'hr',
        requestedBy: { email: hrEmail },
        status: 'with_hr',
        raiseReason: 'promotion',
        comment: 'Promoted after the audit season',
        effectiveFrom: EFFECTIVE,
        suggestion: { kind: 'amount', amount: 2500, percent: null, gross: 12500 },
        raise: { contractId: raise.id, number: raise.number, way: 'amendment', change: 'amendment', stage: 'draft', previousGross: 10000, newGross: 12500 },
      });
      expect(kinds(q)).toEqual(['prepared']);
      expect(q.steps[0]).toMatchObject({ raiseReason: 'promotion', comment: 'Promoted after the audit season', increaseAmount: 2500, increasePercent: 25, gross: 12500, contractNumber: raise.number, by: { email: hrEmail } });
      expect((await requests('with_hr')).map((x) => x.id)).toContain(q.id);
      // the request in the audit log, the amount only as set
      expect((await auditOf('raise_request', q.id))[0]).toMatchObject({ action: 'create', diff: { origin: 'direct', contract: raise.number, status: 'with_hr', suggestedIncrease: 'set' } });
      expect(JSON.stringify((await auditOf('raise_request', q.id))[0].diff)).not.toContain('2500');
      // nobody asked for it: HR doesn't reject it, nor prepare another raise from it
      expect((await api().post(`/api/raise-requests/${q.id}/decline`).set('Cookie', hr).send({ comment: 'No' }).expect(409)).body.message).toMatch(/prepared this raise directly/);
      await api().post(`/api/raise-requests/${q.id}/approve`).set('Cookie', hr).send({ decision: 'approve', comment: 'x', way: 'amendment', effectiveDate: EFFECTIVE }).expect(409);
    });

    it('one at a time; not signed before the CEO approves; hidden from those who don’t see salaries until signed', async () => {
      expect((await postRaise(amy, body()).expect(409)).body.message).toBe(`Version 2 (${raise.number}) is still a draft. Sign or delete it before adding a raise.`);
      await postContract(amy, { grossSalary: 10000 }).expect(409);
      expect((await sign(raise.id).expect(409)).body.message).toBe(`${raise.number} changes the pay: send it to the CEO, and sign it once approved.`);
      expect((await api().patch(`/api/contracts/${raise.id}`).set('Cookie', hr).send({ grossSalary: 13000 }).expect(400)).body.message).toBe(
        `${raise.number} is a salary amendment: change it as a raise (Edit raise).`,
      );
    });

    it('HR sends it; only the CEO approves, returns or declines; it can’t change while with the CEO', async () => {
      await step(raise.id, 'send', ceo).expect(403);
      expect((await step(raise.id, 'send', hr).expect(200)).body).toMatchObject({ stage: 'pending_ceo', raise: { approval: 'pending_ceo' } });
      expect((await step(raise.id, 'send', hr).expect(409)).body.message).toBe(`${raise.number} is with the CEO, so it can't be sent to the CEO.`);
      for (const action of ['approve', 'return', 'decline'] as const) await step(raise.id, action, hr, { reason: 'x' }).expect(403);
      expect((await patchRaise(raise.id, { grossSalary: 13000 }).expect(409)).body.message).toBe(`${raise.number} is with the CEO: it can't be changed unless the CEO returns it.`);
      expect((await sign(raise.id).expect(409)).body.message).toBe(`${raise.number} is with the CEO: it is signed once the CEO approves it.`);
      // on the CEO's list of what waits, with the pay it replaces
      const pending = (await api().get('/api/raises/pending').set('Cookie', ceo).expect(200)).body as { id: string; change: string; previous: { grossSalary: number } }[];
      expect(pending.find((x) => x.id === raise.id)).toMatchObject({ change: 'amendment', previous: { grossSalary: 10000 } });
      await api().get('/api/raises/pending').set('Cookie', finance).expect(403);
      // and on Raise Requests, with the CEO: the one place for every raise
      const q = await requestFor(raise);
      expect(q).toMatchObject({ status: 'with_ceo', raise: { stage: 'pending_ceo' } });
      expect(kinds(q)).toEqual(['prepared', 'sent']);
      expect((await requests('with_ceo', ceo)).map((x) => x.id)).toContain(q.id);
    });

    it('the CEO returns it with a reason; HR changes it and sends it again; the CEO approves it', async () => {
      await step(raise.id, 'return', ceo, {}).expect(400);
      const returned = (await step(raise.id, 'return', ceo, { reason: 'Keep it within the band' }).expect(200)).body as Contract;
      expect(returned).toMatchObject({ stage: 'returned', raise: { approval: 'draft', returnedReason: 'Keep it within the band' } });
      expect(await requestFor(raise)).toMatchObject({ status: 'with_hr', raise: { stage: 'returned' } });
      const changed = (await patchRaise(raise.id, { grossSalary: 12000 }).expect(200)).body as Contract;
      expect(changed).toMatchObject({ grossSalary: 12000, stage: 'returned', number: raise.number });
      // its request follows what HR changed
      expect((await requestFor(raise)).suggestion).toEqual({ kind: 'amount', amount: 2000, percent: null, gross: 12000 });
      await step(raise.id, 'send', hr).expect(200);
      // always with a comment (owner, 17 October 2026)
      await step(raise.id, 'approve', ceo).expect(400);
      const approved = (await step(raise.id, 'approve', ceo, { comment: 'Agreed' }).expect(200)).body as Contract;
      expect(approved).toMatchObject({ stage: 'approved', raise: { approval: 'approved', returnedReason: null, approvedBy: { email: ceoEmail } } });
      expect((await auditOf('contract', raise.id)).map((a) => a.action)).toEqual(['create', 'submit', 'return', 'update', 'submit', 'approve']);
      // approved: in the history on Raise Requests, every step logged
      const q = await requestFor(raise);
      expect(q).toMatchObject({ status: 'approved', raise: { stage: 'approved' } });
      expect(kinds(q)).toEqual(['prepared', 'sent', 'returned', 'sent', 'ceo_decision:approve']);
      expect(q.steps[2]).toMatchObject({ comment: 'Keep it within the band', by: { email: ceoEmail } });
      expect(q.steps[4]).toMatchObject({ comment: 'Agreed', raiseReason: null, raiseReasonFrom: null, increaseAmount: 2000, gross: 12000, by: { email: ceoEmail } });
      expect((await requests('approved')).map((x) => x.id)).toContain(q.id);
    });

    it('its salary amendment letter and Form 2 are listed once approved; the letter is generated from its template', async () => {
      const tab = (await api().get(`/api/employees/${amy.id}/documents`).set('Cookie', hr).expect(200)).body as { sections: { key: string; items: { slotKey: string; contractId?: string; templateStatus: string }[] }[] };
      const items = (key: string) => tab.sections.find((s) => s.key === key)!.items;
      expect(items('contract').filter((i) => i.contractId === raise.id).map((i) => [i.slotKey, i.templateStatus])).toEqual([['contract_amendment', 'missing']]);
      expect(items('contract').filter((i) => i.contractId === amyV1.id).map((i) => i.slotKey)).toEqual(['contract_full_time', 'contract_full_time_insurance']);
      expect(items('insurance').filter((i) => i.slotKey === 'insurance_form_2').map((i) => i.contractId)).toEqual([raise.id]);

      // until the owner uploads it, generating says so
      const missing = await api().post(`/api/employees/${amy.id}/documents`).set('Cookie', hr).send({ slotKey: 'contract_amendment', contractId: raise.id }).expect(409);
      expect(missing.body.message).toBe('There is no published template for Salary amendment (ملحق عقد). Upload it in Templates first.');

      const file = docx({ body: p(r('{{amended_contract_number}} / {{contract_number}}: {{previous_gross_salary}} → {{gross_salary}} من {{raise_effective_date}} ({{raise_reason_en}}) {{new_job_title_en}} {{new_grade}}')) });
      // by a Super Admin, who alone edits templates (owner, 19 October 2026)
      const upload = await api().post('/api/templates/contract_amendment/versions').set('Cookie', superAdmin).field('language', 'ar').attach('file', file, 'amendment.docx').expect(201);
      await api().post(`/api/templates/versions/${upload.body.id}/publish`).set('Cookie', superAdmin).expect(200);
      // a whole contract's version takes its contract copies, not the letter
      expect((await api().post(`/api/employees/${amy.id}/documents`).set('Cookie', hr).send({ slotKey: 'contract_amendment', contractId: amyV1.id }).expect(400)).body.message).toMatch(
        /is a whole contract/,
      );
      const made = await api().post(`/api/employees/${amy.id}/documents`).set('Cookie', hr).send({ slotKey: 'contract_amendment', contractId: raise.id }).expect(201);
      const data = Buffer.from((await prisma.generatedDocument.findUniqueOrThrow({ where: { id: made.body.id }, select: { data: true } })).data);
      expect(textOf(data)).toBe(`${amyV1.number} / ${raise.number}: 10,000 → 12,000 من ${shown(EFFECTIVE)} (Promotion) Senior Accountant G5`);
    });

    it('signing replaces the version in force from the effective date and applies the promotion to the employment', async () => {
      const signed = (await sign(raise.id).expect(200)).body as Contract;
      expect(signed).toMatchObject({ status: 'active', stage: 'signed', jobTitleEn: 'Senior Accountant', gradeCode: 'G5' });
      // signed, it never changes
      expect((await patchRaise(raise.id, { grossSalary: 15000 }).expect(409)).body.message).toBe(`${raise.number} is signed, so it isn't changed. For other terms, add a new version.`);
      await step(raise.id, 'send', hr).expect(409);
      const versions = (await contractsOf(amy).expect(200)).body as Contract[];
      expect(versions.map((v) => [v.version, v.status])).toEqual([
        [2, 'active'],
        [1, 'superseded'],
      ]);
      const profile = (await api().get(`/api/employees/${amy.id}`).set('Cookie', hr).expect(200)).body as { employment: { jobTitleId: string; gradeId: string } };
      expect(profile.employment).toMatchObject({ jobTitleId: senior, gradeId: grades.G5 });
      // done, in the history
      const q = await requestFor(raise);
      expect(q).toMatchObject({ status: 'done', raise: { stage: 'signed', newGross: 12000 } });
      expect(kinds(q).at(-1)).toBe('signed');
      expect((await requests('done')).map((x) => x.id)).toContain(q.id);
      const employmentAudit = await prisma.auditLog.findFirst({ where: { entityType: 'employment', entityId: amy.employmentId, action: 'update' }, orderBy: { id: 'desc' } });
      expect(employmentAudit!.diff).toMatchObject({ contract: raise.number, jobTitleId: { from: accountant, to: senior }, gradeId: { from: grades.G3, to: grades.G5 } });
    });

    it('the Social Insurance tab: the insured wage as before the raise until January, saying so; the employee’s own wage stands', async () => {
      const tab = async () => (await api().get(`/api/employees/${amy.id}`).set('Cookie', hr).expect(200)).body as { insuredWage: { amount: number; comprehensive: number }; insuredWageAsBefore: unknown };
      const year = today.slice(0, 7);
      if (EFFECTIVE === JANUARY) {
        expect(await tab()).toMatchObject({ insuredWage: { comprehensive: 12700, amount: insured(12700, year) }, insuredWageAsBefore: null });
      } else {
        expect(await tab()).toMatchObject({ insuredWage: { comprehensive: 10500, amount: insured(10500, year) }, insuredWageAsBefore: { until: JANUARY, form2Filed: false } });
      }
      // the employee's own comprehensive wage wins, raise or not
      await api().patch(`/api/employees/${amy.id}`).set('Cookie', hr).send({ insuranceComprehensiveWage: 11000 }).expect(200);
      expect(await tab()).toMatchObject({ insuredWage: { comprehensive: 11000 }, insuredWageAsBefore: null });
      await api().patch(`/api/employees/${amy.id}`).set('Cookie', hr).send({ insuranceComprehensiveWage: null }).expect(200);
      // salary data: not for those who don't see salaries, the employee themself included
      expect((await api().get(`/api/employees/${benP.id}`).set('Cookie', ben).expect(200)).body).not.toHaveProperty('insuredWageAsBefore');
    });

    it('payroll: the version before until the raise’s 1st, the raise from then; the insured wage as before until January', async () => {
      const before = await lineOn(PREVIOUS, amy);
      expect(before.line).toMatchObject({ terms: { gross: 10000, insuredWage: insured(10500, PREVIOUS) } });
      expect(before.line.terms.insuredWageAsBefore).toBeUndefined();

      const after = await lineOn(CURRENT, amy);
      expect(after.line).toMatchObject({ terms: { gross: 12000 } });
      if (EFFECTIVE === JANUARY) {
        // a raise from 1 January counts for the insured wage at once
        expect(after.line.terms.insuredWage).toBe(insured(12700, CURRENT));
      } else {
        expect(after.line.terms).toMatchObject({ insuredWage: insured(10500, CURRENT), insuredWageAsBefore: JANUARY });
      }
    });

    it('Form 2 filed: the insured wage follows the new pay from its date (a 1st of a month, from the effective date up to January)', async () => {
      expect((await form2(raise.id, addDays(NEXT_EFFECTIVE, 1)).expect(400)).body.message).toMatch(/1st of a month/);
      expect((await form2(raise.id, firstDay(PREVIOUS)).expect(400)).body.message).toBe(`Form 2 can't change the insured wage before the raise takes effect, on ${shown(EFFECTIVE)}.`);
      await form2(raise.id, NEXT_EFFECTIVE, ceo).expect(403);
      const date = NEXT_EFFECTIVE <= JANUARY ? NEXT_EFFECTIVE : JANUARY;
      const filed = (await form2(raise.id, date).expect(200)).body as Contract;
      expect(filed.raise).toMatchObject({ form2From: date, insuredWageFrom: date });
      // the tab says Form 2 is filed, and the insured wage stays as before until its date (next month)
      if (EFFECTIVE !== JANUARY) {
        const tab = (await api().get(`/api/employees/${amy.id}`).set('Cookie', hr).expect(200)).body as { insuredWageAsBefore: unknown };
        expect(tab.insuredWageAsBefore).toEqual({ until: date, form2Filed: true });
      }
      const next = await lineOn(NEXT, amy);
      expect(next.line.terms).toMatchObject({ gross: 12000, insuredWage: insured(12700, NEXT) });
      expect(next.line.terms.insuredWageAsBefore).toBeUndefined();
      expect((await auditOf('contract', raise.id)).at(-1)!.diff).toMatchObject({ form2From: { from: null, to: date } });
    });

    it('the salary history: the hire and the raise, the summary; HR, Finance and the CEO only, documents for HR and the CEO', async () => {
      // the month before is paid: what was received shows too
      const run = await lineOn(PREVIOUS, amy);
      await api().post(`/api/payroll/runs/${run.run.id}/submit`).set('Cookie', hr).expect(200);
      await api().post(`/api/payroll/runs/${run.run.id}/approve`).set('Cookie', ceo).expect(200);
      await api().post(`/api/payroll/runs/${run.run.id}/paid`).set('Cookie', hr).send({ paidOn: today }).expect(200);

      const history = (await api().get(`/api/employees/${amy.id}/salary-history`).set('Cookie', hr).expect(200)).body as {
        employments: { current: boolean; summary: Record<string, unknown>; events: Record<string, unknown>[]; paid: { month: string; net: number }[] }[];
      };
      const [current] = history.employments;
      expect(current.current).toBe(true);
      expect(current.events.map((e) => [e.version, e.change, e.stage])).toEqual([
        [1, 'hired', 'replaced'],
        [2, 'amendment', 'signed'],
      ]);
      expect(current.events[1]).toMatchObject({
        from: { gross: 10000, allowances: 500, total: 10500 },
        to: { gross: 12000, allowances: 700, total: 12700 },
        difference: { amount: 2000, percent: 20 },
        raise: true,
        reason: 'promotion',
        promotion: { jobTitle: 'Senior Accountant', grade: 'G5' },
        approvedBy: `Chief Officer ${RUN}`,
        documents: [expect.objectContaining({ slotKey: 'contract_amendment' })],
      });
      expect(current.summary).toMatchObject({ startingGross: 10000, currentGross: 12000, change: { amount: 2000, percent: 20 }, raises: 1, lastRaise: { date: EFFECTIVE } });
      expect(current.paid.map((m) => m.month)).toEqual([PREVIOUS]);

      const forFinance = (await api().get(`/api/employees/${amy.id}/salary-history`).set('Cookie', finance).expect(200)).body as { employments: { events: { documents: unknown }[] }[] };
      expect(forFinance.employments[0].events[1].documents).toBeNull();
      for (const session of [manager, ben]) await api().get(`/api/employees/${amy.id}/salary-history`).set('Cookie', session).expect(403);
    });
    it('a signing undone by mistake (a Super Admin): the version before is in force again and the promotion is undone', async () => {
      const draft = (await api().post(`/api/contracts/${raise.id}/unsign`).set('Cookie', superAdmin).expect(200)).body as Contract;
      expect(draft).toMatchObject({ status: 'draft', stage: 'approved', raise: { approval: 'approved' } });
      expect((await requestFor(raise)).status).toBe('approved');
      const back = (await api().get(`/api/employees/${amy.id}`).set('Cookie', hr).expect(200)).body as { employment: { jobTitleId: string; gradeId: string; contract: { id: string } } };
      expect(back.employment).toMatchObject({ jobTitleId: accountant, gradeId: grades.G3, contract: { id: amyV1.id } });
      // still approved: signed again as it was
      await sign(raise.id).expect(200);
      const again = (await api().get(`/api/employees/${amy.id}`).set('Cookie', hr).expect(200)).body as { employment: { jobTitleId: string; gradeId: string } };
      expect(again.employment).toMatchObject({ jobTitleId: senior, gradeId: grades.G5 });
      expect(kinds(await requestFor(raise)).slice(-3)).toEqual(['signed', 'unsigned', 'signed']);
    });
  });

  describe('a new contract, and the CEO’s decisions with a comment', () => {
    // raise requests, with their log and what each viewer sees, are in raise-requests.e2e-spec.ts
    it('HR enters a new contract; the CEO rejects it with a comment: the draft goes', async () => {
      const raise = (await postRaise(benP, { way: 'contract', effectiveDate: NEXT_EFFECTIVE, reason: 'market_adjustment', grossSalary: 10500 }).expect(201)).body as Contract;
      expect(raise).toMatchObject({
        kind: 'contract',
        number: expect.stringMatching(new RegExp(`^CON-${NEXT_EFFECTIVE.slice(0, 4)}-\\d{4}$`)),
        startDate: NEXT_EFFECTIVE,
        endDate: addDays(addMonths(NEXT_EFFECTIVE, 12), -1),
        durationMonths: 12,
        probationMonths: 0,
        raise: { requestId: expect.any(String), requestOrigin: 'direct', approval: 'draft', reason: 'market_adjustment' },
      });
      // a raise not yet signed stays with those who see salaries, and so does its request
      expect(((await contractsOf(benP, ben).expect(200)).body as Contract[]).map((c) => c.id)).not.toContain(raise.id);
      const id = raise.raise!.requestId!;
      // the employee and his manager see no raise requests at all (owner, 20 October 2026: "raises not to be visible to
      // employee level for now", "Hide from managers too")
      for (const session of [ben, manager]) await api().get(`/api/employees/${benP.id}/raise-requests`).set('Cookie', session).expect(403);
      const forHr = (await api().get(`/api/employees/${benP.id}/raise-requests`).set('Cookie', hr).expect(200)).body as { requests: { id: string }[]; canRequest: boolean };
      expect(forHr.requests.map((q) => q.id)).toContain(id);
      // nor is it the one open request a person has: HR may still ask for one
      expect(forHr.canRequest).toBe(true);
      expect(await requestOf(id)).toMatchObject({ raise: { way: 'contract', change: 'new_contract' }, comment: 'Prepared directly by HR' });
      await step(raise.id, 'send', hr, { comment: 'For the new year' }).expect(200);
      await step(raise.id, 'decline', ceo, {}).expect(400);
      await step(raise.id, 'decline', ceo, { comment: 'Not this quarter' }).expect(204);
      expect(await prisma.contract.findUnique({ where: { id: raise.id } })).toBeNull();
      expect((await auditOf('contract', raise.id)).at(-1)).toMatchObject({ action: 'decline', diff: { reason: 'Not this quarter', grossSalary: 'changed' } });
      // rejected: its request stays, in the history
      const q = await requestOf(id);
      expect(q).toMatchObject({ status: 'declined', raise: null, decision: { stage: 'ceo', reason: 'Not this quarter' } });
      expect(kinds(q)).toEqual(['prepared', 'sent', 'ceo_decision:reject']);
      expect((await requests('declined')).map((x) => x.id)).toContain(id);
    });

    it('the CEO approves another with another raise: its gross is the figure over the pay before it, the allowances as they are', async () => {
      const raise = (await postRaise(benP, { way: 'contract', effectiveDate: NEXT_EFFECTIVE, reason: 'performance', grossSalary: 9500, netSalary: 7000 }).expect(201)).body as Contract;
      await step(raise.id, 'send', hr).expect(200);
      await step(raise.id, 'approve', ceo, { comment: 'More', increaseAmount: 100, increasePercent: 10 }).expect(400);
      // another reason, from the list (19 October 2026): adjustment is no longer offered, and only the list's are taken
      expect((await step(raise.id, 'approve', ceo, { comment: 'Make it 10%', increasePercent: 10, raiseReason: 'adjustment' }).expect(400)).body.message).toMatch(/Choose the reason from the list/);
      await step(raise.id, 'approve', ceo, { comment: 'Make it 10%', increasePercent: 10, raiseReason: 'bonus' }).expect(400);
      // the pay before it is 9,000: +10% is 9,900; and the CEO changes the reason
      const approved = (await step(raise.id, 'approve', ceo, { comment: 'Make it 10%', increasePercent: 10, raiseReason: 'counter_offer' }).expect(200)).body as Contract & { netSalary: number; insuredSalary: number };
      expect(approved).toMatchObject({ stage: 'approved', grossSalary: 9900, raise: { approval: 'approved', approvedBy: { email: ceoEmail }, reason: 'counter_offer' } });
      // the request's reason too, logged on the CEO's decision from → to
      const q = await requestFor(raise);
      expect(q).toMatchObject({ status: 'approved', raiseReason: 'counter_offer' });
      expect(q.steps.at(-1)).toMatchObject({ kind: 'ceo_decision', decision: 'approve_other', comment: 'Make it 10%', raiseReason: 'counter_offer', raiseReasonFrom: 'performance', gross: 9900, increasePercent: 10 });
      // and in the audit log, the version's and the request's
      expect((await auditOf('contract', raise.id)).at(-1)!.diff).toMatchObject({ raiseReason: { from: 'performance', to: 'counter_offer' } });
      expect((await auditOf('raise_request', q.id)).at(-1)).toMatchObject({ action: 'approve', diff: { raiseReason: { from: 'performance', to: 'counter_offer' }, status: { from: 'with_ceo', to: 'approved' } } });
      // the net and the insured salary worked out again for the new gross
      expect(approved.netSalary).not.toBe(7000);
      expect(approved.insuredSalary).toBe(insured(9900, NEXT_EFFECTIVE.slice(0, 7)));
      const audit = (await auditOf('contract', raise.id)).at(-1)!;
      expect(audit).toMatchObject({ action: 'approve', diff: { decision: 'approve_other', comment: 'Make it 10%', grossSalary: 'changed' } });
      expect(JSON.stringify((await auditOf('raise_request', q.id)).map((a) => a.diff))).not.toContain('9900');
      expect(JSON.stringify(audit.diff)).not.toContain('9900');
      await sign(raise.id).expect(200);
      const versions = (await contractsOf(benP).expect(200)).body as Contract[];
      expect(versions.map((v) => [v.version, v.status, v.kind, v.grossSalary])).toEqual([
        [2, 'active', 'contract', 9900],
        [1, 'superseded', 'contract', 9000],
      ]);
    });
  });

  describe('a renewal with new pay goes to the CEO as a raise', () => {
    it('needs a reason; signed once approved; the same pay needs no approval', async () => {
      const [v1] = (await contractsOf(cara).expect(200)).body as Contract[];
      expect((await postContract(cara, { grossSalary: 9000 }).expect(400)).body.message).toBe(
        'The pay changes from version 1: choose why (annual raise, performance raise, counter-offer raise, promotion, market adjustment, cost of living or other). The CEO approves a change of pay before it is signed.',
      );
      const renewal = (await postContract(cara, { grossSalary: 9000, raiseReason: 'annual' }).expect(201)).body as Contract;
      expect(renewal).toMatchObject({ kind: 'contract', startDate: addDays(v1.endDate!, 1), stage: 'draft', raise: { reason: 'annual', approval: 'draft', requestOrigin: 'direct' } });
      // its request, prepared directly by HR (19 October 2026): a renewal, from its start
      const first = await requestFor(renewal);
      expect(first).toMatchObject({ origin: 'direct', status: 'with_hr', raiseReason: 'annual', effectiveFrom: renewal.startDate, suggestion: { amount: 1000, gross: 9000 }, raise: { change: 'renewal', previousGross: 8000 } });
      expect((await sign(renewal.id).expect(409)).body.message).toMatch(/changes the pay: send it to the CEO/);
      // changed back to the same pay, it needs no approval, and its request goes
      const same = (await api().patch(`/api/contracts/${renewal.id}`).set('Cookie', hr).send({ grossSalary: 8000 }).expect(200)).body as Contract;
      expect(same.raise).toBeNull();
      expect(await prisma.raiseRequest.findUnique({ where: { id: first.id } })).toBeNull();
      expect((await auditOf('raise_request', first.id)).at(-1)).toMatchObject({ action: 'delete', diff: { origin: 'direct', why: 'no_pay_change' } });
      expect((await step(renewal.id, 'send', hr).expect(400)).body.message).toMatch(/doesn't change the pay/);
      // new pay again: a request again (a reason kept from before, adjustment, too); HR sends it, the CEO approves, HR signs
      const again = (await api().patch(`/api/contracts/${renewal.id}`).set('Cookie', hr).send({ grossSalary: 9500, raiseReason: 'adjustment' }).expect(200)).body as Contract;
      expect(await requestFor(again)).toMatchObject({ status: 'with_hr', raiseReason: 'adjustment', suggestion: { amount: 1500, gross: 9500 } });
      await step(renewal.id, 'send', hr).expect(200);
      expect((await requestFor(again)).status).toBe('with_ceo');
      await api().patch(`/api/contracts/${renewal.id}`).set('Cookie', hr).send({ grossSalary: 9600 }).expect(409);
      await step(renewal.id, 'approve', ceo, { comment: 'Fine', raiseReason: 'adjustment' }).expect(200);
      expect((await requestFor(again)).status).toBe('approved');
      expect((await sign(renewal.id).expect(200)).body).toMatchObject({ status: 'active', stage: 'signed', raise: { approval: 'approved', reason: 'adjustment' } });
      const done = await requestFor(again);
      expect(done).toMatchObject({ status: 'done', raiseReason: 'adjustment' });
      expect(kinds(done)).toEqual(['prepared', 'sent', 'ceo_decision:approve', 'signed']);
      // the CEO kept the reason: nothing changed on the decision
      expect(done.steps[2]).toMatchObject({ raiseReason: null, raiseReasonFrom: null });
      const history = (await api().get(`/api/employees/${cara.id}/salary-history`).set('Cookie', ceo).expect(200)).body as { employments: { events: { change: string; raise: boolean; samePay: boolean }[] }[] };
      expect(history.employments[0].events.map((e) => [e.change, e.raise, e.samePay])).toEqual([
        ['hired', false, false],
        ['renewal', true, false],
      ]);
    });

    it('a raise draft deleted (a Super Admin): its request prepared directly by HR goes with it, nobody having asked', async () => {
      // on the renewal now in force, from the 1st after it starts
      const [inForce] = (await contractsOf(cara).expect(200)).body as Contract[];
      const raise = (await postRaise(cara, { way: 'amendment', effectiveDate: nextFirstOfMonth(inForce.startDate), reason: 'annual', grossSalary: 10000 }).expect(201)).body as Contract;
      const id = raise.raise!.requestId!;
      expect((await requestOf(id)).status).toBe('with_hr');
      await api().delete(`/api/contracts/${raise.id}`).set('Cookie', superAdmin).expect(204);
      expect(await prisma.raiseRequest.findUnique({ where: { id } })).toBeNull();
      expect((await requests()).map((q) => q.id)).not.toContain(id);
      expect((await auditOf('raise_request', id)).map((a) => [a.action, (a.diff as { why?: string }).why ?? null])).toEqual([
        ['create', null],
        ['delete', 'raise_deleted'],
      ]);
    });
  });
});
