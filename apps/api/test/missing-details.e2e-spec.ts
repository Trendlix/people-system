import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The Missing Details report (owner's request, 16 October 2026): what each profile still lacks, by the profile's own
// checklist, for everyone but former employees; and the same as an Excel workbook. HR and the CEO only.

// Unique names per run: the test files share one database (emptied at the start of each run).
const RUN = Date.now().toString(36).toLowerCase();
let ids = 0;
/** A national ID no other run uses; digits 2–7 give the birth date 1 January 1990. */
const newNationalId = () => `2900101${String((Date.now() * 10 + ++ids) % 10_000_000).padStart(7, '0')}`;
// A real 1×1 PNG, for a paper in the employee file.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface Missing {
  key: string;
  label: string;
  tab: string;
}

/** A row of GET /employees/missing. */
interface Row {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  fullNameAr: string;
  standing: string;
  department: { id: string; nameEn: string; parent: { id: string; nameEn: string } | null } | null;
  jobTitle: { id: string; titleEn: string } | null;
  percent: number;
  missing: Missing[];
}

interface Report {
  generatedAt: string;
  rows: Row[];
}

/** Reads a response body as bytes, whatever its type. */
const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

/** A sheet's rows as their values, A to the last column. */
function rowsOf(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}

describe('Missing details (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let jobTitleId: string;
  let departmentName: string;
  // the people on the report, and one who is not
  let bare: { id: string; employeeCode: string }; // names only, not employed yet
  let hired: { id: string; employeeCode: string }; // hired full time, placed by the job title
  let complete: { id: string; employeeCode: string }; // not employed yet, with everything filled in
  let former: { id: string }; // their employment ended: left out
  const api = () => request(app.getHttpServer());

  async function addEmployee(name: string, extra: Record<string, unknown> = {}): Promise<{ id: string; employeeCode: string }> {
    const res = await api()
      .post('/api/employees')
      .set('Cookie', hr)
      .send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', ...extra })
      .expect(201);
    return { id: res.body.id, employeeCode: res.body.employeeCode };
  }

  async function hire(employeeId: string, extra: Record<string, unknown> = {}): Promise<string> {
    const res = await api()
      .post(`/api/employees/${employeeId}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: '2026-01-15', ...extra })
      .expect(201);
    return res.body.employment.id as string;
  }

  const addPaper = (id: string, kind: string) =>
    api().post(`/api/employees/${id}/paperwork`).set('Cookie', hr).field('kind', kind).attach('file', PNG, `${kind}.png`).expect(201);

  const report = async (session = hr) => (await api().get('/api/employees/missing').set('Cookie', session).expect(200)).body as Report;
  const workbookFile = (session = hr) => api().get('/api/employees/missing.xlsx').set('Cookie', session).buffer(true).parse(bytes);
  const profileOf = async (id: string) => (await api().get(`/api/employees/${id}`).set('Cookie', hr).expect(200)).body as { completeness: { percent: number; missing: Missing[] } };
  const rowOf = (r: Report, id: string) => r.rows.find((row) => row.id === id);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));

    departmentName = `Missing ${RUN}`;
    const dept = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: departmentName }).expect(201);
    const team = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Records', parentId: dept.body.id }).expect(201);
    const title = await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId: team.body.id, titleEn: 'Records Clerk' }).expect(201);
    jobTitleId = title.body.id;

    bare = await addEmployee('Bare');
    hired = await addEmployee('Hired', { gender: 'female', mobile: '01012345678' });
    await hire(hired.id, { jobTitleId });

    const left = await addEmployee('Left');
    const employmentId = await hire(left.id);
    await api()
      .post(`/api/employees/${left.id}/employments/${employmentId}/end`)
      .set('Cookie', hr)
      .send({ endDate: '2026-06-30', endReason: 'resigned' })
      .expect(200);
    former = left;

    // not employed yet: every field and the papers of a full-time hire (no work email or employment items)
    complete = await addEmployee('Complete', {
      displayName: 'Complete',
      gender: 'male',
      nationality: 'Egyptian',
      maritalStatus: 'single',
      militaryStatus: 'completed',
      insuranceNo: String(Date.now() + 7).slice(-12),
      personalEmail: 'complete@example.com',
      mobile: '01012345678',
      city: 'مدينة نصر',
      governorate: 'Cairo',
      addressAr: '١ شارع التحرير',
      degree: 'bachelor',
      university: 'Cairo University',
      faculty: 'Faculty of Engineering',
      major: 'Computer Engineering',
      graduationYear: 2012,
      educationGrade: 'very_good',
      qualificationAr: 'بكالوريوس الهندسة',
      identity: { nationalId: newNationalId(), printedNo: 'AB123456', issueDate: '2024-05-01', expiryDate: '2031-05-01' },
    });
    await api()
      .patch(`/api/employees/${complete.id}/bank`)
      .set('Cookie', hr)
      .send({ bankName: 'CIB', branch: 'Nasr City', accountNo: '1001 2345 6789', iban: 'EG380019000500000000263180002', holderName: 'Complete' })
      .expect(200);
    for (const kind of ['national_id_front', 'national_id_back', 'qualification_certificate', 'birth_certificate', 'military_certificate', 'criminal_record', 'insurance_print', 'personal_photo']) {
      await addPaper(complete.id, kind);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists everyone but former employees, each with their own profile’s completeness, least complete first', async () => {
    const r = await report();
    expect(Number.isNaN(Date.parse(r.generatedAt))).toBe(false);

    // the same checklist as each profile's header
    for (const person of [bare, hired, complete]) {
      const row = rowOf(r, person.id);
      expect(row).toBeDefined();
      expect({ percent: row!.percent, missing: row!.missing }).toEqual((await profileOf(person.id)).completeness);
      expect(row!.employeeCode).toBe(person.employeeCode);
    }
    expect(rowOf(r, bare.id)).toMatchObject({ fullNameEn: `Bare ${RUN}`, fullNameAr: 'موظف تجريبي', standing: 'not_employed', department: null, jobTitle: null, percent: 6 });
    expect(rowOf(r, bare.id)!.missing).toContainEqual({ key: 'criminal_record', label: 'Criminal record certificate', tab: 'documents' });
    // complete profiles are listed too, with nothing missing
    expect(rowOf(r, complete.id)).toMatchObject({ percent: 100, missing: [] });

    // former employees are left out
    expect(rowOf(r, former.id)).toBeUndefined();
    expect(r.rows.some((row) => row.standing === 'former')).toBe(false);

    // least complete first, then by employee code
    const ordered = [...r.rows].sort((a, b) => a.percent - b.percent || (a.employeeCode < b.employeeCode ? -1 : a.employeeCode > b.employeeCode ? 1 : 0));
    expect(r.rows.map((row) => row.id)).toEqual(ordered.map((row) => row.id));
  });

  it('gives the standing, department (a team under its department) and job title as the directory does', async () => {
    const r = await report();
    const directory = (await api().get('/api/employees').set('Cookie', hr).expect(200)).body as {
      id: string;
      standing: string;
      employment: { department: unknown; jobTitle: unknown } | null;
    }[];
    for (const row of r.rows) {
      const listed = directory.find((e) => e.id === row.id)!;
      expect(row.standing).toBe(listed.standing);
      expect(row.department).toEqual(listed.employment?.department ?? null);
      expect(row.jobTitle).toEqual(listed.employment?.jobTitle ?? null);
    }
    expect(rowOf(r, hired.id)).toMatchObject({
      standing: 'active',
      department: { nameEn: 'Records', parent: { nameEn: departmentName } },
      jobTitle: { id: jobTitleId, titleEn: 'Records Clerk' },
    });
  });

  it('is for HR and the CEO only', async () => {
    expect((await report(ceo)).rows.length).toBeGreaterThan(0);
    for (const roles of [['finance'], ['manager'], ['employee'], ['admin'], ['super_admin']] as const) {
      const session = await signIn(app, await createUser(prisma, [...roles]));
      await api().get('/api/employees/missing').set('Cookie', session).expect(403);
      await api().get('/api/employees/missing.xlsx').set('Cookie', session).expect(403);
    }
    await api().get('/api/employees/missing').expect(401);
  });

  it('downloads as an Excel workbook: a row per person with something missing, and a row per missing item', async () => {
    const res = await workbookFile(ceo).expect(200);
    expect(res.headers['content-type']).toContain(XLSX);
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['content-disposition']).toContain(`filename="Missing details ${todayInCairo()}.xlsx"`);
    expect(res.headers['cache-control']).toBe('private, no-store');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Missing Details', 'Each Missing Item']);
    const [people, items] = wb.worksheets;
    const peopleRows = rowsOf(people);
    const itemRows = rowsOf(items);
    expect(peopleRows[0]).toEqual(['Code', 'Name (English)', 'Name (Arabic)', 'Department', 'Job title', 'Standing', 'Complete', 'Missing personal details', 'Missing documents']);
    expect(itemRows[0]).toEqual(['Code', 'Name', 'Section', 'Item']);
    for (const ws of [people, items]) {
      expect(ws.getCell('A1').font?.bold).toBe(true);
      expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(ws.autoFilter).toBeTruthy();
    }

    // the report's people with something missing, in its order; one item row for each missing item
    const r = await report();
    const incomplete = r.rows.filter((row) => row.missing.length > 0);
    expect(peopleRows.slice(1).map((row) => row[0])).toEqual(incomplete.map((row) => row.employeeCode));
    expect(itemRows).toHaveLength(1 + incomplete.reduce((n, row) => n + row.missing.length, 0));

    const hiredRow = peopleRows.find((row) => row[0] === hired.employeeCode)!;
    const hiredReport = rowOf(r, hired.id)!;
    expect(hiredRow.slice(0, 7)).toEqual([hired.employeeCode, `Hired ${RUN}`, 'موظف تجريبي', `${departmentName} › Records`, 'Records Clerk', 'Active', hiredReport.percent / 100]);
    expect(hiredRow[7]).toMatch(/^Basic data: Display name, Date of birth, .* · Education: Degree, .* · Employment: Grade, Shift, Direct manager$/);
    expect(hiredRow[7]).not.toContain('Mobile'); // filled in
    // a woman's file needs no military certificate
    expect(hiredRow[8]).toBe('National ID scan (front and back), Qualification certificate, Birth certificate, Criminal record certificate, Social insurance print, Personal photo');

    const bareItems = itemRows.filter((row) => row[0] === bare.employeeCode);
    expect(bareItems).toHaveLength(rowOf(r, bare.id)!.missing.length);
    expect(bareItems).toContainEqual([bare.employeeCode, `Bare ${RUN}`, 'Documents', 'Criminal record certificate']);
    expect(bareItems).toContainEqual([bare.employeeCode, `Bare ${RUN}`, 'Education', 'Faculty']);
    expect(bareItems).toContainEqual([bare.employeeCode, `Bare ${RUN}`, 'Basic data', 'National ID number']);

    // nothing missing, or a former employee: not in the workbook
    expect(peopleRows.some((row) => row[0] === complete.employeeCode)).toBe(false);
    expect(itemRows.some((row) => row[0] === complete.employeeCode)).toBe(false);
    expect(peopleRows.some((row) => row[1] === `Left ${RUN}`)).toBe(false);
  });

  it('never takes /employees/missing for a profile: a profile’s address still works, and an unknown one is still refused', async () => {
    await api().get(`/api/employees/${bare.id}`).set('Cookie', hr).expect(200);
    await api().get('/api/employees/missing-things').set('Cookie', hr).expect(400); // not a UUID
  });
});
