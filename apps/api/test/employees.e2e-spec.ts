import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Unique per run, because the test database keeps data from earlier runs.
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
  let webId: string;
  let departmentId: string;
  let otherDepartmentId: string;
  let jobTitleId: string;
  const api = () => request(app.getHttpServer());

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
  const deleteEmployment = (employeeId: string, employmentId: string, session = hr) =>
    api().delete(`/api/employees/${employeeId}/employments/${employmentId}`).set('Cookie', session);

  /** Hires someone whose profile exists; answers the updated profile. */
  async function hire(employeeId: string, extra: Record<string, unknown> = {}): Promise<Hired> {
    const res = await startEmployment(employeeId, job(extra)).expect(201);
    return res.body as Hired;
  }

  /** A new profile, hired straight away. */
  async function addHired(name: string, employment: Record<string, unknown> = {}, profile: Record<string, unknown> = {}): Promise<Hired> {
    const e = await addEmployee(name, profile);
    return hire(e.id, employment);
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
    const dept = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Web ${RUN}` }).expect(201);
    webId = dept.body.id;
    // job titles belong to teams, so the Frontend Developer's department is the Frontend team
    const team = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Frontend', parentId: webId }).expect(201);
    departmentId = team.body.id;
    const other = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Media ${RUN}` }).expect(201);
    otherDepartmentId = other.body.id;
    const title = await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId, titleEn: 'Frontend Developer' }).expect(201);
    jobTitleId = title.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('profiles', () => {
    it('adds a profile with no employment yet: next code, not employed, audit entry', async () => {
      const first = await addEmployee('Omar Khaled', { workEmail: ` Omar.${RUN}@Trendlix.com `, mobile: '010 1234-5678' });
      expect(first.employeeCode).toMatch(/^EMP-\d{4,}$/);
      expect(first).toMatchObject({
        workEmail: `omar.${RUN}@trendlix.com`,
        mobile: '01012345678',
        employment: null,
        employments: [],
        reports: [],
        access: { edit: true, delete: true, identity: true, bank: true },
        identity: null,
        bank: null,
      });
      expect(await listed(first.id)).toEqual({
        id: first.id,
        employeeCode: first.employeeCode,
        fullNameEn: `Omar Khaled ${RUN}`,
        fullNameAr: 'موظف تجريبي',
        workEmail: `omar.${RUN}@trendlix.com`,
        standing: 'not_employed',
        employment: null,
        lastEnded: null,
      });

      // numbered after the first (other test runs may add employees at the same time)
      const second = await addEmployee('Nour Ali');
      expect(Number(second.employeeCode.slice(4))).toBeGreaterThan(Number(first.employeeCode.slice(4)));

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'employee', entityId: first.id } });
      expect(audit.map((a) => a.action)).toEqual(['create']);
      expect(audit[0].diff).toMatchObject({ fullNameEn: `Omar Khaled ${RUN}`, mobile: '01012345678' });
    });

    it('refuses employment fields on a profile: they belong to an employment', async () => {
      const employment = {
        employmentType: 'full_time',
        joinDate: '2026-01-15',
        status: 'active',
        departmentId,
        jobTitleId,
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
      expect(changed.body).toMatchObject({ nationality: 'Egyptian', mobile: '01012345678' });

      const update = await prisma.auditLog.findFirst({ where: { entityType: 'employee', entityId: e.id, action: 'update' } });
      expect(update?.diff).toEqual({ nationality: { from: null, to: 'Egyptian' } });
    });

    it('lets an Admin delete a profile', async () => {
      const e = await addEmployee('Added By Mistake');
      await api().patch(`/api/employees/${e.id}`).set('Cookie', admin).send({ nationality: 'X' }).expect(403);
      await api().delete(`/api/employees/${e.id}`).set('Cookie', admin).expect(204);
      await api().get(`/api/employees/${e.id}`).set('Cookie', hr).expect(404);
    });

    it('only HR adds, changes and deletes', async () => {
      await api().post('/api/employees').set('Cookie', finance).send(person('Nope')).expect(403);
      const e = await addEmployee('Protected');
      await api().patch(`/api/employees/${e.id}`).set('Cookie', finance).send({ nationality: 'X' }).expect(403);
      await api().delete(`/api/employees/${e.id}`).set('Cookie', finance).expect(403);
    });
  });

  describe('employments', () => {
    it('hires someone: default probation, the team from the job title, in the history, the directory and the audit log', async () => {
      const e = await addEmployee('Hired');
      const hired = await hire(e.id, { jobTitleId, jdAcknowledgedAt: '2026-01-20' });
      expect(hired.employment).toMatchObject({
        employeeId: e.id,
        employmentType: 'full_time',
        status: 'probation',
        joinDate: '2026-01-15',
        probationEnd: '2026-04-15',
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
        jobTitle: { id: jobTitleId, titleEn: 'Frontend Developer', grade: null },
        manager: null,
        shift: null,
      });
      expect(hired.employments).toEqual([hired.employment]);

      expect(await listed(e.id)).toEqual({
        id: e.id,
        employeeCode: e.employeeCode,
        fullNameEn: `Hired ${RUN}`,
        fullNameAr: 'موظف تجريبي',
        workEmail: null,
        standing: 'probation',
        employment: {
          id: hired.employment.id,
          status: 'probation',
          employmentType: 'full_time',
          joinDate: '2026-01-15',
          department: { id: departmentId, nameEn: 'Frontend', nameAr: null, parent: { id: webId, nameEn: `Web ${RUN}`, nameAr: null } },
          jobTitle: { id: jobTitleId, titleEn: 'Frontend Developer', grade: null },
          manager: null,
        },
        lastEnded: null,
      });

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'employment', entityId: hired.employment.id } });
      expect(audit.map((a) => a.action)).toEqual(['create']);
      expect(audit[0].diff).toMatchObject({ employeeId: e.id, employmentType: 'full_time', joinDate: '2026-01-15', probationEnd: '2026-04-15', departmentId, jobTitleId });
      // the profile itself did not change
      expect(await prisma.auditLog.count({ where: { entityType: 'employee', entityId: e.id } })).toBe(1);
    });

    it('checks the employment: type, dates, status, and fields it does not know', async () => {
      const e = await addEmployee('Checked Hire');
      await startEmployment(e.id, { joinDate: '2026-01-15' }).expect(400); // no employment type
      await startEmployment(e.id, { employmentType: 'full_time' }).expect(400); // no join date
      await startEmployment(e.id, job({ joinDate: '2026-02-30' })).expect(400);
      await startEmployment(e.id, job({ employmentType: 'contractor' })).expect(400);
      const early = await startEmployment(e.id, job({ probationEnd: '2026-01-01' })).expect(400);
      expect(early.body.message).toBe('Probation must end on or after the join date.');
      const ended = await startEmployment(e.id, job({ status: 'resigned' })).expect(400);
      expect(ended.body.message).toEqual(['Choose Active, Probation, On leave or Notice period. To end an employment, use End employment.']);
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

    it('refuses a job title from another team, and an unknown team, manager or shift', async () => {
      const e = await addEmployee('Mismatch');
      const res = await startEmployment(e.id, job({ jobTitleId, departmentId: otherDepartmentId })).expect(400);
      expect(res.body.message).toContain('Frontend Developer');
      const manager = await startEmployment(e.id, job({ managerId: NOWHERE })).expect(400);
      expect(manager.body.message).toBe('Manager not found. Choose one from the list.');
      await startEmployment(e.id, job({ departmentId: NOWHERE })).expect(400);
      await startEmployment(e.id, job({ jobTitleId: NOWHERE })).expect(400);
      await startEmployment(e.id, job({ shiftId: NOWHERE })).expect(400);
      expect(await prisma.employment.count({ where: { employeeId: e.id } })).toBe(0);
    });

    it('moves a default probation end with the join date, keeps one HR chose, and records only what changed', async () => {
      const e = await addHired('Mover');
      const moved = await changeEmployment(e.id, e.employment.id, { joinDate: '2026-03-01', status: 'active' }).expect(200);
      expect(moved.body.employment).toMatchObject({ joinDate: '2026-03-01', probationEnd: '2026-06-01', status: 'active' });

      const update = await prisma.auditLog.findFirst({ where: { entityType: 'employment', entityId: e.employment.id, action: 'update' } });
      expect(update?.diff).toEqual({
        employeeId: e.id,
        joinDate: { from: '2026-01-15', to: '2026-03-01' },
        probationEnd: { from: '2026-04-15', to: '2026-06-01' },
        status: { from: 'probation', to: 'active' },
      });

      await changeEmployment(e.id, e.employment.id, { probationEnd: '2026-05-20' }).expect(200);
      const kept = await changeEmployment(e.id, e.employment.id, { joinDate: '2026-03-02' }).expect(200);
      expect(kept.body.employment).toMatchObject({ joinDate: '2026-03-02', probationEnd: '2026-05-20' });
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
        { id: lead.id, employeeCode: lead.employeeCode, fullNameEn: `Lead ${RUN}`, status: 'probation', jobTitle: null },
      ]);

      const res = await api().delete(`/api/employees/${lead.id}`).set('Cookie', hr).expect(409);
      expect(res.body.message).toContain('1 employee');
      await api().delete(`/api/employees/${dev.id}`).set('Cookie', hr).expect(204);
      await api().get(`/api/employees/${dev.id}`).set('Cookie', hr).expect(404);
      expect(await prisma.employment.count({ where: { employeeId: dev.id } })).toBe(0); // the employments go with the profile
    });

    it('ends an employment: Resigned or Terminated by the reason; the profile stays, as a former employee', async () => {
      const e = await addHired('Leaver', { jobTitleId });
      await endEmployment(e.id, e.employment.id, { endDate: '2026-01-14', endReason: 'resigned' }).expect(400); // before joining
      await endEmployment(e.id, e.employment.id, { endDate: '2026-05-31', endReason: 'retired' }).expect(400);
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
      expect(audit.diff).toEqual({ employeeId: e.id, endDate: '2026-05-31', endReason: 'resigned', status: { from: 'probation', to: 'resigned' } });

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

      const back = await hire(e.id, { joinDate: '2026-01-01', employmentType: 'part_time', status: 'active' });
      expect(back.employment).toMatchObject({ employmentType: 'part_time', status: 'active', joinDate: '2026-01-01', endDate: null });
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
        expect.objectContaining({ joinDate: '2025-02-01', probationEnd: '2025-05-01', jdAcknowledgedAt: '2025-02-03', status: 'resigned', endDate: '2025-09-30' }),
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

    it('deletes an employment added by mistake (HR and Admin), and the profile stays', async () => {
      const e = await addHired('Wrong Hire');
      const other = await addHired('Someone Else');
      await deleteEmployment(other.id, e.employment.id).expect(404); // not theirs
      await changeEmployment(other.id, e.employment.id, { status: 'active' }).expect(404);
      await deleteEmployment(e.id, e.employment.id, finance).expect(403);

      await deleteEmployment(e.id, e.employment.id, admin).expect(204);
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
      await changeEmployment(e.id, hired.employment.id, { status: 'active' }, finance).expect(403);
      await endEmployment(e.id, hired.employment.id, { endDate: '2026-06-30', endReason: 'resigned' }, finance).expect(403);
      await endEmployment(e.id, hired.employment.id, { endDate: '2026-06-30', endReason: 'resigned' }, admin).expect(403);
      expect((await profileOf(e.id)).employment).toMatchObject({ status: 'probation', endDate: null });
    });
  });

  describe('what the history keeps', () => {
    it('will not delete a department, team, job title or shift that a current or past employment uses', async () => {
      const remove = (path: string) => api().delete(path).set('Cookie', hr);
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
      const now = await api().delete(`/api/employees/${boss.id}`).set('Cookie', hr).expect(409);
      expect(now.body.message).toBe(`1 employee(s) report to Past Boss ${RUN}. Choose another manager for them before deleting.`);

      await endEmployment(member.id, member.employment.id, { endDate: '2026-03-31', endReason: 'resigned' }).expect(200);
      const before = await api().delete(`/api/employees/${boss.id}`).set('Cookie', hr).expect(409);
      expect(before.body.message).toBe(`Past Boss ${RUN} is the manager on record of 1 past employment(s), so the profile is kept.`);
      expect((await profileOf(member.id)).employments[0].manager).toEqual({ id: boss.id, employeeCode: boss.employeeCode, fullNameEn: `Past Boss ${RUN}` });
      expect((await profileOf(boss.id)).reports).toEqual([]);

      // once that history is gone (here with the member's profile), the profile can be deleted with its own employments
      await api().delete(`/api/employees/${member.id}`).set('Cookie', hr).expect(204);
      await api().delete(`/api/employees/${boss.id}`).set('Cookie', hr).expect(204);
      expect(await prisma.employment.count({ where: { employeeId: boss.id } })).toBe(0);
    });
  });

  describe('adding with the national ID (e.g. read from the ID card)', () => {
    const named = (name: string) => prisma.employee.count({ where: { fullNameEn: `${name} ${RUN}` } });

    it('saves the national ID with the employee, fills in the date of birth, and audits without the numbers', async () => {
      const nationalId = newNationalId();
      const e = await addEmployee('Card Holder', {
        identity: { nationalId: arabicDigits(nationalId), printedNo: 'AB123456', issueDate: '2024-05-01', expiryDate: '2031-05-01', issuingOffice: 'Nasr City' },
      });
      expect(e.dateOfBirth).toBe('1995-03-12'); // filled in from the ID
      expect(e.identity).toEqual({
        nationalIdMasked: `•••• ${nationalId.slice(-4)}`,
        printedNoMasked: '•••• 3456',
        issueDate: '2024-05-01',
        expiryDate: '2031-05-01',
        issuingOffice: 'Nasr City',
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
          issuingOffice: { from: null, to: 'Nasr City' },
        },
      });
      expect(JSON.stringify(audit[0].diff)).not.toContain(nationalId);
      expect(JSON.stringify(audit[0].diff)).not.toContain('AB123456');

      const full = await api().get(`/api/employees/${e.id}/identity`).set('Cookie', hr).expect(200);
      expect(full.body.nationalId).toBe(nationalId);
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
      for (const identity of [{}, { nationalId: null, printedNo: ' ', issuingOffice: '' }, null]) {
        const e = await addEmployee('No Card', { identity });
        expect(e).toMatchObject({ identity: null, dateOfBirth: null });
        expect(await prisma.employeeIdentity.count({ where: { employeeId: e.id } })).toBe(0);
        const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'employee', entityId: e.id, action: 'create' } });
        expect(audit.diff).not.toHaveProperty('identity');
      }
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
    const change = async (id: string, body: object) => (await api().patch(`/api/employees/${id}`).set('Cookie', hr).send(body).expect(200)).body as Profile;

    it('counts the fields and the papers the file needs, says on which tab each missing one goes, and rises as they are added', async () => {
      // before any hire: 18 fields and the national ID (front and back), of which the names are there
      const e = await addEmployee('Incomplete');
      expect(e.completeness.percent).toBe(10); // 2 of 20
      expect(e.completeness.missing).toHaveLength(18);
      expect(e.completeness.missing).toEqual(
        expect.arrayContaining([
          { key: 'dateOfBirth', label: 'Date of birth', tab: 'basic' },
          { key: 'iban', label: 'IBAN', tab: 'basic' },
          { key: 'degree', label: 'Degree', tab: 'education' },
          { key: 'national_id_front', label: 'National ID (front)', tab: 'documents' },
          { key: 'national_id_back', label: 'National ID (back)', tab: 'documents' },
        ]),
      );
      expect(missing(e)).not.toContain('fullNameEn');
      expect(missing(e)).not.toContain('criminal_record');

      // hired full time: the full list of papers, the military certificate too while the gender is not recorded
      const hired = await hire(e.id);
      expect(hired.completeness.percent).toBe(7); // 2 of 27
      expect(missing(hired)).toEqual(expect.arrayContaining(['military_certificate', 'criminal_record', 'insurance_form_1', 'personal_photo', 'bank_letter']));

      const man = await change(e.id, { gender: 'male' });
      expect(man.completeness.percent).toBe(11); // 3 of 27
      expect(missing(man)).toContain('military_certificate');

      // a woman's file needs no military certificate, and her military status is Not applicable
      const woman = await change(e.id, { gender: 'female' });
      expect(woman.completeness.percent).toBe(15); // 4 of 26
      expect(missing(woman)).not.toContain('military_certificate');
      expect(missing(woman)).not.toContain('militaryStatus');

      const filled = await change(e.id, { nationality: 'Egyptian', mobile: '01012345678', degree: 'bachelor', university: 'Cairo University', graduationYear: 2018 });
      expect(filled.completeness.percent).toBe(35); // 9 of 26

      await api().post(`/api/employees/${e.id}/paperwork`).set('Cookie', hr).field('kind', 'personal_photo').attach('file', PNG, 'photo.png').expect(201);
      const papered = await profileOf(e.id);
      expect(papered.completeness.percent).toBe(38); // 10 of 26
      expect(missing(papered)).not.toContain('personal_photo');

      // the national ID number (with the date of birth it holds) and its expiry
      await api().patch(`/api/employees/${e.id}/identity`).set('Cookie', hr).send({ nationalId: newNationalId(), expiryDate: '2031-05-01' }).expect(200);
      const identified = await profileOf(e.id);
      expect(identified.completeness.percent).toBe(50); // 13 of 26
      expect(identified.dateOfBirth).toBe('1995-03-12');
      expect(missing(identified)).not.toContain('dateOfBirth');
      expect(missing(identified)).not.toContain('nationalId');
      expect(missing(identified)).not.toContain('idExpiry');
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
        .send({ nationalId, printedNo: 'AB123456', issueDate: '2024-05-01', expiryDate: '2031-05-01', issuingOffice: 'Nasr City' })
        .expect(200);
      expect(saved.body.nationalIdMasked).toBe(`•••• ${nationalId.slice(-4)}`);

      const profile = await api().get(`/api/employees/${e.id}`).set('Cookie', hr).expect(200);
      expect(profile.body.dateOfBirth).toBe('1995-03-12'); // filled in from the ID
      expect(profile.body.identity).toEqual({
        nationalIdMasked: `•••• ${nationalId.slice(-4)}`,
        printedNoMasked: '•••• 3456',
        issueDate: '2024-05-01',
        expiryDate: '2031-05-01',
        issuingOffice: 'Nasr City',
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
      expect(profile.body.bank).toEqual({ bankName: 'CIB', branch: null, holderName: 'Banked', accountNoMasked: '•••• 6789', ibanMasked: '•••• 0002' });

      const full = await api().get(`/api/employees/${e.id}/bank`).set('Cookie', finance).expect(200);
      expect(full.body).toMatchObject({ accountNo: '100123456789', iban: VALID_IBAN });

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'employee', entityId: e.id }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['create', 'update', 'view_restricted']);
      expect(audit[1].diff).toEqual({ bank: { bankName: { from: null, to: 'CIB' }, accountNo: 'changed', iban: 'changed', holderName: { from: null, to: 'Banked' } } });
      expect(JSON.stringify(audit.map((a) => a.diff))).not.toContain('263180002');
    });
  });
});
