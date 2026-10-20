import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo, weekday } from '../src/common/date-only.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { readZip } from '../src/templates/zip.js';
import { createApp, createUser, signIn } from './helpers.js';

// C-level people kept from HR (owner, 19 October 2026: "make C level Employees details not visible to HR"). Asked, the
// owner chose: everyone whose current employment's grade is G9 · Executive (a flag on the grade a Super Admin ticks);
// HR, Finance, Admin and managers see only their directory card; the CEO and the Super Admin see and manage everything;
// their payroll lines are hidden from HR, the CEO filling their inputs; HR's stages of their approvals go to the CEO; HR
// can't give or change a C-level grade. Clara is C-level (G9), Nadia isn't (G4); both have signed contracts, bank
// details and a line on last month's run. Every name, account and amount is invented.

const RUN = `cl${Date.now().toString(36).toLowerCase()}`;
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const MONTH = monthsLater(CURRENT, -1);
const NEXT_FIRST = firstDay(monthsLater(CURRENT, 1));
const NOTE = 'C-level: only the CEO and the Super Admin see the rest.';

/** The first Sunday `ahead` days or more from today. */
function sundayAhead(ahead: number): string {
  let day = addDays(TODAY, ahead);
  while (weekday(day) !== 0) day = addDays(day, 1);
  return day;
}

/** Reads a response body as bytes, whatever its type. */
const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

/** Every cell's text in a workbook, for finding an employee code in it. */
async function workbookText(data: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const out: string[] = [];
  const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v ?? ''));
  wb.eachSheet((ws) => ws.eachRow((row) => out.push(...(row.values as unknown[]).map(text))));
  return out.join(' ');
}

interface Person {
  id: string;
  employeeCode: string;
  employmentId: string;
  email: string;
}

interface Line {
  id: string;
  employeeId: string;
  employeeCode: string;
  confidential: boolean;
  editable: boolean;
  inputs: { noShowDays: number | null };
  comments: string | null;
  result: { net: number };
}

interface Run {
  id: string;
  status: string;
  lines: Line[];
  totals: { employees: number; net: number };
  hidden: { count: number; label: string } | null;
}

describe('C-level people kept from HR (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrUserId: string;
  let ceo: string;
  let finance: string;
  let admin: string;
  let superAdmin: string; // a Super Admin without HR
  let hrSuper: string; // HR and Super Admin
  let claraSession: string; // the C-level employee themself
  let emailDomainBefore: string | null;
  let clara: Person;
  let nadia: Person;
  const grades = new Map<string, string>();
  const people: string[] = [];
  const api = () => request(app.getHttpServer());
  const grade = (code: string) => grades.get(code)!;

  const get = (path: string, session: string) => api().get(`/api${path}`).set('Cookie', session);
  const post = (path: string, session: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', session).send(body);
  const patch = (path: string, session: string, body: object) => api().patch(`/api${path}`).set('Cookie', session).send(body);

  async function person(name: string, email: string, session: string, employment: object, contract: object): Promise<Person> {
    const p = (await post('/employees', hr, { fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201)).body as { id: string; employeeCode: string };
    people.push(p.id);
    const hired = await post(`/employees/${p.id}/employments`, session, { employmentType: 'full_time', joinDate: '2024-01-01', ...employment }).expect(201);
    const employmentId = hired.body.employment.id as string;
    const draft = (await post(`/employees/${p.id}/employments/${employmentId}/contracts`, session, { grossSalary: 30000, form: 'open_ended', ...contract }).expect(201)).body as {
      id: string;
      startDate: string;
    };
    await post(`/contracts/${draft.id}/sign`, session, { signedOn: draft.startDate }).expect(200);
    await patch(`/employees/${p.id}/bank`, session, { bankName: 'National Bank of Egypt', accountNo: `${Date.now()}`.padEnd(19, '7').slice(0, 19), holderName: name.toUpperCase() }).expect(200);
    return { id: p.id, employeeCode: p.employeeCode, employmentId, email };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrUserId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail }, select: { id: true } })).id;
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    const claraEmail = await createUser(prisma, ['employee']);
    claraSession = await signIn(app, claraEmail);
    await prisma.payrollRun.deleteMany();
    // sign-in accounts here are @test.local: no company email domain while these tests run
    emailDomainBefore = (await get('/company', hr).expect(200)).body.emailDomain;
    await patch('/company', hr, { emailDomain: '' }).expect(200);
    for (const g of (await get('/grades', hr).expect(200)).body as { id: string; code: string }[]) grades.set(g.code, g.id);

    nadia = await person('Nadia Normal', `nadia.${RUN}@test.local`, hr, { gradeId: grade('G4') }, {});
    // HR alone can't give the C-level grade: HR with Super Admin hires Clara
    clara = await person('Clara Chief', claraEmail, hrSuper, { gradeId: grade('G9') }, { grossSalary: 90000 });
    await patch(`/employees/${clara.id}/identity`, hrSuper, { nationalId: '28501011234567' }).expect(200);
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany();
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.payrollAdvance.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.reimbursementClaim.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.reimbursementType.deleteMany({ where: { nameEn: { endsWith: RUN } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveBalanceYear.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.raiseRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.profileChangeRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.jobOffer.deleteMany({ where: { fullNameEn: { endsWith: RUN } } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.grade.update({ where: { id: grade('G9') }, data: { confidential: true } });
    await patch('/company', hr, { emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('the grade', () => {
    it('G9 · Executive is C-level, for everyone to see', async () => {
      const g9 = ((await get('/grades', hr).expect(200)).body as { code: string; confidential: boolean }[]).find((g) => g.code === 'G9');
      expect(g9).toMatchObject({ confidential: true });
      expect((await get(`/grades/${grade('G4')}`, hr).expect(200)).body).toMatchObject({ confidential: false });
    });

    it('only a Super Admin marks a grade C-level or unmarks it; a form sending it as it is changes nothing', async () => {
      const refused = await patch(`/grades/${grade('G9')}`, hr, { confidential: false }).expect(403);
      expect(refused.body.message).toBe('Only a Super Admin marks a grade C-level, or unmarks it.');
      await patch(`/grades/${grade('G8')}`, hr, { confidential: true }).expect(403);
      await post('/grades', hr, { code: `X${RUN.slice(-4)}`.toUpperCase(), rank: 77, levelEn: 'Board', confidential: true }).expect(403);
      await patch(`/grades/${grade('G9')}`, hr, { confidential: true, description: 'e.g. CEO / Managing Director' }).expect(200);
      expect((await patch(`/grades/${grade('G8')}`, superAdmin, { confidential: true }).expect(200)).body).toMatchObject({ confidential: true });
      expect((await patch(`/grades/${grade('G8')}`, superAdmin, { confidential: false }).expect(200)).body).toMatchObject({ confidential: false });
    });

    it('HR can’t give a C-level grade, nor change a C-level person’s; HR with Super Admin can', async () => {
      const given = 'Only the CEO or a Super Admin sees C-level people, so only they give a C-level grade (or a user with HR and Super Admin).';
      expect((await patch(`/employees/${nadia.id}/employments/${nadia.employmentId}`, hr, { gradeId: grade('G9') }).expect(403)).body.message).toBe(given);
      const newcomer = (await post('/employees', hr, { fullNameEn: `Nour Newcomer ${RUN}`, fullNameAr: 'موظفة جديدة' }).expect(201)).body as { id: string };
      people.push(newcomer.id);
      await post(`/employees/${newcomer.id}/employments`, hr, { employmentType: 'full_time', joinDate: '2024-01-01', gradeId: grade('G9') }).expect(403);
      await post(`/employees/${newcomer.id}/hire`, hr, { employment: { employmentType: 'full_time', joinDate: TODAY, gradeId: grade('G9') }, contract: { grossSalary: 50000 } }).expect(403);
      // Clara's employment isn't there for HR at all
      await patch(`/employees/${clara.id}/employments/${clara.employmentId}`, hr, { gradeId: grade('G4') }).expect(404);
      // a job offer for a C-level grade neither
      const offer = { fullNameEn: `Omar Offer ${RUN}`, fullNameAr: 'عمر خالد', email: `omar.${RUN}@mail.test`, employmentType: 'full_time', joinDate: addDays(TODAY, 21), gradeId: grade('G9'), grossSalary: 80000 };
      expect((await post('/offers', hr, offer).expect(403)).body.message).toBe(given);
      const made = (await post('/offers', hrSuper, offer).expect(201)).body as { id: string };
      await get(`/offers/${made.id}`, hr).expect(404);
      expect(((await get('/offers', hr).expect(200)).body as { id: string }[]).map((o) => o.id)).not.toContain(made.id);
      expect(((await get('/offers', ceo).expect(200)).body as { id: string }[]).map((o) => o.id)).toContain(made.id);
      // HR with Super Admin changes Clara's grade and back
      await patch(`/employees/${clara.id}/employments/${clara.employmentId}`, hrSuper, { gradeId: grade('G8') }).expect(200);
      await patch(`/employees/${clara.id}/employments/${clara.employmentId}`, hrSuper, { gradeId: grade('G9') }).expect(200);
    });
  });

  describe('the directory card', () => {
    it('HR and Finance get Clara’s card in the Employees list; the CEO her full row', async () => {
      for (const session of [hr, finance]) {
        const rows = (await get('/employees', session).expect(200)).body as Record<string, unknown>[];
        const row = rows.find((r) => r.id === clara.id)!;
        expect(row).toMatchObject({ employeeCode: clara.employeeCode, fullNameEn: `Clara Chief ${RUN}`, workEmail: clara.email, standing: 'active', confidential: true, restricted: true, lastEnded: null });
        expect(Object.keys(row.employment as object).sort()).toEqual(['department', 'id', 'jobTitle', 'status']);
        expect(rows.find((r) => r.id === nadia.id)).toMatchObject({ confidential: false, restricted: false, employment: { grade: { code: 'G4' } } });
      }
      const full = ((await get('/employees', ceo).expect(200)).body as Record<string, unknown>[]).find((r) => r.id === clara.id)!;
      expect(full).toMatchObject({ confidential: true, restricted: false, employment: { grade: { code: 'G9' }, joinDate: '2024-01-01' } });
    });

    it('HR and Finance get her profile as the card and the note, nothing else', async () => {
      for (const session of [hr, finance]) {
        const card = (await get(`/employees/${clara.id}`, session).expect(200)).body as Record<string, unknown>;
        expect(card).toMatchObject({
          id: clara.id,
          employeeCode: clara.employeeCode,
          workEmail: clara.email,
          standing: 'active',
          confidential: true,
          restricted: true,
          note: NOTE,
          access: { edit: false, delete: false, identity: false, bank: false },
          isSelf: false,
        });
        for (const key of ['dateOfBirth', 'identity', 'bank', 'employments', 'mobile', 'insuranceNo', 'completeness', 'changeRequests', 'insuranceComprehensiveWage']) expect(card).not.toHaveProperty(key);
      }
    });

    it('the CEO, HR with Super Admin and Clara herself see her whole profile', async () => {
      for (const session of [ceo, hrSuper, claraSession]) {
        const profile = (await get(`/employees/${clara.id}`, session).expect(200)).body as Record<string, unknown>;
        expect(profile).toMatchObject({ confidential: true, restricted: false, employment: { grade: { code: 'G9' } } });
        expect(profile).toHaveProperty('completeness');
      }
      expect((await get(`/employees/${clara.id}/identity`, hrSuper).expect(200)).body).toMatchObject({ nationalId: '28501011234567' });
      expect((await get(`/employees/${clara.id}/identity`, ceo).expect(200)).body).toMatchObject({ nationalId: '28501011234567' });
      // and Nadia's is as before for HR
      expect((await get(`/employees/${nadia.id}`, hr).expect(200)).body).toMatchObject({ confidential: false, restricted: false });
    });

    it('HR and Finance get 404 for everything of hers beyond the card', async () => {
      const paths = [
        `/employees/${clara.id}/bank`,
        `/employees/${clara.id}/employments/${clara.employmentId}/contracts`,
        `/employees/${clara.id}/salary-history`,
        `/employees/${clara.id}/payslips`,
        `/employees/${clara.id}/raise-requests`,
        `/employees/${clara.id}/leave`,
        `/employees/${clara.id}/deduction-plans`,
      ];
      for (const session of [hr, finance]) for (const path of paths) await get(path, session).expect(404);
      for (const path of [`/employees/${clara.id}/identity`, `/employees/${clara.id}/paperwork`, `/employees/${clara.id}/documents`]) await get(path, hr).expect(404);
      await patch(`/employees/${clara.id}`, hr, { mobile: '+201011112222' }).expect(404);
      await patch(`/employees/${clara.id}/bank`, hr, { branch: 'Heliopolis' }).expect(404);
      // the CEO sees them all
      for (const path of [...paths, `/employees/${clara.id}/paperwork`, `/employees/${clara.id}/documents`]) await get(path, ceo).expect(200);
      // Clara's own leave, as for anyone
      await get(`/employees/${clara.id}/leave`, claraSession).expect(200);
    });

    it('her contracts are left out of HR’s list and alerts, and 404 when named', async () => {
      const contract = (await get(`/employees/${clara.id}/employments/${clara.employmentId}/contracts`, ceo).expect(200)).body[0] as { id: string };
      expect(((await get('/contracts', hr).expect(200)).body as { id: string }[]).map((c) => c.id)).not.toContain(contract.id);
      expect(((await get('/contracts', ceo).expect(200)).body as { id: string }[]).map((c) => c.id)).toContain(contract.id);
      await patch(`/contracts/${contract.id}`, hr, { note: 'Seen by HR' }).expect(404);
      await patch(`/contracts/${contract.id}`, hrSuper, { note: 'Kept by the Super Admin' }).expect(200);
    });

    it('her papers are left out of HR’s search, and 404 when named', async () => {
      const paper = await prisma.paperworkItem.create({
        data: { employeeId: clara.id, kind: 'qualification_certificate', fileName: 'degree.png', mimeType: 'image/png', sizeBytes: 4, data: new Uint8Array([1, 2, 3, 4]), ocrStatus: 'done', ocrText: `Bachelor of Commerce ${RUN}` },
      });
      const hits = (session: string) => get(`/paperwork/search?q=${RUN}`, session).expect(200);
      expect(((await hits(hr)).body as { employee: { id: string } }[]).map((h) => h.employee.id)).not.toContain(clara.id);
      expect(((await hits(ceo)).body as { employee: { id: string } }[]).map((h) => h.employee.id)).toContain(clara.id);
      await get(`/paperwork/${paper.id}/file`, hr).expect(404);
      await get(`/paperwork/${paper.id}/file`, ceo).expect(200);
    });

    it('the Missing Details report leaves her out for HR, and says so', async () => {
      const report = (await get('/employees/missing', hr).expect(200)).body as { rows: { id: string }[]; confidentialExcluded: number };
      expect(report.rows.map((r) => r.id)).not.toContain(clara.id);
      expect(report.confidentialExcluded).toBeGreaterThanOrEqual(1);
      const full = (await get('/employees/missing', ceo).expect(200)).body as { rows: { id: string }[]; confidentialExcluded: number };
      expect(full.rows.map((r) => r.id)).toContain(clara.id);
      expect(full.confidentialExcluded).toBe(0);
    });
  });

  describe('payroll', () => {
    let run: Run;
    const lineOf = (r: Run, p: Person) => r.lines.find((l) => l.employeeId === p.id);
    const runAs = async (session: string) => (await get(`/payroll/runs/${run.id}`, session).expect(200)).body as Run;

    beforeAll(async () => {
      run = (await post('/payroll/runs', hr, { month: MONTH }).expect(201)).body as Run;
    });

    it('HR sees one hidden row for the C-level lines, the totals without them; the CEO the whole run', async () => {
      expect(lineOf(run, clara)).toBeUndefined();
      expect(lineOf(run, nadia)).toMatchObject({ confidential: false, editable: true });
      const full = await runAs(ceo);
      const confidentialLines = full.lines.filter((l) => l.confidential);
      expect(lineOf(full, clara)).toMatchObject({ confidential: true, editable: true });
      expect(lineOf(full, nadia)).toMatchObject({ editable: false });
      expect(full.hidden).toBeNull();
      expect(run.hidden).toEqual({ count: confidentialLines.length, label: `C-level (${confidentialLines.length} ${confidentialLines.length === 1 ? 'person' : 'people'}) — hidden` });
      expect(run.totals.employees).toBe(full.totals.employees - confidentialLines.length);
      expect(run.totals.net).toBeCloseTo(full.totals.net - confidentialLines.reduce((n, l) => n + l.result.net, 0), 2);
      // Finance as HR; HR with Super Admin as the CEO
      expect(lineOf(await runAs(finance), clara)).toBeUndefined();
      expect(lineOf(await runAs(hrSuper), clara)).toMatchObject({ confidential: true, editable: true });
      const listed = ((await get('/payroll/runs', hr).expect(200)).body as { id: string; hidden: number; totals: { employees: number } }[]).find((r) => r.id === run.id)!;
      expect(listed).toMatchObject({ hidden: confidentialLines.length, totals: { employees: run.totals.employees } });
    });

    it('the CEO fills the C-level lines’ inputs, HR the others’; neither the other’s', async () => {
      const full = await runAs(ceo);
      const claraLine = lineOf(full, clara)!;
      const nadiaLine = lineOf(full, nadia)!;
      await patch(`/payroll/runs/${run.id}/lines`, hr, { lines: [{ id: claraLine.id, inputs: { noShowDays: 1 } }] }).expect(400);
      const ceoOnNadia = await patch(`/payroll/runs/${run.id}/lines`, ceo, { lines: [{ id: nadiaLine.id, comments: 'From the CEO' }] }).expect(403);
      expect(ceoOnNadia.body.message).toBe(`HR fills Nadia Normal ${RUN}'s line: the CEO fills only the C-level people's.`);
      const filled = (await patch(`/payroll/runs/${run.id}/lines`, ceo, { lines: [{ id: claraLine.id, inputs: { noShowDays: 1 }, comments: 'Filled by the CEO' }] }).expect(200)).body as Run;
      expect(lineOf(filled, clara)).toMatchObject({ inputs: { noShowDays: 1 }, comments: 'Filled by the CEO' });
      await patch(`/payroll/runs/${run.id}/lines`, hr, { lines: [{ id: nadiaLine.id, comments: 'From HR' }] }).expect(200);
    });

    it('the files and payslips leave the C-level people out for HR and Finance, complete for the CEO', async () => {
      await post(`/payroll/runs/${run.id}/submit`, hr).expect(200);
      await post(`/payroll/runs/${run.id}/approve`, ceo).expect(200);
      const register = async (session: string) => workbookText((await get(`/payroll/runs/${run.id}/files/register`, session).buffer(true).parse(bytes).expect(200)).body as Buffer);
      expect(await register(hr)).not.toContain(clara.employeeCode);
      expect(await register(hr)).toContain(nadia.employeeCode);
      expect(await register(ceo)).toContain(clara.employeeCode);
      await get(`/payroll/runs/${run.id}/files/ach`, hr).buffer(true).parse(bytes).expect(200);
      const ach = await prisma.auditLog.findFirstOrThrow({ where: { userId: hrUserId, action: 'payroll_bank_file', entityId: run.id }, orderBy: { at: 'desc' } });
      expect((ach.diff as { employees: string[] }).employees).not.toContain(clara.employeeCode);
      expect((ach.diff as { employees: string[] }).employees).toContain(nadia.employeeCode);

      await post(`/payroll/runs/${run.id}/paid`, hr, { paidOn: TODAY }).expect(200);
      const zipNames = async (session: string) =>
        readZip((await get(`/payroll/runs/${run.id}/payslips`, session).buffer(true).parse(bytes).expect(200)).body as Buffer).entries.map((f) => f.name);
      expect((await zipNames(hr)).some((n) => n.includes(clara.employeeCode))).toBe(false);
      expect((await zipNames(finance)).some((n) => n.includes(nadia.employeeCode))).toBe(true);
      expect((await zipNames(ceo)).some((n) => n.includes(clara.employeeCode))).toBe(true);
      const claraLine = lineOf(await runAs(ceo), clara)!;
      for (const session of [hr, finance]) await get(`/payroll/lines/${claraLine.id}/payslip/en`, session).expect(404);
      await get(`/payroll/lines/${claraLine.id}/payslip/en`, ceo).buffer(true).parse(bytes).expect(200);
      // Clara's own, from her own payslips (owner, 20 October 2026, the employee app): never hidden from her
      expect(((await get('/me/payslips', claraSession).expect(200)).body as { lineId: string }[]).map((p) => p.lineId)).toEqual([claraLine.id]);
      const own = await get(`/me/payslips/${claraLine.id}/en`, claraSession).buffer(true).parse(bytes).expect(200);
      expect(own.headers['content-type']).toBe('application/pdf');
      await get(`/me/payslips/${lineOf(await runAs(ceo), nadia)!.id}/en`, claraSession).expect(404);
    });

    it('the statistics and the salary raises report leave her out for HR, and say so', async () => {
      const stats = (await get(`/payroll/statistics?from=${MONTH}&to=${MONTH}`, hr).expect(200)).body as { confidentialExcluded: number };
      expect(stats.confidentialExcluded).toBeGreaterThanOrEqual(1);
      expect(((await get(`/payroll/statistics?from=${MONTH}&to=${MONTH}`, ceo).expect(200)).body as { confidentialExcluded: number }).confidentialExcluded).toBe(0);
      const raises = (await get('/reports/salary-raises', hr).expect(200)).body as { confidentialExcluded: number; dueForReview: { employee: { id: string } }[] };
      expect(raises.confidentialExcluded).toBeGreaterThanOrEqual(1);
      expect(raises.dueForReview.map((d) => d.employee.id)).not.toContain(clara.id);
      expect(((await get('/reports/salary-raises', finance).expect(200)).body as { confidentialExcluded: number }).confidentialExcluded).toBeGreaterThanOrEqual(1);
    });

    it('her advances and additions are HR’s to neither see nor make; HR with Super Admin records them', async () => {
      const body = { employeeId: clara.id, kind: 'advance', amount: 5000, givenOn: firstDay(CURRENT), reason: `Invented advance ${RUN}` };
      await post('/payroll/advances', hr, body).expect(404);
      await get(`/payroll/advances/limit?employeeId=${clara.id}`, hr).expect(404);
      const advance = (await post('/payroll/advances', hrSuper, body).expect(201)).body as { id: string };
      await get(`/payroll/advances/${advance.id}`, hr).expect(404);
      await get(`/payroll/advances/${advance.id}`, finance).expect(404);
      await get(`/payroll/advances/${advance.id}`, ceo).expect(200);
      expect(((await get('/payroll/advances', hr).expect(200)).body as { id: string }[]).map((a) => a.id)).not.toContain(advance.id);
      expect(((await get('/payroll/advances', ceo).expect(200)).body as { id: string }[]).map((a) => a.id)).toContain(advance.id);
      await post('/payroll/adjustments', hr, { employeeId: clara.id, month: CURRENT, kind: 'addition', type: 'bonus', amount: 1000, reason: 'Invented bonus' }).expect(404);
      const unsettled = (await get('/payroll/unsettled', hr).expect(200)).body as { advances: { rows: { id: string }[] }; confidentialExcluded: number };
      expect(unsettled.advances.rows.map((a) => a.id)).not.toContain(advance.id);
      expect(unsettled.confidentialExcluded).toBeGreaterThanOrEqual(1);
    });
  });

  describe('approvals: HR’s stages of hers go to the CEO', () => {
    it('her raise request: HR neither sees nor decides it; the CEO takes HR’s step', async () => {
      const asked = (await post(`/employees/${clara.id}/raise-requests`, claraSession, { effectiveFrom: NEXT_FIRST, raiseReason: 'performance', comment: 'A strong year', suggestedIncrease: 5000 }).expect(201)).body as {
        id: string;
        status: string;
        confidential: boolean;
      };
      expect(asked).toMatchObject({ status: 'with_hr', confidential: true });
      expect(((await get('/raise-requests', hr).expect(200)).body as { id: string }[]).map((r) => r.id)).not.toContain(asked.id);
      expect(((await get('/raise-requests', finance).expect(200)).body as { id: string }[]).map((r) => r.id)).not.toContain(asked.id);
      expect(((await get('/raise-requests', ceo).expect(200)).body as { id: string; confidential: boolean }[]).find((r) => r.id === asked.id)).toMatchObject({ confidential: true });
      await post(`/raise-requests/${asked.id}/decline`, hr, { comment: 'Not now' }).expect(404);
      await post(`/raise-requests/${asked.id}/approve`, hr, { decision: 'approve', comment: 'Yes', way: 'amendment' }).expect(404);
      const declined = (await post(`/raise-requests/${asked.id}/decline`, ceo, { comment: 'Next year' }).expect(200)).body as { status: string; decision: { stage: string } };
      expect(declined).toMatchObject({ status: 'declined', decision: { stage: 'hr' } });
      // the CEO doesn't take HR's step on anyone else's
      const nadiaAsked = (await post(`/employees/${nadia.id}/raise-requests`, hr, { effectiveFrom: NEXT_FIRST, raiseReason: 'annual', comment: 'Yearly', suggestedIncrease: 500 }).expect(201)).body as { id: string };
      expect((await post(`/raise-requests/${nadiaAsked.id}/decline`, ceo, { comment: 'No' }).expect(403)).body.message).toBe(
        "HR decides this raise request: the CEO takes HR's step only on a C-level person's.",
      );
    });

    it('her reimbursement claim: HR and Finance neither see nor count it; the CEO decides both their stages', async () => {
      const type = (await post('/reimbursement-types', hr, { nameEn: `Travel ${RUN}`, nameAr: 'انتقالات', receiptRequired: false }).expect(201)).body as { id: string };
      const claim = (
        await api()
          .post('/api/me/reimbursements')
          .set('Cookie', claraSession)
          .field('typeId', type.id)
          .field('expenseDate', TODAY)
          .field('amount', '750')
          .field('description', 'Airport taxi')
          .expect(201)
      ).body as { id: string; status: string; confidential: boolean };
      expect(claim).toMatchObject({ status: 'with_hr', confidential: true });
      for (const session of [hr, finance]) {
        expect(((await get('/reimbursements', session).expect(200)).body as { id: string }[]).map((c) => c.id)).not.toContain(claim.id);
        await get(`/reimbursements/${claim.id}`, session).expect(404);
        await post(`/reimbursements/${claim.id}/decide`, session, { decision: 'approve' }).expect(404);
      }
      expect(((await get('/reimbursements/counts', ceo).expect(200)).body as { waiting: number }).waiting).toBeGreaterThanOrEqual(1);
      expect((await post(`/reimbursements/${claim.id}/decide`, ceo, { decision: 'approve' }).expect(200)).body).toMatchObject({ status: 'with_finance', confidential: true });
      const approved = (await post(`/reimbursements/${claim.id}/decide`, ceo, { decision: 'approve' }).expect(200)).body as { status: string; payMonth: string };
      expect(approved.status).toBe('approved');
      // its addition is the CEO's to see, not HR's
      const additions = async (session: string) => ((await get(`/payroll/adjustments?employeeId=${clara.id}`, session).expect(200)).body as { type: string }[]).map((a) => a.type);
      expect(await additions(hr)).toEqual([]);
      expect(await additions(ceo)).toContain('reimbursement');
    });

    it('her leave: HR neither sees nor decides it; the CEO decides HR’s stage', async () => {
      const types = Object.fromEntries(((await get('/leave/types', hr).expect(200)).body as { id: string; key: string }[]).map((t) => [t.key, t.id]));
      const start = sundayAhead(21);
      const asked = (
        await api().post('/api/me/leave/requests').set('Cookie', claraSession).field('typeId', types.annual).field('startDate', start).field('endDate', start).field('halfDay', 'false').expect(201)
      ).body as { id: string; status: string; confidential: boolean };
      expect(asked).toMatchObject({ status: 'with_hr', confidential: true });
      expect(((await get('/leave/requests', hr).expect(200)).body as { id: string }[]).map((r) => r.id)).not.toContain(asked.id);
      await get(`/leave/requests/${asked.id}`, hr).expect(404);
      await post(`/leave/requests/${asked.id}/decide`, hr, { decision: 'approve' }).expect(404);
      expect(((await get(`/leave/calendar?from=${start}&to=${start}`, hr).expect(200)).body as { id: string }[]).map((r) => r.id)).not.toContain(asked.id);
      expect(((await get('/leave/requests/counts', ceo).expect(200)).body as { waiting: number }).waiting).toBeGreaterThanOrEqual(1);
      expect((await post(`/leave/requests/${asked.id}/decide`, ceo, { decision: 'approve' }).expect(200)).body).toMatchObject({ status: 'approved', confidential: true });
      // the year's closing view leaves her out for HR, and says so
      const closing = (await get(`/leave/year-closing/${TODAY.slice(0, 4)}`, hr).expect(200)).body as { rows: { employee: { id: string } }[]; confidentialExcluded: number };
      expect(closing.rows.map((r) => r.employee.id)).not.toContain(clara.id);
      expect(closing.confidentialExcluded).toBeGreaterThanOrEqual(1);
      const full = (await get(`/leave/year-closing/${TODAY.slice(0, 4)}`, ceo).expect(200)).body as { rows: { employee: { id: string } }[] };
      expect(full.rows.map((r) => r.employee.id)).toContain(clara.id);
    });

    it('her change of details: HR and Admin neither see nor decide it; the CEO does', async () => {
      const asked = (await post(`/employees/${clara.id}/change-requests`, claraSession, { changes: { mobile: '+201098765432' } }).expect(201)).body as { id: string; confidential: boolean };
      expect(asked.confidential).toBe(true);
      for (const session of [hr, admin]) {
        expect(((await get('/change-requests', session).expect(200)).body as { id: string }[]).map((r) => r.id)).not.toContain(asked.id);
        await post(`/change-requests/${asked.id}/approve`, session, {}).expect(404);
      }
      const queue = (await get('/change-requests', ceo).expect(200)).body as { id: string; confidential: boolean }[];
      expect(queue.find((r) => r.id === asked.id)).toMatchObject({ confidential: true });
      // the CEO's queue is the C-level people's only
      expect(queue.every((r) => r.confidential)).toBe(true);
      expect((await post(`/change-requests/${asked.id}/approve`, ceo, {}).expect(200)).body).toMatchObject({ status: 'approved' });
      expect((await get(`/employees/${clara.id}`, ceo).expect(200)).body).toMatchObject({ mobile: '+201098765432' });
    });
  });

  describe('a manager of a C-level person', () => {
    it('gets their card, not their leave balances; decides the manager stage of their leave, the CEO HR’s', async () => {
      const markEmail = await createUser(prisma, ['manager']);
      const mark = await signIn(app, markEmail);
      const carlEmail = await createUser(prisma, ['employee']);
      const carl = await signIn(app, carlEmail);
      const markId = (await post('/employees', hr, { fullNameEn: `Mark Manager ${RUN}`, fullNameAr: 'مدير تجريبي', workEmail: markEmail }).expect(201)).body.id as string;
      people.push(markId);
      await post(`/employees/${markId}/employments`, hr, { employmentType: 'full_time', joinDate: '2024-01-01', gradeId: grade('G6') }).expect(201);
      const carlId = (await post('/employees', hr, { fullNameEn: `Carl Chief ${RUN}`, fullNameAr: 'رئيس تجريبي', workEmail: carlEmail }).expect(201)).body.id as string;
      people.push(carlId);
      await post(`/employees/${carlId}/employments`, hrSuper, { employmentType: 'full_time', joinDate: '2024-01-01', gradeId: grade('G9'), managerId: markId }).expect(201);

      expect((await get(`/employees/${carlId}`, mark).expect(200)).body).toMatchObject({ restricted: true, note: NOTE });
      expect(((await get('/employees', mark).expect(200)).body as { id: string; restricted: boolean }[]).find((r) => r.id === carlId)).toMatchObject({ restricted: true });
      await get(`/employees/${carlId}/leave`, mark).expect(404);

      const types = Object.fromEntries(((await get('/leave/types', hr).expect(200)).body as { id: string; key: string }[]).map((t) => [t.key, t.id]));
      const start = sundayAhead(35);
      const asked = (
        await api().post('/api/me/leave/requests').set('Cookie', carl).field('typeId', types.annual).field('startDate', start).field('endDate', start).field('halfDay', 'false').expect(201)
      ).body as { id: string; status: string };
      expect(asked.status).toBe('with_manager');
      // sent to Mark to decide: he sees it, without Carl's balance
      expect((await get(`/leave/requests/${asked.id}`, mark).expect(200)).body).toMatchObject({ waitingForYou: true, confidential: true, balanceAfter: null });
      expect((await post(`/leave/requests/${asked.id}/decide`, mark, { decision: 'approve' }).expect(200)).body).toMatchObject({ status: 'with_hr' });
      await post(`/leave/requests/${asked.id}/decide`, hr, { decision: 'approve' }).expect(404);
      expect((await post(`/leave/requests/${asked.id}/decide`, ceo, { decision: 'approve' }).expect(200)).body).toMatchObject({ status: 'approved' });
    });
  });

  describe('a grade change changes it', () => {
    it('unmarking G9 shows Clara to HR again; marking it hides her once more', async () => {
      await patch(`/grades/${grade('G9')}`, superAdmin, { confidential: false }).expect(200);
      expect((await get(`/employees/${clara.id}`, hr).expect(200)).body).toMatchObject({ confidential: false, restricted: false });
      await get(`/employees/${clara.id}/salary-history`, hr).expect(200);
      await patch(`/grades/${grade('G9')}`, superAdmin, { confidential: true }).expect(200);
      expect((await get(`/employees/${clara.id}`, hr).expect(200)).body).toMatchObject({ restricted: true, note: NOTE });
      await get(`/employees/${clara.id}/salary-history`, hr).expect(404);
    });
  });
});
