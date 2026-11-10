import type { INestApplication } from '@nestjs/common';
import type { Role } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, addMonths, toDateOnly, todayInCairo } from '../src/common/date-only.js';
import { NOT_CHECKED_IN, PINGS_FROM_THE_APP, PINGS_OFF } from '../src/attendance/location-pings.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { APP_USER_AGENT, createApp, createUser, signIn } from './helpers.js';

// The app's hourly location while checked in (owner, 1 November 2026: "can the devices ping every 1 hour their
// location? and flag if someone is not in the checked in location?"; chose "Silent automatic ping"): HR switches it on
// in Check-in Setup; the app is told on today's view; a ping is refused off the app, while switched off and when not
// checked in; each is read against the check-in (here one away from any check-in location: within 300 m of its spot
// is still there), one too soon after the last isn't kept, "location off" is kept as such, and HR sees them on the day's
// records. Every name and point is invented; this file deletes what it made and switches the setting back.

const RUN = `lp${Date.now().toString(36)}`;
const TODAY = todayInCairo();
/** Somewhere in the desert west of Cairo: no check-in location near it. */
const SPOT = { latitude: 30.05, longitude: 30.5 };
const north = (metres: number) => ({ latitude: SPOT.latitude + metres / 111_320, longitude: SPOT.longitude });

describe('Location pings (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let before: boolean;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const emails: Record<string, string> = {};
  let employeeId = '';
  let day = '';
  const ping = (body: object, as = 'phone') => api().post('/api/me/attendance/pings').set('Cookie', sessions[as]).send(body);
  /** The last ping put back so the next one is kept (one sooner than 20 minutes after the last isn't). */
  const later = () => prisma.attendancePing.updateMany({ where: { employeeId }, data: { at: new Date(Date.now() - 3600_000) } });

  async function account(key: string, roles: Role[]) {
    emails[key] = await createUser(prisma, roles);
    sessions[key] = await signIn(app, emails[key]);
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    before = (await prisma.payrollSettings.findUnique({ where: { id: 1 }, select: { locationPings: true } }))?.locationPings ?? false;
    await account('hr', ['hr']);
    await account('web', ['employee']);
    const shiftId = (await prisma.shift.findFirstOrThrow({ where: { code: 'A' }, select: { id: true } })).id;
    const e = await prisma.employee.create({
      data: {
        employeeCode: `LP-${RUN}`,
        fullNameEn: `Lina Pings ${RUN}`,
        fullNameAr: 'موظف تجريبي',
        workEmail: emails.web,
        employments: { create: { employmentType: 'full_time', status: 'active', joinDate: toDateOnly('2024-01-01'), workArrangement: 'wfh', shiftId } },
      },
      select: { id: true, employments: { select: { id: true } } },
    });
    employeeId = e.id;
    const start = addMonths(TODAY, -6);
    await prisma.contract.create({
      data: {
        number: `LP-${RUN}`,
        employmentId: e.employments[0].id,
        version: 1,
        form: 'fixed',
        startDate: toDateOnly(start),
        endDate: toDateOnly(addDays(addMonths(start, 24), -1)),
        durationMonths: 24,
        grossSalary: 10_000,
        insuredSalary: 10_000,
        status: 'active',
        signedOn: toDateOnly(start),
      },
    });
    // the same person in the app (a fresh sign-in reads the link by the work email), and on the website
    sessions.phone = await signIn(app, emails.web, APP_USER_AGENT);
    sessions.web = await signIn(app, emails.web);
  });

  afterAll(async () => {
    await prisma.payrollSettings.update({ where: { id: 1 }, data: { locationPings: before } });
    await prisma.attendancePing.deleteMany({ where: { employeeId } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId } } });
    await prisma.employment.deleteMany({ where: { employeeId } });
    await prisma.employee.deleteMany({ where: { id: employeeId } });
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
    await app.close();
  });

  it('is HR’s to switch on, audited; the app is told on today’s view', async () => {
    await api().put('/api/attendance/check-in-setup/location-pings').set('Cookie', sessions.web).send({ enabled: true }).expect(403);
    await api().put('/api/attendance/check-in-setup/location-pings').set('Cookie', sessions.hr).send({ enabled: false }).expect(200);
    expect((await api().get('/api/me/attendance/today').set('Cookie', sessions.phone).expect(200)).body.locationPings).toBe(false);
    expect((await ping({ ...SPOT, accuracy: 10 }).expect(409)).body.message).toBe(PINGS_OFF);

    expect((await api().put('/api/attendance/check-in-setup/location-pings').set('Cookie', sessions.hr).send({ enabled: true }).expect(200)).body).toEqual({ enabled: true });
    expect((await api().get('/api/attendance/check-in-setup/location-pings').set('Cookie', sessions.hr).expect(200)).body).toEqual({ enabled: true });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'check_in_location_pings' }, orderBy: { at: 'desc' } });
    expect(audit.diff).toEqual({ enabled: { from: false, to: true } });
    const today = (await api().get('/api/me/attendance/today').set('Cookie', sessions.phone).expect(200)).body;
    expect(today.locationPings).toBe(true);
    day = today.date;
  });

  it('is refused off the app, and when not checked in', async () => {
    expect((await ping({ ...SPOT, accuracy: 10 }, 'web').expect(403)).body.message).toBe(PINGS_FROM_THE_APP);
    expect((await ping({ ...SPOT, accuracy: 10 }).expect(409)).body.message).toBe(NOT_CHECKED_IN);
    await ping({}).expect(400);
  });

  it('reads each against the check-in: still there near its spot, away far from it, the location off as such', async () => {
    await api().post('/api/me/attendance/punches').set('Cookie', sessions.phone).send({ kind: 'in', ...SPOT, accuracy: 15 }).expect(200);

    expect((await ping({ ...north(120), accuracy: 20 }).expect(200)).body).toEqual({ kept: true, status: 'at_place' });
    // too soon after the last: not kept
    expect((await ping({ ...north(5000), accuracy: 20 }).expect(200)).body).toEqual({ kept: false, status: null });

    await later();
    expect((await ping({ ...north(5000), accuracy: 20, mock: false }).expect(200)).body).toEqual({ kept: true, status: 'away' });
    await later();
    expect((await ping({ off: 'permission' }).expect(200)).body).toEqual({ kept: true, status: 'off' });

    const records = (await api().get(`/api/attendance/employees/${employeeId}/records?date=${day}`).set('Cookie', sessions.hr).expect(200)).body;
    expect(records.pings.map((p: { status: string }) => p.status)).toEqual(['at_place', 'away', 'off']);
    const away = records.pings[1];
    expect(away.placeText).toBe('Elsewhere');
    expect(away.distanceMetres).toBeGreaterThan(4500);
    expect(records.pings[2]).toMatchObject({ placeText: 'Location not allowed all the time', latitude: null, distanceMetres: null });
    // the person sees their own
    expect((await api().get(`/api/attendance/employees/${employeeId}/records?date=${day}`).set('Cookie', sessions.web).expect(200)).body.pings).toHaveLength(3);
  });

  // owner, 10 November 2026: "the hourly ping is not working too, i cant find it in the system"; "can it be embeded in
  // the attendance page?"
  it('a day’s for everyone, on Daily Attendance: the flagged first; with none, why; HR’s, not an employee’s', async () => {
    // someone on an iPhone, checked in two hours ago: no pings, as iPhones don't send them yet
    const iphone = await prisma.employee.create({
      data: {
        employeeCode: `LQ-${RUN}`,
        fullNameEn: `Ian Iphone ${RUN}`,
        fullNameAr: 'موظف تجريبي',
        workEmail: emails.hr,
        employments: { create: { employmentType: 'full_time', status: 'active', joinDate: toDateOnly('2024-01-01'), workArrangement: 'office' } },
      },
      select: { id: true },
    });
    try {
      await signIn(app, emails.hr, 'Trendlix People/0.6.52 (iOS) TrendLIXPeople');
      await prisma.attendancePunch.create({ data: { employeeId: iphone.id, date: toDateOnly(day), kind: 'in', at: new Date(Date.now() - 2 * 3600_000), place: 'office', expected: 'office' } });
      const view = (await api().get(`/api/attendance/pings?date=${day}`).set('Cookie', sessions.hr).expect(200)).body;
      expect(view.enabled).toBe(true);
      const lina = view.people.find((p: { employee: { id: string } }) => p.employee.id === employeeId);
      expect(lina).toMatchObject({ flagged: 2, noPings: null, checkInPlace: expect.any(String) });
      expect(lina.pings.map((p: { status: string }) => p.status)).toEqual(['at_place', 'away', 'off']);
      const ian = view.people.find((p: { employee: { id: string } }) => p.employee.id === iphone.id);
      expect(ian).toMatchObject({ pings: [], flagged: 0, noPings: 'iphone', checkInPlace: 'Office', checkOut: null });
      // the flagged before those without
      const ids = view.people.map((p: { employee: { id: string } }) => p.employee.id);
      expect(ids.indexOf(employeeId)).toBeLessThan(ids.indexOf(iphone.id));
      await api().get(`/api/attendance/pings?date=${day}`).set('Cookie', sessions.web).expect(403);
      await api().get('/api/attendance/pings?date=10/11/2026').set('Cookie', sessions.hr).expect(400);
    } finally {
      await prisma.attendancePunch.deleteMany({ where: { employeeId: iphone.id } });
      await prisma.employee.deleteMany({ where: { id: iphone.id } });
    }
  });

  it('stops once checked out', async () => {
    await api().post('/api/me/attendance/punches').set('Cookie', sessions.phone).send({ kind: 'out', ...SPOT, accuracy: 15 }).expect(200);
    await later();
    expect((await ping({ ...SPOT, accuracy: 10 }).expect(409)).body.message).toBe(NOT_CHECKED_IN);
  });
});
