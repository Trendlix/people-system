import type { INestApplication } from '@nestjs/common';
import { DEVELOPER_NO_FILES, type SiContributionsReport, type SiMissingReport, type SiRegisterReport } from '@trendlix/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The Social Insurance report (owner, 27 October 2026: "is there a report for the social insurance? to be filled from the
// social insurance tab"; he chose all three: the insured staff register, the monthly contributions and the missing data
// checklist), from each profile's Social Insurance tab. In a department of its own: Rana (registered, her own comprehensive
// wage, Form 1 printed and the print uploaded), Nour (full time, not registered), Sami (part time, registered), Fady (a
// freelancer marked registered: not insured all the same), a joiner and a leaver of the same month, and Clara (C-level).
// Who sees each view, the rows and totals, the filters, Finance without the national ID and the employee file, the
// workbooks in the audit log, a developer's masked figures. Other test files leave people in the same database, so the
// checks filter by this department or look at these people. Everything made here is deleted at the end; every name,
// number and amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const DIGITS = String(Date.now()).slice(-8);
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const JOINED = firstDay(monthsLater(CURRENT, -6));
/** The month of the contributions checked: a joiner and a leaver in it. */
const MONTH = monthsLater(CURRENT, -2);
const JOINER_JOINED = `${MONTH}-10`;
const LEAVER_LEFT = `${MONTH}-20`;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NATIONAL_ID = `29${DIGITS}1234`;

interface Person {
  id: string;
  employeeCode: string;
  employmentId: string;
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

const piasters = (v: number) => Math.round(v * 100) / 100;
const sum = (values: (number | null)[]) => values.reduce<number>((s, v) => s + Math.round((v ?? 0) * 100), 0) / 100;
const messagesOf = (res: request.Response) => [...new Set([res.body.message].flat() as string[])];

describe('Social Insurance report (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  let admin: string;
  let superAdmin: string;
  let hrSuper: string; // HR and Super Admin: gives the C-level grade
  let staff: string;
  let developer: string;
  let g9: string;
  let g9WasConfidential: boolean;
  let departmentId: string;
  let teamId: string;
  let transportId: string;
  let templateVersionId: string | null = null;
  const people: string[] = [];
  const api = () => request(app.getHttpServer());

  let rana: Person; // registered, her own comprehensive wage of 12,000 (contract 20,000 and a 2,000 allowance), complete
  let nour: Person; // full time, not registered
  let sami: Person; // part time, registered, no details yet
  let fady: Person; // a freelancer marked registered
  let joiner: Person; // registered, joined in MONTH
  let leaver: Person; // registered, left in MONTH
  let clara: Person; // C-level, registered

  async function hire(name: string, employment: Record<string, unknown>, placeId: string, session = hr): Promise<Person> {
    const e = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تقرير التأمينات' }).expect(201);
    people.push(e.body.id);
    const hired = await api()
      .post(`/api/employees/${e.body.id}/employments`)
      .set('Cookie', session)
      .send({ employmentType: 'full_time', joinDate: JOINED, departmentId: placeId, ...employment })
      .expect(201);
    return { id: e.body.id, employeeCode: e.body.employeeCode, employmentId: hired.body.employment.id };
  }

  async function signed(p: Person, body: Record<string, unknown>, session = hr) {
    const draft = (await api().post(`/api/employees/${p.id}/employments/${p.employmentId}/contracts`).set('Cookie', session).send({ grossSalary: 12000, ...body }).expect(201)).body as {
      id: string;
      startDate: string;
    };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', session).send({ signedOn: draft.startDate }).expect(200);
  }

  const tab = (p: Person, body: Record<string, unknown>, session = hr) => api().patch(`/api/employees/${p.id}`).set('Cookie', session).send(body).expect(200);
  const get = (view: string, query: Record<string, string> = {}, session = hr) => api().get(`/api/payroll/social-insurance/${view}`).query(query).set('Cookie', session);
  const workbookFile = (view: string, query: Record<string, string> = {}, session = hr) =>
    api().get(`/api/payroll/social-insurance/${view}/workbook`).query(query).set('Cookie', session).buffer(true).parse(bytes);
  const register = async (query: Record<string, string> = {}, session = hr) => (await get('register', { departmentId, ...query }, session).expect(200)).body as SiRegisterReport;
  const contributions = async (query: Record<string, string> = {}, session = hr) => (await get('contributions', { departmentId, ...query }, session).expect(200)).body as SiContributionsReport;
  const missing = async (session = hr) => (await get('missing', { departmentId }, session).expect(200)).body as SiMissingReport;
  const rowOf = <R extends { employee: { id: string } }>(rows: R[], p: Person) => rows.find((r) => r.employee.id === p.id);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    developer = await signIn(app, await createUser(prisma, ['developer']));

    // G9 · Executive is C-level (owner, 19 October 2026), as the migration marks it
    const grade = await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true, confidential: true } });
    g9 = grade.id;
    g9WasConfidential = grade.confidential;
    await prisma.grade.update({ where: { id: g9 }, data: { confidential: true } });

    departmentId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `SI Report ${RUN}` }).expect(201)).body.id;
    teamId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Field', parentId: departmentId }).expect(201)).body.id;
    transportId = (await api().post('/api/allowance-types').set('Cookie', hr).send({ nameEn: `SI Transport ${RUN}`, nameAr: 'بدل انتقال', taxable: true }).expect(201)).body.id;

    rana = await hire('Rana Registered', {}, teamId);
    await signed(rana, { grossSalary: 20000, allowances: [{ allowanceTypeId: transportId, amount: 2000 }] });
    await tab(rana, { socialInsured: true, insuranceComprehensiveWage: 12000, insuranceNo: `1${DIGITS}`, occupationCode: '194200', insuranceStartDate: JOINED });
    await prisma.employeeIdentity.upsert({ where: { employeeId: rana.id }, create: { employeeId: rana.id, nationalId: NATIONAL_ID }, update: { nationalId: NATIONAL_ID } });
    // Form 1 generated and printed, and the print in her file
    const template = await prisma.templateVersion.create({
      data: { slotKey: 'insurance_form_1', version: 900 + Math.floor(Math.random() * 90), fileName: 'form1.pdf', mimeType: 'application/pdf', sizeBytes: 1, data: new Uint8Array([1]), language: 'ar', tags: [], unknownTags: [], broken: [] },
    });
    templateVersionId = template.id;
    await prisma.generatedDocument.create({
      data: {
        employeeId: rana.id,
        employmentId: rana.employmentId,
        slotKey: 'insurance_form_1',
        templateVersionId,
        documentDate: new Date(`${JOINED}T00:00:00Z`),
        fileName: 'form1.pdf',
        data: new Uint8Array([1]),
        sizeBytes: 1,
        hasRestricted: false,
        status: 'printed',
      },
    });
    await prisma.paperworkItem.create({ data: { employeeId: rana.id, kind: 'insurance_print', fileName: 'print.pdf', mimeType: 'application/pdf', sizeBytes: 4, data: new Uint8Array([1, 2, 3, 4]) } });

    nour = await hire('Nour Notyet', {}, departmentId);
    await signed(nour, { grossSalary: 9000 });

    sami = await hire('Sami Parttime', { employmentType: 'part_time' }, departmentId);
    await signed(sami, { grossSalary: 6000 });
    await tab(sami, { socialInsured: true });

    fady = await hire('Fady Free', { employmentType: 'freelance' }, departmentId);
    await signed(fady, { grossSalary: 5000 });
    await tab(fady, { socialInsured: true });

    joiner = await hire('Jana Joiner', { joinDate: JOINER_JOINED }, departmentId);
    await signed(joiner, { grossSalary: 5000 });
    await tab(joiner, { socialInsured: true });

    leaver = await hire('Lamis Leaver', {}, departmentId);
    await signed(leaver, { grossSalary: 8000 });
    await tab(leaver, { socialInsured: true, insuranceNo: `2${DIGITS}`, occupationCode: '194200', insuranceStartDate: JOINED });
    await api().post(`/api/employees/${leaver.id}/employments/${leaver.employmentId}/end`).set('Cookie', hr).send({ endDate: LEAVER_LEFT, endReason: 'resigned' }).expect(200);

    // HR alone can't give the C-level grade: HR with Super Admin hires Clara and signs her contract
    clara = await hire('Clara Chief', { gradeId: g9 }, departmentId, hrSuper);
    await signed(clara, { grossSalary: 30000 }, hrSuper);
    await tab(clara, { socialInsured: true }, hrSuper);
  });

  afterAll(async () => {
    await prisma.generatedDocument.deleteMany({ where: { employeeId: { in: people } } });
    if (templateVersionId) await prisma.templateVersion.deleteMany({ where: { id: templateVersionId } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    if (teamId) await prisma.department.deleteMany({ where: { id: teamId } });
    if (departmentId) await prisma.department.deleteMany({ where: { id: departmentId } });
    if (transportId) await prisma.allowanceType.deleteMany({ where: { id: transportId } });
    if (g9) await prisma.grade.update({ where: { id: g9 }, data: { confidential: g9WasConfidential } });
    await app.close();
  });

  describe('who sees it', () => {
    it('the register and the contributions: HR, Finance and the CEO; not an Admin, a Super Admin or an employee as such', async () => {
      for (const view of ['register', 'contributions']) {
        for (const session of [hr, finance, ceo]) {
          await get(view, { departmentId }, session).expect(200).expect('Cache-Control', 'private, no-store');
          await workbookFile(view, { departmentId }, session).expect(200);
        }
        for (const session of [admin, superAdmin, staff]) {
          await get(view, {}, session).expect(403);
          await workbookFile(view, {}, session).expect(403);
        }
        await api().get(`/api/payroll/social-insurance/${view}`).expect(401);
      }
    });

    it('the missing data: HR and the CEO, who see the employee file; not Finance', async () => {
      for (const session of [hr, ceo]) {
        await get('missing', { departmentId }, session).expect(200);
        await workbookFile('missing', { departmentId }, session).expect(200);
      }
      for (const session of [finance, admin, staff]) {
        await get('missing', {}, session).expect(403);
        await workbookFile('missing', {}, session).expect(403);
      }
    });

    it('refuses filters it can’t read', async () => {
      expect(messagesOf(await get('register', { status: 'retired' }).expect(400))[0]).toMatch(/^Choose a status/);
      expect(messagesOf(await get('contributions', { month: '2026-13' }).expect(400))).toEqual(['Choose the month as YYYY-MM, e.g. 2026-10.']);
      expect(messagesOf(await get('register', { departmentId: '00000000-0000-4000-8000-000000000000' }).expect(400))).toEqual(['Choose the department or team from the list.']);
      await get('missing', { view: 'missing' }).expect(400);
    });
  });

  describe('the register', () => {
    let r: SiRegisterReport;

    beforeAll(async () => {
      r = await register();
    });

    it('lists the registered people under the labour law, current ones unless asked', () => {
      expect(r.filters).toMatchObject({ status: 'current', department: { id: departmentId, nameEn: `SI Report ${RUN}` } });
      const ids = r.rows.map((x) => x.employee.id);
      expect(ids).toEqual(expect.arrayContaining([rana.id, sami.id, joiner.id]));
      // not registered, a freelancer, a leaver, and C-level for HR
      for (const p of [nour, fady, leaver, clara]) expect(ids).not.toContain(p.id);
      expect(r.notRegistered).toBe(1);
      expect(r.confidentialExcluded).toBe(1);
      expect(r.seesIdentity).toBe(true);
      expect(r.seesFile).toBe(true);
    });

    it('a row from the Social Insurance tab: the insured wage on this year’s rates, both shares, the forms and the print', () => {
      const row = rowOf(r.rows, rana)!;
      const { employeeInsuranceRate, employerInsuranceRate, year } = r.rates;
      expect(year).toBe(Number(TODAY.slice(0, 4)));
      expect(row).toMatchObject({
        employmentType: 'full_time',
        // joined six months ago: past her probation
        standing: 'active',
        department: { nameEn: 'Field', parent: { nameEn: `SI Report ${RUN}` } },
        insuranceNo: `1${DIGITS}`,
        // masked on the screen, as the profile masks it
        nationalId: '•••• 1234',
        occupationCode: '194200',
        occupationName: 'اخصائي موارد بشريه',
        insuranceStartDate: JOINED,
        insuranceBasicWage: r.insuranceBasicDefault,
        basicFrom: 'default',
        insuranceComprehensiveWage: 12000,
        comprehensiveFrom: 'own',
        insuredWage: 12000,
        employeeInsurance: piasters(12000 * employeeInsuranceRate),
        employerInsurance: piasters(12000 * employerInsuranceRate),
        form1: 'printed',
        form6: 'not_due',
        print: 'received',
        printReceivedOn: TODAY,
      });
    });

    it('a part-timer: the contract’s pay, no forms or print needed; a joiner without details', () => {
      expect(rowOf(r.rows, sami)).toMatchObject({ employmentType: 'part_time', insuranceComprehensiveWage: 6000, comprehensiveFrom: 'contract', insuredWage: 6000, form1: 'not_applicable', form6: 'not_applicable', print: 'not_needed', insuranceNo: null, nationalId: null });
      expect(rowOf(r.rows, joiner)).toMatchObject({ insuredWage: 5000, form1: 'not_generated', print: 'not_received', occupationCode: null, insuranceStartDate: null });
    });

    it('the totals over the rows', () => {
      expect(r.totals.people).toBe(r.rows.length);
      expect(r.totals.insuredWage).toBe(sum(r.rows.map((x) => x.insuredWage)));
      expect(r.totals.employeeInsurance).toBe(sum(r.rows.map((x) => x.employeeInsurance)));
      expect(r.totals.toPay).toBe(sum([r.totals.employeeInsurance, r.totals.employerInsurance]));
    });

    it('by status: the leavers on request, with Form 6 due; everyone; a team alone', async () => {
      const left = await register({ status: 'former' });
      expect(left.rows.map((x) => x.employee.id)).toEqual([leaver.id]);
      expect(rowOf(left.rows, leaver)).toMatchObject({ standing: 'former', leftOn: LEAVER_LEFT, insuredWage: 8000, form6: 'not_generated' });
      const all = await register({ status: 'all' });
      expect(all.rows.map((x) => x.employee.id)).toEqual(expect.arrayContaining([rana.id, leaver.id]));
      expect((await register({ status: 'active' })).rows.map((x) => x.employee.id)).toContain(rana.id);
      expect((await register({ status: 'on_leave' })).rows).toEqual([]);
      const team = await register({ departmentId: teamId });
      expect(team.rows.map((x) => x.employee.id)).toEqual([rana.id]);
    });

    it('Finance: no national ID, and none of the employee file', async () => {
      const f = await register({}, finance);
      expect(f).toMatchObject({ seesIdentity: false, seesFile: false });
      expect(rowOf(f.rows, rana)).toMatchObject({ nationalId: null, form1: null, form6: null, print: null, insuredWage: 12000 });
    });

    it('the CEO sees Clara', async () => {
      const c = await register({}, ceo);
      expect(rowOf(c.rows, clara)).toMatchObject({ insuredWage: Math.min(30000, c.rates.insurableWageMax) });
      expect(c.confidentialExcluded).toBe(0);
    });
  });

  describe('the monthly contributions', () => {
    let c: SiContributionsReport;

    beforeAll(async () => {
      c = await contributions({ month: MONTH });
    });

    it('everyone registered employed in the month, joiners and leavers too, the whole month’s shares', () => {
      expect(c).toMatchObject({ month: MONTH, notRegistered: 1, confidentialExcluded: 1 });
      expect(typeof c.insureEveryone).toBe('boolean');
      const ids = c.rows.map((x) => x.employee.id);
      expect(ids).toEqual(expect.arrayContaining([rana.id, sami.id, joiner.id, leaver.id]));
      for (const p of [nour, fady, clara]) expect(ids).not.toContain(p.id);
      const { employeeInsuranceRate, employerInsuranceRate } = c.rates;
      expect(rowOf(c.rows, joiner)).toMatchObject({ joinDate: JOINER_JOINED, leftOn: null, insuredWage: 5000, employeeInsurance: piasters(5000 * employeeInsuranceRate) });
      expect(rowOf(c.rows, leaver)).toMatchObject({ leftOn: LEAVER_LEFT, insuredWage: 8000, employerInsurance: piasters(8000 * employerInsuranceRate) });
      expect(rowOf(c.rows, rana)).toMatchObject({ insuredWage: 12000, insuranceNo: `1${DIGITS}` });
    });

    it('the totals to pay the insurance office, and how many joined and left', () => {
      expect(c.totals).toMatchObject({ people: c.rows.length, joined: 1, left: 1 });
      expect(c.totals.insuredWage).toBe(sum(c.rows.map((x) => x.insuredWage)));
      expect(c.totals.toPay).toBe(sum(c.rows.flatMap((x) => [x.employeeInsurance, x.employerInsurance])));
    });

    it('a month before anyone joined is empty; this month unless asked, the leaver gone', async () => {
      expect((await contributions({ month: monthsLater(JOINED.slice(0, 7), -1) })).rows).toEqual([]);
      const now = await contributions();
      expect(now.month).toBe(CURRENT);
      expect(now.rows.map((x) => x.employee.id)).not.toContain(leaver.id);
    });
  });

  describe('the missing data', () => {
    it('who misses what, in the checklist’s order; the complete and the ended left out', async () => {
      const m = await missing();
      expect(rowOf(m.rows, nour)?.missing).toEqual(['not_registered', 'insurance_no', 'occupation', 'start_date', 'form_1', 'print']);
      expect(rowOf(m.rows, sami)?.missing).toEqual(['insurance_no', 'occupation', 'start_date']);
      expect(rowOf(m.rows, joiner)?.missing).toEqual(['insurance_no', 'occupation', 'start_date', 'form_1', 'print']);
      for (const p of [rana, fady, leaver, clara]) expect(rowOf(m.rows, p)).toBeUndefined();
      // Rana, Nour, Sami and the joiner; Clara left out for HR
      expect(m.checked).toBe(4);
      expect(m.confidentialExcluded).toBe(1);
      expect(m.byItem).toMatchObject({ not_registered: 1, insurance_no: 3, form_1: 2 });
    });
  });

  describe('the workbooks', () => {
    it('the register: the national ID in full for HR, each download in the audit log', async () => {
      const since = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
      const res = await workbookFile('register', { departmentId }).expect(200);
      expect(res.headers['content-type']).toBe(XLSX);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['content-disposition']).toContain(`Social insurance register ${TODAY}.xlsx`);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as ArrayBuffer);
      expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Register', 'Summary']);
      const [heads, ...rows] = rowsOf(wb.worksheets[0]) as [string[], ...unknown[][]];
      const ranaRow = rows.find((x) => x[0] === rana.employeeCode)!;
      expect(ranaRow[heads.indexOf('National ID')]).toBe(NATIONAL_ID);
      expect(ranaRow[heads.indexOf('Insured wage')]).toBe(12000);
      expect(ranaRow[heads.indexOf('Form 1')]).toBe('Printed');
      expect(rows.map((x) => x[0])).not.toContain(clara.employeeCode);

      const audit = await prisma.auditLog.findMany({ where: { action: 'social_insurance_report_file', id: { gt: since } } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ entityType: 'social_insurance_report', diff: { view: 'register', status: 'current', nationalIds: true, department: `SI Report ${RUN}` } });
      expect((audit[0].diff as { employees: string[] }).employees).toEqual(expect.arrayContaining([rana.employeeCode, sami.employeeCode]));
      expect((audit[0].diff as { employees: string[] }).employees).not.toContain(clara.employeeCode);
    });

    it('Finance’s register has no national ID; the month’s contributions end with their total', async () => {
      const f = await workbookFile('register', { departmentId }, finance).expect(200);
      const fw = new ExcelJS.Workbook();
      await fw.xlsx.load(f.body as ArrayBuffer);
      expect(rowsOf(fw.worksheets[0])[0]).not.toContain('National ID');

      const json = await contributions({ month: MONTH });
      const res = await workbookFile('contributions', { departmentId, month: MONTH }).expect(200);
      expect(res.headers['content-disposition']).toContain(`Social insurance contributions ${MONTH}.xlsx`);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as ArrayBuffer);
      const all = rowsOf(wb.worksheets[0]);
      const heads = all[0] as string[];
      expect(all.find((x) => x[0] === joiner.employeeCode)![heads.indexOf('Joined or left')]).toBe('Joined');
      expect(all.find((x) => x[0] === leaver.employeeCode)![heads.indexOf('Joined or left')]).toBe('Left');
      const total = all.find((x) => x[0] === 'Total')!;
      expect(total[heads.indexOf('Both shares')]).toBe(json.totals.toPay);
    });

    it('the missing data: a row per person and one per item', async () => {
      const res = await workbookFile('missing', { departmentId }).expect(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as ArrayBuffer);
      expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Missing data', 'Each missing item', 'Summary']);
      const items = rowsOf(wb.worksheets[1]).filter((x) => x[0] === nour.employeeCode);
      expect(items).toHaveLength(6);
    });
  });

  describe('a developer', () => {
    it('gets the register with the money, the IDs and the social insurance details masked, and never a workbook', async () => {
      const r = (await get('register', {}, developer).expect(200)).body as SiRegisterReport;
      const row = rowOf(r.rows, rana)!;
      expect(row.employee.fullNameEn).not.toContain('Rana');
      expect(row).toMatchObject({ insuredWage: 0, employeeInsurance: 0, employerInsurance: 0, insuranceComprehensiveWage: 0, insuranceNo: '••••', nationalId: null, occupationCode: '••••', insuranceStartDate: null, joinDate: null });
      // none of the employee file's forms and print either, as the Social Insurance tab shows a developer none of it
      expect(r).toMatchObject({ seesIdentity: false, seesFile: false });
      expect(row).toMatchObject({ form1: null, form6: null, print: null });
      expect(JSON.stringify(r)).not.toContain(rana.employeeCode);
      for (const view of ['register', 'contributions', 'missing']) {
        const refused = await workbookFile(view, {}, developer).expect(403);
        expect(JSON.parse((refused.body as Buffer).toString('utf8')).message).toBe(DEVELOPER_NO_FILES);
      }
    });
  });
});
