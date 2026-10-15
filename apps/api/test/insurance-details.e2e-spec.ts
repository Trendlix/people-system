import type { INestApplication } from '@nestjs/common';
import type { PdfField } from '@trendlix/shared';
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
// insurance office and sector code, each job title's occupation in the social insurance table, and the building number
// of an employee's address; printed by their tags on employee documents and job offers. And a PDF form's optional
// fields: left blank when their value is missing, rather than stopping the document.

const RUN = Date.now().toString(36);
const PAGE = { width: 612, height: 1008 };
const OCCUPATION = 'Choose the occupation from the social insurance list.';

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
    it('take an occupation from the social insurance table, shown with its name in the list and the detail', async () => {
      const job = await newJobTitle(`Physicist ${RUN}`, { occupationCode: '012100' });
      expect(job).toMatchObject({ occupationCode: '012100', occupationName: 'فيزيائي عام' });
      expect((await api().get(`/api/job-titles/${job.id}`).set('Cookie', staff).expect(200)).body).toMatchObject({ occupationCode: '012100', occupationName: 'فيزيائي عام' });
      const list = (await api().get(`/api/job-titles?departmentId=${departmentId}`).set('Cookie', staff).expect(200)).body as { id: string }[];
      expect(list.find((j) => j.id === job.id)).toMatchObject({ occupationCode: '012100', occupationName: 'فيزيائي عام' });
      expect((await auditOf('job_title', job.id))[0]).toMatchObject({ action: 'create', diff: { occupationCode: '012100' } });

      // one without: both null
      const plain = await newJobTitle(`Clerk ${RUN}`);
      expect(plain).toMatchObject({ occupationCode: null, occupationName: null });
      expect((await api().get('/api/job-titles').set('Cookie', hr).expect(200)).body.find((j: { id: string }) => j.id === plain.id)).toMatchObject({ occupationCode: null, occupationName: null });
    });

    it('change it (Arabic-Indic digits as 0-9), clear it with null, and log each change', async () => {
      const job = await newJobTitle(`Site engineer ${RUN}`);
      expect((await jobTitle(job.id, { occupationCode: '٠٢٢١٢٠' }).expect(200)).body).toMatchObject({ occupationCode: '022120', occupationName: 'مهندس موقع' });
      // sending the same again changes nothing
      await jobTitle(job.id, { occupationCode: '022120' }).expect(200);
      expect((await jobTitle(job.id, { occupationCode: null }).expect(200)).body).toMatchObject({ occupationCode: null, occupationName: null });
      expect((await auditOf('job_title', job.id)).slice(1).map((a) => a.diff)).toEqual([{ occupationCode: { from: null, to: '022120' } }, { occupationCode: { from: '022120', to: null } }]);
    });

    it('refuse a code not in the table, or not six digits', async () => {
      const job = await newJobTitle(`Analyst ${RUN}`);
      for (const code of ['000001', '12345', '0121000', 'abcdef', '012 100']) {
        expect((await jobTitle(job.id, { occupationCode: code }).expect(400)).body.message).toEqual([OCCUPATION]);
      }
      expect((await jobTitle(job.id, { occupationCode: 12100 }).expect(400)).body.message).toEqual([OCCUPATION]);
      expect((await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId, titleEn: `Nobody ${RUN}`, occupationCode: '999998' }).expect(400)).body.message).toEqual([OCCUPATION]);
      expect((await api().get(`/api/job-titles/${job.id}`).set('Cookie', hr).expect(200)).body.occupationCode).toBeNull();
    });

    it('the database refuses a code that isn’t six digits', async () => {
      const job = await newJobTitle(`Checked ${RUN}`);
      await refused(prisma.$executeRaw`UPDATE job_titles SET occupation_code = '12345' WHERE id = ${job.id}::uuid`);
      await refused(prisma.$executeRaw`UPDATE job_titles SET occupation_code = 'abcdef' WHERE id = ${job.id}::uuid`);
    });
  });

  describe('the employee profile', () => {
    it('names the job title’s occupation in the employment, for the Social Insurance tab', async () => {
      const job = await newJobTitle(`Sales manager ${RUN}`, { occupationCode: '212300' });
      const e = await newEmployee('Occupied Person');
      await api()
        .post(`/api/employees/${e.id}/employments`)
        .set('Cookie', hr)
        .send({ employmentType: 'full_time', joinDate: '2026-01-15', departmentId, jobTitleId: job.id, gradeId, shiftId })
        .expect(201);
      const profile = (await api().get(`/api/employees/${e.id}`).set('Cookie', hr).expect(200)).body;
      expect(profile.employment.jobTitle).toEqual({
        id: job.id,
        departmentId,
        titleEn: `Sales manager ${RUN}`,
        titleAr: null,
        jdVersion: 1,
        occupationCode: '212300',
        occupationName: 'مدير مبيعات',
      });
      expect(profile.employments[0].jobTitle).toEqual(profile.employment.jobTitle);

      // read from the job title each time: cleared there, none here
      await jobTitle(job.id, { occupationCode: null }).expect(200);
      expect((await api().get(`/api/employees/${e.id}`).set('Cookie', hr).expect(200)).body.employment.jobTitle).toMatchObject({ occupationCode: null, occupationName: null });
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
      { tag: 'occupation_code', label: 'Occupation code (social insurance)', where: { tab: 'departments', key: 'occupationCode' } },
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

    it('generates once they are filled in, the optional fields left blank', async () => {
      await jobTitle(jobTitleId, { occupationCode: '012100' }).expect(200);
      await company({ insuranceOffice: 'مكتب الدقي' }).expect(200);
      expect((await check().expect(200)).body.missing).toEqual([]);
      const doc = await generate().expect(201);
      expect(await printed(doc.body.id)).toEqual([`Insured Person ${RUN}`, '012100', 'يقدلا بتكم']);
    });

    it('prints the optional ones when they have a value', async () => {
      await employee(employeeId, { buildingNo: '12أ' }).expect(200);
      await company({ insuranceSectorCode: '07' }).expect(200);
      const doc = await generate().expect(201);
      const lines = await printed(doc.body.id);
      expect(lines.slice(0, 3)).toEqual([`Insured Person ${RUN}`, '012100', 'يقدلا بتكم']);
      expect(lines).toHaveLength(5);
      expect(lines[3]).toContain('12');
      expect(lines[4]).toBe('07');
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
      expect(lines.slice(0, 3)).toEqual([`Insured Person ${RUN}`, '012100', 'يقدلا بتكم']);
      // the building number's needed field as its label, its optional one blank; the sector code's boxes blank
      expect(lines.slice(3)).toEqual(['[Building number]']);
    });
  });

  describe('job offers', () => {
    let withOccupation: string;
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
      withOccupation = (await newJobTitle(`Offered physicist ${RUN}`, { occupationCode: '012100' })).id;
      without = (await newJobTitle(`Offered clerk ${RUN}`)).id;
      await company({ insuranceOffice: 'مكتب الدقي', insuranceSectorCode: null }).expect(200);
      const body = p(r('{{full_name_en}} {{occupation_code}} {{occupation_name}} {{insurance_office}} {{insurance_sector_code}} {{city}}'));
      const upload = await api().post('/api/templates/offer_full_time/versions').set('Cookie', hr).attach('file', docx({ body }), 'Offer.docx').field('language', 'ar').expect(201);
      await api().post(`/api/templates/versions/${upload.body.id}/publish`).set('Cookie', hr).expect(200);
    });

    it('prints the selected job title’s occupation and the company’s insurance details', async () => {
      const o = await draft('Offered Physicist', withOccupation);
      const row = await offerRow(o.id);
      const template = await prisma.templateVersion.findFirstOrThrow({ where: { slotKey: 'offer_full_time', status: 'published' }, select: { language: true, tags: true, pdfFields: true } });
      await company({ insuranceSectorCode: '07' }).expect(200);
      const { values } = await app.get(OfferDocumentsService).check(row, offerSlot('full_time'), template, todayInCairo());
      expect(values).toMatchObject({ occupation_code: '012100', occupation_name: 'فيزيائي عام', insurance_office: 'مكتب الدقي', insurance_sector_code: '07', city: '' });
      await company({ insuranceSectorCode: null }).expect(200);
    });

    it('says where each missing one is filled in: the job title, the company, or the template for the address an offer never has', async () => {
      const o = await draft('Offered Clerk', without);
      expect(await missingOf(o.id)).toEqual([
        { tag: 'occupation_code', label: 'Occupation code (social insurance)', where: { tab: 'departments', key: 'occupationCode' } },
        { tag: 'occupation_name', label: 'Occupation (social insurance)', where: { tab: 'departments', key: 'occupationCode' } },
        { tag: 'insurance_sector_code', label: 'Sector code (social insurance)', where: { tab: 'company', key: 'insuranceSectorCode' } },
        { tag: 'city', label: 'City or district (Arabic)', where: { tab: 'offer', key: 'template' } },
      ]);
      const chosen = await draft('Offered Physicist Two', withOccupation);
      expect((await missingOf(chosen.id)).map((m: { tag: string }) => m.tag)).toEqual(['insurance_sector_code', 'city']);
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
