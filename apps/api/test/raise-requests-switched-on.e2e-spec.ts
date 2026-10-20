import type { INestApplication } from '@nestjs/common';
import { nextFirstOfMonth, type Role } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Raise requests with the switch turned back on (owner, 20 October 2026: "raises not to be visible to employee level for
// now"; packages/shared raises.ts, EMPLOYEE_LEVEL_SEES_RAISES): what the employee level did before, kept covered for when
// "for now" ends. The shared module is the real one but for the switch, on here; raise-requests.e2e-spec.ts runs with it
// as it ships. The employee asks for himself and sees his own requests with his own figure; his direct manager asks a
// percent only and sees his report's requests without a figure; anyone else is refused; HR, Finance and the CEO see
// everything. Everything made here is deleted at the end. Every name and amount is invented.

vi.mock('@trendlix/shared', async (importOriginal) => {
  const shared = await importOriginal<typeof import('@trendlix/shared')>();
  return {
    ...shared,
    EMPLOYEE_LEVEL_SEES_RAISES: true,
    seesRaiseRequests: (user: { roles: readonly Role[] }) => shared.seesRaiseRequests(user, true),
    raiseRequestAccess: (who: Parameters<typeof shared.raiseRequestAccess>[0]) => shared.raiseRequestAccess(who, true),
  };
});

const RUN = Date.now().toString(36).toLowerCase();
const today = todayInCairo();
const JOINED = firstDay(monthsLater(today.slice(0, 7), -4));
const ASKED_FROM = nextFirstOfMonth(today);

interface Request {
  id: string;
  status: string;
  requester: string;
  suggestedGross: number | null;
  suggestion: { kind: string; amount: number | null; percent: number | null; gross: number | null } | null;
  steps: { kind: string; figure: string | null; increaseAmount: number | null; increasePercent: number | null; gross: number | null }[];
  amountsHidden: boolean;
}

interface ForEmployee {
  requests: Request[];
  canRequest: boolean;
  suggestsAmount: boolean;
  suggestionKinds: string[];
  currentGross: number | null;
  pay: { grossSalary: number } | null;
}

const figures = (s: Request['steps'][number]) => [s.figure, s.increaseAmount, s.increasePercent, s.gross];

describe('Raise requests with the employee level seeing them (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  let manager: string;
  let ben: string;
  let stranger: string;
  let emailDomainBefore: string | null;
  let departmentId: string;
  let titleId: string;
  let benId: string;
  const people: string[] = [];
  const api = () => request(app.getHttpServer());

  async function employee(name: string, profile: Record<string, unknown> = {}) {
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', ...profile }).expect(201);
    people.push(res.body.id);
    return res.body as { id: string };
  }

  const ask = (body: object, session: string) =>
    api().post(`/api/employees/${benId}/raise-requests`).set('Cookie', session).send({ effectiveFrom: ASKED_FROM, ...body });
  const requestsOf = async (session: string) => (await api().get(`/api/employees/${benId}/raise-requests`).set('Cookie', session).expect(200)).body as ForEmployee;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    const managerEmail = await createUser(prisma, ['manager']);
    manager = await signIn(app, managerEmail);
    const benEmail = await createUser(prisma, ['employee']);
    ben = await signIn(app, benEmail);
    const strangerEmail = await createUser(prisma, ['employee']);
    stranger = await signIn(app, strangerEmail);

    // sign-in accounts here are @test.local: no company email domain while these tests run
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    departmentId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Switched On ${RUN}` }).expect(201)).body.id;
    titleId = (await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId, titleEn: 'Analyst' }).expect(201)).body.id;

    const monaId = (await employee('Mona Manager', { workEmail: managerEmail })).id;
    await employee('Sam Stranger', { workEmail: strangerEmail });
    benId = (await employee('Ben Asking', { workEmail: benEmail })).id;
    const hired = await api()
      .post(`/api/employees/${benId}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: JOINED, departmentId, jobTitleId: titleId, managerId: monaId })
      .expect(201);
    const draft = await api().post(`/api/employees/${benId}/employments/${hired.body.employment.id}/contracts`).set('Cookie', hr).send({ grossSalary: 10000 }).expect(201);
    await api().post(`/api/contracts/${draft.body.id}/sign`).set('Cookie', hr).send({ signedOn: today }).expect(200);
  });

  afterAll(async () => {
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    if (titleId) await prisma.jobTitle.deleteMany({ where: { id: titleId } });
    if (departmentId) await prisma.department.deleteMany({ where: { id: departmentId } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  it('the employee asks for himself, and sees his own request with the figure he typed and his pay', async () => {
    const q = (await ask({ raiseReason: 'performance', comment: 'Led the yearly audit', suggestedIncrease: 1500 }, ben).expect(201)).body as Request;
    expect(q).toMatchObject({ status: 'with_hr', requester: 'self', suggestion: { kind: 'amount', amount: 1500, percent: null, gross: null }, suggestedGross: null, amountsHidden: true });
    expect(figures(q.steps[0])).toEqual(['amount', 1500, null, null]);
    const [created] = await prisma.auditLog.findMany({ where: { entityType: 'raise_request', entityId: q.id } });
    expect(created.diff).toMatchObject({ requester: 'self', suggestedIncrease: 'set' });
    expect((await ask({ raiseReason: 'annual', comment: 'Again' }, ben).expect(409)).body.message).toBe('A raise request for you is already open. It is decided first.');

    const own = await requestsOf(ben);
    expect(own).toMatchObject({ canRequest: false, suggestsAmount: true, suggestionKinds: ['amount', 'percent'], currentGross: null, pay: { grossSalary: 10000 } });
    expect(own.requests.map((r) => r.id)).toEqual([q.id]);
    // tidy: HR rejects it, so his manager may ask
    await api().post(`/api/raise-requests/${q.id}/decline`).set('Cookie', hr).send({ comment: 'After the review' }).expect(200);
  });

  it('the direct manager asks a percent only, and sees the requests of his report without a figure', async () => {
    expect((await ask({ raiseReason: 'counter_offer', comment: 'An offer from a competitor', suggestedIncrease: 1000 }, manager).expect(400)).body.message).toMatch(/percent only/);
    const q = (await ask({ raiseReason: 'counter_offer', comment: 'An offer from a competitor', suggestedPercent: 8 }, manager).expect(201)).body as Request;
    expect(q).toMatchObject({ requester: 'manager', suggestion: { kind: 'percent', percent: 8, amount: null, gross: null } });

    const forManager = await requestsOf(manager);
    expect(forManager).toMatchObject({ suggestsAmount: false, suggestionKinds: ['percent'], currentGross: null, pay: null });
    expect(forManager.requests).toHaveLength(2);
    // Ben's own, without the figure he typed
    expect(forManager.requests.find((r) => r.id !== q.id)).toMatchObject({ requester: 'self', suggestion: null, suggestedGross: null });
    // the employee doesn't see the manager's request
    expect((await requestsOf(ben)).requests.map((r) => r.id)).not.toContain(q.id);
  });

  it('anyone else is refused; HR, Finance and the CEO see everything', async () => {
    await api().get(`/api/employees/${benId}/raise-requests`).set('Cookie', stranger).expect(404);
    await ask({ raiseReason: 'annual', comment: 'Me too' }, stranger).expect(404);
    for (const session of [hr, finance, ceo]) {
      const all = await requestsOf(session);
      expect(all.requests).toHaveLength(2);
      expect(all.requests.every((r) => !r.amountsHidden)).toBe(true);
      expect(all.requests.find((r) => r.requester === 'manager')!.suggestion).toEqual({ kind: 'percent', amount: null, percent: 8, gross: 10800 });
    }
  });
});
