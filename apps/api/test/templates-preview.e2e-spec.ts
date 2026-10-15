import type { INestApplication } from '@nestjs/common';
import { TEMPLATE_TAGS, type EmploymentType } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PdfService } from '../src/pdf/pdf.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { paragraphTexts, textParts } from '../src/templates/docx-tags.js';
import { readZip } from '../src/templates/zip.js';
import { docx, p, r, realTemplate } from './fixtures/docx.js';
import { createApp, createUser, signIn } from './helpers.js';

// A template version previewed with a real employee's data (owner's request, 15 October 2026: "When previewing a
// template, fetch any demo data already uploaded"): the people to preview with, best first, and the version (a draft
// too) filled in for one of them, nothing saved. Other test files' employees may be in the database as well, so the
// lists are read for this file's people (their names end in RUN).

const RUN = Date.now().toString(36);
const DIGITS = String((Date.now() + 7) % 10_000_000).padStart(7, '0');
const NATIONAL_ID = `2950312${DIGITS}`; // born 12 March 1995
const IBAN = 'EG380019000500000000263180002';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const NO_ONE = 'There is no one to preview this template with yet: add an employee first.';
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
  id: string;
  employeeCode: string;
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
  const api = () => request(app.getHttpServer());

  const people = async (versionId: string, session = hr): Promise<Person[]> =>
    (await api().get(`/api/templates/versions/${versionId}/preview-people`).set('Cookie', session).expect(200)).body as Person[];
  const mine = (list: Person[]) => list.filter((x) => x.fullNameEn.endsWith(RUN));
  const preview = (versionId: string, query: Record<string, string> = {}, session = hr) =>
    api().get(`/api/templates/versions/${versionId}/preview`).query(query).set('Cookie', session).buffer(true).parse(bytes);
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

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
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
  });

  afterAll(async () => {
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
    expect((await preview(v.id, { format: 'docx' }).expect(409)).body.toString()).toContain(NO_ONE);
    await preview(v.id).expect(409);
  });

  it('lists those the template is for, the most of its tags filled in first, with how many have a value', async () => {
    const list = await people(letter.id);
    // the letter prints 8 tags (one twice); the typed one and the ending's never have a value here
    expect(mine(list)).toEqual([
      { id: aaron.id, employeeCode: aaron.code, fullNameEn: `Aaron Complete ${RUN}`, employmentType: 'full_time', filled: 6, total: 8 },
      { id: abla.id, employeeCode: abla.code, fullNameEn: `Abla Part ${RUN}`, employmentType: 'part_time', filled: 4, total: 8 },
      { id: adam.id, employeeCode: adam.code, fullNameEn: `Adam Minimal ${RUN}`, employmentType: 'full_time', filled: 2, total: 8 },
    ]);
    expect(list.some((x) => x.id === dina.id)).toBe(false);
    expect(list.length).toBeLessThanOrEqual(50);
    for (let i = 1; i < list.length; i++) expect(list[i - 1].filled).toBeGreaterThanOrEqual(list[i].filled);
    // restricted values are counted whoever asks, but never sent
    expect(mine(await people(letter.id, admin))).toEqual(mine(list));

    // the full-time contract: full-time people only
    const contractPeople = await people(contractV.id);
    expect(contractPeople.every((x) => x.employmentType === 'full_time')).toBe(true);
    expect(mine(contractPeople).map((x) => x.id)).toEqual([aaron.id, adam.id]);

    // a resignation request isn't offered before an ending is recorded, but anyone may be previewed with it
    expect(mine(await people(resignation.id)).map((x) => [x.id, x.filled, x.total])).toEqual([
      [aaron.id, 1, 4],
      [abla.id, 1, 4],
      [adam.id, 1, 4],
    ]);
  });

  it('fills the version in, a draft too: the values, an empty tag as its label, restricted data shown to HR (and logged)', async () => {
    const res = await preview(letter.id, { employeeId: aaron.id, format: 'docx' }).expect(200);
    expect(res.headers['content-type']).toBe(DOCX);
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(fileNameOf(res.headers['content-disposition'])).toBe(`HR letter · English v${letter.version} - preview - Aaron Complete ${RUN}.docx`);
    expect(res.headers['x-preview-employee']).toBe(aaron.id);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(textOf(res.body as Buffer).split('\n')).toEqual([
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
    const little = textOf((await preview(letter.id, { employeeId: adam.id, format: 'docx' }).expect(200)).body as Buffer);
    expect(little).toContain(`Adam Minimal ${RUN} is our Account Manager, holding [Qualification (Arabic)].`);
    expect(little).toContain('National ID [National ID number]; salary EGP [Gross salary]; IBAN [IBAN].');
    // nothing restricted was printed with a value
    expect(await viewsOf(letter.id)).toHaveLength(1);
  });

  it('masks restricted data for a role that may not see it (an Admin), and shows it to the CEO', async () => {
    const before = (await viewsOf(letter.id)).length;
    const masked = textOf((await preview(letter.id, { employeeId: aaron.id, format: 'docx' }, admin).expect(200)).body as Buffer);
    expect(masked).toContain(`National ID ${MASK}; salary EGP ${MASK}; IBAN ${MASK}.`);
    expect(masked).toContain(`Aaron Complete ${RUN} is our Account Manager`);
    expect(masked).not.toContain(NATIONAL_ID);
    expect(masked).not.toContain(IBAN);
    // empty or not, it is masked all the same
    expect(textOf((await preview(letter.id, { employeeId: adam.id, format: 'docx' }, admin).expect(200)).body as Buffer)).toContain(
      `National ID ${MASK}; salary EGP ${MASK}; IBAN ${MASK}.`,
    );
    expect((await viewsOf(letter.id)).filter((v) => v.userId === adminId)).toEqual([]);

    const shown = textOf((await preview(letter.id, { employeeId: aaron.id, format: 'docx' }, ceo).expect(200)).body as Buffer);
    expect(shown).toContain(`National ID ${NATIONAL_ID}; salary EGP 20,000; IBAN ${IBAN}.`);
    expect(await viewsOf(letter.id)).toHaveLength(before + 1);
  });

  it('previews with the best person unless one is chosen', async () => {
    const [best] = await people(letter.id);
    const res = await preview(letter.id, { format: 'docx' }).expect(200);
    expect(res.headers['x-preview-employee']).toBe(best.id);
  });

  it('a contract copy prints the signed contract; a document not offered yet prints its empty tags as labels', async () => {
    const contractText = textOf((await preview(contractV.id, { employeeId: aaron.id, format: 'docx' }).expect(200)).body as Buffer);
    expect(contractText).toContain(NATIONAL_ID);
    expect(contractText).toContain('20,000');

    const resigned = textOf((await preview(resignation.id, { employeeId: adam.id, format: 'docx' }).expect(200)).body as Buffer);
    expect(resigned).toContain('عمر خالد محمود');
    for (const tag of ['reason_ar', 'resignation_date', 'request_date']) expect(resigned).toContain(`[${LABEL.get(tag)}]`);
  });

  it('as a PDF: refused (409) without a converter, shown in the browser with one', async () => {
    const before = (await viewsOf(letter.id)).length;
    expect((await preview(letter.id, { employeeId: aaron.id }).expect(409)).body.toString()).toMatch(/The PDF converter isn't set up/);
    // nothing was shown, so nothing was viewed
    expect(await viewsOf(letter.id)).toHaveLength(before);

    const convert = vi.spyOn(app.get(PdfService), 'fromDocx').mockResolvedValue(Buffer.from('%PDF-1.7 preview'));
    try {
      const res = await preview(letter.id, { employeeId: aaron.id }).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toMatch(/^inline;/);
      expect(fileNameOf(res.headers['content-disposition'])).toBe(`HR letter · English v${letter.version} - preview - Aaron Complete ${RUN}.pdf`);
      expect(res.headers['x-preview-employee']).toBe(aaron.id);
      expect((res.body as Buffer).toString()).toBe('%PDF-1.7 preview');
      // the filled file was converted
      const [file, name] = convert.mock.calls[0];
      expect(textOf(Buffer.from(file))).toContain(NATIONAL_ID);
      expect(name).toMatch(/ - preview - Aaron Complete .*\.docx$/);
      expect(await viewsOf(letter.id)).toHaveLength(before + 1);
      await preview(letter.id, { employeeId: aaron.id, format: 'pdf' }, ceo).expect(200);
    } finally {
      convert.mockRestore();
    }
  });

  it('only HR, Admin and the CEO; the version, the employee and the format checked', async () => {
    await api().get(`/api/templates/versions/${letter.id}/preview-people`).set('Cookie', staff).expect(403);
    await preview(letter.id, { employeeId: aaron.id, format: 'docx' }, staff).expect(403);
    await api().get(`/api/templates/versions/${letter.id}/preview-people`).set('Cookie', ceo).expect(200);
    await api().get(`/api/templates/versions/${letter.id}/preview-people`).expect(401);

    const unknown = '00000000-0000-4000-8000-000000000000';
    await api().get(`/api/templates/versions/${unknown}/preview-people`).set('Cookie', hr).expect(404);
    await preview(unknown, { format: 'docx' }).expect(404);
    await api().get('/api/templates/versions/not-a-uuid/preview-people').set('Cookie', hr).expect(400);
    await preview(letter.id, { employeeId: 'nobody', format: 'docx' }).expect(400);
    await preview(letter.id, { employeeId: unknown, format: 'docx' }).expect(404);
    // someone never employed has nothing to preview with
    await preview(letter.id, { employeeId: dina.id, format: 'docx' }).expect(400);
    await preview(letter.id, { employeeId: aaron.id, format: 'odt' }).expect(400);
  });
});
