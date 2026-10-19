import { createHash } from 'node:crypto';
import { PDFDocument } from '@cantoo/pdf-lib';
import { ServiceUnavailableException, type INestApplication } from '@nestjs/common';
import { insuredWageOf, monthlyFromHourly } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { MockInstance } from 'vitest';
import { addDays, addMonths, shownDate, todayInCairo } from '../src/common/date-only.js';
import { MailService } from '../src/mail/mail.service.js';
import { PdfService } from '../src/pdf/pdf.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { paragraphTexts, textParts } from '../src/templates/docx-tags.js';
import { readZip } from '../src/templates/zip.js';
import { docx, p, r } from './fixtures/docx.js';
import { convertedPdf, hasEncrypt } from './fixtures/pdf.js';
import { createApp, createUser, signIn } from './helpers.js';

// Job offers (owner's request, 15 October 2026): drafting, the document, sending by email or as a link, the offer's
// page where the candidate answers, HR recording an answer, and the profile, employment and draft contract made on
// acceptance. Email is kept in MailService's outbox (MAIL_TRANSPORT=memory). The document is given and sent only as a
// protected PDF (owner's request, 15 October 2026: "No doc file export, just a protected PDF"): the converter is
// stubbed with a PDF made here, which is protected for real; what was filled in is read from the Word file handed to
// it, or kept with the offer.
process.env.MAIL_TRANSPORT = 'memory';

// always with a digit: a name ending in letters only would teach the ID card reading (english-name.ts) to spell محمود
// as this run's code, and paperwork.e2e-spec.ts would then find it (16 October 2026)
const RUN = `${Date.now().toString(36)}7`;
const TODAY = todayInCairo();
const YEAR = TODAY.slice(0, 4);
/** The expected first day: in three weeks. */
const JOIN = addDays(TODAY, 21);
const ORIGIN = 'https://people.example.com';
const NOT_VALID = 'This offer link is not valid. It may have been replaced by a newer email.';
const ONLY_SUPER_ADMIN = 'Only a Super Admin can delete records.';
const PDF_ONLY = 'Documents are given as protected PDFs only.';
const PDF_NOT_SET_UP = "The PDF converter isn't set up on the server, so documents can't be given out yet: they are given as protected PDFs only.";
const NOT_SENT_WITHOUT_PDF = "The PDF converter isn't set up on the server, so the offer can't be sent: it goes as a protected PDF only.";

/** Reads a response body as bytes, whatever its type. */
const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

/** The printed text of a .docx, one paragraph per line. */
function textOf(file: Buffer): string {
  const zip = readZip(file);
  return textParts(zip.entries.map((e) => e.name))
    .flatMap((name) => paragraphTexts(zip.read(name)!.toString('utf8')))
    .join('\n');
}

/** An attachment's bytes as kept in the outbox (the JSON transport writes them as base64 into the message). */
const attached = (a: { content: Buffer | string; encoding?: string }) => (Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content, (a.encoding as BufferEncoding) ?? 'base64'));

/** The link's secret: the last part of the link. */
const secretOf = (link: string) => link.split('/').at(-1)!;

interface Offer {
  id: string;
  number: string;
  status: string;
  employeeId: string | null;
  grossSalary: number | null;
  [key: string]: any;
}

describe('Job offers (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mail: MailService;
  let pdf: PdfService;
  let convert: MockInstance<PdfService['fromDocx']>;
  let available: MockInstance<() => boolean>;
  let converted: Buffer;
  let hrEmail: string;
  let hr: string;
  let hr2Email: string;
  let hr2: string;
  let ceo: string;
  let finance: string;
  let managerRole: string;
  let staff: string;
  let superAdmin: string;
  let companyBefore: { emailDomain: string | null; nameEn: string; nameAr: string | null } | null;
  let companyName: string;
  let deptId: string;
  let teamId: string;
  let otherTeamId: string;
  let jobTitleId: string;
  let gradeId: string;
  let gradeOutsideId: string;
  let shiftId: string;
  let housingId: string;
  let phoneId: string;
  let managerId: string;
  let leaverId: string;
  const api = () => request(app.getHttpServer());

  const create = (body: object, session = hr) => api().post('/api/offers').set('Cookie', session).send(body);
  const getOffer = async (id: string, session = hr): Promise<Offer> => (await api().get(`/api/offers/${id}`).set('Cookie', session).expect(200)).body as Offer;
  const patch = (id: string, body: object, session = hr) => api().patch(`/api/offers/${id}`).set('Cookie', session).send(body);
  const send = (id: string, body: object, session = hr) => api().post(`/api/offers/${id}/send`).set('Cookie', session).send(body);
  const answer = (id: string, body: object, session = hr) => api().post(`/api/offers/${id}/answer`).set('Cookie', session).send(body);
  const documentOf = (id: string, query: Record<string, string> = {}, session = hr) =>
    api().get(`/api/offers/${id}/document`).query(query).set('Cookie', session).buffer(true).parse(bytes);
  /** The Word file last handed to the converter: what the document was filled in with. */
  const lastFilled = () => Buffer.from(convert.mock.lastCall![0]);
  /** A draft's document: a protected PDF, its text read from the Word file filled in for it. */
  const documentText = async (id: string, session = hr) => {
    await documentOf(id, {}, session).expect(200);
    return textOf(lastFilled());
  };
  /** The Word file kept with a sent offer (never given out). */
  const keptDocx = async (id: string) => Buffer.from((await prisma.jobOffer.findUniqueOrThrow({ where: { id }, select: { data: true } })).data!);
  const messageOf = (res: request.Response) => (JSON.parse((res.body as Buffer).toString('utf8')) as { message: string }).message;
  const page = (secret: string) => api().get(`/api/public/offers/${secret}`);
  const accept = (secret: string, body: object) => api().post(`/api/public/offers/${secret}/accept`).send(body);
  const decline = (secret: string, body: object) => api().post(`/api/public/offers/${secret}/decline`).send(body);

  /** A candidate's offer as HR types it; names and emails unique to this run. */
  const candidate = (name: string, extra: object = {}) => ({
    fullNameEn: `${name} ${RUN}`,
    fullNameAr: 'عمر خالد محمود',
    email: `${name.toLowerCase().replace(/\s+/g, '.')}.${RUN}@mail.test`,
    employmentType: 'full_time',
    joinDate: JOIN,
    jobTitleId,
    gradeId,
    shiftId,
    grossSalary: 20000,
    ...extra,
  });

  async function draft(name: string, extra: object = {}): Promise<Offer> {
    return (await create(candidate(name, extra)).expect(201)).body as Offer;
  }

  /** A sent offer, and its link's secret. */
  async function sent(name: string, extra: object = {}): Promise<{ offer: Offer; secret: string }> {
    const o = await draft(name, extra);
    const res = await send(o.id, { via: 'link', origin: ORIGIN }).expect(200);
    return { offer: res.body.offer as Offer, secret: secretOf(res.body.link as string) };
  }

  async function publish(slot: string, file: Buffer, language?: 'ar' | 'en' | 'bilingual', draftOnly = false) {
    const upload = api().post(`/api/templates/${slot}/versions`).set('Cookie', hr).attach('file', file, `${slot}.docx`);
    const res = await (language ? upload.field('language', language) : upload).expect(201);
    if (!draftOnly) await api().post(`/api/templates/versions/${res.body.id}/publish`).set('Cookie', hr).expect(200);
  }

  async function employee(name: string, joinDate: string, end?: string) {
    const person = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف' }).expect(201);
    const hired = await api()
      .post(`/api/employees/${person.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate, departmentId: teamId, jobTitleId, gradeId })
      .expect(201);
    if (end) {
      await api().post(`/api/employees/${person.body.id}/employments/${hired.body.employment.id}/end`).set('Cookie', hr).send({ endDate: end, endReason: 'resigned' }).expect(200);
    }
    return person.body.id as string;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    mail = app.get(MailService);
    pdf = app.get(PdfService);
    // the converter (Gotenberg) can't run here: it is said to be set up, its PDF stood in for, and protected for real
    converted = await convertedPdf();
    available = vi.spyOn(pdf, 'available', 'get').mockReturnValue(true);
    convert = vi.spyOn(pdf, 'fromDocx').mockImplementation(async () => converted);
    await prisma.generatedDocument.deleteMany();
    await prisma.jobOffer.deleteMany();
    await prisma.templateVersion.deleteMany();

    hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hr2Email = await createUser(prisma, ['hr']);
    hr2 = await signIn(app, hr2Email);
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    managerRole = await signIn(app, await createUser(prisma, ['manager']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));

    companyBefore = await prisma.company.findUnique({ where: { id: 1 }, select: { emailDomain: true, nameEn: true, nameAr: true } });
    const company = await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '', nameAr: 'تريندليكس' }).expect(200);
    companyName = company.body.nameEn as string;

    const dept = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Sales ${RUN}`, nameAr: 'المبيعات' }).expect(201);
    deptId = dept.body.id;
    teamId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Accounts', nameAr: 'الحسابات', parentId: deptId }).expect(201)).body.id;
    otherTeamId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Field', parentId: deptId }).expect(201)).body.id;
    const grades = (await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[];
    gradeId = grades.find((g) => g.code === 'G4')!.id;
    gradeOutsideId = grades.find((g) => g.code === 'G7')!.id;
    const title = await api()
      .post('/api/job-titles')
      .set('Cookie', hr)
      .send({ departmentId: teamId, titleEn: 'Account Manager', titleAr: 'مدير حسابات', minGradeId: grades.find((g) => g.code === 'G3')!.id, maxGradeId: grades.find((g) => g.code === 'G5')!.id })
      .expect(201);
    jobTitleId = title.body.id;
    shiftId = ((await api().get('/api/shifts').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((s) => s.code === 'A')!.id;

    housingId = (await prisma.allowanceType.create({ data: { nameEn: `Housing ${RUN}`, nameAr: 'بدل سكن', taxable: true, insured: true } })).id;
    phoneId = (await prisma.allowanceType.create({ data: { nameEn: `Phone ${RUN}`, nameAr: 'بدل هاتف', active: false } })).id;

    managerId = await employee('Mona Manager', '2024-01-01');
    leaverId = await employee('Lina Leaver', '2023-01-01', '2025-06-30');

    await publish(
      'offer_full_time',
      docx({
        body:
          p(r('{{full_name_en}} — {{job_title}} — {{department}} — {{employment_type}}')) +
          p(r('Gross {{gross_salary}}; allowances {{allowances_en}}; total {{total_salary}}')) +
          p(r('From {{start_date}} to {{end_date}}, probation until {{probation_end}}')) +
          p(r('{{offer_number}} open until {{offer_expiry}} — {{company_name_en}}')),
      }),
      'en',
    );
    await publish('offer_part_time', docx({ body: p(r('{{full_name_en}}: {{pay_basis_en}}, {{hourly_rate}} an hour, {{hours_per_week}} hours over {{days_per_week}} days ({{gross_salary}} a month)')) }), 'en');
    // drafts only: the commission offer (owner, 18 October 2026: Sales became Full-time paid by commission, its offer
    // used once published) and the trainee's (its own slot since 19 October 2026, the internship's the unpaid intern's)
    await publish('offer_sales', docx({ body: p(r('{{full_name_en}}')) }), 'en', true);
    await publish('offer_trainee', docx({ body: p(r('{{full_name_en}}')) }), 'en', true);
    await publish('nda', docx({ body: p(r('{{full_name_en}} accepted {{offer_number}}')) }), 'en');
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    // the template versions are left for the templates tests to clear, which they can't while offers and documents use them
    await prisma.generatedDocument.deleteMany();
    await prisma.jobOffer.deleteMany();
    await prisma.allowanceType.deleteMany({ where: { id: { in: [housingId, phoneId] } } }).catch(() => undefined);
    if (companyBefore) await prisma.company.update({ where: { id: 1 }, data: companyBefore });
    await app.close();
  });

  describe('drafting', () => {
    it('refuses what an offer cannot be', async () => {
      const message = async (body: object) => (await create(body).expect(400)).body.message as string | string[];
      expect(await message(candidate('Bad', { grossSalary: undefined }))).toBe('Enter the gross salary.');
      expect(await message(candidate('Bad', { email: 'not an email' }))).toEqual(["Enter the candidate's email, e.g. name@example.com."]);
      expect(await message(candidate('Bad', { departmentId: otherTeamId }))).toBe('The job title "Account Manager" belongs to Accounts. Choose that team, or another job title.');
      expect(await message(candidate('Bad', { gradeId: gradeOutsideId }))).toBe('Account Manager takes grades G3 to G5. Choose a grade in that range.');
      expect(await message(candidate('Bad', { workArrangement: 'hybrid' }))).toBe('Choose the office days for a Hybrid work arrangement.');
      expect(await message(candidate('Bad', { managerId: leaverId }))).toBe(`Lina Leaver ${RUN} has no current employment. Choose a current employee as the manager.`);
      expect(await message(candidate('Bad', { expiresOn: addDays(TODAY, -1) }))).toBe("The offer's last day can't be in the past.");
      expect(await message(candidate('Bad', { probationMonths: 4 }))).toEqual(["Probation can't be longer than 3 months (Labour Law Art. 90)."]);
      expect(await message(candidate('Bad', { netSalary: 25000 }))).toBe("The net salary can't be more than the gross salary and allowances together.");
      expect(await message(candidate('Bad', { payBasis: 'hourly', hourlyRate: 150 }))).toBe(
        'Enter the hourly rate and the hours a week: by the hour, the gross salary is worked out from them.',
      );
      expect(await message(candidate('Bad', { allowances: [{ allowanceTypeId: phoneId, amount: 300 }] }))).toBe(
        `Phone ${RUN} is inactive, so it can't be added. Choose another allowance, or make it active again under Organization → Allowances.`,
      );
      // someone who works here now is not a candidate
      const current = await create(candidate('Bad', { employeeId: managerId })).expect(409);
      expect(current.body.message).toBe(`Mona Manager ${RUN} has a current employment, since 01/01/2024. An offer is for someone new, or a former employee.`);
      expect(await prisma.jobOffer.count()).toBe(0);
    });

    it('a new draft takes the defaults: numbered by the year, monthly, 80% basic, the contract settings, open for 7 days', async () => {
      const o = await draft('Omar Draft', { managerId, message: 'We look forward to working with you.' });
      expect(o).toMatchObject({
        number: expect.stringMatching(new RegExp(`^OFF-${YEAR}-\\d{4}$`)),
        status: 'draft',
        fullNameEn: `Omar Draft ${RUN}`,
        email: `omar.draft.${RUN}@mail.test`,
        employee: null,
        employmentType: 'full_time',
        // the department follows the job title: its team, with the department
        department: { id: teamId, nameEn: 'Accounts', nameAr: 'الحسابات', parent: { id: deptId, nameEn: `Sales ${RUN}`, nameAr: 'المبيعات' } },
        jobTitle: { id: jobTitleId, titleEn: 'Account Manager', titleAr: 'مدير حسابات' },
        grade: { id: gradeId, code: 'G4' },
        manager: { id: managerId, fullNameEn: `Mona Manager ${RUN}` },
        shift: { id: shiftId, code: 'A' },
        workArrangement: 'office',
        officeDays: [],
        // by the labour law (owner, 18 October 2026): not paid by commission, regular work, on site
        paidByCommission: false,
        workNature: 'regular',
        workPattern: 'on_site',
        joinDate: JOIN,
        payBasis: 'monthly',
        grossSalary: 20000,
        hourlyRate: null,
        hoursPerWeek: null,
        basicPercent: 80,
        netSalary: null,
        insuredSalary: insuredWageOf(20000, [], Number(JOIN.slice(0, 4))),
        allowances: [],
        allowancesTotal: 0,
        totalSalary: 20000,
        salaryHidden: false,
        probationMonths: 3,
        durationMonths: 12,
        expiresOn: addDays(TODAY, 7),
        message: 'We look forward to working with you.',
        template: { slotKey: 'offer_full_time', name: 'Job offer · Full-time', status: 'published', version: 1, previewVersion: null },
        missing: [],
        document: null,
        sentVia: null,
        sentCount: 0,
        hiredAt: null,
        emailConfigured: true,
        pdfAvailable: true,
        createdBy: { email: hrEmail },
      });
      const next = await draft('Omar Next');
      expect(Number(next.number.slice(-4))).toBe(Number(o.number.slice(-4)) + 1);
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'job_offer', entityId: o.id, action: 'create' } });
      expect(audit?.diff).toMatchObject({ number: o.number, grossSalary: 'changed' });
    });

    it('by the hour, the gross is the monthly estimate', async () => {
      const o = await draft('Huda Hourly', { employmentType: 'part_time', payBasis: 'hourly', hourlyRate: 150, hoursPerWeek: 24, daysPerWeek: 3, grossSalary: undefined });
      expect(o).toMatchObject({ payBasis: 'hourly', hourlyRate: 150, hoursPerWeek: 24, daysPerWeek: 3, grossSalary: monthlyFromHourly(150, 24) });
      // a monthly salary again: the rate and hours are cleared
      const monthly = (await patch(o.id, { payBasis: 'monthly', grossSalary: 9000 }).expect(200)).body as Offer;
      expect(monthly).toMatchObject({ payBasis: 'monthly', grossSalary: 9000, hourlyRate: null, hoursPerWeek: null });
    });

    it('allowances are kept as their kinds are now, and count in the total and the insured wage', async () => {
      const o = await draft('Ali Allowance', { grossSalary: 10000, allowances: [{ allowanceTypeId: housingId, amount: 2000 }] });
      expect(o.allowances).toEqual([{ allowanceTypeId: housingId, nameEn: `Housing ${RUN}`, nameAr: 'بدل سكن', taxable: true, insured: true, amount: 2000 }]);
      expect(o).toMatchObject({ allowancesTotal: 2000, totalSalary: 12000, insuredSalary: 12000 });
      // the kind renamed later: the offer keeps the name it was drafted with
      await prisma.allowanceType.update({ where: { id: housingId }, data: { nameEn: `Housing renamed ${RUN}` } });
      expect((await getOffer(o.id)).allowances[0].nameEn).toBe(`Housing ${RUN}`);
      await prisma.allowanceType.update({ where: { id: housingId }, data: { nameEn: `Housing ${RUN}` } });
      // replaced as a whole when sent; [] clears them
      const none = (await patch(o.id, { allowances: [] }).expect(200)).body as Offer;
      expect(none).toMatchObject({ allowances: [], allowancesTotal: 0, totalSalary: 10000 });
      await create(candidate('Bad', { allowances: [{ allowanceTypeId: housingId, amount: 1 }, { allowanceTypeId: housingId, amount: 2 }] })).expect(400);
    });

    it('a former employee has no probation again (Art. 90) and joins after their last employment', async () => {
      const o = await draft('Lina Again', { employeeId: leaverId });
      expect(o).toMatchObject({ employeeId: leaverId, employee: { id: leaverId, fullNameEn: `Lina Leaver ${RUN}` }, probationMonths: 0 });
      const again = await create(candidate('Lina Again', { employeeId: leaverId, probationMonths: 2 })).expect(400);
      expect(again.body.message).toBe(`Lina Leaver ${RUN} already had a probation with the company; the law allows it once (Art. 90).`);
      const early = await create(candidate('Lina Again', { employeeId: leaverId, joinDate: '2025-06-01' })).expect(400);
      expect(early.body.message).toBe(`Lina Leaver ${RUN}'s last employment ended on 30/06/2025: the join date must be after that.`);
    });
  });

  describe('who may see and change offers', () => {
    it('HR and the CEO read them, with the amounts; Finance, managers and employees may not; only HR writes', async () => {
      const o = await draft('Rana Roles');
      const list = (await api().get('/api/offers').set('Cookie', ceo).expect(200)).body as Offer[];
      expect(list.find((x) => x.id === o.id)).toMatchObject({
        number: o.number,
        status: 'draft',
        jobTitle: { titleEn: 'Account Manager', titleAr: 'مدير حسابات' },
        departmentName: `Sales ${RUN} › Accounts`,
        grossSalary: 20000,
        totalSalary: 20000,
        salaryHidden: false,
        employeeId: null,
      });
      expect((await getOffer(o.id, ceo)).grossSalary).toBe(20000);
      for (const session of [finance, managerRole, staff]) {
        await api().get('/api/offers').set('Cookie', session).expect(403);
        await api().get(`/api/offers/${o.id}`).set('Cookie', session).expect(403);
      }
      await create(candidate('Ceo Writes'), ceo).expect(403);
      await patch(o.id, { note: 'x' }, ceo).expect(403);
      await send(o.id, { via: 'link', origin: ORIGIN }, ceo).expect(403);
    });

    it('the list filters by status and searches names, email and number', async () => {
      const o = await draft('Sami Search');
      const find = async (query: Record<string, string>) => ((await api().get('/api/offers').query(query).set('Cookie', hr).expect(200)).body as Offer[]).map((x) => x.id);
      expect(await find({ q: o.number })).toEqual([o.id]);
      expect(await find({ q: `SAMI.SEARCH.${RUN}` })).toEqual([o.id]);
      expect(await find({ status: 'open', q: 'Sami Search' })).toEqual([o.id]);
      expect(await find({ status: 'sent', q: 'Sami Search' })).toEqual([]);
      await api().get('/api/offers').query({ status: 'lost' }).set('Cookie', hr).expect(400);
    });
  });

  describe('the document', () => {
    it('a draft is filled in afresh: a protected PDF, named after the slot, the number and the candidate', async () => {
      const o = await draft('Dina Document', { allowances: [{ allowanceTypeId: housingId, amount: 1500 }] });
      const res = await documentOf(o.id).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toMatch(/^inline;/);
      expect(decodeURIComponent(res.headers['content-disposition'])).toContain(`Job offer · Full-time - ${o.number} - Dina Document ${RUN}.pdf`);
      expect(hasEncrypt(res.body as Buffer)).toBe(true);
      expect(convert.mock.lastCall![1]).toBe(`Job offer · Full-time - ${o.number} - Dina Document ${RUN}.docx`);
      const text = textOf(lastFilled());
      const probationEnd = addDays(addMonths(JOIN, 3), -1);
      const end = addDays(addMonths(JOIN, 12), -1);
      expect(text).toBe(
        [
          `Dina Document ${RUN} — Account Manager — Accounts — Full-time`,
          `Gross 20,000; allowances Housing ${RUN}: 1,500; total 21,500`,
          `From ${shownDate(JOIN)} to ${shownDate(end)}, probation until ${shownDate(probationEnd)}`,
          `${o.number} open until ${shownDate(addDays(TODAY, 7))} — ${companyName}`,
        ].join('\n'),
      );
      // the terms are restricted: every view is audited
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'job_offer', entityId: o.id, action: 'view_restricted' } });
      expect(audit?.diff).toMatchObject({ number: o.number, seen: 'document' });
      // the CEO may download it too: saved rather than shown
      const saved = await documentOf(o.id, { download: '1' }, ceo).expect(200);
      expect(saved.headers['content-type']).toBe('application/pdf');
      expect(saved.headers['content-disposition']).toMatch(/^attachment;/);
      // protected (AES-256): opens without a password, the converter's page in it
      expect((await PDFDocument.load(saved.body as Buffer, { password: '' })).getPageCount()).toBe(1);
      await expect(PDFDocument.load(saved.body as Buffer)).rejects.toThrow();
    });

    it('refused while the template prints a value the offer lacks, and where to fill it in', async () => {
      const o = await draft('Pia Parttime', { employmentType: 'part_time', payBasis: 'hourly', hourlyRate: 100, hoursPerWeek: 20, grossSalary: undefined });
      const missing = [{ tag: 'days_per_week', label: expect.any(String), where: { tab: 'offer', key: 'daysPerWeek' } }];
      expect((await getOffer(o.id)).missing).toEqual(missing);
      const res = await documentOf(o.id).expect(422);
      expect(JSON.parse((res.body as Buffer).toString('utf8'))).toMatchObject({ message: 'Fill in the missing details first.', missing });
      await send(o.id, { via: 'link', origin: ORIGIN }).expect(422);
      await patch(o.id, { daysPerWeek: 3 }).expect(200);
      const text = await documentText(o.id);
      expect(text).toBe(`Pia Parttime ${RUN}: By the hour, 100 an hour, 20 hours over 3 days (${monthlyFromHourly(100, 20).toLocaleString('en-US')} a month)`);
    });

    it('refused without a published template for the employment type', async () => {
      // the freelance offer has no template yet (it is published further down)
      const freelance = await draft('Fred Freelance', { employmentType: 'freelance' });
      expect(freelance.template).toEqual({ slotKey: 'offer_freelance', name: 'Job offer · Freelance', status: 'missing', version: null, previewVersion: null });
      const res = await documentOf(freelance.id).expect(409);
      expect(JSON.parse((res.body as Buffer).toString('utf8')).message).toBe('Publish the Job offer · Freelance template first (Templates).');
      const trainee = await draft('Tara Trainee', { employmentType: 'trainee' });
      expect(trainee.template).toMatchObject({ slotKey: 'offer_trainee', status: 'draft', version: null });
      const refused = await send(trainee.id, { via: 'link', origin: ORIGIN }).expect(409);
      expect(refused.body.message).toBe('Publish the Job offer · Trainee template first (Templates).');
      // paid by commission while the commission offer is a draft only: the full-time one (owner, 18 October 2026)
      const sales = await draft('Sara Sales', { paidByCommission: true });
      expect(sales.template).toMatchObject({ slotKey: 'offer_full_time', status: 'published' });
      await prisma.jobOffer.delete({ where: { id: freelance.id } });
    });

    it('a draft is previewed with the newest draft of its template while none is published; sending still needs a published one', async () => {
      // owner's request, 15 October 2026: "Job offer preview should call data from the offer tab, even if not published yet"
      const o = await draft('Sami Trainee', { employmentType: 'trainee' });
      expect(o.template).toEqual({ slotKey: 'offer_trainee', name: 'Job offer · Trainee', status: 'draft', version: null, previewVersion: 1 });
      expect(o.missing).toEqual([]);
      const res = await documentOf(o.id).expect(200);
      expect(res.headers['x-template-draft']).toBe('1');
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(decodeURIComponent(res.headers['content-disposition'])).toContain(`Job offer · Trainee - ${o.number} - Sami Trainee ${RUN}.pdf`);
      expect(textOf(lastFilled())).toBe(`Sami Trainee ${RUN}`);

      // a newer draft is used: here one printing the salary, and a value the offer lacks until it is filled in
      await publish('offer_trainee', docx({ body: p(r('{{full_name_en}}: {{gross_salary}} over {{days_per_week}} days')) }), 'en', true);
      const now = await getOffer(o.id);
      expect(now.template).toMatchObject({ status: 'draft', version: null, previewVersion: 2 });
      const missing = [{ tag: 'days_per_week', label: expect.any(String), where: { tab: 'offer', key: 'daysPerWeek' } }];
      expect(now.missing).toEqual(missing);
      const lacking = await documentOf(o.id).expect(422);
      expect(JSON.parse((lacking.body as Buffer).toString('utf8'))).toMatchObject({ message: 'Fill in the missing details first.', missing });
      await patch(o.id, { daysPerWeek: 5 }).expect(200);
      const filled = await documentOf(o.id).expect(200);
      expect(filled.headers['x-template-draft']).toBe('2');
      expect(textOf(lastFilled())).toBe(`Sami Trainee ${RUN}: 20,000 over 5 days`);
      // the salary seen: audited, with the draft it was filled in from
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'job_offer', entityId: o.id, action: 'view_restricted' }, orderBy: { id: 'desc' } });
      expect(audit?.diff).toEqual({ number: o.number, fields: ['gross_salary'], seen: 'document', templateDraft: 2 });
      // the CEO may preview it too
      await documentOf(o.id, {}, ceo).expect(200);

      // sending still needs a published template, and nothing was kept
      const refused = await send(o.id, { via: 'link', origin: ORIGIN }).expect(409);
      expect(refused.body.message).toBe('Publish the Job offer · Trainee template first (Templates).');
      expect(await prisma.jobOffer.findUniqueOrThrow({ where: { id: o.id }, select: { status: true, fileName: true } })).toEqual({ status: 'draft', fileName: null });

      // with a published template, nothing is said of a draft
      const full = await draft('Fay Fulltime');
      expect(full.template.previewVersion).toBeNull();
      expect((await documentOf(full.id).expect(200)).headers['x-template-draft']).toBeUndefined();
    });

    it('only as a protected PDF: the Word file refused; without a converter, none at all', async () => {
      const o = await draft('Paul Pdf');
      expect(messageOf(await documentOf(o.id, { format: 'docx' }).expect(400))).toBe(PDF_ONLY);
      const res = await documentOf(o.id, { format: 'pdf' }).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(decodeURIComponent(res.headers['content-disposition'])).toContain(`${o.number} - Paul Pdf ${RUN}.pdf`);
      expect(hasEncrypt(res.body as Buffer)).toBe(true);

      available.mockReturnValue(false);
      try {
        expect((await getOffer(o.id)).pdfAvailable).toBe(false);
        expect(messageOf(await documentOf(o.id).expect(409))).toBe(PDF_NOT_SET_UP);
      } finally {
        available.mockReturnValue(true);
      }
    });

    it("prints the selected role's duties, keeping their formatting; missing until its job title has them", async () => {
      // owner's request, 15 October 2026: "map each job description to the selected role"
      const role = await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId: teamId, titleEn: `Field Agent ${RUN}` }).expect(201);
      await publish('offer_freelance', docx({ body: p(r('{{full_name_en}} — {{job_title}}')) + p(r('{{job_duties}}')) + p(r('In short: {{job_duties}}')) }), 'en');
      const o = await draft('Fadi Freelance', { employmentType: 'freelance', jobTitleId: role.body.id });
      const missing = [{ tag: 'job_duties', label: 'Duties and responsibilities', where: { tab: 'offer', key: 'jobTitleId' } }];
      expect(o.missing).toEqual(missing);
      const refused = await documentOf(o.id).expect(422);
      expect(JSON.parse((refused.body as Buffer).toString('utf8'))).toMatchObject({ message: 'Fill in the missing details first.', missing });

      const duties = '<p>Visits <strong>clients</strong> in the field.</p><ol><li><p>Collects orders</p></li><li><p>Reports <em>daily</em></p></li></ol>';
      await api().patch(`/api/job-titles/${role.body.id}`).set('Cookie', hr).send({ jdDuties: duties }).expect(200);
      expect((await getOffer(o.id)).missing).toEqual([]);
      await documentOf(o.id).expect(200);
      const filled = lastFilled();
      expect(textOf(filled)).toBe(
        [`Fadi Freelance ${RUN} — Field Agent ${RUN}`, 'Visits clients in the field.', '1.Collects orders', '2.Reports daily', 'In short: Visits clients in the field.1. Collects orders2. Reports daily'].join('\n'),
      );
      const document = readZip(filled).read('word/document.xml')!.toString('utf8');
      expect(document).toContain('<w:r><w:rPr><w:b/><w:bCs/><w:rtl/></w:rPr><w:t>clients</w:t></w:r>');
      expect(document).toContain('<w:ind w:left="720" w:hanging="360"/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t>1.</w:t><w:tab/></w:r>');
      expect(document).toContain('<w:r><w:rPr><w:i/><w:iCs/><w:rtl/></w:rPr><w:t>daily</w:t></w:r>');
      // inside a sentence: plain text, a line each
      expect(document).toContain(
        '<w:t xml:space="preserve">In short: Visits clients in the field.</w:t><w:br/><w:t xml:space="preserve">1. Collects orders</w:t><w:br/><w:t xml:space="preserve">2. Reports daily</w:t>',
      );
    });

    it('prints the fields added on 15 October 2026, missing until the offer has them, each on its own field', async () => {
      // owner's request, "add the missing fields"; a bilingual template: the tags that depend on the language in Arabic
      // (a freelancer's offer: a trainee's or an intern's has no probation since 19 October 2026, an intern's no hourly pay)
      await publish(
        'offer_freelance',
        docx({
          body:
            p(r('{{personal_email}} | {{manager_name}} | {{manager_name_en}}')) +
            p(r('{{shift}} | {{shift_en}}')) +
            p(r('{{work_arrangement}} | {{work_arrangement_en}}')) +
            p(r('{{probation_months}} | {{probation_months_en}}')) +
            p(r('{{grade_level}} | {{grade_level_en}}')) +
            p(r('{{hourly_rate}} | {{net_hourly_rate}} | {{basic_percent}}')),
        }),
        'bilingual',
      );
      // by the hour, 100 for 24 hours a week (104 hours a month); no manager, shift or net yet
      const o = await draft('Fayza Freelance', {
        employmentType: 'freelance',
        shiftId: undefined,
        payBasis: 'hourly',
        hourlyRate: 100,
        hoursPerWeek: 24,
        grossSalary: undefined,
        probationMonths: 1,
        basicPercent: 70,
      });
      expect(o.missing.map((m: { tag: string; where: object }) => [m.tag, m.where])).toEqual([
        ['manager_name', { tab: 'offer', key: 'managerId' }],
        ['manager_name_en', { tab: 'offer', key: 'managerId' }],
        ['shift', { tab: 'offer', key: 'shiftId' }],
        ['shift_en', { tab: 'offer', key: 'shiftId' }],
        ['net_hourly_rate', { tab: 'offer', key: 'netSalary' }],
      ]);
      await documentOf(o.id).expect(422);

      await patch(o.id, { managerId, shiftId, netSalary: 9000, workArrangement: 'hybrid', officeDays: [0, 2] }).expect(200);
      expect((await getOffer(o.id)).missing).toEqual([]);
      const grade = await prisma.grade.findUniqueOrThrow({ where: { id: gradeId }, select: { levelAr: true } });
      await prisma.grade.update({ where: { id: gradeId }, data: { levelAr: 'أول' } });
      try {
        // shift A: 9 to 6, Sunday to Thursday; the manager's Arabic name is موظف
        expect(await documentText(o.id)).toBe(
          [
            `${o.email} | موظف | Mona Manager ${RUN}`,
            'من 9:00 ص إلى 6:00 م، من الأحد إلى الخميس | 9:00 AM – 6:00 PM, Sunday to Thursday',
            'هجين (المكتب والمنزل) | Hybrid (office and home)',
            'شهر واحد | 1 month',
            'أول | Senior',
            '100 | 86.54 | 70%',
          ].join('\n'),
        );
      } finally {
        await prisma.grade.update({ where: { id: gradeId }, data: { levelAr: grade.levelAr } });
      }
      // the view still shows the shift as before, without its times
      expect((await getOffer(o.id)).shift).toEqual({ id: shiftId, code: 'A', workingDays: [0, 1, 2, 3, 4] });
    });
  });

  describe('sending', () => {
    it('as a link: the document kept as sent, and a secret only the link holds', async () => {
      const o = await draft('Leila Link');
      await send(o.id, { via: 'link', origin: `${ORIGIN}/offers` }).expect(400);
      await send(o.id, { via: 'post', origin: ORIGIN }).expect(400);
      const res = await send(o.id, { via: 'link', origin: `${ORIGIN}/` }).expect(200);
      const link = res.body.link as string;
      expect(link).toMatch(/^https:\/\/people\.example\.com\/offer\/[A-Za-z0-9_-]{43}$/);
      expect(res.body.offer).toMatchObject({
        status: 'sent',
        sentVia: 'link',
        sentTo: o.email,
        sentCount: 1,
        sentBy: { email: hrEmail },
        viewedAt: null,
        document: { fileName: `Job offer · Full-time - ${o.number} - Leila Link ${RUN}.docx`, hasPdf: true, documentDate: TODAY },
        missing: [],
      });
      expect(mail.outbox.some((m) => m.to === o.email)).toBe(false);
      // only the secret's SHA-256 is stored; the audit log never holds the secret
      const secret = secretOf(link);
      const row = await prisma.jobOffer.findUniqueOrThrow({ where: { id: o.id }, select: { tokenHash: true, templateVersionId: true } });
      expect(row.tokenHash).toBe(createHash('sha256').update(secret).digest('hex'));
      expect(row.templateVersionId).not.toBeNull();
      const entries = await prisma.auditLog.findMany({ where: { entityType: 'job_offer', entityId: o.id } });
      expect(JSON.stringify(entries.map((e) => e.diff))).not.toContain(secret);
      expect(entries.find((e) => e.action === 'send')?.diff).toMatchObject({ number: o.number, via: 'link', sentCount: 1, status: { from: 'draft', to: 'sent' } });
    });

    it('by email: to the candidate (or another address), the answer to HR, the document attached', async () => {
      const o = await draft('Emad Email', { message: 'Welcome aboard!\nSee you soon.' });
      const before = mail.outbox.length;
      const res = await send(o.id, { via: 'email', origin: ORIGIN, to: `Other.${RUN}@Mail.Test` }).expect(200);
      expect(res.body.offer).toMatchObject({ status: 'sent', sentVia: 'email', sentTo: `other.${RUN}@mail.test`, sentCount: 1 });
      expect(mail.outbox.length).toBe(before + 1);
      const m = mail.outbox.at(-1)!;
      expect(m).toMatchObject({ to: `other.${RUN}@mail.test`, replyTo: hrEmail, subject: `Job offer: Account Manager at ${companyName}` });
      expect(m.text).toContain(`Dear Emad Email ${RUN},`);
      expect(m.text).toContain(`starting on ${shownDate(JOIN)}`);
      expect(m.text).toContain('Welcome aboard!\nSee you soon.');
      expect(m.text).toContain(res.body.link);
      expect(m.text).toContain(`This offer is open until ${shownDate(addDays(TODAY, 7))}.`);
      expect(m.text).not.toContain('20,000');
      expect(m.html).toContain(`<a href="${res.body.link}">`);
      // the protected PDF only, never the Word file
      expect(m.attachments).toEqual([expect.objectContaining({ filename: `Job offer · Full-time - ${o.number} - Emad Email ${RUN}.pdf`, contentType: 'application/pdf' })]);
      expect(hasEncrypt(attached(m.attachments![0]))).toBe(true);
      expect(textOf(await keptDocx(o.id))).toContain(`Emad Email ${RUN} — Account Manager`);
    });

    it("by email when email isn't set up: refused, and the offer stays as it was", async () => {
      const o = await draft('Nadia Nomail');
      const configured = vi.spyOn(mail, 'configured', 'get').mockReturnValue(false);
      try {
        const res = await send(o.id, { via: 'email', origin: ORIGIN }).expect(503);
        expect(res.body.message).toBe("Email isn't set up on the server yet. Send the offer's link yourself instead.");
        expect((await getOffer(o.id)).emailConfigured).toBe(false);
      } finally {
        configured.mockRestore();
      }
      expect(await getOffer(o.id)).toMatchObject({ status: 'draft', sentCount: 0, document: null });
    });

    it('keeps the protected PDF it sent; refused without a converter, or when it fails, rather than sent with the Word file', async () => {
      const o = await draft('Pam Pdf');
      const res = await send(o.id, { via: 'email', origin: ORIGIN }).expect(200);
      expect(res.body.offer.document).toMatchObject({ hasPdf: true });
      const [attachment] = mail.outbox.at(-1)!.attachments!;
      expect(attachment).toMatchObject({ filename: `Job offer · Full-time - ${o.number} - Pam Pdf ${RUN}.pdf`, contentType: 'application/pdf' });
      const kept = await prisma.jobOffer.findUniqueOrThrow({ where: { id: o.id }, select: { pdf: true } });
      expect(attached(attachment)).toEqual(Buffer.from(kept.pdf!));
      expect(hasEncrypt(kept.pdf!)).toBe(true);
      // the copy as sent, without converting again
      convert.mockClear();
      const file = await documentOf(o.id).expect(200);
      expect(file.body).toEqual(Buffer.from(kept.pdf!));
      expect(convert).not.toHaveBeenCalled();

      // without a converter: not sent, and the offer stays as it was
      const before = mail.outbox.length;
      const unsent = await draft('Una Unsent');
      available.mockReturnValue(false);
      try {
        for (const via of ['email', 'link']) expect((await send(unsent.id, { via, origin: ORIGIN }).expect(409)).body.message).toBe(NOT_SENT_WITHOUT_PDF);
      } finally {
        available.mockReturnValue(true);
      }
      // the converter failing: not sent either
      convert.mockRejectedValueOnce(new ServiceUnavailableException('The PDF converter is not answering. Please try again in a minute.'));
      expect((await send(unsent.id, { via: 'email', origin: ORIGIN }).expect(503)).body.message).toBe('The PDF converter is not answering. Please try again in a minute.');
      expect(mail.outbox.length).toBe(before);
      expect(await getOffer(unsent.id)).toMatchObject({ status: 'draft', sentCount: 0, document: null });
    });

    it('a copy kept without its PDF, or with one from before PDFs were protected, is given protected', async () => {
      const { offer, secret } = await sent('Olga Older');
      // as an offer sent before 15 October 2026 might be kept: its PDF not protected, or none
      await prisma.jobOffer.update({ where: { id: offer.id }, data: { pdf: new Uint8Array(converted) } });
      for (const get of [() => documentOf(offer.id), () => api().get(`/api/public/offers/${secret}/document`).buffer(true).parse(bytes)]) {
        const res = await get().expect(200);
        expect(res.headers['content-type']).toBe('application/pdf');
        expect(hasEncrypt(res.body as Buffer)).toBe(true);
      }
      await prisma.jobOffer.update({ where: { id: offer.id }, data: { pdf: null } });
      convert.mockClear();
      const fresh = await documentOf(offer.id).expect(200);
      expect(hasEncrypt(fresh.body as Buffer)).toBe(true);
      expect(Buffer.from(convert.mock.calls[0][0])).toEqual(await keptDocx(offer.id));
      // without a converter, nothing to give
      available.mockReturnValue(false);
      convert.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      try {
        expect(messageOf(await documentOf(offer.id).expect(409))).toBe(PDF_NOT_SET_UP);
        const none = await api().get(`/api/public/offers/${secret}/document`).buffer(true).parse(bytes).expect(409);
        expect(messageOf(none)).toBe("The offer's document can't be opened yet. Please try again later, or contact HR.");
      } finally {
        available.mockReturnValue(true);
        convert.mockReset();
        convert.mockImplementation(async () => converted);
      }
    });

    it('sending again replaces the link: the one before stops working', async () => {
      const { offer, secret } = await sent('Rami Resend');
      await page(secret).expect(200);
      const again = await send(offer.id, { via: 'link', origin: ORIGIN }).expect(200);
      const newer = secretOf(again.body.link as string);
      expect(newer).not.toBe(secret);
      expect(again.body.offer).toMatchObject({ status: 'sent', sentCount: 2, viewedAt: null });
      expect((await page(secret).expect(404)).body.message).toBe(NOT_VALID);
      await page(newer).expect(200);
    });

    it('a sent offer changes only its last day and note; past its last day it is expired until a later one is set', async () => {
      const { offer } = await sent('Edo Expired');
      const refused = await patch(offer.id, { grossSalary: 25000 }).expect(409);
      expect(refused.body.message).toBe(`${offer.number} was sent: only its last day and the note can be changed. For other changes, withdraw it and draft a new offer.`);
      await patch(offer.id, { note: 'Called on Sunday' }).expect(200);
      await prisma.jobOffer.update({ where: { id: offer.id }, data: { expiresOn: new Date(`${addDays(TODAY, -1)}T00:00:00.000Z`) } });
      expect((await getOffer(offer.id)).status).toBe('expired');
      const find = async (status: string) => ((await api().get('/api/offers').query({ status, q: 'Edo Expired' }).set('Cookie', hr).expect(200)).body as Offer[]).map((x) => x.status);
      expect(await find('expired')).toEqual(['expired']);
      expect(await find('open')).toEqual([]);
      const resend = await send(offer.id, { via: 'link', origin: ORIGIN }).expect(409);
      expect(resend.body.message).toBe(`The offer's last day, ${shownDate(addDays(TODAY, -1))}, has passed. Set a later last day, then send it again.`);
      await answer(offer.id, { answer: 'accepted' }).expect(409);
      const reopened = (await patch(offer.id, { expiresOn: addDays(TODAY, 3) }).expect(200)).body as Offer;
      expect(reopened).toMatchObject({ status: 'sent', expiresOn: addDays(TODAY, 3), note: 'Called on Sunday' });
      await send(offer.id, { via: 'link', origin: ORIGIN }).expect(200);
    });
  });

  describe("the offer's page", () => {
    it('shows the offer without amounts, and records the first time it is opened', async () => {
      const { offer, secret } = await sent('Pia Page', { message: 'Hello!' });
      const res = await page(secret).expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toEqual({
        number: offer.number,
        status: 'sent',
        fullNameEn: `Pia Page ${RUN}`,
        fullNameAr: 'عمر خالد محمود',
        jobTitleEn: 'Account Manager',
        jobTitleAr: 'مدير حسابات',
        employmentType: 'full_time',
        joinDate: JOIN,
        expiresOn: addDays(TODAY, 7),
        companyNameEn: companyName,
        companyNameAr: 'تريندليكس',
        message: 'Hello!',
        document: { hasPdf: true },
        respondedAt: null,
        acceptedName: null,
      });
      const viewedAt = (await getOffer(offer.id)).viewedAt as string;
      expect(viewedAt).not.toBeNull();
      await page(secret).expect(200);
      expect((await getOffer(offer.id)).viewedAt).toBe(viewedAt);
      // the document as sent: the protected PDF kept, shown, or saved with ?download=1
      const file = await api().get(`/api/public/offers/${secret}/document`).buffer(true).parse(bytes).expect(200);
      expect(file.headers['content-type']).toBe('application/pdf');
      expect(file.headers['content-disposition']).toMatch(/^inline; .*\.pdf/);
      const kept = await prisma.jobOffer.findUniqueOrThrow({ where: { id: offer.id }, select: { pdf: true } });
      expect(file.body).toEqual(Buffer.from(kept.pdf!));
      expect(hasEncrypt(file.body as Buffer)).toBe(true);
      const saved = await api().get(`/api/public/offers/${secret}/document?download=1`).buffer(true).parse(bytes).expect(200);
      expect(saved.headers['content-disposition']).toMatch(/^attachment; .*\.pdf/);
      expect(textOf(await keptDocx(offer.id))).toContain(`Pia Page ${RUN} — Account Manager`);
      // any other secret: not valid
      expect((await page('x'.repeat(43)).expect(404)).body.message).toBe(NOT_VALID);
      expect((await page('short').expect(404)).body.message).toBe(NOT_VALID);
      await api().get('/api/public/offers/short/document').expect(404);
    });

    it('accepting needs the full name as on the offer; then the profile, employment, draft contract and document are made', async () => {
      const { offer, secret } = await sent('Ahmed Accept', {
        fullNameAr: 'أحمد إبراهيم مصطفى',
        mobile: '010 1234 5678',
        managerId,
        workArrangement: 'hybrid',
        officeDays: [2, 0],
        netSalary: 17000,
        allowances: [{ allowanceTypeId: housingId, amount: 2500 }],
        // by the labour law (owner, 18 October 2026): carried to the employment
        paidByCommission: true,
        workNature: 'seasonal',
      });
      await page(secret).expect(200);
      const wrong = await accept(secret, { name: 'Ahmed' }).expect(400);
      expect(wrong.body.message).toBe('Type your full name as it is on the offer.');
      const outbox = mail.outbox.length;

      const res = await accept(secret, { name: '  احمد  ابراهيم مصطفي ', ip: '203.0.113.7', userAgent: 'TestBrowser/1.0' }).expect(200);
      expect(res.body).toMatchObject({ status: 'accepted', acceptedName: 'احمد ابراهيم مصطفي', respondedAt: expect.any(String) });

      const o = await getOffer(offer.id);
      expect(o).toMatchObject({ status: 'accepted', answeredBy: null, acceptedName: 'احمد ابراهيم مصطفي', hiredAt: expect.any(String), employee: { fullNameEn: `Ahmed Accept ${RUN}` } });
      const row = await prisma.jobOffer.findUniqueOrThrow({ where: { id: offer.id }, select: { responseIp: true, responseAgent: true } });
      expect(row).toEqual({ responseIp: '203.0.113.7', responseAgent: 'TestBrowser/1.0' });

      // the profile, with the employment and the draft contract made from the offer
      const profile = (await api().get(`/api/employees/${o.employeeId}`).set('Cookie', hr).expect(200)).body;
      expect(profile).toMatchObject({ fullNameEn: `Ahmed Accept ${RUN}`, fullNameAr: 'أحمد إبراهيم مصطفى', personalEmail: offer.email, mobile: '+201012345678', employeeCode: expect.stringMatching(/^EMP-\d{4,}$/) });
      const probationEnd = addDays(addMonths(JOIN, 3), -1);
      expect(profile.employment).toMatchObject({
        employmentType: 'full_time',
        status: 'probation',
        joinDate: JOIN,
        probationEnd,
        workArrangement: 'hybrid',
        officeDays: [0, 2],
        paidByCommission: true,
        workNature: 'seasonal',
        workPattern: 'partly_remote',
        jobTitle: { id: jobTitleId },
        grade: { id: gradeId },
        manager: { id: managerId },
        department: { id: teamId },
        shift: { id: shiftId },
        contract: null, // a draft: signed contracts only
      });
      const contract = await prisma.contract.findFirstOrThrow({ where: { employmentId: profile.employment.id }, include: { allowances: true } });
      expect(contract).toMatchObject({
        number: expect.stringMatching(new RegExp(`^CON-${JOIN.slice(0, 4)}-\\d{4}$`)),
        version: 1,
        form: 'fixed',
        status: 'draft',
        durationMonths: 12,
        probationMonths: 3,
        basicPercent: 80,
        payBasis: 'monthly',
        note: `Made from job offer ${offer.number}.`,
      });
      expect(contract.grossSalary.toNumber()).toBe(20000);
      expect(contract.netSalary?.toNumber()).toBe(17000);
      expect(contract.insuredSalary.toNumber()).toBe(insuredWageOf(20000, [{ amount: 2500, taxable: true, insured: true }], Number(JOIN.slice(0, 4))));
      expect(contract.allowances.map((a) => [a.allowanceTypeId, a.nameEn, a.amount.toNumber()])).toEqual([[housingId, `Housing ${RUN}`, 2500]]);

      // the offer as sent, on the Employment tab
      const tab = (await api().get(`/api/employees/${o.employeeId}/documents`).set('Cookie', hr).expect(200)).body as { sections: { key: string; items: { slotKey: string; documents: any[] }[] }[] };
      const hiring = tab.sections.find((s) => s.key === 'hiring')!.items.find((i) => i.slotKey === 'offer_full_time')!;
      expect(hiring.documents).toHaveLength(1);
      expect(hiring.documents[0]).toMatchObject({ status: 'generated', fileName: o.document.fileName, documentDate: TODAY, generatedBy: { email: hrEmail } });
      expect(hiring.documents[0].note).toBe(`Accepted online by احمد ابراهيم مصطفي on ${shownDate(TODAY)} (${offer.number})`);

      // the audit log says where each record came from: no user, as the candidate accepted
      const created = await prisma.auditLog.findFirst({ where: { entityType: 'employee', entityId: o.employeeId!, action: 'create' } });
      expect(created).toMatchObject({ userId: null, diff: expect.objectContaining({ fromOffer: offer.number }) });
      const contractAudit = await prisma.auditLog.findFirst({ where: { entityType: 'contract', entityId: contract.id } });
      expect(contractAudit?.diff).toMatchObject({ grossSalary: 'changed', netSalary: 'changed', insuredSalary: 'changed', fromOffer: offer.number });

      // HR who sent it is told
      const told = mail.outbox.slice(outbox);
      expect(told).toHaveLength(1);
      expect(told[0]).toMatchObject({ to: hrEmail, subject: `Ahmed Accept ${RUN} accepted offer ${offer.number}` });
      expect(told[0].text).toContain(profile.employeeCode);

      // answered once only
      expect((await accept(secret, { name: `Ahmed Accept ${RUN}` }).expect(409)).body.message).toBe(`You already accepted this offer on ${shownDate(TODAY)}.`);
      await decline(secret, {}).expect(409);
      await send(offer.id, { via: 'link', origin: ORIGIN }).expect(409);
      await api().post(`/api/offers/${offer.id}/withdraw`).set('Cookie', hr).send({}).expect(409);
      expect((await api().post(`/api/offers/${offer.id}/hire`).set('Cookie', hr).expect(409)).body.message).toBe(`The profile was already made from ${offer.number}.`);

      // the employee's own documents can print the offer they accepted
      const nda = await api().post(`/api/employees/${o.employeeId}/documents`).set('Cookie', hr).send({ slotKey: 'nda' }).expect(201);
      const ndaFile = await prisma.generatedDocument.findUniqueOrThrow({ where: { id: nda.body.id }, select: { data: true } });
      expect(textOf(Buffer.from(ndaFile.data))).toBe(`Ahmed Accept ${RUN} accepted ${offer.number}`);
    });

    it('declining, with a reason; HR is told', async () => {
      const { offer, secret } = await sent('Dalia Decline');
      const outbox = mail.outbox.length;
      const res = await decline(secret, { reason: 'I took another offer.' }).expect(200);
      expect(res.body).toMatchObject({ status: 'declined', respondedAt: expect.any(String), acceptedName: null });
      expect(await getOffer(offer.id)).toMatchObject({ status: 'declined', declineReason: 'I took another offer.', hiredAt: null, employeeId: null });
      expect(mail.outbox.slice(outbox)).toEqual([expect.objectContaining({ to: hrEmail, subject: `Dalia Decline ${RUN} declined offer ${offer.number}` })]);
      expect(mail.outbox.at(-1)!.text).toContain('I took another offer.');
      expect((await accept(secret, { name: `Dalia Decline ${RUN}` }).expect(409)).body.message).toBe(
        `You declined this offer on ${shownDate(TODAY)}. If you have changed your mind, please contact HR.`,
      );
    });

    it('an expired offer is not answered; a withdrawn one has no page', async () => {
      const { offer, secret } = await sent('Xena Expired');
      await prisma.jobOffer.update({ where: { id: offer.id }, data: { expiresOn: new Date(`${addDays(TODAY, -2)}T00:00:00.000Z`) } });
      expect((await page(secret).expect(200)).body.status).toBe('expired');
      expect((await accept(secret, { name: `Xena Expired ${RUN}` }).expect(409)).body.message).toBe(
        `This offer was open until ${shownDate(addDays(TODAY, -2))}. If you still want to accept it, please contact HR.`,
      );
      await decline(secret, {}).expect(409);

      const other = await sent('Walid Withdrawn');
      const withdrawn = await api().post(`/api/offers/${other.offer.id}/withdraw`).set('Cookie', hr).send({ reason: 'The position was filled.' }).expect(200);
      expect(withdrawn.body).toMatchObject({ status: 'withdrawn', withdrawReason: 'The position was filled.', withdrawnAt: expect.any(String) });
      expect((await page(other.secret).expect(404)).body.message).toBe(NOT_VALID);
      await accept(other.secret, { name: `Walid Withdrawn ${RUN}` }).expect(404);
      await send(other.offer.id, { via: 'link', origin: ORIGIN }).expect(409);
      await patch(other.offer.id, { note: 'x' }).expect(409);
      // a draft can be withdrawn too
      const d = await draft('Dora Draft');
      expect((await api().post(`/api/offers/${d.id}/withdraw`).set('Cookie', hr).send({}).expect(200)).body.status).toBe('withdrawn');
    });
  });

  describe('answers recorded by HR', () => {
    it('declined, for a sent offer', async () => {
      const { offer } = await sent('Rita Recorded');
      const res = await answer(offer.id, { answer: 'declined', reason: 'Salary' }, hr2).expect(200);
      expect(res.body).toMatchObject({ status: 'declined', declineReason: 'Salary', answeredBy: { email: hr2Email }, respondedAt: expect.any(String), hireError: null });
      await answer(offer.id, { answer: 'accepted' }).expect(409);
      // the HR user who sent it is told, as someone else recorded it
      expect(mail.outbox.at(-1)).toMatchObject({ to: hrEmail, subject: `Rita Recorded ${RUN} declined offer ${offer.number}` });
    });

    it('accepted on paper, for a draft: the profile is made, with the copy as accepted', async () => {
      const o = await draft('Pedro Paper');
      const outbox = mail.outbox.length;
      const res = await answer(o.id, { answer: 'accepted' }).expect(200);
      expect(res.body).toMatchObject({ status: 'accepted', answeredBy: { email: hrEmail }, hiredAt: expect.any(String), hireError: null, document: { documentDate: TODAY } });
      // nobody sent it, so nobody is told
      expect(mail.outbox.length).toBe(outbox);
      const doc = await prisma.generatedDocument.findFirstOrThrow({ where: { employeeId: res.body.employeeId, slotKey: 'offer_full_time' } });
      expect(doc.note).toBe(`Accepted, recorded by HR (${o.number})`);
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'employee', entityId: res.body.employeeId, action: 'create' } });
      expect(audit?.userId).not.toBeNull();
    });
  });

  describe('hiring a former employee', () => {
    it('their own profile gets a new employment without probation; a failure keeps the acceptance and can be retried', async () => {
      const formerId = await employee('Fadi Former', '2022-01-01', '2024-12-31');
      const o = await draft('Fadi Former', { employeeId: formerId });
      expect(o.probationMonths).toBe(0);
      // hired again another way in the meantime: making the employment from the offer fails
      const meanwhile = await api()
        .post(`/api/employees/${formerId}/employments`)
        .set('Cookie', hr)
        .send({ employmentType: 'full_time', joinDate: '2025-03-01', departmentId: teamId, jobTitleId })
        .expect(201);
      const res = await answer(o.id, { answer: 'accepted' }).expect(200);
      const failure = `Fadi Former ${RUN} already has a current employment, since 01/03/2025, so another can't be made from ${o.number}. End that employment first, then make the profile again.`;
      expect(res.body).toMatchObject({ status: 'accepted', hiredAt: null, hireError: failure });
      expect((await api().post(`/api/offers/${o.id}/hire`).set('Cookie', hr).expect(409)).body.message).toBe(failure);

      // fixed: the employment added by mistake deleted; making it again works
      await api().delete(`/api/employees/${formerId}/employments/${meanwhile.body.employment.id}`).set('Cookie', superAdmin).expect(204);
      const hired = (await api().post(`/api/offers/${o.id}/hire`).set('Cookie', hr).expect(200)).body as Offer;
      expect(hired).toMatchObject({ status: 'accepted', employeeId: formerId, hiredAt: expect.any(String) });
      const profile = (await api().get(`/api/employees/${formerId}`).set('Cookie', hr).expect(200)).body;
      expect(profile.employments).toHaveLength(2);
      expect(profile.employment).toMatchObject({ joinDate: JOIN, status: 'active', probationEnd: null });
      const contract = await prisma.contract.findFirstOrThrow({ where: { employmentId: profile.employment.id } });
      expect(contract).toMatchObject({ probationMonths: 0, probationEnd: null, status: 'draft' });
      // the former employee's own profile: no new one
      expect(await prisma.employee.count({ where: { fullNameEn: `Fadi Former ${RUN}` } })).toBe(1);
    });
  });

  describe('deleting', () => {
    it('a Super Admin only, and never an accepted offer', async () => {
      const o = await draft('Gone Draft');
      expect((await api().delete(`/api/offers/${o.id}`).set('Cookie', hr).expect(403)).body.message).toBe(ONLY_SUPER_ADMIN);
      await api().delete(`/api/offers/${o.id}`).set('Cookie', superAdmin).expect(204);
      await api().get(`/api/offers/${o.id}`).set('Cookie', hr).expect(404);
      const accepted = await draft('Kept Accepted');
      await answer(accepted.id, { answer: 'accepted' }).expect(200);
      const refused = await api().delete(`/api/offers/${accepted.id}`).set('Cookie', superAdmin).expect(409);
      expect(refused.body.message).toBe(`${accepted.number} was accepted, so it stays on record with the profile made from it.`);
    });
  });

  describe('candidates are not employees', () => {
    it('only an accepted offer puts the person in the employee list', async () => {
      const names = ((await api().get('/api/employees').set('Cookie', hr).expect(200)).body as { fullNameEn: string }[]).map((e) => e.fullNameEn);
      for (const candidateName of ['Omar Draft', 'Leila Link', 'Emad Email', 'Dalia Decline', 'Xena Expired', 'Walid Withdrawn', 'Rita Recorded']) {
        expect(names).not.toContain(`${candidateName} ${RUN}`);
      }
      for (const hiredName of ['Ahmed Accept', 'Pedro Paper', 'Kept Accepted']) expect(names).toContain(`${hiredName} ${RUN}`);
    });
  });
});
