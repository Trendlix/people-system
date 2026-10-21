import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, addMonths, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Unique names per run: the test files share one database (emptied at the start of each run).
const RUN = Date.now().toString(36).toLowerCase();
const NOWHERE = '00000000-0000-4000-8000-000000000000';
const VALID_IBAN = 'EG380019000500000000263180002';
const arabicDigits = (s: string) => s.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
let ids = 0;
/** A national ID no other run uses; digits 2–7 give the birth date 12 March 1995. */
const newNationalId = () => `2950312${String((Date.now() * 10 + ++ids) % 10_000_000).padStart(7, '0')}`;
// A real 1×1 PNG, for a paper in the employee file.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

interface Employment {
  id: string;
  status: string;
  employmentType: string;
  joinDate: string;
  probationEnd: string | null;
  endDate: string | null;
  endReason: string | null;
  [key: string]: unknown;
}

/** GET /employees/:id, and the answer to every change of an employment. */
interface Profile {
  id: string;
  employeeCode: string;
  employment: Employment | null;
  employments: Employment[];
  reports: { id: string }[];
  completeness: { percent: number; missing: { key: string; label: string; tab: string }[] };
  [key: string]: unknown;
}

/** A profile with a current employment. */
type Hired = Profile & { employment: Employment };

/** A row of GET /employees. */
interface Listed {
  id: string;
  standing: string;
  employment: { id: string; [key: string]: unknown } | null;
  lastEnded: { endDate: string; endReason: string } | null;
  [key: string]: unknown;
}

describe('Employees (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let finance: string;
  let admin: string;
  let superAdmin: string; // the only role that deletes (owner's decision, 15 October 2026)
  let hrSuper: string; // HR and Super Admin: the HR who sees and gives C-level grades (owner, 19 October 2026)
  let webId: string;
  let departmentId: string;
  let otherDepartmentId: string;
  let jobTitleId: string;
  let emailDomainBefore: string | null;
  let gradeIds: Map<string, string>;
  const api = () => request(app.getHttpServer());
  const grade = (code: string) => gradeIds.get(code)!;
  /** The company's email domain, which every work email must use; empty: any domain. */
  const setEmailDomain = (emailDomain: string) => api().patch('/api/company').set('Cookie', hr).send({ emailDomain }).expect(200);

  /** A profile: names only, unless more is given. Employment is added afterwards (hire). */
  const person = (name: string, extra: Record<string, unknown> = {}) => ({
    fullNameEn: `${name} ${RUN}`,
    fullNameAr: 'موظف تجريبي',
    ...extra,
  });

  /** An employment: full time from 15 January 2026, unless more is given. */
  const job = (extra: Record<string, unknown> = {}) => ({ employmentType: 'full_time', joinDate: '2026-01-15', ...extra });

  async function addEmployee(name: string, extra: Record<string, unknown> = {}): Promise<Profile> {
    const res = await api().post('/api/employees').set('Cookie', hr).send(person(name, extra)).expect(201);
    return res.body as Profile;
  }

  const startEmployment = (employeeId: string, body: object, session = hr) =>
    api().post(`/api/employees/${employeeId}/employments`).set('Cookie', session).send(body);
  const changeEmployment = (employeeId: string, employmentId: string, body: object, session = hr) =>
    api().patch(`/api/employees/${employeeId}/employments/${employmentId}`).set('Cookie', session).send(body);
  const endEmployment = (employeeId: string, employmentId: string, body: object, session = hr) =>
    api().post(`/api/employees/${employeeId}/employments/${employmentId}/end`).set('Cookie', session).send(body);
  const deleteEmployment = (employeeId: string, employmentId: string, session = superAdmin) =>
    api().delete(`/api/employees/${employeeId}/employments/${employmentId}`).set('Cookie', session);

  /** Hires someone whose profile exists; answers the updated profile. */
  async function hire(employeeId: string, extra: Record<string, unknown> = {}, session = hr): Promise<Hired> {
    const res = await startEmployment(employeeId, job(extra), session).expect(201);
    return res.body as Hired;
  }

  /** A new profile, hired straight away (`session`: HR, unless a C-level grade needs HR with Super Admin). */
  async function addHired(name: string, employment: Record<string, unknown> = {}, profile: Record<string, unknown> = {}, session = hr): Promise<Hired> {
    const e = await addEmployee(name, profile);
    return hire(e.id, employment, session);
  }

  async function profileOf(id: string, session = hr): Promise<Profile> {
    return (await api().get(`/api/employees/${id}`).set('Cookie', session).expect(200)).body as Profile;
  }

  /** Someone's row in the directory. */
  async function listed(id: string, session = hr): Promise<Listed | undefined> {
    const res = await api().get('/api/employees').set('Cookie', session).expect(200);
    return (res.body as Listed[]).find((e) => e.id === id);
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    const dept = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Web ${RUN}` }).expect(201);
    webId = dept.body.id;
    // the Frontend Developer belongs to the Frontend team of Web, so that team is where the employment places someone
    // (a job title can also belong to a department directly: owner's decision, 15 October 2026)
    const team = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Frontend', parentId: webId }).expect(201);
    departmentId = team.body.id;
    const other = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Media ${RUN}` }).expect(201);
    otherDepartmentId = other.body.id;
    const title = await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId, titleEn: 'Frontend Developer' }).expect(201);
    jobTitleId = title.body.id;
    const grades = await api().get('/api/grades').set('Cookie', hr).expect(200);
    gradeIds = new Map((grades.body as { id: string; code: string }[]).map((g) => [g.code, g.id]));
    // sign-in accounts here are @test.local: no company email domain, except where a test sets one
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await setEmailDomain('');
  });

  afterAll(async () => {
    await setEmailDomain(emailDomainBefore ?? '');
    await app.close();
  });

  describe('profiles', () => {
    it('adds a profile with no employment yet: next code, not employed, audit entry', async () => {
      const first = await addEmployee('Omar Khaled', { workEmail: ` Omar.${RUN}@Trendlix.com `, mobile: '010 1234-5678' });
      expect(first.employeeCode).toMatch(/^EMP-\d{4,}$/);
      expect(first).toMatchObject({
        workEmail: `omar.${RUN}@trendlix.com`,
        mobile: '+201012345678',
        employment: null,
        employments: [],
        reports: [],
        access: { edit: true, delete: false, identity: true, bank: true }, // only a Super Admin deletes
        identity: null,
        bank: null,
      });
      expect(await listed(first.id)).toEqual({
        id: first.id,
        employeeCode: first.employeeCode,
        fullNameEn: `Omar Khaled ${RUN}`,
        fullNameAr: 'موظف تجريبي',
        workEmail: `omar.${RUN}@trendlix.com`,
        photoId: null, // no personal photo in the employee file
        photoCrop: null,
        standing: 'not_employed',
        // C-level or not, and whether only the directory card is sent (owner, 19 October 2026)
        confidential: false,
        restricted: false,
        employment: null,
        lastEnded: null,
      });

      // numbered after the first (other test runs may add employees at the same time)
      const second = await addEmployee('Nour Ali');
      expect(Number(second.employeeCode.slice(4))).toBeGreaterThan(Number(first.employeeCode.slice(4)));

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'employee', entityId: first.id } });
      expect(audit.map((a) => a.action)).toEqual(['create']);
      expect(audit[0].diff).toMatchObject({ fullNameEn: `Omar Khaled ${RUN}`, mobile: '+201012345678' });
    });

    it('refuses employment fields on a profile: they belong to an employment', async () => {
      const employment = {
        employmentType: 'full_time',
        joinDate: '2026-01-15',
        status: 'active',
        departmentId,
        jobTitleId,
        gradeId: NOWHERE,
        managerId: NOWHERE,
        probationEnd: '2026-04-15',
        workArrangement: 'office',
        officeDays: [0],
        shiftId: NOWHERE,
        jdAcknowledgedAt: '2026-01-20',
      };
      for (const [field, value] of Object.entries(employment)) {
        const res = await api().post('/api/employees').set('Cookie', hr).send(person('Hired Too Soon', { [field]: value })).expect(400);
        expect(res.body.message).toEqual([`property ${field} should not exist`]);
      }
      expect(await prisma.employee.count({ where: { fullNameEn: `Hired Too Soon ${RUN}` } })).toBe(0);

      const e = await addEmployee('Profile Only');
      const res = await api().patch(`/api/employees/${e.id}`).set('Cookie', hr).send({ joinDate: '2026-03-01', status: 'active' }).expect(400);
      expect([...(res.body.message as string[])].sort()).toEqual(['property joinDate should not exist', 'property status should not exist']);
    });

    it('refuses a code or work email that is already used', async () => {
      const taken = await addEmployee('Code Owner', { workEmail: `owner.${RUN}@trendlix.com` });
      const dupCode = await api().post('/api/employees').set('Cookie', hr).send(person('Copy', { employeeCode: taken.employeeCode })).expect(409);
      expect(dupCode.body.message).toContain(taken.employeeCode);
      await api().post('/api/employees').set('Cookie', hr).send(person('Copy', { workEmail: `OWNER.${RUN}@trendlix.com` })).expect(409);
    });

    it('checks required fields, dates and lists', async () => {
      await api().post('/api/employees').set('Cookie', hr).send(person('No Arabic', { fullNameAr: ' ' })).expect(400);
      await api().post('/api/employees').set('Cookie', hr).send({ fullNameAr: 'موظف تجريبي' }).expect(400);
      await api().post('/api/employees').set('Cookie', hr).send(person('Bad Date', { dateOfBirth: '1995-02-30' })).expect(400);
      await api().post('/api/employees').set('Cookie', hr).send(person('Bad List', { gender: 'other' })).expect(400);
      await api().post('/api/employees').set('Cookie', hr).send(person('Bad Code', { employeeCode: 'E-1' })).expect(400);
      await api().post('/api/employees').set('Cookie', hr).send(person('Future', { dateOfBirth: '2999-01-01' })).expect(400);
      await api().post('/api/employees').set('Cookie', hr).send(person('Unknown', { salary: 5 })).expect(400);
    });

    it('sets a woman’s military status to Not applicable, and refuses any other', async () => {
      const woman = await addEmployee('Salma Ibrahim', { gender: 'female' });
      expect(woman.militaryStatus).toBe('not_applicable');
      await api().patch(`/api/employees/${woman.id}`).set('Cookie', hr).send({ militaryStatus: 'completed' }).expect(400);

      const man = await addEmployee('Karim Mostafa', { gender: 'male', militaryStatus: 'completed' });
      const changed = await api().patch(`/api/employees/${man.id}`).set('Cookie', hr).send({ gender: 'female' }).expect(200);
      expect(changed.body.militaryStatus).toBe('not_applicable');
    });

    it('changes a profile, and records only what changed', async () => {
      const e = await addEmployee('Changed', { mobile: '01012345678' });
      const changed = await api().patch(`/api/employees/${e.id}`).set('Cookie', hr).send({ nationality: 'Egyptian', mobile: '0101 234 5678' }).expect(200);
      expect(changed.body).toMatchObject({ nationality: 'Egyptian', mobile: '+201012345678' });

      const update = await prisma.auditLog.findFirst({ where: { entityType: 'employee', entityId: e.id, action: 'update' } });
      expect(update?.diff).toEqual({ nationality: { from: null, to: 'Egyptian' } });
    });

    it('lets only a Super Admin delete a profile, not HR nor an Admin (owner’s decision, 15 October 2026)', async () => {
      const e = await addEmployee('Added By Mistake');
      await api().patch(`/api/employees/${e.id}`).set('Cookie', admin).send({ nationality: 'X' }).expect(403);
      for (const who of [hr, admin]) {
        const refused = await api().delete(`/api/employees/${e.id}`).set('Cookie', who).expect(403);
        expect(refused.body.message).toBe('Only a Super Admin can delete records.');
      }
      // the profile says who may delete it: a Super Admin (here one who is HR too, so sees every profile)
      const hrSuperAdmin = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
      expect((await profileOf(e.id, hrSuperAdmin)).access).toEqual({ edit: true, delete: true, identity: true, bank: true });

      await api().delete(`/api/employees/${e.id}`).set('Cookie', superAdmin).expect(204);
      await api().get(`/api/employees/${e.id}`).set('Cookie', hr).expect(404);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'employee', entityId: e.id, action: 'delete' } });
      expect(audit.diff).toEqual({ employeeCode: e.employeeCode, fullNameEn: e.fullNameEn });
    });

    it('only HR adds and changes, and Finance does not delete', async () => {
      await api().post('/api/employees').set('Cookie', finance).send(person('Nope')).expect(403);
      const e = await addEmployee('Protected');
      await api().patch(`/api/employees/${e.id}`).set('Cookie', finance).send({ nationality: 'X' }).expect(403);
      await api().delete(`/api/employees/${e.id}`).set('Cookie', finance).expect(403);
    });
  });

  describe('employments', () => {
    it('hires someone: the default probation end, the team from the job title, in the history, the directory and the audit log', async () => {
      const e = await addEmployee('Hired');
      const hired = await hire(e.id, { jobTitleId, jdAcknowledgedAt: '2026-01-20' });
      expect(hired.employment).toMatchObject({
        employeeId: e.id,
        employmentType: 'full_time',
        status: 'active', // its probation ended on 14 April: the status the system sets is Active (owner's decision, 16 October 2026)
        joinDate: '2026-01-15',
        probationEnd: '2026-04-14', // 3 months, to the day before (as the contract will have it)
        departmentId,
        jobTitleId,
        managerId: null,
        workArrangement: 'office',
        officeDays: [],
        shiftId: null,
        jdAcknowledgedAt: '2026-01-20',
        endDate: null,
        endReason: null,
        endNote: null,
        department: { id: departmentId, nameEn: 'Frontend', nameAr: null, parent: { id: webId, nameEn: `Web ${RUN}`, nameAr: null } },
        jobTitle: { id: jobTitleId, titleEn: 'Frontend Developer', titleAr: null, jdVersion: 1 },
        gradeId: null,
        grade: null,
        manager: null,
        shift: null,
      });
      expect(hired.employment.jobTitle).not.toHaveProperty('grade'); // the grade is the employment's own
      expect(hired.employments).toEqual([hired.employment]);

      expect(await listed(e.id)).toEqual({
        id: e.id,
        employeeCode: e.employeeCode,
        fullNameEn: `Hired ${RUN}`,
        fullNameAr: 'موظف تجريبي',
        workEmail: null,
        photoId: null,
        photoCrop: null,
        standing: 'active',
        confidential: false,
        restricted: false,
        employment: {
          id: hired.employment.id,
          status: 'active',
          employmentType: 'full_time',
          joinDate: '2026-01-15',
          department: { id: departmentId, nameEn: 'Frontend', nameAr: null, parent: { id: webId, nameEn: `Web ${RUN}`, nameAr: null } },
          jobTitle: { id: jobTitleId, titleEn: 'Frontend Developer' },
          gradeId: null,
          grade: null,
          manager: null,
          // what the contract status is worked out from (owner, 21 October 2026: "instead of the Emp code, add contract
          // status"): no contract yet, no ending
          probationEnd: '2026-04-14',
          contract: null,
          endingOn: null,
        },
        lastEnded: null,
      });

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'employment', entityId: hired.employment.id } });
      expect(audit.map((a) => a.action)).toEqual(['create']);
      expect(audit[0].diff).toMatchObject({ employeeId: e.id, employmentType: 'full_time', status: 'active', joinDate: '2026-01-15', probationEnd: '2026-04-14', departmentId, jobTitleId });
      // the profile itself did not change
      expect(await prisma.auditLog.count({ where: { entityType: 'employee', entityId: e.id } })).toBe(1);
    });

    it('checks the employment: type, dates, status, and fields it does not know', async () => {
      const e = await addEmployee('Checked Hire');
      await startEmployment(e.id, { joinDate: '2026-01-15' }).expect(400); // no employment type
      await startEmployment(e.id, { employmentType: 'full_time' }).expect(400); // no join date
      await startEmployment(e.id, job({ joinDate: '2026-02-30' })).expect(400);
      await startEmployment(e.id, job({ employmentType: 'contractor' })).expect(400);
      // the probation end is worked out, never typed (owner, 15 October 2026)
      const typed = await startEmployment(e.id, job({ probationEnd: '2026-04-30' })).expect(400);
      expect(typed.body.message).toEqual(['property probationEnd should not exist']);
      // the status is the system's too (owner's decision, 16 October 2026), Active and Resigned alike
      for (const status of ['active', 'probation', 'resigned']) {
        const chosen = await startEmployment(e.id, job({ status })).expect(400);
        expect(chosen.body.message).toEqual(['property status should not exist']);
      }
      await startEmployment(e.id, job({ endDate: '2026-06-30' })).expect(400); // ending is a step of its own
      await startEmployment(e.id, job({ salary: 5 })).expect(400);
      await startEmployment(NOWHERE, job()).expect(404);
      expect(await prisma.employment.count({ where: { employeeId: e.id } })).toBe(0);
    });

    it('refuses a second employment while one is current', async () => {
      const e = await addHired('Twice');
      const res = await startEmployment(e.id, job({ joinDate: '2026-06-01' })).expect(409);
      expect(res.body.message).toBe(`Twice ${RUN} already has a current employment, since 2026-01-15. End it before adding a new one.`);
      expect(await prisma.employment.count({ where: { employeeId: e.id } })).toBe(1);
    });

    it('keeps office days for Hybrid only', async () => {
      const e = await addEmployee('Hybrid');
      await startEmployment(e.id, job({ workArrangement: 'hybrid' })).expect(400);
      const hired = await hire(e.id, { workArrangement: 'hybrid', officeDays: [3, 0] });
      expect(hired.employment.officeDays).toEqual([0, 3]);
      const office = await changeEmployment(e.id, hired.employment.id, { workArrangement: 'office' }).expect(200);
      expect(office.body.employment.officeDays).toEqual([]);
    });

    it('refuses a job title from another department or team, and an unknown department, team, manager or shift', async () => {
      const e = await addEmployee('Mismatch');
      const res = await startEmployment(e.id, job({ jobTitleId, departmentId: otherDepartmentId })).expect(400);
      expect(res.body.message).toBe('The job title "Frontend Developer" belongs to Frontend. Choose that team, or another job title.');
      // the team's department is not the team: the job title belongs to the team only
      const parent = await startEmployment(e.id, job({ jobTitleId, departmentId: webId })).expect(400);
      expect(parent.body.message).toBe('The job title "Frontend Developer" belongs to Frontend. Choose that team, or another job title.');
      const manager = await startEmployment(e.id, job({ managerId: NOWHERE })).expect(400);
      expect(manager.body.message).toBe('Manager not found. Choose one from the list.');
      const nowhere = await startEmployment(e.id, job({ departmentId: NOWHERE })).expect(400);
      expect(nowhere.body.message).toBe('Department or team not found. Choose one from the list.');
      await startEmployment(e.id, job({ jobTitleId: NOWHERE })).expect(400);
      await startEmployment(e.id, job({ shiftId: NOWHERE })).expect(400);
      expect(await prisma.employment.count({ where: { employeeId: e.id } })).toBe(0);
    });

    it('the probation end always follows the join date (+ 3 months − 1 day), is never typed, a rehire has none, and only what changed is recorded', async () => {
      const e = await addHired('Mover');
      expect(e.employment).toMatchObject({ probationEnd: '2026-04-14', status: 'active' });
      const moved = await changeEmployment(e.id, e.employment.id, { joinDate: '2026-03-01', status: 'on_leave' }).expect(200);
      expect(moved.body.employment).toMatchObject({ joinDate: '2026-03-01', probationEnd: '2026-05-31', status: 'on_leave' });

      // worked out, never typed (owner, 15 October 2026): refused as a field the employment does not take
      const typed = await changeEmployment(e.id, e.employment.id, { probationEnd: '2026-05-20' }).expect(400);
      expect(typed.body.message).toEqual(['property probationEnd should not exist']);
      const again = await changeEmployment(e.id, e.employment.id, { joinDate: '2026-03-02' }).expect(200);
      expect(again.body.employment).toMatchObject({ joinDate: '2026-03-02', probationEnd: '2026-06-01' });
      await changeEmployment(e.id, e.employment.id, { status: 'on_leave' }).expect(200); // nothing changes

      const updates = await prisma.auditLog.findMany({ where: { entityType: 'employment', entityId: e.employment.id, action: 'update' }, orderBy: { id: 'asc' } });
      expect(updates.map((u) => u.diff)).toEqual([
        {
          employeeId: e.id,
          joinDate: { from: '2026-01-15', to: '2026-03-01' },
          probationEnd: { from: '2026-04-14', to: '2026-05-31' },
          status: { from: 'active', to: 'on_leave' },
        },
        { employeeId: e.id, joinDate: { from: '2026-03-01', to: '2026-03-02' }, probationEnd: { from: '2026-05-31', to: '2026-06-01' } },
      ]);

      // hired again: no probation, the law allows it once per employer (Art. 90); the earlier employment keeps its own
      await endEmployment(e.id, e.employment.id, { endDate: '2026-06-30', endReason: 'resigned' }).expect(200);
      const back = await hire(e.id, { joinDate: '2026-08-01' });
      expect(back.employment).toMatchObject({ joinDate: '2026-08-01', probationEnd: null, status: 'active' });
      expect(back.employments[1]).toMatchObject({ id: e.employment.id, joinDate: '2026-03-02', probationEnd: '2026-06-01' });
    });

    // HR chooses only Active or On leave; Probation and Notice period are the system's (owner's decision, 16 October 2026)
    describe('the status', () => {
      const today = todayInCairo();
      /** The probation end a first employment from that day gets: 3 months, to the day before. */
      const probationEndOf = (joinDate: string) => addDays(addMonths(joinDate, 3), -1);

      it('of a new employment is the system’s: Probation while its probation runs (to today included), else Active', async () => {
        const starting = await addHired('Starting Today', { joinDate: today });
        expect(starting.employment).toMatchObject({ status: 'probation', probationEnd: probationEndOf(today) });
        const create = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'employment', entityId: starting.employment.id, action: 'create' } });
        expect(create.diff).toMatchObject({ status: 'probation', probationEnd: probationEndOf(today) });

        // the earliest join date whose probation still runs today: it ends today (unless a short month skips that day)
        let join = addMonths(today, -4);
        while (probationEndOf(join) < today) join = addDays(join, 1);
        const lastDay = await addHired('Last Probation Day', { joinDate: join });
        expect(lastDay.employment).toMatchObject({ status: 'probation', probationEnd: probationEndOf(join) });
        // a day earlier: the probation is over before today, so Active (a hire entered late)
        const late = await addHired('Probation Just Over', { joinDate: addDays(join, -1) });
        expect(late.employment).toMatchObject({ status: 'active', probationEnd: probationEndOf(addDays(join, -1)) });
        expect(late.employment.probationEnd! < today).toBe(true);
        expect(await listed(late.id)).toMatchObject({ standing: 'active' });

        // a rehire has no probation (Art. 90): Active, starting today too
        await endEmployment(late.id, late.employment.id, { endDate: addDays(today, -1), endReason: 'resigned' }).expect(200);
        const back = await hire(late.id, { joinDate: today });
        expect(back.employment).toMatchObject({ status: 'active', probationEnd: null });

        // no probation in the contract settings: Active
        await api().patch('/api/contract-settings').set('Cookie', hr).send({ probationMonths: 0 }).expect(200);
        try {
          const none = await addHired('No Probation Set', { joinDate: today });
          expect(none.employment).toMatchObject({ status: 'active', probationEnd: null });
        } finally {
          await api().patch('/api/contract-settings').set('Cookie', hr).send({ probationMonths: 3 }).expect(200);
        }
      });

      it('HR moves a current employment between Active and On leave, and to nothing else', async () => {
        const e = await addHired('On And Off'); // hired in January, its probation over: Active
        expect(e.employment.status).toBe('active');
        const away = await changeEmployment(e.id, e.employment.id, { status: 'on_leave' }).expect(200);
        expect(away.body.employment.status).toBe('on_leave');
        expect((await listed(e.id))!.standing).toBe('on_leave');
        await changeEmployment(e.id, e.employment.id, { status: 'on_leave' }).expect(200); // the same status: no change
        const back = await changeEmployment(e.id, e.employment.id, { status: 'active' }).expect(200);
        expect(back.body.employment.status).toBe('active');

        // Probation and Notice period are the system's; Resigned and Terminated come from ending the employment
        for (const status of ['probation', 'notice_period', 'resigned', 'terminated', '']) {
          const refused = await changeEmployment(e.id, e.employment.id, { status }).expect(400);
          expect(refused.body.message).toEqual(['Choose Active or On leave. Probation and Notice period are set by the system.']);
        }
        expect((await profileOf(e.id)).employment!.status).toBe('active');

        const updates = await prisma.auditLog.findMany({ where: { entityType: 'employment', entityId: e.employment.id, action: 'update' }, orderBy: { id: 'asc' } });
        expect(updates.map((u) => u.diff)).toEqual([
          { employeeId: e.id, status: { from: 'active', to: 'on_leave' } },
          { employeeId: e.id, status: { from: 'on_leave', to: 'active' } },
        ]);
      });

      it('on probation, HR does not choose it: it becomes Active with Confirm probation', async () => {
        const e = await addHired('Still On Probation', { joinDate: addDays(today, -10) });
        expect(e.employment.status).toBe('probation');
        for (const status of ['active', 'on_leave']) {
          const refused = await changeEmployment(e.id, e.employment.id, { status, workArrangement: 'wfh' }).expect(400);
          expect(refused.body.message).toBe(`Still On Probation ${RUN} is on probation: the status becomes Active with Confirm probation.`);
        }
        // nothing saved; the rest of the employment changes without the status
        expect((await profileOf(e.id)).employment).toMatchObject({ status: 'probation', workArrangement: 'office' });
        const changed = await changeEmployment(e.id, e.employment.id, { workArrangement: 'wfh' }).expect(200);
        expect(changed.body.employment).toMatchObject({ status: 'probation', workArrangement: 'wfh' });

        await api().post(`/api/employees/${e.id}/employments/${e.employment.id}/confirm-probation`).set('Cookie', hr).expect(200);
        const away = await changeEmployment(e.id, e.employment.id, { status: 'on_leave' }).expect(200);
        expect(away.body.employment.status).toBe('on_leave');
      });
    });

    it('refuses a reporting loop and being one’s own manager', async () => {
      const boss = await addHired('Boss');
      const lead = await addHired('Lead', { managerId: boss.id });
      const dev = await addHired('Dev', { managerId: lead.id });
      expect(dev.employment.manager).toEqual({ id: lead.id, employeeCode: lead.employeeCode, fullNameEn: `Lead ${RUN}` });
      const loop = await changeEmployment(boss.id, boss.employment.id, { managerId: dev.id }).expect(400);
      expect(loop.body.message).toBe('That manager reports to this employee, directly or through others. Choose someone else.');
      await changeEmployment(boss.id, boss.employment.id, { managerId: boss.id }).expect(400);

      expect((await profileOf(boss.id)).reports).toEqual([
        { id: lead.id, employeeCode: lead.employeeCode, fullNameEn: `Lead ${RUN}`, status: 'active', standing: 'active', jobTitle: null },
      ]);

      const res = await api().delete(`/api/employees/${lead.id}`).set('Cookie', superAdmin).expect(409);
      expect(res.body.message).toContain('1 employee');
      await api().delete(`/api/employees/${dev.id}`).set('Cookie', superAdmin).expect(204);
      await api().get(`/api/employees/${dev.id}`).set('Cookie', hr).expect(404);
      expect(await prisma.employment.count({ where: { employeeId: dev.id } })).toBe(0); // the employments go with the profile
    });

    it('ends an employment: Resigned or Terminated by the reason; the profile stays, as a former employee', async () => {
      const e = await addHired('Leaver', { jobTitleId });
      await endEmployment(e.id, e.employment.id, { endDate: '2026-01-14', endReason: 'resigned' }).expect(400); // before joining
      await endEmployment(e.id, e.employment.id, { endDate: '2026-05-31', endReason: 'fired' }).expect(400); // not an end reason (retired is one, since the contracts module)
      await endEmployment(e.id, e.employment.id, { endReason: 'resigned' }).expect(400);

      const res = await endEmployment(e.id, e.employment.id, { endDate: '2026-05-31', endReason: 'resigned', endNote: ' Moved abroad ' }).expect(200);
      const ended = res.body as Profile;
      expect(ended.employment).toBeNull();
      expect(ended.employments).toHaveLength(1);
      expect(ended.employments[0]).toMatchObject({
        id: e.employment.id,
        status: 'resigned',
        joinDate: '2026-01-15',
        endDate: '2026-05-31',
        endReason: 'resigned',
        endNote: 'Moved abroad',
        jobTitleId,
      });
      expect(await listed(e.id)).toMatchObject({ standing: 'former', employment: null, lastEnded: { endDate: '2026-05-31', endReason: 'resigned' } });

      const again = await endEmployment(e.id, e.employment.id, { endDate: '2026-06-30', endReason: 'other' }).expect(409);
      expect(again.body.message).toBe('This employment already ended on 2026-05-31.');

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'employment', entityId: e.employment.id, action: 'end' } });
      expect(audit.diff).toEqual({ employeeId: e.id, endDate: '2026-05-31', endReason: 'resigned', status: { from: 'active', to: 'resigned' } });

      // any other reason gives Terminated
      for (const endReason of ['terminated', 'contract_ended', 'other']) {
        const other = await addHired(`Leaver ${endReason}`);
        const out = await endEmployment(other.id, other.employment.id, { endDate: '2026-02-28', endReason }).expect(200);
        expect((out.body as Profile).employments[0]).toMatchObject({ status: 'terminated', endReason });
        expect(await listed(other.id)).toMatchObject({ standing: 'former', lastEnded: { endDate: '2026-02-28', endReason } });
      }
    });

    it('will not end the employment of someone people report to, until they have another manager', async () => {
      const lead = await addHired('Leaving Lead');
      const member = await addHired('Staying Member', { managerId: lead.id });
      const res = await endEmployment(lead.id, lead.employment.id, { endDate: '2026-06-30', endReason: 'resigned' }).expect(409);
      expect(res.body.message).toBe('1 employee(s) report to this person. Choose another manager for them before ending this employment.');
      await deleteEmployment(lead.id, lead.employment.id).expect(409);
      expect((await profileOf(lead.id)).employment).toMatchObject({ id: lead.employment.id, endDate: null });

      await changeEmployment(member.id, member.employment.id, { managerId: null }).expect(200);
      await endEmployment(lead.id, lead.employment.id, { endDate: '2026-06-30', endReason: 'resigned' }).expect(200);
    });

    it('hires again after the last employment ended, keeping the history newest first', async () => {
      const e = await addHired('Returner', { joinDate: '2025-01-10' });
      await endEmployment(e.id, e.employment.id, { endDate: '2025-12-31', endReason: 'contract_ended' }).expect(200);

      const onEnd = await startEmployment(e.id, job({ joinDate: '2025-12-31' })).expect(400);
      expect(onEnd.body.message).toBe('The last employment ended on 2025-12-31: the new one must start after that.');
      await startEmployment(e.id, job({ joinDate: '2025-06-01' })).expect(400);

      const back = await hire(e.id, { joinDate: '2026-01-01', employmentType: 'part_time' });
      expect(back.employment).toMatchObject({ employmentType: 'part_time', status: 'active', joinDate: '2026-01-01', endDate: null }); // a rehire: no probation
      expect(back.employments.map((x) => [x.joinDate, x.endDate, x.status])).toEqual([
        ['2026-01-01', null, 'active'],
        ['2025-01-10', '2025-12-31', 'terminated'],
      ]);
      expect(await listed(e.id)).toMatchObject({
        standing: 'active',
        employment: { id: back.employment.id, employmentType: 'part_time', joinDate: '2026-01-01' },
        lastEnded: null,
      });

      // ended again: the latest end comes first and is the one the directory shows
      await endEmployment(e.id, back.employment.id, { endDate: '2026-04-30', endReason: 'resigned' }).expect(200);
      expect((await profileOf(e.id)).employments.map((x) => x.endDate)).toEqual(['2026-04-30', '2025-12-31']);
      expect(await listed(e.id)).toMatchObject({ standing: 'former', employment: null, lastEnded: { endDate: '2026-04-30', endReason: 'resigned' } });
    });

    it('changes the dates of an ended employment, but not its status', async () => {
      const e = await addHired('Corrected', { joinDate: '2025-03-01' });
      await endEmployment(e.id, e.employment.id, { endDate: '2025-09-30', endReason: 'resigned' }).expect(200);

      const fixed = await changeEmployment(e.id, e.employment.id, { joinDate: '2025-02-01', jdAcknowledgedAt: '2025-02-03' }).expect(200);
      expect(fixed.body.employment).toBeNull();
      expect(fixed.body.employments).toEqual([
        expect.objectContaining({ joinDate: '2025-02-01', probationEnd: '2025-04-30', jdAcknowledgedAt: '2025-02-03', status: 'resigned', endDate: '2025-09-30' }),
      ]);

      const status = await changeEmployment(e.id, e.employment.id, { status: 'active' }).expect(400);
      expect(status.body.message).toBe('This employment has ended: its status follows why it ended.');
      const late = await changeEmployment(e.id, e.employment.id, { joinDate: '2025-10-01' }).expect(400);
      expect(late.body.message).toBe('An employment must start on or before the day it ended.');
      expect(await listed(e.id)).toMatchObject({ standing: 'former', lastEnded: { endDate: '2025-09-30', endReason: 'resigned' } });
    });

    it('corrects how an ended employment ended; a current one is ended with End employment', async () => {
      const e = await addHired('Ending Fixed', { joinDate: '2025-03-01' });
      const current = await changeEmployment(e.id, e.employment.id, { endDate: '2025-09-30' }).expect(400);
      expect(current.body.message).toBe('This employment is current: end it with End employment.');
      await endEmployment(e.id, e.employment.id, { endDate: '2025-09-30', endReason: 'resigned' }).expect(200);

      const fixed = await changeEmployment(e.id, e.employment.id, { endDate: '2025-10-15', endReason: 'contract_ended', endNote: '  Fixed-term ended  ' }).expect(200);
      expect(fixed.body.employments[0]).toMatchObject({ endDate: '2025-10-15', endReason: 'contract_ended', endNote: 'Fixed-term ended', status: 'terminated' });
      const back = await changeEmployment(e.id, e.employment.id, { endReason: 'resigned' }).expect(200);
      expect(back.body.employments[0]).toMatchObject({ endReason: 'resigned', status: 'resigned' });
      await changeEmployment(e.id, e.employment.id, { endDate: '2025-02-01' }).expect(400); // before it started
    });

    it('never lets two employments of one person overlap', async () => {
      const e = await addHired('No Overlap', { joinDate: '2024-01-01' });
      await endEmployment(e.id, e.employment.id, { endDate: '2024-12-31', endReason: 'resigned' }).expect(200);
      const second = await startEmployment(e.id, { employmentType: 'full_time', joinDate: '2025-06-01' }).expect(201);
      const currentId = second.body.employment.id as string;

      // the current one moved back into the first one's period
      const back = await changeEmployment(e.id, currentId, { joinDate: '2024-12-01' }).expect(400);
      expect(back.body.message).toBe('These dates overlap the employment from 2024-01-01 to 2024-12-31. Employments of one person follow each other.');
      // the ended one stretched into the current one's period
      const stretch = await changeEmployment(e.id, e.employment.id, { endDate: '2025-07-01' }).expect(400);
      expect(stretch.body.message).toBe('These dates overlap the employment from 2025-06-01 to now. Employments of one person follow each other.');
      // moving them apart is fine
      await changeEmployment(e.id, currentId, { joinDate: '2025-01-15' }).expect(200);
      await changeEmployment(e.id, e.employment.id, { endDate: '2025-01-14' }).expect(200);
    });

    it('deletes an employment added by mistake (a Super Admin only), and the profile stays', async () => {
      const e = await addHired('Wrong Hire');
      const other = await addHired('Someone Else');
      await deleteEmployment(other.id, e.employment.id).expect(404); // not theirs
      await changeEmployment(other.id, e.employment.id, { status: 'active' }).expect(404);
      for (const who of [finance, hr, admin]) {
        const refused = await deleteEmployment(e.id, e.employment.id, who).expect(403);
        expect(refused.body.message).toBe('Only a Super Admin can delete records.');
      }

      await deleteEmployment(e.id, e.employment.id).expect(204);
      await deleteEmployment(e.id, e.employment.id).expect(404);
      expect(await profileOf(e.id)).toMatchObject({ employment: null, employments: [] });
      expect(await listed(e.id)).toMatchObject({ standing: 'not_employed', employment: null, lastEnded: null });

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'employment', entityId: e.employment.id, action: 'delete' } });
      expect(audit.diff).toEqual({ employeeId: e.id, joinDate: '2026-01-15', endDate: null });

      // an ended one too
      await endEmployment(other.id, other.employment.id, { endDate: '2026-02-28', endReason: 'other' }).expect(200);
      await deleteEmployment(other.id, other.employment.id).expect(204);
      expect(await listed(other.id)).toMatchObject({ standing: 'not_employed', lastEnded: null });
    });

    it('only HR hires, changes and ends', async () => {
      const e = await addEmployee('Hands Off');
      await startEmployment(e.id, job(), finance).expect(403);
      await startEmployment(e.id, job(), admin).expect(403);
      const hired = await hire(e.id);
      await changeEmployment(e.id, hired.employment.id, { status: 'on_leave' }, finance).expect(403);
      await endEmployment(e.id, hired.employment.id, { endDate: '2026-06-30', endReason: 'resigned' }, finance).expect(403);
      await endEmployment(e.id, hired.employment.id, { endDate: '2026-06-30', endReason: 'resigned' }, admin).expect(403);
      expect((await profileOf(e.id)).employment).toMatchObject({ status: 'active', endDate: null });
    });
  });

  // Job title and grade apart (owner's decision, 15 October 2026): each employment has the person's own grade, within
  // the range of grades its job title takes.
  describe('grades', () => {
    let ranged: string; // Account Manager: G3 to G6
    let fromG3: string; // Account Lead: from G3
    let upToG6: string; // Account Assistant: up to G6

    beforeAll(async () => {
      const add = async (titleEn: string, range: object) =>
        (await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId, titleEn, ...range }).expect(201)).body.id as string;
      ranged = await add('Account Manager', { minGradeId: grade('G3'), maxGradeId: grade('G6') });
      fromG3 = await add('Account Lead', { minGradeId: grade('G3') });
      upToG6 = await add('Account Assistant', { maxGradeId: grade('G6') });
    });

    it('gives an employment its own grade within the range, shown on the profile, in the history and the directory', async () => {
      const e = await addHired('Graded', { jobTitleId: ranged, gradeId: grade('G4') });
      const G4 = { id: grade('G4'), code: 'G4', rank: 4, levelEn: 'Senior', levelAr: null };
      expect(e.employment).toMatchObject({ jobTitleId: ranged, gradeId: grade('G4'), grade: G4 });
      expect(e.employments[0]).toMatchObject({ gradeId: grade('G4'), grade: G4 });
      expect((await listed(e.id))?.employment).toMatchObject({ jobTitle: { id: ranged, titleEn: 'Account Manager' }, gradeId: grade('G4'), grade: G4 });

      // both ends are in the range
      const top = await changeEmployment(e.id, e.employment.id, { gradeId: grade('G6') }).expect(200);
      expect(top.body.employment).toMatchObject({ gradeId: grade('G6'), grade: { code: 'G6' } });
      await changeEmployment(e.id, e.employment.id, { gradeId: grade('G3') }).expect(200);
      const cleared = await changeEmployment(e.id, e.employment.id, { gradeId: '' }).expect(200);
      expect(cleared.body.employment).toMatchObject({ gradeId: null, grade: null });

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'employment', entityId: e.employment.id }, orderBy: { id: 'asc' } });
      expect(audit[0].diff).toMatchObject({ jobTitleId: ranged, gradeId: grade('G4') });
      expect(audit.slice(1).map((a) => a.diff)).toEqual([
        { employeeId: e.id, gradeId: { from: grade('G4'), to: grade('G6') } },
        { employeeId: e.id, gradeId: { from: grade('G6'), to: grade('G3') } },
        { employeeId: e.id, gradeId: { from: grade('G3'), to: null } },
      ]);
    });

    it('refuses a grade outside the job title’s range, naming the range', async () => {
      const e = await addEmployee('Outside');
      const below = await startEmployment(e.id, job({ jobTitleId: ranged, gradeId: grade('G2') })).expect(400);
      expect(below.body.message).toBe('Account Manager takes grades G3 to G6. Choose a grade in that range.');
      const above = await startEmployment(e.id, job({ jobTitleId: ranged, gradeId: grade('G7') })).expect(400);
      expect(above.body.message).toBe('Account Manager takes grades G3 to G6. Choose a grade in that range.');
      const from = await startEmployment(e.id, job({ jobTitleId: fromG3, gradeId: grade('G2') })).expect(400);
      expect(from.body.message).toBe('Account Lead takes grades from G3. Choose a grade in that range.');
      const upTo = await startEmployment(e.id, job({ jobTitleId: upToG6, gradeId: grade('G7') })).expect(400);
      expect(upTo.body.message).toBe('Account Assistant takes grades up to G6. Choose a grade in that range.');
      const unknown = await startEmployment(e.id, job({ jobTitleId: ranged, gradeId: NOWHERE })).expect(400);
      expect(unknown.body.message).toBe('Grade not found. Choose one from the list.');
      const notAnId = await startEmployment(e.id, job({ gradeId: 'G4' })).expect(400);
      expect(notAnId.body.message).toEqual(['Choose a grade.']);
      expect(await prisma.employment.count({ where: { employeeId: e.id } })).toBe(0);

      // the open ends take any grade on their side (G8: G9 is C-level, which HR alone doesn't give, 19 October 2026)
      expect((await hire(e.id, { jobTitleId: fromG3, gradeId: grade('G8') })).employment).toMatchObject({ grade: { code: 'G8' } });
      const other = await addHired('Assistant', { jobTitleId: upToG6, gradeId: grade('G1') });
      expect(other.employment).toMatchObject({ grade: { code: 'G1' } });
    });

    it('takes any grade under a job title with no range, or with no job title', async () => {
      const any = await addHired('Any Grade', { jobTitleId, gradeId: grade('G8') }); // Frontend Developer: no range
      expect(any.employment).toMatchObject({ jobTitleId, grade: { code: 'G8' } });
      const none = await addHired('No Title', { gradeId: grade('G1') });
      expect(none.employment).toMatchObject({ jobTitleId: null, gradeId: grade('G1'), grade: { code: 'G1' } });
    });

    it('refuses a change of job title, or of grade, that leaves the grade outside the range', async () => {
      const e = await addHired('Promoted', { jobTitleId, gradeId: grade('G2') });
      const moved = await changeEmployment(e.id, e.employment.id, { jobTitleId: ranged }).expect(400);
      expect(moved.body.message).toBe('Account Manager takes grades G3 to G6. Choose a grade in that range.');
      const promoted = await changeEmployment(e.id, e.employment.id, { jobTitleId: ranged, gradeId: grade('G3') }).expect(200);
      expect(promoted.body.employment).toMatchObject({ jobTitleId: ranged, grade: { code: 'G3' } });
      const tooHigh = await changeEmployment(e.id, e.employment.id, { gradeId: grade('G7') }).expect(400);
      expect(tooHigh.body.message).toBe('Account Manager takes grades G3 to G6. Choose a grade in that range.');
      // other changes, with the job title and grade sent as they are, go through
      await changeEmployment(e.id, e.employment.id, { jobTitleId: ranged, gradeId: grade('G3'), status: 'active' }).expect(200);
      expect((await profileOf(e.id)).employment).toMatchObject({ status: 'active', jobTitleId: ranged, grade: { code: 'G3' } });
    });
  });

  describe('what the history keeps', () => {
    it('will not delete a department, team, job title or shift that a current or past employment uses', async () => {
      const remove = (path: string) => api().delete(path).set('Cookie', superAdmin);
      const shift = (
        await api()
          .post('/api/shifts')
          .set('Cookie', hr)
          .send({ code: `T${RUN.slice(-6)}`.toUpperCase(), startTime: '08:00', endTime: '16:00' })
          .expect(201)
      ).body as { id: string; code: string };
      const ops = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Ops ${RUN}` }).expect(201);
      const support = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Support', parentId: ops.body.id }).expect(201);
      const agent = await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId: support.body.id, titleEn: 'Support Agent' }).expect(201);
      const field = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Field ${RUN}` }).expect(201);

      const placed = await addHired('Placed', { jobTitleId: agent.body.id, shiftId: shift.id });
      expect(placed.employment).toMatchObject({ departmentId: support.body.id, shift: { id: shift.id, code: shift.code, startTime: '08:00', endTime: '16:00' } });
      const loose = await addHired('In Field', { departmentId: field.body.id }); // a department, without a job title

      // used now
      expect((await remove(`/api/job-titles/${agent.body.id}`).expect(409)).body.message).toBe(
        '1 employee(s) have this job title. Give them another one before deleting it.',
      );
      expect((await remove(`/api/shifts/${shift.id}`).expect(409)).body.message).toBe(
        `1 employee(s) work shift ${shift.code}. Move them to another shift before deleting it.`,
      );
      expect((await remove(`/api/departments/${field.body.id}`).expect(409)).body.message).toBe(
        '1 employee(s) work in this department. Move them before deleting the department.',
      );

      // used before: the employments ended, and stay in the history
      await endEmployment(placed.id, placed.employment.id, { endDate: '2026-03-31', endReason: 'resigned' }).expect(200);
      await endEmployment(loose.id, loose.employment.id, { endDate: '2026-03-31', endReason: 'terminated' }).expect(200);
      expect((await remove(`/api/job-titles/${agent.body.id}`).expect(409)).body.message).toBe(
        'This job title is in the history of 1 past employment(s), so it is kept.',
      );
      expect((await remove(`/api/shifts/${shift.id}`).expect(409)).body.message).toBe(`Shift ${shift.code} is in the history of 1 past employment(s), so it is kept.`);
      expect((await remove(`/api/departments/${field.body.id}`).expect(409)).body.message).toBe(
        'This department is in the history of 1 past employment(s), so it is kept.',
      );

      // with the job title taken off the past employment, the job title can go; its team stays in the history
      const untitled = await changeEmployment(placed.id, placed.employment.id, { jobTitleId: null }).expect(200);
      expect(untitled.body.employments[0]).toMatchObject({ jobTitleId: null, departmentId: support.body.id, status: 'resigned' });
      await remove(`/api/job-titles/${agent.body.id}`).expect(204);
      expect((await remove(`/api/departments/${support.body.id}`).expect(409)).body.message).toBe(
        'This department is in the history of 1 past employment(s), so it is kept.',
      );

      // without the history, they can all go
      await deleteEmployment(placed.id, placed.employment.id).expect(204);
      await deleteEmployment(loose.id, loose.employment.id).expect(204);
      await remove(`/api/shifts/${shift.id}`).expect(204);
      await remove(`/api/departments/${support.body.id}`).expect(204);
      await remove(`/api/departments/${ops.body.id}`).expect(204);
      await remove(`/api/departments/${field.body.id}`).expect(204);
    });

    it('keeps the profile of the manager on record of past employments', async () => {
      const boss = await addHired('Past Boss');
      const member = await addHired('Past Member', { managerId: boss.id });
      const now = await api().delete(`/api/employees/${boss.id}`).set('Cookie', superAdmin).expect(409);
      expect(now.body.message).toBe(`1 employee(s) report to Past Boss ${RUN}. Choose another manager for them before deleting.`);

      await endEmployment(member.id, member.employment.id, { endDate: '2026-03-31', endReason: 'resigned' }).expect(200);
      const before = await api().delete(`/api/employees/${boss.id}`).set('Cookie', superAdmin).expect(409);
      expect(before.body.message).toBe(`Past Boss ${RUN} is the manager on record of 1 past employment(s), so the profile is kept.`);
      expect((await profileOf(member.id)).employments[0].manager).toEqual({ id: boss.id, employeeCode: boss.employeeCode, fullNameEn: `Past Boss ${RUN}` });
      expect((await profileOf(boss.id)).reports).toEqual([]);

      // once that history is gone (here with the member's profile), the profile can be deleted with its own employments
      await api().delete(`/api/employees/${member.id}`).set('Cookie', superAdmin).expect(204);
      await api().delete(`/api/employees/${boss.id}`).set('Cookie', superAdmin).expect(204);
      expect(await prisma.employment.count({ where: { employeeId: boss.id } })).toBe(0);
    });
  });

  describe('adding with the national ID (e.g. read from the ID card)', () => {
    const named = (name: string) => prisma.employee.count({ where: { fullNameEn: `${name} ${RUN}` } });

    it('saves the national ID with the employee, fills in the date of birth, and audits without the numbers', async () => {
      const nationalId = newNationalId();
      const e = await addEmployee('Card Holder', {
        identity: { nationalId: arabicDigits(nationalId), printedNo: 'AB123456', issueDate: '2024-05-01', expiryDate: '2031-05-01' },
      });
      expect(e.dateOfBirth).toBe('1995-03-12'); // filled in from the ID
      expect(e.identity).toEqual({
        nationalIdMasked: `•••• ${nationalId.slice(-4)}`,
        printedNoMasked: '•••• 3456',
        issueDate: '2024-05-01',
        expiryDate: '2031-05-01',
      });
      expect(JSON.stringify(e)).not.toContain(nationalId);

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'employee', entityId: e.id }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['create']);
      expect(audit[0].diff).toMatchObject({
        fullNameEn: `Card Holder ${RUN}`,
        dateOfBirth: '1995-03-12',
        identity: {
          nationalId: 'changed',
          printedNo: 'changed',
          issueDate: { from: null, to: '2024-05-01' },
          expiryDate: { from: null, to: '2031-05-01' },
        },
      });
      expect(JSON.stringify(audit[0].diff)).not.toContain(nationalId);
      expect(JSON.stringify(audit[0].diff)).not.toContain('AB123456');

      const full = await api().get(`/api/employees/${e.id}/identity`).set('Cookie', hr).expect(200);
      expect(full.body).toEqual({ nationalId, printedNo: 'AB123456', issueDate: '2024-05-01', expiryDate: '2031-05-01' });
    });

    it('checks everything before adding anyone: the date of birth, a real date in the ID, a national ID already used', async () => {
      const nationalId = newNationalId();
      const mismatch = await api()
        .post('/api/employees')
        .set('Cookie', hr)
        .send(person('Wrong Birthday', { dateOfBirth: '1995-03-13', identity: { nationalId } }))
        .expect(400);
      expect(mismatch.body.message).toBe('The national ID gives a birth date of 1995-03-12, but the profile says 1995-03-13. Check both.');
      await api().post('/api/employees').set('Cookie', hr).send(person('No Real Date', { identity: { nationalId: '29502301234567' } })).expect(400); // 30 Feb
      const dates = await api()
        .post('/api/employees')
        .set('Cookie', hr)
        .send(person('Expired First', { identity: { issueDate: '2024-05-01', expiryDate: '2024-05-01' } }))
        .expect(400);
      expect(dates.body.message).toBe('The ID must expire after it was issued.');
      expect(await named('Wrong Birthday')).toBe(0);
      expect(await named('No Real Date')).toBe(0);
      expect(await named('Expired First')).toBe(0);

      const owner = await addEmployee('ID Owner', { dateOfBirth: '1995-03-12', identity: { nationalId } }); // a matching date is fine
      const dup = await api().post('/api/employees').set('Cookie', hr).send(person('ID Copy', { identity: { nationalId } })).expect(409);
      expect(dup.body.message).toBe(`Another employee (${owner.employeeCode}) already has this national ID.`);
      expect(await named('ID Copy')).toBe(0);
    });

    it('checks the national ID details like the identity form, and refuses fields it does not know', async () => {
      const post = (name: string, identity: unknown) => api().post('/api/employees').set('Cookie', hr).send(person(name, { identity }));
      const short = await post('Short ID', { nationalId: '2950312' }).expect(400);
      expect(short.body.message).toEqual(['The national ID must be 14 digits, starting with 2 or 3.']);
      const unknown = await post('Extra Field', { nationalId: newNationalId(), religion: 'x' }).expect(400);
      expect(unknown.body.message).toEqual(['property religion should not exist']);
      await post('Bad Date', { issueDate: '2024-02-30' }).expect(400);
      await post('Not An Object', 'x').expect(400);
      await post('A List', [{ nationalId: newNationalId() }]).expect(400);
      expect(await named('Extra Field')).toBe(0);
    });

    it('adds no national ID when none is filled in', async () => {
      for (const identity of [{}, { nationalId: null, printedNo: ' ', expiryDate: '' }, null]) {
        const e = await addEmployee('No Card', { identity });
        expect(e).toMatchObject({ identity: null, dateOfBirth: null });
        expect(await prisma.employeeIdentity.count({ where: { employeeId: e.id } })).toBe(0);
        const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'employee', entityId: e.id, action: 'create' } });
        expect(audit.diff).not.toHaveProperty('identity');
      }
    });
  });

  it('keeps a second mobile number and the city', async () => {
    const e = await addEmployee('Two Phones', { mobile: '010 1111 2222', mobile2: '+20 122 333 4444', city: ' مدينة نصر ' });
    expect(e).toMatchObject({ mobile: '+201011112222', mobile2: '+201223334444', city: 'مدينة نصر' });
    await api().patch(`/api/employees/${e.id}`).set('Cookie', hr).send({ mobile2: 'not a phone' }).expect(400);
    const cleared = await api().patch(`/api/employees/${e.id}`).set('Cookie', hr).send({ mobile2: '', city: '' }).expect(200);
    expect(cleared.body).toMatchObject({ mobile2: null, city: null });
  });

  it('keeps a display name for the email signature, apart from the full names', async () => {
    const e = await addEmployee('Hazem Magdy Soliman', { displayName: '  Hazem Magdy ' });
    expect(e).toMatchObject({ displayName: 'Hazem Magdy', fullNameEn: `Hazem Magdy Soliman ${RUN}` });
    await api().patch(`/api/employees/${e.id}`).set('Cookie', hr).send({ displayName: 'x'.repeat(81) }).expect(400);
    const cleared = await api().patch(`/api/employees/${e.id}`).set('Cookie', hr).send({ displayName: '' }).expect(200);
    expect(cleared.body.displayName).toBeNull();
  });

  it('keeps the social insurance number as digits, and no two people share one', async () => {
    const no = String(Date.now()).slice(-9);
    const e = await addEmployee('Insured One', { insuranceNo: `${no.slice(0, 4)} ${no.slice(4)}` });
    expect(e.insuranceNo).toBe(no);
    const arabic = no.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
    const other = await addEmployee('Insured Two');
    const taken = await api().patch(`/api/employees/${other.id}`).set('Cookie', hr).send({ insuranceNo: arabic }).expect(409);
    expect(taken.body.message).toBe(`The social insurance number ${no} already belongs to ${e.employeeCode}.`);
    for (const bad of ['12a456', '12345', '123456789012345']) {
      const res = await api().patch(`/api/employees/${other.id}`).set('Cookie', hr).send({ insuranceNo: bad }).expect(400);
      expect(res.body.message).toEqual(['Enter the social insurance number as digits only (6 to 14 of them).']);
    }
    // saving the profile again with its own number is not a clash
    await api().patch(`/api/employees/${e.id}`).set('Cookie', hr).send({ insuranceNo: no, nationality: 'Egyptian' }).expect(200);
    const cleared = await api().patch(`/api/employees/${e.id}`).set('Cookie', hr).send({ insuranceNo: '' }).expect(200);
    expect(cleared.body.insuranceNo).toBeNull();
  });

  describe('mobile numbers, kept as Prime ERP keeps them', () => {
    const change = (id: string, body: object) => api().patch(`/api/employees/${id}`).set('Cookie', hr).send(body);

    it('keeps the country code and the number in one run, however they were typed', async () => {
      const e = await addEmployee('Phones', { mobile: '010 1234-5678', mobile2: '0020 122 333 4444', emergencyMobile: '(011) 5555-6666' });
      expect(e).toMatchObject({ mobile: '+201012345678', mobile2: '+201223334444', emergencyMobile: '+201155556666' });

      const changed = await change(e.id, { mobile: '+20 100 000 1111', mobile2: '+44 20 7946 0958', emergencyMobile: '٠١٢٣٤٥٦٧٨٩٠' }).expect(200);
      expect(changed.body).toMatchObject({ mobile: '+201000001111', mobile2: '+442079460958', emergencyMobile: '+201234567890' });

      // the same number written another way is no change
      await change(e.id, { mobile: '0100 000 1111' }).expect(200);
      expect(await prisma.auditLog.count({ where: { entityType: 'employee', entityId: e.id, action: 'update' } })).toBe(1);
    });

    it('refuses a number that cannot be dialled, saying which one', async () => {
      const e = await addEmployee('Bad Phones', { mobile: '01012345678' });
      const mobile = ['Enter the mobile number with its country code, e.g. +201012345678.'];
      expect((await change(e.id, { mobile: '010 1234' }).expect(400)).body.message).toEqual(mobile); // too short for Egypt
      expect((await change(e.id, { mobile: '010 1234 56789' }).expect(400)).body.message).toEqual(mobile); // too long for Egypt
      const unknown = await change(e.id, { mobile2: '+999 1234 5678' }).expect(400); // no such country code
      expect(unknown.body.message).toEqual(['Enter the second mobile number with its country code, e.g. +201012345678.']);
      const words = await change(e.id, { emergencyMobile: 'not a phone' }).expect(400);
      expect(words.body.message).toEqual(['Enter the emergency contact’s mobile with its country code, e.g. +201012345678.']);
      expect((await profileOf(e.id)).mobile).toBe('+201012345678');
    });
  });

  describe('the work email and the company’s email domain', () => {
    const post = (name: string, workEmail: string) => api().post('/api/employees').set('Cookie', hr).send(person(name, { workEmail }));
    const change = (id: string, body: object) => api().patch(`/api/employees/${id}`).set('Cookie', hr).send(body);

    beforeEach(() => setEmailDomain('trendlix.com'));
    afterAll(() => setEmailDomain(''));

    it('refuses a new employee’s work email on another domain, and accepts one on the company’s', async () => {
      for (const workEmail of [`off.${RUN}@gmail.com`, `off.${RUN}@nottrendlix.com`, `off.${RUN}@mail.trendlix.com`]) {
        const res = await post('Off Domain', workEmail).expect(400);
        expect(res.body.message).toBe('The work email must end in @trendlix.com.');
      }
      expect(await prisma.employee.count({ where: { fullNameEn: `Off Domain ${RUN}` } })).toBe(0);

      const on = await addEmployee('On Domain', { workEmail: ` On.${RUN}@TrendLIX.com ` });
      expect(on.workEmail).toBe(`on.${RUN}@trendlix.com`);
      await addEmployee('No Work Email'); // none at all is fine
    });

    it('refuses changing a work email to another domain', async () => {
      const e = await addEmployee('Moving Email', { workEmail: `moving.${RUN}@trendlix.com` });
      const res = await change(e.id, { workEmail: `moving.${RUN}@gmail.com` }).expect(400);
      expect(res.body.message).toBe('The work email must end in @trendlix.com.');
      expect((await profileOf(e.id)).workEmail).toBe(`moving.${RUN}@trendlix.com`);

      const moved = await change(e.id, { workEmail: `moved.${RUN}@trendlix.com` }).expect(200);
      expect(moved.body.workEmail).toBe(`moved.${RUN}@trendlix.com`);
    });

    it('lets a work email on file from before the domain was set stay, without blocking other changes', async () => {
      await setEmailDomain('');
      const e = await addEmployee('Old Email', { workEmail: `old.${RUN}@gmail.com` });
      await setEmailDomain('trendlix.com');

      // sent again unchanged, as the profile form does, with another field
      const saved = await change(e.id, { nationality: 'Egyptian', workEmail: ` OLD.${RUN}@gmail.com ` }).expect(200);
      expect(saved.body).toMatchObject({ nationality: 'Egyptian', workEmail: `old.${RUN}@gmail.com` });
      await change(e.id, { workEmail: `older.${RUN}@gmail.com` }).expect(400); // a new one must use the domain
    });

    it('checks nothing while the company has no email domain', async () => {
      await setEmailDomain('');
      const e = await addEmployee('Any Domain', { workEmail: `any.${RUN}@example.org` });
      expect(e.workEmail).toBe(`any.${RUN}@example.org`);
      await change(e.id, { workEmail: `any.${RUN}@example.net` }).expect(200);
    });
  });

  describe('the issuing office (not on Egyptian ID cards)', () => {
    it('is neither accepted nor shown, and one typed in before stays in the database', async () => {
      const e = await addEmployee('Old Office', { identity: { expiryDate: '2031-05-01' } });
      await prisma.employeeIdentity.update({ where: { employeeId: e.id }, data: { issuingOffice: 'Nasr City' } }); // typed in before

      const sent = await api().post('/api/employees').set('Cookie', hr).send(person('New Office', { identity: { issuingOffice: 'Nasr City' } })).expect(400);
      expect(sent.body.message).toEqual(['property issuingOffice should not exist']);
      expect(await prisma.employee.count({ where: { fullNameEn: `New Office ${RUN}` } })).toBe(0);
      const changed = await api().patch(`/api/employees/${e.id}/identity`).set('Cookie', hr).send({ issuingOffice: 'Heliopolis' }).expect(400);
      expect(changed.body.message).toEqual(['property issuingOffice should not exist']);

      const saved = await api().patch(`/api/employees/${e.id}/identity`).set('Cookie', hr).send({ printedNo: 'AB123456' }).expect(200);
      expect(saved.body).toEqual({ nationalIdMasked: null, printedNoMasked: '•••• 3456', issueDate: null, expiryDate: '2031-05-01' });
      expect((await profileOf(e.id)).identity).toEqual(saved.body);
      const full = await api().get(`/api/employees/${e.id}/identity`).set('Cookie', hr).expect(200);
      expect(full.body).toEqual({ nationalId: null, printedNo: 'AB123456', issueDate: null, expiryDate: '2031-05-01' });

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'employee', entityId: e.id, action: 'update' } });
      expect(audit.diff).toEqual({ identity: { printedNo: 'changed' } });
      const row = await prisma.employeeIdentity.findUniqueOrThrow({ where: { employeeId: e.id } });
      expect(row.issuingOffice).toBe('Nasr City');
    });
  });

  describe('who sees whom', () => {
    let managerSession: string;
    let staffSession: string;
    let manager: Hired;
    let report: Hired;
    let outsider: Hired;

    beforeAll(async () => {
      const managerEmail = await createUser(prisma, ['manager', 'employee']);
      const staffEmail = await createUser(prisma, ['employee']);
      manager = await addHired('Team Lead', {}, { workEmail: managerEmail });
      report = await addHired('Team Member', { managerId: manager.id }, { workEmail: staffEmail });
      outsider = await addHired('Outsider');
      managerSession = await signIn(app, managerEmail);
      staffSession = await signIn(app, staffEmail);
    });

    it('a manager sees themself and the people who report to them now', async () => {
      const list = await api().get('/api/employees').set('Cookie', managerSession).expect(200);
      expect(list.body.map((e: { id: string }) => e.id).sort()).toEqual([manager.id, report.id].sort());
      await api().get(`/api/employees/${report.id}`).set('Cookie', managerSession).expect(200);
      await api().get(`/api/employees/${outsider.id}`).set('Cookie', managerSession).expect(404);
      expect((await profileOf(manager.id, managerSession)).reports.map((r) => r.id)).toEqual([report.id]);
    });

    it('a manager’s team follows current employments: someone whose employment ended is no longer theirs', async () => {
      const leaver = await addHired('Leaving Member', { managerId: manager.id });
      await api().get(`/api/employees/${leaver.id}`).set('Cookie', managerSession).expect(200);

      await endEmployment(leaver.id, leaver.employment.id, { endDate: '2026-04-30', endReason: 'resigned' }).expect(200);
      await api().get(`/api/employees/${leaver.id}`).set('Cookie', managerSession).expect(404);
      const list = await api().get('/api/employees').set('Cookie', managerSession).expect(200);
      expect(list.body.map((e: { id: string }) => e.id).sort()).toEqual([manager.id, report.id].sort());
      expect((await profileOf(manager.id, managerSession)).reports.map((r) => r.id)).toEqual([report.id]);

      // hired again under someone else: still not theirs; HR still sees who managed them before
      await hire(leaver.id, { joinDate: '2026-06-01', managerId: outsider.id });
      await api().get(`/api/employees/${leaver.id}`).set('Cookie', managerSession).expect(404);
      const history = (await profileOf(leaver.id)).employments;
      expect(history.map((x) => (x.manager as { id: string }).id)).toEqual([outsider.id, manager.id]);
    });

    it('an employee sees only themself, without restricted sections', async () => {
      const list = await api().get('/api/employees').set('Cookie', staffSession).expect(200);
      expect(list.body.map((e: { id: string }) => e.id)).toEqual([report.id]);
      const own = await api().get(`/api/employees/${report.id}`).set('Cookie', staffSession).expect(200);
      expect(own.body.access).toEqual({ edit: false, delete: false, identity: false, bank: false });
      expect(own.body).not.toHaveProperty('identity');
      expect(own.body).not.toHaveProperty('bank');
      expect(own.body.employment).toMatchObject({ id: report.employment.id, manager: { id: manager.id } });
      await api().get(`/api/employees/${manager.id}`).set('Cookie', staffSession).expect(404);
      await api().get(`/api/employees/${report.id}/identity`).set('Cookie', staffSession).expect(403);
    });

    it('Finance sees everyone, with bank but not the national ID', async () => {
      const list = await api().get('/api/employees').set('Cookie', finance).expect(200);
      expect(list.body.length).toBeGreaterThanOrEqual(3);
      const profile = await api().get(`/api/employees/${outsider.id}`).set('Cookie', finance).expect(200);
      expect(profile.body).toHaveProperty('bank');
      expect(profile.body).not.toHaveProperty('identity');
      await api().get(`/api/employees/${outsider.id}/identity`).set('Cookie', finance).expect(403);
    });
  });

  describe('completeness', () => {
    const missing = (p: Profile) => p.completeness.missing.map((m) => m.key);
    const onTab = (p: Profile, tab: string) => p.completeness.missing.filter((m) => m.tab === tab);
    const change = async (id: string, body: object) => (await api().patch(`/api/employees/${id}`).set('Cookie', hr).send(body).expect(200)).body as Profile;
    const changed = async (p: Hired, body: object, session = hr) => (await changeEmployment(p.id, p.employment.id, body, session).expect(200)).body as Hired;
    const addPaper = (id: string, kind: string) =>
      api().post(`/api/employees/${id}/paperwork`).set('Cookie', hr).field('kind', kind).attach('file', PNG, `${kind}.png`).expect(201);

    /**
     * Everything a profile with only the names lacks before any hire, in the order listed: all the data and scans but
     * the emergency contact and the second mobile (owner's decision, 15 October 2026).
     */
    const BEFORE_HIRE = [
      'displayName',
      'dateOfBirth',
      'gender',
      'nationality',
      'maritalStatus',
      'militaryStatus',
      'insuranceNo', // on every file (owner, 15 October 2026)
      'personalEmail',
      'mobile',
      'city',
      'governorate',
      'addressAr',
      'nationalId',
      'printedNo',
      'idIssueDate',
      'idExpiry',
      'bankName',
      'accountNo',
      'iban',
      'holderName',
      'degree',
      'university',
      'faculty',
      'major',
      'graduationYear',
      'educationGrade',
      'qualificationAr',
      'national_id',
      // not employed yet: the papers of a full-time hire, collected before the start date
      'qualification_certificate',
      'birth_certificate',
      'military_certificate',
      'criminal_record',
      'insurance_print',
      'personal_photo',
    ];
    /** Never on the checklist, filled in or not. */
    const NEVER = ['emergency', 'emergencyName', 'emergencyRelation', 'emergencyMobile', 'mobile2', 'employeeCode', 'workArrangement', 'probationEnd', 'jdAcknowledgedAt'];

    it('counts the fields and the papers the file needs, says on which tab each missing one goes, and rises as they are added', async () => {
      // before any hire: 29 fields and a full-time hire's 7 papers (the national ID once for both sides), of which the names are there
      const e = await addEmployee('Incomplete');
      expect(e.completeness.percent).toBe(6); // 2 of 36
      expect(e.completeness.missing).toHaveLength(34);
      expect(e.completeness.missing).toEqual(
        expect.arrayContaining([
          { key: 'dateOfBirth', label: 'Date of birth', tab: 'basic' },
          { key: 'iban', label: 'IBAN', tab: 'basic' },
          { key: 'degree', label: 'Degree', tab: 'education' },
          { key: 'national_id', label: 'National ID scan (front and back)', tab: 'documents' }, // one paper, both sides
        ]),
      );
      expect(missing(e)).not.toContain('fullNameEn');
      expect(missing(e)).toContain('criminal_record'); // a full-time hire's papers are collected before the start date
      expect(missing(e)).toContain('insuranceNo'); // on every file
      expect(missing(e)).toContain('insurance_print');

      // hired full time: the work email, the five employment items and the full list of papers, the military
      // certificate too while the gender is not recorded
      const hired = await hire(e.id);
      expect(hired.completeness.percent).toBe(5); // 2 of 42
      expect(missing(hired)).toEqual(expect.arrayContaining(['insuranceNo', 'workEmail', 'team', 'military_certificate', 'criminal_record', 'personal_photo']));
      // generated from templates, not scans HR collects
      expect(missing(hired)).not.toContain('bank_letter');
      expect(missing(hired)).not.toContain('insurance_form_1');

      const man = await change(e.id, { gender: 'male' });
      expect(man.completeness.percent).toBe(7); // 3 of 42
      expect(missing(man)).toContain('military_certificate');

      // a woman's file needs no military certificate, and her military status is Not applicable
      const woman = await change(e.id, { gender: 'female' });
      expect(woman.completeness.percent).toBe(10); // 4 of 41
      expect(missing(woman)).not.toContain('military_certificate');
      expect(missing(woman)).not.toContain('militaryStatus');

      const filled = await change(e.id, { nationality: 'Egyptian', mobile: '01012345678', degree: 'bachelor', university: 'Cairo University', graduationYear: 2018 });
      expect(filled.completeness.percent).toBe(22); // 9 of 41

      await addPaper(e.id, 'personal_photo');
      const papered = await profileOf(e.id);
      expect(papered.completeness.percent).toBe(24); // 10 of 41
      expect(missing(papered)).not.toContain('personal_photo');

      // the national ID number (with the date of birth it holds) and its expiry
      await api().patch(`/api/employees/${e.id}/identity`).set('Cookie', hr).send({ nationalId: newNationalId(), expiryDate: '2031-05-01' }).expect(200);
      const identified = await profileOf(e.id);
      expect(identified.completeness.percent).toBe(32); // 13 of 41
      expect(identified.dateOfBirth).toBe('1995-03-12');
      expect(missing(identified)).not.toContain('dateOfBirth');
      expect(missing(identified)).not.toContain('nationalId');
      expect(missing(identified)).not.toContain('idExpiry');
    });

    it('not employed: every field and scan but the emergency contact and the second mobile, the social insurance number too; no employment items or work email', async () => {
      const e = await addEmployee('Unhired', { emergencyName: 'Sara', emergencyRelation: 'Sister', emergencyMobile: '01098765432', mobile2: '01011112222' });
      expect(missing(e)).toEqual(BEFORE_HIRE);
      expect(e.completeness.percent).toBe(6); // 2 of 36: the emergency contact and the second mobile add nothing
      expect(onTab(e, 'employment')).toEqual([]);
      expect(missing(e)).toContain('insuranceNo');
      expect(missing(e)).not.toContain('workEmail');
      expect(e.completeness.missing).toEqual(
        expect.arrayContaining([
          { key: 'displayName', label: 'Display name', tab: 'basic' },
          { key: 'personalEmail', label: 'Personal email', tab: 'basic' },
          { key: 'city', label: 'City', tab: 'basic' },
          { key: 'printedNo', label: 'National ID printed number', tab: 'basic' },
          { key: 'idIssueDate', label: 'National ID issue date', tab: 'basic' },
          { key: 'idExpiry', label: 'National ID expiry date', tab: 'basic' },
          { key: 'bankName', label: 'Bank', tab: 'basic' },
          { key: 'accountNo', label: 'Account number', tab: 'basic' },
          { key: 'holderName', label: 'Account holder', tab: 'basic' },
          { key: 'university', label: 'University', tab: 'education' },
          { key: 'faculty', label: 'Faculty', tab: 'education' },
          { key: 'major', label: 'Major', tab: 'education' },
          { key: 'educationGrade', label: 'Education grade', tab: 'education' },
        ]),
      );

      // emptying the emergency contact and the second mobile changes nothing either
      const emptied = await change(e.id, { emergencyName: null, emergencyRelation: null, emergencyMobile: null, mobile2: null });
      expect(emptied.completeness.percent).toBe(6); // still 2 of 36
      expect(missing(emptied)).toEqual(BEFORE_HIRE);
      for (const key of NEVER) expect(missing(emptied)).not.toContain(key);

      // the bank details count each on their own; only whether they are there is read, never the values
      await api().patch(`/api/employees/${e.id}/bank`).set('Cookie', hr).send({ bankName: 'CIB', accountNo: '1001 2345 6789' }).expect(200);
      const banked = await profileOf(e.id);
      expect(banked.completeness.percent).toBe(11); // 4 of 36
      expect(missing(banked)).toEqual(expect.arrayContaining(['iban', 'holderName']));
      expect(JSON.stringify(banked.completeness)).not.toContain('100123456789');
    });

    it('hired: the employment items and the work email (full time: the full list of papers; part time: the national ID only); none once it ends', async () => {
      const e = await addEmployee('Employed');
      const hired = await hire(e.id);
      expect(hired.completeness.percent).toBe(5); // 2 of 42
      expect(onTab(hired, 'employment')).toEqual([
        { key: 'team', label: 'Department or team', tab: 'employment' },
        { key: 'jobTitle', label: 'Job title', tab: 'employment' },
        { key: 'grade', label: 'Grade', tab: 'employment' },
        { key: 'shift', label: 'Shift', tab: 'employment' },
        { key: 'manager', label: 'Direct manager', tab: 'employment' },
      ]);
      expect(hired.completeness.missing).toEqual(
        expect.arrayContaining([
          { key: 'insuranceNo', label: 'Social insurance number', tab: 'basic' },
          { key: 'workEmail', label: 'Work email', tab: 'basic' },
        ]),
      );
      for (const key of NEVER) expect(missing(hired)).not.toContain(key);

      // the job title places them in its team; with a shift, three of the five are there
      const shifts = (await api().get('/api/shifts').set('Cookie', hr).expect(200)).body as { id: string }[];
      const placed = await changed(hired, { jobTitleId, shiftId: shifts[0].id });
      expect(placed.completeness.percent).toBe(12); // 5 of 42
      expect(onTab(placed, 'employment').map((m) => m.key)).toEqual(['grade', 'manager']);

      const emailed = await change(e.id, { workEmail: `employed.${RUN}@test.local` });
      expect(emailed.completeness.percent).toBe(14); // 6 of 42
      expect(missing(emailed)).not.toContain('workEmail');

      // part time: only the national ID scan; the social insurance number still counts, as on every file
      const partTime = await changed(hired, { employmentType: 'part_time' });
      expect(partTime.completeness.percent).toBe(17); // 6 of 36
      expect(missing(partTime)).toContain('insuranceNo');
      expect(missing(partTime)).not.toContain('insurance_print');
      expect(missing(partTime)).toEqual(expect.arrayContaining(['grade', 'manager']));

      // ended: the checklist of someone not employed, the work email on file no longer counting, and the papers of
      // their last employment (part time: the national ID only), not a new full-time hire's
      const ended = (await endEmployment(e.id, hired.employment.id, { endDate: '2026-06-30', endReason: 'resigned' }).expect(200)).body as Profile;
      expect(ended.completeness.percent).toBe(7); // 2 of 30
      const fullTimeOnly = ['qualification_certificate', 'birth_certificate', 'military_certificate', 'criminal_record', 'insurance_print', 'personal_photo'];
      expect(missing(ended)).toEqual(BEFORE_HIRE.filter((key) => !fullTimeOnly.includes(key)));
    });

    it('a high school degree needs no university, faculty or major', async () => {
      const e = await addEmployee('School', { degree: 'high_school' });
      expect(e.completeness.percent).toBe(9); // 3 of 33
      expect(onTab(e, 'education').map((m) => m.key)).toEqual(['graduationYear', 'educationGrade', 'qualificationAr']);

      const bachelor = await change(e.id, { degree: 'bachelor' });
      expect(bachelor.completeness.percent).toBe(8); // 3 of 36
      expect(onTab(bachelor, 'education').map((m) => m.key)).toEqual(['university', 'faculty', 'major', 'graduationYear', 'educationGrade', 'qualificationAr']);
    });

    it('the top grade (the CEO) needs no direct manager; a lower grade does', async () => {
      const grades = (await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; rank: number }[];
      const top = grades.reduce((a, b) => (b.rank > a.rank ? b : a)); // G9 Executive, unless a higher rank was added
      const boss = await addEmployee('Board');
      // the names, these ten fields and the grade are there
      const basics = {
        displayName: 'Chief',
        gender: 'male',
        nationality: 'Egyptian',
        maritalStatus: 'married',
        militaryStatus: 'completed',
        personalEmail: 'chief@example.com',
        mobile: '01012345678',
        city: 'مدينة نصر',
        governorate: 'Cairo',
        addressAr: '١ شارع التحرير',
      };
      // the top grade is C-level (owner, 19 October 2026): given and changed by HR with Super Admin, who sees C-level people
      const ceo = await addHired('Chief', { gradeId: top.id }, basics, hrSuper);
      expect(ceo.completeness.percent).toBe(32); // 13 of 41
      expect(onTab(ceo, 'employment').map((m) => m.key)).toEqual(['team', 'jobTitle', 'shift']);

      const lower = await changed(ceo, { gradeId: grade('G1') }, hrSuper);
      expect(lower.completeness.percent).toBe(31); // 13 of 42
      expect(onTab(lower, 'employment').map((m) => m.key)).toEqual(['team', 'jobTitle', 'shift', 'manager']);

      // no grade: whether they are the CEO is not known, so the manager counts
      const ungraded = await changed(ceo, { gradeId: null });
      expect(ungraded.completeness.percent).toBe(29); // 12 of 42
      expect(missing(ungraded)).toEqual(expect.arrayContaining(['grade', 'manager']));

      const managed = await changed(ceo, { gradeId: grade('G1'), managerId: boss.id });
      expect(managed.completeness.percent).toBe(33); // 14 of 42
      expect(missing(managed)).not.toContain('manager');
    });

    it('a profile with everything filled in, hired full time with every paper, is 100% complete', async () => {
      const boss = await addEmployee('Complete Boss');
      const shifts = (await api().get('/api/shifts').set('Cookie', hr).expect(200)).body as { id: string }[];
      const e = await addEmployee('Complete', {
        displayName: 'Complete',
        gender: 'male',
        nationality: 'Egyptian',
        maritalStatus: 'single',
        militaryStatus: 'completed',
        insuranceNo: String(Date.now()).slice(-12),
        workEmail: `complete.${RUN}@test.local`,
        personalEmail: 'complete@example.com',
        mobile: '01012345678',
        city: 'مدينة نصر',
        governorate: 'Cairo',
        addressAr: '١ شارع التحرير',
        degree: 'bachelor',
        university: 'Cairo University',
        faculty: 'Faculty of Engineering',
        major: 'Computer Engineering',
        graduationYear: 2017,
        educationGrade: 'very_good',
        qualificationAr: 'بكالوريوس الهندسة',
        identity: { nationalId: newNationalId(), printedNo: 'AB123456', issueDate: '2024-05-01', expiryDate: '2031-05-01' },
      });
      await api()
        .patch(`/api/employees/${e.id}/bank`)
        .set('Cookie', hr)
        .send({ bankName: 'CIB', branch: 'Nasr City', accountNo: '1001 2345 6789', iban: VALID_IBAN, holderName: 'Complete' })
        .expect(200);
      const hired = await hire(e.id, { jobTitleId, gradeId: grade('G3'), managerId: boss.id, shiftId: shifts[0].id });
      expect(hired.completeness.missing.map((m) => m.tab)).toEqual(Array(7).fill('documents')); // 35 of 42: only the papers
      for (const kind of ['national_id_front', 'national_id_back', 'qualification_certificate', 'birth_certificate', 'military_certificate', 'criminal_record', 'insurance_print', 'personal_photo']) {
        await addPaper(e.id, kind);
      }

      const complete = await profileOf(e.id);
      expect(complete.completeness).toEqual({ percent: 100, missing: [] }); // 42 of 42
      // never asked for: the emergency contact, the second mobile, the job description acknowledgement
      expect(complete).toMatchObject({ emergencyName: null, emergencyMobile: null, mobile2: null, employment: { jdAcknowledgedAt: null } });
    });
  });

  describe('restricted fields', () => {
    it('national ID: checked against the date of birth, masked on the profile, audited when shown', async () => {
      const e = await addEmployee('Identity');
      const nationalId = `2950312${Date.now().toString().slice(-7)}`;
      await api().patch(`/api/employees/${e.id}/identity`).set('Cookie', hr).send({ nationalId: '29502301234567' }).expect(400); // 30 Feb
      const saved = await api()
        .patch(`/api/employees/${e.id}/identity`)
        .set('Cookie', hr)
        .send({ nationalId, printedNo: 'AB123456', issueDate: '2024-05-01', expiryDate: '2031-05-01' })
        .expect(200);
      expect(saved.body.nationalIdMasked).toBe(`•••• ${nationalId.slice(-4)}`);

      const profile = await api().get(`/api/employees/${e.id}`).set('Cookie', hr).expect(200);
      expect(profile.body.dateOfBirth).toBe('1995-03-12'); // filled in from the ID
      expect(profile.body.identity).toEqual({
        nationalIdMasked: `•••• ${nationalId.slice(-4)}`,
        printedNoMasked: '•••• 3456',
        issueDate: '2024-05-01',
        expiryDate: '2031-05-01',
      });
      expect(JSON.stringify(profile.body)).not.toContain(nationalId);

      await api().patch(`/api/employees/${e.id}`).set('Cookie', hr).send({ dateOfBirth: '1995-03-13' }).expect(400);

      const full = await api().get(`/api/employees/${e.id}/identity`).set('Cookie', hr).expect(200);
      expect(full.body.nationalId).toBe(nationalId);

      const dup = await addEmployee('Twin');
      await api().patch(`/api/employees/${dup.id}/identity`).set('Cookie', hr).send({ nationalId }).expect(409);

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'employee', entityId: e.id }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['create', 'update', 'view_restricted']);
      expect(JSON.stringify(audit.map((a) => a.diff))).not.toContain(nationalId);
      expect(audit[1].diff).toMatchObject({ identity: { nationalId: 'changed', printedNo: 'changed', dateOfBirth: { from: null, to: '1995-03-12' } } });
    });

    it('bank: saved without spaces around the details or invisible characters pasted with them (owner, 17 October 2026)', async () => {
      const e = await addEmployee('Pasted Bank');
      await api()
        .patch(`/api/employees/${e.id}/bank`)
        .set('Cookie', hr)
        .send({ bankName: ' CIB ', accountNo: ' 1001-2345\u00A06789\u200F ', iban: `\u200E ${VALID_IBAN.toLowerCase()} \u202C`, holderName: '\u200F  Pasted   Bank ' })
        .expect(200);
      const full = (await api().get(`/api/employees/${e.id}/bank`).set('Cookie', hr).expect(200)).body as Record<string, unknown>;
      expect(full).toMatchObject({ accountNo: '100123456789', iban: VALID_IBAN, holderName: 'Pasted Bank' });
      const row = await prisma.employeeBank.findUniqueOrThrow({ where: { employeeId: e.id } });
      expect([row.bankName, row.accountNo, row.iban, row.holderName]).toEqual(['Commercial International Bank', '100123456789', VALID_IBAN, 'Pasted Bank']);
    });

    it('bank: IBAN checked, masked on the profile, shown in full to Finance with an audit entry', async () => {
      const e = await addEmployee('Banked');
      await api().patch(`/api/employees/${e.id}/bank`).set('Cookie', hr).send({ iban: 'EG380019000500000000263180003' }).expect(400);
      await api()
        .patch(`/api/employees/${e.id}/bank`)
        .set('Cookie', hr)
        .send({ bankName: 'CIB', accountNo: '1001 2345 6789', iban: 'eg38 0019 0005 0000 0000 2631 8000 2', holderName: 'Banked' })
        .expect(200);
      await api().patch(`/api/employees/${e.id}/bank`).set('Cookie', finance).send({ bankName: 'NBE' }).expect(403);

      const profile = await api().get(`/api/employees/${e.id}`).set('Cookie', finance).expect(200);
      expect(profile.body.bank).toEqual({
        bankName: 'Commercial International Bank', // CIB on the EG-ACH list
        branch: null,
        holderName: 'Banked',
        accountNoMasked: '•••• 6789',
        ibanMasked: '•••• 0002',
      });

      const full = await api().get(`/api/employees/${e.id}/bank`).set('Cookie', finance).expect(200);
      expect(full.body).toMatchObject({ accountNo: '100123456789', iban: VALID_IBAN, bankBic: 'CIBEEGCXXXX' });

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'employee', entityId: e.id }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['create', 'update', 'view_restricted']);
      expect(audit[1].diff).toEqual({
        bank: { bankName: { from: null, to: 'Commercial International Bank' }, accountNo: 'changed', iban: 'changed', holderName: { from: null, to: 'Banked' } },
      });
      expect(JSON.stringify(audit.map((a) => a.diff))).not.toContain('263180002');
    });

    describe('bank on the EG-ACH list', () => {
      const saveBank = (id: string, body: object) => api().patch(`/api/employees/${id}/bank`).set('Cookie', hr).send(body);
      const fullBank = async (id: string) => (await api().get(`/api/employees/${id}/bank`).set('Cookie', hr).expect(200)).body as Record<string, unknown>;
      const lengthMessage = (bank: string, length: string) => `${bank} account numbers have ${length}. Check the number against the bank's letter.`;
      const NBE_MESSAGE = lengthMessage('National Bank of Egypt', '19 digits');

      it('a bank typed by its abbreviation is saved under the list’s name; its account number must have the bank’s length', async () => {
        const e = await addEmployee('Ahli');
        const named = await saveBank(e.id, { bankName: 'nbe' }).expect(200);
        expect(named.body.bankName).toBe('National Bank of Egypt');

        const short = await saveBank(e.id, { bankName: 'NBE', accountNo: '1001 2345 6789' }).expect(400);
        expect(short.body.message).toBe(NBE_MESSAGE);
        expect(JSON.stringify(short.body)).not.toContain('6789'); // restricted: the number is never repeated
        const letters = await saveBank(e.id, { accountNo: '100200123456780000A' }).expect(400); // 19 characters, one a letter
        expect(letters.body.message).toBe(NBE_MESSAGE);

        // written with spaces and dashes, in Arabic digits: kept as the 19 digits
        await saveBank(e.id, { bankName: 'National bank of egypt', accountNo: arabicDigits('100 200-1234 5678-00001') }).expect(200);
        expect(await fullBank(e.id)).toMatchObject({ bankName: 'National Bank of Egypt', accountNo: '1002001234567800001', bankBic: 'NBEGEGCXXXX' });

        const audit = await prisma.auditLog.findMany({ where: { entityType: 'employee', entityId: e.id }, orderBy: { id: 'asc' } });
        expect(JSON.stringify(audit.map((a) => a.diff))).not.toContain('1002001234567800001');
      });

      it('each bank’s lengths: Audi Bank 12 or 16, ABK up to 10, Central Bank of Egypt any; a bank not on the list as typed', async () => {
        const e = await addEmployee('Lengths');
        await saveBank(e.id, { bankName: 'Audi Bank', accountNo: '001234567890' }).expect(200);
        await saveBank(e.id, { bankName: 'AUDI', accountNo: '0012345678901234' }).expect(200);
        const audi = await saveBank(e.id, { bankName: 'Audi Bank', accountNo: '00123456789012' }).expect(400);
        expect(audi.body.message).toBe(lengthMessage('Audi Bank', '12 or 16 digits'));

        await saveBank(e.id, { bankName: 'abk', accountNo: '1234567890' }).expect(200);
        const abk = await saveBank(e.id, { bankName: 'ABK', accountNo: '12345678901' }).expect(400);
        expect(abk.body.message).toBe(lengthMessage('Al Ahli Bank of Kuwait – Egypt', 'up to 10 digits'));

        // the list gives no length for the Central Bank of Egypt: any number that is 4–34 letters and digits
        for (const accountNo of ['12345', '1234567890123456789012345', 'CBE0012345']) {
          await saveBank(e.id, { bankName: 'CBE', accountNo }).expect(200);
        }
        expect(await fullBank(e.id)).toMatchObject({ bankName: 'Central Bank of Egypt', accountNo: 'CBE0012345', bankBic: 'CBEGEGCXXXX' });
        await saveBank(e.id, { bankName: 'CBE', accountNo: '123' }).expect(400); // still 4 to 34

        // a bank not on the list ("Other"): kept as typed, its number letters and digits
        const other = await saveBank(e.id, { bankName: '  Bank of Elsewhere  ', accountNo: 'GB12 ABCD-3456 7890' }).expect(200);
        expect(other.body.bankName).toBe('Bank of Elsewhere');
        expect(await fullBank(e.id)).toMatchObject({ bankName: 'Bank of Elsewhere', accountNo: 'GB12ABCD34567890', bankBic: null });
      });

      it('details already on file never block saving something else; a new bank must fit the number on file', async () => {
        // saved before the list: "NBE" typed freely, with 12 digits (the API no longer takes these)
        const e = await addEmployee('Legacy');
        await prisma.employeeBank.create({ data: { employeeId: e.id, bankName: 'NBE', accountNo: '100123456789', holderName: 'Old Name' } });
        await saveBank(e.id, { holderName: 'New Name' }).expect(200);
        // the whole form sent back as it is, as the web app sends it
        const form = { bankName: 'NBE', branch: null, accountNo: '100123456789', iban: null, holderName: 'Newer Name' };
        const saved = await saveBank(e.id, form).expect(200);
        expect(saved.body).toMatchObject({ bankName: 'National Bank of Egypt', holderName: 'Newer Name', accountNoMasked: '•••• 6789' });
        // a new number must fit
        const changed = await saveBank(e.id, { ...form, accountNo: '100123456780' }).expect(400);
        expect(changed.body.message).toBe(NBE_MESSAGE);

        // a new bank: the number on file must fit it
        const moved = await addEmployee('Moved');
        await saveBank(moved.id, { bankName: 'CIB', accountNo: '100123456789' }).expect(200);
        const toNbe = await saveBank(moved.id, { bankName: 'National Bank of Egypt' }).expect(400);
        expect(toNbe.body.message).toBe(NBE_MESSAGE);
        expect(JSON.stringify(toNbe.body)).not.toContain('6789');
        await saveBank(moved.id, { bankName: 'National Bank of Egypt', accountNo: '1002001234567800001' }).expect(200);
        expect(await fullBank(moved.id)).toMatchObject({ bankName: 'National Bank of Egypt', accountNo: '1002001234567800001' });
      });
    });
  });
});
