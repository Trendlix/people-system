import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, addMonths, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Hiring in one form (owner's decision, 16 October 2026: "there is no point of adding employment then adding contract
// and no active employment without a contract"): POST /employees/:id/hire makes the employment and its first contract,
// drafted to print and sign, in one transaction. A refusal of either part makes neither. Dates that decide Probation or
// Active are counted from today in Cairo; the others are fixed.

const RUN = Date.now().toString(36).toLowerCase();
const GROSS = 'Enter the gross salary as an amount, e.g. 12000 or 12000.50.';
const START_ON_JOIN_DATE = 'The first contract starts on the join date: leave its start date out.';

interface Contract {
  id: string;
  number: string;
  version: number;
  status: string;
  startDate: string;
  endDate: string | null;
  probationMonths: number;
  probationEnd: string | null;
  [key: string]: unknown;
}

interface Employment {
  id: string;
  status: string;
  joinDate: string;
  probationEnd: string | null;
  endDate: string | null;
  [key: string]: unknown;
}

interface Profile {
  id: string;
  fullNameEn: string;
  employment: Employment | null;
  employments: Employment[];
}

describe('Hiring in one form (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  let admin: string;
  let superAdmin: string;
  let departmentId: string;
  let teamId: string;
  let jobTitleId: string; // Account Manager: grades G3 to G6
  let shiftA: string;
  let grades: Map<string, string>;
  let transport: string;
  let emailDomainBefore: string | null;
  /** Everyone this file adds, deleted at the end with what was made for them. */
  const added: string[] = [];
  const today = todayInCairo();
  const api = () => request(app.getHttpServer());
  const grade = (code: string) => grades.get(code)!;

  async function addEmployee(name: string): Promise<Profile> {
    const p = (await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201)).body as Profile;
    added.push(p.id);
    return p;
  }

  /** A full-time job from 15 January 2026, unless more is given. */
  const job = (extra: Record<string, unknown> = {}) => ({ employmentType: 'full_time', joinDate: '2026-01-15', ...extra });

  const postHire = (employeeId: string, body: object, session = hr) => api().post(`/api/employees/${employeeId}/hire`).set('Cookie', session).send(body);

  async function hire(employeeId: string, employment: Record<string, unknown> = {}, contract: Record<string, unknown> = {}): Promise<Profile> {
    return (await postHire(employeeId, { employment: job(employment), contract: { grossSalary: 12000, ...contract } }).expect(201)).body as Profile;
  }

  const contractsOf = async (employeeId: string, employmentId: string) =>
    (await api().get(`/api/employees/${employeeId}/employments/${employmentId}/contracts`).set('Cookie', hr).expect(200)).body as Contract[];

  const profileOf = async (id: string) => (await api().get(`/api/employees/${id}`).set('Cookie', hr).expect(200)).body as Profile;

  /** Nothing was made: no employment (so no contract), and no audit entry of one. */
  async function nothingMade(employeeId: string) {
    expect(await profileOf(employeeId)).toMatchObject({ employment: null, employments: [] });
    expect(await prisma.employment.count({ where: { employeeId } })).toBe(0);
    expect(await prisma.contract.count({ where: { employment: { employeeId } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityType: 'employment', diff: { path: ['employeeId'], equals: employeeId } } })).toBe(0);
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));

    const gradeRows = (await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[];
    grades = new Map(gradeRows.map((g) => [g.code, g.id]));
    const shifts = (await api().get('/api/shifts').set('Cookie', hr).expect(200)).body as { id: string; code: string }[];
    shiftA = shifts.find((s) => s.code === 'A')!.id;
    const dept = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Hiring ${RUN}` }).expect(201);
    departmentId = dept.body.id;
    const team = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Accounts', parentId: departmentId }).expect(201);
    teamId = team.body.id;
    const title = await api()
      .post('/api/job-titles')
      .set('Cookie', hr)
      .send({ departmentId: teamId, titleEn: 'Account Manager', minGradeId: grade('G3'), maxGradeId: grade('G6') })
      .expect(201);
    jobTitleId = title.body.id;
    transport = (await api().post('/api/allowance-types').set('Cookie', hr).send({ nameEn: `Transport ${RUN}`, nameAr: 'بدل انتقال' }).expect(201)).body.id;
    // sign-in accounts here are @test.local: no company email domain while these tests run
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
  });

  afterAll(async () => {
    // Everything made here goes, so it doesn't crowd other files' lists (e.g. the template preview's 50 people): the
    // people first, with their employments, contracts, the contracts' allowances and documents (deleted with them), then
    // what those used.
    await prisma.employee.deleteMany({ where: { id: { in: added } } });
    if (jobTitleId) await prisma.jobTitle.deleteMany({ where: { id: jobTitleId } });
    if (teamId) await prisma.department.deleteMany({ where: { id: teamId } });
    if (departmentId) await prisma.department.deleteMany({ where: { id: departmentId } });
    if (transport) await prisma.allowanceType.deleteMany({ where: { id: transport } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  it('makes the employment and its first contract, a draft from the join date; the audit log has both', async () => {
    const e = await addEmployee('One Form');
    const joinDate = addDays(today, -10);
    const p = await hire(
      e.id,
      { joinDate, jobTitleId, gradeId: grade('G4'), shiftId: shiftA },
      { allowances: [{ allowanceTypeId: transport, amount: 500 }], note: 'Agreed at the interview' },
    );
    const probationEnd = addDays(addMonths(joinDate, 3), -1);
    expect(p.employment).toMatchObject({ joinDate, departmentId: teamId, jobTitleId, gradeId: grade('G4'), shiftId: shiftA, status: 'probation', probationEnd });
    expect(p.employments).toHaveLength(1);

    const [c, ...more] = await contractsOf(e.id, p.employment!.id);
    expect(more).toEqual([]);
    expect(c).toMatchObject({
      number: expect.stringMatching(/^CON-\d{4}-\d{4}$/),
      version: 1,
      form: 'fixed',
      status: 'draft',
      startDate: joinDate,
      endDate: addDays(addMonths(joinDate, 12), -1),
      probationMonths: 3,
      probationEnd,
      payBasis: 'monthly',
      grossSalary: 12000,
      allowances: [expect.objectContaining({ allowanceTypeId: transport, amount: 500 })],
      note: 'Agreed at the interview',
    });

    const employmentAudit = await prisma.auditLog.findMany({ where: { entityType: 'employment', entityId: p.employment!.id } });
    expect(employmentAudit).toHaveLength(1);
    expect(employmentAudit[0]).toMatchObject({ action: 'create', diff: expect.objectContaining({ employeeId: e.id, joinDate, status: 'probation', probationEnd }) });
    const contractAudit = await prisma.auditLog.findMany({ where: { entityType: 'contract', entityId: c.id } });
    expect(contractAudit).toHaveLength(1);
    // the salary is restricted: the audit log only says it was set
    expect(contractAudit[0]).toMatchObject({ action: 'create', diff: expect.objectContaining({ employmentId: p.employment!.id, grossSalary: 'changed', allowances: 'changed' }) });
  });

  it('gives the employment the contract’s probation: a shorter one, or none', async () => {
    const joinDate = addDays(today, -10);
    const short = await hire((await addEmployee('One Month')).id, { joinDate }, { probationMonths: 1 });
    const oneMonth = addDays(addMonths(joinDate, 1), -1);
    expect(short.employment).toMatchObject({ status: 'probation', probationEnd: oneMonth });
    expect((await contractsOf(short.id, short.employment!.id))[0]).toMatchObject({ probationMonths: 1, probationEnd: oneMonth });
    const [created] = await prisma.auditLog.findMany({ where: { entityType: 'employment', entityId: short.employment!.id } });
    expect(created.diff).toMatchObject({ probationEnd: oneMonth, status: 'probation' });

    const none = await hire((await addEmployee('No Probation')).id, { joinDate }, { probationMonths: 0 });
    expect(none.employment).toMatchObject({ status: 'active', probationEnd: null });
    expect((await contractsOf(none.id, none.employment!.id))[0]).toMatchObject({ probationMonths: 0, probationEnd: null });

    // later saves of the employment keep the first contract's probation
    const saved = await api().patch(`/api/employees/${short.id}/employments/${short.employment!.id}`).set('Cookie', hr).send({ shiftId: shiftA }).expect(200);
    expect((saved.body as Profile).employment).toMatchObject({ probationEnd: oneMonth });
  });

  it('makes neither when the contract is refused', async () => {
    const e = await addEmployee('Contract Refused');
    // a monthly salary without a gross: refused once the employment is already written in the transaction
    expect((await postHire(e.id, { employment: job(), contract: {} }).expect(400)).body.message).toBe(GROSS);
    await nothingMade(e.id);
    const hourly = await postHire(e.id, { employment: job(), contract: { payBasis: 'hourly', hourlyRate: 150 } }).expect(400);
    expect(hourly.body.message).toBe('Enter the hourly rate and the hours a week: pay by the hour needs both.');
    await nothingMade(e.id);
    const long = await postHire(e.id, { employment: job(), contract: { grossSalary: 9000, durationMonths: 2, probationMonths: 3 } }).expect(400);
    expect(long.body.message).toBe('The probation would end after the contract, on 14/04/2026. Shorten the probation or lengthen the contract.');
    await nothingMade(e.id);

    // put right, it goes through
    const p = await hire(e.id);
    expect(p.employment).toMatchObject({ joinDate: '2026-01-15' });
    expect(await contractsOf(e.id, p.employment!.id)).toHaveLength(1);
  });

  it('makes neither when the employment is refused', async () => {
    const e = await addEmployee('Employment Refused');
    const outOfRange = await postHire(e.id, { employment: job({ jobTitleId, gradeId: grade('G7') }), contract: { grossSalary: 12000 } }).expect(400);
    expect(outOfRange.body.message).toBe('Account Manager takes grades G3 to G6. Choose a grade in that range.');
    const ownManager = await postHire(e.id, { employment: job({ managerId: e.id }), contract: { grossSalary: 12000 } }).expect(400);
    expect(ownManager.body.message).toBe('An employee cannot be their own manager.');
    await nothingMade(e.id);
  });

  it('refuses a trainee, who is an intern now (owner, 25 October 2026: "unpaid internship and training are the same thing"), making neither', async () => {
    const e = await addEmployee('Trainee Refused');
    const trainee = await postHire(e.id, { employment: job({ employmentType: 'trainee' }), contract: { grossSalary: 8000 } }).expect(400);
    expect(trainee.body.message).toEqual(['Choose an employment type: full_time, part_time, intern (an unpaid internship, outside the labour law; a trainee is an intern now) or freelance (outside the labour law).']);
    await nothingMade(e.id);
  });

  it('checks both parts at once: the messages of each come back together', async () => {
    const e = await addEmployee('Both Parts');
    const both = await postHire(e.id, { employment: { joinDate: 'soon' }, contract: { grossSalary: -1, durationMonths: 0 } }).expect(400);
    expect(both.body.message).toEqual(
      expect.arrayContaining([
        'Choose an employment type: full_time, part_time, intern (an unpaid internship, outside the labour law; a trainee is an intern now) or freelance (outside the labour law).',
        'Enter the join date.',
        'Enter a gross salary of more than 0.',
        'A fixed term runs for 1 to 60 months.',
      ]),
    );
    expect((await postHire(e.id, { employment: job() }).expect(400)).body.message).toEqual(["Send the contract's terms as an object."]);
    expect((await postHire(e.id, { contract: { grossSalary: 12000 } }).expect(400)).body.message).toEqual(['Send the employment as an object.']);
    // a field neither part takes, e.g. the status (the system's) or the probation end (worked out)
    await postHire(e.id, { employment: job({ status: 'active' }), contract: { grossSalary: 12000 } }).expect(400);
    await postHire(e.id, { employment: job(), contract: { grossSalary: 12000, probationEnd: '2026-02-14' } }).expect(400);
    // the contract starts on the join date
    expect((await postHire(e.id, { employment: job(), contract: { grossSalary: 12000, startDate: '2026-02-01' } }).expect(400)).body.message).toBe(START_ON_JOIN_DATE);
    await nothingMade(e.id);
    const same = await hire(e.id, {}, { startDate: '2026-01-15' });
    expect((await contractsOf(e.id, same.employment!.id))[0]).toMatchObject({ startDate: '2026-01-15' });
  });

  it('hires again after the last employment ended: no probation, the history kept, and never while one is current', async () => {
    const e = await addEmployee('Hired Again');
    const first = await hire(e.id, { joinDate: '2025-01-01' });
    // while it is current
    const twice = await postHire(e.id, { employment: job({ joinDate: '2026-03-01' }), contract: { grossSalary: 9000 } }).expect(409);
    expect(twice.body.message).toBe(`Hired Again ${RUN} already has a current employment, since 2025-01-01. End it before adding a new one.`);
    await api().post(`/api/employees/${e.id}/employments/${first.employment!.id}/end`).set('Cookie', hr).send({ endDate: '2025-12-31', endReason: 'resigned' }).expect(200);

    // probation comes once with an employer (Labour Law Art. 90): refused, and nothing new is made
    const withProbation = await postHire(e.id, { employment: job({ joinDate: '2026-03-01' }), contract: { grossSalary: 9000, probationMonths: 3 } }).expect(400);
    expect(withProbation.body.message).toBe(`Hired Again ${RUN} already had a probation with the company; the law allows it once (Art. 90).`);
    const early = await postHire(e.id, { employment: job({ joinDate: '2025-12-31' }), contract: { grossSalary: 9000 } }).expect(400);
    expect(early.body.message).toBe('The last employment ended on 2025-12-31: the new one must start after that.');
    expect(await prisma.employment.count({ where: { employeeId: e.id } })).toBe(1);
    expect(await prisma.contract.count({ where: { employment: { employeeId: e.id } } })).toBe(1);

    const hourly = { payBasis: 'hourly', hourlyRate: 150, hoursPerWeek: 16, daysPerWeek: 2 };
    const again = (await postHire(e.id, { employment: job({ joinDate: '2026-03-01', employmentType: 'part_time' }), contract: hourly }).expect(201)).body as Profile;
    expect(again.employment).toMatchObject({ joinDate: '2026-03-01', employmentType: 'part_time', status: 'active', probationEnd: null });
    expect(again.employments.map((x) => x.joinDate)).toEqual(['2026-03-01', '2025-01-01']);
    expect((await contractsOf(e.id, again.employment!.id))[0]).toMatchObject({
      version: 1,
      status: 'draft',
      startDate: '2026-03-01',
      probationMonths: 0,
      probationEnd: null,
      payBasis: 'hourly',
      hourlyRate: 150,
      hoursPerWeek: 16,
      daysPerWeek: 2,
    });
    // the first employment keeps its own contract
    expect(await contractsOf(e.id, first.employment!.id)).toHaveLength(1);
  });

  it('only HR hires', async () => {
    const e = await addEmployee('Hands Off');
    for (const session of [finance, ceo, admin, superAdmin]) {
      await postHire(e.id, { employment: job(), contract: { grossSalary: 12000 } }, session).expect(403);
    }
    await api().post(`/api/employees/${e.id}/hire`).send({ employment: job(), contract: { grossSalary: 12000 } }).expect(401);
    await nothingMade(e.id);
    await postHire('00000000-0000-4000-8000-000000000000', { employment: job(), contract: { grossSalary: 12000 } }).expect(404);
  });
});
