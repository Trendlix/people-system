import type { INestApplication } from '@nestjs/common';
import type { ManualChangesView } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, weekday } from '../src/common/date-only.js';
import { firstDay, lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// A change made by hand for an employee (owner, 4 November 2026: "when HR corrects something manually, her manager has to
// be notified in a popup"; asked, "The HR person's manager", "Everything done for an employee", "Shows until marked
// seen"): the direct manager of whoever made it told, on the bell and in the popup's list (GET /me/manual-changes) until
// Seen; nobody when they have no manager; never the employee it was done for, who is never told who did it ("dont show
// the employee that anyone can do anything on their behalf"). These tests look at their own people (names end with RUN)
// and delete what they made. Every name is invented.

const RUN = Date.now().toString(36).toLowerCase();
const NEXT = monthsLater(todayInCairo().slice(0, 7), 1);

describe('Manual changes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hrAlone: string;
  let emailDomainBefore: string | null;
  let deptId: string;
  const sessions: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const people: string[] = [];
  const days: string[] = [];
  const api = () => request(app.getHttpServer());

  /** A profile with a sign-in account of `roles`, hired from 2024 into the test department. */
  async function person(key: string, who: string, roles: ('employee' | 'hr')[], employment: Record<string, unknown> = {}) {
    const email = await createUser(prisma, roles);
    const res = await api().post('/api/employees').set('Cookie', hrAlone).send({ fullNameEn: `${who} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', hrAlone)
      .send({ employmentType: 'full_time', joinDate: '2024-01-01', departmentId: deptId, ...employment })
      .expect(201);
  }

  const changes = async (key: string) => (await api().get('/api/me/manual-changes').set('Cookie', sessions[key]).expect(200)).body as ManualChangesView;
  const inbox = async (key: string) => (await api().get('/api/me/notifications').set('Cookie', sessions[key]).expect(200)).body as { items: { kind: string; title: string }[] };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hrAlone = await signIn(app, await createUser(prisma, ['hr']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hrAlone).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hrAlone).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hrAlone).send({ nameEn: `Manual changes ${RUN}` }).expect(201)).body.id;
    await api().patch('/api/leave/settings').set('Cookie', hrAlone).send({ permissionHoursPerMonth: 4, permissionMaxHoursPerDay: 2 }).expect(200);
    const known = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)));
    for (let d = firstDay(NEXT); d <= lastDay(NEXT); d = addDays(d, 1)) if (weekday(d) <= 4 && !known.has(d)) days.push(d);

    await person('mark', 'Mark Boss', ['employee']);
    await person('hana', 'Hana HR', ['hr'], { managerId: ids.mark });
    await person('omar', 'Omar Staff', ['employee']);
    // an HR person managed by the employee they act for
    await person('lina', 'Lina HR', ['hr'], { managerId: ids.omar });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { user: { employeeId: { in: people } } } });
    await prisma.permissionRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', hrAlone).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  it('tells the HR person’s own manager of what they record and cancel for an employee, in the popup until seen', async () => {
    const recorded = (await api().post('/api/leave/permissions').set('Cookie', sessions.hana).send({ employeeId: ids.omar, date: days[0], hours: 1 }).expect(201)).body as { id: string };
    let mine = await changes('mark');
    expect(mine.total).toBe(1);
    // the names as the manager sees colleagues' (display names, 1 November 2026)
    expect(mine.items[0].title).toMatch(/^Hana HR\b.* recorded a permission for Omar Staff\b/);
    expect(mine.items[0].link).toBe(`/leave/permissions/${recorded.id}`);
    expect(mine.items[0].body).toContain(days[0].slice(8, 10));

    await api().post(`/api/leave/permissions/${recorded.id}/cancel`).set('Cookie', sessions.hana).send({ comment: 'Asked by mistake' }).expect(200);
    mine = await changes('mark');
    expect(mine.total).toBe(2);
    expect(mine.items[0].title).toMatch(/^Hana HR\b.* cancelled Omar Staff\b.*’s permission$/);
    // on the bell too
    expect((await inbox('mark')).items.filter((n) => n.kind === 'manual_change')).toHaveLength(2);

    // Seen: gone from the popup, read on the bell
    expect((await api().post('/api/me/manual-changes/seen').set('Cookie', sessions.mark).expect(200)).body).toEqual({ marked: 2 });
    expect(await changes('mark')).toEqual({ items: [], total: 0 });
  });

  it('never tells the employee it was done for, nor that anyone did it; nobody when the one who did it has no manager', async () => {
    // Omar was told of nothing done by hand, and never "by HR"
    const omars = (await inbox('omar')).items;
    expect(omars.some((n) => n.kind === 'manual_change')).toBe(false);
    expect(omars.some((n) => / by HR| by a Super Admin/.test(n.title))).toBe(false);
    // Lina's manager is Omar himself: he isn't told what was done for him
    await api().post('/api/leave/permissions').set('Cookie', sessions.lina).send({ employeeId: ids.omar, date: days[1], hours: 1 }).expect(201);
    expect((await changes('omar')).total).toBe(0);
    // an HR account with no employee profile (no manager): recorded, nobody told
    await api().post('/api/leave/permissions').set('Cookie', hrAlone).send({ employeeId: ids.omar, date: days[2], hours: 1 }).expect(201);
    expect((await changes('mark')).total).toBe(0);
    // the HR person's own popup lists nothing of theirs
    expect((await changes('hana')).total).toBe(0);
  });
});
