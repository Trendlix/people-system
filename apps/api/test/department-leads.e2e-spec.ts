import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo, weekday } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Department heads and team leads (owner, 19 October 2026: "i want to add department lead person, the person in
// charge"). Asked, the owner chose: a Head of department and a Team lead, any current employee, shown on the
// Departments lists, the org chart and the profile; the default direct manager when hiring into the department or team,
// and on accepting a job offer without one; and for someone with no direct manager the approver of their leave and
// reimbursements: the team lead, else the department's head, never themself, else HR as before. These tests look at
// their own people (names end with RUN) and delete what they made. Every name is invented.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const JOINED = '2024-01-01';

/** The first Sunday `ahead` days or more from today: two working days from there, a fortnight ahead or more. */
function sundayFrom(ahead: number): string {
  let day = addDays(TODAY, ahead);
  while (weekday(day) !== 0) day = addDays(day, 1);
  return day;
}

interface Head {
  id: string;
  fullNameEn: string;
  employeeCode: string;
}

interface Department {
  id: string;
  nameEn: string;
  parentId: string | null;
  head: Head | null;
  children?: { id: string; head: Head | null }[];
}

interface Manager {
  id: string;
  fullNameEn: string;
  role: string;
}

interface Request {
  id: string;
  status: string;
  stage: string | null;
  waitingForYou: boolean;
  manager: Manager | null;
  steps: { kind: string; decision: string | null }[];
}

interface Leads {
  teamLead: { id: string; fullNameEn: string } | null;
  departmentHead: { id: string; fullNameEn: string } | null;
}

interface Profile {
  id: string;
  employment: { id: string; managerId: string | null; manager: { id: string } | null; leads: Leads } | null;
  employments: { id: string; leads: Leads | null }[];
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
const kinds = (r: Request) => r.steps.map((s) => (s.decision ? `${s.kind}:${s.decision}` : s.kind));
const name = (who: string) => `${who} ${RUN}`;

describe('Department heads and team leads (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let admin: string;
  let emailDomainBefore: string | null;
  let deptId: string; // Leads: Dan heads it
  let teamId: string; // Squad, in Leads: Tia leads it
  let loneId: string; // Leaderless: no head
  let travelId: string;
  const sessions: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const employments: Record<string, string> = {};
  const people: string[] = [];
  const offers: string[] = [];
  const madeDepartments: string[] = [];
  const types: Record<string, string> = {};
  const api = () => request(app.getHttpServer());

  /** A profile, with a sign-in account when `signsIn`, and an employment from 2024 when `employment` is given. */
  async function person(key: string, who: string, employment: Record<string, unknown> | null, signsIn = true) {
    const email = signsIn ? await createUser(prisma, ['employee']) : null;
    const res = await api()
      .post('/api/employees')
      .set('Cookie', hr)
      .send({ fullNameEn: name(who), fullNameAr: 'موظف تجريبي', ...(email && { workEmail: email }) })
      .expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    if (email) sessions[key] = await signIn(app, email);
    if (employment) {
      const hired = await api().post(`/api/employees/${res.body.id}/employments`).set('Cookie', hr).send({ employmentType: 'full_time', joinDate: JOINED, ...employment }).expect(201);
      employments[key] = hired.body.employment.id;
      return hired.body as Profile;
    }
    return res.body as Profile;
  }

  const department = async (id: string, session = hr) => (await api().get(`/api/departments/${id}`).set('Cookie', session).expect(200)).body as Department;
  const setHead = (id: string, headId: string | null, session = hr) => api().patch(`/api/departments/${id}`).set('Cookie', session).send({ headId });
  const profile = async (id: string) => (await api().get(`/api/employees/${id}`).set('Cookie', hr).expect(200)).body as Profile;
  const me = async (key: string) => (await api().get('/api/auth/me').set('Cookie', sessions[key]).expect(200)).body as { employeeId: string; leads: boolean };

  const askLeave = (key: string, startDate: string) =>
    api()
      .post('/api/me/leave/requests')
      .set('Cookie', sessions[key])
      .field('typeId', types.annual)
      .field('startDate', startDate)
      .field('endDate', addDays(startDate, 1))
      .field('halfDay', 'false');
  const decideLeave = (id: string, session: string) => api().post(`/api/leave/requests/${id}/decide`).set('Cookie', session).send({ decision: 'approve' });
  const claim = (key: string) =>
    api().post('/api/me/reimbursements').set('Cookie', sessions[key]).field('typeId', travelId).field('expenseDate', TODAY).field('amount', '120').field('description', 'Taxi to the client');
  const decideClaim = (id: string, session: string) => api().post(`/api/reimbursements/${id}/decide`).set('Cookie', session).send({ decision: 'approve' });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    admin = await signIn(app, await createUser(prisma, ['admin']));

    // sign-in accounts here are @test.local: no company email domain while these tests run
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);

    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: name('Leads') }).expect(201)).body.id;
    teamId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Squad', parentId: deptId }).expect(201)).body.id;
    loneId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: name('Leaderless') }).expect(201)).body.id;
    madeDepartments.push(teamId, deptId, loneId);

    // everyone hired before any lead is chosen, so none of them gets a lead as their direct manager
    await person('dan', 'Dan Head', { departmentId: deptId });
    await person('tia', 'Tia Lead', { departmentId: teamId });
    await person('ben', 'Ben Teammate', { departmentId: teamId });
    await person('nora', 'Nora Department', { departmentId: deptId });
    await person('mona', 'Mona Manager', { departmentId: teamId });
    await person('ivy', 'Ivy Managed', { departmentId: teamId, managerId: ids.mona });
    await person('zed', 'Zed Leaderless', { departmentId: loneId });
    await person('fay', 'Fay Former', { departmentId: loneId, joinDate: '2023-01-01' }, false);
    await api().post(`/api/employees/${ids.fay}/employments/${employments.fay}/end`).set('Cookie', hr).send({ endDate: '2023-12-31', endReason: 'resigned' }).expect(200);
    await person('nel', 'Nel Never', null, false);

    for (const t of (await api().get('/api/leave/types').set('Cookie', hr).expect(200)).body as { id: string; key: string }[]) types[t.key] = t.id;
    travelId = (await api().post('/api/reimbursement-types').set('Cookie', hr).send({ nameEn: name('Travel'), nameAr: 'انتقالات', receiptRequired: false }).expect(201)).body.id;
  });

  afterAll(async () => {
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.reimbursementClaim.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.reimbursementType.deleteMany({ where: { nameEn: { endsWith: RUN } } });
    await prisma.leaveBalanceYear.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.payrollLine.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.jobOffer.deleteMany({ where: { id: { in: offers } } });
    await prisma.generatedDocument.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    // the teams before their departments
    await prisma.department.deleteMany({ where: { id: { in: madeDepartments }, parentId: { not: null } } });
    await prisma.department.deleteMany({ where: { id: { in: madeDepartments } } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('the person in charge', () => {
    it('HR sets a department’s head, an Admin a team’s lead; the lists, the department and the org chart name them; the audit log has it', async () => {
      const headed = (await setHead(deptId, ids.dan).expect(200)).body as Department;
      expect(headed.head).toEqual({ id: ids.dan, fullNameEn: name('Dan Head'), employeeCode: expect.stringMatching(/^EMP-\d{4}$/) });
      const led = (await setHead(teamId, ids.tia, admin).expect(200)).body as Department;
      expect(led.head).toMatchObject({ id: ids.tia, fullNameEn: name('Tia Lead') });

      // everyone signed in reads them, as the departments themselves
      const list = (await api().get('/api/departments').set('Cookie', sessions.ben).expect(200)).body as Department[];
      expect(list.find((d) => d.id === deptId)?.head?.id).toBe(ids.dan);
      expect(list.find((d) => d.id === teamId)?.head?.id).toBe(ids.tia);
      expect(list.find((d) => d.id === loneId)?.head).toBeNull();
      expect((await department(deptId, sessions.ben)).children).toEqual([expect.objectContaining({ id: teamId, head: expect.objectContaining({ id: ids.tia }) })]);

      const chart = (await api().get('/api/org-chart').set('Cookie', sessions.ben).expect(200)).body as {
        departments: { id: string; head: { id: string; fullNameEn: string; fullNameAr: string; employeeCode: string } | null; teams: { id: string; head: { id: string } | null }[] }[];
      };
      const leads = chart.departments.find((d) => d.id === deptId)!;
      expect(leads.head).toEqual({ id: ids.dan, employeeCode: headed.head!.employeeCode, fullNameEn: name('Dan Head'), fullNameAr: 'موظف تجريبي' });
      expect(leads.teams.find((t) => t.id === teamId)?.head?.id).toBe(ids.tia);
      expect(chart.departments.find((d) => d.id === loneId)?.head).toBeNull();

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'department', entityId: deptId, action: 'update' }, orderBy: { id: 'desc' } });
      expect(audit.diff).toEqual({ headId: { from: null, to: ids.dan } });
    });

    it('only a current employee leads, worded by level; only HR and Admins choose; null clears it', async () => {
      expect(said(await setHead(loneId, ids.fay).expect(400))).toEqual([`${name('Fay Former')} has no current employment, so they can't be the head of department. Choose a current employee.`]);
      expect(said(await setHead(teamId, ids.nel).expect(400))).toEqual([`${name('Nel Never')} has no current employment, so they can't be the team lead. Choose a current employee.`]);
      expect(said(await setHead(loneId, '00000000-0000-4000-8000-000000000000').expect(400))).toEqual(['Employee not found. Choose the head of department from the list.']);
      expect(said(await setHead(loneId, 'someone').expect(400))).toEqual(['Choose the person in charge from the list.']);
      await setHead(loneId, ids.zed, sessions.ben).expect(403);
      expect((await department(teamId)).head?.id).toBe(ids.tia);
      expect((await department(loneId)).head).toBeNull();

      // chosen when it is made, and cleared
      expect(said(await api().post('/api/departments').set('Cookie', hr).send({ nameEn: name('Refused'), headId: ids.fay }).expect(400))).toEqual([
        `${name('Fay Former')} has no current employment, so they can't be the head of department. Choose a current employee.`,
      ]);
      const made = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Pod', parentId: loneId, headId: ids.zed }).expect(201)).body as Department;
      madeDepartments.unshift(made.id);
      expect(made.head?.id).toBe(ids.zed);
      const created = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'department', entityId: made.id, action: 'create' } });
      expect(created.diff).toMatchObject({ parentId: loneId, headId: ids.zed });
      expect((await setHead(made.id, null).expect(200)).body.head).toBeNull();
      expect((await setHead(made.id, '').expect(200)).body.head).toBeNull();
      const cleared = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'department', entityId: made.id, action: 'update' }, orderBy: { id: 'desc' } });
      expect(cleared.diff).toEqual({ headId: { from: ids.zed, to: null } });
    });

    it('the session says who leads, without the manager role', async () => {
      expect(await me('dan')).toMatchObject({ employeeId: ids.dan, leads: true });
      expect(await me('tia')).toMatchObject({ employeeId: ids.tia, leads: true });
      expect(await me('ben')).toMatchObject({ employeeId: ids.ben, leads: false });
    });

    it('the profile names the team lead and the head of department of the current employment', async () => {
      const ben = await profile(ids.ben);
      const both = { teamLead: { id: ids.tia, fullNameEn: name('Tia Lead') }, departmentHead: { id: ids.dan, fullNameEn: name('Dan Head') } };
      expect(ben.employment?.leads).toEqual(both);
      expect(ben.employments.map((e) => e.leads)).toEqual([both]);
      expect((await profile(ids.nora)).employment?.leads).toEqual({ teamLead: null, departmentHead: { id: ids.dan, fullNameEn: name('Dan Head') } });
      expect((await profile(ids.zed)).employment?.leads).toEqual({ teamLead: null, departmentHead: null });
      // a former employee's ended employment has none
      const fay = await profile(ids.fay);
      expect(fay.employment).toBeNull();
      expect(fay.employments.map((e) => e.leads)).toEqual([null]);
    });
  });

  describe('hiring', () => {
    it('without a direct manager chosen: the team lead, else the department’s head; one chosen stays; none to choose: none', async () => {
      const intoTeam = await person('hal', 'Hal Hired', { departmentId: teamId }, false);
      expect(intoTeam.employment).toMatchObject({ managerId: ids.tia, manager: { id: ids.tia } });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'employment', entityId: intoTeam.employment!.id, action: 'create' } });
      expect(audit.diff).toMatchObject({ managerId: ids.tia, departmentId: teamId });
      expect((await person('hed', 'Hed Hired', { departmentId: deptId }, false)).employment?.managerId).toBe(ids.dan);
      expect((await person('kim', 'Kim Kept', { departmentId: teamId, managerId: ids.mona }, false)).employment?.managerId).toBe(ids.mona);
      expect((await person('lea', 'Lea Lone', { departmentId: loneId }, false)).employment?.managerId).toBeNull();
    });

    it('in one form (the employment and its first contract) too', async () => {
      const una = await person('una', 'Una Form', null, false);
      const hired = (
        await api()
          .post(`/api/employees/${una.id}/hire`)
          .set('Cookie', hr)
          .send({ employment: { employmentType: 'full_time', joinDate: JOINED, departmentId: teamId }, contract: { grossSalary: 12000 } })
          .expect(201)
      ).body as Profile;
      expect(hired.employment).toMatchObject({ managerId: ids.tia, leads: { teamLead: { id: ids.tia } } });
    });

    it('an accepted job offer without a manager: the person in charge of its team', async () => {
      const made = await api()
        .post('/api/offers')
        .set('Cookie', hr)
        .send({ fullNameEn: name('Omar Offer'), fullNameAr: 'عمر خالد', email: `omar.${RUN}@mail.test`, employmentType: 'full_time', joinDate: addDays(TODAY, 21), departmentId: teamId, grossSalary: 20000 })
        .expect(201);
      offers.push(made.body.id);
      const answered = await api().post(`/api/offers/${made.body.id}/answer`).set('Cookie', hr).send({ answer: 'accepted' }).expect(200);
      expect(answered.body).toMatchObject({ status: 'accepted', hireError: null, employeeId: expect.any(String) });
      people.push(answered.body.employeeId);
      const employment = await prisma.employment.findFirstOrThrow({ where: { employeeId: answered.body.employeeId } });
      expect(employment).toMatchObject({ departmentId: teamId, managerId: ids.tia });
    });
  });

  describe('approving without a direct manager', () => {
    it('a leave request goes to the team lead, who decides it, then HR; their department’s head doesn’t see it', async () => {
      const sent = (await askLeave('ben', sundayFrom(14)).expect(201)).body as Request;
      expect(sent).toMatchObject({ status: 'with_manager', stage: 'manager', waitingForYou: false, manager: { id: ids.tia, fullNameEn: name('Tia Lead'), role: 'team_lead' } });
      expect(kinds(sent)).toEqual(['submitted']);
      expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: sent.id } })).approverRole).toBe('team_lead');

      // waiting for Tia, who has no manager role
      expect((await api().get('/api/leave/requests/counts').set('Cookie', sessions.tia).expect(200)).body.waiting).toBe(1);
      const waiting = (await api().get('/api/leave/requests?status=waiting').set('Cookie', sessions.tia).expect(200)).body as Request[];
      expect(waiting.map((r) => [r.id, r.waitingForYou])).toEqual([[sent.id, true]]);
      await api().get(`/api/leave/requests/${sent.id}`).set('Cookie', sessions.dan).expect(404);
      await decideLeave(sent.id, sessions.dan).expect(404);
      await decideLeave(sent.id, sessions.ben).expect(403);

      const decided = (await decideLeave(sent.id, sessions.tia).expect(200)).body as Request;
      expect(decided).toMatchObject({ status: 'with_hr', stage: 'hr', manager: { id: ids.tia, role: 'team_lead' } });
      expect(kinds(decided)).toEqual(['submitted', 'manager_decision:approve']);
      expect(((await decideLeave(sent.id, hr).expect(200)).body as Request).status).toBe('approved');
    });

    it('in a department itself, or from the team lead themself: the head of department, never themself', async () => {
      const nora = (await askLeave('nora', sundayFrom(21)).expect(201)).body as Request;
      expect(nora).toMatchObject({ status: 'with_manager', manager: { id: ids.dan, fullNameEn: name('Dan Head'), role: 'department_head' } });
      const tia = (await askLeave('tia', sundayFrom(21)).expect(201)).body as Request;
      expect(tia).toMatchObject({ status: 'with_manager', manager: { id: ids.dan, role: 'department_head' } });
      expect((await api().get('/api/leave/requests/counts').set('Cookie', sessions.dan).expect(200)).body.waiting).toBe(2);
      expect(((await decideLeave(nora.id, sessions.dan).expect(200)).body as Request).status).toBe('with_hr');
    });

    it('a direct manager comes first; nobody in charge (the head’s own, a department without a head): straight to HR, as before', async () => {
      expect(((await askLeave('ivy', sundayFrom(28)).expect(201)).body as Request).manager).toEqual({ id: ids.mona, fullNameEn: name('Mona Manager'), role: 'direct_manager' });
      for (const key of ['dan', 'zed']) {
        const r = (await askLeave(key, sundayFrom(28)).expect(201)).body as Request;
        expect(r).toMatchObject({ status: 'with_hr', stage: 'hr', manager: null });
        expect(kinds(r)).toEqual(['submitted', 'no_manager']);
        expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: r.id } })).approverRole).toBeNull();
      }
    });

    it('a reimbursement claim goes the same way: the team lead, else the head, never themself; nobody: HR', async () => {
      const ben = (await claim('ben').expect(201)).body as Request;
      expect(ben).toMatchObject({ status: 'with_manager', stage: 'manager', manager: { id: ids.tia, fullNameEn: name('Tia Lead'), role: 'team_lead' } });
      expect(kinds(ben)).toEqual(['submitted']);
      expect((await prisma.reimbursementClaim.findUniqueOrThrow({ where: { id: ben.id } })).approverRole).toBe('team_lead');
      expect((await api().get('/api/reimbursements/counts').set('Cookie', sessions.tia).expect(200)).body.waiting).toBe(1);
      const waiting = (await api().get('/api/reimbursements?status=waiting').set('Cookie', sessions.tia).expect(200)).body as Request[];
      expect(waiting.map((c) => [c.id, c.waitingForYou])).toEqual([[ben.id, true]]);
      await decideClaim(ben.id, sessions.dan).expect(404);
      const decided = (await decideClaim(ben.id, sessions.tia).expect(200)).body as Request;
      expect(decided).toMatchObject({ status: 'with_hr', manager: { id: ids.tia, role: 'team_lead' } });
      expect(kinds(decided)).toEqual(['submitted', 'manager_decision:approve']);

      expect(((await claim('tia').expect(201)).body as Request).manager).toMatchObject({ id: ids.dan, role: 'department_head' });
      expect(((await claim('ivy').expect(201)).body as Request).manager).toMatchObject({ id: ids.mona, role: 'direct_manager' });
      const dan = (await claim('dan').expect(201)).body as Request;
      expect(dan).toMatchObject({ status: 'with_hr', manager: null });
      expect(kinds(dan)).toEqual(['submitted', 'no_manager']);
    });
  });

  describe('when a lead’s employment ends', () => {
    it('they no longer lead: the department is left without a head until HR chooses another, in the audit log', async () => {
      await person('lou', 'Lou Leaving', { departmentId: loneId }, false);
      expect((await setHead(loneId, ids.lou).expect(200)).body.head.id).toBe(ids.lou);
      await api().post(`/api/employees/${ids.lou}/employments/${employments.lou}/end`).set('Cookie', hr).send({ endDate: TODAY, endReason: 'resigned' }).expect(200);
      expect((await department(loneId)).head).toBeNull();
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'department', entityId: loneId, action: 'update' }, orderBy: { id: 'desc' } });
      expect(audit.diff).toEqual({ headId: { from: ids.lou, to: null }, reason: 'employment_ended' });
      // the others stay
      expect((await department(deptId)).head?.id).toBe(ids.dan);
    });
  });
});
