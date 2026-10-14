import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Unique per run, because the test database keeps data from earlier runs.
const RUN = Date.now().toString(36).toUpperCase();
const name = (base: string) => `${base} ${RUN}`;

describe('Organisation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let session: string;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    session = await signIn(app, await createUser(prisma, ['hr']));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('departments', () => {
    it('creates, renames and deletes a department, with audit entries', async () => {
      const created = await api()
        .post('/api/departments')
        .set('Cookie', session)
        .send({ nameEn: `  ${name('Web Development')}  `, nameAr: 'تطوير الويب' })
        .expect(201);
      expect(created.body).toMatchObject({ nameEn: name('Web Development'), nameAr: 'تطوير الويب' });
      const id = created.body.id;

      const updated = await api().patch(`/api/departments/${id}`).set('Cookie', session).send({ nameAr: '' }).expect(200);
      expect(updated.body.nameAr).toBeNull();

      const list = await api().get('/api/departments').set('Cookie', session).expect(200);
      expect(list.body.find((d: { id: string }) => d.id === id)._count.jobTitles).toBe(0);

      await api().delete(`/api/departments/${id}`).set('Cookie', session).expect(204);
      await api().get(`/api/departments/${id}`).set('Cookie', session).expect(404);

      const actions = await prisma.auditLog.findMany({ where: { entityType: 'department', entityId: id }, orderBy: { id: 'asc' } });
      expect(actions.map((a) => a.action)).toEqual(['create', 'update', 'delete']);
      expect(actions[1].diff).toEqual({ nameAr: { from: 'تطوير الويب', to: null } });
    });

    it('rejects a duplicate name', async () => {
      await api().post('/api/departments').set('Cookie', session).send({ nameEn: name('Finance') }).expect(201);
      await api().post('/api/departments').set('Cookie', session).send({ nameEn: name('Finance') }).expect(409);
    });

    it('rejects a missing name and unknown fields', async () => {
      await api().post('/api/departments').set('Cookie', session).send({ nameEn: '   ' }).expect(400);
      await api().post('/api/departments').set('Cookie', session).send({ nameEn: 'X', budget: 5 }).expect(400);
    });

    it('will not delete a department that still has job titles', async () => {
      const dept = await api().post('/api/departments').set('Cookie', session).send({ nameEn: name('Video') }).expect(201);
      await api()
        .post('/api/job-titles')
        .set('Cookie', session)
        .send({ departmentId: dept.body.id, titleEn: 'Video Producer' })
        .expect(201);
      const res = await api().delete(`/api/departments/${dept.body.id}`).set('Cookie', session).expect(409);
      expect(res.body.message).toContain('1 job title');
    });
  });

  describe('teams', () => {
    it('puts a team in a department, one level deep', async () => {
      const marketing = await api().post('/api/departments').set('Cookie', session).send({ nameEn: name('Marketing') }).expect(201);
      const content = await api()
        .post('/api/departments')
        .set('Cookie', session)
        .send({ nameEn: name('Content Team'), nameAr: 'فريق المحتوى', parentId: marketing.body.id })
        .expect(201);
      expect(content.body).toMatchObject({ parentId: marketing.body.id, parent: { nameEn: name('Marketing') }, _count: { jobTitles: 0, children: 0 } });

      const main = await api().get(`/api/departments/${marketing.body.id}`).set('Cookie', session).expect(200);
      expect(main.body._count.children).toBe(1);
      expect(main.body.children).toEqual([{ id: content.body.id, nameEn: name('Content Team'), nameAr: 'فريق المحتوى', _count: { jobTitles: 0 } }]);

      // a job title in the team shows where it sits
      const job = await api()
        .post('/api/job-titles')
        .set('Cookie', session)
        .send({ departmentId: content.body.id, titleEn: 'Senior Content Creator' })
        .expect(201);
      expect(job.body.department.parent).toEqual({ id: marketing.body.id, nameEn: name('Marketing'), nameAr: null });

      // no team inside a team, and not inside itself
      await api().post('/api/departments').set('Cookie', session).send({ nameEn: 'Video', parentId: content.body.id }).expect(400);
      await api().patch(`/api/departments/${marketing.body.id}`).set('Cookie', session).send({ parentId: marketing.body.id }).expect(400);

      // a department with teams can't become a team, nor be deleted
      const other = await api().post('/api/departments').set('Cookie', session).send({ nameEn: name('Sales') }).expect(201);
      await api().patch(`/api/departments/${marketing.body.id}`).set('Cookie', session).send({ parentId: other.body.id }).expect(400);
      const refused = await api().delete(`/api/departments/${marketing.body.id}`).set('Cookie', session).expect(409);
      expect(refused.body.message).toContain('1 team');

      // taking the team out makes it a department of its own
      const moved = await api().patch(`/api/departments/${content.body.id}`).set('Cookie', session).send({ parentId: '' }).expect(200);
      expect(moved.body).toMatchObject({ parentId: null, parent: null });
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'department', entityId: content.body.id, action: 'update' } });
      expect(audit?.diff).toEqual({ parentId: { from: marketing.body.id, to: null } });
    });

    it('keeps names unique among departments, and among the teams of one department', async () => {
      const a = await api().post('/api/departments').set('Cookie', session).send({ nameEn: name('Design') }).expect(201);
      const b = await api().post('/api/departments').set('Cookie', session).send({ nameEn: name('Operations') }).expect(201);
      await api().post('/api/departments').set('Cookie', session).send({ nameEn: 'Support', parentId: a.body.id }).expect(201);
      await api().post('/api/departments').set('Cookie', session).send({ nameEn: 'Support', parentId: b.body.id }).expect(201);
      const dup = await api().post('/api/departments').set('Cookie', session).send({ nameEn: 'SUPPORT', parentId: a.body.id }).expect(409);
      expect(dup.body.message).toContain('already a team');
      await api().post('/api/departments').set('Cookie', session).send({ nameEn: name('design').toUpperCase() }).expect(409);
    });

    it('shows an employee in a team with its department', async () => {
      const ops = await api().post('/api/departments').set('Cookie', session).send({ nameEn: name('People Ops') }).expect(201);
      const team = await api().post('/api/departments').set('Cookie', session).send({ nameEn: 'Recruiting', parentId: ops.body.id }).expect(201);
      const job = await api().post('/api/job-titles').set('Cookie', session).send({ departmentId: team.body.id, titleEn: 'Recruiter' }).expect(201);
      const e = await api()
        .post('/api/employees')
        .set('Cookie', session)
        .send({ fullNameEn: name('Recruiter'), fullNameAr: 'مسؤول توظيف', employmentType: 'full_time', joinDate: '2026-02-01', jobTitleId: job.body.id })
        .expect(201);
      expect(e.body.department).toEqual({ id: team.body.id, nameEn: 'Recruiting', nameAr: null, parent: { id: ops.body.id, nameEn: name('People Ops'), nameAr: null } });
      const list = await api().get('/api/employees').set('Cookie', session).expect(200);
      expect(list.body.find((x: { id: string }) => x.id === e.body.id).department.parent.nameEn).toBe(name('People Ops'));
    });
  });

  describe('job titles', () => {
    let departmentId: string;

    beforeAll(async () => {
      const dept = await api().post('/api/departments').set('Cookie', session).send({ nameEn: name('Human Resources') }).expect(201);
      departmentId = dept.body.id;
    });

    it('creates a job title with its job description and duties in order', async () => {
      const res = await api()
        .post('/api/job-titles')
        .set('Cookie', session)
        .send({
          departmentId,
          titleEn: 'HR Specialist',
          titleAr: 'أخصائي موارد بشرية',
          grade: 'G4',
          jdPurpose: 'Run day-to-day HR operations.',
          duties: ['Maintain employee files', '  ', 'Track attendance and leave'],
        })
        .expect(201);
      expect(res.body.jdVersion).toBe(1);
      expect(res.body.department.nameEn).toBe(name('Human Resources'));
      expect(res.body.duties.map((d: { duty: string; position: number }) => [d.position, d.duty])).toEqual([
        [1, 'Maintain employee files'],
        [2, 'Track attendance and leave'],
      ]);
    });

    it('raises the JD version only when the job description changes', async () => {
      const created = await api()
        .post('/api/job-titles')
        .set('Cookie', session)
        .send({ departmentId, titleEn: 'HR Manager', duties: ['Lead the HR team'] })
        .expect(201);
      const id = created.body.id;

      const renamed = await api().patch(`/api/job-titles/${id}`).set('Cookie', session).send({ grade: 'G6' }).expect(200);
      expect(renamed.body.jdVersion).toBe(1);

      const sameDuties = await api()
        .patch(`/api/job-titles/${id}`)
        .set('Cookie', session)
        .send({ duties: ['Lead the HR team'] })
        .expect(200);
      expect(sameDuties.body.jdVersion).toBe(1);

      const newDuties = await api()
        .patch(`/api/job-titles/${id}`)
        .set('Cookie', session)
        .send({ duties: ['Lead the HR team', 'Calibrate KPIs'] })
        .expect(200);
      expect(newDuties.body.jdVersion).toBe(2);
      expect(newDuties.body.duties).toHaveLength(2);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityType: 'job_title', entityId: id, action: 'update' },
        orderBy: { id: 'desc' },
      });
      expect(audit.diff).toMatchObject({ jdVersion: { from: 1, to: 2 } });
    });

    it('filters by department', async () => {
      const res = await api().get(`/api/job-titles?departmentId=${departmentId}`).set('Cookie', session).expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
      expect(res.body.every((j: { departmentId: string }) => j.departmentId === departmentId)).toBe(true);
    });

    it('rejects an unknown department and a duplicate title in the same department', async () => {
      await api()
        .post('/api/job-titles')
        .set('Cookie', session)
        .send({ departmentId: '00000000-0000-4000-8000-000000000000', titleEn: 'Ghost' })
        .expect(404);
      await api().post('/api/job-titles').set('Cookie', session).send({ departmentId, titleEn: 'HR Specialist' }).expect(409);
    });
  });

  describe('shifts', () => {
    it('lists the seeded shifts A and B', async () => {
      const res = await api().get('/api/shifts').set('Cookie', session).expect(200);
      expect(res.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'A', startTime: '09:00', endTime: '18:00', graceMinutes: 15, workingDays: [0, 1, 2, 3, 4] }),
          expect.objectContaining({ code: 'B', startTime: '10:00', endTime: '19:00' }),
        ]),
      );
    });

    it('creates and updates a shift', async () => {
      const code = `T${RUN.slice(-6)}`;
      const created = await api()
        .post('/api/shifts')
        .set('Cookie', session)
        .send({ code: code.toLowerCase(), startTime: '08:00', endTime: '17:00', workingDays: [4, 0, 1] })
        .expect(201);
      expect(created.body).toMatchObject({ code, startTime: '08:00', endTime: '17:00', graceMinutes: 15, workingDays: [0, 1, 4] });

      const updated = await api()
        .patch(`/api/shifts/${created.body.id}`)
        .set('Cookie', session)
        .send({ endTime: '16:30', graceMinutes: 10 })
        .expect(200);
      expect(updated.body).toMatchObject({ startTime: '08:00', endTime: '16:30', graceMinutes: 10 });
    });

    it('rejects bad times, an end before the start and bad working days', async () => {
      await api().post('/api/shifts').set('Cookie', session).send({ code: 'D', startTime: '9:00', endTime: '18:00' }).expect(400);
      await api().post('/api/shifts').set('Cookie', session).send({ code: 'D', startTime: '18:00', endTime: '09:00' }).expect(400);
      await api()
        .post('/api/shifts')
        .set('Cookie', session)
        .send({ code: 'D', startTime: '09:00', endTime: '18:00', workingDays: [7] })
        .expect(400);
      await api().post('/api/shifts').set('Cookie', session).send({ code: 'A', startTime: '09:00', endTime: '18:00' }).expect(409);
    });
  });
});
