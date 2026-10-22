import { PDFDocument } from '@cantoo/pdf-lib';
import type { INestApplication } from '@nestjs/common';
import { arabicNumberText, toArabicDigits } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { MockInstance } from 'vitest';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import { arabicAmountInWords } from '../src/documents/engine/index.js';
import { printedMoney } from '../src/documents/format.js';
import { MASK } from '../src/documents/preview.js';
import { printedDayCount } from '../src/documents/settlement-values.js';
import { PdfService } from '../src/pdf/pdf.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { paragraphTexts, readDocx, textParts } from '../src/templates/docx-tags.js';
import { readZip } from '../src/templates/zip.js';
import { docx, p, r, realTemplate } from './fixtures/docx.js';
import { convertedPdf, hasEncrypt } from './fixtures/pdf.js';
import { createApp, createUser, signIn } from './helpers.js';

// Documents generated from the published templates: the profile's Employment tab, where the Contracts tab was merged
// (owner's requests, 15 and 16 October 2026).
// The templates are published through the templates API in setup: the owner's real contract, resignation and
// clearance templates, and small ones built here for the other slots. A document is given out only as a protected PDF
// (owner's request, 15 October 2026: "No doc file export, just a protected PDF"): the converter is stubbed with a PDF
// made here, which is protected for real; what was filled in is read from the Word file kept in the database.

// always with a digit: a name ending in letters only would teach the ID card reading (english-name.ts) to spell محمود
// as this run's code, and paperwork.e2e-spec.ts would then find it (16 October 2026)
const RUN = `${Date.now().toString(36)}7`;
const DIGITS = String(Date.now() % 10_000_000).padStart(7, '0');
const NATIONAL_ID = `2950312${DIGITS}`; // born 12 March 1995
const REP_NATIONAL_ID = '28001011234567';
const ONLY_SUPER_ADMIN = 'Only a Super Admin can delete records.';
const FILL_IN = 'Fill in the missing details first.';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n% signed copy\n%%EOF\n');

/** Reads a response body as bytes, whatever its type. */
const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

/** The printed text of a .docx: its paragraphs, in order, one per line. */
function textOf(file: Buffer): string {
  const zip = readZip(file);
  return textParts(zip.entries.map((e) => e.name))
    .flatMap((name) => paragraphTexts(zip.read(name)!.toString('utf8')))
    .join('\n');
}

interface Doc {
  id: string;
  slotKey: string;
  contractId: string | null;
  status: string;
  fileName: string;
  sizeBytes: number;
  templateVersion: number;
  documentDate: string;
  inputs: Record<string, string>;
  generatedBy: { email: string } | null;
  printedAt: string | null;
  signedUploadedAt: string | null;
  verifiedAt: string | null;
  verifiedBy: { email: string } | null;
  signedFileName: string | null;
  [key: string]: unknown;
}

interface Item {
  slotKey: string;
  name: string;
  contractId?: string;
  contractNumber?: string;
  contractVersion?: number;
  templateStatus: string;
  templateVersion: number | null;
  needsInputs: string[];
  documents: Doc[];
}

interface Tab {
  sections: { key: string; items: Item[] }[];
}

interface Missing {
  tag: string;
  label: string;
  where: { tab: string; key: string };
}

describe('Documents (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hrEmail: string;
  let ceoEmail: string;
  let hr: string;
  let ceo: string;
  let superAdmin: string;
  let staff: string;
  let companyBefore: { emailDomain: string | null; nameAr: string | null; repName: string | null; repNationalId: string | null } | null;
  let teamId: string;
  let jobTitleId: string;
  let gradeId: string;
  let shiftId: string;
  // a full-time employee with a signed contract, a part-time one, and the full-time one's documents
  let ft: { id: string; employmentId: string; code: string; contractId: string; contractNumber: string };
  let pt: { id: string; employmentId: string; contractId: string };
  let contractDoc: Doc;
  let convert: MockInstance<PdfService['fromDocx']>;
  const api = () => request(app.getHttpServer());

  const tabOf = async (id: string, session = hr): Promise<Tab> => (await api().get(`/api/employees/${id}/documents`).set('Cookie', session).expect(200)).body as Tab;
  const section = (tab: Tab, key: string) => tab.sections.find((s) => s.key === key)!.items;
  const check = (id: string, query: Record<string, string>, session = hr) => api().get(`/api/employees/${id}/documents/check`).query(query).set('Cookie', session);
  const generate = (id: string, body: object, session = hr) => api().post(`/api/employees/${id}/documents`).set('Cookie', session).send(body);
  const step = (docId: string, action: 'printed' | 'verify', session = hr) => api().post(`/api/documents/${docId}/${action}`).set('Cookie', session);
  const sign = (docId: string, file: Buffer, name: string, session = hr) => api().post(`/api/documents/${docId}/signed`).set('Cookie', session).attach('file', file, name);
  const fileOf = (docId: string, session = hr) => api().get(`/api/documents/${docId}/file`).set('Cookie', session).buffer(true).parse(bytes);
  /** The filled Word file as kept (it is never given out). */
  const docxOf = async (docId: string) => Buffer.from((await prisma.generatedDocument.findUniqueOrThrow({ where: { id: docId }, select: { data: true } })).data);
  const auditOf = (id: string) => prisma.auditLog.findMany({ where: { entityType: 'generated_document', entityId: id }, orderBy: { id: 'asc' }, include: { user: { select: { email: true } } } });

  /** A template uploaded, and published unless draftOnly, by a Super Admin, who alone edits templates (owner, 19 October 2026). */
  async function publish(slot: string, file: Buffer, language?: 'ar' | 'en', draftOnly = false) {
    const upload = api().post(`/api/templates/${slot}/versions`).set('Cookie', superAdmin).attach('file', file, `${slot}.docx`);
    const res = await (language ? upload.field('language', language) : upload).expect(201);
    if (!draftOnly) await api().post(`/api/templates/versions/${res.body.id}/publish`).set('Cookie', superAdmin).expect(200);
  }

  async function hire(name: string, employmentType: string, profile: Record<string, unknown> = {}) {
    const person = await api()
      .post('/api/employees')
      .set('Cookie', hr)
      .send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'عمر خالد محمود', ...profile })
      .expect(201);
    const hired = await api()
      .post(`/api/employees/${person.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType, joinDate: '2026-01-15', departmentId: teamId, jobTitleId, gradeId, shiftId })
      .expect(201);
    return { id: person.body.id as string, code: person.body.employeeCode as string, employmentId: hired.body.employment.id as string };
  }

  async function contract(e: { id: string; employmentId: string }, body: object, signed = true) {
    const res = await api().post(`/api/employees/${e.id}/employments/${e.employmentId}/contracts`).set('Cookie', hr).send(body).expect(201);
    if (signed) await api().post(`/api/contracts/${res.body.id}/sign`).set('Cookie', hr).send({ signedOn: '2026-01-15' }).expect(200);
    return res.body as { id: string; number: string };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    // the converter (Gotenberg) can't run here: its PDF is stood in for, and protected for real
    const converted = await convertedPdf();
    convert = vi.spyOn(app.get(PdfService), 'fromDocx').mockImplementation(async () => converted);
    await prisma.generatedDocument.deleteMany();
    await prisma.templateVersion.deleteMany();
    hrEmail = await createUser(prisma, ['hr']);
    ceoEmail = await createUser(prisma, ['ceo']);
    hr = await signIn(app, hrEmail);
    ceo = await signIn(app, ceoEmail);
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    staff = await signIn(app, await createUser(prisma, ['employee']));

    // the company's Arabic name and representative print on the documents; sign-in accounts here are @test.local
    companyBefore = await prisma.company.findUnique({ where: { id: 1 }, select: { emailDomain: true, nameAr: true, repName: true, repNationalId: true } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '', nameAr: 'تريندليكس', repName: 'أحمد علي', repNationalId: REP_NATIONAL_ID }).expect(200);

    const dept = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Sales ${RUN}`, nameAr: 'المبيعات' }).expect(201);
    const team = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Accounts', nameAr: 'الحسابات', parentId: dept.body.id }).expect(201);
    teamId = team.body.id;
    const title = await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId: teamId, titleEn: 'Account Manager', titleAr: 'مدير حسابات' }).expect(201);
    jobTitleId = title.body.id;
    gradeId = ((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((g) => g.code === 'G4')!.id;
    shiftId = ((await api().get('/api/shifts').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((s) => s.code === 'A')!.id;

    await publish('contract_full_time', realTemplate('Contract'));
    await publish('contract_full_time_insurance', realTemplate('Contract'));
    await publish('resignation_request', realTemplate('Resignation'));
    await publish('clearance_dues', realTemplate('Clearance_Dues'));
    await publish('contract_part_time', docx({ body: p(r('{{full_name_en}} works as {{job_title}} ({{employment_type}}) for EGP {{gross_salary}} from {{start_date}}.')) }), 'en');
    await publish('offer_full_time', docx({ body: p(r('{{full_name_ar}} — {{job_title}} — {{department}}')) }), 'ar');
    await publish('nda', docx({ body: p(r('{{full_name_ar}} و{{company_name_ar}} في {{date}}')) }), 'ar');
    await publish('insurance_form_1', docx({ body: p(r('{{full_name_ar}} {{insurance_no}} {{national_id}} {{insured_salary}}')) }));
    await publish('hr_letter_en', docx({ body: p(r('To {{letter_to}}, for {{letter_purpose}}: {{full_name_en}} is our {{job_title}} ({{employment_type}}) since {{join_date}}. {{company_name_en}}')) }));
    await publish('insurance_form_6', docx({ body: p(r('{{full_name_ar}} {{last_working_day}}')) }), undefined, true); // a draft only

    const full = await hire('Omar Docs', 'full_time', {
      addressAr: '15 شارع عباس العقاد',
      city: 'مدينة نصر',
      governorate: 'Cairo',
      mobile: '+201012345678',
      qualificationAr: 'بكالوريوس تجارة',
      insuranceNo: `9${DIGITS}`,
    });
    const c = await contract(full, { grossSalary: 20000, netSalary: 17250.5 });
    ft = { ...full, contractId: c.id, contractNumber: c.number };
    const part = await hire('Nour Docs', 'part_time');
    pt = { ...part, contractId: (await contract(part, { grossSalary: 8000 })).id };
  });

  afterAll(async () => {
    // the template versions are left for the templates tests to clear, which they can't while documents use them
    await prisma.generatedDocument.deleteMany();
    if (companyBefore) await prisma.company.update({ where: { id: 1 }, data: companyBefore });
    vi.restoreAllMocks();
    await app.close();
  });

  describe('the Employment tab’s documents', () => {
    it('full time: both copies of each contract version, the offer and NDA, Form 1 and the letters; nothing to leave yet', async () => {
      const tab = await tabOf(ft.id);
      expect(tab.sections.map((s) => s.key)).toEqual(['contract', 'hiring', 'insurance', 'letters', 'leaving']);
      expect(section(tab, 'contract')).toEqual([
        {
          slotKey: 'contract_full_time',
          name: 'Contract · Full-time (official copy)',
          contractId: ft.contractId,
          contractNumber: ft.contractNumber,
          contractVersion: 1,
          templateStatus: 'published',
          templateVersion: 1,
          needsInputs: [],
          documents: [],
        },
        expect.objectContaining({ slotKey: 'contract_full_time_insurance', contractId: ft.contractId, templateStatus: 'published', documents: [] }),
      ]);
      expect(section(tab, 'hiring').map((i) => [i.slotKey, i.templateStatus])).toEqual([
        ['offer_full_time', 'published'],
        ['nda', 'published'],
      ]);
      expect(section(tab, 'insurance').map((i) => i.slotKey)).toEqual(['insurance_form_1']);
      expect(section(tab, 'letters').map((i) => [i.slotKey, i.templateStatus, i.needsInputs])).toEqual([
        ['bank_letter', 'missing', []],
        ['hr_letter_ar', 'missing', []],
        ['hr_letter_en', 'published', ['letter_to', 'letter_purpose']],
        ['cert_experience', 'missing', []],
      ]);
      expect(section(tab, 'leaving')).toEqual([]);
    });

    it('part time: the part-time contract and offer, no social insurance forms', async () => {
      const tab = await tabOf(pt.id);
      expect(section(tab, 'contract').map((i) => [i.slotKey, i.contractId, i.templateStatus])).toEqual([['contract_part_time', pt.contractId, 'published']]);
      expect(section(tab, 'hiring').map((i) => [i.slotKey, i.templateStatus, i.templateVersion])).toEqual([
        ['offer_part_time', 'missing', null],
        ['nda', 'published', 1],
      ]);
      expect(section(tab, 'insurance')).toEqual([]);
      expect(section(tab, 'letters').map((i) => i.slotKey)).toEqual(['bank_letter', 'hr_letter_ar', 'hr_letter_en', 'cert_experience']);
      expect(section(tab, 'leaving')).toEqual([]);
    });

    it('someone never employed has nothing offered; an unknown employee is not found', async () => {
      const person = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `Not Hired ${RUN}`, fullNameAr: 'غير معين' }).expect(201);
      expect((await tabOf(person.body.id)).sections.every((s) => s.items.length === 0)).toBe(true);
      await api().get('/api/employees/00000000-0000-4000-8000-000000000000/documents').set('Cookie', hr).expect(404);
    });
  });

  describe('checking and generating', () => {
    it('check lists the tags the template prints that have no value, and where to fill them in', async () => {
      const res = await check(ft.id, { slotKey: 'contract_full_time', contractId: ft.contractId }).expect(200);
      expect(res.body).toEqual({
        missing: [
          { tag: 'national_id', label: 'National ID number', where: { tab: 'basic', key: 'nationalId' } },
          { tag: 'id_printed_no', label: 'Printed number', where: { tab: 'basic', key: 'printedNo' } },
          { tag: 'id_issue_date', label: 'Issue date', where: { tab: 'basic', key: 'idIssueDate' } },
        ],
        usesRestricted: true,
      });

      // the part-time contract prints nothing restricted but the salary; nothing is missing
      expect((await check(pt.id, { slotKey: 'contract_part_time', contractId: pt.contractId }).expect(200)).body).toEqual({ missing: [], usesRestricted: true });
      expect((await check(ft.id, { slotKey: 'offer_full_time' }).expect(200)).body).toEqual({ missing: [], usesRestricted: false });
      // the typed tags aren't listed: they are asked for when generating
      expect((await check(ft.id, { slotKey: 'hr_letter_en' }).expect(200)).body).toEqual({ missing: [], usesRestricted: false });
    });

    it('check: a contract slot needs its contract version, a slot must apply, and its template be published', async () => {
      expect((await check(ft.id, { slotKey: 'contract_full_time' }).expect(400)).body.message).toBe(
        'Choose the contract version to generate Contract · Full-time (official copy) for.',
      );
      expect((await check(ft.id, { slotKey: 'bank_letter' }).expect(404)).body.message).toBe('There is no published template for Bank account letter. Upload it in Templates first.');
      expect((await check(ft.id, { slotKey: 'contract_part_time', contractId: ft.contractId }).expect(400)).body.message).toMatch(/^Contract · Part-time is for part-time employments/);
      await check(ft.id, {}).expect(400);
    });

    it('generating is refused while something is missing (422), then the contract is filled in with the values', async () => {
      const body = { slotKey: 'contract_full_time', contractId: ft.contractId, documentDate: '2026-10-15' };
      const refused = await generate(ft.id, body).expect(422);
      expect(refused.body).toEqual({ statusCode: 422, message: FILL_IN, missing: expect.any(Array) });
      expect((refused.body.missing as Missing[]).map((m) => m.tag)).toEqual(['national_id', 'id_printed_no', 'id_issue_date']);
      expect(await prisma.generatedDocument.count({ where: { employeeId: ft.id } })).toBe(0);

      await api().patch(`/api/employees/${ft.id}/identity`).set('Cookie', hr).send({ nationalId: NATIONAL_ID, printedNo: 'KX1234567', issueDate: '2021-03-09' }).expect(200);
      const res = await generate(ft.id, body).expect(201);
      contractDoc = res.body as Doc;
      expect(contractDoc).toMatchObject({
        slotKey: 'contract_full_time',
        contractId: ft.contractId,
        status: 'generated',
        fileName: `Contract · Full-time (official copy) - ${ft.code} - Omar Docs ${RUN}.docx`,
        templateVersion: 1,
        documentDate: '2026-10-15',
        inputs: {},
        hasRestricted: true,
        generatedBy: { email: hrEmail },
        printedAt: null,
        signedUploadedAt: null,
        verifiedAt: null,
        verifiedBy: null,
        signedFileName: null,
        note: null,
      });

      // given out as a protected PDF, shown in the browser
      const file = await fileOf(contractDoc.id).expect(200);
      expect(file.headers['content-type']).toBe('application/pdf');
      expect(file.headers['content-disposition']).toMatch(/^inline; filename="Contract _ Full-time[^"]*\.pdf"; filename\*=UTF-8''Contract%20%C2%B7%20Full-time.*\.pdf$/);
      expect(hasEncrypt(file.body as Buffer)).toBe(true);
      const filled = await docxOf(contractDoc.id);
      expect(filled.length).toBe(contractDoc.sizeBytes);
      expect(readDocx(filled)).toEqual({ tags: [], unknownTags: [], broken: [] }); // no tag left
      const text = textOf(filled);
      // an Arabic document's numbers in ٠-٩, a code with Latin letters as it is (owner, 22 October 2026: "in contracts, i
      // need the dates and numbers in arabic ٠-٩"); the phone with its country code ("the phone number is without the
      // country code")
      expect(text).toContain('إنه في يوم الخميس الموافق ٢٠٢٦/١٠/١٥');
      expect(text).toContain('السيد/ عمر خالد محمود');
      expect(text).toContain('المقيم في: ١٥ شارع عباس العقاد، مدينة نصر، القاهرة');
      // the phone kept left to right inside the Arabic text (LRE … PDF), so its + stays in front
      expect(text).toContain('تليفون: \u202A+٢٠١٠١٢٣٤٥٦٧٨\u202C');
      expect(text).toContain(`رقم قومي: ${toArabicDigits(NATIONAL_ID)}`);
      expect(text).toContain('KX1234567');
      expect(text).toContain('٢٠٢١/٣');
      expect(text).toContain('بكالوريوس تجارة');
      expect(text).toContain('في وظيفة مدير حسابات وذلك لمدة سنة ميلادية واحدة اعتبارا من ٢٠٢٦/١/١٥ وحتى ٢٠٢٧/١/١٤');
      expect(text).toContain(`راتب شامل وقدره ٢٠,٠٠٠ جنيهاً مصريا (${arabicAmountInWords(20000)})`);
      expect(arabicAmountInWords(20000)).toMatch(/عشرون ألف جنيه/); // the gross in Arabic words (the engine's wording)
      expect(text).toContain('١٧,٢٥٠.٥٠');
      expect(text).toContain(arabicAmountInWords(17250.5));

      const audit = await auditOf(contractDoc.id);
      expect(audit.map((a) => a.action)).toEqual(['generate', 'view_restricted', 'view_restricted']);
      expect(audit[0].diff).toMatchObject({ employeeId: ft.id, slot: 'contract_full_time', templateVersion: 1, contract: ft.contractNumber, documentDate: '2026-10-15' });
      expect(audit[1].diff).toMatchObject({ seen: 'generated', fields: expect.arrayContaining(['national_id', 'gross_salary', 'net_salary']) });
      expect(audit[2].diff).toMatchObject({ seen: 'file' });
    });

    it('the social insurance copy prints the insured salary as the gross', async () => {
      const res = await generate(ft.id, { slotKey: 'contract_full_time_insurance', contractId: ft.contractId }).expect(201);
      const text = textOf(await docxOf(res.body.id));
      // 20,000 capped at 2026's maximum insurable wage
      expect(text).toContain(`راتب شامل وقدره ١٦,٧٠٠ جنيهاً مصريا (${arabicAmountInWords(16700)})`);
      expect(text).not.toContain('٢٠,٠٠٠');
      expect(text).not.toContain('20,000');
      expect(res.body.documentDate).toBe(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date()));
    });

    it('a template in English prints the job title and employment type in English', async () => {
      const res = await generate(pt.id, { slotKey: 'contract_part_time', contractId: pt.contractId }).expect(201);
      expect(textOf(await docxOf(res.body.id))).toBe(`Nour Docs ${RUN} works as Account Manager (Part-time) for EGP 8,000 from 15/01/2026.`);
      const offer = await generate(ft.id, { slotKey: 'offer_full_time' }).expect(201);
      expect(offer.body.hasRestricted).toBe(false);
      expect(textOf(await docxOf(offer.body.id))).toBe('عمر خالد محمود — مدير حسابات — الحسابات');
      expect((await auditOf(offer.body.id)).map((a) => a.action)).toEqual(['generate']); // nothing restricted: no view logged
    });

    it('an HR letter needs who it is addressed to and its purpose; several can be generated', async () => {
      const none = await generate(ft.id, { slotKey: 'hr_letter_en' }).expect(400);
      expect(none.body.message).toBe('Type who the letter is addressed to and the purpose of the letter.');
      const half = await generate(ft.id, { slotKey: 'hr_letter_en', inputs: { letter_to: 'CIB', letter_purpose: '  ' } }).expect(400);
      expect(half.body.message).toBe('Type the purpose of the letter.');
      await generate(ft.id, { slotKey: 'hr_letter_en', inputs: { letter_to: 'CIB', other: 'x' } }).expect(400);

      const first = await generate(ft.id, { slotKey: 'hr_letter_en', inputs: { letter_to: 'CIB', letter_purpose: 'a credit card' } }).expect(201);
      expect(first.body.inputs).toEqual({ letter_to: 'CIB', letter_purpose: 'a credit card' });
      const { nameEn } = await prisma.company.findUniqueOrThrow({ where: { id: 1 } });
      expect(textOf(await docxOf(first.body.id))).toBe(`To CIB, for a credit card: Omar Docs ${RUN} is our Account Manager (Full-time) since 15/01/2026. ${nameEn}`);
      const second = await generate(ft.id, { slotKey: 'hr_letter_en', inputs: { letter_to: 'The Embassy of Italy', letter_purpose: 'a visa' }, note: 'For his trip' }).expect(201);
      const letters = section(await tabOf(ft.id), 'letters').find((i) => i.slotKey === 'hr_letter_en')!;
      expect(letters.documents.map((d) => [d.id, d.note])).toEqual([
        [second.body.id, 'For his trip'],
        [first.body.id, null],
      ]);
    });

    it('refuses a document that doesn’t apply (400), a template not published (409), and a contract of someone else', async () => {
      expect((await generate(ft.id, { slotKey: 'offer_part_time' }).expect(400)).body.message).toBe(
        `Job offer · Part-time is for part-time employments; Omar Docs ${RUN}’s is full-time. Choose the document for a full-time employment.`,
      );
      expect((await generate(ft.id, { slotKey: 'payslip_en' }).expect(400)).body.message).toBe('Payslips come from payroll, which isn’t available yet.');
      expect((await generate(ft.id, { slotKey: 'no_such_document' }).expect(400)).body.message).toBe('Choose a document the Employment tab offers.');
      expect((await generate(ft.id, { slotKey: 'clearance_dues' }).expect(400)).body.message).toBe(
        'Clearance and dues (إقرار إخلاء طرف واستلام مستحقات) is generated once an ending of the employment is recorded. Record it on the Employment tab first.',
      );
      expect((await generate(ft.id, { slotKey: 'bank_letter' }).expect(409)).body.message).toBe('There is no published template for Bank account letter. Upload it in Templates first.');
      expect((await generate(ft.id, { slotKey: 'contract_full_time' }).expect(400)).body.message).toBe('Choose the contract version to generate Contract · Full-time (official copy) for.');
      expect((await generate(ft.id, { slotKey: 'contract_full_time', contractId: pt.contractId }).expect(404)).body.message).toBe('Contract not found.');
      await generate(ft.id, { slotKey: 'nda', documentDate: '2026-02-30' }).expect(400);
    });
  });

  describe('each document’s lifecycle', () => {
    it('generated → printed → signed copy uploaded → verified, each step once and in order', async () => {
      const id = contractDoc.id;
      expect((await step(id, 'verify').expect(409)).body.message).toBe('This document is only generated: upload the signed copy before verifying it.');

      const printed = await step(id, 'printed').expect(200);
      expect(printed.body).toMatchObject({ status: 'printed', printedBy: { email: hrEmail }, printedAt: expect.any(String) });
      expect((await step(id, 'printed').expect(409)).body.message).toBe('This document is already marked printed: only a generated document is marked printed.');

      expect((await sign(id, Buffer.from('not a scan'), 'scan.txt').expect(400)).body.message).toBe('The scan must be a JPEG, PNG or WebP image, or a PDF.');
      expect((await api().post(`/api/documents/${id}/signed`).set('Cookie', hr).expect(400)).body.message).toBe('Choose the scan of the signed copy: a photo or a PDF.');
      const signed = await sign(id, PDF, 'scan0001.pdf').expect(200);
      expect(signed.body).toMatchObject({
        status: 'signed',
        signedFileName: `Contract · Full-time (official copy) - ${ft.code} - Omar Docs ${RUN} (signed).pdf`,
        signedMime: 'application/pdf',
        signedSize: PDF.length,
        signedUploadedBy: { email: hrEmail },
      });
      const scan = await api().get(`/api/documents/${id}/signed-file`).set('Cookie', hr).buffer(true).parse(bytes).expect(200);
      expect(scan.headers['content-type']).toBe('application/pdf');
      expect(scan.headers['content-disposition']).toMatch(/^inline; filename=/);
      expect(Buffer.compare(scan.body as Buffer, PDF)).toBe(0);

      // until it is verified, a better scan replaces the one before
      const again = await sign(id, PNG, 'photo.png').expect(200);
      expect(again.body).toMatchObject({ status: 'signed', signedMime: 'image/png', signedFileName: expect.stringMatching(/\(signed\)\.png$/) });

      const verified = await step(id, 'verify').expect(200);
      expect(verified.body).toMatchObject({ status: 'verified', verifiedBy: { email: hrEmail }, verifiedAt: expect.any(String) });
      expect((await step(id, 'verify').expect(409)).body.message).toBe('This document is already verified: there is nothing more to do.');
      expect((await step(id, 'printed').expect(409)).body.message).toBe('This document is already verified: only a generated document is marked printed.');
      expect((await sign(id, PDF, 'late.pdf').expect(409)).body.message).toBe('This document is already verified: its signed copy can’t be replaced.');

      const tab = await tabOf(ft.id);
      const listed = section(tab, 'contract').find((i) => i.slotKey === 'contract_full_time')!.documents;
      expect(listed.map((d) => [d.id, d.status])).toEqual([[id, 'verified']]);

      const audit = await auditOf(id);
      expect(audit.filter((a) => a.action !== 'view_restricted').map((a) => [a.action, (a.diff as { status?: unknown }).status ?? null])).toEqual([
        ['generate', null],
        ['print', { from: 'generated', to: 'printed' }],
        ['sign', { from: 'printed', to: 'signed' }],
        ['update', null],
        ['verify', { from: 'signed', to: 'verified' }],
      ]);
      // the signed copy prints the national ID and the salary: viewing it is a restricted view
      expect(audit.filter((a) => a.action === 'view_restricted').map((a) => (a.diff as { seen: string }).seen)).toEqual(['generated', 'file', 'signed copy']);
    });

    it('a signed copy may be uploaded straight after generating; the signed file is not found before it', async () => {
      const doc = (await generate(ft.id, { slotKey: 'nda' }).expect(201)).body as Doc;
      expect((await api().get(`/api/documents/${doc.id}/signed-file`).set('Cookie', hr).expect(404)).body.message).toBe('The signed copy of this document hasn’t been uploaded yet.');
      const signed = await sign(doc.id, PNG, 'nda.png').expect(200);
      expect(signed.body).toMatchObject({ status: 'signed', printedAt: null });
      expect((await step(doc.id, 'printed').expect(409)).body.message).toBe('This document already has its signed copy uploaded: only a generated document is marked printed.');
    });

    it('a contract whose signed copy is uploaded keeps its signing: not even a Super Admin undoes it', async () => {
      const res = await api().post(`/api/contracts/${ft.contractId}/unsign`).set('Cookie', superAdmin).expect(409);
      expect(res.body.message).toBe(
        `A signed copy of ${ft.contractNumber}'s documents is uploaded, which shows it was signed, so its signing stays on record. For other terms, add a new version.`,
      );
    });

    it('gives a document only as a protected PDF: shown, or saved with ?download=1; never the Word file', async () => {
      const doc = (await generate(pt.id, { slotKey: 'nda' }).expect(201)).body as Doc;
      const get = (query: string, session = hr) => api().get(`/api/documents/${doc.id}/file${query}`).set('Cookie', session).buffer(true).parse(bytes);
      const json = (res: request.Response) => JSON.parse((res.body as Buffer).toString('utf8')) as { message: string };

      const shown = await get('?format=pdf', ceo).expect(200);
      expect(shown.headers['content-type']).toBe('application/pdf');
      expect(shown.headers['content-disposition']).toMatch(/^inline; filename="NDA[^"]*\.pdf"/);
      const saved = await get('?download=1').expect(200);
      expect(saved.headers['content-type']).toBe('application/pdf');
      expect(saved.headers['content-disposition']).toMatch(/^attachment; filename="NDA[^"]*\.pdf"/);
      // protected: encrypted (AES-256), opens without a password, and is the converter's page
      const pdf = saved.body as Buffer;
      expect(hasEncrypt(pdf)).toBe(true);
      expect((await PDFDocument.load(pdf, { password: '' })).getPageCount()).toBe(1);
      await expect(PDFDocument.load(pdf)).rejects.toThrow();

      for (const format of ['docx', 'odt']) expect(json(await get(`?format=${format}`).expect(400)).message).toBe('Documents are given as protected PDFs only.');
      // no converter on the server: no document at all, rather than the Word file
      convert.mockResolvedValueOnce(null);
      expect(json(await get('').expect(409)).message).toBe("The PDF converter isn't set up on the server, so documents can't be given out yet: they are given as protected PDFs only.");
      await api().delete(`/api/documents/${doc.id}`).set('Cookie', superAdmin).expect(204);
    });

    it('a template version documents were made from is kept: not even a Super Admin deletes it', async () => {
      const slot = (await api().get('/api/templates/contract_full_time').set('Cookie', hr).expect(200)).body as { versions: { id: string; status: string; usedBy: number }[] };
      const used = slot.versions.find((v) => v.status === 'published')!;
      expect(used.usedBy).toBeGreaterThan(0);
      const res = await api().delete(`/api/templates/versions/${used.id}`).set('Cookie', superAdmin).expect(409);
      expect(res.body.message).toMatch(/made from version \d+, so it is kept with them\.$/);
    });

    it('HR saves an unprotected PDF for an e-signature service; every download is recorded; nobody else may', async () => {
      const esign = (session = hr) => api().get(`/api/documents/${contractDoc.id}/esign-file`).set('Cookie', session).buffer(true).parse(bytes);
      const res = await esign().expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toMatch(/^attachment; .*\(for e-signature\)\.pdf/);
      expect(hasEncrypt(res.body as Buffer)).toBe(false); // Adobe Sign and DocuSign refuse a protected PDF
      await esign(ceo).expect(403);
      const audit = await auditOf(contractDoc.id);
      expect(audit.filter((a) => a.action === 'download_unprotected').at(-1)?.diff).toMatchObject({ employeeId: ft.id, slot: 'contract_full_time', purpose: 'e-signature' });
    });

    it('only a Super Admin deletes a document', async () => {
      const doc = (await generate(pt.id, { slotKey: 'nda' }).expect(201)).body as Doc;
      expect((await api().delete(`/api/documents/${doc.id}`).set('Cookie', hr).expect(403)).body.message).toBe(ONLY_SUPER_ADMIN);
      await api().delete(`/api/documents/${doc.id}`).set('Cookie', superAdmin).expect(204);
      await fileOf(doc.id).expect(404);
      await api().delete(`/api/documents/${doc.id}`).set('Cookie', superAdmin).expect(404);
      const audit = await auditOf(doc.id);
      expect(audit.map((a) => a.action)).toEqual(['generate', 'delete']);
      expect(audit[1].diff).toMatchObject({ employeeId: pt.id, slot: 'nda', status: 'generated' });
    });

    it('the CEO views the tab and downloads the files, but doesn’t generate; an employee gets 403', async () => {
      const tab = await tabOf(ft.id, ceo);
      expect(section(tab, 'contract')[0].documents).toHaveLength(1);
      await fileOf(contractDoc.id, ceo).expect(200);
      await api().get(`/api/documents/${contractDoc.id}/signed-file`).set('Cookie', ceo).expect(200);
      const ceoViews = (await auditOf(contractDoc.id)).filter((a) => a.user?.email === ceoEmail);
      expect(ceoViews.map((a) => [a.action, (a.diff as { seen: string }).seen])).toEqual([
        ['view_restricted', 'file'],
        ['view_restricted', 'signed copy'],
      ]);

      await generate(ft.id, { slotKey: 'nda' }, ceo).expect(403);
      await check(ft.id, { slotKey: 'nda' }, ceo).expect(403);
      await step(contractDoc.id, 'printed', ceo).expect(403);
      await sign(contractDoc.id, PDF, 'x.pdf', ceo).expect(403);

      await api().get(`/api/employees/${ft.id}/documents`).set('Cookie', staff).expect(403);
      await fileOf(contractDoc.id, staff).expect(403);
      await generate(ft.id, { slotKey: 'nda' }, staff).expect(403);
    });
  });

  describe('with an ending', () => {
    it('a resignation brings Form 6, the resignation request and the clearance', async () => {
      await api()
        .post(`/api/employees/${ft.id}/employments/${ft.employmentId}/endings`)
        .set('Cookie', hr)
        .send({ ruleKey: 'resignation', noticeGivenOn: '2026-10-01', certifiedOffice: 'Nasr City labour office', certifiedSerial: `R-${RUN}`, certifiedOn: '2026-09-30', reason: 'Moving abroad' })
        .expect(201);

      const tab = await tabOf(ft.id);
      expect(section(tab, 'insurance').map((i) => [i.slotKey, i.templateStatus, i.templateVersion])).toEqual([
        ['insurance_form_1', 'published', 1],
        ['insurance_form_6', 'draft', null],
      ]);
      expect(section(tab, 'leaving').map((i) => [i.slotKey, i.templateStatus, i.documents.length])).toEqual([
        ['resignation_request', 'published', 0],
        ['clearance_dues', 'published', 0],
      ]);

      // a reason typed in English isn't printed on the Arabic request: the owner's default is
      const resignation = await generate(ft.id, { slotKey: 'resignation_request', documentDate: '2026-10-01' }).expect(201);
      const text = textOf(await docxOf(resignation.body.id));
      expect(text).toContain('أنا عمر خالد محمود');
      expect(text).toContain('من العمل داخل الشركة لأسباب شخصية وذلك اعتبارا من اليوم الموافق:  ٢٠٢٦/١٠/١');
      expect(resignation.body.hasRestricted).toBe(false);

      const clearance = await generate(ft.id, { slotKey: 'clearance_dues', documentDate: '2026-10-15' }).expect(201);
      const cleared = textOf(await docxOf(clearance.body.id));
      expect(cleared).toContain('إنه في يوم الخميس الموافق ٢٠٢٦/١٠/١٥');
      expect(cleared).toContain('أحمد علي');
      expect(cleared).toContain(toArabicDigits(REP_NATIONAL_ID));
      expect(cleared).toContain(`الرقم القومي: ${toArabicDigits(NATIONAL_ID)}`);

      const leaving = section(await tabOf(ft.id), 'leaving');
      expect(leaving.map((i) => i.documents.map((d) => d.id))).toEqual([[resignation.body.id], [clearance.body.id]]);
    });

    it('an ending the company started: the clearance, but no resignation request', async () => {
      await api()
        .post(`/api/employees/${pt.id}/employments/${pt.employmentId}/endings`)
        .set('Cookie', hr)
        .send({ ruleKey: 'company_notice', noticeGivenOn: '2026-10-01', payInLieu: true })
        .expect(201);
      expect(section(await tabOf(pt.id), 'leaving').map((i) => i.slotKey)).toEqual(['clearance_dues']);
      expect((await generate(pt.id, { slotKey: 'resignation_request' }).expect(400)).body.message).toBe(
        'The resignation request is only for an ending the employee started, such as a resignation.',
      );
      // the part-time employee has no national ID or address yet
      const missing = (await check(pt.id, { slotKey: 'clearance_dues' }).expect(200)).body.missing as Missing[];
      expect(missing.map((m) => [m.tag, m.where])).toEqual([
        ['national_id', { tab: 'basic', key: 'nationalId' }],
        ['address', { tab: 'basic', key: 'addressAr' }],
      ]);
    });
  });

  describe("the role's duties and responsibilities", () => {
    // owner's request, 15 October 2026: the job title's duties printed as written, keeping their bold and indented points
    it('missing until the job title has them; then printed on their own line as paragraphs, bold and points kept', async () => {
      await publish('cert_experience', docx({ body: p(r('{{full_name_ar}}')) + p(r('{{job_duties}}')) }), 'ar');
      const missing = [{ tag: 'job_duties', label: 'Duties and responsibilities', where: { tab: 'employment', key: 'jobTitle' } }];
      expect((await check(ft.id, { slotKey: 'cert_experience' }).expect(200)).body).toEqual({ missing, usesRestricted: false });
      expect((await generate(ft.id, { slotKey: 'cert_experience' }).expect(422)).body.missing).toEqual(missing);

      const duties = '<p>Manages the <strong>key accounts</strong>.</p><ul><li><p>Plans visits</p><ul><li><p>weekly</p></li></ul></li><li><p>متابعة <strong>العملاء</strong></p></li></ul>';
      await api().patch(`/api/job-titles/${jobTitleId}`).set('Cookie', hr).send({ jdDuties: duties }).expect(200);
      expect((await check(ft.id, { slotKey: 'cert_experience' }).expect(200)).body).toEqual({ missing: [], usesRestricted: false });

      const res = await generate(ft.id, { slotKey: 'cert_experience' }).expect(201);
      const filled = await docxOf(res.body.id);
      expect(readDocx(filled)).toEqual({ tags: [], unknownTags: [], broken: [] });
      expect(textOf(filled)).toBe(['عمر خالد محمود', 'Manages the key accounts.', '•Plans visits', '◦weekly', '•متابعة العملاء'].join('\n'));
      // the template's paragraph (right to left) and run, with the bold and the points' indents added
      const document = readZip(filled).read('word/document.xml')!.toString('utf8');
      const paragraphs = [...document.matchAll(/<w:p>.*?<\/w:p>/g)].map((m) => m[0]);
      expect(paragraphs).toHaveLength(5);
      expect(paragraphs[1]).toBe(
        '<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">Manages the </w:t></w:r>' +
          '<w:r><w:rPr><w:b/><w:bCs/><w:rtl/></w:rPr><w:t>key accounts</w:t></w:r><w:r><w:rPr><w:rtl/></w:rPr><w:t>.</w:t></w:r></w:p>',
      );
      expect(paragraphs[2]).toContain('<w:pPr><w:bidi/><w:ind w:left="720" w:hanging="360"/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t>•</w:t><w:tab/></w:r>');
      expect(paragraphs[3]).toContain('<w:ind w:left="1440" w:hanging="360"/>');
      expect(paragraphs[4]).toContain('<w:r><w:rPr><w:b/><w:bCs/><w:rtl/></w:rPr><w:t>العملاء</w:t></w:r>');
      expect(document).not.toContain('w:numPr');
    });
  });

  describe('the fields added on 15 October 2026', () => {
    // owner's request, "add the missing fields": the personal email, the direct manager, the working hours, the work
    // arrangement, the probation period, the grade's level, the net per hour and the basic salary's share
    it('missing until filled in, each pointing to its field; then printed in Arabic and in English', async () => {
      await publish(
        'hr_letter_ar',
        docx({
          body:
            p(r('{{personal_email}} | {{manager_name}} | {{manager_name_en}}')) +
            p(r('{{shift}} | {{shift_en}}')) +
            p(r('{{work_arrangement}} | {{work_arrangement_en}}')) +
            p(r('{{probation_months}} | {{probation_months_en}}')) +
            p(r('{{grade_level}} | {{grade_level_en}}')) +
            p(r('{{hourly_rate}} | {{net_hourly_rate}} | {{basic_percent}}')),
        }),
      );
      const manager = await hire('Mona Manager', 'full_time', { fullNameAr: 'منى عادل' });
      // part time, by the hour: 100 an hour for 24 hours a week (104 hours a month), 9,000 net
      const hala = await hire('Hala Hourly', 'part_time');
      await contract(hala, { payBasis: 'hourly', hourlyRate: 100, hoursPerWeek: 24, netSalary: 9000, basicPercent: 75, probationMonths: 2 });

      const missing = (await check(hala.id, { slotKey: 'hr_letter_ar' }).expect(200)).body as { missing: Missing[]; usesRestricted: boolean };
      expect(missing).toEqual({
        missing: [
          { tag: 'personal_email', label: 'Personal email', where: { tab: 'basic', key: 'personalEmail' } },
          { tag: 'manager_name', label: 'Direct manager', where: { tab: 'employment', key: 'manager' } },
          { tag: 'manager_name_en', label: 'Direct manager (English)', where: { tab: 'employment', key: 'manager' } },
        ],
        usesRestricted: true,
      });

      await api().patch(`/api/employees/${hala.id}`).set('Cookie', hr).send({ personalEmail: `hala.${RUN}@mail.test` }).expect(200);
      await api().patch(`/api/employees/${hala.id}/employments/${hala.employmentId}`).set('Cookie', hr).send({ managerId: manager.id, workArrangement: 'outdoor' }).expect(200);
      const grade = await prisma.grade.findUniqueOrThrow({ where: { id: gradeId }, select: { levelAr: true } });
      await prisma.grade.update({ where: { id: gradeId }, data: { levelAr: 'أول' } });
      try {
        const res = await generate(hala.id, { slotKey: 'hr_letter_ar' }).expect(201);
        expect(res.body.hasRestricted).toBe(true);
        // shift A: 9 to 6, Sunday to Thursday; the employment's grade, G4
        expect(textOf(await docxOf(res.body.id))).toBe(
          [
            `hala.${RUN}@mail.test | منى عادل | Mona Manager ${RUN}`,
            // the Arabic tags in ٠-٩, the English ones (_en) and the email as they are
            'من ٩:٠٠ ص إلى ٦:٠٠ م، من الأحد إلى الخميس | 9:00 AM – 6:00 PM, Sunday to Thursday',
            'ميداني (خارج المكتب) | Outdoor (field work)',
            'شهران | 2 months',
            'أول | Senior',
            '١٠٠ | ٨٦.٥٤ | ٧٥٪',
          ].join('\n'),
        );
        // the net per hour and the basic share are restricted like the salary
        const viewed = (await auditOf(res.body.id)).find((a) => a.action === 'view_restricted');
        expect(viewed?.diff).toMatchObject({ seen: 'generated', fields: ['hourly_rate', 'net_hourly_rate', 'basic_percent'] });
      } finally {
        await prisma.grade.update({ where: { id: gradeId }, data: { levelAr: grade.levelAr } });
      }
    });
  });

  describe("the final settlement's deductions on the clearance and dues", () => {
    // 20 October 2026, the owner unsure, Claude recommended listing them: the advances and loans still owed on leaving,
    // deducted ("taken from the final settlement, unless waived", the owner's words of 18 October 2026) or waived, the
    // unused annual leave paid and the total deducted, one per line; restricted as pay is
    /** Each paragraph of a .docx's body as its lines: its text, split where a value's line breaks became <w:br/>. */
    const paragraphLines = (file: Buffer) =>
      [...readZip(file).read('word/document.xml')!.toString('utf8').matchAll(/<w:p>.*?<\/w:p>/g)].map((m) => m[0].split('<w:br/>').map((part) => part.replace(/<[^>]+>/g, '')));

    it('lists each still owed, deducted or waived, the unused leave and the total deducted; masked for an Admin, who sees no pay', async () => {
      const upload = await api()
        .post('/api/templates/clearance_dues/versions')
        .set('Cookie', superAdmin)
        .attach('file', docx({ body: p(r('{{full_name_ar}}')) + p(r('{{deductions}}')) + p(r('{{deductions_en}}')) + p(r('المجموع: {{deductions_total}}')) }), 'clearance_dues.docx')
        .field('language', 'ar')
        .expect(201);
      await api().post(`/api/templates/versions/${upload.body.id}/publish`).set('Cookie', superAdmin).expect(200);

      const lina = await hire('Lina Leaver', 'full_time');
      await contract(lina, { grossSalary: 9000 });
      const advance = async (kind: string, amount: number, givenOn: string, reason: string) =>
        (await api().post('/api/payroll/advances').set('Cookie', hr).send({ employeeId: lina.id, kind, amount, givenOn, reason }).expect(201)).body.id as string;
      const settle = (id: string, body: object) => api().post(`/api/payroll/advances/${id}/settle`).set('Cookie', hr).send(body).expect(200);
      const [old, laptop, rent, fuel, travel] = [
        await advance('advance', 200, '2026-02-01', 'Old'),
        await advance('loan', 3000, '2026-03-01', 'Laptop'),
        await advance('advance', 1000, '2026-04-01', 'Rent'),
        await advance('advance', 500, '2026-05-01', 'Fuel'),
        await advance('advance', 700, '2026-06-01', 'Travel'),
      ];
      try {
        // nothing to leave yet: no final settlement to print
        expect((await check(lina.id, { slotKey: 'clearance_dues' }).expect(400)).body.message).toContain('once an ending of the employment is recorded');
        // waived long before leaving: not the final settlement's
        await settle(old, { how: 'waived', note: 'Written off in February' });
        await prisma.payrollAdvance.update({ where: { id: old }, data: { settledAt: new Date('2026-02-15T10:00:00Z') } });

        // she resigns, and her employment ends 5 days ago
        const today = todayInCairo();
        await api()
          .post(`/api/employees/${lina.id}/employments/${lina.employmentId}/endings`)
          .set('Cookie', hr)
          .send({ ruleKey: 'resignation', noticeGivenOn: addDays(today, -30), certifiedOffice: 'Nasr City labour office', certifiedSerial: `L-${RUN}`, certifiedOn: addDays(today, -31) })
          .expect(201);
        await api().post(`/api/employees/${lina.id}/employments/${lina.employmentId}/end`).set('Cookie', hr).send({ endDate: addDays(today, -5), endReason: 'resigned' }).expect(200);
        // the laptop loan stays open: deducted, as the owner's rule has it, unless waived
        await settle(rent, { how: 'waived', note: 'Goodwill on leaving' });
        await settle(fuel, { how: 'final_settlement' });
        await settle(travel, { how: 'paid_back', note: 'Paid back in cash' });

        // the unused leave as the final settlement lists it (Unsettled)
        const unsettled = (await api().get('/api/payroll/unsettled').set('Cookie', hr).expect(200)).body as {
          settlements: { rows: { employmentId: string; unusedLeave: { days: number; dayRate: number; amount: number } | null }[] };
        };
        const leave = unsettled.settlements.rows.find((s) => s.employmentId === lina.employmentId)!.unusedLeave!;
        expect(leave.days).toBeGreaterThan(0);
        expect(leave.dayRate).toBeGreaterThan(0);

        const res = await generate(lina.id, { slotKey: 'clearance_dues' }).expect(201);
        expect(res.body.hasRestricted).toBe(true);
        expect(paragraphLines(await docxOf(res.body.id))).toEqual([
          ['عمر خالد محمود'],
          [
            'قرض (Laptop): المتبقي ٣,٠٠٠ جنيه، مخصوم من المستحقات',
            'سلفة (Rent): المتبقي ١,٠٠٠ جنيه، تم التنازل عنها',
            'سلفة (Fuel): المتبقي ٥٠٠ جنيه، مخصوم من المستحقات',
            arabicNumberText(`رصيد الإجازة السنوية غير المستنفد: ${printedDayCount(leave.days, 'ar')} × ${printedMoney(leave.dayRate)} جنيه = ${printedMoney(leave.amount)} جنيه`),
            'إجمالي المخصوم: ٣,٥٠٠ جنيه',
          ],
          [
            'Loan (Laptop): EGP 3,000 still owed, deducted',
            'Advance (Rent): EGP 1,000 still owed, waived',
            'Advance (Fuel): EGP 500 still owed, deducted',
            `Unused leave: ${printedDayCount(leave.days, 'en')} × EGP ${printedMoney(leave.dayRate)} = EGP ${printedMoney(leave.amount)}`,
            'Total deducted: EGP 3,500',
          ],
          ['المجموع: ٣,٥٠٠'],
        ]);
        // printing it settles nothing: the loan is HR's to settle on Unsettled
        expect((await prisma.payrollAdvance.findUniqueOrThrow({ where: { id: laptop }, select: { status: true } })).status).toBe('open');
        // amounts, as pay: the view is in the audit log
        expect((await auditOf(res.body.id)).find((a) => a.action === 'view_restricted')?.diff).toMatchObject({
          seen: 'generated',
          fields: ['deductions', 'deductions_en', 'deductions_total'],
        });

        // an Admin previews the template with Lina's data: the amounts masked, as a salary is
        const admin = await signIn(app, await createUser(prisma, ['admin']));
        await api().get(`/api/templates/versions/${upload.body.id}/preview`).query({ employeeId: lina.id }).set('Cookie', admin).buffer(true).parse(bytes).expect(200);
        expect(paragraphLines(Buffer.from(convert.mock.lastCall![0]))).toEqual([['عمر خالد محمود'], [MASK], [MASK], [`المجموع: ${MASK}`]]);
      } finally {
        await prisma.payrollAdvance.deleteMany({ where: { employeeId: lina.id } });
      }
    });
  });
});
