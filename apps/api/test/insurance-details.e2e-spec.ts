import type { INestApplication } from '@nestjs/common';
import { insurableWageLimits, PROFILE_DISCLAIMER, type PdfField } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { DocumentsService } from '../src/documents/documents.service.js';
import { OfferDocumentsService } from '../src/offers/offer-documents.service.js';
import { offerSlot } from '../src/offers/rules.js';
import { OFFER_INCLUDE, WITHOUT_FILES } from '../src/offers/views.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { docx, p, r } from './fixtures/docx.js';
import { formPdf, shownGlyphs, shownLines } from './fixtures/pdf-form.js';
import { createApp, createUser, signIn } from './helpers.js';

// What social insurance Forms 1 and 6 print that the system didn't hold (owner, 15 October 2026): the company's
// insurance office and sector code, the occupation in the social insurance table, and the building number of an
// employee's address; printed by their tags on employee documents and job offers. And a PDF form's optional fields:
// left blank when their value is missing, rather than stopping the document.
// The occupation is the employee's own, set by HR on the Social Insurance tab, no longer the job title's (owner's
// decision, 16 October 2026); so are Form 1's subscription start and its basic and comprehensive wages, with the
// contract settings' default basic wage. Its insured wage is the comprehensive wage within this year's insurable limits,
// no longer set (owner's decision, 16 October 2026). Every number on the social insurance forms prints in ٠-٩ (owner,
// 16 October 2026).

const RUN = Date.now().toString(36);
const PAGE = { width: 612, height: 1008 };
const OCCUPATION = 'Choose the occupation from the social insurance list.';
const BASIC_WAGE = 'Enter the basic wage as an amount of more than 0 and up to 99,999.99, e.g. 410 or 2500.50.';
const COMPREHENSIVE_WAGE = 'Enter the comprehensive wage as an amount of more than 0 and up to 999,999.99, e.g. 15000 or 16700.50.';
const DEFAULT_BASIC = 'Enter the default basic wage as an amount of more than 0 and up to 99,999.99, e.g. 410.';
/** This year's insurable limits, as the API keeps the insured wage within them. */
const LIMITS = insurableWageLimits(Number(todayInCairo().slice(0, 4)));
/** Digits as a social insurance form prints them, ٠-٩ (owner, 16 October 2026). */
const ar = (text: string) => text.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

/** Form 1's fields for these tests: a name, the occupation's boxes and the insurance office (needed), the building number and the sector code's boxes (optional). */
const FORM: PdfField[] = [
  { id: 'name', kind: 'text', tag: 'full_name_en', page: 1, x: 100, y: 100, width: 300, height: 16, fontSize: 12, align: 'left' },
  { id: 'occupation', kind: 'boxes', tag: 'occupation_code', page: 1, x: 100, y: 150, width: 120, height: 18, fontSize: 12, boxes: 6 },
  { id: 'office', kind: 'text', tag: 'insurance_office', page: 1, x: 100, y: 200, width: 300, height: 16, fontSize: 12 },
  { id: 'building', kind: 'text', tag: 'building_no', page: 1, x: 100, y: 250, width: 100, height: 16, fontSize: 12, align: 'left', optional: true },
  { id: 'sector', kind: 'boxes', tag: 'insurance_sector_code', page: 1, x: 100, y: 300, width: 40, height: 18, fontSize: 12, boxes: 2, optional: true },
];

describe('Social insurance details (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrId: string;
  let staff: string;
  let finance: string;
  let ceo: string;
  let companyBefore: { emailDomain: string | null; insuranceOffice: string | null; insuranceSectorCode: string | null } | null;
  let departmentId: string;
  let gradeId: string;
  let shiftId: string;
  const api = () => request(app.getHttpServer());

  const company = (body: object, session = hr) => api().patch('/api/company').set('Cookie', session).send(body);
  const jobTitle = (id: string, body: object) => api().patch(`/api/job-titles/${id}`).set('Cookie', hr).send(body);
  const employee = (id: string, body: object) => api().patch(`/api/employees/${id}`).set('Cookie', hr).send(body);
  const auditOf = (entityType: string, entityId?: string) => prisma.auditLog.findMany({ where: { entityType, ...(entityId && { entityId }) }, orderBy: { id: 'asc' } });
  /** A database refusal, read through Prisma. */
  const refused = (sql: Promise<unknown>) => expect(sql).rejects.toThrow(/check constraint|violates|23514/i);

  async function newJobTitle(titleEn: string, extra: object = {}) {
    return (await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId, titleEn, ...extra }).expect(201)).body as { id: string; [key: string]: unknown };
  }

  async function newEmployee(name: string, extra: object = {}) {
    return (await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', ...extra }).expect(201)).body as { id: string; employeeCode: string };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } })).id;
    staff = await signIn(app, await createUser(prisma, ['employee']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    await prisma.generatedDocument.deleteMany();
    await prisma.jobOffer.deleteMany();
    await prisma.templateVersion.deleteMany();
    companyBefore = await prisma.company.findUnique({ where: { id: 1 }, select: { emailDomain: true, insuranceOffice: true, insuranceSectorCode: true } });
    // sign-in accounts here are @test.local
    await company({ emailDomain: '', insuranceOffice: null, insuranceSectorCode: null }).expect(200);

    departmentId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Insured ${RUN}` }).expect(201)).body.id;
    gradeId = ((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((g) => g.code === 'G4')!.id;
    shiftId = ((await api().get('/api/shifts').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((s) => s.code === 'A')!.id;
  });

  afterAll(async () => {
    await prisma.generatedDocument.deleteMany();
    await prisma.jobOffer.deleteMany();
    await prisma.templateVersion.deleteMany();
    if (companyBefore) await prisma.company.update({ where: { id: 1 }, data: companyBefore });
    await prisma.contractSettings.update({ where: { id: 1 }, data: { insuranceBasicDefault: 410 } });
    await app.close();
  });

  describe('the company profile', () => {
    it('keeps the insurance office and the sector code, Arabic-Indic digits as 0-9, and logs the change', async () => {
      const res = await company({ insuranceOffice: '  مكتب تأمينات الدقي ', insuranceSectorCode: '٠٧' }).expect(200);
      expect(res.body).toMatchObject({ insuranceOffice: 'مكتب تأمينات الدقي', insuranceSectorCode: '07' });
      expect((await api().get('/api/company').set('Cookie', staff).expect(200)).body).toMatchObject({ insuranceOffice: 'مكتب تأمينات الدقي', insuranceSectorCode: '07' });
      expect((await auditOf('company')).at(-1)).toMatchObject({
        action: 'update',
        diff: { insuranceOffice: { from: null, to: 'مكتب تأمينات الدقي' }, insuranceSectorCode: { from: null, to: '07' } },
      });
      // a single digit too
      expect((await company({ insuranceSectorCode: '3' }).expect(200)).body.insuranceSectorCode).toBe('3');
    });

    it('refuses a sector code that isn’t 1 or 2 digits and an office longer than 120 characters; empty clears them', async () => {
      const say = async (body: object) => (await company(body).expect(400)).body.message as string[];
      for (const code of ['123', '7a', '-1', '1.5']) expect(await say({ insuranceSectorCode: code })).toEqual(['Enter the sector code as 1 or 2 digits, as the insurance office gave it.']);
      expect(await say({ insuranceSectorCode: 7 })).toEqual(['Enter the sector code as 1 or 2 digits, as the insurance office gave it.']);
      expect(await say({ insuranceOffice: 'م'.repeat(121) })).toEqual(['Keep the insurance office to 120 characters or fewer.']);
      await company({ insuranceSectorCode: '07' }, staff).expect(403);
      expect((await company({ insuranceOffice: 'م'.repeat(120) }).expect(200)).body.insuranceOffice).toHaveLength(120);
      expect((await company({ insuranceOffice: '   ', insuranceSectorCode: '' }).expect(200)).body).toMatchObject({ insuranceOffice: null, insuranceSectorCode: null });
    });

    it('the database refuses what the API refuses', async () => {
      await refused(prisma.$executeRaw`UPDATE company SET insurance_sector_code = '123' WHERE id = 1`);
      await refused(prisma.$executeRaw`UPDATE company SET insurance_sector_code = 'ab' WHERE id = 1`);
      await refused(prisma.$executeRaw`UPDATE company SET insurance_office = '' WHERE id = 1`);
      await refused(prisma.$executeRaw`UPDATE company SET insurance_office = ${'x'.repeat(121)} WHERE id = 1`);
      expect(await prisma.company.findUnique({ where: { id: 1 }, select: { insuranceOffice: true, insuranceSectorCode: true } })).toEqual({ insuranceOffice: null, insuranceSectorCode: null });
    });
  });

  describe('job titles', () => {
    it('no longer take an occupation: it is the employee’s, on the Social Insurance tab', async () => {
      const job = await newJobTitle(`Physicist ${RUN}`);
      expect(job).not.toHaveProperty('occupationCode');
      expect(job).not.toHaveProperty('occupationName');
      const unknown = ['property occupationCode should not exist'];
      expect((await jobTitle(job.id, { occupationCode: '012100' }).expect(400)).body.message).toEqual(unknown);
      expect((await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId, titleEn: `Nobody ${RUN}`, occupationCode: '012100' }).expect(400)).body.message).toEqual(unknown);
      expect((await api().get(`/api/job-titles/${job.id}`).set('Cookie', staff).expect(200)).body).not.toHaveProperty('occupationCode');
      const list = (await api().get(`/api/job-titles?departmentId=${departmentId}`).set('Cookie', staff).expect(200)).body as object[];
      for (const j of list) expect(j).not.toHaveProperty('occupationCode');
      // nor is it logged with the job title
      expect((await auditOf('job_title', job.id))[0].diff).not.toHaveProperty('occupationCode');
    });
  });

  describe('the occupation, on the employee', () => {
    it('HR sets it (Arabic-Indic digits as 0-9), the profile shows it with its name, and each change is logged', async () => {
      const e = await newEmployee('Site Engineer');
      expect((await api().get(`/api/employees/${e.id}`).set('Cookie', hr).expect(200)).body).toMatchObject({ occupationCode: null, occupationName: null });
      expect((await employee(e.id, { occupationCode: '٠٢٢١٢٠' }).expect(200)).body).toMatchObject({ occupationCode: '022120', occupationName: 'مهندس موقع' });
      // sending the same again changes nothing
      await employee(e.id, { occupationCode: '022120' }).expect(200);
      expect((await employee(e.id, { occupationCode: '' }).expect(200)).body).toMatchObject({ occupationCode: null, occupationName: null });
      await employee(e.id, { occupationCode: '194200' }).expect(200);
      expect((await employee(e.id, { occupationCode: null }).expect(200)).body).toMatchObject({ occupationCode: null, occupationName: null });
      expect((await auditOf('employee', e.id)).slice(1).map((a) => a.diff)).toEqual([
        { occupationCode: { from: null, to: '022120' } },
        { occupationCode: { from: '022120', to: null } },
        { occupationCode: { from: null, to: '194200' } },
        { occupationCode: { from: '194200', to: null } },
      ]);
      // set when adding the employee too
      const added = await newEmployee('Added Physicist', { occupationCode: '012100' });
      expect((await api().get(`/api/employees/${added.id}`).set('Cookie', hr).expect(200)).body).toMatchObject({ occupationCode: '012100', occupationName: 'فيزيائي عام' });
      expect((await auditOf('employee', added.id))[0].diff).toMatchObject({ occupationCode: '012100' });
    });

    it('refuses a code not in the table, or not six digits; only HR sets it', async () => {
      const e = await newEmployee('Analyst');
      for (const code of ['000001', '12345', '0121000', 'abcdef', '012 100']) {
        expect((await employee(e.id, { occupationCode: code }).expect(400)).body.message).toEqual([OCCUPATION]);
      }
      expect((await employee(e.id, { occupationCode: 12100 }).expect(400)).body.message).toEqual([OCCUPATION]);
      expect((await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `Nobody ${RUN}`, fullNameAr: 'موظف', occupationCode: '999998' }).expect(400)).body.message).toEqual([OCCUPATION]);
      for (const session of [staff, finance, ceo]) await api().patch(`/api/employees/${e.id}`).set('Cookie', session).send({ occupationCode: '012100' }).expect(403);
      expect((await api().get(`/api/employees/${e.id}`).set('Cookie', hr).expect(200)).body.occupationCode).toBeNull();
    });

    it('isn’t the employee’s to confirm or ask to change, nor counted in the profile’s completeness', async () => {
      const email = await createUser(prisma, ['employee']);
      const e = await newEmployee('Occupied Self', { workEmail: email });
      const self = await signIn(app, email);
      await api().post(`/api/employees/${e.id}/confirm`).set('Cookie', self).send({ accept: true, disclaimerVersion: PROFILE_DISCLAIMER.version }).expect(201);
      const before = (await api().get(`/api/employees/${e.id}`).set('Cookie', hr).expect(200)).body;

      await employee(e.id, { occupationCode: '194200' }).expect(200);
      const after = (await api().get(`/api/employees/${e.id}`).set('Cookie', hr).expect(200)).body;
      // the confirmation stays up to date, and the completeness is the same
      expect(after.confirmation).toMatchObject({ upToDate: true, changedFields: [] });
      expect(after.completeness).toEqual(before.completeness);
      expect(after.completeness.missing.map((m: { key: string }) => m.key)).not.toContain('occupationCode');
      // the employee sees it on their own profile, but can't ask for it to change
      expect((await api().get(`/api/employees/${e.id}`).set('Cookie', self).expect(200)).body).toMatchObject({ occupationCode: '194200', occupationName: 'اخصائي موارد بشريه' });
      const asked = await api().post(`/api/employees/${e.id}/change-requests`).set('Cookie', self).send({ changes: { occupationCode: '012100' } }).expect(400);
      expect(asked.body.message).toBe("occupationCode can't be changed by request.");
    });

    it('the employment’s job title no longer carries one', async () => {
      const job = await newJobTitle(`Sales manager ${RUN}`);
      const e = await newEmployee('Employed Person', { occupationCode: '212300' });
      await api()
        .post(`/api/employees/${e.id}/employments`)
        .set('Cookie', hr)
        .send({ employmentType: 'full_time', joinDate: '2026-01-15', departmentId, jobTitleId: job.id, gradeId, shiftId })
        .expect(201);
      const profile = (await api().get(`/api/employees/${e.id}`).set('Cookie', hr).expect(200)).body;
      expect(profile.employment.jobTitle).toEqual({ id: job.id, titleEn: `Sales manager ${RUN}`, titleAr: null, jdVersion: 1 });
      expect(profile).toMatchObject({ occupationCode: '212300', occupationName: 'مدير مبيعات' });
    });

    it('the database refuses a code that isn’t six digits', async () => {
      const e = await newEmployee('Checked Occupation');
      await refused(prisma.$executeRaw`UPDATE employees SET occupation_code = '12345' WHERE id = ${e.id}::uuid`);
      await refused(prisma.$executeRaw`UPDATE employees SET occupation_code = 'abcdef' WHERE id = ${e.id}::uuid`);
    });
  });

  describe('the subscription start and the wages, on the employee', () => {
    const profileOf = async (id: string, session = hr) => (await api().get(`/api/employees/${id}`).set('Cookie', session).expect(200)).body;

    it('HR sets the subscription start (YYYY-MM-DD), clears it, and each change is logged', async () => {
      const e = await newEmployee('Subscriber', { insuranceStartDate: '2026-02-01' });
      expect((await profileOf(e.id)).insuranceStartDate).toBe('2026-02-01');
      expect((await profileOf(e.id, finance)).insuranceStartDate).toBe('2026-02-01');
      expect((await employee(e.id, { insuranceStartDate: '2026-03-01' }).expect(200)).body.insuranceStartDate).toBe('2026-03-01');
      expect((await employee(e.id, { insuranceStartDate: '' }).expect(200)).body.insuranceStartDate).toBeNull();
      for (const bad of ['2026-02-30', '01/02/2026', 'soon']) {
        expect((await employee(e.id, { insuranceStartDate: bad }).expect(400)).body.message).toEqual(['Enter a real subscription start date.']);
      }
      const audit = await auditOf('employee', e.id);
      expect(audit[0].diff).toMatchObject({ insuranceStartDate: '2026-02-01' });
      expect(audit.slice(1).map((a) => a.diff)).toEqual([
        { insuranceStartDate: { from: '2026-02-01', to: '2026-03-01' } },
        { insuranceStartDate: { from: '2026-03-01', to: null } },
      ]);
    });

    it('HR sets the basic and comprehensive wages; those who see salaries see them with the default basic wage, the insured wage and this year’s limits, nobody else', async () => {
      const email = await createUser(prisma, ['employee']);
      const e = await newEmployee('Waged Person', { workEmail: email });
      const self = await signIn(app, email);
      const set = await employee(e.id, { insuranceBasicWage: 2500.5, insuranceComprehensiveWage: 17250.75 }).expect(200);
      // the insured wage Form 1 prints: the comprehensive wage capped at this year's maximum
      const wages = {
        insuranceBasicWage: 2500.5,
        insuranceComprehensiveWage: 17250.75,
        insuranceBasicDefault: 410,
        insuredWage: { amount: LIMITS.max, comprehensive: 17250.75, adjusted: 'max', limits: LIMITS },
        insurableLimits: LIMITS,
      };
      expect(set.body).toMatchObject(wages);
      expect(set.body).not.toHaveProperty('insuranceInsuredWage');
      for (const session of [finance, ceo]) expect(await profileOf(e.id, session)).toMatchObject(wages);
      // the employee sees their profile, not these (as their contract's salary)
      const own = await profileOf(e.id, self);
      for (const key of ['insuranceBasicWage', 'insuranceComprehensiveWage', 'insuranceBasicDefault', 'insuredWage', 'insurableLimits']) expect(own).not.toHaveProperty(key);
      expect(own).toHaveProperty('insuranceStartDate', null);

      // none of their own: null, the default stands in for the basic wage, and with no contract there is no insured wage
      const cleared = await employee(e.id, { insuranceBasicWage: null, insuranceComprehensiveWage: null }).expect(200);
      expect(cleared.body).toMatchObject({ insuranceBasicWage: null, insuranceComprehensiveWage: null, insuranceBasicDefault: 410, insuredWage: null, insurableLimits: LIMITS });
      // only HR sets them
      for (const session of [finance, ceo, self]) await api().patch(`/api/employees/${e.id}`).set('Cookie', session).send({ insuranceBasicWage: 500 }).expect(403);
    });

    it('the insured wage is no longer set: refused as an unknown field, it is the comprehensive wage within this year’s limits', async () => {
      const e = await newEmployee('Insured From Comprehensive');
      for (const value of [LIMITS.min + 300, null]) {
        expect((await employee(e.id, { insuranceInsuredWage: value }).expect(400)).body.message).toEqual(['property insuranceInsuredWage should not exist']);
      }
      const added = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `Insured Added ${RUN}`, fullNameAr: 'موظف تجريبي', insuranceInsuredWage: 15000 }).expect(400);
      expect(added.body.message).toEqual(['property insuranceInsuredWage should not exist']);

      // within the limits, as it is; below the minimum, raised to it; above the maximum, capped at it
      const insuredOf = async (comprehensive: number) => (await employee(e.id, { insuranceComprehensiveWage: comprehensive }).expect(200)).body.insuredWage;
      expect(await insuredOf(LIMITS.min + 300.5)).toEqual({ amount: LIMITS.min + 300.5, comprehensive: LIMITS.min + 300.5, adjusted: null, limits: LIMITS });
      expect(await insuredOf(LIMITS.min - 700)).toEqual({ amount: LIMITS.min, comprehensive: LIMITS.min - 700, adjusted: 'min', limits: LIMITS });
      expect(await insuredOf(LIMITS.max)).toEqual({ amount: LIMITS.max, comprehensive: LIMITS.max, adjusted: null, limits: LIMITS });
      expect(await insuredOf(LIMITS.max + 0.01)).toEqual({ amount: LIMITS.max, comprehensive: LIMITS.max + 0.01, adjusted: 'max', limits: LIMITS });
    });

    it('without a comprehensive wage of their own, the insured wage is worked out from the signed contract’s gross and allowances', async () => {
      const job = await newJobTitle(`Contracted clerk ${RUN}`);
      const e = await newEmployee('Contracted Insured');
      const hired = await api()
        .post(`/api/employees/${e.id}/employments`)
        .set('Cookie', hr)
        .send({ employmentType: 'full_time', joinDate: '2026-01-15', departmentId, jobTitleId: job.id, gradeId, shiftId })
        .expect(201);
      const contract = await api().post(`/api/employees/${e.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', hr).send({ grossSalary: 20000 }).expect(201);
      // a draft isn't the signed contract the tab is about
      expect((await profileOf(e.id)).insuredWage).toBeNull();
      await api().post(`/api/contracts/${contract.body.id}/sign`).set('Cookie', hr).send({ signedOn: contract.body.startDate }).expect(200);
      expect((await profileOf(e.id)).insuredWage).toEqual({ amount: LIMITS.max, comprehensive: 20000, adjusted: 'max', limits: LIMITS });
      // their own comprehensive wage stands in for the contract's
      await employee(e.id, { insuranceComprehensiveWage: 15200 }).expect(200);
      expect((await profileOf(e.id)).insuredWage).toEqual({ amount: 15200, comprehensive: 15200, adjusted: null, limits: LIMITS });
      // the contract's own insured salary, on its social insurance copy, is unchanged
      expect((await profileOf(e.id)).employment.contract.insuredSalary).toBe(LIMITS.max);
    });

    it('logs only that a wage was set or changed, never the amount', async () => {
      const e = await newEmployee('Masked Wages', { insuranceBasicWage: 600 });
      await employee(e.id, { insuranceBasicWage: 700, insuranceComprehensiveWage: 15000 }).expect(200);
      await employee(e.id, { insuranceBasicWage: null }).expect(200);
      const audit = await auditOf('employee', e.id);
      expect(audit[0].diff).toMatchObject({ insuranceBasicWage: 'changed', insuranceComprehensiveWage: null });
      expect(audit[0].diff).not.toHaveProperty('insuranceInsuredWage');
      expect(audit.slice(1).map((a) => a.diff)).toEqual([{ insuranceBasicWage: 'changed', insuranceComprehensiveWage: 'changed' }, { insuranceBasicWage: 'changed' }]);
      expect(JSON.stringify(audit.map((a) => a.diff))).not.toMatch(/600|700|15000/);
    });

    it('refuses amounts out of range', async () => {
      const e = await newEmployee('Checked Wages');
      const say = async (body: object) => (await employee(e.id, body).expect(400)).body.message as string[];
      for (const bad of [0, -5, 100000, 1.234]) expect(await say({ insuranceBasicWage: bad })).toContain(BASIC_WAGE);
      expect(await say({ insuranceBasicWage: '410' })).toContain(BASIC_WAGE);
      for (const bad of [0, 1000000, 1.005]) expect(await say({ insuranceComprehensiveWage: bad })).toContain(COMPREHENSIVE_WAGE);
      // the limits themselves are within them
      expect((await employee(e.id, { insuranceBasicWage: 99999.99, insuranceComprehensiveWage: 999999.99 }).expect(200)).body).toMatchObject({
        insuranceBasicWage: 99999.99,
        insuranceComprehensiveWage: 999999.99,
      });
    });

    it('aren’t the employee’s to ask to change', async () => {
      const email = await createUser(prisma, ['employee']);
      const e = await newEmployee('Asking Wages', { workEmail: email });
      const self = await signIn(app, email);
      for (const field of ['insuranceStartDate', 'insuranceBasicWage', 'insuranceComprehensiveWage']) {
        const asked = await api().post(`/api/employees/${e.id}/change-requests`).set('Cookie', self).send({ changes: { [field]: field === 'insuranceStartDate' ? '2026-01-01' : 5000 } }).expect(400);
        expect(asked.body.message).toBe(`${field} can't be changed by request.`);
      }
    });

    it('the default basic wage is in the contract settings: anyone signed in reads it, HR and Admin change it, logged', async () => {
      expect((await api().get('/api/contract-settings').set('Cookie', staff).expect(200)).body.insuranceBasicDefault).toBe(410);
      await api().patch('/api/contract-settings').set('Cookie', finance).send({ insuranceBasicDefault: 500 }).expect(403);
      expect((await api().patch('/api/contract-settings').set('Cookie', hr).send({ insuranceBasicDefault: 512.5 }).expect(200)).body).toMatchObject({ insuranceBasicDefault: 512.5 });
      const e = await newEmployee('Defaulted');
      expect((await profileOf(e.id)).insuranceBasicDefault).toBe(512.5);
      for (const bad of [0, -1, 100000, 1.234, null, '410']) {
        expect((await api().patch('/api/contract-settings').set('Cookie', hr).send({ insuranceBasicDefault: bad }).expect(400)).body.message).toContain(DEFAULT_BASIC);
      }
      await api().patch('/api/contract-settings').set('Cookie', hr).send({ insuranceBasicDefault: 410 }).expect(200);
      expect((await auditOf('contract_settings')).slice(-2).map((a) => a.diff)).toEqual([
        { insuranceBasicDefault: { from: 410, to: 512.5 } },
        { insuranceBasicDefault: { from: 512.5, to: 410 } },
      ]);
    });

    it('the database refuses a wage of 0 or less, and keeps no insured wage', async () => {
      const e = await newEmployee('Database Wages');
      await refused(prisma.$executeRaw`UPDATE employees SET insurance_basic_wage = 0 WHERE id = ${e.id}::uuid`);
      await expect(prisma.$executeRaw`UPDATE employees SET insurance_insured_wage = 1 WHERE id = ${e.id}::uuid`).rejects.toThrow(/insurance_insured_wage.*does not exist|42703/);
      await refused(prisma.$executeRaw`UPDATE employees SET insurance_comprehensive_wage = 0 WHERE id = ${e.id}::uuid`);
      await refused(prisma.$executeRaw`UPDATE contract_settings SET insurance_basic_default = 0 WHERE id = 1`);
    });
  });

  describe('the building number', () => {
    it('is kept on the profile, Arabic-Indic digits as 0-9, cleared by empty, and logged', async () => {
      const e = await newEmployee('Building Owner', { buildingNo: ' ١٢/٣ ' });
      const profile = (await api().get(`/api/employees/${e.id}`).set('Cookie', hr).expect(200)).body;
      expect(profile.buildingNo).toBe('12/3');
      expect((await auditOf('employee', e.id))[0].diff).toMatchObject({ buildingNo: '12/3' });

      for (const [typed, kept] of [['12أ', '12أ'], ['7 B', '7 B'], ['10-12', '10-12'], ['1234567890', '1234567890']]) {
        expect((await employee(e.id, { buildingNo: typed }).expect(200)).body.buildingNo).toBe(kept);
      }
      expect((await auditOf('employee', e.id)).at(-1)!.diff).toEqual({ buildingNo: { from: '10-12', to: '1234567890' } });
      expect((await employee(e.id, { buildingNo: '' }).expect(200)).body.buildingNo).toBeNull();
      expect((await employee(e.id, { buildingNo: '12' }).expect(200)).body.buildingNo).toBe('12');
      expect((await employee(e.id, { buildingNo: null }).expect(200)).body.buildingNo).toBeNull();
    });

    it('refuses more than 10 characters and anything but letters, digits, spaces, dashes and slashes', async () => {
      const e = await newEmployee('Building Checked');
      expect((await employee(e.id, { buildingNo: '12345678901' }).expect(400)).body.message).toEqual(['Keep the building number to 10 characters or fewer.']);
      for (const typed of ['12#', 'No. 5', '//', '12_3']) {
        expect((await employee(e.id, { buildingNo: typed }).expect(400)).body.message).toEqual(['Enter the building number as letters and digits, e.g. 12, 12أ or 12/3.']);
      }
    });

    it('the employee asks for it to change, as for the rest of the address, and HR approves', async () => {
      const email = await createUser(prisma, ['employee']);
      const e = await newEmployee('Building Asker', { workEmail: email });
      const self = await signIn(app, email);
      expect((await api().post(`/api/employees/${e.id}/change-requests`).set('Cookie', self).send({ changes: { buildingNo: '12#' } }).expect(400)).body.message).toEqual([
        'Enter the building number as letters and digits, e.g. 12, 12أ or 12/3.',
      ]);
      const asked = await api().post(`/api/employees/${e.id}/change-requests`).set('Cookie', self).send({ changes: { buildingNo: '٧ب' } }).expect(201);
      expect(asked.body.changes).toEqual([{ field: 'buildingNo', label: 'Building number', from: null, to: '7ب' }]);
      await api().post(`/api/change-requests/${asked.body.id}/approve`).set('Cookie', hr).send({}).expect(200);
      expect((await api().get(`/api/employees/${e.id}`).set('Cookie', self).expect(200)).body.buildingNo).toBe('7ب');
    });

    it('the database refuses an empty one or one longer than 10 characters', async () => {
      const e = await newEmployee('Building Database');
      await refused(prisma.$executeRaw`UPDATE employees SET building_no = '' WHERE id = ${e.id}::uuid`);
      await refused(prisma.$executeRaw`UPDATE employees SET building_no = '12345678901' WHERE id = ${e.id}::uuid`);
    });
  });

  describe('employee documents', () => {
    let employeeId: string;
    let jobTitleId: string;
    let versionId: string;
    const generate = () => api().post(`/api/employees/${employeeId}/documents`).set('Cookie', hr).send({ slotKey: 'insurance_form_1' });
    const check = () => api().get(`/api/employees/${employeeId}/documents/check?slotKey=insurance_form_1`).set('Cookie', hr);
    const saveFields = (fields: PdfField[]) => api().put(`/api/templates/versions/${versionId}/fields`).set('Cookie', hr).send({ fields });
    const printed = async (id: string) => shownLines(await shownGlyphs((await prisma.generatedDocument.findUniqueOrThrow({ where: { id }, select: { data: true } })).data));
    const NEEDED = [
      { tag: 'occupation_code', label: 'Occupation code (social insurance)', where: { tab: 'insurance', key: 'occupationCode' } },
      { tag: 'insurance_office', label: 'Social insurance office', where: { tab: 'company', key: 'insuranceOffice' } },
    ];

    beforeAll(async () => {
      jobTitleId = (await newJobTitle(`Insured clerk ${RUN}`)).id;
      const e = await newEmployee('Insured Person');
      employeeId = e.id;
      await api()
        .post(`/api/employees/${employeeId}/employments`)
        .set('Cookie', hr)
        .send({ employmentType: 'full_time', joinDate: '2026-01-15', departmentId, jobTitleId, gradeId, shiftId })
        .expect(201);
      const upload = await api().post('/api/templates/insurance_form_1/versions').set('Cookie', hr).attach('file', await formPdf([PAGE]), 'Form 1.pdf').expect(201);
      versionId = upload.body.id;
      const saved = await saveFields(FORM).expect(200);
      // optional is kept with each field
      expect(saved.body.fields).toEqual(FORM);
      expect(saved.body.version.tags).toEqual(['full_name_en', 'occupation_code', 'insurance_office', 'building_no', 'insurance_sector_code']);
      expect((await prisma.templateVersion.findUniqueOrThrow({ where: { id: versionId } })).pdfFields).toEqual(FORM);
      await api().post(`/api/templates/versions/${versionId}/publish`).set('Cookie', hr).expect(200);
    });

    it('refuses optional on a check box or a fixed text', async () => {
      const check = { id: 'tick', kind: 'check', tag: null, page: 1, x: 10, y: 10, width: 20, height: 20, fontSize: 12, optional: true };
      expect((await saveFields([...FORM, check as PdfField]).expect(400)).body.message).toBe(
        "A check box on page 1 can't be optional: only a text field or boxes are left blank when their value is missing.",
      );
      const fixed = { id: 'fixed', kind: 'fixed', tag: null, text: 'مكتب', page: 1, x: 10, y: 40, width: 100, height: 16, fontSize: 12, optional: true };
      expect((await saveFields([...FORM, fixed as PdfField]).expect(400)).body.message).toBe(
        "A fixed text on page 1 can't be optional: only a text field or boxes are left blank when their value is missing.",
      );
      expect((await saveFields([{ ...FORM[0], optional: 'yes' as unknown as boolean }]).expect(400)).body.message).toEqual(['Each field must have its kind, page, position, size and text size.']);
    });

    it('lists only the needed details as missing, saying where each is filled in; the optional ones don’t stop it', async () => {
      expect((await check().expect(200)).body).toEqual({ missing: NEEDED, usesRestricted: false });
      const refusedDoc = await generate().expect(422);
      expect(refusedDoc.body).toEqual({ statusCode: 422, message: 'Fill in the missing details first.', missing: NEEDED });
    });

    it('generates once they are filled in, the optional fields left blank; every number in ٠-٩', async () => {
      // the occupation is the employee's, set on their profile (owner's decision, 16 October 2026)
      await employee(employeeId, { occupationCode: '012100' }).expect(200);
      await company({ insuranceOffice: 'مكتب الدقي' }).expect(200);
      expect((await check().expect(200)).body.missing).toEqual([]);
      const doc = await generate().expect(201);
      // saved without Arabic digits, yet a social insurance form prints ٠-٩ (owner, 16 October 2026)
      expect(await printed(doc.body.id)).toEqual([ar(`Insured Person ${RUN}`), '٠١٢١٠٠', 'يقدلا بتكم']);
    });

    it('prints the optional ones when they have a value', async () => {
      await employee(employeeId, { buildingNo: '12أ' }).expect(200);
      await company({ insuranceSectorCode: '07' }).expect(200);
      const doc = await generate().expect(201);
      const lines = await printed(doc.body.id);
      expect(lines.slice(0, 3)).toEqual([ar(`Insured Person ${RUN}`), '٠١٢١٠٠', 'يقدلا بتكم']);
      expect(lines).toHaveLength(5);
      expect(lines[3]).toContain('١٢');
      expect(lines[4]).toBe('٠٧');
    });

    it('a tag any field prints without being optional still stops it', async () => {
      await employee(employeeId, { buildingNo: null }).expect(200);
      await company({ insuranceSectorCode: null }).expect(200);
      const again = { ...FORM[3], id: 'building-again', y: 350 };
      delete again.optional;
      await saveFields([...FORM, again]).expect(200);
      const missing = [{ tag: 'building_no', label: 'Building number', where: { tab: 'basic', key: 'buildingNo' } }];
      expect((await check().expect(200)).body.missing).toEqual(missing);
      expect((await generate().expect(422)).body.missing).toEqual(missing);
    });

    it('a preview prints an optional field with no value blank, a needed one as its label', async () => {
      const version = await prisma.templateVersion.findUniqueOrThrow({ where: { id: versionId }, select: { language: true, tags: true, data: true, format: true, pdfFields: true } });
      const preview = await app.get(DocumentsService).previewFill(employeeId, 'insurance_form_1', version, { id: hrId, email: 'hr@test.local', roles: ['hr'] });
      expect([preview.filled, preview.total]).toEqual([3, 5]);
      const lines = shownLines(await shownGlyphs(preview.data!));
      expect(lines.slice(0, 3)).toEqual([ar(`Insured Person ${RUN}`), '٠١٢١٠٠', 'يقدلا بتكم']);
      // the building number's needed field as its label, its optional one blank; the sector code's boxes blank
      expect(lines.slice(3)).toEqual(['[Building number]']);
    });
  });

  // Form 1's subscription start and wages: each the employee's own from the Social Insurance tab, else the join date,
  // the contract settings' default basic wage, the contract's gross and allowances (owner, 16 October 2026); the
  // insured wage, the comprehensive wage within this year's insurable limits (owner's decision, 16 October 2026)
  describe('Form 1’s subscription start and wages', () => {
    let employeeId: string;
    const pounds = (id: string, tag: string, y: number): PdfField => ({ id, kind: 'boxes', tag, page: 1, x: 100, y, width: 100, height: 18, fontSize: 12, boxes: 5, boxAlign: 'right', amountPart: 'pounds' });
    const FIELDS: PdfField[] = [
      { id: 'start', kind: 'boxes', tag: 'insurance_start_date', page: 1, x: 100, y: 100, width: 160, height: 18, fontSize: 12, boxes: 8, dateOrder: 'YMD' },
      pounds('basic', 'insurance_basic_salary', 150),
      pounds('insured', 'insurance_insured_salary', 200),
      pounds('total', 'insurance_total_salary', 250),
    ];
    const generate = () => api().post(`/api/employees/${employeeId}/documents`).set('Cookie', hr).send({ slotKey: 'insurance_form_1' });
    const check = () => api().get(`/api/employees/${employeeId}/documents/check?slotKey=insurance_form_1`).set('Cookie', hr);
    const printed = async (id: string) => shownLines(await shownGlyphs((await prisma.generatedDocument.findUniqueOrThrow({ where: { id }, select: { data: true } })).data));

    beforeAll(async () => {
      const job = await newJobTitle(`Waged clerk ${RUN}`);
      employeeId = (await newEmployee('Waged Insured')).id;
      await api()
        .post(`/api/employees/${employeeId}/employments`)
        .set('Cookie', hr)
        .send({ employmentType: 'full_time', joinDate: '2026-01-15', departmentId, jobTitleId: job.id, gradeId, shiftId })
        .expect(201);
      const upload = await api().post('/api/templates/insurance_form_1/versions').set('Cookie', hr).attach('file', await formPdf([PAGE]), 'Form 1.pdf').expect(201);
      await api().put(`/api/templates/versions/${upload.body.id}/fields`).set('Cookie', hr).send({ fields: FIELDS }).expect(200);
      await api().post(`/api/templates/versions/${upload.body.id}/publish`).set('Cookie', hr).expect(200);
    });

    it('without a contract or the employee’s own, the insured and comprehensive wages are missing, set on the Social Insurance tab', async () => {
      expect((await check().expect(200)).body).toEqual({
        missing: [
          // worked out from the comprehensive wage, so set there
          { tag: 'insurance_insured_salary', label: 'Insured wage (social insurance)', where: { tab: 'insurance', key: 'insuranceComprehensiveWage' } },
          { tag: 'insurance_total_salary', label: 'Comprehensive wage (social insurance)', where: { tab: 'insurance', key: 'insuranceComprehensiveWage' } },
        ],
        // the wages are salary data
        usesRestricted: true,
      });
    });

    it('prints the employee’s own, else the join date and the default basic wage; the insured wage capped, in ٠-٩', async () => {
      await employee(employeeId, { insuranceComprehensiveWage: 17250.75 }).expect(200);
      let doc = await generate().expect(201);
      // the comprehensive wage of 17,250.75 capped at this year's maximum insurable wage
      expect(await printed(doc.body.id)).toEqual([ar('20260115'), ar('410'), ar(String(LIMITS.max)), ar('17250')]);

      await employee(employeeId, { insuranceStartDate: '2026-02-01', insuranceBasicWage: 2500.5 }).expect(200);
      await api().patch('/api/contract-settings').set('Cookie', hr).send({ insuranceBasicDefault: 600 }).expect(200);
      doc = await generate().expect(201);
      expect(await printed(doc.body.id)).toEqual([ar('20260201'), ar('2500'), ar(String(LIMITS.max)), ar('17250')]);

      // within the limits, as it is; below the minimum, raised to it
      await employee(employeeId, { insuranceComprehensiveWage: LIMITS.min + 300 }).expect(200);
      doc = await generate().expect(201);
      expect((await printed(doc.body.id)).slice(2)).toEqual([ar(String(LIMITS.min + 300)), ar(String(LIMITS.min + 300))]);
      await employee(employeeId, { insuranceComprehensiveWage: LIMITS.min - 700 }).expect(200);
      doc = await generate().expect(201);
      expect((await printed(doc.body.id)).slice(2)).toEqual([ar(String(LIMITS.min)), ar(String(LIMITS.min - 700))]);

      // the employee's own basic wage cleared: the default as the contract settings say now
      await employee(employeeId, { insuranceBasicWage: null }).expect(200);
      doc = await generate().expect(201);
      expect((await printed(doc.body.id))[1]).toBe(ar('600'));
      await api().patch('/api/contract-settings').set('Cookie', hr).send({ insuranceBasicDefault: 410 }).expect(200);
    });
  });

  describe('job offers', () => {
    let physicist: string;
    let without: string;
    const offerRow = (id: string) => prisma.jobOffer.findUniqueOrThrow({ where: { id }, include: OFFER_INCLUDE, omit: WITHOUT_FILES });
    const draft = async (name: string, jobTitleId: string) =>
      (
        await api()
          .post('/api/offers')
          .set('Cookie', hr)
          .send({
            fullNameEn: `${name} ${RUN}`,
            fullNameAr: 'مرشح تجريبي',
            email: `${name.toLowerCase().replace(/\s+/g, '.')}.${RUN}@mail.test`,
            employmentType: 'full_time',
            joinDate: '2026-12-01',
            jobTitleId,
            gradeId,
            shiftId,
            grossSalary: 20000,
          })
          .expect(201)
      ).body as { id: string };
    const missingOf = async (id: string) => (await api().get(`/api/offers/${id}`).set('Cookie', hr).expect(200)).body.missing;

    beforeAll(async () => {
      physicist = (await newJobTitle(`Offered physicist ${RUN}`)).id;
      without = (await newJobTitle(`Offered clerk ${RUN}`)).id;
      await company({ insuranceOffice: 'مكتب الدقي', insuranceSectorCode: null }).expect(200);
      const body = p(r('{{full_name_en}} {{occupation_code}} {{occupation_name}} {{insurance_office}} {{insurance_sector_code}} {{city}}'));
      const upload = await api().post('/api/templates/offer_full_time/versions').set('Cookie', hr).attach('file', docx({ body }), 'Offer.docx').field('language', 'ar').expect(201);
      await api().post(`/api/templates/versions/${upload.body.id}/publish`).set('Cookie', hr).expect(200);
    });

    it('prints the company’s insurance details; never an occupation, which is the employee’s own', async () => {
      const o = await draft('Offered Physicist', physicist);
      const row = await offerRow(o.id);
      const template = await prisma.templateVersion.findFirstOrThrow({ where: { slotKey: 'offer_full_time', status: 'published' }, select: { language: true, tags: true, pdfFields: true } });
      await company({ insuranceSectorCode: '07' }).expect(200);
      const { values } = await app.get(OfferDocumentsService).check(row, offerSlot('full_time'), template, todayInCairo());
      expect(values).toMatchObject({ occupation_code: '', occupation_name: '', insurance_office: 'مكتب الدقي', insurance_sector_code: '07', city: '' });
      await company({ insuranceSectorCode: null }).expect(200);
    });

    it('prints the Social Insurance tab’s start and wages from the offer: its join date, the default basic wage, its gross within the limits, its gross', async () => {
      const o = await draft('Offered Wages', without);
      const row = await offerRow(o.id);
      const tags = ['insurance_start_date', 'insurance_basic_salary', 'insurance_insured_salary', 'insurance_total_salary', 'insured_salary'];
      const { values, missing } = await app.get(OfferDocumentsService).check(row, offerSlot('full_time'), { language: 'ar', tags, pdfFields: null }, todayInCairo());
      expect(values).toMatchObject({ insurance_start_date: '01/12/2026', insurance_basic_salary: '410', insurance_total_salary: '20,000' });
      // the comprehensive wage (the gross of 20,000, no allowances) capped at this year's maximum insurable wage, as
      // {{insured_salary}} prints the offer's
      expect(values.insurance_insured_salary).toBe(LIMITS.max.toLocaleString('en-US'));
      expect(values.insurance_insured_salary).toBe(values.insured_salary);
      expect(missing).toEqual([]);
    });

    it('says where each missing one is filled in: the company, or the template for the address and occupation an offer never has', async () => {
      const o = await draft('Offered Clerk', without);
      expect(await missingOf(o.id)).toEqual([
        { tag: 'occupation_code', label: 'Occupation code (social insurance)', where: { tab: 'offer', key: 'template' } },
        { tag: 'occupation_name', label: 'Occupation (social insurance)', where: { tab: 'offer', key: 'template' } },
        { tag: 'insurance_sector_code', label: 'Sector code (social insurance)', where: { tab: 'company', key: 'insuranceSectorCode' } },
        { tag: 'city', label: 'City or district (Arabic)', where: { tab: 'offer', key: 'template' } },
      ]);
      // whichever job title is chosen
      const chosen = await draft('Offered Physicist Two', physicist);
      expect((await missingOf(chosen.id)).map((m: { tag: string }) => m.tag)).toEqual(['occupation_code', 'occupation_name', 'insurance_sector_code', 'city']);
    });

    it('a PDF form’s optional fields don’t stop an offer; a needed one does', async () => {
      const fields: PdfField[] = [
        { id: 'name', kind: 'text', tag: 'full_name_en', page: 1, x: 100, y: 100, width: 300, height: 16, fontSize: 12, align: 'left' },
        { id: 'building', kind: 'text', tag: 'building_no', page: 1, x: 100, y: 150, width: 100, height: 16, fontSize: 12, optional: true },
        { id: 'city', kind: 'text', tag: 'city', page: 1, x: 100, y: 200, width: 100, height: 16, fontSize: 12, optional: true },
      ];
      const upload = await api().post('/api/templates/offer_full_time/versions').set('Cookie', hr).attach('file', await formPdf([PAGE]), 'Offer.pdf').field('language', 'en').expect(201);
      await api().put(`/api/templates/versions/${upload.body.id}/fields`).set('Cookie', hr).send({ fields }).expect(200);
      await api().post(`/api/templates/versions/${upload.body.id}/publish`).set('Cookie', hr).expect(200);

      const o = await draft('Offered On A Form', without);
      expect(await missingOf(o.id)).toEqual([]);
      const filled = await app.get(OfferDocumentsService).fill(await offerRow(o.id), todayInCairo());
      expect(shownLines(await shownGlyphs(filled.data))).toEqual([`Offered On A Form ${RUN}`]);

      // the city printed again, not optional: the offer never has it, so the template is what needs changing
      await api()
        .put(`/api/templates/versions/${upload.body.id}/fields`)
        .set('Cookie', hr)
        .send({ fields: [...fields, { ...fields[2], id: 'city-again', y: 250, optional: false }] })
        .expect(200);
      expect(await missingOf(o.id)).toEqual([{ tag: 'city', label: 'City or district (Arabic)', where: { tab: 'offer', key: 'template' } }]);
      await expect(app.get(OfferDocumentsService).fill(await offerRow(o.id), todayInCairo())).rejects.toMatchObject({ status: 422 });
    });
  });
});
