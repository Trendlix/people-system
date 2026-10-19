import { createHash } from 'node:crypto';
import { PDFDocument } from '@cantoo/pdf-lib';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PdfField } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PdfService, protectPdf } from '../src/pdf/pdf.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { STARTER_LAYOUTS_TOKEN, type StarterLayout } from '../src/templates/starter-layouts.js';
import { docx, p, r } from './fixtures/docx.js';
import { hasEncrypt } from './fixtures/pdf.js';
import { formPdf, shownGlyphs, shownLines } from './fixtures/pdf-form.js';
import { createUser, signIn } from './helpers.js';

// PDF templates (owner's decision, 15 October 2026): the social insurance forms uploaded as the PDFs they are issued
// as, a Super Admin placing each field on them once (only a Super Admin edits templates: owner, 19 October 2026), and
// every document the original PDF with the values printed where the fields
// were placed, given out as a protected PDF like any other. No PDF converter is set up here, and none is needed. A
// version already uploaded takes the standard layout of its form on request (owner, 16 October 2026).

const RUN = Date.now().toString(36);
const DIGITS = String(Date.now() % 10_000_000).padStart(7, '0');
const NATIONAL_ID = `2960514${DIGITS}`; // born 14 May 1996
const PAGE = { width: 612, height: 1008 };
const ONLY_SUPER_ADMIN_EDITS = 'Only a Super Admin uploads, edits or publishes templates.';

/** Reads a response body as bytes, whatever its type. */
const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** The fields of Form 1 for these tests: a name, the national ID's boxes, the join date's boxes, a check box and a fixed text. */
const FORM_1: PdfField[] = [
  { id: 'nid', kind: 'boxes', tag: 'national_id', page: 1, x: 211.3, y: 284, width: 277.8, height: 19.9, fontSize: 12, boxes: 14 },
  { id: 'name', kind: 'text', tag: 'full_name_ar', page: 1, x: 313.2, y: 308.2, width: 179.7, height: 13, fontSize: 11, align: 'right', shrinkToFit: true },
  { id: 'category', kind: 'check', tag: null, page: 1, x: 397.2, y: 108.2, width: 19.8, height: 19.8, fontSize: 14 },
  { id: 'start', kind: 'boxes', tag: 'join_date', page: 1, x: 289, y: 358.2, width: 160.1, height: 17, fontSize: 11, boxes: 8, groups: [4, 2, 2], groupGap: 12.15, dateOrder: 'YMD' },
  { id: 'insurance', kind: 'boxes', tag: 'insurance_no', page: 1, x: 311, y: 256.4, width: 178.8, height: 19.9, fontSize: 12, boxes: 9, boxAlign: 'right' },
  { id: 'office', kind: 'fixed', tag: null, text: 'مكتب الدقي', page: 2, x: 100, y: 100, width: 200, height: 16, fontSize: 12 },
];

describe('PDF templates (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let admin: string;
  let superAdmin: string;
  let ceo: string;
  let staff: string;
  let form: Buffer;
  let starterForm: Buffer;
  let badStarterForm: Buffer;
  let form1: { id: string };
  let employeeId: string;
  let employeeCode: string;
  const api = () => request(app.getHttpServer());

  // uploading, placing fields and publishing are a Super Admin's; HR, Admin and the CEO read
  const upload = (slot: string, file: Buffer, fileName: string, cookie = superAdmin) => api().post(`/api/templates/${slot}/versions`).set('Cookie', cookie).attach('file', file, fileName);
  const fieldsOf = (id: string, cookie = hr) => api().get(`/api/templates/versions/${id}/fields`).set('Cookie', cookie);
  const save = (id: string, fields: unknown, cookie = superAdmin) => api().put(`/api/templates/versions/${id}/fields`).set('Cookie', cookie).send({ fields });
  const sample = (id: string, fields: unknown, cookie = hr) =>
    api().post(`/api/templates/versions/${id}/fields/sample`).set('Cookie', cookie).send({ fields }).buffer(true).parse(bytes);
  const publish = (id: string) => api().post(`/api/templates/versions/${id}/publish`).set('Cookie', superAdmin);
  const standard = (id: string, cookie = superAdmin) => api().post(`/api/templates/versions/${id}/fields/standard`).set('Cookie', cookie);
  /** The message of a refusal read as bytes. */
  const messageOf = (res: request.Response) => (JSON.parse((res.body as Buffer).toString('utf8')) as { message: string }).message;
  const auditOf = (id: string) => prisma.auditLog.findMany({ where: { entityType: 'template_version', entityId: id }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    form = await formPdf([PAGE, PAGE]);
    starterForm = await formPdf([PAGE]);
    badStarterForm = await formPdf([{ width: 600, height: 800 }]);
    // the layouts the system would know, for these tests' files: one that fits, one placed on a page the file hasn't got
    const starters: StarterLayout[] = [
      {
        slotKey: 'insurance_form_6',
        sha256: [sha256(starterForm)],
        pages: [PAGE],
        note: 'Form 6 (test)',
        fields: [
          { id: 'end', kind: 'boxes', tag: 'last_working_day', page: 1, x: 271.6, y: 324.5, width: 198.4, height: 21.2, fontSize: 12, boxes: 8, dateOrder: 'YMD' },
          { id: 'name', kind: 'text', tag: 'full_name_ar', page: 1, x: 306.9, y: 285.6, width: 211.2, height: 13, fontSize: 11 },
        ],
      },
      {
        slotKey: 'insurance_form_1',
        sha256: [sha256(badStarterForm)],
        pages: [{ width: 600, height: 800 }],
        note: 'Form 1 (wrong pages)',
        fields: [{ id: 'name', kind: 'text', tag: 'full_name_ar', page: 2, x: 10, y: 10, width: 100, height: 13, fontSize: 11 }],
      },
    ];
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(STARTER_LAYOUTS_TOKEN).useValue(starters).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    // no converter here: a PDF form needs none
    expect(app.get(PdfService).available).toBe(false);

    await prisma.generatedDocument.deleteMany();
    await prisma.jobOffer.updateMany({ data: { templateVersionId: null } });
    await prisma.templateVersion.deleteMany();
    hr = await signIn(app, await createUser(prisma, ['hr']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    staff = await signIn(app, await createUser(prisma, ['employee']));

    // a full-time employee with what Form 1 prints
    const dept = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Forms ${RUN}`, nameAr: 'النماذج' }).expect(201);
    const title = await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId: dept.body.id, titleEn: 'Clerk', titleAr: 'كاتب' }).expect(201);
    const gradeId = ((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((g) => g.code === 'G4')!.id;
    const shiftId = ((await api().get('/api/shifts').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((s) => s.code === 'A')!.id;
    const person = await api()
      .post('/api/employees')
      .set('Cookie', hr)
      .send({ fullNameEn: `Mohamed Forms ${RUN}`, fullNameAr: 'محمد أحمد عبد الرحمن', insuranceNo: `7${DIGITS}` })
      .expect(201);
    employeeId = person.body.id;
    employeeCode = person.body.employeeCode;
    await api()
      .post(`/api/employees/${employeeId}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: '2026-01-15', departmentId: dept.body.id, jobTitleId: title.body.id, gradeId, shiftId })
      .expect(201);
    await api().patch(`/api/employees/${employeeId}/identity`).set('Cookie', hr).send({ nationalId: NATIONAL_ID, printedNo: 'KX7654321', issueDate: '2022-05-10' }).expect(200);
  });

  afterAll(async () => {
    await prisma.generatedDocument.deleteMany();
    await app.close();
  });

  it('a Super Admin uploads a PDF form: a draft with its pages as shown, no fields yet, its name ending in .pdf', async () => {
    const res = await upload('insurance_form_1', form, 'نموذج 1.pdf').field('note', 'As issued').expect(201);
    form1 = res.body;
    expect(res.body).toEqual({
      id: expect.any(String),
      version: 1,
      fileName: 'نموذج 1.pdf',
      sizeBytes: form.length,
      format: 'pdf',
      pageCount: 2,
      fieldCount: 0,
      language: 'ar',
      tags: [],
      unknownTags: [],
      broken: [],
      status: 'draft',
      note: 'As issued',
      uploadedBy: { email: expect.any(String) },
      uploadedAt: expect.any(String),
      publishedBy: null,
      publishedAt: null,
      usedBy: 0,
    });
    const row = await prisma.templateVersion.findUniqueOrThrow({ where: { id: form1.id } });
    expect([row.mimeType, row.format, row.pdfPages, row.pdfFields]).toEqual(['application/pdf', 'pdf', [PAGE, PAGE], []]);
    expect((await auditOf(form1.id)).map((a) => a.diff)).toEqual([
      { slot: 'insurance_form_1', version: 1, fileName: 'نموذج 1.pdf', language: 'ar', tags: 0, unknownTags: 0, broken: 0, format: 'pdf', pages: 2, fields: 0 },
    ]);
    const slot = (await api().get('/api/templates').set('Cookie', hr).expect(200)).body.find((s: { key: string }) => s.key === 'insurance_form_1');
    expect(slot.latestDraft).toMatchObject({ id: form1.id, format: 'pdf', fieldCount: 0 });
  });

  it('refuses a protected PDF and one of more than 20 pages', async () => {
    const locked = await upload('insurance_form_1', await protectPdf(form), 'locked.pdf').expect(400);
    expect(locked.body.message).toBe('This PDF is protected. Save an unprotected copy of it and upload that.');
    const long = await upload('insurance_form_1', await formPdf(Array.from({ length: 21 }, () => PAGE)), 'long.pdf').expect(400);
    expect(long.body.message).toBe("This PDF has 21 pages; a form can have at most 20. Upload only the form's pages.");
    expect(await prisma.templateVersion.count({ where: { slotKey: 'insurance_form_1' } })).toBe(1);
  });

  it('gives the fields with the pages, to HR, Admin and the CEO only', async () => {
    const res = await fieldsOf(form1.id).expect(200);
    expect(res.body).toEqual({
      version: expect.objectContaining({ id: form1.id, format: 'pdf', pageCount: 2, fieldCount: 0 }),
      pages: [PAGE, PAGE],
      fields: [],
      editable: true,
      standardLayout: false,
    });
    await fieldsOf(form1.id, admin).expect(200);
    await fieldsOf(form1.id, ceo).expect(200);
    await fieldsOf(form1.id, staff).expect(403);
    await fieldsOf('00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('does not publish a PDF form before its fields are placed', async () => {
    expect((await publish(form1.id).expect(400)).body.message).toBe('Place the fields on the form before publishing it.');
  });

  it('refuses fields that are wrong, saying which and where', async () => {
    const say = async (fields: unknown) => (await save(form1.id, fields).expect(400)).body.message as string | string[];
    expect(await say([{ ...FORM_1[1], tag: 'salary' }])).toBe("A text field on page 1 prints {{salary}}, which the system doesn't know. Choose another field.");
    expect(await say([{ ...FORM_1[0], page: 3 }])).toBe('The boxes for "National ID number" is on page 3, but the form has 2 pages.');
    expect(await say([{ ...FORM_1[0], boxes: 41 }])).toBe('The boxes for "National ID number" on page 1 must cover 1 to 40 boxes.');
    expect(await say([{ ...FORM_1[1], x: 600 }])).toBe('The text field for "Full name (Arabic)" on page 1 goes past the edge of the page: move it inside the page.');
    expect(await say([FORM_1[1], { ...FORM_1[0], id: 'name' }])).toBe('Two fields have the id "name": each field needs its own.');
    // its shape: what every field must have, and nothing a field hasn't
    expect(await say([{ ...FORM_1[1], x: undefined }])).toEqual(['Each field must have its kind, page, position, size and text size.']);
    expect(await say([{ ...FORM_1[1], colour: 'red' }])).toEqual(['property colour should not exist']);
    expect(await say('all of them')).toEqual(expect.arrayContaining(['Send the fields as a list, e.g. [] for none.']));
    // only a Super Admin places them (owner, 19 October 2026)
    for (const session of [hr, admin, ceo]) expect((await save(form1.id, FORM_1, session).expect(403)).body.message).toBe(ONLY_SUPER_ADMIN_EDITS);
    await save(form1.id, FORM_1, staff).expect(403);
    expect((await fieldsOf(form1.id).expect(200)).body.fields).toEqual([]);
  });

  it('saves the fields: the tags worked out from them down the page, recorded with counts', async () => {
    const res = await save(form1.id, FORM_1).expect(200);
    expect(res.body.fields).toEqual(FORM_1);
    expect(res.body.version).toMatchObject({ fieldCount: 6, tags: ['insurance_no', 'national_id', 'full_name_ar', 'join_date'] });
    expect(res.body.editable).toBe(true);
    expect((await auditOf(form1.id)).at(-1)).toMatchObject({
      action: 'update',
      diff: { slot: 'insurance_form_1', version: 1, status: 'draft', fields: { from: 0, to: 6 }, tags: { from: 0, to: 4 } },
    });
  });

  // a text field that wraps onto more than one line (owner, 16 October 2026: Form 1's المؤهل printed tiny on one)
  it('keeps a text field’s lines, 1 to 4, on text and fixed text only; a sample prints with them', async () => {
    const qualification: PdfField = { id: 'qualification', kind: 'text', tag: 'qualification', page: 1, x: 429.2, y: 324.5, width: 99.9, height: 25.3, fontSize: 12, align: 'right', shrinkToFit: true, lines: 2 };
    const saved = await save(form1.id, [...FORM_1, qualification]).expect(200);
    expect(saved.body.fields.at(-1)).toEqual(qualification);
    expect((await fieldsOf(form1.id).expect(200)).body.fields.at(-1)).toEqual(qualification);
    await sample(form1.id, [qualification], hr).expect(200);
    expect((await save(form1.id, [{ ...qualification, lines: 5 }]).expect(400)).body.message).toMatch(/: choose 1 to 4 lines\.$/);
    expect((await save(form1.id, [{ ...FORM_1[0], lines: 2 }]).expect(400)).body.message).toMatch(/can't take more than one line: only a text field or fixed text wraps\.$/);
    // as it was, for the tests after this one
    await save(form1.id, FORM_1).expect(200);
  });

  it('fills a sample in with made-up values where the fields sent place them, unprotected, shown in the browser', async () => {
    const res = await sample(form1.id, FORM_1.slice(0, 2), ceo).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^inline; .*sample\.pdf/);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'");
    const pdf = res.body as Buffer;
    expect(hasEncrypt(pdf)).toBe(false);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
    // the national ID's boxes with a made-up number, the name's line with the field's name (read as seen, reversed); a
    // social insurance form prints its numbers in ٠-٩ whatever the fields say (owner, 16 October 2026)
    const lines = shownLines(await shownGlyphs(pdf));
    expect(lines[0]).toBe('٢٩٠٠١٠١١٢٣٤٥٦٧');
    expect(lines[1].replace(/\s+/g, '').length).toBeGreaterThan(5);
    // the fields sent are checked as for saving, and nothing is saved
    expect(messageOf(await sample(form1.id, [{ ...FORM_1[0], fontSize: 2 }]).expect(400))).toBe(
      'The boxes for "National ID number" on page 1: choose a text size of 5 to 36 points.',
    );
    await sample(form1.id, FORM_1, staff).expect(403);
    expect((await fieldsOf(form1.id).expect(200)).body.fields).toHaveLength(6);
  });

  it('a Word version has no fields to place', async () => {
    const word = await upload('nda', docx({ body: p(r('{{full_name_ar}}')) }), 'NDA.docx').field('language', 'ar').expect(201);
    expect(word.body).toMatchObject({ format: 'docx', pageCount: null, fieldCount: null });
    const message = 'Version 1 is a Word file: its fields are the {{tags}} typed in it. Fields are placed only on a PDF form.';
    expect((await fieldsOf(word.body.id).expect(409)).body.message).toBe(message);
    expect((await save(word.body.id, FORM_1).expect(409)).body.message).toBe(message);
    expect(messageOf(await sample(word.body.id, []).expect(409))).toBe(message);
    expect((await standard(word.body.id).expect(409)).body.message).toBe(message);
  });

  it('downloads the PDF as uploaded, or shows it in the browser, with no converter', async () => {
    const file = await api().get(`/api/templates/versions/${form1.id}/file`).set('Cookie', ceo).buffer(true).parse(bytes).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toMatch(/^attachment; .*\.pdf/);
    expect(Buffer.compare(file.body as Buffer, form)).toBe(0);
    const shown = await api().get(`/api/templates/versions/${form1.id}/file?format=pdf`).set('Cookie', ceo).buffer(true).parse(bytes).expect(200);
    expect(shown.headers['content-disposition']).toMatch(/^inline; .*\.pdf"/);
    expect(Buffer.compare(shown.body as Buffer, form)).toBe(0);
  });

  it('renames a PDF version keeping .pdf', async () => {
    const rename = (fileName: string) => api().patch(`/api/templates/versions/${form1.id}`).set('Cookie', superAdmin).send({ fileName });
    expect((await rename('Form one').expect(200)).body.fileName).toBe('Form one.pdf');
    expect((await rename('Form 1.docx').expect(200)).body.fileName).toBe('Form 1.pdf');
    expect((await rename('نموذج 1').expect(200)).body.fileName).toBe('نموذج 1.pdf');
  });

  it('publishes it once its fields are placed; the one in use keeps at least one field', async () => {
    expect((await publish(form1.id).expect(200)).body).toMatchObject({ status: 'published', fieldCount: 6 });
    // a box printed a little off is put right on the version in use
    const nudged = FORM_1.map((f) => (f.id === 'nid' ? { ...f, x: 212 } : f));
    expect((await save(form1.id, nudged).expect(200)).body.fields[0].x).toBe(212);
    expect((await save(form1.id, []).expect(400)).body.message).toBe('Version 1 is in use, so it keeps its fields: place at least one.');
  });

  it('generates Form 1 for an employee: the original PDF with the values printed, given out as a protected PDF', async () => {
    const res = await api().post(`/api/employees/${employeeId}/documents`).set('Cookie', hr).send({ slotKey: 'insurance_form_1' }).expect(201);
    expect(res.body.fileName).toBe(`Social insurance Form 1 (joining) - ${employeeCode} - Mohamed Forms ${RUN}.pdf`);

    // kept as the filled PDF, unprotected inside the system
    const kept = Buffer.from((await prisma.generatedDocument.findUniqueOrThrow({ where: { id: res.body.id }, select: { data: true } })).data);
    expect(kept.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // read back as seen, the Arabic reversed; a letter with a hamza is drawn as its letter and the hamza, and may read
    // back without it
    const lines = shownLines(await shownGlyphs(kept)).map((l) => l.replace(/[أإآ]/g, 'ا'));
    // every number in ٠-٩ on a social insurance form (owner, 16 October 2026)
    const ar = (digits: string) => digits.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
    expect(lines).toEqual([ar('7' + DIGITS), ar(NATIONAL_ID), 'نمحرلا دبع دمحا دمحم', ar('20260115')]);
    expect(shownLines(await shownGlyphs(kept), 2)).toEqual(['يقدلا بتكم']);

    // given out protected, with no converter
    const file = await api().get(`/api/documents/${res.body.id}/file?download=1`).set('Cookie', hr).buffer(true).parse(bytes).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toMatch(/^attachment; .*\.pdf/);
    expect(hasEncrypt(file.body as Buffer)).toBe(true);
    const opened = await PDFDocument.load(file.body as Buffer, { password: '' });
    expect(opened.getPageCount()).toBe(2);
    expect(opened.getPage(0).getSize()).toEqual(PAGE);

    // for e-signature: the same PDF, unprotected
    const signing = await api().get(`/api/documents/${res.body.id}/esign-file`).set('Cookie', hr).buffer(true).parse(bytes).expect(200);
    expect(hasEncrypt(signing.body as Buffer)).toBe(false);
    expect(signing.headers['content-disposition']).toMatch(/\(for e-signature\)\.pdf/);

    // the version it was made from is kept with it
    const detail = await api().get('/api/templates/insurance_form_1').set('Cookie', hr).expect(200);
    expect(detail.body.versions[0]).toMatchObject({ id: form1.id, usedBy: 1 });
  });

  it('previews the PDF form with an employee’s data, as a protected PDF', async () => {
    const res = await api().get(`/api/templates/versions/${form1.id}/preview?employeeId=${employeeId}`).set('Cookie', ceo).buffer(true).parse(bytes).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['x-preview-employee']).toBe(employeeId);
    expect(res.headers['content-disposition']).toMatch(/preview.*\.pdf/);
    expect(hasEncrypt(res.body as Buffer)).toBe(true);
  });

  it('a replaced version’s fields are kept as they were', async () => {
    const next = await upload('insurance_form_1', form, 'نموذج 1.pdf').expect(201);
    await save(next.body.id, FORM_1).expect(200);
    await publish(next.body.id).expect(200);
    const old = await fieldsOf(form1.id).expect(200);
    expect(old.body.editable).toBe(false);
    expect((await save(form1.id, FORM_1).expect(409)).body.message).toBe("Version 1 was replaced, so its fields can't be changed. Upload the form again to make it a new version.");
  });

  it('places a starter layout for a form the system knows, uploaded to its slot', async () => {
    const res = await upload('insurance_form_6', starterForm, 'نموذج 6.pdf').expect(201);
    expect(res.body).toMatchObject({ format: 'pdf', pageCount: 1, fieldCount: 2, tags: ['full_name_ar', 'last_working_day'] });
    expect((await auditOf(res.body.id))[0].diff).toMatchObject({ format: 'pdf', fields: 2, starterLayout: 'Form 6 (test)' });
    // another file of the slot with the same pages (the form saved again, as the owner does): the same layout
    const resaved = await formPdf([{ ...PAGE, cropBox: [0, 0, PAGE.width, PAGE.height] }]);
    expect(sha256(resaved)).not.toBe(sha256(starterForm));
    expect((await upload('insurance_form_6', resaved, 'نموذج 6 (2).pdf').expect(201)).body.fieldCount).toBe(2);
    // the same file in another slot, a file of the slot with other pages, or a layout that doesn't fit the file: no fields
    expect((await upload('nda', starterForm, 'x.pdf').field('language', 'ar').expect(201)).body.fieldCount).toBe(0);
    expect((await upload('insurance_form_6', form, 'x.pdf').expect(201)).body.fieldCount).toBe(0);
    const misfit = await upload('insurance_form_1', badStarterForm, 'x.pdf').expect(201);
    expect(misfit.body).toMatchObject({ pageCount: 1, fieldCount: 0 });
    expect((await auditOf(misfit.body.id))[0].diff).not.toHaveProperty('starterLayout');
  });
  // Use the standard layout (owner, 16 October 2026): a layout improved after a form was uploaded reaches that version
  // without uploading it again
  describe('the standard layout', () => {
    const NONE = 'There is no standard layout for this form.';
    const STARTER = ['end', 'name'];

    it('says whether the system has one for the version’s form: the same file or the same pages in its slot', async () => {
      const known = await upload('insurance_form_6', starterForm, 'Form 6.pdf').expect(201);
      expect((await fieldsOf(known.body.id).expect(200)).body.standardLayout).toBe(true);
      expect((await fieldsOf(known.body.id, ceo).expect(200)).body.standardLayout).toBe(true);
      const resaved = await upload('insurance_form_6', await formPdf([{ ...PAGE, cropBox: [0, 0, PAGE.width, PAGE.height] }]), 'Form 6 again.pdf').expect(201);
      expect((await fieldsOf(resaved.body.id).expect(200)).body.standardLayout).toBe(true);
      // another slot, other pages, or a layout that doesn't fit the file
      const elsewhere = await upload('nda', starterForm, 'x.pdf').field('language', 'ar').expect(201);
      expect((await fieldsOf(elsewhere.body.id).expect(200)).body.standardLayout).toBe(false);
      const twoPages = await upload('insurance_form_6', form, 'x.pdf').expect(201);
      expect((await fieldsOf(twoPages.body.id).expect(200)).body.standardLayout).toBe(false);
      const misfit = await upload('insurance_form_1', badStarterForm, 'x.pdf').expect(201);
      expect((await fieldsOf(misfit.body.id).expect(200)).body.standardLayout).toBe(false);
    });

    it('replaces the fields placed with it, the tags worked out again, answered as the fields are; logged with its name', async () => {
      const v = await upload('insurance_form_6', starterForm, 'Form 6.pdf').expect(201);
      // one field moved and the other removed
      await save(v.body.id, [{ ...FORM_1[1], id: 'moved', x: 100 }]).expect(200);
      const res = await standard(v.body.id).expect(200);
      expect(res.body).toEqual({
        version: expect.objectContaining({ id: v.body.id, fieldCount: 2, tags: ['full_name_ar', 'last_working_day'] }),
        pages: [PAGE],
        fields: expect.any(Array),
        editable: true,
        standardLayout: true,
      });
      expect(res.body.fields.map((f: PdfField) => f.id)).toEqual(STARTER);
      expect((await fieldsOf(v.body.id).expect(200)).body.fields).toEqual(res.body.fields);
      expect((await auditOf(v.body.id)).at(-1)).toMatchObject({
        action: 'update',
        diff: { slot: 'insurance_form_6', status: 'draft', fields: { from: 1, to: 2 }, tags: { from: 1, to: 2 }, standardLayout: 'Form 6 (test)' },
      });
      // a Super Admin only (owner, 19 October 2026)
      for (const session of [hr, admin, ceo]) expect((await standard(v.body.id, session).expect(403)).body.message).toBe(ONLY_SUPER_ADMIN_EDITS);
      await standard(v.body.id, staff).expect(403);
      await standard('00000000-0000-4000-8000-000000000000').expect(404);
    });

    it('the version in use takes it too; refused for a replaced one, or a form it has none for', async () => {
      const inUse = await upload('insurance_form_6', starterForm, 'Form 6.pdf').expect(201);
      await publish(inUse.body.id).expect(200);
      await save(inUse.body.id, [{ ...FORM_1[1], id: 'moved', x: 100 }]).expect(200);
      expect((await standard(inUse.body.id).expect(200)).body.fields.map((f: PdfField) => f.id)).toEqual(STARTER);

      const next = await upload('insurance_form_6', starterForm, 'Form 6.pdf').expect(201);
      await publish(next.body.id).expect(200);
      const replaced = await standard(inUse.body.id).expect(409);
      expect(replaced.body.message).toMatch(/^Version \d+ was replaced, so its fields can't be changed\. Upload the form again to make it a new version\.$/);

      const elsewhere = await upload('nda', starterForm, 'x.pdf').field('language', 'ar').expect(201);
      expect((await standard(elsewhere.body.id).expect(409)).body.message).toBe(NONE);
      const twoPages = await upload('insurance_form_6', form, 'x.pdf').expect(201);
      expect((await standard(twoPages.body.id).expect(409)).body.message).toBe(NONE);
      const misfit = await upload('insurance_form_1', badStarterForm, 'x.pdf').expect(201);
      expect((await standard(misfit.body.id).expect(409)).body.message).toBe(NONE);
      // nothing changed on them
      expect((await fieldsOf(twoPages.body.id).expect(200)).body.fields).toEqual([]);
    });
  });
});
