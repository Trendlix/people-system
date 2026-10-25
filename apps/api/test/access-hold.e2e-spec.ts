import type { INestApplication } from '@nestjs/common';
import { ACCESS_HOLD_MESSAGE, ACCESS_HOLD_REASON, HOLD_PATH, type AccessCounts, type EmployeeAccessView, type Role, type RowAccessView } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { SessionUser } from '../src/auth/session-user.js';
import { addDays, addMonths, toDateOnly, todayInCairo } from '../src/common/date-only.js';
import { AccessStandingService } from '../src/employee-access/access-standing.service.js';
import { EmployeeAccessService } from '../src/employee-access/employee-access.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { APP_USER_AGENT, createApp, createUser, signIn } from './helpers.js';

// Access follows the contract (owner, 23 October 2026, on the Access tab showing "Active · Has access without an active
// contract": "No Access without active contract, Access should be on hold with a 7 days grace period one time granted by
// the hr", then "Active - Grace - Hold - No Access"; asked: on Hold "Check-in/out only", Grace "Once per contract gap",
// go-live "Hold them immediately"). Someone whose contract ran out signs in on Hold: checking in and out works, on the
// website and in the app, and everything else answers 403 with the message; HR gives 7 days' grace and everything opens
// in the same session; a second grace in the gap is refused, and nobody gives themself one; a grace run out holds the
// next request without signing out; a new signed contract opens everything, and its own end is a new gap with a grace of
// its own; a Super Admin, the CEO and an account that isn't an employee's are never held; the sweep audits each change
// and tells the employee and HR once; the Employees list's standing and HR's count; a Super Admin viewing as someone on
// Hold is held too, the switcher still working. Every name is invented; this file deletes what it made.

const RUN = `ah${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const YESTERDAY = addDays(TODAY, -1);
const TOMORROW = addDays(TODAY, 1);
const IN_A_WEEK = addDays(TODAY, 7);
const NEAR = { latitude: 30.0601, longitude: 31.3465, accuracy: 18.4 };

describe('Access on hold (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let access: EmployeeAccessService;
  let standings: AccessStandingService;
  let shiftId: string;
  let contracts = 0;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const emails: Record<string, string> = {};
  const people: Record<string, { id: string; employmentId: string; contractId: string | null }> = {};

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const accessOf = async (key: string, as = 'hr') => (await get(as, `/employees/${people[key].id}/access`).expect(200)).body as EmployeeAccessView;
  const grace = (key: string, as = 'hr') => post(as, `/employees/${people[key].id}/access/grace`);
  const held = (res: request.Response) => {
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ message: ACCESS_HOLD_MESSAGE, reason: ACCESS_HOLD_REASON });
  };

  async function account(key: string, roles: Role[]) {
    emails[key] = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email: emails[key] } })).id;
    sessions[key] = await signIn(app, emails[key]);
  }

  /** A signed contract version of an employment (`status`: as signed, or replaced). */
  async function contract(employmentId: string, version: number, start: string, end: string | null, status = 'active') {
    return (
      await prisma.contract.create({
        data: {
          number: `AH-${RUN}-${++contracts}`,
          employmentId,
          version,
          form: end ? 'fixed' : 'open_ended',
          startDate: toDateOnly(start),
          endDate: end ? toDateOnly(end) : null,
          durationMonths: end ? 12 : null,
          grossSalary: 10_000,
          insuredSalary: 10_000,
          status,
          signedOn: status === 'draft' ? null : toDateOnly(start),
        },
        select: { id: true },
      })
    ).id;
  }

  /**
   * A profile with a current employment (working from home, under a shift, so checking in needs no office network), its
   * account linked by the work email (with these roles), and a contract: `ended` five days ago (a fixed term run past its
   * end), `in_force`, a `draft` only, or none; `never`: a profile never employed (no employment, no contract).
   */
  async function person(key: string, name: string, o: { roles?: Role[]; contract?: 'ended' | 'in_force' | 'draft' | 'none' | 'never' } = {}) {
    await account(key, o.roles ?? ['employee']);
    const kind = o.contract ?? 'ended';
    const e = await prisma.employee.create({
      data: {
        employeeCode: `${key.toUpperCase()}-${RUN}`,
        fullNameEn: `${name} ${RUN}`,
        fullNameAr: 'موظف تجريبي',
        workEmail: emails[key],
        ...(kind !== 'never' && { employments: { create: { employmentType: 'full_time', status: 'active', joinDate: toDateOnly('2024-01-01'), workArrangement: 'wfh', shiftId } } }),
      },
      select: { id: true, employments: { select: { id: true } } },
    });
    const employmentId = e.employments[0]?.id ?? '';
    const start = addMonths(TODAY, -12);
    const contractId =
      kind === 'ended'
        ? await contract(employmentId, 1, addDays(start, -5), addDays(TODAY, -5))
        : kind === 'in_force'
          ? await contract(employmentId, 1, start, addDays(addMonths(start, 24), -1))
          : kind === 'draft'
            ? await contract(employmentId, 1, TODAY, addDays(addMonths(TODAY, 12), -1), 'draft')
            : null;
    people[key] = { id: e.id, employmentId, contractId };
    // the account is linked by its work email (the trigger); a fresh sign-in reads the link
    expect((await prisma.user.findUniqueOrThrow({ where: { id: users[key] } })).employeeId).toBe(e.id);
    sessions[key] = await signIn(app, emails[key]);
  }

  const auditsOf = (key: string, action = 'access_standing') =>
    prisma.auditLog.findMany({ where: { entityType: 'employee', entityId: people[key].id, action }, orderBy: { at: 'asc' }, select: { userId: true, diff: true } });
  // oldest first (and by id on a tie), so "the ones after" a count are the new ones whatever order the database returns
  const noticesOf = (key: string, kind: string) =>
    prisma.notification.findMany({ where: { userId: users[key], kind }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { title: true, body: true, link: true } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    access = app.get(EmployeeAccessService);
    standings = app.get(AccessStandingService);
    shiftId = (await prisma.shift.findFirstOrThrow({ where: { code: 'A' }, select: { id: true } })).id;
    await account('hr', ['hr']);
    await account('superAdmin', ['super_admin']);
    await account('outside', ['employee']);
    await person('nora', 'Nora Onhold');
    await person('hrin', 'Hany HrOnhold', { roles: ['hr'] });
    await person('sara', 'Sara SuperAdmin', { roles: ['employee', 'super_admin'] });
    await person('cleo', 'Cleo Ceo', { roles: ['ceo'] });
    await person('dina', 'Dina Draft', { contract: 'draft' });
    await person('ivan', 'Ivan InForce', { contract: 'in_force' });
    await person('sweepy', 'Selim Swept');
    await person('pat', 'Pat Profile', { contract: 'never' });
  });

  afterAll(async () => {
    const mine = Object.values(people).map((p) => p.id);
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: mine } } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: mine } } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await prisma.employee.deleteMany({ where: { id: { in: mine } } });
    await app.close();
  });

  it('lets someone on Hold sign in and check in and out, on the website and in the app; everything else is refused', async () => {
    const me = (await get('nora', '/auth/me').expect(200)).body;
    expect(me).toMatchObject({ employeeId: people.nora.id, hold: true });
    expect((await get('nora', '/me/attendance/today').expect(200)).body.refusal).toBeNull();
    await post('nora', '/me/attendance/punches', { kind: 'in', ...NEAR }).expect(200);
    await post('nora', '/me/attendance/punches', { kind: 'out', ...NEAR }).expect(200);
    expect(await prisma.attendancePunch.count({ where: { employeeId: people.nora.id } })).toBe(2);
    await get('nora', '/me/check-in-reminder').expect(200);
    await get('nora', '/auth/session').expect(200);
    await get('nora', '/auth/sessions').expect(200);

    // their profile, a leave request, payslips, KPIs, the bell: on hold
    held(await get('nora', `/employees/${people.nora.id}`));
    held(await post('nora', '/me/leave/requests', { typeId: '00000000-0000-4000-8000-000000000000', startDate: TOMORROW, endDate: TOMORROW }));
    held(await get('nora', '/me/payslips'));
    held(await get('nora', '/kpis/scorecards/mine'));
    held(await get('nora', '/me/notifications'));
    held(await get('nora', `/employees/${people.nora.id}/access`));

    // the app: the same
    const phone = await signIn(app, emails.nora, APP_USER_AGENT);
    expect((await api().get('/api/auth/me').set('Cookie', phone).expect(200)).body.hold).toBe(true);
    await api().get('/api/me/attendance/today').set('Cookie', phone).expect(200);
    await api().post('/api/me/push-devices').set('Cookie', phone).send({ token: `fcm-${RUN}`, platform: 'android' }).expect(204);
    held(await api().get('/api/me/payslips').set('Cookie', phone));
    await prisma.pushDevice.deleteMany({ where: { token: `fcm-${RUN}` } });

    // signing out still works
    await api().post('/api/auth/logout').set('Cookie', phone).expect(204);
  });

  it('gives 7 days’ grace: everything opens in the same session; once in this gap; never to oneself', async () => {
    // her Hold recorded (as the sweep does), so the grace is a change from it
    await standings.sync([people.nora.id]);
    const before = await accessOf('nora');
    expect(before.standing).toMatchObject({ standing: 'hold', exempt: null, gap: { contractId: people.nora.contractId, endDate: addDays(TODAY, -5) }, grace: null, canGiveGrace: true });

    const given = (await grace('nora').expect(200)).body as EmployeeAccessView;
    expect(given.standing).toMatchObject({ standing: 'grace', grace: { from: TODAY, until: IN_A_WEEK, running: true, grantedBy: { id: users.hr } }, canGiveGrace: false });
    // the same session, no new sign-in
    await get('nora', `/employees/${people.nora.id}`).expect(200);
    expect((await get('nora', '/auth/me').expect(200)).body).not.toHaveProperty('hold');

    expect((await grace('nora').expect(409)).body.message).toBe(`They are on grace already, until ${IN_A_WEEK.split('-').reverse().join('/')}. It can’t be extended.`);
    expect(await prisma.accessGrace.count({ where: { employeeId: people.nora.id } })).toBe(1);
    const [given1] = await auditsOf('nora', 'give_grace');
    expect(given1).toMatchObject({ userId: users.hr, diff: { graceUntil: IN_A_WEEK } });
    expect((await auditsOf('nora')).map((a) => a.diff)).toEqual([
      { standing: { from: null, to: 'hold' }, contract: expect.stringMatching(/^AH-/) },
      { standing: { from: 'hold', to: 'grace' }, contract: expect.stringMatching(/^AH-/), graceUntil: IN_A_WEEK },
    ]);
    expect(await noticesOf('nora', 'access_grace')).toEqual([{ title: '7 days’ grace', body: `HR gave you full access until ${IN_A_WEEK.split('-').reverse().join('/')}, while your contract is renewed.`, link: '/' }]);

    // an HR person on Hold reaches nothing but checking in, their own grace included; and never gives it to themself
    held(await grace('hrin', 'hrin'));
    const self: SessionUser = { id: users.hrin, email: emails.hrin, roles: ['hr'], employeeId: people.hrin.id };
    await expect(access.giveGrace(people.hrin.id, self)).rejects.toThrow('You can’t give yourself grace');
    // and nobody but HR, an Admin, a Super Admin (the CEO for a C-level person)
    await grace('hrin', 'outside').expect(404);
    expect(await prisma.accessGrace.count({ where: { employeeId: people.hrin.id } })).toBe(0);
  });

  it('holds the next request once the grace has run out, without signing out; the gap’s grace is used', async () => {
    await prisma.accessGrace.updateMany({ where: { employeeId: people.nora.id }, data: { until: toDateOnly(YESTERDAY) } });
    held(await get('nora', `/employees/${people.nora.id}`));
    expect((await get('nora', '/auth/me').expect(200)).body.hold).toBe(true);
    const v = await accessOf('nora');
    expect(v.standing).toMatchObject({ standing: 'hold', grace: { until: YESTERDAY, running: false }, canGiveGrace: false });
    expect((await grace('nora').expect(409)).body.message).toContain('Grace was used already in this gap');
  });

  it('opens everything with a new signed contract, and its end is a new gap with a grace of its own', async () => {
    await prisma.contract.update({ where: { id: people.nora.contractId! }, data: { status: 'superseded' } });
    const v2 = await contract(people.nora.employmentId, 2, addDays(TODAY, -3), addDays(addMonths(TODAY, 12), -4));
    await get('nora', `/employees/${people.nora.id}`).expect(200);
    expect((await accessOf('nora')).standing).toMatchObject({ standing: 'active', gap: null, grace: null });

    await prisma.contract.update({ where: { id: v2 }, data: { endDate: toDateOnly(YESTERDAY) } });
    held(await get('nora', `/employees/${people.nora.id}`));
    expect((await accessOf('nora')).standing).toMatchObject({ standing: 'hold', gap: { contractId: v2 }, grace: null, canGiveGrace: true });
    expect(((await grace('nora').expect(200)).body as EmployeeAccessView).standing).toMatchObject({ standing: 'grace', grace: { until: IN_A_WEEK } });
    expect(await prisma.accessGrace.count({ where: { employeeId: people.nora.id } })).toBe(2);
    await get('nora', '/me/payslips').expect(200);
  });

  it('never holds a Super Admin, the CEO or an account that isn’t an employee’s; a draft-only hire keeps their account as before', async () => {
    for (const key of ['sara', 'cleo', 'outside']) {
      expect((await get(key, '/auth/me').expect(200)).body).not.toHaveProperty('hold');
      await get(key, '/me/payslips').expect(200);
    }
    await get('sara', '/employees').expect(200);
    expect((await accessOf('sara')).standing).toMatchObject({ standing: 'active', exempt: 'super_admin' });
    expect((await accessOf('cleo', 'superAdmin')).standing).toMatchObject({ standing: 'active', exempt: 'ceo' });
    // never had a signed contract in force, not recorded yet: No Access, still working (held after 7 days: below)
    expect((await accessOf('dina')).standing).toMatchObject({ standing: 'no_access', canGiveGrace: false, noContract: { since: null, holdFrom: null } });
    await get('dina', '/me/payslips').expect(200);
    expect((await grace('dina').expect(409)).body.message).toBe('They aren’t on hold yet: no contract entered.');
    expect((await grace('ivan').expect(409)).body.message).toBe('Their contract is in force: they have full access.');
    expect((await grace('sara').expect(409)).body.message).toBe('They are never on hold, so they need no grace.');
  });

  it('records each change of standing once, and tells the employee and HR once', async () => {
    // the go-live's first record: Hold, audited and told; the second sweep changes nothing
    const hrBefore = await noticesOf('hr', 'access_held');
    await prisma.employee.update({ where: { id: people.sweepy.id }, data: { accessStanding: null } });
    await access.sweep();
    await access.sweep();
    expect((await auditsOf('sweepy')).map((a) => a.diff)).toEqual([{ standing: { from: null, to: 'hold' }, contract: expect.stringMatching(/^AH-/) }]);
    expect(await noticesOf('sweepy', 'access_hold')).toEqual([{ title: 'Your access is on hold', body: ACCESS_HOLD_MESSAGE, link: HOLD_PATH }]);
    const hrAfter = await noticesOf('hr', 'access_held');
    expect(hrAfter.length - hrBefore.length).toBeGreaterThanOrEqual(1);
    const told = hrAfter.slice(hrBefore.length);
    expect(told.some((n) => n.title === `On hold: Selim Swept ${RUN}` || /^\d+ people on hold$/.test(n.title))).toBe(true);

    // grace: told once; the day before it ends, told once
    await grace('sweepy').expect(200);
    await prisma.accessGrace.updateMany({ where: { employeeId: people.sweepy.id }, data: { until: toDateOnly(TOMORROW) } });
    await access.sweep();
    await access.sweep();
    expect(await noticesOf('sweepy', 'access_grace')).toHaveLength(1);
    expect(await noticesOf('sweepy', 'access_grace_ending')).toEqual([
      { title: 'Your grace ends tomorrow', body: `Your full access ends after ${TOMORROW.split('-').reverse().join('/')} unless your contract is renewed. Checking in and out goes on working.`, link: '/' },
    ]);

    // run out: back on Hold, told again; a contract signed: Active, recorded as the one who signed it
    await prisma.accessGrace.updateMany({ where: { employeeId: people.sweepy.id }, data: { until: toDateOnly(YESTERDAY) } });
    await access.sweep();
    await prisma.contract.update({ where: { id: people.sweepy.contractId! }, data: { status: 'superseded' } });
    await contract(people.sweepy.employmentId, 2, addDays(TODAY, -4), null);
    await access.afterChange(people.sweepy.id, users.hr);
    await access.sweep();
    const audits = await auditsOf('sweepy');
    expect(audits.map((a) => a.diff)).toEqual([
      { standing: { from: null, to: 'hold' }, contract: expect.stringMatching(/^AH-/) },
      { standing: { from: 'hold', to: 'grace' }, contract: expect.stringMatching(/^AH-/), graceUntil: IN_A_WEEK },
      { standing: { from: 'grace', to: 'hold' }, contract: expect.stringMatching(/^AH-/) },
      { standing: { from: 'hold', to: 'active' } },
    ]);
    expect(audits.map((a) => a.userId)).toEqual([null, users.hr, null, users.hr]);
    expect(await noticesOf('sweepy', 'access_hold')).toHaveLength(2);
  });

  it('shows the standing on the Employees list, and counts those on Hold for HR', async () => {
    const rows = (await get('hr', '/employees').expect(200)).body as { id: string; access?: RowAccessView | null }[];
    const row = (key: string) => rows.find((r) => r.id === people[key].id)?.access;
    expect(row('nora')).toMatchObject({ standing: 'grace', graceUntil: IN_A_WEEK });
    expect(row('hrin')).toMatchObject({ standing: 'hold', graceUntil: null });
    expect(row('ivan')).toMatchObject({ standing: 'active' });
    expect(row('dina')).toMatchObject({ standing: 'no_access' });
    expect(row('sara')).toMatchObject({ standing: 'active' });

    const counts = (await get('hr', '/employees/access/counts').expect(200)).body as AccessCounts;
    expect(counts.hold).toBe(rows.filter((r) => r.access?.standing === 'hold').length);
    expect(counts.grace).toBe(rows.filter((r) => r.access?.standing === 'grace').length);
    expect(counts.hold).toBeGreaterThanOrEqual(1);
    await get('outside', '/employees/access/counts').expect(403);

    // the Users page's account of an employee
    expect((await get('superAdmin', `/users/${users.hrin}`).expect(200)).body.standing).toEqual({ standing: 'hold', graceUntil: null });
    expect((await get('superAdmin', `/users/${users.outside}`).expect(200)).body.standing).toBeNull();
  });

  it('keeps an account with no contract entered working for 7 days, told once, then holds it; one grace; Active once signed', async () => {
    const shown = (ymd: string) => ymd.split('-').reverse().join('/');
    const HOLD_FROM = addDays(TODAY, 8);
    await access.sweep();
    await access.sweep();
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: people.dina.id } })).noContractSince).toEqual(toDateOnly(TODAY));
    expect((await auditsOf('dina', 'access_no_contract')).map((a) => a.diff)).toEqual([{ noContractSince: TODAY, holdFrom: HOLD_FROM }]);
    expect(await noticesOf('dina', 'access_no_contract')).toEqual([
      { title: 'Your contract isn’t entered', body: `Your access will be on hold from ${shown(HOLD_FROM)} unless your contract is entered. Contact HR.`, link: '/' },
    ]);
    // still working meanwhile; HR sees the day, on the tab, the list and the count
    await get('dina', '/me/payslips').expect(200);
    expect((await get('dina', '/auth/me').expect(200)).body).not.toHaveProperty('hold');
    expect((await accessOf('dina')).standing).toMatchObject({ standing: 'no_access', noContract: { since: TODAY, holdFrom: HOLD_FROM }, canGiveGrace: false });
    const rows = (await get('hr', '/employees').expect(200)).body as { id: string; access?: RowAccessView | null }[];
    expect(rows.find((r) => r.id === people.dina.id)?.access).toMatchObject({ standing: 'no_access', noContract: { since: TODAY, holdFrom: HOLD_FROM } });
    const counts = (await get('hr', '/employees/access/counts').expect(200)).body as AccessCounts;
    expect(counts.noContract).toBe(rows.filter((r) => r.access?.noContract).length);
    expect(counts.noContract).toBeGreaterThanOrEqual(2);

    // the 7 days over: on Hold at the next request, recorded and told as going on Hold
    await prisma.employee.update({ where: { id: people.dina.id }, data: { noContractSince: toDateOnly(addDays(TODAY, -8)) } });
    held(await get('dina', '/me/payslips'));
    await access.sweep();
    expect((await auditsOf('dina')).map((a) => a.diff).at(-1)).toEqual({ standing: { from: 'no_access', to: 'hold' }, noContract: true });
    expect(await noticesOf('dina', 'access_hold')).toHaveLength(1);
    expect((await accessOf('dina')).standing).toMatchObject({ standing: 'hold', gap: null, canGiveGrace: true, noContract: { holdFrom: TODAY } });

    // the one grace, its gap the employment; a second refused
    expect(((await grace('dina').expect(200)).body as EmployeeAccessView).standing).toMatchObject({ standing: 'grace', grace: { until: IN_A_WEEK } });
    expect(await prisma.accessGrace.findMany({ where: { employeeId: people.dina.id }, select: { contractId: true, employmentId: true } })).toEqual([
      { contractId: null, employmentId: people.dina.employmentId },
    ]);
    await get('dina', '/me/payslips').expect(200);
    expect((await grace('dina').expect(409)).body.message).toContain('on grace already');
    await prisma.accessGrace.updateMany({ where: { employeeId: people.dina.id }, data: { until: toDateOnly(YESTERDAY) } });
    expect((await grace('dina').expect(409)).body.message).toContain('Grace was used already in this gap');

    // turning the account off and on never starts the 7 days again
    await prisma.user.update({ where: { id: users.dina }, data: { isActive: false } });
    await access.sweep();
    await prisma.user.update({ where: { id: users.dina }, data: { isActive: true } });
    await access.sweep();
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: people.dina.id } })).noContractSince).toEqual(toDateOnly(addDays(TODAY, -8)));
    expect(await noticesOf('dina', 'access_no_contract')).toHaveLength(1);
    sessions.dina = await signIn(app, emails.dina);

    // a signed contract in force: Active at once, the day cleared
    await contract(people.dina.employmentId, 2, addDays(TODAY, -1), null);
    await get('dina', `/employees/${people.dina.id}`).expect(200);
    await access.afterChange(people.dina.id, users.hr);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: people.dina.id } })).noContractSince).toBeNull();
    expect((await accessOf('dina')).standing).toMatchObject({ standing: 'active', noContract: null });

    // a profile never employed with an account: the same, its gap the person (one grace, kept by the database too)
    expect((await accessOf('pat')).standing).toMatchObject({ standing: 'no_access', noContract: { since: TODAY } });
    await prisma.employee.update({ where: { id: people.pat.id }, data: { noContractSince: toDateOnly(addDays(TODAY, -8)) } });
    held(await get('pat', '/me/payslips'));
    await grace('pat').expect(200);
    await get('pat', '/me/payslips').expect(200);
    await expect(prisma.accessGrace.create({ data: { employeeId: people.pat.id, until: toDateOnly(IN_A_WEEK) } })).rejects.toThrow();
  });

  it('holds a Super Admin viewing as someone on Hold, the switcher still working', async () => {
    const res = await post('superAdmin', '/auth/view-as', { userId: users.hrin }).expect(200);
    const viewing = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='))!.split(';')[0];
    expect((await api().get('/api/auth/me').set('Cookie', viewing).expect(200)).body).toMatchObject({ hold: true, viewAs: { by: { id: users.superAdmin } } });
    held(await api().get('/api/employees').set('Cookie', viewing));
    await api().post('/api/auth/view-as/stop').set('Cookie', viewing).expect(200);
  });
});
