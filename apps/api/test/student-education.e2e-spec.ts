import type { INestApplication } from '@nestjs/common';
import { graduationMonthText, HIDDEN } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addMonths, todayInCairo } from '../src/common/date-only.js';
import { PdfService } from '../src/pdf/pdf.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { paragraphTexts, readDocx, textParts } from '../src/templates/docx-tags.js';
import { readZip } from '../src/templates/zip.js';
import { docx, p, r } from './fixtures/docx.js';
import { convertedPdf } from './fixtures/pdf.js';
import { createApp, createUser, signIn } from './helpers.js';

// A student on the Education tab (owner, 25 October 2026, on the trainee contract template's {{qualification}}: "if the
// intern is a student, how will we deal with it? … i am talking about the field mapping"; asked, "Add a Student
// option"): the "Still studying" switch with the year and the expected graduation, saved and audited; the intern's
// internship agreement (the one internship since 25 October 2026) printing the student's wording while Qualification
// (Arabic) is empty; Missing Details before and after the
// expected graduation; the employee's own change request; a developer's view; the warning on a renewal or a conversion
// drafted past the expected graduation. The people are made up.

const RUN = `${Date.now().toString(36)}5`;
// an internship agreement's renewal: no wage again, so no raise (owner, 19 October 2026)
const RENEWAL = {};
const WORDING = 'طالبة بالفرقة الثالثة – كلية التجارة – جامعة القاهرة';

interface Gap {
  key: string;
  label: string;
  tab: string;
}

interface Profile {
  id: string;
  employeeCode: string;
  stillStudying: boolean | null;
  studyYear: string | null;
  expectedGraduation: string | null;
  qualificationAr: string | null;
  employment: { id: string } | null;
  completeness: { percent: number; missing: Gap[] };
  [key: string]: unknown;
}

interface Contract {
  id: string;
  number: string;
  version: number;
  status: string;
  startDate: string;
  convertsTo: string | null;
  studentWarning?: string;
  [key: string]: unknown;
}

/** The printed text of a .docx: its paragraphs, in order, one per line. */
function textOf(file: Buffer): string {
  const zip = readZip(file);
  return textParts(zip.entries.map((e) => e.name))
    .flatMap((name) => paragraphTexts(zip.read(name)!.toString('utf8')))
    .join('\n');
}

describe('A student on the Education tab (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hrEmail: string;
  let hr: string;
  let superAdmin: string;
  let developer: string;
  let templateId: string;
  let emailDomainBefore: string | null;
  const today = todayInCairo();
  // a month ahead, and one gone by (kept as their first days)
  const ahead = `${addMonths(today, 3).slice(0, 7)}-01`;
  const passed = `${addMonths(today, -2).slice(0, 7)}-01`;
  const added: string[] = [];
  const api = () => request(app.getHttpServer());

  const profileOf = async (id: string, session = hr) => (await api().get(`/api/employees/${id}`).set('Cookie', session).expect(200)).body as Profile;
  const patch = (id: string, body: object) => api().patch(`/api/employees/${id}`).set('Cookie', hr).send(body);
  const educationGaps = (p: Profile) => p.completeness.missing.filter((m) => m.tab === 'education');
  const missingRow = async (id: string, session = hr) =>
    ((await api().get('/api/employees/missing').set('Cookie', session).expect(200)).body as { rows: { id: string; missing: Gap[] }[] }).rows.find((row) => row.id === id)!;
  const contractsOf = async (id: string, employmentId: string, session = hr) =>
    (await api().get(`/api/employees/${id}/employments/${employmentId}/contracts`).set('Cookie', session).expect(200)).body as Contract[];
  const docxOf = async (docId: string) => Buffer.from((await prisma.generatedDocument.findUniqueOrThrow({ where: { id: docId }, select: { data: true } })).data);
  const lastAudit = (id: string) => prisma.auditLog.findFirstOrThrow({ where: { entityType: 'employee', entityId: id }, orderBy: { id: 'desc' }, include: { user: { select: { email: true } } } });

  async function addEmployee(name: string, details: object = {}): Promise<Profile> {
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'سلمى أحمد', gender: 'female', ...details }).expect(201);
    added.push(res.body.id);
    return res.body as Profile;
  }

  /** An intern hired in one form (owner's decision, 16 October 2026), the internship agreement signed from today. */
  async function intern(name: string, details: object) {
    const e = await addEmployee(name, details);
    const hired = (await api()
      .post(`/api/employees/${e.id}/hire`)
      .set('Cookie', hr)
      .send({ employment: { employmentType: 'intern', joinDate: today }, contract: {} })
      .expect(201)).body as Profile;
    const [draft] = await contractsOf(e.id, hired.employment!.id);
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: today }).expect(200);
    return { id: e.id, employmentId: hired.employment!.id, contract: draft };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    // the converter (Gotenberg) can't run here: its PDF is stood in for
    const converted = await convertedPdf();
    vi.spyOn(app.get(PdfService), 'fromDocx').mockImplementation(async () => converted);
    hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    developer = await signIn(app, await createUser(prisma, ['employee', 'developer']));
    // sign-in accounts here are @test.local: no company email domain while this file runs
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);

    // the intern's internship agreement, printing {{qualification}} (المؤهل العلمي) as the owner's template does
    const upload = await api()
      .post('/api/templates/contract_internship/versions')
      .set('Cookie', superAdmin)
      .attach('file', docx({ body: p(r('الطرف الثاني (المتدرب): {{full_name_ar}}')) + p(r('المؤهل العلمي: {{qualification}}')) }), 'contract_internship.docx')
      .field('language', 'ar')
      .expect(201);
    templateId = upload.body.id;
    await api().post(`/api/templates/versions/${templateId}/publish`).set('Cookie', superAdmin).expect(200);
  });

  afterAll(async () => {
    await prisma.generatedDocument.deleteMany({ where: { OR: [{ employeeId: { in: added } }, { templateVersionId: templateId }] } });
    if (templateId) await prisma.templateVersion.deleteMany({ where: { id: templateId } });
    await prisma.employee.deleteMany({ where: { id: { in: added } } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    vi.restoreAllMocks();
    await app.close();
  });

  it('saves the switch, the year and the expected graduation (a month, kept as its first day), audited', async () => {
    const e = await addEmployee('Salma Student', { university: 'Cairo University', faculty: 'Commerce' });
    expect(e).toMatchObject({ stillStudying: false, studyYear: null, expectedGraduation: null });

    const saved = (await patch(e.id, { stillStudying: true, studyYear: 'year_3', expectedGraduation: '2027-06' }).expect(200)).body as Profile;
    expect(saved).toMatchObject({ stillStudying: true, studyYear: 'year_3', expectedGraduation: '2027-06-01' });
    const audit = await lastAudit(e.id);
    expect(audit).toMatchObject({ action: 'update', user: { email: hrEmail } });
    expect(audit.diff).toEqual({
      stillStudying: { from: false, to: true },
      studyYear: { from: null, to: 'year_3' },
      expectedGraduation: { from: null, to: '2027-06-01' },
    });

    // a day of the month is taken as its month; what isn't one is refused
    expect((await patch(e.id, { expectedGraduation: '2027-07-15' }).expect(200)).body).toMatchObject({ expectedGraduation: '2027-07-01' });
    expect((await patch(e.id, { expectedGraduation: 'June' }).expect(400)).body.message).toEqual(['Enter the expected graduation as a month, e.g. 2027-06.']);
    expect((await patch(e.id, { studyYear: 'year_8' }).expect(400)).body.message).toEqual(['Choose the study year from the list.']);
    expect((await patch(e.id, { stillStudying: null }).expect(400)).body.message).toEqual(['Send whether the employee is still studying as true or false.']);

    // turned off: the year and the expected graduation go with it, audited
    expect((await patch(e.id, { stillStudying: false }).expect(200)).body).toMatchObject({ stillStudying: false, studyYear: null, expectedGraduation: null });
    expect((await lastAudit(e.id)).diff).toEqual({
      stillStudying: { from: true, to: false },
      studyYear: { from: 'year_3', to: null },
      expectedGraduation: { from: '2027-07-01', to: null },
    });
    // a year sent without the switch on isn't kept
    expect((await patch(e.id, { studyYear: 'year_2' }).expect(200)).body).toMatchObject({ studyYear: null });

    // the database keeps them only while studying, and the month as its first day
    await expect(prisma.employee.update({ where: { id: e.id }, data: { studyYear: 'year_2' } })).rejects.toThrow(/employees_student_details_check/);
    await expect(
      prisma.employee.update({ where: { id: e.id }, data: { stillStudying: true, expectedGraduation: new Date('2027-06-15T00:00:00Z') } }),
    ).rejects.toThrow(/employees_expected_graduation_check/);
  });

  it('a new profile may start as a student, as the Add employee page’s Education step sends it', async () => {
    const e = await addEmployee('Nada New', { stillStudying: true, studyYear: 'masters', expectedGraduation: '2027-01' });
    expect(e).toMatchObject({ stillStudying: true, studyYear: 'masters', expectedGraduation: '2027-01-01' });
    const created = await lastAudit(e.id);
    expect(created.action).toBe('create');
    expect(created.diff).toMatchObject({ stillStudying: true, studyYear: 'masters', expectedGraduation: '2027-01-01' });
  });

  it('the intern’s agreement prints the student’s wording while Qualification (Arabic) is empty, the typed text once set', async () => {
    const t = await intern('Salma Intern', { university: 'Cairo University', faculty: 'Commerce', stillStudying: true, studyYear: 'year_3', expectedGraduation: ahead });
    const check = () => api().get(`/api/employees/${t.id}/documents/check`).query({ slotKey: 'contract_internship', contractId: t.contract.id }).set('Cookie', hr);
    expect((await check().expect(200)).body).toEqual({ missing: [], usesRestricted: false });

    const generate = async () => {
      const res = await api().post(`/api/employees/${t.id}/documents`).set('Cookie', hr).send({ slotKey: 'contract_internship', contractId: t.contract.id, documentDate: today }).expect(201);
      const filled = await docxOf(res.body.id);
      expect(readDocx(filled)).toEqual({ tags: [], unknownTags: [], broken: [] });
      return textOf(filled);
    };
    expect(await generate()).toContain(`المؤهل العلمي: ${WORDING}`);

    // typed, it wins
    await patch(t.id, { qualificationAr: 'طالبة بكلية التجارة - جامعة القاهرة' }).expect(200);
    const typed = await generate();
    expect(typed).toContain('المؤهل العلمي: طالبة بكلية التجارة - جامعة القاهرة');
    expect(typed).not.toContain(WORDING);

    // no year to word it from, nothing typed: the check asks for the qualification, on the Education tab
    await patch(t.id, { qualificationAr: '', studyYear: null }).expect(200);
    expect((await check().expect(200)).body.missing).toEqual([{ tag: 'qualification', label: 'Qualification (Arabic)', where: { tab: 'education', key: 'qualificationAr' } }]);
    // nor once they are no longer studying
    await patch(t.id, { studyYear: 'year_3' }).expect(200);
    expect((await check().expect(200)).body.missing).toEqual([]);
    await patch(t.id, { stillStudying: false }).expect(200);
    expect((await check().expect(200)).body.missing.map((m: { tag: string }) => m.tag)).toEqual(['qualification']);
  });

  it('Missing Details asks no degree of a student, and flags them once the expected graduation has passed', async () => {
    const e = await addEmployee('Mariam Missing', { university: 'Cairo University', faculty: 'Commerce', stillStudying: true, studyYear: 'year_4', expectedGraduation: ahead });
    const keys = (gaps: Gap[]) => gaps.filter((g) => g.tab === 'education').map((g) => g.key);
    expect(educationGaps(await profileOf(e.id))).toEqual([]);
    expect(keys((await missingRow(e.id)).missing)).toEqual([]);

    await patch(e.id, { expectedGraduation: passed }).expect(200);
    const item = { key: 'expectedGraduation', label: `Expected to graduate in ${graduationMonthText(passed)}: update the qualification`, tab: 'education' };
    expect(educationGaps(await profileOf(e.id))).toEqual([item]);
    expect((await missingRow(e.id)).missing.filter((g) => g.tab === 'education')).toEqual([item]);

    // graduated: the switch off, the degree and the rest asked as for anyone
    await patch(e.id, { stillStudying: false }).expect(200);
    expect(keys((await missingRow(e.id)).missing)).toEqual(['degree', 'major', 'graduationYear', 'educationGrade', 'qualificationAr']);
  });

  it('the employee asks to be marked a student; HR approves, audited as HR’s edit', async () => {
    const email = await createUser(prisma, ['employee']);
    const e = await addEmployee('Hana Herself', { workEmail: email, university: 'Ain Shams University', faculty: 'Arts' });
    const own = await signIn(app, email);
    const asked = await api()
      .post(`/api/employees/${e.id}/change-requests`)
      .set('Cookie', own)
      .send({ changes: { stillStudying: true, studyYear: 'year_2', expectedGraduation: '2028-06' }, note: 'Still at the faculty' })
      .expect(201);
    expect(asked.body.changes).toEqual([
      { field: 'stillStudying', label: 'Still studying', from: false, to: true },
      { field: 'studyYear', label: 'Study year', from: null, to: 'year_2' },
      { field: 'expectedGraduation', label: 'Expected graduation', from: null, to: '2028-06-01' },
    ]);
    await api().post(`/api/change-requests/${asked.body.id}/approve`).set('Cookie', hr).send({}).expect(200);
    expect(await profileOf(e.id)).toMatchObject({ stillStudying: true, studyYear: 'year_2', expectedGraduation: '2028-06-01' });
    expect((await lastAudit(e.id)).diff).toEqual({
      stillStudying: { from: false, to: true },
      studyYear: { from: null, to: 'year_2' },
      expectedGraduation: { from: null, to: '2028-06-01' },
    });
  });

  it('a renewal or a conversion drafted past the expected graduation is warned, never refused', async () => {
    const t = await intern('Rania Renewal', { university: 'Cairo University', faculty: 'Commerce', stillStudying: true, studyYear: 'year_4', expectedGraduation: ahead });
    const draft = (body: object) => api().post(`/api/employees/${t.id}/employments/${t.employmentId}/contracts`).set('Cookie', hr).send(body);
    const remove = (c: Contract) => api().delete(`/api/contracts/${c.id}`).set('Cookie', superAdmin).expect(204);

    // before the expected graduation: no warning
    const early = (await draft(RENEWAL).expect(201)).body as Contract;
    expect(early).toMatchObject({ version: 2, status: 'draft' });
    expect(early).not.toHaveProperty('studentWarning');
    await remove(early);

    await patch(t.id, { expectedGraduation: passed }).expect(200);
    const warning = `Still marked as a student (expected to graduate ${graduationMonthText(passed)}): check the qualification before printing.`;
    const renewal = (await draft(RENEWAL).expect(201)).body as Contract;
    expect(renewal).toMatchObject({ version: 2, status: 'draft', convertsTo: null, studentWarning: warning });
    // listed with it too; the signed agreement isn't warned
    const listed = await contractsOf(t.id, t.employmentId);
    expect(listed.find((c) => c.id === renewal.id)).toMatchObject({ studentWarning: warning });
    expect(listed.find((c) => c.id === t.contract.id)).not.toHaveProperty('studentWarning');
    // a developer sees the warning without the month
    expect((await contractsOf(t.id, t.employmentId, developer)).find((c) => c.version === 2)).toMatchObject({
      studentWarning: `Still marked as a student (expected to graduate ${HIDDEN}): check the qualification before printing.`,
    });
    await remove(renewal);

    const conversion = (await draft({ convertsTo: 'full_time', grossSalary: 9000 }).expect(201)).body as Contract;
    expect(conversion).toMatchObject({ convertsTo: 'full_time', studentWarning: warning });

    // updated: the switch off, the warning goes
    await patch(t.id, { stillStudying: false, qualificationAr: 'بكالوريوس التجارة - جامعة القاهرة' }).expect(200);
    expect((await contractsOf(t.id, t.employmentId)).find((c) => c.id === conversion.id)).not.toHaveProperty('studentWarning');
    await remove(conversion);
  });

  it('a developer gets the student fields as nothing, and the month hidden in Missing Details', async () => {
    const e = await addEmployee('Dalia Developer', { university: 'Cairo University', faculty: 'Commerce', stillStudying: true, studyYear: 'year_3', expectedGraduation: passed });
    expect(await profileOf(e.id, developer)).toMatchObject({ stillStudying: null, studyYear: null, expectedGraduation: null, university: HIDDEN, faculty: HIDDEN });
    expect((await missingRow(e.id, developer)).missing.filter((g) => g.tab === 'education')).toEqual([
      { key: 'expectedGraduation', label: `Expected to graduate in ${HIDDEN}: update the qualification`, tab: 'education' },
    ]);
  });
});
