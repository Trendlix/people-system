import type { INestApplication } from '@nestjs/common';
import { OFFICE_ADDRESS_DEFAULTS } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { firstDay, lastDay, monthName, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { officeAt, ZOHO_HOME, ZOHO_OFFICE, zohoWorkbook, type ZohoTestPerson } from './fixtures/zoho.js';
import { createApp, createUser, signIn } from './helpers.js';

// Attendance from Zoho People (owner, 19 October 2026: attendance runs in Zoho People today, "Import Zoho now, replace it
// later"): upload Zoho's attendance entries on a draft run (one file with everyone, or many), the review (people matched
// by their remembered Zoho ID, by name with the Arabic names' spellings alike, close names for HR to confirm, none for HR
// to pick or skip; each one's month by the system's shift, leave, holidays and permission), apply (the lines' worked
// hours, no-show days and permission hours from Zoho, the days kept), the C-level people's lines left for the CEO, and
// the office addresses on Payroll Setup. The workbooks are made up here (test/fixtures/zoho.ts): every person and place
// is invented. These tests look at their own people (names end with RUN) and delete what they made.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const MONTH = monthsLater(CURRENT, -1); // last month: its days are past
const OTHER = monthsLater(CURRENT, -2);

interface Person {
  key: string;
  zohoId: string | null;
  zohoName: string;
  match: string;
  employee: { id: string; fullNameEn: string } | null;
  candidates: { id: string; similarity: number }[];
  duplicate: boolean;
  lineId: string | null;
  editable: boolean;
  confidential: boolean;
  rows: number;
  month: {
    days: { date: string; status: string; hoursCounted: number; place: string | null }[];
    daysWorked: number;
    officeDays: number;
    remoteDays: number;
    hoursCounted: number;
    absentDays: number;
    permissionHours: number | null;
    permissionFrom: string | null;
    zohoLeaveDays: string[];
    missingDays: string[];
    outside: number;
    warnings: string[];
  } | null;
  applied: { at: string; by: string | null } | null;
  undone: { at: string; by: string | null } | null;
}

interface Review {
  id: string;
  month: string;
  files: { name: string; rows: number; people: number; months: string[] }[];
  people: Person[];
  hidden: { count: number; label: string } | null;
  counts: { matched: number; toConfirm: number; notFound: number; skipped: number; notOnRun: number };
  canApply: boolean;
  undoable: number;
}

interface Line {
  id: string;
  employeeId: string;
  terms: { permissionHours?: number };
  inputs: { workedHours: number | null; noShowDays: number | null; permissionHours: number | null; leaveDays?: number | null };
  result: { permissionHours?: number; noShowCut: number };
  attendanceImport: { source: string; importId: string; fields: string[]; before?: Record<string, number | null> } | null;
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

describe('Zoho People attendance import (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let hrSuper: string;
  let emailDomainBefore: string | null;
  let deptId: string;
  let shiftId: string;
  let runId: string;
  const ids: Record<string, string> = {};
  const people: string[] = [];
  const work: string[] = []; // the month's Sundays to Thursdays, none of them a holiday
  let friday: string;
  const api = () => request(app.getHttpServer());

  async function person(key: string, name: string, employment: Record<string, unknown> = {}, signed = true, session = () => hr) {
    const created = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    people.push(created.body.id);
    ids[key] = created.body.id;
    const hired = await api()
      .post(`/api/employees/${created.body.id}/employments`)
      .set('Cookie', session())
      .send({ employmentType: 'full_time', joinDate: firstDay(monthsLater(CURRENT, -4)), departmentId: deptId, shiftId, ...employment })
      .expect(201);
    if (signed) {
      const draft = (await api().post(`/api/employees/${created.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', session()).send({ grossSalary: 15000, durationMonths: 24 }).expect(201))
        .body as { id: string; startDate: string };
      await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', session()).send({ signedOn: draft.startDate }).expect(200);
    }
  }

  const upload = (files: [Buffer, string][], session = hr) => {
    let req = api().post(`/api/payroll/runs/${runId}/attendance-imports`).set('Cookie', session);
    for (const [data, name] of files) req = req.attach('files', data, name);
    return req;
  };
  const review = async (importId: string, session = hr) => (await api().get(`/api/payroll/runs/${runId}/attendance-imports/${importId}`).set('Cookie', session).expect(200)).body as Review;
  const choose = (importId: string, body: object, session = hr) => api().patch(`/api/payroll/runs/${runId}/attendance-imports/${importId}/people`).set('Cookie', session).send(body);
  const apply = (importId: string, session = hr) => api().post(`/api/payroll/runs/${runId}/attendance-imports/${importId}/apply`).set('Cookie', session);
  const undo = (importId: string, session = hr) => api().post(`/api/payroll/runs/${runId}/attendance-imports/${importId}/undo`).set('Cookie', session);
  const typeIn = (lineId: string, inputs: Record<string, number | null>) => api().patch(`/api/payroll/runs/${runId}/lines`).set('Cookie', hr).send({ lines: [{ id: lineId, inputs }] });
  const lines = async (session = hr) => (await api().get(`/api/payroll/runs/${runId}`).set('Cookie', session).expect(200)).body.lines as Line[];
  const lineOf = async (key: string, session = hr) => (await lines(session)).find((l) => l.employeeId === ids[key])!;
  const named = (r: Review, name: string) => r.people.find((p) => p.zohoName === name)!;

  // the people in Zoho's files: their names as Zoho spells them
  const RANIA = `Rania Invented Gerges ${RUN}`; // the profile spells it Girgis: the same name
  const OMAR = `Omar Madeupp ${RUN}`; // the profile is Omar Madeup: close, for HR to confirm
  const L_TEST = 'L. Testperson'; // Lina, not found by name: HR picks her
  const STRANGER = `Karim Stranger ${RUN}`; // nobody: HR skips him
  const CLEO = `Cleo Chief ${RUN}`; // C-level: the CEO's
  const NADIA = `Nadia Nocontract ${RUN}`; // matched, but not on the payroll

  function zohoPeople(): ZohoTestPerson[] {
    const [d1, d2, d3, d4, d5, d6] = work;
    return [
      {
        id: `71-${RUN}`,
        name: RANIA,
        days: [
          { date: d1, in: '10:23', out: '18:31', inLocation: ZOHO_OFFICE }, // 8:08
          { date: d2, in: '08:30', out: '19:30', inLocation: ZOHO_HOME, outLocation: ZOHO_HOME }, // 9:00 within 9:00–19:00
          { date: d3, status: 'Absent' }, // absent
          { date: d4, status: 'Annual Leave' }, // leave in Zoho only
          { date: d5, status: 'Absent' }, // on leave in the system
          { date: d6, in: '09:00', out: '16:00', inLocation: officeAt(17), permission: '02:00' }, // 7:00, 2 hours' permission
          { date: friday, status: 'Weekend' },
          { date: `${OTHER}-15`, in: '09:00', out: '18:00' }, // another month's
        ],
      },
      { id: `72-${RUN}`, name: OMAR, days: [{ date: d1, in: '09:00', out: '18:00', permission: '01:30' }, { date: d2, status: 'Absent' }] },
      {
        id: `73-${RUN}`,
        name: L_TEST,
        days: [
          { date: d1, in: '09:30', out: '18:30', inLocation: officeAt(13) }, // 9:00
          // the shift's 15 minutes' grace (owner, 19 October 2026): counted until 7:15 PM
          { date: d2, in: '10:30', out: '19:30', inLocation: officeAt(13) }, // 8:45
          { date: d3, in: '10:15', out: '19:15', inLocation: officeAt(13) }, // 9:00
        ],
      },
      { id: `74-${RUN}`, name: STRANGER, days: [{ date: d1, in: '09:00', out: '17:00' }] },
      { id: `75-${RUN}`, name: CLEO, days: [{ date: d1, in: '09:00', out: '18:00' }, { date: d2, status: 'Absent' }] },
      { id: `76-${RUN}`, name: NADIA, days: [{ date: d1, in: '09:00', out: '18:00' }] },
    ];
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    await api().patch('/api/payroll/settings').set('Cookie', hr).send({ officeAddresses: [...OFFICE_ADDRESS_DEFAULTS] }).expect(200);
    await api().patch('/api/leave/settings').set('Cookie', hr).send({ permissionHoursPerMonth: 4, permissionMaxHoursPerDay: 2 }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Attendance ${RUN}` }).expect(201)).body.id;
    // the MORNING shift: 9 hours within 9:00–19:00, Sunday to Thursday (owner, 16 October 2026)
    shiftId = (
      await prisma.shift.create({
        data: { code: `M${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('19:00'), hoursPerDay: 9, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4] },
        select: { id: true },
      })
    ).id;

    const holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)));
    for (let d = firstDay(MONTH); d <= lastDay(MONTH); d = addDays(d, 1)) if (weekday(d) <= 4 && !holidays.has(d)) work.push(d);
    friday = [...Array(7).keys()].map((n) => addDays(firstDay(MONTH), n)).find((d) => weekday(d) === 5)!;

    await person('rania', 'Rania Invented Girgis');
    await person('omar', 'Omar Madeup');
    await person('lina', 'Lina Testperson');
    await person('nadia', 'Nadia Nocontract', {}, false);
    const g9 = ((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((g) => g.code === 'G9')!;
    await person('cleo', 'Cleo Chief', { gradeId: g9.id }, true, () => hrSuper);

    // Rania's leave in the system on the 5th working day (unpaid: a first year's annual leave waits six months); Omar's
    // permission approved in the system
    const types = Object.fromEntries(((await api().get('/api/leave/types').set('Cookie', hr).expect(200)).body as { id: string; key: string }[]).map((t) => [t.key, t.id]));
    await api().post('/api/leave/requests').set('Cookie', hr).field('employeeId', ids.rania).field('typeId', types.unpaid).field('startDate', work[4]).field('endDate', work[4]).expect(201);
    await api().post('/api/leave/permissions').set('Cookie', hr).send({ employeeId: ids.omar, date: work[0], hours: 1 }).expect(201);

    await prisma.payrollRun.deleteMany({ where: { month: toDateOnly(firstDay(MONTH)) } });
    runId = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: MONTH }).expect(201)).body.id;
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: runId } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.permissionRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/payroll/settings').set('Cookie', hr).send({ officeAddresses: [...OFFICE_ADDRESS_DEFAULTS] }).expect(200);
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('Payroll Setup: the office addresses', () => {
    it('are Al Doctor Al Mahrouqi Street 13, 15 and 17 and Trendlix to start with; HR changes them', async () => {
      expect((await api().get('/api/payroll/settings').set('Cookie', hr).expect(200)).body.officeAddresses).toEqual([...OFFICE_ADDRESS_DEFAULTS]);
      expect(said(await api().patch('/api/payroll/settings').set('Cookie', hr).send({ officeAddresses: ['Trendlix', ' trendlix '] }).expect(400))).toEqual(['"trendlix" is there twice: keep it once.']);
      const changed = (await api().patch('/api/payroll/settings').set('Cookie', hr).send({ officeAddresses: ['  Trendlix ', ''] }).expect(200)).body;
      expect(changed.officeAddresses).toEqual(['Trendlix']);
      await api().patch('/api/payroll/settings').set('Cookie', hr).send({ officeAddresses: [...OFFICE_ADDRESS_DEFAULTS] }).expect(200);
    });
  });

  describe('uploading', () => {
    it('refuses what isn’t Zoho’s workbook, more than 60 files, a file over 5 MB, and files of another month only', async () => {
      expect(said(await upload([[Buffer.from('Employee Name,Date\nSomeone,01-Sep-2026\n'), 'attendance.csv']]).expect(400))).toEqual([
        "attendance.csv isn't an Excel workbook (.xlsx). Export the attendance entries from Zoho People as Excel (XLSX) and upload that file.",
      ]);
      await upload([]).expect(400);
      const tiny = await zohoWorkbook([{ id: '1', name: 'Invented', days: [{ date: work[0], in: '09:00', out: '18:00' }] }]);
      expect(said(await upload(Array.from({ length: 61 }, (_, i) => [tiny, `p${i}.xlsx`] as [Buffer, string])).expect(400))).toEqual(['Upload at most 60 files at once.']);
      expect((await upload([[Buffer.alloc(5 * 1024 * 1024 + 1, 1), 'big.xlsx']]).expect(413)).body.message).toBe('Each file must be 5 MB or smaller.');
      const august = await zohoWorkbook([{ id: '1', name: 'Invented', days: [{ date: `${OTHER}-10`, in: '09:00', out: '18:00' }] }]);
      expect(said(await upload([[august, 'old.xlsx']]).expect(400))).toEqual([
        `These files have no day of ${monthName(MONTH)}, this payroll's month (they are of ${monthName(OTHER)}). Export ${monthName(MONTH)}'s attendance entries from Zoho People.`,
      ]);
      // only HR uploads
      await upload([[tiny, 'p.xlsx']], ceo).expect(403);
    });
  });

  describe('the review and apply', () => {
    let importId: string;
    let secondId: string;

    it('matches people by name (spellings alike), asks about a close one, finds none for others; works each month out by the system’s rules', async () => {
      // one file with everyone but Nadia, and Nadia's own
      const all = zohoPeople();
      const made = (await upload([
        [await zohoWorkbook(all.filter((p) => p.name !== NADIA)), 'everyone.xlsx'],
        [await zohoWorkbook(all.filter((p) => p.name === NADIA)), 'nadia.xlsx'],
      ]).expect(201)).body as Review;
      importId = made.id;
      expect(made.files.map((f) => [f.name, f.people])).toEqual([
        ['everyone.xlsx', 5],
        ['nadia.xlsx', 1],
      ]);
      expect(made.files[0].months).toEqual([OTHER, MONTH]);

      const rania = named(made, RANIA);
      expect(rania).toMatchObject({ match: 'exact', employee: { id: ids.rania }, duplicate: false, editable: true, confidential: false, rows: 7 });
      expect(rania.month).toMatchObject({
        daysWorked: 3,
        officeDays: 2,
        remoteDays: 1,
        absentDays: 1,
        permissionHours: 2,
        permissionFrom: 'zoho',
        zohoLeaveDays: [work[3]],
        outside: 1,
      });
      expect(rania.month!.hoursCounted).toBeCloseTo(8 + 8 / 60 + 9 + 7, 6);
      const expected: [string, string][] = [
        [work[0], 'worked'],
        [work[1], 'worked'],
        [work[2], 'absent'],
        [work[3], 'zoho_leave'],
        [work[4], 'leave'],
        [work[5], 'worked'],
        [friday, 'rest'],
      ];
      expect(rania.month!.days.map((d) => [d.date, d.status])).toEqual(expected.sort((a, b) => a[0].localeCompare(b[0])));
      expect(rania.month!.missingDays).toEqual(work.slice(6));
      expect(rania.month!.warnings[0]).toBe("1 day is of another month than this payroll's: left out.");

      expect(named(made, OMAR)).toMatchObject({ match: 'close', employee: null, candidates: [{ id: ids.omar, similarity: 1 }], month: null });
      expect(named(made, L_TEST)).toMatchObject({ match: 'none', employee: null, candidates: [] });
      expect(named(made, STRANGER).match).toBe('none');
      expect(named(made, NADIA)).toMatchObject({ match: 'exact', lineId: null, editable: false });
      // Cleo is C-level: HR doesn't see her row
      expect(made.people.map((p) => p.zohoName)).not.toContain(CLEO);
      expect(made.hidden).toEqual({ count: 1, label: 'C-level (1 person): the CEO fills their lines' });
      expect(made.counts).toEqual({ matched: 2, toConfirm: 1, notFound: 2, skipped: 0, notOnRun: 1 });
      expect(made.canApply).toBe(true);
      // the addresses aren't kept, only office or remote
      const kept = JSON.stringify((await prisma.attendanceImport.findUniqueOrThrow({ where: { id: importId } })).people);
      expect(kept).not.toContain('Mahrouqi');
      expect(kept).not.toContain('Invented Street');
    });

    it('HR confirms a close name, picks someone not found, skips a stranger', async () => {
      const r = await review(importId);
      await choose(importId, { key: named(r, OMAR).key, employeeId: ids.omar }).expect(200);
      await choose(importId, { key: named(r, L_TEST).key, employeeId: ids.lina }).expect(200);
      const after = (await choose(importId, { key: named(r, STRANGER).key, skipped: true }).expect(200)).body as Review;
      expect(named(after, OMAR)).toMatchObject({ match: 'confirmed', employee: { id: ids.omar } });
      expect(named(after, OMAR).month).toMatchObject({ daysWorked: 1, absentDays: 1, hoursCounted: 9, permissionHours: null, permissionFrom: 'system' });
      expect(named(after, OMAR).month!.warnings).toContain("The permission requests approved in the system count this month, not Zoho's permission column.");
      expect(named(after, L_TEST)).toMatchObject({ match: 'confirmed', employee: { id: ids.lina } });
      // the shift's grace moves the window's end to 7:15 PM (owner, 19 October 2026: "if the employee checked in 10:15 he
      // can check out till 7:15 and the 9 hours are counted")
      expect(named(after, L_TEST).month!.days.map((d) => d.hoursCounted)).toEqual([9, 8.75, 9]);
      expect(named(after, STRANGER).match).toBe('skipped');
      expect(after.counts).toEqual({ matched: 4, toConfirm: 0, notFound: 0, skipped: 1, notOnRun: 1 });
      await choose(importId, { key: 'nobody', skipped: true }).expect(404);
      // a C-level person HR doesn't see can't be picked by HR
      expect(said(await choose(importId, { key: named(r, STRANGER).key, employeeId: ids.cleo }).expect(400))).toEqual(['Employee not found. Choose the employee from the list.']);
    });

    it('applies to the lines HR fills: worked hours, no-show days and permission hours from Zoho; the days kept; the Zoho IDs remembered', async () => {
      const before = await lineOf('cleo', ceo);
      // what HR typed before: Undo puts it back
      await typeIn((await lineOf('lina')).id, { workedHours: 100 }).expect(200);
      const applied = (await apply(importId).expect(200)).body as Review;
      expect(named(applied, RANIA).applied).toMatchObject({ by: expect.any(String) });
      expect(named(applied, NADIA).applied).toBeNull();

      const rania = await lineOf('rania');
      expect(rania.inputs.workedHours).toBeCloseTo(24 + 8 / 60, 6);
      expect(rania.inputs).toMatchObject({ noShowDays: 1, permissionHours: 2 });
      expect(rania.result).toMatchObject({ permissionHours: 2 });
      expect(rania.result.noShowCut).toBe(1000); // 2 days of 15,000 ÷ 30
      expect(rania.attendanceImport).toMatchObject({ source: 'zoho', importId, fields: ['workedHours', 'noShowDays', 'permissionHours'] });
      // Omar's permission is the system's: the typed one cleared, the request's hour counted
      const omar = await lineOf('omar');
      expect(omar.inputs).toMatchObject({ workedHours: 9, noShowDays: 1, permissionHours: null });
      expect(omar.terms.permissionHours).toBe(1);
      // Cleo's line is the CEO's: untouched by HR
      expect((await lineOf('cleo', ceo)).inputs).toEqual(before.inputs);

      const days = await prisma.attendanceDay.findMany({ where: { employeeId: ids.rania }, orderBy: { date: 'asc' } });
      expect(days.map((d) => [fromDateOnly(d.date), d.status, d.place])).toEqual([
        [work[0], 'worked', 'office'],
        [work[1], 'worked', 'remote'],
        [work[2], 'absent', null],
        [work[3], 'zoho_leave', null],
        [work[4], 'leave', null],
        [work[5], 'worked', 'office'],
        [friday, 'rest', null],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
      expect(days.every((d) => d.source === 'zoho' && d.importId === importId)).toBe(true);
      expect(days.find((d) => fromDateOnly(d.date) === work[5])?.permissionHours?.toNumber()).toBe(2);
      expect((await prisma.employee.findUniqueOrThrow({ where: { id: ids.rania } })).zohoPeopleId).toBe(`71-${RUN}`);
      expect((await prisma.employee.findUniqueOrThrow({ where: { id: ids.lina } })).zohoPeopleId).toBe(`73-${RUN}`);
      const log = await prisma.auditLog.findMany({ where: { entityType: 'attendance_import', entityId: importId }, orderBy: { at: 'asc' } });
      expect(log.map((l) => l.action)).toEqual(['create', 'update', 'update', 'update', 'apply']);

      // what the import filled isn't typed over (owner, 19 October 2026: "imported data shouldn't be editable")
      const [y, m, d] = TODAY.split('-');
      expect((await typeIn(rania.id, { workedHours: 150 }).expect(409)).body.message).toBe(
        `Worked hours for Rania Invented Girgis ${RUN} came from the Zoho import of ${d}/${m}/${y}: import the month again to change them, or undo that import on its review.`,
      );
      expect((await typeIn(rania.id, { noShowDays: 0 }).expect(409)).body.message).toContain(`No-show days for Rania Invented Girgis ${RUN} came from the Zoho import`);
      await typeIn(rania.id, { permissionHours: null }).expect(409);
      // sent as it is it is no change, and the figures not from Zoho stay HR's (the expected hours aren't typed at all
      // since 20 October 2026: worked out from the shift)
      await typeIn(rania.id, { workedHours: rania.inputs.workedHours, leaveDays: 1 }).expect(200);
      const after = await lineOf('rania');
      expect(after.inputs).toMatchObject({ workedHours: rania.inputs.workedHours, leaveDays: 1 });
      expect(after.attendanceImport?.fields).toEqual(['workedHours', 'noShowDays', 'permissionHours']);
      await typeIn(rania.id, { leaveDays: null }).expect(200);
    });

    it('the CEO sees the C-level people of the files and applies theirs, nobody else’s', async () => {
      const r = await review(importId, ceo);
      expect(named(r, CLEO)).toMatchObject({ match: 'exact', confidential: true, editable: true });
      expect(named(r, RANIA).editable).toBe(false);
      const ranias = await lineOf('rania');
      await apply(importId, ceo).expect(200);
      expect((await lineOf('cleo', ceo)).inputs).toMatchObject({ workedHours: 9, noShowDays: 1 });
      expect((await lineOf('rania')).inputs).toEqual(ranias.inputs);
    });

    it('matches by the remembered Zoho ID next time, and importing the month again replaces its Zoho days', async () => {
      const again = (await upload([[await zohoWorkbook([{ id: `71-${RUN}`, name: 'R. I. G.', days: [{ date: work[0], in: '09:00', out: '18:00' }] }]), 'rania.xlsx']]).expect(201)).body as Review;
      secondId = again.id;
      expect(again.people[0]).toMatchObject({ match: 'linked', employee: { id: ids.rania } });
      await apply(again.id).expect(200);
      const days = await prisma.attendanceDay.findMany({ where: { employeeId: ids.rania } });
      expect(days.map((d) => fromDateOnly(d.date))).toEqual([work[0]]);
      expect((await lineOf('rania')).inputs).toMatchObject({ workedHours: 9, noShowDays: 0, permissionHours: null });
    });

    it('undoes an import: the lines HR fills from it get back what HR had typed, its days go; the CEO undoes the C-level people’s', async () => {
      // the first import still filled Omar's and Lina's lines (HR's) and Cleo's (the CEO's); Rania's is the second's
      expect((await review(importId)).undoable).toBe(2);
      const undone = (await undo(importId).expect(200)).body as Review;
      expect(undone.undoable).toBe(0);
      expect(named(undone, L_TEST)).toMatchObject({ applied: null, undone: { by: expect.any(String) } });
      const lina = await lineOf('lina');
      expect(lina.inputs).toMatchObject({ workedHours: 100, noShowDays: null, permissionHours: null });
      expect(lina.attendanceImport).toBeNull();
      expect((await lineOf('omar')).inputs).toMatchObject({ workedHours: null, noShowDays: null, permissionHours: null });
      expect((await lineOf('rania')).attendanceImport?.importId).toBe(secondId);
      expect((await lineOf('cleo', ceo)).attendanceImport?.importId).toBe(importId);
      // its days go for those put back: Cleo's stay, the CEO's to undo
      expect(await prisma.attendanceDay.count({ where: { importId, employeeId: { in: [ids.omar, ids.lina] } } })).toBe(0);
      expect(await prisma.attendanceDay.count({ where: { importId, employeeId: ids.cleo } })).toBe(2);
      // nothing left of it for HR; once undone, HR types the figures again
      expect((await undo(importId).expect(409)).body.message).toBe('Nothing on this payroll is filled from this import for you to undo.');
      await typeIn(lina.id, { workedHours: 120 }).expect(200);

      await undo(importId, ceo).expect(200);
      expect((await lineOf('cleo', ceo)).attendanceImport).toBeNull();
      expect((await lineOf('cleo', ceo)).inputs).toMatchObject({ workedHours: null, noShowDays: null });
      expect(await prisma.attendanceDay.count({ where: { importId } })).toBe(0);
      expect((await prisma.attendanceImport.findUniqueOrThrow({ where: { id: importId } })).appliedAt).toBeNull();
      const log = await prisma.auditLog.findMany({ where: { entityType: 'attendance_import', entityId: importId, action: 'undo' }, orderBy: { at: 'asc' } });
      expect(log.map((l) => (l.diff as { lines: number }).lines)).toEqual([2, 1]);

      // the second, undone: Rania's line back to empty, as before the first (an earlier import's figures are never kept as HR's)
      await undo(secondId).expect(200);
      expect((await lineOf('rania')).inputs).toMatchObject({ workedHours: null, noShowDays: null, permissionHours: null });
      expect(await prisma.attendanceDay.count({ where: { employeeId: ids.rania } })).toBe(0);
      // applied again, it fills them again
      await apply(secondId).expect(200);
      expect((await lineOf('rania')).inputs).toMatchObject({ workedHours: 9, noShowDays: 0 });
    });

    it('is only on a draft run', async () => {
      await prisma.payrollRun.update({ where: { id: runId }, data: { status: 'pending_ceo' } });
      try {
        const file = await zohoWorkbook([{ id: '1', name: 'Invented', days: [{ date: work[0], in: '09:00', out: '18:00' }] }]);
        expect((await upload([[file, 'a.xlsx']]).expect(409)).body.message).toBe(`The ${monthName(MONTH)} payroll isn't a draft any more, so attendance can't be imported on it.`);
        await apply(importId).expect(409);
        await undo(secondId).expect(409);
      } finally {
        await prisma.payrollRun.update({ where: { id: runId }, data: { status: 'draft' } });
      }
    });
  });
});
