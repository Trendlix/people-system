import type { INestApplication } from '@nestjs/common';
import { zonedMoment } from '@trendlix/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { firstDay, lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The Attendance section (owner, 19 October 2026: "is the attendance module active?", then "the attendance is not active
// in the side menu"): the days kept from Zoho People's imports read back. Daily Attendance and a person's month for HR,
// the CEO and Finance, with the filters; a manager's team (direct reports, and a lead's people without a direct
// manager), an employee's own; a C-level person only for the CEO, the Super Admin and themself (one hidden note for
// HR); the Summary by department and team from the days seeded here, its workbook, and every import across the runs.
// The days are written straight into attendance_days, as an applied import keeps them. These tests look at their own
// people (names end with RUN) and delete what they made. Every name is invented.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const MONTH = monthsLater(TODAY.slice(0, 7), -2); // two months back: its days are past
const EARLIER = monthsLater(MONTH, -1);

interface Figures {
  daysRecorded: number;
  daysWorked: number;
  daysCounted: number;
  hoursCounted: number;
  absentDays: number;
  shortHours: number;
  permissionHours: number;
  officeDays: number;
  remoteDays: number;
  leaveDays: number;
  zohoLeaveDays: number;
  missingCheckOuts: number;
  missingCheckIns: number;
  flaggedDays: number;
  noCheckInDays: number;
  holidays: number;
  restDays: number;
}

interface PersonMonth {
  employee: { id: string; fullNameEn: string; department: string | null; departmentId: string | null; confidential: boolean };
  month: string;
  hoursADay: number | null;
  figures: Figures;
  averageHours: number | null;
  permissionFrom: string | null;
  days: { date: string; status: string; checkIn: string | null; checkOut: string | null; hoursCounted: number; shortHours: number; missingCheckOut: boolean; permissionHours: number; importId: string | null }[];
}

interface Source {
  importId: string;
  runId: string;
  runStatus: string | null;
  createdBy: string | null;
  appliedAt: string | null;
  files: string[];
}

interface MonthView {
  month: string;
  scope: string;
  people: PersonMonth[];
  totals: Figures;
  withoutDays: { id: string }[];
  hidden: { count: number; label: string } | null;
  sources: Source[];
  run: { id: string; status: string } | null;
}

interface PersonView {
  month: string;
  person: PersonMonth;
  self: boolean;
  sources: Source[];
  run: { id: string; status: string } | null;
}

interface SummaryRow {
  id: string | null;
  name: string | null;
  people: number;
  personMonths: number;
  figures: Figures;
  averageHours: number | null;
}

interface Summary {
  period: { from: string; to: string };
  months: string[];
  groups: (SummaryRow & { teams: SummaryRow[] })[];
  totals: SummaryRow;
  hidden: { count: number; label: string } | null;
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
const name = (who: string) => `${who} ${RUN}`;

describe('The Attendance section (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  let hrSuper: string;
  let hrUserId: string;
  let emailDomainBefore: string | null;
  let deptId: string;
  let teamId: string;
  let otherId: string;
  let shiftId: string;
  let runId: string;
  let importId: string;
  const sessions: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const people: string[] = [];
  const work: string[] = [];
  let friday: string;
  const api = () => request(app.getHttpServer());

  /** A profile, with a sign-in account with `roles` when given, employed in MONTH from four months before it. */
  async function person(key: string, who: string, employment: Record<string, unknown>, roles: ('employee' | 'manager')[] | null = ['employee'], session = () => hr) {
    const email = roles ? await createUser(prisma, roles) : null;
    const res = await api()
      .post('/api/employees')
      .set('Cookie', hr)
      .send({ fullNameEn: name(who), fullNameAr: 'موظف تجريبي', ...(email && { workEmail: email }) })
      .expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    if (email) sessions[key] = await signIn(app, email);
    await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', session())
      .send({ employmentType: 'full_time', joinDate: firstDay(monthsLater(MONTH, -4)), shiftId, ...employment })
      .expect(201);
  }

  /** A day kept as an applied import keeps it: times in Cairo. */
  function day(key: string, date: string, status: string, more: { in?: string; out?: string; place?: string; hours?: number; zohoStatus?: string; permission?: number } = {}) {
    const at = (t: string | undefined) => (t ? new Date(zonedMoment(date, t)) : null);
    return {
      employeeId: ids[key],
      date: toDateOnly(date),
      status,
      checkIn: at(more.in),
      checkOut: at(more.out),
      place: more.place ?? null,
      zohoStatus: more.zohoStatus ?? null,
      permissionHours: more.permission ?? null,
      hoursCounted: more.hours ?? 0,
      source: 'zoho',
      importId,
      importedById: hrUserId,
    };
  }

  const month = async (session: string, query = '') => (await api().get(`/api/attendance?month=${MONTH}${query}`).set('Cookie', session).expect(200)).body as MonthView;
  const of = (view: MonthView, key: string) => view.people.find((p) => p.employee.id === ids[key]);
  const listed = (view: MonthView) => view.people.map((p) => p.employee.id).filter((id) => people.includes(id)).map((id) => Object.keys(ids).find((k) => ids[k] === id));

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrUserId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } })).id;
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);

    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: name('Attendance Dept') }).expect(201)).body.id;
    teamId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Field Team', parentId: deptId }).expect(201)).body.id;
    otherId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: name('Other Dept') }).expect(201)).body.id;
    // the MORNING shift: 9 hours within 9:00–19:00, 15 minutes' grace, Sunday to Thursday
    shiftId = (
      await prisma.shift.create({
        data: { code: `A${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('19:00'), hoursPerDay: 9, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4] },
        select: { id: true },
      })
    ).id;

    // everyone hired before the team has a lead, so Lea has no direct manager
    await person('mona', 'Mona Manager', { departmentId: deptId }, ['employee', 'manager']);
    await person('rami', 'Rami Report', { departmentId: teamId, managerId: ids.mona });
    await person('sara', 'Sara Self', { departmentId: deptId, managerId: ids.mona });
    await person('tia', 'Tia Lead', { departmentId: teamId, managerId: ids.mona });
    await person('lea', 'Lea Unmanaged', { departmentId: teamId });
    await person('omar', 'Omar Other', { departmentId: otherId });
    await person('nina', 'Nina Nodays', { departmentId: otherId }, null);
    const g9 = ((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((g) => g.code === 'G9')!;
    await person('cleo', 'Cleo Chief', { departmentId: deptId, managerId: ids.mona, gradeId: g9.id }, ['employee'], () => hrSuper);
    // Tia leads the team: Lea's leave and claims wait for her, and so does her attendance
    await api().patch(`/api/departments/${teamId}`).set('Cookie', hr).send({ headId: ids.tia }).expect(200);

    const holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)));
    for (let d = firstDay(MONTH); d <= lastDay(MONTH); d = addDays(d, 1)) if (weekday(d) <= 4 && !holidays.has(d)) work.push(d);
    friday = [...Array(7).keys()].map((n) => addDays(firstDay(MONTH), n)).find((d) => weekday(d) === 5)!;

    // Sara's permission approved in the system: it counts, not Zoho's column
    await api().post('/api/leave/permissions').set('Cookie', hr).send({ employeeId: ids.sara, date: work[0], hours: 1 }).expect(201);

    // the month's payroll, and an import on it whose days were applied
    await prisma.payrollRun.deleteMany({ where: { month: toDateOnly(firstDay(MONTH)) } });
    runId = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: MONTH }).expect(201)).body.id;
    importId = (
      await prisma.attendanceImport.create({
        data: {
          runId,
          month: toDateOnly(firstDay(MONTH)),
          files: [{ name: `everyone-${RUN}.xlsx`, sheet: 'Sheet1', rows: 20, people: 3, months: [MONTH], problems: [] }],
          people: [
            { key: 'k1', zohoId: null, zohoName: name('Rami Report'), days: [], outside: 0, pick: ids.rami, skipped: false, applied: { at: new Date().toISOString(), by: hrUserId } },
            { key: 'k2', zohoId: null, zohoName: name('Karim Stranger'), days: [], outside: 0, pick: null, skipped: true, applied: null },
            { key: 'k3', zohoId: null, zohoName: name('Quasimodo Unknownperson'), days: [], outside: 0, pick: null, skipped: false, applied: null },
          ],
          createdById: hrUserId,
          appliedById: hrUserId,
          appliedAt: new Date(),
        },
        select: { id: true },
      })
    ).id;

    const [d1, d2, d3, d4, d5] = work;
    await prisma.attendanceDay.createMany({
      data: [
        // Rami: 9:00, 8:30 (short 0:30), absent, a check-in without a check-out, leave in Zoho only, a rest day
        day('rami', d1, 'worked', { in: '10:15', out: '19:15', place: 'office', hours: 9, zohoStatus: 'Present' }),
        day('rami', d2, 'worked', { in: '10:45', out: '19:30', place: 'remote', hours: 8.5, zohoStatus: 'Present' }),
        day('rami', d3, 'absent', { zohoStatus: 'Absent' }),
        day('rami', d4, 'worked', { in: '09:10', place: 'office', zohoStatus: 'Present' }),
        day('rami', d5, 'zoho_leave', { zohoStatus: 'Annual Leave' }),
        day('rami', friday, 'rest', { zohoStatus: 'Weekend' }),
        // Sara: 8:00 with Zoho's 2:00 of permission (the system's 1:00 counts instead: short 0:00 … 9 − 8 − 1), on leave
        day('sara', d1, 'worked', { in: '09:00', out: '17:00', place: 'office', hours: 8, permission: 2 }),
        day('sara', d2, 'leave', { zohoStatus: 'Absent' }),
        // Lea: 8:00 (short 1:00), absent
        day('lea', d1, 'worked', { in: '09:00', out: '17:00', place: 'office', hours: 8 }),
        day('lea', d2, 'absent', { zohoStatus: 'Absent' }),
        // Omar: 7:00 with Zoho's 2:00 of permission (not short)
        day('omar', d1, 'worked', { in: '09:00', out: '16:00', place: 'remote', hours: 7, permission: 2 }),
        // Cleo, C-level: 9:00, absent
        day('cleo', d1, 'worked', { in: '09:00', out: '18:00', place: 'office', hours: 9 }),
        day('cleo', d2, 'absent', { zohoStatus: 'Absent' }),
      ],
    });
  });

  afterAll(async () => {
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.payrollRun.deleteMany({ where: { id: runId } });
    await prisma.permissionRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.department.updateMany({ where: { id: { in: [deptId, teamId, otherId] } }, data: { headId: null } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.department.deleteMany({ where: { id: teamId } });
    await prisma.department.deleteMany({ where: { id: { in: [deptId, otherId] } } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('Daily Attendance', () => {
    it('lists everyone’s month for HR with their figures and days, a C-level person as one hidden note, those without days, the sources and the run', async () => {
      const view = await month(hr);
      expect(view).toMatchObject({ month: MONTH, scope: 'everyone', hidden: { count: 1, label: 'C-level (1 person) — hidden' }, run: { id: runId, status: 'draft' } });
      expect(listed(view)).toEqual(['lea', 'omar', 'rami', 'sara']);
      expect(view.people.map((p) => p.employee.id)).not.toContain(ids.cleo);
      expect(view.withoutDays.map((p) => p.id)).toContain(ids.nina);
      expect(view.withoutDays.map((p) => p.id)).not.toContain(ids.cleo);

      const rami = of(view, 'rami')!;
      expect(rami.employee).toMatchObject({ fullNameEn: name('Rami Report'), department: `${name('Attendance Dept')} › Field Team`, departmentId: teamId, confidential: false });
      expect(rami).toMatchObject({ hoursADay: 9, averageHours: 8.75, permissionFrom: null });
      expect(rami.figures).toEqual({
        daysRecorded: 6,
        daysWorked: 3,
        daysCounted: 2,
        hoursCounted: 17.5,
        absentDays: 1,
        shortHours: 0.5,
        // no day past the shift's 9 hours (make-up hours, 20 October 2026: make-up-hours.e2e-spec.ts)
        extraHours: 0,
        shortHoursFilled: 0,
        permissionHours: 0,
        officeDays: 2,
        remoteDays: 1,
        leaveDays: 0,
        zohoLeaveDays: 1,
        missingCheckOuts: 1,
        // checking in on the system (19 October 2026): none of these are the system's
        missingCheckIns: 0,
        flaggedDays: 0,
        noCheckInDays: 0,
        holidays: 0,
        restDays: 1,
        // exempt from check-in (25 October 2026): none
        exemptDays: 0,
        compensatoryDays: 0,
      });
      expect(rami.days.map((d) => [d.date, d.status, d.shortHours, d.missingCheckOut])).toEqual(
        [
          [work[0], 'worked', 0, false],
          [work[1], 'worked', 0.5, false],
          [work[2], 'absent', 0, false],
          [work[3], 'worked', 0, true],
          [work[4], 'zoho_leave', 0, false],
          [friday, 'rest', 0, false],
        ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      );
      expect(rami.days[0].importId).toBe(importId);
      // the system's approved permission counts, not Zoho's column; Omar's is Zoho's
      expect(of(view, 'sara')).toMatchObject({ permissionFrom: 'system', figures: { permissionHours: 1, shortHours: 0, leaveDays: 1 } });
      expect(of(view, 'sara')!.days[0].permissionHours).toBe(1);
      expect(of(view, 'omar')).toMatchObject({ permissionFrom: 'zoho', figures: { permissionHours: 2, shortHours: 0 } });
      expect(view.sources).toEqual([expect.objectContaining({ importId, runId, runStatus: 'draft', files: [`everyone-${RUN}.xlsx`], appliedAt: expect.any(String) })]);
    });

    it('is the same for Finance, read only; the CEO and HR with Super Admin see the C-level person', async () => {
      expect(listed(await month(finance))).toEqual(['lea', 'omar', 'rami', 'sara']);
      for (const session of [ceo, hrSuper]) {
        const view = await month(session);
        expect(view.hidden).toBeNull();
        expect(of(view, 'cleo')).toMatchObject({ employee: { confidential: true }, figures: { daysWorked: 1, absentDays: 1 } });
      }
    });

    it('filters by department (with its teams) or team, by person, and only those with absences, short hours or missing check-outs', async () => {
      const dept = await month(hr, `&departmentId=${deptId}`);
      expect(listed(dept)).toEqual(['lea', 'rami', 'sara']);
      // the C-level person's note where their card is: in the department, not in the team or another person's month
      expect(dept.hidden?.count).toBe(1);
      const team = await month(hr, `&departmentId=${teamId}`);
      expect(listed(team)).toEqual(['lea', 'rami']);
      expect(team.hidden).toBeNull();
      const rami = await month(hr, `&employeeId=${ids.rami}`);
      expect(listed(rami)).toEqual(['rami']);
      expect(rami.hidden).toBeNull();
      expect((await month(hr, `&departmentId=${otherId}`)).hidden).toBeNull();
      const absences = await month(hr, '&only=absences');
      expect(listed(absences)).toEqual(['lea', 'rami']);
      expect(absences.withoutDays).toEqual([]);
      expect(listed(await month(hr, '&only=short_hours'))).toEqual(['lea', 'rami']);
      expect(listed(await month(hr, '&only=missing_check_outs'))).toEqual(['rami']);
      expect(listed(await month(hr, '&only=remote'))).toEqual(['omar', 'rami']);
      const totals = (await month(hr, `&departmentId=${teamId}`)).totals;
      expect(totals).toMatchObject({ daysWorked: 4, absentDays: 2, hoursCounted: 25.5, shortHours: 1.5 });
      expect(said(await api().get('/api/attendance?month=2026-13').set('Cookie', hr).expect(400))).toEqual(['Choose the month as YYYY-MM, e.g. 2026-10.']);
      await api().get('/api/attendance?only=everyone').set('Cookie', hr).expect(400);
    });

    it('shows a person’s month: anyone’s for HR but a C-level person’s, whom only the CEO sees', async () => {
      const rami = (await api().get(`/api/attendance/employees/${ids.rami}?month=${MONTH}`).set('Cookie', hr).expect(200)).body as PersonView;
      expect(rami).toMatchObject({ month: MONTH, self: false, run: { id: runId }, person: { employee: { id: ids.rami }, figures: { absentDays: 1 } } });
      expect(rami.sources.map((s) => s.importId)).toEqual([importId]);
      // a month without days: none, and no sources
      const earlier = (await api().get(`/api/attendance/employees/${ids.rami}?month=${EARLIER}`).set('Cookie', hr).expect(200)).body as PersonView;
      expect(earlier.person.days).toEqual([]);
      expect(earlier.sources).toEqual([]);
      await api().get(`/api/attendance/employees/${ids.cleo}?month=${MONTH}`).set('Cookie', hr).expect(404);
      await api().get(`/api/attendance/employees/${ids.cleo}?month=${MONTH}`).set('Cookie', finance).expect(404);
      expect(((await api().get(`/api/attendance/employees/${ids.cleo}?month=${MONTH}`).set('Cookie', ceo).expect(200)).body as PersonView).person.employee.confidential).toBe(true);
      await api().get(`/api/attendance/employees/00000000-0000-4000-8000-000000000000?month=${MONTH}`).set('Cookie', hr).expect(404);
      // a Super Admin without HR, the CEO or Finance (owner, 31 October 2026: the day's records "as a super admin"):
      // anyone's month, Daily Attendance too; the Summary stays HR's, the CEO's and Finance's
      const superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
      await api().get(`/api/attendance/employees/${ids.rami}?month=${MONTH}`).set('Cookie', superAdmin).expect(200);
      await api().get(`/api/attendance?month=${MONTH}`).set('Cookie', superAdmin).expect(200);
      await api().get(`/api/attendance/summary?month=${MONTH}`).set('Cookie', superAdmin).expect(403);
    });
  });

  describe('a manager’s team and an employee’s own', () => {
    it('gives a direct manager their reports’ month, without a C-level report’s, and no payroll run', async () => {
      const view = await month(sessions.mona);
      expect(view).toMatchObject({ scope: 'team', run: null, hidden: { count: 1 } });
      expect(listed(view)).toEqual(['rami', 'sara']);
      expect(view.sources[0]).toMatchObject({ importId, runStatus: null });
      await api().get(`/api/attendance/employees/${ids.rami}?month=${MONTH}`).set('Cookie', sessions.mona).expect(200);
      await api().get(`/api/attendance/employees/${ids.omar}?month=${MONTH}`).set('Cookie', sessions.mona).expect(404);
      await api().get(`/api/attendance/employees/${ids.lea}?month=${MONTH}`).set('Cookie', sessions.mona).expect(404);
      await api().get(`/api/attendance/employees/${ids.cleo}?month=${MONTH}`).set('Cookie', sessions.mona).expect(404);
    });

    it('gives a team’s lead the people of the team without a direct manager, whose leave and claims they decide', async () => {
      expect((await api().get('/api/auth/me').set('Cookie', sessions.tia).expect(200)).body.leads).toBe(true);
      const view = await month(sessions.tia);
      expect(listed(view)).toEqual(['lea']);
      expect(view.withoutDays).toEqual([]);
      await api().get(`/api/attendance/employees/${ids.lea}?month=${MONTH}`).set('Cookie', sessions.tia).expect(200);
      // Rami has a direct manager: Mona's, not the lead's
      await api().get(`/api/attendance/employees/${ids.rami}?month=${MONTH}`).set('Cookie', sessions.tia).expect(404);
    });

    it('gives everyone their own month, and nobody else’s; an employee sees no one else’s list, Summary or imports', async () => {
      const mine = (await api().get(`/api/attendance/me?month=${MONTH}`).set('Cookie', sessions.sara).expect(200)).body as PersonView;
      expect(mine).toMatchObject({ self: true, run: null, person: { employee: { id: ids.sara }, permissionFrom: 'system', figures: { daysWorked: 1, leaveDays: 1 } } });
      expect(mine.person.days.map((d) => d.status)).toEqual(['worked', 'leave']);
      await api().get(`/api/attendance/employees/${ids.sara}?month=${MONTH}`).set('Cookie', sessions.sara).expect(200);
      await api().get(`/api/attendance/employees/${ids.rami}?month=${MONTH}`).set('Cookie', sessions.sara).expect(404);
      expect(said(await api().get(`/api/attendance?month=${MONTH}`).set('Cookie', sessions.sara).expect(403))).toEqual([
        "Only HR, Finance, the CEO and managers see others' attendance. Your own is on My Attendance.",
      ]);
      await api().get(`/api/attendance/summary?month=${MONTH}`).set('Cookie', sessions.sara).expect(403);
      await api().get(`/api/attendance/summary.xlsx?month=${MONTH}`).set('Cookie', sessions.mona).expect(403);
      await api().get('/api/attendance/imports').set('Cookie', sessions.mona).expect(403);
      // a C-level person sees their own
      const cleo = (await api().get(`/api/attendance/me?month=${MONTH}`).set('Cookie', sessions.cleo).expect(200)).body as PersonView;
      expect(cleo.person).toMatchObject({ employee: { confidential: true }, figures: { absentDays: 1 } });
      // without a profile: nothing of theirs
      expect(said(await api().get('/api/attendance/me').set('Cookie', hr).expect(404))).toEqual(['You have no employee profile, so there is no attendance of yours to show.']);
    });
  });

  describe('the Summary', () => {
    const mine = (s: Summary) => s.groups.filter((g) => g.id === deptId || g.id === otherId);

    it('counts the seeded days by department and team, a team in its department too, without the C-level person for HR', async () => {
      const s = (await api().get(`/api/attendance/summary?month=${MONTH}`).set('Cookie', hr).expect(200)).body as Summary;
      expect(s).toMatchObject({ period: { from: MONTH, to: MONTH }, months: [MONTH], hidden: { count: 1 } });
      const [dept, other] = mine(s);
      expect([dept.name, dept.people, dept.personMonths]).toEqual([name('Attendance Dept'), 3, 3]);
      expect(dept.figures).toMatchObject({ daysWorked: 5, absentDays: 2, hoursCounted: 33.5, shortHours: 1.5, permissionHours: 1, remoteDays: 1, leaveDays: 1, zohoLeaveDays: 1, missingCheckOuts: 1 });
      // 33:30 over the 4 days counted
      expect(dept.averageHours).toBe(Math.round((33.5 / 4) * 60) / 60);
      expect(dept.teams.map((t) => [t.name, t.people, t.figures.absentDays, t.figures.shortHours, t.averageHours])).toEqual([['Field Team', 2, 2, 1.5, Math.round((25.5 / 3) * 60) / 60]]);
      expect([other.name, other.people, other.figures.permissionHours, other.figures.remoteDays, other.averageHours]).toEqual([name('Other Dept'), 1, 2, 1, 7]);
      // the Summary's period: a range, the months with days in it
      const range = (await api().get(`/api/attendance/summary?from=${EARLIER}&to=${MONTH}`).set('Cookie', finance).expect(200)).body as Summary;
      expect(range.months).toEqual([MONTH]);
      expect(mine(range)[0].figures).toEqual(dept.figures);
      expect(said(await api().get(`/api/attendance/summary?from=${monthsLater(MONTH, -40)}&to=${MONTH}`).set('Cookie', hr).expect(400))).toEqual(['Choose at most 36 months at once.']);
    });

    it('counts the C-level person for the CEO', async () => {
      const s = (await api().get(`/api/attendance/summary?month=${MONTH}`).set('Cookie', ceo).expect(200)).body as Summary;
      expect(s.hidden).toBeNull();
      expect(mine(s)[0]).toMatchObject({ people: 4, figures: { absentDays: 3 } });
    });

    it('downloads as a workbook for HR, the CEO and Finance, by department and team, by person and each day; in the audit log', async () => {
      const res = await api()
        .get(`/api/attendance/summary.xlsx?month=${MONTH}`)
        .set('Cookie', finance)
        .buffer(true)
        .parse((r, done) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain(`Attendance ${MONTH}.xlsx`);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as never);
      expect(wb.worksheets.map((w) => w.name)).toEqual(['By Department and Team', 'By Person', 'Days']);
      const names: unknown[] = [];
      wb.getWorksheet('By Person')!.eachRow((r) => names.push(r.getCell(3).value));
      expect(names).toEqual(expect.arrayContaining([name('Rami Report'), name('Sara Self'), name('Lea Unmanaged'), name('Omar Other')]));
      expect(names).not.toContain(name('Cleo Chief'));
      const days: unknown[] = [];
      wb.getWorksheet('Days')!.eachRow((r) => days.push(r.getCell(3).value));
      expect(days.filter((n) => n === name('Rami Report'))).toHaveLength(6);
      const logged = await prisma.auditLog.findFirst({ where: { action: 'attendance_summary_file' }, orderBy: { at: 'desc' } });
      expect(logged?.diff).toMatchObject({ from: MONTH, to: MONTH, months: [MONTH] });
    });
  });

  describe('Imports', () => {
    it('lists every import across the runs, with its run, files, people matched, to confirm or not found, and who applied it', async () => {
      for (const session of [hr, ceo, finance]) {
        const rows = (await api().get(`/api/attendance/imports?month=${MONTH}`).set('Cookie', session).expect(200)).body as {
          id: string;
          runId: string;
          month: string;
          runStatus: string;
          files: { name: string }[];
          people: number;
          counts: Record<string, number>;
          appliedAt: string | null;
          appliedBy: string | null;
          undoneAt: string | null;
        }[];
        const row = rows.find((r) => r.id === importId)!;
        expect(row).toMatchObject({ runId, month: MONTH, runStatus: 'draft', people: 3, counts: { matched: 1, toConfirm: 0, notFound: 1, skipped: 1 }, undoneAt: null });
        expect(row.files.map((f) => f.name)).toEqual([`everyone-${RUN}.xlsx`]);
        expect(row.appliedAt).not.toBeNull();
        expect(row.appliedBy).toEqual(expect.any(String));
      }
      const all = (await api().get('/api/attendance/imports').set('Cookie', hr).expect(200)).body as { id: string }[];
      expect(all.map((r) => r.id)).toContain(importId);
      expect((await api().get(`/api/attendance/imports?month=${EARLIER}`).set('Cookie', hr).expect(200)).body.map((r: { id: string }) => r.id)).not.toContain(importId);
    });
  });
});
