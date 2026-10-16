import { PDFDocument } from '@cantoo/pdf-lib';
import type { INestApplication } from '@nestjs/common';
import { TEMPLATE_TAGS, type EmploymentType } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { MockInstance } from 'vitest';
import { PdfService } from '../src/pdf/pdf.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { paragraphTexts, textParts } from '../src/templates/docx-tags.js';
import { readZip } from '../src/templates/zip.js';
import { docx, p, r, realTemplate } from './fixtures/docx.js';
import { convertedPdf, hasEncrypt } from './fixtures/pdf.js';
import { createApp, createUser, signIn } from './helpers.js';

// A template version previewed with a real employee's data (owner's request, 15 October 2026: "When previewing a
// template, fetch any demo data already uploaded"): the people to preview with, best first, and the version (a draft
// too) filled in for one of them, nothing saved. A job offer template is previewed with job offers instead ("Job offer
// preview should call data from the offer tab, even if not published yet"), or the people while there is no offer of
// its employment type. Other test files' employees may be in the database as well, so the lists are read for this
// file's people and offers (their names end in RUN). The preview is given only as a protected PDF (owner's request,
// 15 October 2026: "No doc file export, just a protected PDF"): the converter is stubbed with a PDF made here, which is
// protected for real, and what was filled in is read from the Word file handed to it.

// always with a digit: a name ending in letters only would teach the ID card reading (english-name.ts) to spell محمود
// as this run's code, and paperwork.e2e-spec.ts would then find it (16 October 2026)
const RUN = `${Date.now().toString(36)}7`;
const DIGITS = String((Date.now() + 7) % 10_000_000).padStart(7, '0');
const NATIONAL_ID = `2950312${DIGITS}`; // born 12 March 1995
const IBAN = 'EG380019000500000000263180002';
const NO_ONE = 'There is no one to preview this template with yet: add an employee first.';
const NO_OFFER = 'There is nothing to preview this template with yet: draft a job offer first.';
const MASK = '••••';
const LABEL = new Map(TEMPLATE_TAGS.map((t) => [t.tag, t.labelEn]));

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

/** The file name a Content-Disposition header gives, read from its UTF-8 form. */
const fileNameOf = (disposition: string) => decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1] ?? '');

interface Person {
  kind: 'employee' | 'offer';
  id: string;
  employeeCode?: string;
  number?: string;
  status?: string;
  fullNameEn: string;
  employmentType: string | null;
  filled: number;
  total: number;
}

describe('Template preview with data (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let admin: string;
  let adminId: string;
  let ceo: string;
  let staff: string;
  let teamId: string;
  let jobTitleId: string;
  let gradeId: string;
  let shiftId: string;
  // a full-time employee with everything filled in, a part-time one with a draft contract, a full-time one with little,
  // and someone never employed
  let aaron: { id: string; code: string };
  let abla: { id: string; code: string };
  let adam: { id: string; code: string };
  let dina: { id: string };
  // draft versions: an English HR letter, the full-time contract and the resignation request
  let letter: { id: string; version: number };
  let contractV: { id: string; version: number };
  let resignation: { id: string; version: number };
  // job offers: full-time ones, the oldest with less filled in, and an allowance kind for them
  let housingId: string;
  let sparse: { id: string; number: string };
  let amira: { id: string; number: string };
  let celine: { id: string; number: string };
  let convert: MockInstance<PdfService['fromDocx']>;
  const api = () => request(app.getHttpServer());

  const people = async (versionId: string, session = hr): Promise<Person[]> =>
    (await api().get(`/api/templates/versions/${versionId}/preview-people`).set('Cookie', session).expect(200)).body as Person[];
  const mine = (list: Person[]) => list.filter((x) => x.fullNameEn.endsWith(RUN));
  /**
   * Ours in a list of at most 50, best first: the ones expected, in order; or, when people other test files left in the
   * test database fill the list first, the first of them down to where it was cut off (16 October 2026: the full-time
   * contract's list came back without Adam Minimal, the least filled in). Then the list is full and nobody listed has
   * fewer tags filled than ours cut off.
   */
  const expectOurs = (list: Person[], expected: (Partial<Person> & Pick<Person, 'id'>)[]) => {
    const ours = mine(list);
    expect(ours.length).toBeGreaterThan(0);
    expect(ours).toEqual(expected.slice(0, ours.length).map((x) => expect.objectContaining(x)));
    if (ours.length < expected.length) {
      expect(list).toHaveLength(50);
      const cut = expected[ours.length].filled;
      if (cut !== undefined) expect(list[list.length - 1].filled).toBeGreaterThanOrEqual(cut);
    }
  };
  const preview = (versionId: string, query: Record<string, string> = {}, session = hr) =>
    api().get(`/api/templates/versions/${versionId}/preview`).query(query).set('Cookie', session).buffer(true).parse(bytes);
  /** The text of the version previewed for `query`: given as a protected PDF, read from the Word file filled in for it. */
  const previewText = async (versionId: string, query: Record<string, string> = {}, session = hr) => {
    await preview(versionId, query, session).expect(200);
    return textOf(Buffer.from(convert.mock.lastCall![0]));
  };
  const viewsOf = (versionId: string) => prisma.auditLog.findMany({ where: { entityType: 'template_version', entityId: versionId, action: 'view_restricted' }, orderBy: { id: 'asc' } });

  async function draft(slot: string, file: Buffer, language?: 'ar' | 'en') {
    const upload = api().post(`/api/templates/${slot}/versions`).set('Cookie', hr).attach('file', file, `${slot}.docx`);
    const res = await (language ? upload.field('language', language) : upload).expect(201);
    return { id: res.body.id as string, version: res.body.version as number };
  }

  async function person(name: string, profile: Record<string, unknown> = {}) {
    const res = await api()
      .post('/api/employees')
      .set('Cookie', hr)
      .send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'عمر خالد محمود', ...profile })
      .expect(201);
    return { id: res.body.id as string, code: res.body.employeeCode as string };
  }

  async function hire(e: { id: string }, employmentType: EmploymentType) {
    const res = await api()
      .post(`/api/employees/${e.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType, joinDate: '2026-01-15', departmentId: teamId, jobTitleId, gradeId, shiftId })
      .expect(201);
    return res.body.employment.id as string;
  }

  async function contract(e: { id: string }, employmentId: string, body: object, signed: boolean) {
    const res = await api().post(`/api/employees/${e.id}/employments/${employmentId}/contracts`).set('Cookie', hr).send(body).expect(201);
    if (signed) await api().post(`/api/contracts/${res.body.id}/sign`).set('Cookie', hr).send({ signedOn: '2026-01-15' }).expect(200);
  }

  async function offer(name: string, extra: object = {}) {
    const email = `${name.toLowerCase().replace(/\s+/g, '.')}.${RUN}@mail.test`;
    const res = await api()
      .post('/api/offers')
      .set('Cookie', hr)
      .send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'عمر خالد محمود', email, employmentType: 'full_time', joinDate: '2026-12-01', grossSalary: 20000, ...extra })
      .expect(201);
    return { id: res.body.id as string, number: res.body.number as string };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    // the converter (Gotenberg) can't run here: its PDF is stood in for, and protected for real
    const converted = await convertedPdf();
    convert = vi.spyOn(app.get(PdfService), 'fromDocx').mockImplementation(async () => converted);
    hr = await signIn(app, await createUser(prisma, ['hr']));
    const adminEmail = await createUser(prisma, ['admin']);
    admin = await signIn(app, adminEmail);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id;
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    staff = await signIn(app, await createUser(prisma, ['employee']));

    const dept = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Preview ${RUN}`, nameAr: 'المعاينة' }).expect(201);
    teamId = dept.body.id;
    const title = await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId: teamId, titleEn: 'Account Manager', titleAr: 'مدير حسابات' }).expect(201);
    jobTitleId = title.body.id;
    gradeId = ((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((g) => g.code === 'G4')!.id;
    shiftId = ((await api().get('/api/shifts').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((s) => s.code === 'A')!.id;

    letter = await draft(
      'hr_letter_en',
      docx({
        body:
          p(r('{{full_name_en}} is our {{job_title}}, holding {{qualification}}.')) +
          p(r('National ID {{national_id}}; salary EGP {{gross_salary}}; IBAN {{iban}}.')) +
          p(r('To {{letter_to}}. Last working day: {{last_working_day}}. Again: {{full_name_en}}.')),
      }),
    );
    contractV = await draft('contract_full_time', realTemplate('Contract'));
    resignation = await draft('resignation_request', realTemplate('Resignation'));

    // the best: every tag of the letter but the typed one and the ending's
    aaron = await person('Aaron Complete', { qualificationAr: 'بكالوريوس تجارة' });
    const aaronJob = await hire(aaron, 'full_time');
    await api().patch(`/api/employees/${aaron.id}/identity`).set('Cookie', hr).send({ nationalId: NATIONAL_ID, printedNo: 'KX1234567', issueDate: '2021-03-09' }).expect(200);
    await api().patch(`/api/employees/${aaron.id}/bank`).set('Cookie', hr).send({ iban: IBAN }).expect(200);
    await contract(aaron, aaronJob, { grossSalary: 20000, netSalary: 17250.5 }, true);
    // part time, with the qualification and a draft contract
    abla = await person('Abla Part', { qualificationAr: 'ليسانس آداب' });
    await contract(abla, await hire(abla, 'part_time'), { grossSalary: 8000 }, false);
    // full time, with nothing more than the employment
    adam = await person('Adam Minimal');
    await hire(adam, 'full_time');
    dina = await person('Dina Never Employed');

    // job offers, newest last: one without a mobile or a job title, then two with everything (the same filled in)
    housingId = (await prisma.allowanceType.create({ data: { nameEn: `Housing ${RUN}`, nameAr: 'بدل سكن', taxable: true, insured: true } })).id;
    const complete = { mobile: '+201012345678', jobTitleId, gradeId, shiftId, allowances: [{ allowanceTypeId: housingId, amount: 1500 }] };
    sparse = await offer('Bilal Sparse');
    amira = await offer('Amira Complete', complete);
    celine = await offer('Celine Complete', complete);
  });

  afterAll(async () => {
    await prisma.jobOffer.deleteMany({ where: { id: { in: [sparse, amira, celine].filter(Boolean).map((o) => o.id) } } });
    if (housingId) await prisma.allowanceType.deleteMany({ where: { id: housingId } }).catch(() => undefined);
    vi.restoreAllMocks();
    await app.close();
  });

  it('with no one employed of the type a template is for: nobody to choose, and the preview says so (409)', async () => {
    // a type nobody in the database has (this file hires full- and part-time people only)
    const SLOT_OF: Partial<Record<EmploymentType, string>> = { internship: 'cert_internship', freelance: 'agreement_freelance', sales: 'contract_sales' };
    let slot: string | undefined;
    for (const [type, key] of Object.entries(SLOT_OF)) {
      if ((await prisma.employment.count({ where: { employmentType: type as EmploymentType } })) === 0) {
        slot = key;
        break;
      }
    }
    expect(slot, 'every employment type has someone in the test database').toBeDefined();
    const v = await draft(slot!, docx({ body: p(r('{{full_name_en}}')) }), 'en');
    expect(await people(v.id)).toEqual([]);
    expect((await preview(v.id).expect(409)).body.toString()).toContain(NO_ONE);
  });

  it('lists those the template is for, the most of its tags filled in first, with how many have a value', async () => {
    const list = await people(letter.id);
    // the letter prints 8 tags (one twice); the typed one and the ending's never have a value here
    const letterOurs: Person[] = [
      { kind: 'employee', id: aaron.id, employeeCode: aaron.code, fullNameEn: `Aaron Complete ${RUN}`, employmentType: 'full_time', filled: 6, total: 8 },
      { kind: 'employee', id: abla.id, employeeCode: abla.code, fullNameEn: `Abla Part ${RUN}`, employmentType: 'part_time', filled: 4, total: 8 },
      { kind: 'employee', id: adam.id, employeeCode: adam.code, fullNameEn: `Adam Minimal ${RUN}`, employmentType: 'full_time', filled: 2, total: 8 },
    ];
    expectOurs(list, letterOurs);
    expect(list.some((x) => x.id === dina.id)).toBe(false);
    expect(list.length).toBeLessThanOrEqual(50);
    for (let i = 1; i < list.length; i++) expect(list[i - 1].filled).toBeGreaterThanOrEqual(list[i].filled);
    // restricted values are counted whoever asks, but never sent
    expect(mine(await people(letter.id, admin))).toEqual(mine(list));

    // the full-time contract: full-time people only
    const contractPeople = await people(contractV.id);
    expect(contractPeople.every((x) => x.employmentType === 'full_time')).toBe(true);
    expectOurs(contractPeople, [{ id: aaron.id }, { id: adam.id }]);

    // a resignation request isn't offered before an ending is recorded, but anyone may be previewed with it
    expectOurs(await people(resignation.id), [
      { id: aaron.id, filled: 1, total: 4 },
      { id: abla.id, filled: 1, total: 4 },
      { id: adam.id, filled: 1, total: 4 },
    ]);
  });

  it('fills the version in, a draft too: the values, an empty tag as its label, restricted data shown to HR (and logged)', async () => {
    const res = await preview(letter.id, { employeeId: aaron.id }).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^inline;/);
    expect(fileNameOf(res.headers['content-disposition'])).toBe(`HR letter · English v${letter.version} - preview - Aaron Complete ${RUN}.pdf`);
    expect(res.headers['x-preview-employee']).toBe(aaron.id);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(hasEncrypt(res.body as Buffer)).toBe(true);
    const [filled, name] = convert.mock.lastCall!;
    expect(name).toBe(`HR letter · English v${letter.version} - preview - Aaron Complete ${RUN}.docx`);
    expect(textOf(Buffer.from(filled)).split('\n')).toEqual([
      `Aaron Complete ${RUN} is our Account Manager, holding بكالوريوس تجارة.`,
      `National ID ${NATIONAL_ID}; salary EGP 20,000; IBAN ${IBAN}.`,
      `To [${LABEL.get('letter_to')}]. Last working day: [${LABEL.get('last_working_day')}]. Again: Aaron Complete ${RUN}.`,
    ]);
    expect(LABEL.get('letter_to')).toBe('Addressed to');

    const views = await viewsOf(letter.id);
    expect(views).toHaveLength(1);
    expect(views[0].diff).toEqual({ employeeId: aaron.id, slot: 'hr_letter_en', version: letter.version, fields: ['national_id', 'gross_salary', 'iban'], seen: 'preview' });

    // nothing is saved
    expect(await prisma.generatedDocument.count({ where: { employeeId: aaron.id } })).toBe(0);

    // someone with little: their gaps as labels
    const little = await previewText(letter.id, { employeeId: adam.id });
    expect(little).toContain(`Adam Minimal ${RUN} is our Account Manager, holding [Qualification (Arabic)].`);
    expect(little).toContain('National ID [National ID number]; salary EGP [Gross salary]; IBAN [IBAN].');
    // nothing restricted was printed with a value
    expect(await viewsOf(letter.id)).toHaveLength(1);
  });

  it('masks restricted data for a role that may not see it (an Admin), and shows it to the CEO', async () => {
    const before = (await viewsOf(letter.id)).length;
    const masked = await previewText(letter.id, { employeeId: aaron.id }, admin);
    expect(masked).toContain(`National ID ${MASK}; salary EGP ${MASK}; IBAN ${MASK}.`);
    expect(masked).toContain(`Aaron Complete ${RUN} is our Account Manager`);
    expect(masked).not.toContain(NATIONAL_ID);
    expect(masked).not.toContain(IBAN);
    // empty or not, it is masked all the same
    expect(await previewText(letter.id, { employeeId: adam.id }, admin)).toContain(
      `National ID ${MASK}; salary EGP ${MASK}; IBAN ${MASK}.`,
    );
    expect((await viewsOf(letter.id)).filter((v) => v.userId === adminId)).toEqual([]);

    const shown = await previewText(letter.id, { employeeId: aaron.id }, ceo);
    expect(shown).toContain(`National ID ${NATIONAL_ID}; salary EGP 20,000; IBAN ${IBAN}.`);
    expect(await viewsOf(letter.id)).toHaveLength(before + 1);
  });

  it('previews with the best person unless one is chosen', async () => {
    const [best] = await people(letter.id);
    const res = await preview(letter.id).expect(200);
    expect(res.headers['x-preview-employee']).toBe(best.id);
  });

  it('a contract copy prints the signed contract; a document not offered yet prints its empty tags as labels', async () => {
    const contractText = await previewText(contractV.id, { employeeId: aaron.id });
    expect(contractText).toContain(NATIONAL_ID);
    expect(contractText).toContain('20,000');

    const resigned = await previewText(resignation.id, { employeeId: adam.id });
    expect(resigned).toContain('عمر خالد محمود');
    for (const tag of ['reason_ar', 'resignation_date', 'request_date']) expect(resigned).toContain(`[${LABEL.get(tag)}]`);
  });

  it('only as a protected PDF: shown, or saved with ?download=1; the Word file refused; none without a converter (409)', async () => {
    const before = (await viewsOf(letter.id)).length;
    convert.mockResolvedValueOnce(null);
    expect((await preview(letter.id, { employeeId: aaron.id }).expect(409)).body.toString()).toContain(
      "The PDF converter isn't set up on the server, so documents can't be given out yet: they are given as protected PDFs only.",
    );
    // nothing was shown, so nothing was viewed
    expect(await viewsOf(letter.id)).toHaveLength(before);
    expect((await preview(letter.id, { employeeId: aaron.id, format: 'docx' }).expect(400)).body.toString()).toContain('Documents are given as protected PDFs only.');
    expect(await viewsOf(letter.id)).toHaveLength(before);

    const res = await preview(letter.id, { employeeId: aaron.id, download: '1' }).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(fileNameOf(res.headers['content-disposition'])).toBe(`HR letter · English v${letter.version} - preview - Aaron Complete ${RUN}.pdf`);
    // protected (AES-256): opens without a password, the converter's page in it
    const pdf = res.body as Buffer;
    expect(hasEncrypt(pdf)).toBe(true);
    expect((await PDFDocument.load(pdf, { password: '' })).getPageCount()).toBe(1);
    expect(await viewsOf(letter.id)).toHaveLength(before + 1);
    await preview(letter.id, { employeeId: aaron.id, format: 'pdf' }, ceo).expect(200);
  });

  describe('a job offer template', () => {
    // the full-time offer template, a draft: what the offer has, and a bank detail an offer never has
    let offerV: { id: string; version: number };
    const OFFER_BODY =
      p(r('{{full_name_en}} — {{full_name_ar}} — {{job_title}}')) +
      p(r('Gross {{gross_salary}}; allowances {{allowances_en}}; total {{total_salary}}')) +
      p(r('Mobile {{phone}}; IBAN {{iban}}; {{offer_number}}'));
    const mineOffers = (list: Person[]) => mine(list).filter((x) => x.kind === 'offer');

    beforeAll(async () => {
      offerV = await draft('offer_full_time', docx({ body: OFFER_BODY }), 'en');
    });

    it('lists the offers of its employment type, newest first among those with as many filled in', async () => {
      const list = await people(offerV.id);
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((x) => x.kind === 'offer' && x.employmentType === 'full_time')).toBe(true);
      const offer = (o: { id: string; number: string }, name: string, filled: number) => ({
        kind: 'offer',
        id: o.id,
        number: o.number,
        fullNameEn: `${name} ${RUN}`,
        employmentType: 'full_time',
        status: 'draft',
        filled,
        total: 9,
      });
      // 9 tags; an offer never has the IBAN, and the first lacks the mobile and the job title too
      expect(mineOffers(list)).toEqual([offer(celine, 'Celine Complete', 8), offer(amira, 'Amira Complete', 8), offer(sparse, 'Bilal Sparse', 6)]);
      expect(list.length).toBeLessThanOrEqual(50);
      for (let i = 1; i < list.length; i++) expect(list[i - 1].filled).toBeGreaterThanOrEqual(list[i].filled);
      // the salary is counted whoever asks, but never sent
      expect(mineOffers(await people(offerV.id, admin))).toEqual(mineOffers(list));
    });

    it("fills the draft in with the offer's data: the names, the job title, the salary and the allowances (and logs the view)", async () => {
      const res = await preview(offerV.id, { offerId: amira.id }).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(hasEncrypt(res.body as Buffer)).toBe(true);
      expect(res.headers['x-preview-offer']).toBe(amira.id);
      expect(res.headers['x-preview-employee']).toBeUndefined();
      expect(fileNameOf(res.headers['content-disposition'])).toBe(`Job offer · Full-time v${offerV.version} - preview - ${amira.number} - Amira Complete ${RUN}.pdf`);
      expect(textOf(Buffer.from(convert.mock.lastCall![0])).split('\n')).toEqual([
        `Amira Complete ${RUN} — عمر خالد محمود — Account Manager`,
        `Gross 20,000; allowances Housing ${RUN}: 1,500; total 21,500`,
        `Mobile 01012345678; IBAN [IBAN]; ${amira.number}`,
      ]);
      const views = await viewsOf(offerV.id);
      expect(views).toHaveLength(1);
      expect(views[0].diff).toEqual({
        offerId: amira.id,
        slot: 'offer_full_time',
        version: offerV.version,
        fields: ['gross_salary', 'allowances_en', 'total_salary'],
        seen: 'preview',
      });
      // nothing is saved on the offer
      expect(await prisma.jobOffer.findUniqueOrThrow({ where: { id: amira.id }, select: { status: true, fileName: true, templateVersionId: true } })).toEqual({
        status: 'draft',
        fileName: null,
        templateVersionId: null,
      });

      // the one with less: its gaps as labels
      const little = await previewText(offerV.id, { offerId: sparse.id });
      expect(little).toContain(`Bilal Sparse ${RUN} — عمر خالد محمود — [Job title]`);
      expect(little).toContain(`Mobile [Mobile]; IBAN [IBAN]; ${sparse.number}`);
    });

    it('masks the salary for a role that may not see it (an Admin), and shows it to the CEO', async () => {
      const before = (await viewsOf(offerV.id)).length;
      const masked = await previewText(offerV.id, { offerId: amira.id }, admin);
      expect(masked.split('\n')).toEqual([
        `Amira Complete ${RUN} — عمر خالد محمود — Account Manager`,
        `Gross ${MASK}; allowances ${MASK}; total ${MASK}`,
        `Mobile 01012345678; IBAN ${MASK}; ${amira.number}`,
      ]);
      expect(masked).not.toContain('20,000');
      expect((await viewsOf(offerV.id)).filter((v) => v.userId === adminId)).toEqual([]);

      const shown = await previewText(offerV.id, { offerId: amira.id }, ceo);
      expect(shown).toContain('Gross 20,000; allowances');
      expect(await viewsOf(offerV.id)).toHaveLength(before + 1);
    });

    it('previews with the best offer unless one is chosen; an employee may still be chosen', async () => {
      const [best] = await people(offerV.id);
      const res = await preview(offerV.id).expect(200);
      expect(res.headers['x-preview-offer']).toBe(best.id);
      const asEmployee = await preview(offerV.id, { employeeId: aaron.id }).expect(200);
      expect(asEmployee.headers['x-preview-employee']).toBe(aaron.id);
      expect(textOf(Buffer.from(convert.mock.lastCall![0]))).toContain(`Aaron Complete ${RUN} — عمر خالد محمود — Account Manager`);
    });

    it('with no offer of its employment type: the people, as for any other template', async () => {
      expect(await prisma.jobOffer.count({ where: { employmentType: 'part_time' } }), 'no part-time offer is left by other test files').toBe(0);
      const partTime = await draft('offer_part_time', docx({ body: p(r('{{full_name_en}} — {{job_title}}')) }), 'en');
      const list = await people(partTime.id);
      expect(list.every((x) => x.kind === 'employee' && x.employmentType === 'part_time')).toBe(true);
      expect(mine(list).map((x) => [x.kind, x.id, x.filled, x.total])).toEqual([['employee', abla.id, 2, 2]]);
      const res = await preview(partTime.id).expect(200);
      expect(res.headers['x-preview-employee']).toBe(list[0].id);

      // nobody of the type at all: nothing to preview with
      const SLOT_OF: Partial<Record<EmploymentType, string>> = { internship: 'offer_internship', freelance: 'offer_freelance', sales: 'offer_sales' };
      let slot: string | undefined;
      for (const [type, key] of Object.entries(SLOT_OF)) {
        const t = type as EmploymentType;
        if ((await prisma.employment.count({ where: { employmentType: t } })) === 0 && (await prisma.jobOffer.count({ where: { employmentType: t } })) === 0) {
          slot = key;
          break;
        }
      }
      expect(slot, 'every employment type has someone or an offer in the test database').toBeDefined();
      const empty = await draft(slot!, docx({ body: p(r('{{full_name_en}}')) }), 'en');
      expect(await people(empty.id)).toEqual([]);
      expect((await preview(empty.id).expect(409)).body.toString()).toContain(NO_OFFER);
    });

    it('the offer checked: for a job offer template only, not with an employee as well, and it must exist', async () => {
      const unknown = '00000000-0000-4000-8000-000000000000';
      expect((await preview(letter.id, { offerId: amira.id }).expect(400)).body.toString()).toContain('only a job offer template takes a job offer');
      expect((await preview(offerV.id, { offerId: amira.id, employeeId: aaron.id }).expect(400)).body.toString()).toContain('not both');
      expect((await preview(offerV.id, { offerId: unknown }).expect(404)).body.toString()).toContain('Job offer not found.');
      await preview(offerV.id, { offerId: 'nothing' }).expect(400);
      await preview(offerV.id, { offerId: amira.id }, staff).expect(403);
    });
  });

  it('only HR, Admin and the CEO; the version, the employee and the format checked', async () => {
    await api().get(`/api/templates/versions/${letter.id}/preview-people`).set('Cookie', staff).expect(403);
    await preview(letter.id, { employeeId: aaron.id }, staff).expect(403);
    await api().get(`/api/templates/versions/${letter.id}/preview-people`).set('Cookie', ceo).expect(200);
    await api().get(`/api/templates/versions/${letter.id}/preview-people`).expect(401);

    const unknown = '00000000-0000-4000-8000-000000000000';
    await api().get(`/api/templates/versions/${unknown}/preview-people`).set('Cookie', hr).expect(404);
    await preview(unknown).expect(404);
    await api().get('/api/templates/versions/not-a-uuid/preview-people').set('Cookie', hr).expect(400);
    await preview(letter.id, { employeeId: 'nobody' }).expect(400);
    await preview(letter.id, { employeeId: unknown }).expect(404);
    // someone never employed has nothing to preview with
    await preview(letter.id, { employeeId: dina.id }).expect(400);
    await preview(letter.id, { employeeId: aaron.id, format: 'odt' }).expect(400);
    await preview(letter.id, { employeeId: aaron.id, format: 'docx' }).expect(400);
  });
});
