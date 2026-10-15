import { createHash } from 'node:crypto';
import { ServiceUnavailableException, type INestApplication } from '@nestjs/common';
import { insuredWageOf, monthlyFromHourly } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, addMonths, shownDate, todayInCairo } from '../src/common/date-only.js';
import { MailService } from '../src/mail/mail.service.js';
import { PdfService } from '../src/pdf/pdf.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { paragraphTexts, textParts } from '../src/templates/docx-tags.js';
import { readZip } from '../src/templates/zip.js';
import { docx, p, r } from './fixtures/docx.js';
import { createApp, createUser, signIn } from './helpers.js';

// Job offers (owner's request, 15 October 2026): drafting, the document, sending by email or as a link, the offer's
// page where the candidate answers, HR recording an answer, and the profile, employment and draft contract made on
// acceptance. Email is kept in MailService's outbox (MAIL_TRANSPORT=memory); the PDF converter is stubbed.
process.env.MAIL_TRANSPORT = 'memory';

const RUN = Date.now().toString(36);
const TODAY = todayInCairo();
const YEAR = TODAY.slice(0, 4);
/** The expected first day: in three weeks. */
const JOIN = addDays(TODAY, 21);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ORIGIN = 'https://people.example.com';
const NOT_VALID = 'This offer link is not valid. It may have been replaced by a newer email.';
const ONLY_SUPER_ADMIN = 'Only a Super Admin can delete records.';
const FAKE_PDF = Buffer.from('%PDF-1.4\n% offer\n%%EOF\n');

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
  const documentOf = (id: string, format?: 'pdf' | 'docx', session = hr) =>
    api().get(`/api/offers/${id}/document`).query(format ? { format } : {}).set('Cookie', session).buffer(true).parse(bytes);
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

  async function publish(slot: string, file: Buffer, language?: 'ar' | 'en', draftOnly = false) {
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
    await publish('offer_sales', docx({ body: p(r('{{full_name_en}}')) }), 'en', true); // a draft only
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
        template: { slotKey: 'offer_full_time', name: 'Job offer · Full-time', status: 'published', version: 1 },
        missing: [],
        document: null,
        sentVia: null,
        sentCount: 0,
        hiredAt: null,
        emailConfigured: true,
        pdfAvailable: false,
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
    it("a draft is filled in afresh: the Word file, named after the slot, the number and the candidate", async () => {
      const o = await draft('Dina Document', { allowances: [{ allowanceTypeId: housingId, amount: 1500 }] });
      const res = await documentOf(o.id).expect(200);
      expect(res.headers['content-type']).toBe(DOCX);
      expect(res.headers['content-disposition']).toContain('attachment;');
      expect(decodeURIComponent(res.headers['content-disposition'])).toContain(`Job offer · Full-time - ${o.number} - Dina Document ${RUN}.docx`);
      const text = textOf(res.body as Buffer);
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
      expect(audit?.diff).toMatchObject({ number: o.number, seen: 'document', format: 'docx' });
      // the CEO may download it too
      await documentOf(o.id, 'docx', ceo).expect(200);
    });

    it('refused while the template prints a value the offer lacks, and where to fill it in', async () => {
      const o = await draft('Pia Parttime', { employmentType: 'part_time', payBasis: 'hourly', hourlyRate: 100, hoursPerWeek: 20, grossSalary: undefined });
      const missing = [{ tag: 'days_per_week', label: expect.any(String), where: { tab: 'offer', key: 'daysPerWeek' } }];
      expect((await getOffer(o.id)).missing).toEqual(missing);
      const res = await documentOf(o.id).expect(422);
      expect(JSON.parse((res.body as Buffer).toString('utf8'))).toMatchObject({ message: 'Fill in the missing details first.', missing });
      await send(o.id, { via: 'link', origin: ORIGIN }).expect(422);
      await patch(o.id, { daysPerWeek: 3 }).expect(200);
      const text = textOf((await documentOf(o.id).expect(200)).body as Buffer);
      expect(text).toBe(`Pia Parttime ${RUN}: By the hour, 100 an hour, 20 hours over 3 days (${monthlyFromHourly(100, 20).toLocaleString('en-US')} a month)`);
    });

    it('refused without a published template for the employment type', async () => {
      const intern = await draft('Ivan Intern', { employmentType: 'internship' });
      expect(intern.template).toEqual({ slotKey: 'offer_internship', name: 'Job offer · Internship', status: 'missing', version: null });
      const res = await documentOf(intern.id).expect(409);
      expect(JSON.parse((res.body as Buffer).toString('utf8')).message).toBe('Publish the Job offer · Internship template first (Templates).');
      const sales = await draft('Sara Sales', { employmentType: 'sales' });
      expect(sales.template).toMatchObject({ slotKey: 'offer_sales', status: 'draft', version: null });
      await send(sales.id, { via: 'link', origin: ORIGIN }).expect(409);
    });

    it('as PDF from the converter; without one, the Word file is offered instead', async () => {
      const o = await draft('Paul Pdf');
      const none = await documentOf(o.id, 'pdf').expect(409);
      expect(JSON.parse((none.body as Buffer).toString('utf8')).message).toBe("The PDF converter isn't set up: download the Word file.");
      const available = vi.spyOn(pdf, 'available', 'get').mockReturnValue(true);
      const convert = vi.spyOn(pdf, 'fromDocx').mockResolvedValue(FAKE_PDF);
      try {
        const res = await documentOf(o.id, 'pdf').expect(200);
        expect(res.headers['content-type']).toBe('application/pdf');
        expect(res.headers['content-disposition']).toMatch(/^inline;/);
        expect(decodeURIComponent(res.headers['content-disposition'])).toContain(`${o.number} - Paul Pdf ${RUN}.pdf`);
        expect(res.body).toEqual(FAKE_PDF);
        expect(convert).toHaveBeenCalledOnce();
        expect((await getOffer(o.id)).pdfAvailable).toBe(true);
      } finally {
        available.mockRestore();
        convert.mockRestore();
      }
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
        document: { fileName: `Job offer · Full-time - ${o.number} - Leila Link ${RUN}.docx`, hasPdf: false, documentDate: TODAY },
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
      expect(m.attachments).toEqual([expect.objectContaining({ filename: `Job offer · Full-time - ${o.number} - Emad Email ${RUN}.docx`, contentType: DOCX })]);
      expect(textOf(attached(m.attachments![0]))).toContain(`Emad Email ${RUN} — Account Manager`);
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

    it('with the PDF when the converter answers, attached instead of the Word file; without it when it fails', async () => {
      const available = vi.spyOn(pdf, 'available', 'get').mockReturnValue(true);
      const convert = vi.spyOn(pdf, 'fromDocx').mockResolvedValue(FAKE_PDF);
      try {
        const o = await draft('Pam Pdf');
        const res = await send(o.id, { via: 'email', origin: ORIGIN }).expect(200);
        expect(res.body.offer.document).toMatchObject({ hasPdf: true });
        const [attachment] = mail.outbox.at(-1)!.attachments!;
        expect(attachment).toMatchObject({ filename: `Job offer · Full-time - ${o.number} - Pam Pdf ${RUN}.pdf`, contentType: 'application/pdf' });
        expect(attached(attachment)).toEqual(FAKE_PDF);
        // the copy as sent, without converting again
        convert.mockClear();
        const file = await documentOf(o.id, 'pdf').expect(200);
        expect(file.body).toEqual(FAKE_PDF);
        expect(convert).not.toHaveBeenCalled();

        convert.mockRejectedValue(new ServiceUnavailableException('The PDF converter is not answering. Please try again in a minute.'));
        const failing = await draft('Fay Fails');
        const sentAnyway = await send(failing.id, { via: 'email', origin: ORIGIN }).expect(200);
        expect(sentAnyway.body.offer.document).toMatchObject({ hasPdf: false });
        expect(mail.outbox.at(-1)!.attachments![0].contentType).toBe(DOCX);
      } finally {
        available.mockRestore();
        convert.mockRestore();
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
        document: { hasPdf: false },
        respondedAt: null,
        acceptedName: null,
      });
      const viewedAt = (await getOffer(offer.id)).viewedAt as string;
      expect(viewedAt).not.toBeNull();
      await page(secret).expect(200);
      expect((await getOffer(offer.id)).viewedAt).toBe(viewedAt);
      // the document as sent: the Word file without a PDF
      const file = await api().get(`/api/public/offers/${secret}/document`).buffer(true).parse(bytes).expect(200);
      expect(file.headers['content-type']).toBe(DOCX);
      expect(textOf(file.body as Buffer)).toContain(`Pia Page ${RUN} — Account Manager`);
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

      // the offer as sent, on the Contracts tab
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
      const ndaFile = await api().get(`/api/documents/${nda.body.id}/file`).set('Cookie', hr).buffer(true).parse(bytes).expect(200);
      expect(textOf(ndaFile.body as Buffer)).toBe(`Ahmed Accept ${RUN} accepted ${offer.number}`);
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
