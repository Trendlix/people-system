import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, addMonths, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The contract status in the Employees list, in place of the employee code (owner, 21 October 2026: "instead of the Emp
// code, add contract status"; "State + end date"). Each current employment's row in GET /employees has what the status
// is worked out from: its probation end, its contract in force else its latest draft (status, form, start and end), and
// its approved ending's last working day for HR, Admin and the CEO. Never on a C-level person's card (owner, 19 October
// 2026). Every name and account is invented.

const RUN = `cs${Date.now().toString(36).toLowerCase()}`;
const TODAY = todayInCairo();

interface Row {
  id: string;
  restricted: boolean;
  employment: Record<string, unknown> | null;
  [key: string]: unknown;
}

interface Hired {
  id: string;
  employmentId: string;
}

describe('the contract status in the Employees list (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  let hrSuper: string; // HR and Super Admin: gives the C-level grade
  let mark: string; // a manager, Eli's
  let emailDomainBefore: string | null;
  const people: string[] = [];
  const grades = new Map<string, string>();
  const api = () => request(app.getHttpServer());
  const get = (path: string, session: string) => api().get(`/api${path}`).set('Cookie', session);
  const post = (path: string, session: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', session).send(body);
  const patch = (path: string, session: string, body: object) => api().patch(`/api${path}`).set('Cookie', session).send(body);

  let signed: Hired; // a fixed term signed, past its probation
  let probation: Hired; // hired 20 days ago, its first contract signed: on probation
  let draft: Hired; // a draft, not signed
  let none: Hired; // no contract
  let ending: Hired; // an ending the CEO approved: in its notice
  let clara: Hired; // C-level (G9), open-ended
  let lastWorkingDay: string;

  async function hire(name: string, employment: object = {}, session = hr, workEmail?: string): Promise<Hired> {
    const p = (await post('/employees', hr, { fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', ...(workEmail && { workEmail }) }).expect(201)).body as { id: string };
    people.push(p.id);
    const hired = await post(`/employees/${p.id}/employments`, session, { employmentType: 'full_time', joinDate: '2026-01-15', ...employment }).expect(201);
    return { id: p.id, employmentId: hired.body.employment.id as string };
  }

  async function addContract(e: Hired, body: object = {}, session = hr) {
    return (await post(`/employees/${e.id}/employments/${e.employmentId}/contracts`, session, { grossSalary: 12000, ...body }).expect(201)).body as { id: string; startDate: string };
  }

  async function signContract(e: Hired, body: object = {}, session = hr) {
    const c = await addContract(e, body, session);
    await post(`/contracts/${c.id}/sign`, session, { signedOn: c.startDate <= TODAY ? c.startDate : TODAY }).expect(200);
  }

  const rowsOf = async (session: string) => (await get('/employees', session).expect(200)).body as Row[];
  const rowOf = async (id: string, session = hr) => (await rowsOf(session)).find((r) => r.id === id)!;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    const markEmail = await createUser(prisma, ['manager']);
    mark = await signIn(app, markEmail);
    // sign-in accounts here are @test.local: no company email domain while these tests run
    emailDomainBefore = (await get('/company', hr).expect(200)).body.emailDomain;
    await patch('/company', hr, { emailDomain: '' }).expect(200);
    for (const g of (await get('/grades', hr).expect(200)).body as { id: string; code: string }[]) grades.set(g.code, g.id);

    const markProfile = await hire('Mark Manager', { gradeId: grades.get('G6') }, hr, markEmail);
    signed = await hire('Sam Signed'); // 15 January 2026 – 14 January 2027, probation to 14 April 2026
    await signContract(signed);
    probation = await hire('Pia Probation', { joinDate: addDays(TODAY, -20) });
    await signContract(probation);
    draft = await hire('Dina Draft');
    await addContract(draft);
    none = await hire('Nour None');
    ending = await hire('Eli Ending', { managerId: markProfile.id });
    await signContract(ending, { form: 'open_ended' });
    const recorded = (await post(`/employees/${ending.id}/employments/${ending.employmentId}/endings`, hr, { ruleKey: 'company_notice', noticeGivenOn: TODAY }).expect(201)).body as {
      id: string;
      lastWorkingDay: string;
    };
    lastWorkingDay = recorded.lastWorkingDay;
    // recorded by HR, waiting for the CEO: not in its notice yet
    expect((await rowOf(ending.id)).employment).toMatchObject({ status: 'active', endingOn: null });
    await post(`/endings/${recorded.id}/approve`, ceo).expect(200);
    // HR alone can't give the C-level grade: HR with Super Admin hires Clara
    clara = await hire('Clara Chief', { gradeId: grades.get('G9') }, hrSuper);
    await signContract(clara, { form: 'open_ended', grossSalary: 90000 }, hrSuper);
  });

  afterAll(async () => {
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } }); // their contracts and endings with them
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await patch('/company', hr, { emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  it('gives HR each current employment’s contract in force, its probation end and its approved ending', async () => {
    const rows = await rowsOf(hr);
    const of = (e: Hired) => rows.find((r) => r.id === e.id)!.employment!;
    // the rest of the row as before, with the three more fields
    expect(Object.keys(of(signed)).sort()).toEqual(['contract', 'department', 'employmentType', 'endingOn', 'grade', 'gradeId', 'id', 'jobTitle', 'joinDate', 'manager', 'probationEnd', 'status']);
    expect(of(signed)).toMatchObject({
      status: 'active',
      joinDate: '2026-01-15',
      probationEnd: '2026-04-14',
      contract: { status: 'active', form: 'fixed', startDate: '2026-01-15', endDate: '2027-01-14' },
      endingOn: null,
    });
    const joined = addDays(TODAY, -20);
    expect(of(probation)).toMatchObject({
      status: 'probation',
      probationEnd: addDays(addMonths(joined, 3), -1),
      contract: { status: 'active', form: 'fixed', startDate: joined, endDate: addDays(addMonths(joined, 12), -1) },
    });
    expect(of(draft)).toMatchObject({ contract: { status: 'draft', form: 'fixed', startDate: '2026-01-15', endDate: '2027-01-14' }, endingOn: null });
    expect(of(none)).toMatchObject({ contract: null, endingOn: null });
    expect(of(ending)).toMatchObject({ status: 'notice_period', contract: { status: 'active', form: 'open_ended', endDate: null }, endingOn: lastWorkingDay });
    expect(lastWorkingDay > TODAY).toBe(true);
  });

  it('sends nothing of it on a C-level person’s card, the CEO the whole of it', async () => {
    for (const session of [hr, finance]) {
      const card = await rowOf(clara.id, session);
      expect(card).toMatchObject({ restricted: true, confidential: true });
      expect(Object.keys(card.employment!).sort()).toEqual(['department', 'id', 'jobTitle', 'status']);
    }
    expect((await rowOf(clara.id, ceo)).employment).toMatchObject({
      contract: { status: 'active', form: 'open_ended', startDate: '2026-01-15', endDate: null },
      probationEnd: '2026-04-14',
      endingOn: null,
    });
  });

  it('gives Finance and a manager the contract, not the ending', async () => {
    expect((await rowOf(ending.id, finance)).employment).toMatchObject({ status: 'notice_period', contract: { status: 'active' }, endingOn: null });
    const team = await rowsOf(mark);
    // the manager sees themself and their direct report
    expect(team.find((r) => r.id === ending.id)!.employment).toMatchObject({ contract: { status: 'active', form: 'open_ended' }, endingOn: null });
    expect(team.find((r) => r.id === signed.id)).toBeUndefined();
  });

  it('leaves a former employee’s and a not-employed person’s rows as they were', async () => {
    const left = await hire('Leila Left', { joinDate: '2025-01-01' });
    await signContract(left);
    await post(`/employees/${left.id}/employments/${left.employmentId}/end`, hr, { endDate: '2025-12-31', endReason: 'resigned' }).expect(200);
    expect(await rowOf(left.id)).toMatchObject({ standing: 'former', employment: null, lastEnded: { endDate: '2025-12-31', endReason: 'resigned' } });
    const p = (await post('/employees', hr, { fullNameEn: `Nina Nobody ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201)).body as { id: string };
    people.push(p.id);
    expect(await rowOf(p.id)).toMatchObject({ standing: 'not_employed', employment: null, lastEnded: null });
  });
});
