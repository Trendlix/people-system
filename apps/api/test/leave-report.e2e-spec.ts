import type { INestApplication } from '@nestjs/common';
import { DEVELOPER_NO_FILES, HIDDEN, type LeaveReport } from '@trendlix/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, weekday } from '../src/common/date-only.js';
import { firstDay, lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The Leave report (owner, 26 October 2026: "can i get a report for the monthly leaves with all types?"; asked, "Both" (a
// summary and a list), to count the permission hours, the work from home days and the annual balance left, and "A month, or
// a range"): the approved leave of a month or a range, a leave crossing a month's end counted by its days inside, the
// summary by person and type, the list, and the same as an Excel workbook; HR and the CEO, as Leave Requests; the C-level
// people left out for HR and counted; never the workbook for a developer. Other test files leave leave behind in the same
// database, so the checks look at this run's department (and its people, whose names end with RUN). Everything made here is
// deleted at the end. Every name is invented.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const M1 = monthsLater(TODAY.slice(0, 7), 1);
const M2 = monthsLater(M1, 1);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Report = LeaveReport & { generatedAt: string; balanceAsOf: string; confidentialExcluded: number };

/** Reads a response body as bytes, whatever its type. */
const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

/** A sheet's rows as their values, A to the last column. */
function rowsOf(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}

const messagesOf = (res: request.Response) => [...new Set([res.body.message].flat() as string[])];

describe('Leave report (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  let admin: string;
  let superAdmin: string;
  let owner: string; // HR, the CEO and a Super Admin: records the C-level person's leave
  let manager: string;
  let staff: string;
  let developer: string;
  let g9: string;
  let g9WasConfidential: boolean;
  let dept: string;
  let team: string;
  const people: string[] = [];
  const ids: Record<string, string> = {};
  const codes: Record<string, string> = {};
  const types: Record<string, string> = {};
  const holidays = new Set<string>();
  const api = () => request(app.getHttpServer());

  /** A month's working days (Sunday to Thursday, no official holiday), in order. */
  const working = (month: string) => {
    const out: string[] = [];
    for (let d = firstDay(month); d <= lastDay(month); d = addDays(d, 1)) if (weekday(d) <= 4 && !holidays.has(d)) out.push(d);
    return out;
  };

  async function hire(key: string, name: string, employment: Record<string, unknown> = {}, session = hr) {
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تقرير الإجازات', gender: 'female' }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    codes[key] = res.body.employeeCode;
    const hired = await api().post(`/api/employees/${res.body.id}/employments`).set('Cookie', session).send({ employmentType: 'full_time', departmentId: dept, joinDate: '2025-01-01', ...employment }).expect(201);
    const draft = (await api().post(`/api/employees/${res.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', session).send({ grossSalary: 12000, durationMonths: 60 }).expect(201)).body as { id: string; startDate: string };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', session).send({ signedOn: draft.startDate }).expect(200);
  }

  const record = (key: string, type: string, startDate: string, endDate = startDate, halfDay = false, session = hr) =>
    api().post('/api/leave/requests').set('Cookie', session).field('employeeId', ids[key]).field('typeId', types[type]).field('startDate', startDate).field('endDate', endDate).field('halfDay', String(halfDay));

  const get = (query: Record<string, string | number> = {}, session = hr) => api().get('/api/reports/leave').query(query).set('Cookie', session);
  /** The report for this run's department, unless the query says otherwise. */
  const report = async (query: Record<string, string | number> = {}, session = hr) => (await get({ departmentId: dept, ...query }, session).expect(200)).body as Report;
  const workbookFile = (query: Record<string, string | number>, session = hr) => api().get('/api/reports/leave.xlsx').query(query).set('Cookie', session).buffer(true).parse(bytes);
  /** A person's row, by key. */
  const rowOf = (r: Report, key: string) => r.people.find((p) => p.employee.id === ids[key]);

  // the days the people are off, found in beforeAll from the months' working days
  let crossStart: string; // Ana: annual leave, the last 3 working days of M1 (a week-end between them and M2's first days)
  let crossEnd: string;
  let insideM1: number;
  let insideM2: number;
  let casualDay: string; // Ben: a casual half day in M1
  let permissionDay: string;
  let wfhDay: string;
  let clara: string; // C-level
  let unpaidDay: string; // Cy: unpaid leave in M2 only

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    owner = await signIn(app, await createUser(prisma, ['hr', 'ceo', 'super_admin']));
    manager = await signIn(app, await createUser(prisma, ['manager', 'employee']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    developer = await signIn(app, await createUser(prisma, ['developer']));

    // G9 · Executive is C-level (owner, 19 October 2026), as the migration marks it
    const grade = await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true, confidential: true } });
    g9 = grade.id;
    g9WasConfidential = grade.confidential;
    await prisma.grade.update({ where: { id: g9 }, data: { confidential: true } });

    for (const h of await prisma.holiday.findMany({ select: { date: true } })) holidays.add(fromDateOnly(h.date));
    for (const t of (await api().get('/api/leave/types').set('Cookie', hr).expect(200)).body as { id: string; key: string }[]) types[t.key] = t.id;

    dept = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Leave Report ${RUN}` }).expect(201)).body.id;
    team = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Field', parentId: dept }).expect(201)).body.id;

    await hire('ana', 'Ana Crossing');
    await hire('ben', 'Ben Casual', { departmentId: team });
    await hire('cy', 'Cy Unpaid');
    await hire('dee', 'Dee Nothing');
    await hire('clara', 'Clara Chief', { gradeId: g9 }, owner);
    clara = ids.clara;

    // Ana: annual leave over the last 3 working days of M1 into the first 2 of M2
    const w1 = working(M1);
    const w2 = working(M2);
    crossStart = w1[w1.length - 3];
    crossEnd = w2[1];
    insideM1 = 3;
    insideM2 = 2;
    await record('ana', 'annual', crossStart, crossEnd).expect(201);
    // Ben: a casual half day, a permission and a work from home day in M1
    [casualDay, permissionDay, wfhDay] = [w1[1], w1[3], w1[5]];
    await record('ben', 'casual', casualDay, casualDay, true).expect(201);
    await api().post('/api/leave/permissions').set('Cookie', hr).send({ employeeId: ids.ben, date: permissionDay, hours: 2 }).expect(201);
    await api().post('/api/wfh').set('Cookie', hr).send({ employeeId: ids.ben, date: wfhDay, reason: 'Plumber' }).expect(201);
    // Cy: unpaid leave in M2 only, and a leave still waiting for a decision is never counted
    unpaidDay = w2[4];
    await record('cy', 'unpaid', unpaidDay).expect(201);
    // Clara (C-level): a day of annual leave in M1, recorded by the owner
    await record('clara', 'annual', w1[2], w1[2], false, owner).expect(201);
  });

  afterAll(async () => {
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.permissionRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.wfhRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveBalanceYear.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.department.deleteMany({ where: { id: { in: [team].filter(Boolean) } } });
    await prisma.department.deleteMany({ where: { id: { in: [dept].filter(Boolean) } } });
    if (g9) await prisma.grade.update({ where: { id: g9 }, data: { confidential: g9WasConfidential } });
    await app.close();
  });

  describe('who sees it', () => {
    it('HR and the CEO; not Finance, an Admin, a Super Admin, a manager or an employee as such', async () => {
      for (const session of [hr, ceo, owner]) {
        await get({ departmentId: dept, from: M1 }, session).expect(200).expect('Cache-Control', 'private, no-store');
        await workbookFile({ departmentId: dept, from: M1 }, session).expect(200);
      }
      for (const session of [finance, admin, superAdmin, manager, staff]) {
        await get({}, session).expect(403);
        await workbookFile({}, session).expect(403);
      }
      await api().get('/api/reports/leave').expect(401);
    });
  });

  describe('the period', () => {
    it('is this month unless asked; one month alone is that month; a range is as sent', async () => {
      const month = TODAY.slice(0, 7);
      expect((await report()).filters.period).toEqual({ from: month, to: month });
      expect((await report({ from: M1 })).filters.period).toEqual({ from: M1, to: M1 });
      expect((await report({ to: M2 })).filters.period).toEqual({ from: M2, to: M2 });
      expect((await report({ from: M1, to: M2 })).filters.period).toEqual({ from: M1, to: M2 });
    });

    it('refuses months it can’t read, a period ending before it starts, and ids it doesn’t know', async () => {
      expect(messagesOf(await get({ from: '2026-13' }).expect(400))).toEqual(['Choose the month the period starts in, as YYYY-MM, e.g. 2026-01.']);
      expect(messagesOf(await get({ from: M2, to: M1 }).expect(400))).toEqual(['The period ends before it starts: choose a "to" month on or after the "from" month.']);
      expect(messagesOf(await get({ departmentId: 'ops' }).expect(400))).toEqual(['Choose the department or team from the list.']);
      expect(messagesOf(await get({ departmentId: '0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e' }).expect(400))).toEqual(['Choose the department or team from the list.']);
      expect(messagesOf(await get({ employeeId: 'ana' }).expect(400))).toEqual(['Choose the employee from the list.']);
      expect(messagesOf(await get({ employeeId: '0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e' }).expect(400))).toEqual(['Choose the employee from the list.']);
    });
  });

  describe('a month', () => {
    it('counts a leave crossing the month’s end by its days inside, each month its own', async () => {
      const m1 = await report({ from: M1 });
      const m2 = await report({ from: M2 });
      expect(rowOf(m1, 'ana')).toMatchObject({ leaveDays: insideM1, days: { [types.annual]: insideM1 } });
      expect(rowOf(m2, 'ana')).toMatchObject({ leaveDays: insideM2, days: { [types.annual]: insideM2 } });
      // the list has the one leave in both, with its days inside and all of them
      const listed = (r: Report) => r.leaves.filter((l) => l.employee.id === ids.ana).map((l) => [l.startDate, l.endDate, l.daysInPeriod, l.days]);
      expect(listed(m1)).toEqual([[crossStart, crossEnd, insideM1, insideM1 + insideM2]]);
      expect(listed(m2)).toEqual([[crossStart, crossEnd, insideM2, insideM1 + insideM2]]);
    });

    it('has the casual half day as 0.5, the permission hours, the work from home day and the annual balance', async () => {
      const m1 = await report({ from: M1 });
      expect(rowOf(m1, 'ben')).toMatchObject({ leaveDays: 0.5, days: { [types.casual]: 0.5 }, permissionHours: 2, wfhDays: 1 });
      // the balance as the balances page shows it (today's year, the period ending ahead)
      const page = (await api().get(`/api/employees/${ids.ana}/leave?year=${TODAY.slice(0, 4)}`).set('Cookie', hr).expect(200)).body as { annual: { available: number } };
      expect(m1.balanceAsOf).toBe(TODAY);
      expect(rowOf(m1, 'ana')!.annualLeft).toBe(page.annual.available);
      // the types with days in the month are the columns, in Leave Setup's order; the unpaid day is in M2 only
      expect(m1.types.map((t) => t.id).sort()).toEqual([types.annual, types.casual].sort());
      // the people with nothing in the month are not rows
      expect(rowOf(m1, 'dee')).toBeUndefined();
      expect(rowOf(m1, 'cy')).toBeUndefined();
      expect(m1.leaves.map((l) => l.employee.id)).not.toContain(ids.cy);
    });

    it('lists each leave with who recorded it and the reason', async () => {
      const m1 = await report({ from: M1 });
      const ben = m1.leaves.find((l) => l.employee.id === ids.ben)!;
      expect(ben).toMatchObject({ typeName: expect.any(String), startDate: casualDay, endDate: casualDay, halfDay: true, daysInPeriod: 0.5, days: 0.5, source: 'recorded', reason: null });
    });

    it('has no row and no totals for a month nobody was off', async () => {
      const r = await report({ from: monthsLater(M2, 6) });
      expect(r).toMatchObject({ types: [], people: [], leaves: [], totals: { people: 0, leaveDays: 0, permissionHours: 0, wfhDays: 0 } });
    });

    it('counts only approved leave: one waiting for HR or cancelled is left out', async () => {
      const employment = await prisma.employment.findFirstOrThrow({ where: { employeeId: ids.dee }, select: { id: true } });
      const day = new Date(`${working(M2)[8]}T00:00:00.000Z`);
      for (const status of ['with_hr', 'cancelled']) {
        await prisma.leaveRequest.create({ data: { employeeId: ids.dee, employmentId: employment.id, typeId: types.annual, startDate: day, endDate: day, days: 1, status } });
      }
      const r = await report({ from: M2 });
      expect(rowOf(r, 'dee')).toBeUndefined();
      expect(r.leaves.map((l) => l.employee.id)).not.toContain(ids.dee);
    });
  });

  describe('a range', () => {
    it('adds the months: the crossing leave whole, the totals and the groups', async () => {
      const r = await report({ from: M1, to: M2 });
      expect(rowOf(r, 'ana')).toMatchObject({ leaveDays: insideM1 + insideM2 });
      expect(rowOf(r, 'ben')).toMatchObject({ leaveDays: 0.5, permissionHours: 2, wfhDays: 1 });
      expect(rowOf(r, 'cy')).toMatchObject({ leaveDays: 1, days: { [types.unpaid]: 1 } });
      expect(rowOf(r, 'dee')).toBeUndefined();
      expect(r.totals).toMatchObject({ people: 3, leaveDays: insideM1 + insideM2 + 0.5 + 1, permissionHours: 2, wfhDays: 1 });
      expect(r.totals.byType).toEqual({ [types.annual]: insideM1 + insideM2, [types.casual]: 0.5, [types.unpaid]: 1 });
      // Ben works in the Field team under the department
      expect(rowOf(r, 'ben')!.department).toMatchObject({ id: team, nameEn: 'Field', parent: { id: dept } });
    });

    it('filters by the department or the team, and by one employee', async () => {
      expect((await report({ from: M1, to: M2, departmentId: team })).people.map((p) => p.employee.id)).toEqual([ids.ben]);
      expect((await report({ from: M1, to: M2, employeeId: ids.cy })).people.map((p) => p.employee.id)).toEqual([ids.cy]);
      const filtered = await report({ from: M1, to: M2, employeeId: ids.cy });
      expect(filtered.filters.employee).toMatchObject({ id: ids.cy, employeeCode: codes.cy });
      expect(filtered.filters.department).toMatchObject({ id: dept });
    });
  });

  describe('C-level people', () => {
    it('are left out for HR and counted; the CEO and the owner see them', async () => {
      const q = { from: M1, to: M2 };
      const r = await report(q, hr);
      expect(r.people.map((p) => p.employee.id)).not.toContain(clara);
      expect(r.confidentialExcluded).toBe(1);
      expect(r.totals.people).toBe(3);
      for (const session of [ceo, owner]) {
        const seen = await report(q, session);
        expect(seen.people.map((p) => p.employee.id)).toContain(clara);
        expect(seen.confidentialExcluded).toBe(0);
        expect(seen.totals.people).toBe(4);
      }
      // choosing the C-level person is refused to HR as an unknown employee, the CEO's answer has them
      expect(messagesOf(await get({ ...q, employeeId: clara }, hr).expect(400))).toEqual(['Choose the employee from the list.']);
      expect((await get({ ...q, employeeId: clara }, ceo).expect(200)).body.people).toHaveLength(1);
      // in a department without them, nobody is left out
      expect((await report({ ...q, departmentId: team }, hr)).confidentialExcluded).toBe(0);
    });
  });

  describe('the workbook', () => {
    it('has the Summary and the Leaves, dates as dates, numbers as numbers, named with its period; every download in the audit log', async () => {
      const q = { from: M1, to: M2, departmentId: dept };
      const json = await report(q);
      const since = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
      const res = await workbookFile(q).expect(200);
      expect(res.headers['content-type']).toBe(XLSX);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['content-disposition']).toContain(`Leave ${M1} to ${M2}.xlsx`);

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as ArrayBuffer);
      expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Summary', 'Leaves']);
      const [summary, leaves] = wb.worksheets;
      const rows = rowsOf(summary);
      const heads = rows[0] as string[];
      expect(heads.slice(0, 4)).toEqual(['Employee code', 'Employee name (English)', 'Department', 'Team']);
      expect(heads.slice(-4)).toEqual(['Leave days', 'Permission hours', 'Work from home days', 'Annual balance left']);
      expect(heads.slice(4, -4)).toEqual(json.types.map((t) => t.nameEn));
      // Ana's row: her days inside the two months as numbers
      const ana = rows.find((r) => r[0] === codes.ana)!;
      expect(ana[1]).toBe(`Ana Crossing ${RUN}`);
      const leaveDaysAt = 4 + json.types.length;
      expect(ana[leaveDaysAt]).toBe(insideM1 + insideM2);
      // the groups are rows: the department, its team, their subtotals and the grand total
      const texts = rows.map((r) => r[0]);
      expect(texts).toContain(`Leave Report ${RUN}`);
      expect(texts).toContain(`Leave Report ${RUN} › Field`);
      expect(texts).toContain('Total · Field');
      expect(texts).toContain(`Total · Leave Report ${RUN}`);
      expect(texts).toContain('Total · everyone');
      const grand = rows.find((r) => r[0] === 'Total · everyone')!;
      expect(grand[leaveDaysAt]).toBe(json.totals.leaveDays);
      expect(summary.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });

      const list = rowsOf(leaves);
      expect(list[0].slice(0, 10)).toEqual(['Employee code', 'Employee name (English)', 'Department', 'Team', 'Leave type', 'From', 'To', 'Half day', 'Days in the period', 'Total days']);
      expect(list.slice(1).map((r) => [r[0], r[8], r[9]])).toEqual(json.leaves.map((l) => [l.employee.employeeCode, l.daysInPeriod, l.days]));
      const first = list[1];
      expect(first[5]).toEqual(new Date(`${json.leaves[0].startDate}T00:00:00.000Z`));
      expect(leaves.getCell('F2').numFmt).toBe('dd/mm/yyyy');
      expect(leaves.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });

      const audit = await prisma.auditLog.findMany({ where: { action: 'leave_report_file', id: { gt: since } } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ entityType: 'leave_report', diff: { from: M1, to: M2, leaves: json.leaves.length, employees: json.people.map((p) => p.employee.employeeCode) } });
    });

    it('leaves the C-level people out for HR, as the report', async () => {
      const codesIn = async (session: string) => {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load((await workbookFile({ from: M1, departmentId: dept }, session).expect(200)).body as ArrayBuffer);
        return rowsOf(wb.worksheets[1])
          .slice(1)
          .map((r) => r[0]);
      };
      expect(await codesIn(hr)).not.toContain(codes.clara);
      expect(await codesIn(ceo)).toContain(codes.clara);
    });

    it('is named for the month alone when the period is one month', async () => {
      const res = await workbookFile({ from: M1, departmentId: dept }).expect(200);
      expect(res.headers['content-disposition']).toContain(`Leave ${M1}.xlsx`);
    });
  });

  describe('a developer', () => {
    it('is refused the workbook, and sees the report with pseudonyms, codes and reasons hidden, unfiltered by place', async () => {
      const refused = await workbookFile({ from: M1 }, developer).expect(403);
      expect(JSON.parse((refused.body as Buffer).toString('utf8')).message).toBe(DEVELOPER_NO_FILES);
      const r = (await get({ from: M1, to: M2, departmentId: dept }, developer).expect(200)).body as Report;
      // the department isn't a filter for a developer (22 October 2026: "Hide per-person details")
      expect(r.filters.department).toBeNull();
      const ana = rowOf(r, 'ana')!;
      expect(ana.employee.fullNameEn).not.toContain(RUN);
      expect(ana.employee.employeeCode).toBe(HIDDEN);
      expect(ana.department).toMatchObject({ nameEn: HIDDEN });
      const text = JSON.stringify(r);
      for (const leak of [RUN, codes.ana, codes.ben, 'Plumber']) expect(text).not.toContain(leak);
    });
  });
});
