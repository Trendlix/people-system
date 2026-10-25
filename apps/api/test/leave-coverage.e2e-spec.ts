import type { INestApplication } from '@nestjs/common';
import { HIDDEN, type CoverAssignment, type LeaveCoverageView, type LeaveFormCoverage, type StaffingUnitView } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { StandInSchedulerService } from '../src/leave/stand-in-scheduler.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Leave coverage (owner, 25 October 2026: "if there are leaves applied by an employee and another employee in the same
// department is on a leave, how can we manage it without affecting the workflow?"; asked, "Warn and need HR", "Required
// over 2 days", "To a stand-in", "Names, no leave types"): the request form shows who of the team is off by name only;
// the approval shows "leave" to the manager and the types to HR and the CEO; a team's staffing limit, set by HR, marks a
// request over it and HR approves it too, never sick leave; annual leave of more than 2 working days names a colleague
// who covers, not off on those days, who is told (and the cover changed, audited); a manager's leave with a stand-in
// sends what waits at their step, and what comes, to the stand-in during its days and back after, the stand-in's
// decision keeping both; a C-level person stays hidden from HR (and their stand-in is the CEO's or a Super Admin's);
// developers get pseudonyms and no handover note. These tests look at their own people (names end with RUN) and delete
// what they made. Every name is invented.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const NOTE = `Hand over the edit queue ${RUN}`;

interface View {
  id: string;
  status: string;
  stage: string | null;
  waitingForYou: boolean;
  standingInFor: { id: string; fullNameEn: string } | null;
  cover: { id: string; fullNameEn: string } | null;
  handoverNote: string | null;
  overStaffingLimit: boolean;
  standIn: { employee: { id: string; fullNameEn: string } | null; hr: boolean } | null;
  canChangeCover: boolean;
  steps: { kind: string; decision: string | null; onBehalfOf: { id: string; fullNameEn: string } | null }[];
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

describe('Leave coverage (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let deptId: string;
  let teamId: string;
  let holidays: Set<string>;
  const people: string[] = [];
  const users: string[] = [];
  const ids: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const sessions: Record<string, string> = {};
  const names: Record<string, string> = {};
  const types: Record<string, string> = {};
  const api = () => request(app.getHttpServer());

  async function account(key: string, roles: Parameters<typeof createUser>[1]) {
    const email = await createUser(prisma, roles);
    userIds[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    users.push(userIds[key]);
    return email;
  }

  /** An employee hired into a team or department, with a sign-in account of their own (roles) when given. */
  async function person(key: string, name: string, departmentId: string, managerId: string | null, roles: Parameters<typeof createUser>[1] | null) {
    names[key] = `${name} ${RUN}`;
    const made = await api().post('/api/employees').set('Cookie', sessions.hr).send({ fullNameEn: names[key], fullNameAr: 'موظف تجريبي', gender: 'female' }).expect(201);
    ids[key] = made.body.id;
    people.push(made.body.id);
    await api()
      .post(`/api/employees/${ids[key]}/employments`)
      .set('Cookie', sessions.hr)
      .send({ employmentType: 'full_time', departmentId, joinDate: '2024-01-01', ...(managerId && { managerId }) })
      .expect(201);
    if (roles) {
      const email = await account(key, roles);
      await prisma.user.update({ where: { id: userIds[key] }, data: { employeeId: ids[key] } });
      sessions[key] = await signIn(app, email);
    }
  }

  /** The first working day (Sunday to Thursday, no holiday) `ahead` days or more from today, and the `n` in a row from it. */
  function workingDays(ahead: number, n = 1): string[] {
    let start = addDays(TODAY, ahead);
    for (;;) {
      const run: string[] = [];
      let d = start;
      while (run.length < n && [0, 1, 2, 3, 4].includes(weekday(d)) && !holidays.has(d)) {
        run.push(d);
        d = addDays(d, 1);
      }
      if (run.length === n) return run;
      start = addDays(start, 1);
    }
  }

  const ask = (key: string, f: { type: string; startDate: string; endDate?: string; coverId?: string; handoverNote?: string; standIn?: string }, documents: [Buffer, string][] = []) => {
    let req = api()
      .post('/api/me/leave/requests')
      .set('Cookie', sessions[key])
      .field('typeId', types[f.type])
      .field('startDate', f.startDate)
      .field('endDate', f.endDate ?? f.startDate)
      .field('halfDay', 'false');
    if (f.coverId) req = req.field('coverId', f.coverId);
    if (f.handoverNote) req = req.field('handoverNote', f.handoverNote);
    if (f.standIn) req = req.field('standIn', f.standIn);
    for (const [data, name] of documents) req = req.attach('documents', data, name);
    return req;
  };
  const record = (session: string, employeeId: string, f: { type: string; startDate: string; endDate?: string }) =>
    api()
      .post('/api/leave/requests')
      .set('Cookie', session)
      .field('employeeId', employeeId)
      .field('typeId', types[f.type])
      .field('startDate', f.startDate)
      .field('endDate', f.endDate ?? f.startDate);
  const formCoverage = async (key: string, q: { from: string; to?: string; type: string }) =>
    (await api().get('/api/me/leave/coverage').query({ from: q.from, to: q.to ?? q.from, typeId: types[q.type] }).set('Cookie', sessions[key]).expect(200)).body as LeaveFormCoverage;
  const coverageOf = (id: string, key: string) => api().get(`/api/leave/requests/${id}/coverage`).set('Cookie', sessions[key]);
  const decide = (id: string, body: object, key: string) => api().post(`/api/leave/requests/${id}/decide`).set('Cookie', sessions[key]).send(body);
  const waitingFor = async (key: string) => ((await api().get('/api/leave/requests?status=waiting').set('Cookie', sessions[key]).expect(200)).body as View[]).map((v) => v.id);
  const notices = (key: string, kind: string) => prisma.notification.findMany({ where: { userId: userIds[key], kind }, orderBy: { createdAt: 'asc' } });

  let d1: string;
  let three: string[];
  let d4: string;
  let leaveEnd: string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    sessions.hr = await signIn(app, await account('hrUser', ['hr']));
    // HR who also sees C-level people (with Super Admin), to record a C-level person's leave
    sessions.hrAdmin = await signIn(app, await account('hrAdmin', ['hr', 'super_admin']));
    sessions.dev = await signIn(app, await account('dev', ['developer']));
    holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => h.date.toISOString().slice(0, 10)));
    d1 = workingDays(14)[0];
    three = workingDays(28, 3);
    d4 = workingDays(42)[0];
    // the manager's leave, from today for a week, within the year
    leaveEnd = addDays(TODAY, 6) > `${TODAY.slice(0, 4)}-12-31` ? `${TODAY.slice(0, 4)}-12-31` : addDays(TODAY, 6);

    deptId = (await api().post('/api/departments').set('Cookie', sessions.hr).send({ nameEn: `Coverage ${RUN}` }).expect(201)).body.id;
    teamId = (await api().post('/api/departments').set('Cookie', sessions.hr).send({ nameEn: `Video ${RUN}`, parentId: deptId }).expect(201)).body.id;
    // the CEO (an employee with an account), Dan the department's head, Mona the team's manager, her four reports
    await person('ceo', 'Celine Chief', deptId, null, ['ceo']);
    await person('dan', 'Dan Head', deptId, ids.ceo, ['manager']);
    await api().patch(`/api/departments/${deptId}`).set('Cookie', sessions.hr).send({ headId: ids.dan }).expect(200);
    await person('mona', 'Mona Manager', teamId, ids.dan, ['manager']);
    for (const [key, name] of [
      ['omar', 'Omar Editor'],
      ['sara', 'Sara Editor'],
      ['ali', 'Ali Editor'],
      ['kim', 'Kim Editor'],
    ]) {
      await person(key, name, teamId, ids.mona, ['employee']);
    }
    // Cleo: C-level (G9 · Executive), in the team, the CEO her manager, with Rana reporting to her
    await person('cleo', 'Cleo Executive', teamId, ids.ceo, ['employee']);
    const g9 = await prisma.grade.findFirstOrThrow({ where: { confidential: true }, select: { id: true } });
    await prisma.employment.updateMany({ where: { employeeId: ids.cleo }, data: { gradeId: g9.id } });
    await person('rana', 'Rana Report', deptId, ids.cleo, null);

    for (const t of (await api().get('/api/leave/types').set('Cookie', sessions.hr).expect(200)).body as { id: string; key: string }[]) types[t.key] = t.id;
  });

  afterAll(async () => {
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.wfhRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveBalanceYear.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.updateMany({ where: { employeeId: { in: people } }, data: { employeeId: null } });
    await prisma.department.updateMany({ where: { id: { in: [deptId, teamId] } }, data: { headId: null } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.department.deleteMany({ where: { id: teamId } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await app.close();
  });

  describe('the staffing limit', () => {
    it('HR sets a team’s (never a department with teams’), in the audit log; others read it; an employee can’t', async () => {
      await api().put(`/api/leave/staffing/${teamId}`).set('Cookie', sessions.omar).send({ minAtWorkPercent: 50 }).expect(403);
      expect(said(await api().put(`/api/leave/staffing/${deptId}`).set('Cookie', sessions.hr).send({ maxOff: 1 }).expect(400))[0]).toMatch(/has teams: set the limit on each of its teams/);
      expect(said(await api().put(`/api/leave/staffing/${teamId}`).set('Cookie', sessions.hr).send({ minAtWorkPercent: 150 }).expect(400))[0]).toMatch(/1 to 100/);
      const set = (await api().put(`/api/leave/staffing/${teamId}`).set('Cookie', sessions.hr).send({ maxOff: null, minAtWorkPercent: 50 }).expect(200)).body as StaffingUnitView;
      expect(set).toMatchObject({ id: teamId, team: true, members: 6, limit: { maxOff: null, minAtWorkPercent: 50 } });
      const list = (await api().get('/api/leave/staffing').set('Cookie', sessions.hrAdmin).expect(200)).body as StaffingUnitView[];
      expect(list.find((u) => u.id === deptId)).toMatchObject({ hasTeams: true, limit: null, members: 9 });
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'leave_staffing_limit', entityId: teamId }, orderBy: { at: 'desc' } });
      expect(audit).toMatchObject({ userId: userIds.hrUser, action: 'create', diff: expect.objectContaining({ minAtWorkPercent: { from: null, to: 50 } }) });
      await api().get('/api/leave/staffing').set('Cookie', sessions.omar).expect(403);
    });
  });

  describe('who else is off', () => {
    let aliRequest: View;

    it('the request form shows the team’s people off by name, never their leave types, nor a C-level person', async () => {
      // Omar's annual leave recorded by HR (approved), Sara's being decided, Cleo's (C-level) recorded; Mona working from home
      await record(sessions.hr, ids.omar, { type: 'annual', startDate: d1 }).expect(201);
      await ask('sara', { type: 'annual', startDate: d1 }).expect(201);
      await record(sessions.hrAdmin, ids.cleo, { type: 'annual', startDate: d1 }).expect(201);
      const employment = await prisma.employment.findFirstOrThrow({ where: { employeeId: ids.mona }, select: { id: true } });
      await prisma.wfhRequest.create({ data: { employeeId: ids.mona, employmentId: employment.id, date: toDateOnly(d1), status: 'approved', recordedByHr: true } });

      const form = await formCoverage('ali', { from: d1, type: 'annual' });
      expect(form).toMatchObject({ group: { id: teamId, nameEn: `Video ${RUN}`, team: true }, limited: true, viewer: 'requester', leaveDays: 1, limit: { minAtWorkPercent: 50 } });
      const [day] = form.days;
      // five of them (Cleo never counted for Ali), two off and Ali asking: 2 of 5 at work, fewer than the 3 wanted
      expect(day).toMatchObject({ date: d1, members: 5, atWork: 2, self: true, limitedOff: 3, fewestAtWork: 3, over: true });
      expect(day.off).toEqual([
        { id: ids.omar, fullNameEn: names.omar, waiting: false, halfDay: false, type: null },
        { id: ids.sara, fullNameEn: names.sara, waiting: true, halfDay: false, type: null },
      ]);
      expect(day.remote).toEqual([{ id: ids.mona, fullNameEn: names.mona, waiting: false }]);
      expect(form.overLimit).toBe(true);
      expect(JSON.stringify(form)).not.toContain('Annual leave');
      expect(JSON.stringify(form)).not.toContain(names.cleo);
      // a cover is optional for one day; the colleagues who may cover: not Ali, nobody off that day, the team first
      expect(form.cover).toMatchObject({ required: false, overDays: 2 });
      const candidates = form.cover.candidates.map((c) => c.id);
      expect(candidates).toEqual(expect.arrayContaining([ids.kim, ids.dan]));
      expect(candidates).not.toContain(ids.ali);
      expect(candidates).not.toContain(ids.omar);
      expect(candidates).not.toContain(ids.sara);
      expect(candidates).not.toContain(ids.cleo);
      expect(candidates.indexOf(ids.kim)).toBeLessThan(candidates.indexOf(ids.dan));
      // Ali approves for nobody: no stand-in
      expect(form.standIn.needed).toBe(false);
    });

    it('sick leave is never limited, and needs no cover however long', async () => {
      const sick = await formCoverage('kim', { from: three[0], to: three[2], type: 'sick' });
      expect(sick).toMatchObject({ limited: false, overLimit: false, cover: { required: false } });
      const made = (await ask('kim', { type: 'sick', startDate: d1 }, [[PNG, 'certificate.png']]).expect(201)).body as View;
      expect(made).toMatchObject({ status: 'with_manager', overStaffingLimit: false });
      const kimDay = (await formCoverage('kim', { from: d1, type: 'sick' })).days[0];
      expect(kimDay.over).toBe(false);
    });

    it('a cover already off is refused; over the limit the request is still sent, marked, and HR approves it too', async () => {
      expect(said(await ask('ali', { type: 'annual', startDate: d1, coverId: ids.sara }).expect(400))).toEqual([
        `${names.sara} is off on some of these days, so they can’t cover them: choose another colleague.`,
      ]);
      aliRequest = (await ask('ali', { type: 'annual', startDate: d1 }).expect(201)).body as View;
      expect(aliRequest).toMatchObject({ status: 'with_manager', overStaffingLimit: true, cover: null, standIn: null });
      aliRequest = (await decide(aliRequest.id, { decision: 'approve' }, 'mona').expect(200)).body as View;
      // the HR step after the manager, as always, marked over the limit
      expect(aliRequest).toMatchObject({ status: 'with_hr', stage: 'hr', overStaffingLimit: true });
    });

    it('the approval: "leave" for the manager, the types for HR (never a C-level person), the CEO sees all', async () => {
      const manager = (await coverageOf(aliRequest.id, 'mona').expect(200)).body as LeaveCoverageView;
      expect(manager).toMatchObject({ viewer: 'approver', overLimit: true });
      expect(manager.days[0].off.map((o) => [o.fullNameEn, o.type])).toEqual([
        [names.kim, null],
        [names.omar, null],
        [names.sara, null],
      ]);
      const hr = (await coverageOf(aliRequest.id, 'hr').expect(200)).body as LeaveCoverageView;
      expect(hr).toMatchObject({ viewer: 'hr', overLimit: true });
      expect(hr.days[0]).toMatchObject({ members: 5, atWork: 1, over: true });
      expect(hr.days[0].off.map((o) => [o.fullNameEn, o.type, o.waiting])).toEqual([
        [names.kim, 'Sick leave', true],
        [names.omar, 'Annual leave', false],
        [names.sara, 'Annual leave', true],
      ]);
      expect(JSON.stringify(hr)).not.toContain(names.cleo);
      const ceo = (await coverageOf(aliRequest.id, 'ceo').expect(200)).body as LeaveCoverageView;
      expect(ceo.days[0].members).toBe(6);
      expect(ceo.days[0].off.map((o) => o.fullNameEn)).toContain(names.cleo);
      // anyone else: it isn't there
      await coverageOf(aliRequest.id, 'kim').expect(404);
      const approved = (await decide(aliRequest.id, { decision: 'approve' }, 'hr').expect(200)).body as View;
      expect(approved.status).toBe('approved');
    });

    it('a C-level person’s request and coverage stay hidden from HR', async () => {
      const cleos = await prisma.leaveRequest.findFirstOrThrow({ where: { employeeId: ids.cleo }, select: { id: true } });
      await coverageOf(cleos.id, 'hr').expect(404);
      await coverageOf(cleos.id, 'hrAdmin').expect(200);
      // HR's calendar never lists her, as before
      const calendar = (await api().get(`/api/leave/calendar?from=${d1}&to=${d1}&departmentId=${teamId}`).set('Cookie', sessions.hr).expect(200)).body as { employee: { id: string } }[];
      expect(calendar.map((c) => c.employee.id)).not.toContain(ids.cleo);
    });
  });

  describe('the colleague who covers', () => {
    let omars: View;

    it('annual leave of 3 working days without a cover is refused; with one, the cover is told and sees what they cover', async () => {
      const refused = said(await ask('omar', { type: 'annual', startDate: three[0], endDate: three[2] }).expect(400));
      expect(refused).toEqual([expect.stringMatching(/^Name the colleague who covers your work: annual leave of more than 2 working days needs one/)]);
      expect((await formCoverage('omar', { from: three[0], to: three[2], type: 'annual' })).cover.required).toBe(true);
      omars = (await ask('omar', { type: 'annual', startDate: three[0], endDate: three[2], coverId: ids.kim, handoverNote: NOTE }).expect(201)).body as View;
      expect(omars).toMatchObject({ status: 'with_manager', cover: { id: ids.kim, fullNameEn: names.kim }, handoverNote: NOTE, canChangeCover: true });
      const told = await notices('kim', 'leave_cover');
      expect(told).toEqual([expect.objectContaining({ title: `${names.omar} named you to cover their leave`, link: '/my-requests#covering' })]);
      const covering = (await api().get('/api/me/leave/covering').set('Cookie', sessions.kim).expect(200)).body as CoverAssignment[];
      expect(covering).toEqual([{ requestId: omars.id, employee: { id: ids.omar, fullNameEn: names.omar }, startDate: three[0], endDate: three[2], halfDay: false, waiting: true, handoverNote: NOTE }]);
      // the calendar's leave names who covers (approved only for a manager; HR sees those being decided too)
      const calendar = (await api().get(`/api/leave/calendar?from=${three[0]}&to=${three[2]}`).set('Cookie', sessions.hr).expect(200)).body as { id?: string; cover?: { id: string } | null }[];
      expect(calendar.find((c) => c.id === omars.id)?.cover?.id).toBe(ids.kim);
    });

    it('the requester changes the cover, audited: the new one told, the one before told they no longer cover it', async () => {
      // never someone off on those days, never none for leave that needs one
      expect(said(await api().post(`/api/me/leave/requests/${omars.id}/cover`).set('Cookie', sessions.omar).send({ coverId: null }).expect(400))[0]).toMatch(/needs a colleague who covers/);
      await api().post(`/api/me/leave/requests/${omars.id}/cover`).set('Cookie', sessions.kim).send({ coverId: ids.ali }).expect(404);
      const changed = (await api().post(`/api/me/leave/requests/${omars.id}/cover`).set('Cookie', sessions.omar).send({ coverId: ids.ali }).expect(200)).body as View;
      expect(changed.cover).toEqual({ id: ids.ali, fullNameEn: names.ali });
      expect(changed.steps.map((s) => s.kind)).toEqual(['submitted', 'cover_changed']);
      expect(await notices('ali', 'leave_cover')).toEqual([expect.objectContaining({ title: `${names.omar} named you to cover their leave` })]);
      expect((await notices('kim', 'leave_cover')).at(-1)).toMatchObject({ title: `You no longer cover ${names.omar}` });
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'leave_request', entityId: omars.id, action: 'update' } });
      expect(audit).toMatchObject({ userId: userIds.omar, diff: expect.objectContaining({ coverId: { from: ids.kim, to: ids.ali } }) });
    });

    it('the cover asking for leave on those days is warned, never blocked; HR sees the clash', async () => {
      const form = await formCoverage('ali', { from: three[1], type: 'annual' });
      expect(form.covering).toEqual([{ requestId: omars.id, employee: { id: ids.omar, fullNameEn: names.omar }, startDate: three[0], endDate: three[2], halfDay: false, waiting: true }]);
      const alis = (await ask('ali', { type: 'annual', startDate: three[1] }).expect(201)).body as View;
      const hr = (await coverageOf(alis.id, 'hr').expect(200)).body as LeaveCoverageView;
      expect(hr.covering.map((c) => c.requestId)).toEqual([omars.id]);
      await api().post(`/api/me/leave/requests/${alis.id}/cancel`).set('Cookie', sessions.ali).send({}).expect(200);
    });
  });

  describe('the stand-in while a manager is on leave', () => {
    let omars: string;
    let alisNew: string;

    it('a manager names a stand-in: their department’s head by default', async () => {
      const form = await formCoverage('mona', { from: TODAY, to: leaveEnd, type: 'annual' });
      expect(form.standIn).toMatchObject({ needed: true, hr: true, cLevel: false, default: { employee: { id: ids.dan, fullNameEn: names.dan }, hr: false } });
      expect(form.standIn.options.map((o) => o.id)).toEqual(expect.arrayContaining([ids.dan, ids.kim]));
      expect(form.standIn.options.map((o) => o.id)).not.toContain(ids.mona);
      expect(said(await ask('mona', { type: 'annual', startDate: TODAY, endDate: leaveEnd, coverId: ids.dan, standIn: ids.mona }).expect(400))).toContain(
        'You can’t stand in for yourself: choose someone else, or HR.',
      );
    });

    it('during the leave, what waits and what comes goes to the stand-in, who is told; the stand-in’s decision keeps both', async () => {
      omars = (await prisma.leaveRequest.findFirstOrThrow({ where: { employeeId: ids.omar, status: 'with_manager' }, select: { id: true } })).id;
      const waitingBefore = await prisma.leaveRequest.count({ where: { managerId: ids.mona, status: 'with_manager' } });
      expect(await waitingFor('mona')).toContain(omars);
      // HR records Mona's leave from today, approved at once, her stand-in the department's head by default
      const monas = (await record(sessions.hr, ids.mona, { type: 'annual', startDate: TODAY, endDate: leaveEnd }).expect(201)).body as View;
      expect(monas.standIn).toEqual({ employee: { id: ids.dan, fullNameEn: names.dan }, hr: false });
      // told it started, with how many wait (once: a round later tells nobody again)
      expect(await notices('dan', 'stand_in')).toEqual([
        expect.objectContaining({ title: `You are standing in for ${names.mona}`, body: expect.stringContaining(`${waitingBefore} waiting now`), link: '/my-team' }),
      ]);
      expect(await app.get(StandInSchedulerService).runOnce(new Date())).toEqual([]);
      // what waited for Mona waits for Dan now; Mona can't decide it meanwhile
      expect(await waitingFor('dan')).toContain(omars);
      expect(await waitingFor('mona')).not.toContain(omars);
      const asDan = (await api().get(`/api/leave/requests/${omars}`).set('Cookie', sessions.dan).expect(200)).body as View;
      expect(asDan).toMatchObject({ waitingForYou: true, standingInFor: { id: ids.mona, fullNameEn: names.mona } });
      expect(said(await decide(omars, { decision: 'approve' }, 'mona').expect(409))[0]).toMatch(new RegExp(`^You are on leave until .*, so ${names.dan} decides this request meanwhile`));
      // Dan stands in on /auth/me: My Team and the approvals show for him
      expect((await api().get('/api/auth/me').set('Cookie', sessions.dan).expect(200)).body).toMatchObject({ leads: true, standingInFor: [{ id: ids.mona, fullNameEn: names.mona, until: leaveEnd }] });
      // a new request goes to Dan, not Mona
      const before = (await notices('mona', 'leave_waiting')).length;
      alisNew = ((await ask('ali', { type: 'annual', startDate: d4 }).expect(201)).body as View).id;
      expect((await notices('dan', 'leave_waiting')).map((n) => n.body)).toEqual(expect.arrayContaining([expect.stringContaining(names.ali)]));
      expect(await notices('mona', 'leave_waiting')).toHaveLength(before);
      // Dan's decision: logged as standing in for Mona, on the step and in the audit log
      const decided = (await decide(omars, { decision: 'approve' }, 'dan').expect(200)).body as View;
      expect(decided.status).toBe('with_hr');
      expect(decided.steps.find((s) => s.kind === 'manager_decision')).toMatchObject({ decision: 'approve', onBehalfOf: { id: ids.mona, fullNameEn: names.mona } });
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'leave_request', entityId: omars, action: 'approve' } });
      expect(audit).toMatchObject({ userId: userIds.dan, diff: expect.objectContaining({ stage: 'manager', standingInFor: ids.mona }) });
    });

    it('after the leave’s last day, what still waits is the manager’s again', async () => {
      // the days gone by: Mona's leave a week ago (the clock can't move in a test)
      await prisma.leaveRequest.updateMany({ where: { employeeId: ids.mona, status: 'approved' }, data: { startDate: toDateOnly(addDays(TODAY, -10)), endDate: toDateOnly(addDays(TODAY, -4)) } });
      expect(await waitingFor('mona')).toContain(alisNew);
      expect(await waitingFor('dan')).not.toContain(alisNew);
      await api().get(`/api/leave/requests/${alisNew}`).set('Cookie', sessions.dan).expect(404);
      expect((await api().get('/api/auth/me').set('Cookie', sessions.dan).expect(200)).body.standingInFor).toEqual([]);
      const decided = (await decide(alisNew, { decision: 'approve' }, 'mona').expect(200)).body as View;
      expect(decided.steps.find((s) => s.kind === 'manager_decision')?.onBehalfOf).toBeNull();
    });

    it('a C-level approver’s stand-in is the CEO or a Super Admin, never HR', async () => {
      const form = await formCoverage('cleo', { from: three[0], type: 'annual' });
      expect(form.standIn).toMatchObject({ needed: true, cLevel: true, hr: false, default: { employee: { id: ids.ceo }, hr: false } });
      expect(form.standIn.options.map((o) => o.id)).toEqual([ids.ceo]);
      expect(said(await ask('cleo', { type: 'annual', startDate: three[0], standIn: 'hr' }).expect(400))).toContain('A C-level person’s stand-in is the CEO or a Super Admin, not HR: choose one of them.');
      expect(said(await ask('cleo', { type: 'annual', startDate: three[0], standIn: ids.dan }).expect(400))).toContain('A C-level person’s stand-in is the CEO or a Super Admin: choose one of them.');
    });
  });

  describe('developers', () => {
    it('get pseudonyms for everyone named and never the handover note', async () => {
      const omars = (await prisma.leaveRequest.findFirstOrThrow({ where: { employeeId: ids.omar, coverId: ids.ali }, select: { id: true } })).id;
      const view = (await api().get(`/api/leave/requests/${omars}`).set('Cookie', sessions.dev).expect(200)).body as View;
      expect(view.handoverNote).toBe(HIDDEN);
      expect(view.cover?.fullNameEn).not.toBe(names.ali);
      expect(view.steps.find((s) => s.kind === 'manager_decision')?.onBehalfOf?.fullNameEn).not.toBe(names.mona);
      const coverage = (await api().get(`/api/leave/requests/${omars}/coverage`).set('Cookie', sessions.dev).expect(200)).body as LeaveCoverageView;
      const text = JSON.stringify([view, coverage]);
      for (const name of Object.values(names)) expect(text).not.toContain(name);
      expect(text).not.toContain(NOTE);
    });
  });
});
