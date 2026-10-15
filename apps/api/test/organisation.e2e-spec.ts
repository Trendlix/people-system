import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Unique names per run: the test files share one database (emptied at the start of each run).
const NOT_A_TEAM = '00000000-0000-4000-8000-000000000000'; // neither a department nor a team
const RUN = Date.now().toString(36).toUpperCase();
const name = (base: string) => `${base} ${RUN}`;

describe('Organisation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let session: string;
  let gradeIds: Map<string, string>;
  const api = () => request(app.getHttpServer());
  const grade = (code: string) => gradeIds.get(code);
  /** A new profile, hired straight away (POST /employees adds the profile, the employment comes after); answers the profile. */
  const addHired = async (fullNameEn: string, employment: Record<string, unknown>) => {
    const e = await api().post('/api/employees').set('Cookie', session).send({ fullNameEn, fullNameAr: 'موظف' }).expect(201);
    const hired = await api().post(`/api/employees/${e.body.id}/employments`).set('Cookie', session).send(employment).expect(201);
    return hired.body as { id: string; employment: { id: string; department: unknown; gradeId: string | null; grade: unknown } };
  };
  /** A new department with one team in it; answers the team. */
  const newTeam = async (department: string, team = 'Core Team') => {
    const dept = await api().post('/api/departments').set('Cookie', session).send({ nameEn: name(department) }).expect(201);
    const res = await api().post('/api/departments').set('Cookie', session).send({ nameEn: team, parentId: dept.body.id }).expect(201);
    return res.body as { id: string; parentId: string; nameEn: string };
  };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    session = await signIn(app, await createUser(prisma, ['hr']));
    const grades = await api().get('/api/grades').set('Cookie', session).expect(200);
    gradeIds = new Map((grades.body as { id: string; code: string }[]).map((g) => [g.code, g.id]));
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

    it('will not delete a team that still has job titles', async () => {
      const team = await newTeam('Video');
      await api().post('/api/job-titles').set('Cookie', session).send({ departmentId: team.id, titleEn: 'Video Producer' }).expect(201);
      const res = await api().delete(`/api/departments/${team.id}`).set('Cookie', session).expect(409);
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
      expect(main.body.children).toEqual([{ id: content.body.id, nameEn: name('Content Team'), nameAr: 'فريق المحتوى', sortOrder: 1, _count: { jobTitles: 0 } }]);

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

      // taking the team out makes it a department of its own, which keeps the team's job titles: a job title can belong
      // to a department directly (owner's decision, 15 October 2026)
      const moved = await api().patch(`/api/departments/${content.body.id}`).set('Cookie', session).send({ parentId: '' }).expect(200);
      expect(moved.body).toMatchObject({ parentId: null, parent: null, _count: { jobTitles: 1 } });
      const kept = await api().get(`/api/job-titles/${job.body.id}`).set('Cookie', session).expect(200);
      expect(kept.body.department).toEqual({ id: content.body.id, nameEn: name('Content Team'), nameAr: 'فريق المحتوى', parent: null });
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
      const e = await addHired(name('Recruiter'), { employmentType: 'full_time', joinDate: '2026-02-01', jobTitleId: job.body.id });
      expect(e.employment.department).toEqual({ id: team.body.id, nameEn: 'Recruiting', nameAr: null, parent: { id: ops.body.id, nameEn: name('People Ops'), nameAr: null } });
      const list = await api().get('/api/employees').set('Cookie', session).expect(200);
      expect(list.body.find((x: { id: string }) => x.id === e.id).employment.department.parent.nameEn).toBe(name('People Ops'));
    });

    it('places an employee with a department’s own job title in that department, not in one of its teams', async () => {
      const team = await newTeam('Brand', 'Social Team');
      const dept = team.parentId;
      const head = await api().post('/api/job-titles').set('Cookie', session).send({ departmentId: dept, titleEn: 'Head of Brand' }).expect(201);

      // the department chosen with it, or left out: it follows the job title
      const chosen = await addHired(name('Head of Brand'), { employmentType: 'full_time', joinDate: '2026-02-01', jobTitleId: head.body.id, departmentId: dept });
      expect(chosen.employment.department).toEqual({ id: dept, nameEn: name('Brand'), nameAr: null, parent: null });
      const followed = await addHired(name('Acting Head'), { employmentType: 'full_time', joinDate: '2026-02-01', jobTitleId: head.body.id });
      expect(followed.employment.department).toMatchObject({ id: dept, parent: null });

      // the job title belongs to the department itself, so one of its teams is not its place
      const e = await api().post('/api/employees').set('Cookie', session).send({ fullNameEn: name('Misplaced Head'), fullNameAr: 'موظف' }).expect(201);
      const refused = await api()
        .post(`/api/employees/${e.body.id}/employments`)
        .set('Cookie', session)
        .send({ employmentType: 'full_time', joinDate: '2026-02-01', jobTitleId: head.body.id, departmentId: team.id })
        .expect(400);
      expect(refused.body.message).toBe(`The job title "Head of Brand" belongs to ${name('Brand')}. Choose that department, or another job title.`);
    });
  });

  describe('grades', () => {
    it('starts with G1 Entry Level to G9 Executive, lowest rank first', async () => {
      const res = await api().get('/api/grades').set('Cookie', session).expect(200);
      const seeded = (res.body as { code: string; rank: number; levelEn: string }[]).filter((g) => /^G[1-9]$/.test(g.code));
      expect(seeded.map((g) => `${g.code} ${g.levelEn}`)).toEqual([
        'G1 Entry Level',
        'G2 Junior',
        'G3 Intermediate',
        'G4 Senior',
        'G5 Team Lead',
        'G6 Manager',
        'G7 Head of Department',
        'G8 Director',
        'G9 Executive',
      ]);
    });

    it('adds, changes and deletes a grade; codes and ranks stay unique; a grade in use stays', async () => {
      // a rank and code no grade has, whatever other tests added
      const taken = new Set(((await api().get('/api/grades').set('Cookie', session).expect(200)).body as { rank: number }[]).map((g) => g.rank));
      let rank = 50;
      while (taken.has(rank)) rank++;
      const code = `T${RUN}`;
      const created = await api().post('/api/grades').set('Cookie', session).send({ code: code.toLowerCase(), rank, levelEn: 'Trial' }).expect(201);
      expect(created.body).toMatchObject({ code, rank, levelEn: 'Trial', _count: { jobTitles: 0, employments: 0 } });
      await api().post('/api/grades').set('Cookie', session).send({ code, rank: rank + 1, levelEn: 'Copy' }).expect(409);
      await api().post('/api/grades').set('Cookie', session).send({ code: `${code}X`, rank, levelEn: 'Copy' }).expect(409);
      const changed = await api().patch(`/api/grades/${created.body.id}`).set('Cookie', session).send({ levelAr: 'تجريبي' }).expect(200);
      expect(changed.body.levelAr).toBe('تجريبي');

      const team = await newTeam('Graded');
      const job = await api()
        .post('/api/job-titles')
        .set('Cookie', session)
        .send({ departmentId: team.id, titleEn: 'Trial Role', minGradeId: created.body.id, maxGradeId: created.body.id })
        .expect(201);
      const refused = await api().delete(`/api/grades/${created.body.id}`).set('Cookie', session).expect(409);
      expect(refused.body.message).toBe(`${code} is used by 1 job title range. Give them another grade before deleting it.`);

      // an employee's grade is their employment's own (owner's decision, 15 October 2026)
      const e = await addHired(name('Graded Person'), { employmentType: 'full_time', joinDate: '2026-03-01', jobTitleId: job.body.id, gradeId: created.body.id });
      expect(e.employment.grade).toMatchObject({ code, levelEn: 'Trial', levelAr: 'تجريبي' });

      // a job title counts once, whichever end of its range the grade is
      const other = await api()
        .post('/api/job-titles')
        .set('Cookie', session)
        .send({ departmentId: team.id, titleEn: 'Trial Lead', minGradeId: grade('G1'), maxGradeId: created.body.id })
        .expect(201);
      const listed = ((await api().get('/api/grades').set('Cookie', session).expect(200)).body as { id: string; _count: unknown }[]).find(
        (g) => g.id === created.body.id,
      );
      expect(listed?._count).toEqual({ jobTitles: 2, employments: 1 });
      const used = await api().delete(`/api/grades/${created.body.id}`).set('Cookie', session).expect(409);
      expect(used.body.message).toBe(`${code} is used by 2 job title ranges and 1 employment. Give them another grade before deleting it.`);

      await api().delete(`/api/employees/${e.id}`).set('Cookie', session).expect(204);
      await api().delete(`/api/job-titles/${other.body.id}`).set('Cookie', session).expect(204);
      await api().patch(`/api/job-titles/${job.body.id}`).set('Cookie', session).send({ minGradeId: '', maxGradeId: null }).expect(200);
      expect((await api().get(`/api/grades/${created.body.id}`).set('Cookie', session).expect(200)).body._count).toEqual({ jobTitles: 0, employments: 0 });
      await api().delete(`/api/grades/${created.body.id}`).set('Cookie', session).expect(204);
    });

    it('refuses an unknown grade on a job title', async () => {
      const team = await newTeam('Ungraded');
      for (const end of ['minGradeId', 'maxGradeId']) {
        const res = await api()
          .post('/api/job-titles')
          .set('Cookie', session)
          .send({ departmentId: team.id, titleEn: 'Nobody', [end]: '00000000-0000-4000-8000-000000000000' })
          .expect(404);
        expect(res.body.message).toBe('Grade not found. Choose one from the list.');
      }
    });
  });

  describe('order', () => {
    let admin: string;
    const topLevel = async () =>
      ((await api().get('/api/departments').set('Cookie', session).expect(200)).body as { id: string; parentId: string | null; sortOrder: number }[]).filter(
        (d) => d.parentId === null,
      );

    beforeAll(async () => {
      admin = await signIn(app, await createUser(prisma, ['admin']));
    });

    it('lets an Admin set the order of the departments, and puts a new one last', async () => {
      const before = await topLevel();
      const reversed = before.map((d) => d.id).reverse();
      await api().put('/api/departments/order').set('Cookie', session).send({ ids: reversed }).expect(403); // HR may not
      await api().put('/api/departments/order').set('Cookie', admin).send({ ids: reversed.slice(1) }).expect(400); // one missing
      await api().put('/api/departments/order').set('Cookie', admin).send({ ids: reversed }).expect(204);
      expect((await topLevel()).map((d) => d.id)).toEqual(reversed);

      const added = await api().post('/api/departments').set('Cookie', session).send({ nameEn: name('Aaa First By Name') }).expect(201);
      expect((await topLevel()).at(-1)?.id).toBe(added.body.id);

      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'department', action: 'reorder' }, orderBy: { id: 'desc' } });
      const saved = (audit?.diff ?? null) as { order?: string[] } | null;
      expect(saved?.order).toHaveLength(reversed.length);
    });

    it('lets an Admin set the order of one department’s teams', async () => {
      const dept = await api().post('/api/departments').set('Cookie', session).send({ nameEn: name('Creative') }).expect(201);
      const ids: string[] = [];
      for (const team of ['Art', 'Copy', 'Video']) {
        ids.push((await api().post('/api/departments').set('Cookie', session).send({ nameEn: team, parentId: dept.body.id }).expect(201)).body.id);
      }
      const order = [ids[2], ids[0], ids[1]];
      await api().put('/api/departments/order').set('Cookie', admin).send({ parentId: dept.body.id, ids: order }).expect(204);
      const page = await api().get(`/api/departments/${dept.body.id}`).set('Cookie', session).expect(200);
      expect(page.body.children.map((c: { id: string }) => c.id)).toEqual(order);
      // a team of another department doesn't belong in this list
      await api().put('/api/departments/order').set('Cookie', admin).send({ parentId: dept.body.id, ids: [...order.slice(1), NOT_A_TEAM] }).expect(400);
    });
  });

  describe('job titles', () => {
    let departmentId: string; // a team (a job title can also belong to a department directly)

    beforeAll(async () => {
      departmentId = (await newTeam('Human Resources', 'People Team')).id;
    });

    it('goes directly in a department, e.g. Head of Marketing (owner’s decision, 15 October 2026)', async () => {
      const dept = await api().post('/api/departments').set('Cookie', session).send({ nameEn: name('Marketing Direct') }).expect(201);
      const res = await api()
        .post('/api/job-titles')
        .set('Cookie', session)
        .send({ departmentId: dept.body.id, titleEn: 'Head of Marketing', maxGradeId: grade('G7') })
        .expect(201);
      expect(res.body).toMatchObject({ departmentId: dept.body.id, department: { id: dept.body.id, nameEn: name('Marketing Direct'), parent: null } });

      // counted on the department, listed under it, and in the audit log
      expect((await api().get(`/api/departments/${dept.body.id}`).set('Cookie', session).expect(200)).body._count.jobTitles).toBe(1);
      const listed = await api().get(`/api/job-titles?departmentId=${dept.body.id}`).set('Cookie', session).expect(200);
      expect(listed.body.map((j: { titleEn: string }) => j.titleEn)).toEqual(['Head of Marketing']);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'job_title', entityId: res.body.id, action: 'create' } });
      expect(audit.diff).toMatchObject({ departmentId: dept.body.id, titleEn: 'Head of Marketing' });

      // unique within the department, as within a team; the department can't be deleted while it holds a job title
      await api().post('/api/job-titles').set('Cookie', session).send({ departmentId: dept.body.id, titleEn: 'Head of Marketing' }).expect(409);
      const kept = await api().delete(`/api/departments/${dept.body.id}`).set('Cookie', session).expect(409);
      expect(kept.body.message).toBe('This department has 1 job title(s). Move or delete them before deleting the department.');
    });

    it('moves between a department and one of its teams, both ways, taking its current holders along, with audit entries', async () => {
      const team = await newTeam('Studio', 'Design Team');
      const dept = team.parentId;
      const created = await api().post('/api/job-titles').set('Cookie', session).send({ departmentId: dept, titleEn: 'Creative Director' }).expect(201);
      const id = created.body.id as string;
      const move = (departmentId: string) => api().patch(`/api/job-titles/${id}`).set('Cookie', session).send({ departmentId });
      const holder = await addHired(name('Creative Lead'), { employmentType: 'full_time', joinDate: '2026-02-01', jobTitleId: id });
      const placeOf = async () => (await prisma.employment.findUniqueOrThrow({ where: { id: holder.employment.id } })).departmentId;

      const intoTeam = await move(team.id).expect(200);
      expect(intoTeam.body.department).toEqual({ id: team.id, nameEn: 'Design Team', nameAr: null, parent: { id: dept, nameEn: name('Studio'), nameAr: null } });
      expect(await placeOf()).toBe(team.id); // the holder moved with the title
      const backUp = await move(dept).expect(200);
      expect(backUp.body.department).toEqual({ id: dept, nameEn: name('Studio'), nameAr: null, parent: null });
      expect(await placeOf()).toBe(dept);
      // and HR can still save the holder's employment as it now is
      await api().patch(`/api/employees/${holder.id}/employments/${holder.employment.id}`).set('Cookie', session).send({ departmentId: dept, jobTitleId: id }).expect(200);
      // a rename alone leaves it where it is
      const renamed = await api().patch(`/api/job-titles/${id}`).set('Cookie', session).send({ titleEn: 'Executive Creative Director' }).expect(200);
      expect(renamed.body.departmentId).toBe(dept);

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'job_title', entityId: id, action: 'update' }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.diff)).toEqual([
        { departmentId: { from: dept, to: team.id }, holdersMoved: 1 },
        { departmentId: { from: team.id, to: dept }, holdersMoved: 1 },
        { titleEn: { from: 'Creative Director', to: 'Executive Creative Director' } },
      ]);
    });

    it('creates a job title with its job description and duties in order', async () => {
      const res = await api()
        .post('/api/job-titles')
        .set('Cookie', session)
        .send({
          departmentId,
          titleEn: 'HR Specialist',
          titleAr: 'أخصائي موارد بشرية',
          minGradeId: grade('G3'),
          maxGradeId: grade('G6'),
          jdPurpose: 'Run day-to-day HR operations.',
          duties: ['Maintain employee files', '  ', 'Track attendance and leave'],
        })
        .expect(201);
      expect(res.body.jdVersion).toBe(1);
      expect(res.body).toMatchObject({
        minGradeId: grade('G3'),
        minGrade: { id: grade('G3'), code: 'G3', rank: 3, levelEn: 'Intermediate', levelAr: null },
        maxGradeId: grade('G6'),
        maxGrade: { id: grade('G6'), code: 'G6', rank: 6, levelEn: 'Manager', levelAr: null },
      });
      expect(res.body).not.toHaveProperty('grade');
      expect(res.body).not.toHaveProperty('gradeId');
      expect(res.body.department).toMatchObject({ nameEn: 'People Team', parent: { nameEn: name('Human Resources') } });
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

      const renamed = await api().patch(`/api/job-titles/${id}`).set('Cookie', session).send({ maxGradeId: grade('G6') }).expect(200);
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

    it('filters by team', async () => {
      const res = await api().get(`/api/job-titles?departmentId=${departmentId}`).set('Cookie', session).expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
      expect(res.body.every((j: { departmentId: string }) => j.departmentId === departmentId)).toBe(true);
      // with the range of grades each takes
      const specialist = (res.body as { titleEn: string }[]).find((j) => j.titleEn === 'HR Specialist');
      expect(specialist).toMatchObject({ minGrade: { code: 'G3', rank: 3 }, maxGrade: { code: 'G6', rank: 6 } });
      expect(specialist).not.toHaveProperty('grade');
    });

    it('takes a range of grades: either end can be empty, a change keeps the other end as saved, never reversed', async () => {
      const reversed = await api()
        .post('/api/job-titles')
        .set('Cookie', session)
        .send({ departmentId, titleEn: 'Backwards', minGradeId: grade('G6'), maxGradeId: grade('G3') })
        .expect(400);
      expect(reversed.body.message).toBe('The lowest grade must be at or below the highest.');

      const created = await api()
        .post('/api/job-titles')
        .set('Cookie', session)
        .send({ departmentId, titleEn: 'Account Manager', minGradeId: grade('G3'), maxGradeId: grade('G6') })
        .expect(201);
      const id = created.body.id as string;
      const change = (body: object) => api().patch(`/api/job-titles/${id}`).set('Cookie', session).send(body);

      // one end at a time, against the other as saved
      expect((await change({ minGradeId: grade('G7') }).expect(400)).body.message).toBe('The lowest grade must be at or below the highest.');
      expect((await change({ maxGradeId: grade('G2') }).expect(400)).body.message).toBe('The lowest grade must be at or below the highest.');
      const single = await change({ minGradeId: grade('G6') }).expect(200); // G6 to G6
      expect(single.body).toMatchObject({ minGrade: { code: 'G6' }, maxGrade: { code: 'G6' } });

      const fromNone = await change({ minGradeId: '' }).expect(200);
      expect(fromNone.body).toMatchObject({ minGradeId: null, minGrade: null, maxGrade: { code: 'G6' } });
      const any = await change({ maxGradeId: null }).expect(200);
      expect(any.body).toMatchObject({ minGrade: null, maxGrade: null });

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'job_title', entityId: id }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.diff)).toEqual([
        expect.objectContaining({ titleEn: 'Account Manager', minGradeId: grade('G3'), maxGradeId: grade('G6') }),
        { minGradeId: { from: grade('G3'), to: grade('G6') } },
        { minGradeId: { from: grade('G6'), to: null } },
        { maxGradeId: { from: grade('G6'), to: null } },
      ]);
    });

    it('is not narrowed past the grades of the people who hold it now; those who left do not count', async () => {
      const job = await api()
        .post('/api/job-titles')
        .set('Cookie', session)
        .send({ departmentId, titleEn: 'Account Executive', minGradeId: grade('G3'), maxGradeId: grade('G6') })
        .expect(201);
      const change = (body: object) => api().patch(`/api/job-titles/${job.body.id}`).set('Cookie', session).send(body);
      const hire = (who: string, code: string) =>
        addHired(name(who), { employmentType: 'full_time', joinDate: '2026-03-01', jobTitleId: job.body.id, gradeId: grade(code) });
      const leaver = await hire('Executive G5', 'G5');
      await hire('Executive G6', 'G6');

      const narrowed = await change({ maxGradeId: grade('G4') }).expect(409);
      expect(narrowed.body.message).toBe('2 current employees with this title have grades outside G3 to G4. Change their grades first, or widen the range.');
      await change({ maxGradeId: '' }).expect(200); // widening is always fine: from G3
      const below = await change({ minGradeId: grade('G6') }).expect(409);
      expect(below.body.message).toBe('1 current employee with this title has a grade below G6. Change their grade first, or widen the range.');
      const above = await change({ minGradeId: '', maxGradeId: grade('G5') }).expect(409);
      expect(above.body.message).toBe('1 current employee with this title has a grade above G5. Change their grade first, or widen the range.');

      // once the G5 employee has left, the range can start at G6; their history keeps the grade they had
      await api()
        .post(`/api/employees/${leaver.id}/employments/${leaver.employment.id}/end`)
        .set('Cookie', session)
        .send({ endDate: '2026-06-30', endReason: 'resigned' })
        .expect(200);
      const narrower = await change({ minGradeId: grade('G6') }).expect(200);
      expect(narrower.body).toMatchObject({ minGrade: { code: 'G6' }, maxGrade: null });
      const history = await api().get(`/api/employees/${leaver.id}`).set('Cookie', session).expect(200);
      expect(history.body.employments[0]).toMatchObject({ gradeId: grade('G5'), grade: { code: 'G5' } });
    });

    it('rejects an unknown department or team, when created and when moved, and a duplicate title in the same team', async () => {
      const ghost = await api().post('/api/job-titles').set('Cookie', session).send({ departmentId: NOT_A_TEAM, titleEn: 'Ghost' }).expect(404);
      expect(ghost.body.message).toBe('Department or team not found.');
      const job = await api().post('/api/job-titles').set('Cookie', session).send({ departmentId, titleEn: 'HR Coordinator' }).expect(201);
      const lost = await api().patch(`/api/job-titles/${job.body.id}`).set('Cookie', session).send({ departmentId: NOT_A_TEAM }).expect(404);
      expect(lost.body.message).toBe('Department or team not found.');
      expect((await api().get(`/api/job-titles/${job.body.id}`).set('Cookie', session).expect(200)).body.departmentId).toBe(departmentId);
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
