import type { INestApplication } from '@nestjs/common';
import { BACKGROUND_HEADER, zonedMoment } from '@trendlix/shared';
import pg from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, dayInCairo, fromDateOnly, shownDate, todayInCairo, toDateOnly } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { NoticesService } from '../src/notifications/notices.service.js';
import { NotificationsService, PUSH_APP_ONLY, PUSH_NOT_WHILE_VIEWING } from '../src/notifications/notifications.service.js';
import { RemindersService } from '../src/notifications/reminders.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { APP_USER_AGENT, createApp, createUser, signIn } from './helpers.js';

// Notifications (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a check-in
// reminder)"; apps/mobile/README.md, Phase 4): the inbox and its count, the reminder switches, the phones registered
// from the app (an app session only, never while viewing as someone), who each flow tells at each step (the one in
// charge of it, HR never of a C-level person's, the employee once decided), raise requests to HR and the CEO only, home
// locations to HR then the CEO (never with the point or the label), and the reminders with a fake clock: "You haven't
// checked in" from the shift's start every 10 minutes for 2 hours, once a step whichever process sends it, one inbox row
// a day, always on (owner, 20 October 2026: "a reminder for people that didn't checkin and not on a leave every 10
// minutes. like a popup"; "No, always on"), "Still checked in?" once a day, one process at a time; and the popup's
// GET /me/check-in-reminder. Push is off in the tests
// (vitest.config.e2e.ts): everything is in the inbox. These tests look at their own people (names end with RUN).

const RUN = `nt${Date.now().toString(36).toLowerCase()}`;
const TODAY = todayInCairo();

interface Note {
  kind: string;
  title: string;
  body: string;
  link: string | null;
}

describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let notifications: NotificationsService;
  let notices: NoticesService;
  let reminders: RemindersService;
  let hr: string;
  let hr2: string;
  let ceo: string;
  let hrSuper: string;
  let emailDomainBefore: string | null;
  let deptId: string;
  let shiftId: string;
  /** The popup's test's shift, started 30 minutes before it runs. */
  let liveShiftId: string | undefined;
  let typeId: string;
  let claimTypeId: string;
  /** A working day ahead, none of them a holiday: the reminders' day, then the permission's and the leave's. */
  let reminderDay: string;
  let permissionDay: string;
  let leaveDay: string;
  const users: Record<string, string> = {}; // user ids by key (people and the HR, CEO, Finance accounts)
  const sessions: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const employments: Record<string, string> = {};
  const people: string[] = [];
  const api = () => request(app.getHttpServer());
  const userIdOf = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
  const inbox = async (key: string): Promise<Note[]> =>
    prisma.notification.findMany({ where: { userId: users[key] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { kind: true, title: true, body: true, link: true } });
  const kindsOf = async (key: string) => (await inbox(key)).map((n) => n.kind);
  const clear = () => prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
  /** Kept a second apart in the order sent, so newest first is one order (rows made in the same millisecond tie). */
  const spaced = async (key: string, titles: string[]) => {
    const start = Date.now() - titles.length * 1000;
    for (const [i, title] of titles.entries()) await prisma.notification.updateMany({ where: { userId: users[key], title }, data: { createdAt: new Date(start + i * 1000) } });
  };

  async function account(key: string, roles: Parameters<typeof createUser>[1]) {
    const email = await createUser(prisma, roles);
    users[key] = await userIdOf(email);
    sessions[key] = await signIn(app, email);
    return sessions[key];
  }

  /** A profile with a sign-in account and an employment under the test's shift. */
  async function person(key: string, who: string, employment: Record<string, unknown> = {}, by = () => hr) {
    const email = await createUser(prisma, ['employee']);
    users[key] = await userIdOf(email);
    sessions[key] = await signIn(app, email);
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${who} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', by())
      .send({ employmentType: 'full_time', joinDate: '2026-01-01', departmentId: deptId, shiftId, ...employment })
      .expect(201);
    employments[key] = hired.body.employment.id;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    notifications = app.get(NotificationsService);
    notices = app.get(NoticesService);
    reminders = app.get(RemindersService);
    hr = await account('hr', ['hr']);
    hr2 = await account('hr2', ['hr']);
    ceo = await account('ceo', ['ceo']);
    await account('finance', ['finance']);
    hrSuper = await account('hrSuper', ['hr', 'super_admin']);
    await account('superAdmin', ['super_admin']);
    // sign-in accounts here are @test.local: no company email domain while these tests run
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Notices Dept ${RUN}` }).expect(201)).body.id;
    // 9:00–17:00, 15 minutes' grace, every day of the week (so any day ahead is a working day)
    shiftId = (
      await prisma.shift.create({
        data: { code: `N${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('17:00'), hoursPerDay: 8, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4, 5, 6] },
        select: { id: true },
      })
    ).id;
    const holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)));
    const free = (from: string) => {
      let d = from;
      while (holidays.has(d)) d = addDays(d, 1);
      return d;
    };
    reminderDay = free(addDays(TODAY, 3));
    permissionDay = free(addDays(TODAY, 30));
    leaveDay = free(addDays(permissionDay, 3));

    await person('mona', 'Mona Manager');
    await person('rami', 'Rami Report', { managerId: ids.mona });
    await person('noah', 'Noah Nomanager');
    const g9 = ((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((g) => g.code === 'G9')!;
    await person('cleo', 'Cleo Chief', { managerId: ids.mona, gradeId: g9.id }, () => hrSuper);
    typeId = (await prisma.leaveType.findUniqueOrThrow({ where: { key: 'casual' }, select: { id: true } })).id;
    claimTypeId = (await prisma.reimbursementType.create({ data: { nameEn: `Taxi ${RUN}`, nameAr: 'تاكسي', receiptRequired: false }, select: { id: true } })).id;
    await clear();
  });

  afterAll(async () => {
    const userIds = Object.values(users);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.pushDevice.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.reminderSent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notificationSettings.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.permissionRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.reimbursementClaim.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.reimbursementType.deleteMany({ where: { id: claimTypeId } });
    await prisma.raiseRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.homeLocationRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people }, managerId: { not: null } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: { in: [shiftId, ...(liveShiftId ? [liveShiftId] : [])] } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('the inbox', () => {
    afterAll(clear);

    it('lists the user’s own, newest first, with the unread count; marks one or all read', async () => {
      for (const n of [1, 2, 3]) await notifications.notify([users.rami], { kind: 'leave_decided', title: `Leave request approved ${n}`, body: '22/10/2026', link: '/leave/x' });
      await notifications.notify([users.mona], { kind: 'leave_waiting', title: 'For Mona only', body: 'x' });
      await spaced('rami', ['Leave request approved 1', 'Leave request approved 2', 'Leave request approved 3']);
      const page = (await api().get('/api/me/notifications').set('Cookie', sessions.rami).expect(200)).body;
      expect(page).toMatchObject({ page: 1, pageSize: 20, total: 3, unread: 3 });
      expect(page.items.map((n: Note) => n.title)).toEqual(['Leave request approved 3', 'Leave request approved 2', 'Leave request approved 1']);
      expect(page.items[0]).toEqual({ id: expect.any(String), kind: 'leave_decided', title: 'Leave request approved 3', body: '22/10/2026', link: '/leave/x', readAt: null, createdAt: expect.any(String) });
      expect((await api().get('/api/me/notifications/unread-count').set('Cookie', sessions.rami).expect(200)).body).toEqual({ unread: 3 });

      await api().post(`/api/me/notifications/${page.items[1].id}/read`).set('Cookie', sessions.rami).expect(204);
      // again: as it is
      await api().post(`/api/me/notifications/${page.items[1].id}/read`).set('Cookie', sessions.rami).expect(204);
      expect((await api().get('/api/me/notifications/unread-count').set('Cookie', sessions.rami).expect(200)).body).toEqual({ unread: 2 });
      // someone else's isn't there
      const monas = (await api().get('/api/me/notifications').set('Cookie', sessions.mona).expect(200)).body.items as { id: string }[];
      await api().post(`/api/me/notifications/${monas[0].id}/read`).set('Cookie', sessions.rami).expect(404);
      await api().post('/api/me/notifications/not-an-id/read').set('Cookie', sessions.rami).expect(400);

      expect((await api().post('/api/me/notifications/read-all').set('Cookie', sessions.rami).expect(200)).body).toEqual({ marked: 2 });
      expect((await api().get('/api/me/notifications/unread-count').set('Cookie', sessions.rami).expect(200)).body).toEqual({ unread: 0 });
      expect((await api().get('/api/me/notifications/unread-count').set('Cookie', sessions.mona).expect(200)).body).toEqual({ unread: 1 });
      await api().get('/api/me/notifications/unread-count').expect(401);
    });

    it('pages by 20, and refuses a page that isn’t one', async () => {
      for (let n = 0; n < 21; n++) await notifications.notify([users.noah], { kind: 'payslip_issued', title: `Payslip ${n}`, body: '' });
      await spaced('noah', Array.from({ length: 21 }, (_, n) => `Payslip ${n}`));
      expect((await api().get('/api/me/notifications').set('Cookie', sessions.noah).expect(200)).body.items).toHaveLength(20);
      expect((await api().get('/api/me/notifications?page=2').set('Cookie', sessions.noah).expect(200)).body).toMatchObject({ page: 2, total: 21, items: [{ title: 'Payslip 0' }] });
      await api().get('/api/me/notifications?page=0').set('Cookie', sessions.noah).expect(400);
      await api().get('/api/me/notifications?page=x').set('Cookie', sessions.noah).expect(400);
    });

    it('keeps a link only on the site, never an unknown kind, never an inactive user, and never throws', async () => {
      await notifications.notify([users.mona, users.mona, null, undefined, ''], { kind: 'leave_waiting', title: 'Once', body: 'b', link: 'https://evil.example/x' });
      expect((await inbox('mona')).filter((n) => n.title === 'Once')).toEqual([{ kind: 'leave_waiting', title: 'Once', body: 'b', link: null }]);
      await notifications.notify([users.mona], { kind: 'salary_changed' as never, title: 'Never', body: 'b' });
      expect((await inbox('mona')).some((n) => n.title === 'Never')).toBe(false);
      const gone = await createUser(prisma, ['employee']);
      const goneId = await userIdOf(gone);
      await prisma.user.update({ where: { id: goneId }, data: { isActive: false } });
      await notifications.notify([goneId], { kind: 'leave_waiting', title: 'Not kept', body: 'b' });
      expect(await prisma.notification.count({ where: { userId: goneId } })).toBe(0);
      // a user who isn't there: nothing kept, nothing thrown
      await expect(notifications.notify(['00000000-0000-4000-8000-000000000000'], { kind: 'leave_waiting', title: 't', body: 'b' })).resolves.toBeUndefined();
    });
  });

  describe('the reminder switches', () => {
    it('"Still checked in?" on until switched off; "You haven’t checked in" always on (a change to it left aside)', async () => {
      expect((await api().get('/api/me/notification-settings').set('Cookie', sessions.rami).expect(200)).body).toEqual({ checkInReminder: true, checkOutReminder: true });
      expect((await api().put('/api/me/notification-settings').set('Cookie', sessions.rami).send({ checkOutReminder: false }).expect(200)).body).toEqual({ checkInReminder: true, checkOutReminder: false });
      // owner, 20 October 2026: "No, always on"
      expect((await api().put('/api/me/notification-settings').set('Cookie', sessions.rami).send({ checkInReminder: false }).expect(200)).body).toEqual({ checkInReminder: true, checkOutReminder: false });
      expect((await api().get('/api/me/notification-settings').set('Cookie', sessions.rami).expect(200)).body).toEqual({ checkInReminder: true, checkOutReminder: false });
      await api().put('/api/me/notification-settings').set('Cookie', sessions.rami).send({ checkInReminder: 'yes' }).expect(400);
      await api().put('/api/me/notification-settings').set('Cookie', sessions.rami).send({ other: true }).expect(400);
      expect((await api().put('/api/me/notification-settings').set('Cookie', sessions.rami).send({ checkInReminder: true, checkOutReminder: true }).expect(200)).body).toEqual({ checkInReminder: true, checkOutReminder: true });
    });
  });

  describe('the phones', () => {
    const TOKEN = `fcm-token-${RUN}-rami`;

    it('registers from an app session only, refreshes, moves a shared phone to the last to sign in, and unregisters', async () => {
      expect((await api().post('/api/me/push-devices').set('Cookie', sessions.rami).send({ token: TOKEN, platform: 'android' }).expect(403)).body.message).toBe(PUSH_APP_ONLY);
      const ramiPhone = await signIn(app, (await prisma.user.findUniqueOrThrow({ where: { id: users.rami } })).email, APP_USER_AGENT);
      await api().post('/api/me/push-devices').set('Cookie', ramiPhone).send({ token: TOKEN, platform: 'android' }).expect(204);
      const first = await prisma.pushDevice.findUniqueOrThrow({ where: { token: TOKEN } });
      expect(first).toMatchObject({ userId: users.rami, platform: 'android' });
      await api().post('/api/me/push-devices').set('Cookie', ramiPhone).send({ token: TOKEN, platform: 'android' }).expect(204);
      const again = await prisma.pushDevice.findUniqueOrThrow({ where: { token: TOKEN } });
      expect(again.id).toBe(first.id);
      expect(again.lastSeenAt.getTime()).toBeGreaterThanOrEqual(first.lastSeenAt.getTime());
      await api().post('/api/me/push-devices').set('Cookie', ramiPhone).send({ token: TOKEN, platform: 'windows' }).expect(400);
      await api().post('/api/me/push-devices').set('Cookie', ramiPhone).send({ token: '', platform: 'android' }).expect(400);

      // Mona signs in on the same phone: its notifications are hers now
      const monaPhone = await signIn(app, (await prisma.user.findUniqueOrThrow({ where: { id: users.mona } })).email, APP_USER_AGENT);
      await api().post('/api/me/push-devices').set('Cookie', monaPhone).send({ token: TOKEN, platform: 'android' }).expect(204);
      expect(await prisma.pushDevice.findMany({ where: { token: TOKEN }, select: { userId: true } })).toEqual([{ userId: users.mona }]);

      // she signs out in the app: the phone gets nobody's
      await api().post('/api/me/push-devices/unregister').set('Cookie', monaPhone).send({ token: TOKEN }).expect(204);
      expect(await prisma.pushDevice.count({ where: { token: TOKEN } })).toBe(0);
      await api().post('/api/me/push-devices/unregister').set('Cookie', monaPhone).send({ token: TOKEN }).expect(204);
    });

    it('never while viewing as someone, even acting as them', async () => {
      const email = (await prisma.user.findUniqueOrThrow({ where: { id: users.superAdmin } })).email;
      const phone = await signIn(app, email, APP_USER_AGENT);
      const cookieOf = (res: request.Response) => ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='))!.split(';')[0];
      const viewing = cookieOf(await api().post('/api/auth/view-as').set('Cookie', phone).send({ userId: users.rami }).expect(200));
      await api().post('/api/me/push-devices').set('Cookie', viewing).send({ token: `fcm-token-${RUN}-va`, platform: 'android' }).expect(403);
      const acting = cookieOf(await api().post('/api/auth/view-as/act').set('Cookie', viewing).send({ act: true }).expect(200));
      expect((await api().post('/api/me/push-devices').set('Cookie', acting).send({ token: `fcm-token-${RUN}-va`, platform: 'android' }).expect(403)).body.message).toBe(PUSH_NOT_WHILE_VIEWING);
      expect(await prisma.pushDevice.count({ where: { token: `fcm-token-${RUN}-va` } })).toBe(0);
      await api().post('/api/auth/view-as/stop').set('Cookie', acting).expect(200);
    });
  });

  describe('who each step tells', () => {
    beforeEach(clear);

    it('permission: the manager it was sent to, then HR, then the employee', async () => {
      const asked = await api().post('/api/me/permissions').set('Cookie', sessions.rami).send({ date: permissionDay, hours: 2 }).expect(201);
      const id = asked.body.id as string;
      const link = `/leave/permissions/${id}`;
      expect(await inbox('mona')).toEqual([{ kind: 'permission_waiting', title: 'A permission request is waiting for you', body: `Rami Report ${RUN}, ${shownDate(permissionDay)}`, link }]);
      expect(await kindsOf('hr')).toEqual([]);
      expect(await kindsOf('rami')).toEqual([]);

      await api().post(`/api/leave/permissions/${id}/decide`).set('Cookie', sessions.mona).send({ decision: 'approve' }).expect(200);
      for (const key of ['hr', 'hr2', 'hrSuper']) expect(await inbox(key)).toEqual([{ kind: 'permission_waiting', title: 'A permission request is waiting for you', body: `Rami Report ${RUN}, ${shownDate(permissionDay)}`, link }]);
      for (const key of ['ceo', 'finance', 'rami']) expect(await kindsOf(key)).toEqual([]);

      await api().post(`/api/leave/permissions/${id}/decide`).set('Cookie', hr).send({ decision: 'approve' }).expect(200);
      expect(await inbox('rami')).toEqual([{ kind: 'permission_decided', title: 'Permission request approved', body: shownDate(permissionDay), link }]);
      expect(await kindsOf('hr2')).toEqual(['permission_waiting']);

      await api().post(`/api/leave/permissions/${id}/cancel`).set('Cookie', hr2).send({ comment: 'Invented: the day was changed' }).expect(200);
      expect((await inbox('rami')).at(-1)).toEqual({ kind: 'permission_decided', title: 'Permission cancelled by HR', body: shownDate(permissionDay), link });
    });

    it('a C-level person’s: the manager, then the CEO and HR with Super Admin, never HR', async () => {
      const id = (await api().post('/api/me/permissions').set('Cookie', sessions.cleo).send({ date: permissionDay, hours: 1 }).expect(201)).body.id as string;
      expect(await kindsOf('mona')).toEqual(['permission_waiting']);
      await api().post(`/api/leave/permissions/${id}/decide`).set('Cookie', sessions.mona).send({ decision: 'approve' }).expect(200);
      expect(await kindsOf('ceo')).toEqual(['permission_waiting']);
      expect(await kindsOf('hrSuper')).toEqual(['permission_waiting']);
      for (const key of ['hr', 'hr2', 'finance']) expect(await kindsOf(key)).toEqual([]);
      await api().post(`/api/leave/permissions/${id}/decide`).set('Cookie', ceo).send({ decision: 'reject', comment: 'Invented: not that day' }).expect(200);
      // the employee is told, without the comment
      expect(await inbox('cleo')).toEqual([{ kind: 'permission_decided', title: 'Permission request rejected', body: shownDate(permissionDay), link: `/leave/permissions/${id}` }]);
    });

    it('leave: the manager’s decision moves it to HR; no manager: straight to HR', async () => {
      const made = await prisma.leaveRequest.create({
        data: {
          employeeId: ids.rami,
          employmentId: employments.rami,
          typeId,
          startDate: toDateOnly(leaveDay),
          endDate: toDateOnly(addDays(leaveDay, 1)),
          days: 2,
          status: 'with_manager',
          managerId: ids.mona,
          approverRole: 'direct_manager',
          createdById: users.rami,
        },
        select: { id: true },
      });
      const when = `${shownDate(leaveDay)}–${shownDate(addDays(leaveDay, 1))}`;
      await notices.leave(made.id, 'sent');
      expect(await inbox('mona')).toEqual([{ kind: 'leave_waiting', title: 'A leave request is waiting for you', body: `Rami Report ${RUN}, ${when}`, link: `/leave/${made.id}` }]);
      await api().post(`/api/leave/requests/${made.id}/decide`).set('Cookie', sessions.mona).send({ decision: 'approve' }).expect(200);
      expect(await kindsOf('hr')).toEqual(['leave_waiting']);
      expect(await kindsOf('rami')).toEqual([]);
      await api().post(`/api/leave/requests/${made.id}/decide`).set('Cookie', hr2).send({ decision: 'reject', comment: 'Invented: the team is away' }).expect(200);
      expect(await inbox('rami')).toEqual([{ kind: 'leave_decided', title: 'Leave request rejected', body: when, link: `/leave/${made.id}` }]);

      const half = await prisma.leaveRequest.create({
        data: { employeeId: ids.noah, employmentId: employments.noah, typeId, startDate: toDateOnly(leaveDay), endDate: toDateOnly(leaveDay), halfDay: true, days: 0.5, status: 'with_hr', createdById: users.noah },
        select: { id: true },
      });
      await notices.leave(half.id, 'sent');
      expect((await inbox('hr')).at(-1)).toEqual({ kind: 'leave_waiting', title: 'A leave request is waiting for you', body: `Noah Nomanager ${RUN}, ${shownDate(leaveDay)} (half day)`, link: `/leave/${half.id}` });
      expect(await kindsOf('mona')).toEqual(['leave_waiting']);
    });

    it('a claim: HR, then Finance (the CEO for a C-level person’s), then the employee, and paid', async () => {
      const claim = (key: string, status: string, more: Record<string, unknown> = {}) =>
        prisma.reimbursementClaim.create({
          data: { employeeId: ids[key], employmentId: employments[key], typeId: claimTypeId, expenseDate: toDateOnly(TODAY), amount: 250, description: 'Invented taxi', status, createdById: users[key], ...more },
          select: { id: true },
        });
      const atFinance = await claim('noah', 'with_finance');
      await notices.reimbursement(atFinance.id, 'decided');
      expect(await inbox('finance')).toEqual([{ kind: 'reimbursement_waiting', title: 'A reimbursement claim is waiting for you', body: `Noah Nomanager ${RUN}, ${shownDate(TODAY)}`, link: `/reimbursements/${atFinance.id}` }]);
      for (const key of ['hr', 'ceo', 'noah']) expect(await kindsOf(key)).toEqual([]);

      const chief = await claim('cleo', 'with_finance');
      await notices.reimbursement(chief.id, 'decided');
      expect(await kindsOf('ceo')).toEqual(['reimbursement_waiting']);
      expect(await kindsOf('finance')).toEqual(['reimbursement_waiting']);

      const approved = await claim('noah', 'approved', { approvedAmount: 250, payMonth: toDateOnly(`${TODAY.slice(0, 7)}-01`) });
      await notices.reimbursement(approved.id, 'decided');
      expect((await inbox('noah')).at(-1)).toMatchObject({ kind: 'reimbursement_decided', title: 'Reimbursement claim approved', link: `/reimbursements/${approved.id}` });
      expect((await inbox('noah')).at(-1)?.body).toMatch(/^To be paid with the [A-Z][a-z]+ \d{4} payroll$/);
      const rejected = await claim('noah', 'rejected', { rejectedStage: 'hr', rejectReason: 'Invented reason' });
      await notices.reimbursement(rejected.id, 'decided');
      expect((await inbox('noah')).at(-1)).toEqual({ kind: 'reimbursement_decided', title: 'Reimbursement claim rejected', body: `Your claim of ${shownDate(TODAY)}`, link: `/reimbursements/${rejected.id}` });
      // never the amount nor the reason
      expect(JSON.stringify(await inbox('noah'))).not.toMatch(/250|Invented/);
    });

    it('a raise request: HR (the CEO for a C-level person), never the one who asked, never the employee or the manager', async () => {
      const effectiveFrom = `${TODAY.slice(0, 7)}-01`;
      const body = { raiseReason: 'performance', effectiveFrom, comment: 'Invented: did well', suggestedPercent: 10 };
      await api().post(`/api/employees/${ids.rami}/raise-requests`).set('Cookie', hr).send(body).expect(201);
      expect(await inbox('hr2')).toEqual([{ kind: 'raise_request_waiting', title: 'A raise request is waiting for you', body: `Rami Report ${RUN}`, link: '/raise-requests?status=with_hr' }]);
      expect(await kindsOf('hrSuper')).toEqual(['raise_request_waiting']);
      for (const key of ['hr', 'ceo', 'rami', 'mona', 'finance']) expect(await kindsOf(key)).toEqual([]);

      await clear();
      // a C-level person's, asked by HR with Super Admin: the CEO takes HR's step, HR is never told
      await api().post(`/api/employees/${ids.cleo}/raise-requests`).set('Cookie', hrSuper).send(body).expect(201);
      expect(await inbox('ceo')).toEqual([{ kind: 'raise_request_waiting', title: 'A raise request is waiting for you', body: `Cleo Chief ${RUN}`, link: '/raise-requests?status=with_hr' }]);
      for (const key of ['hr', 'hr2', 'hrSuper', 'cleo', 'mona']) expect(await kindsOf(key)).toEqual([]);
    });

    it('a home location: HR, then the CEO, the employee at each decision; never the point, the label or a comment', async () => {
      const label = `Home of ${RUN}`;
      const id = (await api().post('/api/me/home-locations').set('Cookie', sessions.rami).send({ latitude: 30.101234, longitude: 31.380123, label }).expect(201)).body.id as string;
      const link = `/home-locations/${id}`;
      const asked = shownDate(todayInCairo());
      const waiting = { kind: 'home_location_waiting', title: 'A home location is waiting for you', body: `Rami Report ${RUN}, asked on ${asked}`, link };
      for (const key of ['hr', 'hr2', 'hrSuper']) expect(await inbox(key)).toEqual([waiting]);
      for (const key of ['ceo', 'finance', 'mona', 'rami', 'superAdmin']) expect(await kindsOf(key)).toEqual([]);

      await api().post(`/api/home-locations/${id}/decide`).set('Cookie', hr).send({ decision: 'approve', radiusMetres: 150 }).expect(200);
      expect(await inbox('ceo')).toEqual([waiting]);
      expect(await inbox('rami')).toEqual([{ kind: 'home_location_decided', title: 'Home location approved by HR', body: `Your request of ${asked} is with the CEO now`, link }]);
      for (const key of ['hr', 'hr2', 'hrSuper']) expect(await kindsOf(key)).toEqual(['home_location_waiting']);
      for (const key of ['finance', 'mona', 'superAdmin']) expect(await kindsOf(key)).toEqual([]);

      await api().post(`/api/home-locations/${id}/decide`).set('Cookie', ceo).send({ decision: 'approve' }).expect(200);
      expect((await inbox('rami')).at(-1)).toEqual({ kind: 'home_location_decided', title: 'Home location approved', body: `Your request of ${asked}`, link });
      expect(await kindsOf('ceo')).toEqual(['home_location_waiting']);
      const sent = JSON.stringify(await prisma.notification.findMany({ where: { link }, select: { title: true, body: true } }));
      for (const never of ['30.10', '31.38', label]) expect(sent).not.toContain(never);
      await prisma.homeLocationRequest.deleteMany({ where: { id } });
    });

    it('a C-level person’s home location: the CEO and HR with Super Admin at HR’s step, never HR; rejected without the comment', async () => {
      const id = (await api().post('/api/me/home-locations').set('Cookie', sessions.cleo).send({ latitude: 30.060912, longitude: 31.370934 }).expect(201)).body.id as string;
      const link = `/home-locations/${id}`;
      const asked = shownDate(todayInCairo());
      expect(await kindsOf('ceo')).toEqual(['home_location_waiting']);
      expect(await kindsOf('hrSuper')).toEqual(['home_location_waiting']);
      for (const key of ['hr', 'hr2', 'finance', 'mona', 'cleo']) expect(await kindsOf(key)).toEqual([]);

      // HR with Super Admin takes HR's step: the CEO's step waits for the CEO, never for the one who just decided
      await api().post(`/api/home-locations/${id}/decide`).set('Cookie', hrSuper).send({ decision: 'approve' }).expect(200);
      expect(await kindsOf('ceo')).toEqual(['home_location_waiting', 'home_location_waiting']);
      expect(await kindsOf('hrSuper')).toEqual(['home_location_waiting']);
      expect(await inbox('cleo')).toEqual([{ kind: 'home_location_decided', title: 'Home location approved by HR', body: `Your request of ${asked} is with the CEO now`, link }]);
      for (const key of ['hr', 'hr2']) expect(await kindsOf(key)).toEqual([]);

      await api().post(`/api/home-locations/${id}/decide`).set('Cookie', ceo).send({ decision: 'reject', comment: 'Invented: too far from the office' }).expect(200);
      expect((await inbox('cleo')).at(-1)).toEqual({ kind: 'home_location_decided', title: 'Home location rejected', body: `Your request of ${asked}`, link });
      expect(JSON.stringify(await inbox('cleo'))).not.toContain('Invented');

      // the CEO taking HR's step of a C-level person's: "by the CEO", and the CEO isn't told of their own next step
      await clear();
      const again = (await api().post('/api/me/home-locations').set('Cookie', sessions.cleo).send({ latitude: 30.060912, longitude: 31.370934 }).expect(201)).body.id as string;
      await api().post(`/api/home-locations/${again}/decide`).set('Cookie', ceo).send({ decision: 'approve' }).expect(200);
      expect(await kindsOf('ceo')).toEqual(['home_location_waiting']);
      expect((await inbox('cleo')).map((n) => n.title)).toEqual(['Home location approved by the CEO']);
      await prisma.homeLocationRequest.deleteMany({ where: { employeeId: ids.cleo } });
    });
  });

  describe('the reminders (a fake clock)', () => {
    const at = (time: string, day = reminderDay) => new Date(zonedMoment(day, time));

    const checkInText = { kind: 'check_in_reminder', title: 'You haven’t checked in', body: 'Your shift started at 9:00 AM. Check in now.', link: '/my-attendance' };
    /** The day's check-in reminder as kept: how many went, when the last went, and its one inbox row. */
    const sentRow = (key: string, day = reminderDay) =>
      prisma.reminderSent.findUniqueOrThrow({ where: { userId_day_kind: { userId: users[key], day: toDateOnly(day), kind: 'check_in_reminder' } }, select: { count: true, lastSentAt: true, notificationId: true } });
    const punch = (key: string, time: string, day = reminderDay) =>
      prisma.attendancePunch.create({ data: { employeeId: ids[key], date: toDateOnly(day), kind: 'in', at: at(time, day), place: 'office', expected: 'office', userId: users[key] } });

    beforeAll(async () => {
      await clear();
      // Noah checked in at 8:55; Mona tried to switch the check-in reminder off (owner, 20 October 2026: "No, always on")
      await punch('noah', '08:55');
      await api().put('/api/me/notification-settings').set('Cookie', sessions.mona).send({ checkInReminder: false }).expect(200);
    });

    it('"You haven’t checked in" at the shift’s start, then every 10 minutes: once a step, one inbox row refreshed, whatever the switch', async () => {
      await reminders.runOnce(at('08:59'));
      expect(await kindsOf('rami')).toEqual([]);
      await reminders.runOnce(at('09:00'));
      expect(await inbox('rami')).toEqual([checkInText]);
      expect(await inbox('mona')).toEqual([checkInText]);
      expect(await kindsOf('cleo')).toEqual(['check_in_reminder']);
      // checked in: none
      expect(await kindsOf('noah')).toEqual([]);
      const [first] = await prisma.notification.findMany({ where: { userId: users.rami }, select: { id: true } });
      expect(await sentRow('rami')).toEqual({ count: 1, lastSentAt: at('09:00'), notificationId: first.id });

      // the same step, again (a round, and the timer's): never twice
      await reminders.runOnce(at('09:05'));
      await reminders.tick(at('09:09'));
      expect(await sentRow('rami')).toMatchObject({ count: 1, lastSentAt: at('09:00') });

      // read, then the next step: the same row, unread again with the latest time; the bell counts one
      await api().post(`/api/me/notifications/${first.id}/read`).set('Cookie', sessions.rami).expect(204);
      const before = (await prisma.notification.findUniqueOrThrow({ where: { id: first.id } })).createdAt;
      await reminders.runOnce(at('09:10'));
      const rows = await prisma.notification.findMany({ where: { userId: users.rami }, select: { id: true, readAt: true, createdAt: true, body: true } });
      expect(rows).toEqual([{ id: first.id, readAt: null, createdAt: expect.any(Date), body: checkInText.body }]);
      expect(rows[0].createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(await sentRow('rami')).toEqual({ count: 2, lastSentAt: at('09:10'), notificationId: first.id });
      expect((await api().get('/api/me/notifications/unread-count').set('Cookie', sessions.rami).expect(200)).body).toEqual({ unread: 1 });
      // its inbox row deleted: a new one at the next step
      await prisma.notification.deleteMany({ where: { userId: users.mona } });
      await reminders.runOnce(at('09:20'));
      const [again] = await prisma.notification.findMany({ where: { userId: users.mona }, select: { id: true } });
      expect(await sentRow('mona')).toEqual({ count: 3, lastSentAt: at('09:20'), notificationId: again.id });
    });

    it('a step claimed already is never sent again, whichever process looks: the row says so, without the lock too', async () => {
      // as if another process had sent 09:30's step at 09:31
      await prisma.reminderSent.updateMany({ where: { userId: users.rami, day: toDateOnly(reminderDay), kind: 'check_in_reminder' }, data: { count: 4, lastSentAt: at('09:31') } });
      await reminders.runOnce(at('09:35'));
      expect(await sentRow('rami')).toMatchObject({ count: 4, lastSentAt: at('09:31') });
      expect(await sentRow('cleo')).toMatchObject({ count: 4, lastSentAt: at('09:35') });
      // two rounds at once: the step goes once
      await Promise.all([reminders.runOnce(at('09:40')), reminders.runOnce(at('09:40')), reminders.tick(at('09:41'))]);
      expect(await sentRow('rami')).toMatchObject({ count: 5, lastSentAt: at('09:40') });
      expect(await prisma.notification.count({ where: { userId: users.rami } })).toBe(1);
    });

    it('stops as soon as they check in, and after 2 hours: 12 at most', async () => {
      // Cleo checks in at 9:45
      await punch('cleo', '09:45');
      for (const time of ['09:50', '10:00', '10:10', '10:20', '10:30', '10:40', '10:50', '10:59', '11:00', '11:30', '13:00']) await reminders.runOnce(at(time));
      expect(await sentRow('cleo')).toMatchObject({ count: 5, lastSentAt: at('09:40') });
      expect(await sentRow('rami')).toMatchObject({ count: 12, lastSentAt: at('10:50') });
      expect(await sentRow('mona')).toMatchObject({ count: 12, lastSentAt: at('10:50') });
      for (const key of ['rami', 'mona', 'cleo']) expect(await kindsOf(key)).toEqual(['check_in_reminder']);
      expect(await kindsOf('noah')).toEqual([]);
    });

    it('"Still checked in?" when hours stop counting, once', async () => {
      await reminders.runOnce(at('17:14'));
      expect(await kindsOf('noah')).toEqual([]);
      await reminders.runOnce(at('17:15'));
      expect(await inbox('noah')).toEqual([{ kind: 'check_out_reminder', title: 'Still checked in?', body: 'You checked in at 8:55 AM. Check out when you leave.', link: '/my-attendance' }]);
      expect((await inbox('cleo')).map((n) => n.kind)).toEqual(['check_in_reminder', 'check_out_reminder']);
      await reminders.runOnce(at('17:20'));
      expect(await kindsOf('noah')).toEqual(['check_out_reminder']);
      expect(await prisma.reminderSent.findUniqueOrThrow({ where: { userId_day_kind: { userId: users.noah, day: toDateOnly(reminderDay), kind: 'check_out_reminder' } }, select: { count: true } })).toEqual({ count: 1 });
      // Rami never checked in: no "Still checked in?"
      expect(await kindsOf('rami')).toEqual(['check_in_reminder']);
    });

    it('one process at a time: another holding the lock sends nothing', async () => {
      const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await other.connect();
      try {
        await other.query("SELECT pg_advisory_lock(hashtext('people-system notification reminders'))");
        const nextDay = addDays(reminderDay, 1);
        expect(await reminders.runOnce(at('09:45', nextDay))).toBe(0);
        expect(await prisma.reminderSent.count({ where: { userId: users.rami, day: toDateOnly(nextDay) } })).toBe(0);
        await other.query("SELECT pg_advisory_unlock(hashtext('people-system notification reminders'))");
        expect(await reminders.runOnce(at('09:45', nextDay))).toBeGreaterThan(0);
        expect(await prisma.reminderSent.count({ where: { userId: users.rami, day: toDateOnly(nextDay) } })).toBe(1);
      } finally {
        await other.end();
      }
    });
  });

  describe('the popup: GET /me/check-in-reminder', () => {
    const at = (time: string, day = reminderDay) => new Date(zonedMoment(day, time));
    const none = { due: false, shiftStart: null, checkInPath: '/my-attendance' };
    const cairoTime = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
    /** Pia's shift started 30 minutes ago, every day: her popup is due now, unless that day is an official holiday. */
    let piaStart: string;
    let piaDay: string;
    let piaDue: boolean;

    beforeAll(async () => {
      const started = new Date(Date.now() - 30 * 60_000);
      piaStart = cairoTime(started);
      piaDay = dayInCairo(started);
      piaDue = !(await prisma.holiday.count({ where: { date: toDateOnly(piaDay) } }));
      liveShiftId = (
        await prisma.shift.create({
          data: { code: `P${RUN}`.slice(0, 20), startTime: toTimeOfDay(piaStart), endTime: toTimeOfDay(cairoTime(new Date(started.getTime() + 8 * 3600_000))), hoursPerDay: 8, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4, 5, 6] },
          select: { id: true },
        })
      ).id;
      await person('pia', 'Pia Popup', { shiftId: liveShiftId });
    });

    it('by the same rule as the push, with a fake clock: within the 2 hours, not checked in, whatever was sent or switched', async () => {
      const mona = await prisma.user.findUniqueOrThrow({ where: { id: users.mona }, select: { id: true, email: true } });
      const asMona = { ...mona, roles: ['employee' as const] };
      // twelve sent to Mona by now, her switch "off": still due until 11:00
      expect(await reminders.checkInReminderFor(asMona, at('08:59'))).toEqual(none);
      expect(await reminders.checkInReminderFor(asMona, at('10:30'))).toEqual({ due: true, shiftStart: '09:00', checkInPath: '/my-attendance' });
      expect(await reminders.checkInReminderFor(asMona, at('11:00'))).toEqual(none);
      // never while a Super Admin views as her
      expect(await reminders.checkInReminderFor({ ...asMona, viewAs: { by: { id: users.superAdmin, email: 'x' }, act: false } }, at('10:30'))).toEqual(none);
      // Cleo checked in at 9:45; Noah at 8:55
      const cleo = await prisma.user.findUniqueOrThrow({ where: { id: users.cleo }, select: { id: true, email: true } });
      expect(await reminders.checkInReminderFor({ ...cleo, roles: ['employee'] }, at('10:30'))).toEqual(none);
    });

    it('answers the signed-in person now, as a background request too; never while viewing as them, nor without a profile', async () => {
      const due = piaDue ? { due: true, shiftStart: piaStart, checkInPath: '/my-attendance' } : none;
      expect((await api().get('/api/me/check-in-reminder').set('Cookie', sessions.pia).expect(200)).body).toEqual(due);
      expect((await api().get('/api/me/check-in-reminder').set('Cookie', sessions.pia).set(BACKGROUND_HEADER, '1').expect(200)).body).toEqual(due);
      // HR without an employee profile, and no session at all
      expect((await api().get('/api/me/check-in-reminder').set('Cookie', hr).expect(200)).body).toEqual(none);
      await api().get('/api/me/check-in-reminder').expect(401);
      // a Super Admin viewing as Pia: never
      const switched = await api().post('/api/auth/view-as').set('Cookie', sessions.superAdmin).send({ userId: users.pia }).expect(200);
      const viewing = ([] as string[]).concat(switched.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='))!.split(';')[0];
      expect((await api().get('/api/me/check-in-reminder').set('Cookie', viewing).expect(200)).body).toEqual(none);
      // checked in: no more
      await prisma.attendancePunch.create({ data: { employeeId: ids.pia, date: toDateOnly(piaDay), kind: 'in', at: new Date(), place: 'office', expected: 'office', userId: users.pia } });
      expect((await api().get('/api/me/check-in-reminder').set('Cookie', sessions.pia).expect(200)).body).toEqual(none);
    });
  });
});
