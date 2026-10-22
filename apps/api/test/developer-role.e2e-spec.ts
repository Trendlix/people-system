import type { INestApplication } from '@nestjs/common';
import { DEVELOPER_NO_FILES, DEVELOPER_READ_ONLY, HIDDEN } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, PASSWORD, signIn } from './helpers.js';

// The Developer role (owner, 22 October 2026: "i want to create a role for develoeprs, not showing the real numbers";
// "act as super admin with numbers hidden and real sensitve numbers as national ids hidden changing nothing, and no act
// as"; hidden: "Money and personal IDs"). A Super Admin gives it (with nothing but Employee beside it); the developer
// opens what a Super Admin opens, but every amount comes 0 and every personal ID "••••", across an employee's profile,
// identity and bank, a payroll run, a loan, a claim, an offer, a vacancy and an asset; every change is refused, and every
// file with pay or IDs; never views as anyone; never told of what waits for HR or the CEO; what they open is logged with
// the values hidden. Distinctive amounts, so every answer can be searched for them. Every name is invented; the test
// deletes what it made.

const RUN = `dv${Date.now().toString(36)}`;
const CURRENT = todayInCairo().slice(0, 7);
const MONTH = monthsLater(CURRENT, -1);
const JOINED = firstDay(monthsLater(CURRENT, -3));
const NATIONAL_ID = `2950312${String(Date.now() % 10_000_000).padStart(7, '0')}`;
const ACCOUNT = '100099887766';
const MOBILE = '+201098765432';
const GROSS = 123457;
const OFFER_GROSS = 234567;
const SALARY_MIN = 345679;
const PURCHASE = 456781;
const LOAN = 56789;
const CLAIM = 6789.5;
const AMOUNTS = [GROSS, OFFER_GROSS, SALARY_MIN, PURCHASE, LOAN, CLAIM];

/** The answer as text, and whether any of the real numbers is in it, however written. */
function leaks(body: unknown): string[] {
  const text = JSON.stringify(body);
  const found: string[] = [];
  for (const n of AMOUNTS) for (const shown of [String(n), n.toLocaleString('en-US')]) if (text.includes(shown)) found.push(shown);
  for (const id of [NATIONAL_ID, ACCOUNT, MOBILE, MOBILE.slice(1)]) if (text.includes(id)) found.push(id);
  return found;
}

describe('The Developer role (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const as = (key: string) => ({
    get: (path: string) => api().get(`/api${path}`).set('Cookie', sessions[key]),
    post: (path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[key]).send(body),
    patch: (path: string, body: object) => api().patch(`/api${path}`).set('Cookie', sessions[key]).send(body),
    put: (path: string, body: object) => api().put(`/api${path}`).set('Cookie', sessions[key]).send(body),
    del: (path: string) => api().delete(`/api${path}`).set('Cookie', sessions[key]),
  });

  async function account(key: string, roles: Parameters<typeof createUser>[1]) {
    const email = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    sessions[key] = await signIn(app, email);
    return email;
  }

  let employeeId: string;
  let employmentId: string;
  let runId: string;
  let loanId: string;
  let claimId: string;
  let claimTypeId: string;
  let offerId: string;
  let vacancyId: string;
  let assetCode: string;
  let departmentId: string;
  let jobTitleId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('superAdmin', ['super_admin']);
    await account('admin', ['admin']);
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    // the developer: an account given the role by the Super Admin below, signed in again once it holds it
    const devEmail = await account('developer', ['employee']);
    await prisma.payrollRun.deleteMany({ where: { month: new Date(`${MONTH}-01`) } });

    departmentId = (await as('hr').post('/departments', { nameEn: `Developer test ${RUN}` }).expect(201)).body.id;
    jobTitleId = (await prisma.jobTitle.create({ data: { departmentId, titleEn: `Editor ${RUN}` }, select: { id: true } })).id;
    const shiftId = (await prisma.shift.findFirstOrThrow({ where: { code: 'A' }, select: { id: true } })).id;
    const gradeId = (await prisma.grade.findFirstOrThrow({ where: { code: 'G3' }, select: { id: true } })).id;

    // a person with their national ID, bank details, mobile and a signed contract
    const person = (await as('hr').post('/employees', { fullNameEn: `Omar Masked ${RUN}`, fullNameAr: 'عمر خالد محمود', mobile: MOBILE }).expect(201)).body;
    employeeId = person.id;
    employmentId = (await as('hr').post(`/employees/${employeeId}/employments`, { employmentType: 'full_time', joinDate: JOINED, departmentId, shiftId, jobTitleId }).expect(201)).body.employment.id;
    await as('hr').patch(`/employees/${employeeId}/identity`, { nationalId: NATIONAL_ID, printedNo: 'KX7654321' }).expect(200);
    await as('hr').patch(`/employees/${employeeId}/bank`, { bankName: 'CIB', accountNo: ACCOUNT }).expect(200);
    const draft = (await as('hr').post(`/employees/${employeeId}/employments/${employmentId}/contracts`, { grossSalary: GROSS }).expect(201)).body as { id: string; startDate: string };
    await as('hr').post(`/contracts/${draft.id}/sign`, { signedOn: draft.startDate }).expect(200);

    // last month's payroll, a loan, a claim, an offer, a vacancy and an asset with its cost
    runId = (await as('hr').post('/payroll/runs', { month: MONTH }).expect(201)).body.id;
    loanId = (await as('hr').post('/payroll/advances', { employeeId, kind: 'loan', amount: LOAN, givenOn: `${MONTH}-15`, reason: `Invented loan ${RUN}`, plan: 'Monthly' }).expect(201)).body.id;
    claimTypeId = (await prisma.reimbursementType.create({ data: { nameEn: `Taxi ${RUN}`, nameAr: 'تاكسي' }, select: { id: true } })).id;
    claimId = (
      await prisma.reimbursementClaim.create({
        data: { employeeId, employmentId, typeId: claimTypeId, expenseDate: new Date(`${MONTH}-10`), amount: CLAIM, description: `Invented taxi ${RUN}`, status: 'with_hr' },
        select: { id: true },
      })
    ).id;
    offerId = (
      await as('hr')
        .post('/offers', { fullNameEn: `Offer Person ${RUN}`, fullNameAr: 'مرشح', email: `offer.${RUN}@mail.test`, employmentType: 'full_time', joinDate: `${CURRENT}-28`, jobTitleId, gradeId, shiftId, grossSalary: OFFER_GROSS })
        .expect(201)
    ).body.id;
    vacancyId = (
      await as('hr').post('/recruitment/vacancies', { jobTitleId, employmentType: 'full_time', headcount: 1, salaryMin: SALARY_MIN, salaryMax: SALARY_MIN + 1000, about: '<p>Edits our videos.</p>' }).expect(201)
    ).body.id;
    // sent for approval: the CEO is told, never the developer
    await as('hr').post(`/recruitment/vacancies/${vacancyId}/submit`).expect(200);
    assetCode = (await as('superAdmin').post('/assets', { name: `Camera ${RUN}`, group: 'kit', type: 'CAM', condition: 'good', values: { purchasePrice: PURCHASE } }).expect(201)).body.code;

    // the role, given by the Super Admin; a new sign-in after it
    await as('superAdmin').patch(`/users/${users.developer}`, { roles: ['employee', 'developer'] }).expect(200);
    sessions.developer = await signIn(app, devEmail);
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: runId } });
    await prisma.payrollAdvance.deleteMany({ where: { employeeId } });
    await prisma.reimbursementClaim.deleteMany({ where: { id: claimId } });
    await prisma.reimbursementType.deleteMany({ where: { id: claimTypeId } });
    await prisma.jobOffer.deleteMany({ where: { id: offerId } });
    await prisma.vacancy.deleteMany({ where: { id: vacancyId } });
    await prisma.asset.deleteMany({ where: { code: assetCode } });
    if (!(await prisma.asset.count({ where: { code: { startsWith: 'PK-CAM-' } } }))) await prisma.assetCodeCounter.deleteMany({ where: { prefix: 'PK-CAM-' } });
    await prisma.contract.deleteMany({ where: { employmentId } });
    await prisma.employee.deleteMany({ where: { id: employeeId } });
    await prisma.jobTitle.deleteMany({ where: { id: jobTitleId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await app.close();
  });

  it('the role: given by a Super Admin only, with nothing but Employee beside it', async () => {
    const other = await createUser(prisma, ['employee']);
    const otherId = (await prisma.user.findUniqueOrThrow({ where: { email: other } })).id;
    expect((await as('admin').patch(`/users/${otherId}`, { roles: ['employee', 'developer'] }).expect(403)).body.message).toBe('Only a Super Admin can give or take away the Developer role.');
    expect((await as('superAdmin').patch(`/users/${otherId}`, { roles: ['hr', 'developer'] }).expect(400)).body.message).toEqual([
      'A developer holds no other role but Employee: they look at everything and change nothing.',
    ]);
    // the developer's own account says what they are: a Super Admin's sight, no asset values
    const me = (await as('developer').get('/auth/me').expect(200)).body;
    expect(me).toMatchObject({ developer: true, assets: { access: 'manager', values: false } });
    expect(me.roles).toEqual(expect.arrayContaining(['super_admin', 'hr', 'ceo', 'finance']));
    // the Users page lists their roles as kept
    expect((await as('superAdmin').get(`/users/${users.developer}`).expect(200)).body.roles).toEqual(['employee', 'developer']);
  });

  it('an employee’s profile, national ID and bank: names as they are, the numbers hidden', async () => {
    const profile = (await as('developer').get(`/employees/${employeeId}`).expect(200)).body;
    expect(profile.fullNameEn).toBe(`Omar Masked ${RUN}`);
    expect(leaks(profile)).toEqual([]);
    const identity = (await as('developer').get(`/employees/${employeeId}/identity`).expect(200)).body;
    expect(identity).toMatchObject({ nationalId: HIDDEN, printedNo: HIDDEN });
    const bank = (await as('developer').get(`/employees/${employeeId}/bank`).expect(200)).body;
    expect(bank).toMatchObject({ accountNo: HIDDEN });
    expect(bank.bankName).toMatch(/Commercial International Bank|CIB/);
    expect(leaks([identity, bank])).toEqual([]);
    // HR still sees them
    expect((await as('hr').get(`/employees/${employeeId}/identity`).expect(200)).body.nationalId).toBe(NATIONAL_ID);
  });

  it('a payroll run and its lines: every amount 0, the days and hours as they are', async () => {
    const run = (await as('developer').get(`/payroll/runs/${runId}`).expect(200)).body;
    const line = run.lines.find((l: { employeeId: string }) => l.employeeId === employeeId);
    expect(line).toBeDefined();
    expect(line.terms.gross).toBe(0);
    expect(line.result.net).toBe(0);
    expect(line.terms.paidDays).toBeGreaterThan(0);
    expect(run.totals.net).toBe(0);
    expect(leaks(run)).toEqual([]);
    expect(leaks((await as('developer').get('/payroll/runs').expect(200)).body)).toEqual([]);
    // HR sees the real gross
    expect((await as('hr').get(`/payroll/runs/${runId}`).expect(200)).body.lines.find((l: { employeeId: string }) => l.employeeId === employeeId).terms.gross).toBe(GROSS);
  });

  it('a loan, a claim, an offer, a vacancy and an asset: no amount anywhere', async () => {
    const loan = (await as('developer').get(`/payroll/advances/${loanId}`).expect(200)).body;
    expect(loan.amount).toBe(0);
    const claim = (await as('developer').get(`/reimbursements/${claimId}`).expect(200)).body;
    expect(claim.amount).toBe(0);
    const offer = (await as('developer').get(`/offers/${offerId}`).expect(200)).body;
    const vacancy = (await as('developer').get(`/recruitment/vacancies/${vacancyId}`).expect(200)).body;
    expect(vacancy.salaryMin).toBe(0);
    const asset = (await as('developer').get(`/assets/${assetCode}`).expect(200)).body;
    expect(leaks([loan, claim, offer, vacancy, asset])).toEqual([]);
    // the lists too
    for (const path of ['/payroll/advances', '/reimbursements', '/offers', '/recruitment/vacancies', '/assets', `/employees/${employeeId}/deduction-plans`]) {
      const res = await as('developer').get(path);
      expect([200, 403], path).toContain(res.status);
      expect(leaks(res.body), path).toEqual([]);
    }
  });

  it('every other page with pay on it: none of the amounts or IDs in any answer', async () => {
    const paths = [
      '/employees',
      `/employees/${employeeId}/employments/${employmentId}/contracts`,
      '/contracts',
      '/contracts/expiring',
      '/contracts/law-warnings',
      '/endings',
      '/raises/pending',
      `/employees/${employeeId}/salary-history`,
      `/employees/${employeeId}/raise-requests`,
      '/raise-requests',
      '/reports/salary-raises',
      '/payroll/adjustments',
      '/payroll/adjustments/choices',
      `/payroll/advances/limit?employeeId=${employeeId}`,
      '/payroll/recurring-deductions',
      `/payroll/statistics?year=${MONTH.slice(0, 4)}`,
      '/payroll/unsettled',
      `/payroll/final-settlements/${employmentId}`,
      `/employees/${employeeId}/payslips`,
      '/me/payslips',
      '/payroll/settings',
      '/kpis/overview',
      '/offboarding/turnover',
      `/offboarding/employees/${employeeId}`,
    ];
    const answered: string[] = [];
    for (const path of paths) {
      const res = await as('developer').get(path);
      expect([200, 400, 403, 404], `${path}: ${res.status}`).toContain(res.status);
      if (res.status === 200) answered.push(path);
      expect(leaks(res.body), path).toEqual([]);
    }
    // most of them open for a developer, as for the owner
    expect(answered.length).toBeGreaterThan(paths.length / 2);
    // the same pages carry them for HR: hidden for the developer, not missing
    for (const path of ['/contracts', `/employees/${employeeId}/salary-history`, `/employees/${employeeId}/employments/${employmentId}/contracts`]) {
      expect(leaks((await as('hr').get(path).expect(200)).body), path).toContain(String(GROSS));
    }
  });

  it('the audit log: the money and IDs changed shown hidden', async () => {
    const log = (await as('developer').get(`/audit?entityType=employee&entityId=${employeeId}`).expect(200)).body;
    expect(leaks(log)).toEqual([]);
    const all = (await as('developer').get('/audit').expect(200)).body;
    expect(leaks(all)).toEqual([]);
  });

  it('changes nothing: every kind of write refused, but signing out, ending a session and the own password', async () => {
    for (const res of [
      await as('developer').post('/employees', { fullNameEn: `Nope ${RUN}`, fullNameAr: 'لا' }),
      await as('developer').patch(`/employees/${employeeId}`, { notes: 'x' }),
      await as('developer').put('/kpis/framework', { appliesFrom: CURRENT, attendancePillar: 'x', pillars: [] }),
      await as('developer').del(`/assets/${assetCode}`),
      await as('developer').post(`/payroll/runs/${runId}/submit`),
      await as('developer').post('/auth/view-as', { userId: users.hr }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(DEVELOPER_READ_ONLY);
    }
    // their own password: asked, and checked (a wrong one is a 400, not a refusal)
    expect((await as('developer').post('/auth/change-password', { currentPassword: 'wrong-password-1', newPassword: `${PASSWORD}-new` })).status).toBe(400);
  });

  it('files with pay or IDs refused before they are made; a picture without them given', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    for (const path of [
      `/payroll/runs/${runId}/files/register`,
      `/payroll/runs/${runId}/files/cib`,
      `/payroll/lines/${unknown}/payslip/en`,
      `/payroll/runs/${runId}/payslips`,
      `/documents/${unknown}/file`,
      `/paperwork/${unknown}/file`,
      '/payroll/statistics/workbook',
      '/audit/export',
      `/recruitment/applications/${unknown}/cv`,
    ]) {
      const res = await as('developer').get(path);
      expect(res.status, path).toBe(403);
      expect(res.body.message, path).toBe(DEVELOPER_NO_FILES);
    }
    // the company's logo is no secret: answered as for anyone (none set: 404)
    expect([200, 404]).toContain((await as('developer').get('/company/logo')).status);
  });

  it('never told of what waits for HR or the CEO; what they opened is logged with the values hidden', async () => {
    expect(await prisma.notification.count({ where: { userId: users.developer } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: users.ceo, kind: 'vacancy_waiting' } })).toBeGreaterThan(0);
    const seen = await prisma.auditLog.findMany({ where: { userId: users.developer, entityType: 'employee', entityId: employeeId }, select: { action: true, diff: true } });
    expect(seen.map((s) => s.action)).toEqual(expect.arrayContaining(['view_hidden']));
    expect(seen.map((s) => s.action)).not.toContain('view_restricted');
    expect(seen.find((s) => s.action === 'view_hidden')?.diff).toMatchObject({ hidden: true });
  });
});
