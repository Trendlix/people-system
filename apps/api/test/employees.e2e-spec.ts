import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Unique per run, because the test database keeps data from earlier runs.
const RUN = Date.now().toString(36).toLowerCase();
const VALID_IBAN = 'EG380019000500000000263180002';
const arabicDigits = (s: string) => s.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
let ids = 0;
/** A national ID no other run uses; digits 2–7 give the birth date 12 March 1995. */
const newNationalId = () => `2950312${String((Date.now() * 10 + ++ids) % 10_000_000).padStart(7, '0')}`;

describe('Employees (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let finance: string;
  let departmentId: string;
  let otherDepartmentId: string;
  let jobTitleId: string;
  const api = () => request(app.getHttpServer());

  const person = (name: string, extra: Record<string, unknown> = {}) => ({
    fullNameEn: `${name} ${RUN}`,
    fullNameAr: 'موظف تجريبي',
    employmentType: 'full_time',
    joinDate: '2026-01-15',
    ...extra,
  });

  async function addEmployee(name: string, extra: Record<string, unknown> = {}) {
    const res = await api().post('/api/employees').set('Cookie', hr).send(person(name, extra)).expect(201);
    return res.body as { id: string; employeeCode: string; [key: string]: unknown };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    const dept = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Web ${RUN}` }).expect(201);
    departmentId = dept.body.id;
    const other = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Media ${RUN}` }).expect(201);
    otherDepartmentId = other.body.id;
    const job = await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId, titleEn: 'Frontend Developer' }).expect(201);
    jobTitleId = job.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('adding and changing', () => {
    it('adds an employee: next code, default probation, department from the job title, audit entry', async () => {
      const first = await addEmployee('Omar Khaled', { jobTitleId, workEmail: ` Omar.${RUN}@Trendlix.com `, mobile: '010 1234-5678' });
      expect(first.employeeCode).toMatch(/^EMP-\d{4,}$/);
      expect(first).toMatchObject({
        status: 'probation',
        joinDate: '2026-01-15',
        probationEnd: '2026-04-15',
        departmentId,
        jobTitleId,
        workEmail: `omar.${RUN}@trendlix.com`,
        mobile: '01012345678',
        workArrangement: 'office',
        officeDays: [],
        access: { edit: true, identity: true, bank: true },
        identity: null,
        bank: null,
      });

      const second = await addEmployee('Nour Ali');
      expect(Number(second.employeeCode.slice(4))).toBe(Number(first.employeeCode.slice(4)) + 1);

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'employee', entityId: first.id } });
      expect(audit.map((a) => a.action)).toEqual(['create']);
    });

    it('refuses a code or work email that is already used', async () => {
      const taken = await addEmployee('Code Owner', { workEmail: `owner.${RUN}@trendlix.com` });
      const dupCode = await api().post('/api/employees').set('Cookie', hr).send(person('Copy', { employeeCode: taken.employeeCode })).expect(409);
      expect(dupCode.body.message).toContain(taken.employeeCode);
      await api().post('/api/employees').set('Cookie', hr).send(person('Copy', { workEmail: `OWNER.${RUN}@trendlix.com` })).expect(409);
    });

    it('checks required fields, dates and lists', async () => {
      await api().post('/api/employees').set('Cookie', hr).send(person('No Arabic', { fullNameAr: ' ' })).expect(400);
      await api().post('/api/employees').set('Cookie', hr).send(person('Bad Date', { joinDate: '2026-02-30' })).expect(400);
      await api().post('/api/employees').set('Cookie', hr).send(person('Bad List', { gender: 'other' })).expect(400);
      await api().post('/api/employees').set('Cookie', hr).send(person('Bad Code', { employeeCode: 'E-1' })).expect(400);
      await api().post('/api/employees').set('Cookie', hr).send(person('Future', { dateOfBirth: '2999-01-01' })).expect(400);
      await api().post('/api/employees').set('Cookie', hr).send(person('Early End', { probationEnd: '2026-01-01' })).expect(400);
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

    it('keeps office days for Hybrid only', async () => {
      await api().post('/api/employees').set('Cookie', hr).send(person('Hybrid', { workArrangement: 'hybrid' })).expect(400);
      const e = await addEmployee('Hybrid', { workArrangement: 'hybrid', officeDays: [3, 0] });
      expect(e.officeDays).toEqual([0, 3]);
      const office = await api().patch(`/api/employees/${e.id}`).set('Cookie', hr).send({ workArrangement: 'office' }).expect(200);
      expect(office.body.officeDays).toEqual([]);
    });

    it('refuses a job title from another department', async () => {
      const res = await api()
        .post('/api/employees')
        .set('Cookie', hr)
        .send(person('Mismatch', { jobTitleId, departmentId: otherDepartmentId }))
        .expect(400);
      expect(res.body.message).toContain('Frontend Developer');
    });

    it('moves a default probation end with the join date, and records only what changed', async () => {
      const e = await addEmployee('Mover');
      const moved = await api().patch(`/api/employees/${e.id}`).set('Cookie', hr).send({ joinDate: '2026-03-01', nationality: 'Egyptian' }).expect(200);
      expect(moved.body).toMatchObject({ joinDate: '2026-03-01', probationEnd: '2026-06-01', nationality: 'Egyptian' });

      const update = await prisma.auditLog.findFirst({ where: { entityType: 'employee', entityId: e.id, action: 'update' } });
      expect(update?.diff).toEqual({
        joinDate: { from: '2026-01-15', to: '2026-03-01' },
        probationEnd: { from: '2026-04-15', to: '2026-06-01' },
        nationality: { from: null, to: 'Egyptian' },
      });
    });

    it('refuses a reporting loop and being one’s own manager', async () => {
      const boss = await addEmployee('Boss');
      const lead = await addEmployee('Lead', { managerId: boss.id });
      const dev = await addEmployee('Dev', { managerId: lead.id });
      await api().patch(`/api/employees/${boss.id}`).set('Cookie', hr).send({ managerId: dev.id }).expect(400);
      await api().patch(`/api/employees/${boss.id}`).set('Cookie', hr).send({ managerId: boss.id }).expect(400);

      const res = await api().delete(`/api/employees/${lead.id}`).set('Cookie', hr).expect(409);
      expect(res.body.message).toContain('1 employee');
      await api().delete(`/api/employees/${dev.id}`).set('Cookie', hr).expect(204);
      await api().get(`/api/employees/${dev.id}`).set('Cookie', hr).expect(404);
    });

    it('only HR adds, changes and deletes', async () => {
      await api().post('/api/employees').set('Cookie', finance).send(person('Nope')).expect(403);
      const e = await addEmployee('Protected');
      await api().patch(`/api/employees/${e.id}`).set('Cookie', finance).send({ nationality: 'X' }).expect(403);
      await api().delete(`/api/employees/${e.id}`).set('Cookie', finance).expect(403);
    });

    it('will not delete a department, job title or shift that employees use', async () => {
      const shift = await api().post('/api/shifts').set('Cookie', hr).send({ code: `T${RUN.slice(-6)}`.toUpperCase(), startTime: '08:00', endTime: '16:00' }).expect(201);
      await addEmployee('Placed', { jobTitleId, shiftId: shift.body.id });
      await api().delete(`/api/job-titles/${jobTitleId}`).set('Cookie', hr).expect(409);
      await api().delete(`/api/shifts/${shift.body.id}`).set('Cookie', hr).expect(409);
      const dept = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Ops ${RUN}` }).expect(201);
      await addEmployee('In Ops', { departmentId: dept.body.id });
      const res = await api().delete(`/api/departments/${dept.body.id}`).set('Cookie', hr).expect(409);
      expect(res.body.message).toContain('employee');
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
    let manager: { id: string };
    let report: { id: string };
    let outsider: { id: string };

    beforeAll(async () => {
      const managerEmail = await createUser(prisma, ['manager', 'employee']);
      const staffEmail = await createUser(prisma, ['employee']);
      manager = await addEmployee('Team Lead', { workEmail: managerEmail });
      report = await addEmployee('Team Member', { workEmail: staffEmail, managerId: manager.id });
      outsider = await addEmployee('Outsider');
      managerSession = await signIn(app, managerEmail);
      staffSession = await signIn(app, staffEmail);
    });

    it('a manager sees themself and their direct reports', async () => {
      const list = await api().get('/api/employees').set('Cookie', managerSession).expect(200);
      expect(list.body.map((e: { id: string }) => e.id).sort()).toEqual([manager.id, report.id].sort());
      await api().get(`/api/employees/${report.id}`).set('Cookie', managerSession).expect(200);
      await api().get(`/api/employees/${outsider.id}`).set('Cookie', managerSession).expect(404);
    });

    it('an employee sees only themself, without restricted sections', async () => {
      const list = await api().get('/api/employees').set('Cookie', staffSession).expect(200);
      expect(list.body.map((e: { id: string }) => e.id)).toEqual([report.id]);
      const own = await api().get(`/api/employees/${report.id}`).set('Cookie', staffSession).expect(200);
      expect(own.body.access).toEqual({ edit: false, identity: false, bank: false });
      expect(own.body).not.toHaveProperty('identity');
      expect(own.body).not.toHaveProperty('bank');
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
