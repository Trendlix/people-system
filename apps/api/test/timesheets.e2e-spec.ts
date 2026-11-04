import type { INestApplication } from '@nestjs/common';
import type { ClientHoursReport, MyTimesheetView, TimesheetListItem, TimesheetWeekView } from '@trendlix/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Timesheets (owner, 4 November 2026: "Timesheet in app/website", "Direct manager, weekly", "Full salary, hours
// tracked", "Only those HR switches on"; packages/shared timesheets.ts): someone HR switched to timesheets logs a week's
// hours by client or task instead of checking in, sends it; their direct manager approves it or rejects it with why; a
// rejected week is corrected and sent again; an approved one stays; paid by the hour, the approved hours fill the
// month's draft payroll line; on a monthly salary, no attendance figures at all. These tests look at their own people
// (names end with RUN) and delete what they made. Every name and amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
/** The earliest month a run may be made for (12 back), which no other test makes one for: its draft filled from the approved hours. */
const OLD = monthsLater(TODAY.slice(0, 7), -12);
/** The Sunday of a day's week. */
const sunday = (ymd: string) => addDays(ymd, -new Date(`${ymd}T00:00:00Z`).getUTCDay());
/** Last week's Sunday: every day of it gone by. */
const LAST_WEEK = addDays(sunday(TODAY), -7);
/** A week of OLD, every day in it. */
const OLD_WEEK = addDays(sunday(firstDay(OLD)), 7);

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

/** Reads a response body as bytes, whatever its type. */
const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

/** A sheet's rows, each its cells' values. */
function rowsOf(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}

describe('Timesheets (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let emailDomainBefore: string | null;
  let deptId: string;
  let clientId: string;
  let oldClientId: string;
  const runs: string[] = [];
  const sessions: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const employments: Record<string, string> = {};
  const people: string[] = [];
  const api = () => request(app.getHttpServer());

  async function person(key: string, who: string, employment: Record<string, unknown> = {}) {
    const email = await createUser(prisma, ['employee']);
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${who} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: firstDay(monthsLater(OLD, -1)), departmentId: deptId, ...employment })
      .expect(201);
    employments[key] = hired.body.employment.id;
  }

  async function sign(key: string, terms: Record<string, unknown>) {
    const draft = (await api().post(`/api/employees/${ids[key]}/employments/${employments[key]}/contracts`).set('Cookie', hr).send({ durationMonths: 60, ...terms }).expect(201)).body as { id: string; startDate: string };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
  }

  const mine = async (key: string, week = LAST_WEEK) => (await api().get(`/api/me/timesheet?week=${week}`).set('Cookie', sessions[key]).expect(200)).body as MyTimesheetView;
  const save = (key: string, entries: object[], week = LAST_WEEK) => api().put(`/api/me/timesheet?week=${week}`).set('Cookie', sessions[key]).send({ entries });
  const submit = (key: string, week = LAST_WEEK) => api().post(`/api/me/timesheet/submit?week=${week}`).set('Cookie', sessions[key]);
  const decide = (id: string, session: string, decision: 'approve' | 'reject', comment?: string) => api().post(`/api/timesheets/${id}/decide`).set('Cookie', session).send({ decision, comment });
  const list = async (session: string, q = '') => ((await api().get(`/api/timesheets${q}`).set('Cookie', session).expect(200)).body as TimesheetListItem[]).filter((t) => people.includes(t.employee.id));
  const inbox = async (key: string) => (await api().get('/api/me/notifications').set('Cookie', sessions[key]).expect(200)).body as { items: { kind: string; title: string; link: string | null }[] };
  const day = (n: number, week = LAST_WEEK) => addDays(week, n);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Timesheets ${RUN}` }).expect(201)).body.id;
    clientId = (await prisma.clientAccount.create({ data: { nameEn: `Client ${RUN}`, defaultAmount: 1000 }, select: { id: true } })).id;
    oldClientId = (await prisma.clientAccount.create({ data: { nameEn: `Old Client ${RUN}`, defaultAmount: 1000, status: 'ended', endedOn: new Date('2026-01-31') }, select: { id: true } })).id;

    await person('mona', 'Mona Manager');
    await person('tim', 'Tim Timesheet', { managerId: ids.mona, worksOnTimesheets: true });
    await person('mia', 'Mia Monthly', { managerId: ids.mona, worksOnTimesheets: true });
    await person('carl', 'Carl Checkin', { managerId: ids.mona });
    await sign('tim', { payBasis: 'hourly', hourlyRate: 150, hoursPerWeek: 24, daysPerWeek: 3 });
    await sign('mia', { grossSalary: 12000 });
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: { in: runs } } });
    await prisma.timesheetWeek.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.notification.deleteMany({ where: { user: { employeeId: { in: people } } } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people }, managerId: { not: null } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.clientAccount.deleteMany({ where: { id: { in: [clientId, oldClientId].filter(Boolean) } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  it('is for those HR switched on: they log hours instead of checking in; the others check in', async () => {
    const tims = await mine('tim');
    expect(tims).toMatchObject({ refusal: null, status: null, weekStart: LAST_WEEK, entries: [], can: { edit: true, submit: false } });
    expect(tims.clients.map((c) => c.id)).toContain(clientId);
    expect(tims.clients.map((c) => c.id)).not.toContain(oldClientId);
    expect((await api().get('/api/me/attendance/today').set('Cookie', sessions.tim).expect(200)).body.refusal).toBe('You log your hours on your timesheet instead of checking in.');

    expect((await mine('carl')).refusal).toBe('You check in and out instead of logging hours on a timesheet.');
    expect(said(await save('carl', [{ date: day(0), task: 'Shoot', hours: 2 }]).expect(403))).toEqual(['You check in and out instead of logging hours on a timesheet.']);
    // the switch on the employment, as HR set it
    const employment = (await api().get(`/api/employees/${ids.tim}`).set('Cookie', hr).expect(200)).body.employment as { worksOnTimesheets: boolean };
    expect(employment.worksOnTimesheets).toBe(true);
  });

  it('refuses lines that don’t fit, in words', async () => {
    expect(said(await save('tim', [{ date: addDays(TODAY, 1), task: 'Shoot', hours: 2 }]).expect(400)).join(' ')).toMatch(/hasn’t come yet|within the week/);
    expect(said(await save('tim', [{ date: day(1), hours: 2 }]).expect(400))).toEqual(['Choose the client, or write the task, on each line.']);
    expect(said(await save('tim', [{ date: day(1), task: 'Edit', hours: 1.3 }]).expect(400))).toEqual(['Enter the hours from 0.25 to 24, in quarter hours, e.g. 1.5 or 7.75.']);
    expect(said(await save('tim', [{ date: day(1), task: 'Edit', hours: 20 }, { date: day(1), task: 'Shoot', hours: 5 }]).expect(400))[0]).toContain('a day has 24 hours at most');
    expect(said(await save('tim', [{ date: day(1), clientAccountId: oldClientId, hours: 2 }]).expect(400))).toEqual(['Choose each client from the list of active clients.']);
    // nothing sent yet: nothing to send
    expect(said(await submit('tim').expect(409))).toEqual(['Log the hours of at least one day before sending the week.']);
  });

  it('sends a week to the direct manager, who rejects it with why; corrected, sent again and approved, it stays', async () => {
    const saved = (await save('tim', [
      { date: day(0), clientAccountId: clientId, hours: 6, note: 'Shoot day' },
      { date: day(1), task: 'Editing', hours: 7.75 },
    ]).expect(200)).body as MyTimesheetView;
    expect(saved).toMatchObject({ status: 'draft', totalHours: 13.75, can: { edit: true, submit: true } });
    expect(saved.days.find((d) => d.date === day(1))?.hours).toBe(7.75);
    expect(saved.entries[0]).toMatchObject({ client: { id: clientId, name: `Client ${RUN}` }, hours: 6, note: 'Shoot day' });

    const sent = (await submit('tim').expect(200)).body as MyTimesheetView;
    expect(sent).toMatchObject({ status: 'submitted', approver: { id: ids.mona }, can: { edit: false, submit: false } });
    expect(said(await save('tim', []).expect(409))).toEqual(['This week is waiting for approval: it can’t be changed now.']);
    // told: the manager, never anyone else
    const told = (await inbox('mona')).items.find((n) => n.kind === 'timesheet_waiting');
    expect(told).toMatchObject({ link: `/timesheets/${sent.id}` });
    expect(told!.title).toMatch(/^Hours to approve: Tim Timesheet/);

    // the manager's list; another employee sees none, nor opens it
    expect((await list(sessions.mona)).map((t) => t.id)).toEqual([sent.id]);
    expect(await list(sessions.carl)).toEqual([]);
    await api().get(`/api/timesheets/${sent.id}`).set('Cookie', sessions.carl).expect(404);
    // never one's own
    await decide(sent.id!, sessions.tim, 'approve').expect(403);
    // HR reads it, but it's the manager's to decide
    expect((await list(hr, '?status=all')).map((t) => t.id)).toContain(sent.id);
    expect(said(await decide(sent.id!, hr, 'approve').expect(403))[0]).toContain('approves this week');

    expect(said(await decide(sent.id!, sessions.mona, 'reject').expect(400))).toEqual(['Write why you reject it.']);
    const rejected = (await decide(sent.id!, sessions.mona, 'reject', 'Split the editing by client').expect(200)).body as TimesheetWeekView;
    expect(rejected).toMatchObject({ status: 'rejected', rejectReason: 'Split the editing by client' });
    expect((await inbox('tim')).items.find((n) => n.kind === 'timesheet_decided')?.title).toBe('Your timesheet was rejected: correct it and send it again');

    // corrected and sent again
    await save('tim', [
      { date: day(0), clientAccountId: clientId, hours: 6 },
      { date: day(1), clientAccountId: clientId, task: 'Editing', hours: 7.75 },
    ]).expect(200);
    await submit('tim').expect(200);
    const approved = (await decide(sent.id!, sessions.mona, 'approve').expect(200)).body as TimesheetWeekView;
    expect(approved).toMatchObject({ status: 'approved', decidedBy: expect.stringContaining('Mona Manager'), can: { decide: false } });
    expect(said(await decide(sent.id!, sessions.mona, 'approve').expect(409))).toEqual(['This week is approved already.']);
    expect(said(await save('tim', []).expect(409))).toEqual(['This week is approved: its hours stay as they are.']);
    expect((await mine('tim')).status).toBe('approved');
  });

  it('pays the approved hours of someone paid by the hour; a monthly salary has no attendance figures', async () => {
    const run = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: OLD }).expect(201)).body as { id: string };
    runs.push(run.id);
    await save('tim', [{ date: day(1, OLD_WEEK), clientAccountId: clientId, hours: 8 }, { date: day(2, OLD_WEEK), task: 'Editing', hours: 4.5 }], OLD_WEEK).expect(200);
    const sent = (await submit('tim', OLD_WEEK).expect(200)).body as MyTimesheetView;
    await decide(sent.id!, sessions.mona, 'approve').expect(200);
    const lines = (await api().get(`/api/payroll/runs/${run.id}`).set('Cookie', hr).expect(200)).body.lines as {
      employeeId: string;
      inputs: { workedHours: number | null; noShowDays: number | null };
      attendanceImport: { source: string } | null;
    }[];
    expect(lines.find((l) => l.employeeId === ids.tim)).toMatchObject({ inputs: { workedHours: 12.5 }, attendanceImport: { source: 'timesheet' } });
    // Refresh from attendance: Mia's monthly salary gets no worked hours, so no attendance cut
    await api().post(`/api/payroll/runs/${run.id}/attendance-refresh`).set('Cookie', hr).expect((res) => expect([200, 201]).toContain(res.status));
    const after = (await api().get(`/api/payroll/runs/${run.id}`).set('Cookie', hr).expect(200)).body.lines as typeof lines;
    expect(after.find((l) => l.employeeId === ids.mia)?.inputs).toMatchObject({ workedHours: null, noShowDays: null });
  });

  it('adds up a month’s hours by client, the approved apart from those waiting, for those who read the client accounts', async () => {
    // owner, 4 November 2026: "Full salary, hours tracked": the client reports
    const finance = await signIn(app, await createUser(prisma, ['finance']));
    const developer = await signIn(app, await createUser(prisma, ['developer']));
    const report = async (session: string) => (await api().get(`/api/reports/client-hours?month=${OLD}`).set('Cookie', session).expect(200)).body as ClientHoursReport;
    /** The groups with only this run's people in them. */
    const ours = (r: ClientHoursReport) => r.groups.map((g) => ({ ...g, people: g.people.filter((p) => people.includes(p.employee.id)) })).filter((g) => g.people.length);

    // Tim's approved week of OLD (the payroll test): 8 hours on the client, 4.5 on a task alone; Mia's week not sent yet counts nothing
    await save('mia', [{ date: day(3, OLD_WEEK), clientAccountId: clientId, hours: 3, note: 'Prep' }, { date: day(4, OLD_WEEK), task: 'Research', hours: 2 }], OLD_WEEK).expect(200);
    let groups = ours(await report(hr));
    expect(groups.find((g) => g.client?.id === clientId)).toMatchObject({ client: { name: `Client ${RUN}` }, people: [{ employee: { id: ids.tim }, approved: 8, waiting: 0 }] });
    expect(groups.find((g) => g.client === null)?.people).toEqual([expect.objectContaining({ employee: expect.objectContaining({ id: ids.tim }), approved: 4.5, waiting: 0 })]);

    // sent: waiting, apart from the approved; the clients first, "No client" last
    await submit('mia', OLD_WEEK).expect(200);
    const full = await report(finance);
    expect(full.month).toBe(OLD);
    expect(full.groups.at(-1)?.client).toBeNull();
    groups = ours(full);
    expect(groups.find((g) => g.client?.id === clientId)?.people.map((p) => [p.employee.id, p.approved, p.waiting])).toEqual([
      [ids.tim, 8, 0],
      [ids.mia, 0, 3],
    ]);
    expect(groups.find((g) => g.client === null)?.people.map((p) => [p.employee.id, p.approved, p.waiting])).toEqual([
      [ids.tim, 4.5, 0],
      [ids.mia, 0, 2],
    ]);

    // only those who read the client accounts; a month as YYYY-MM
    await api().get(`/api/reports/client-hours?month=${OLD}`).set('Cookie', sessions.mona).expect(403);
    await api().get(`/api/reports/client-hours?month=${OLD}`).set('Cookie', sessions.tim).expect(403);
    expect(said(await api().get('/api/reports/client-hours?month=2026-13').set('Cookie', hr).expect(400))).toEqual(['Choose the month as YYYY-MM, e.g. 2026-11.']);

    // the workbook: the summary with each client's total, and every line; never for a developer
    const file = await api().get(`/api/reports/client-hours.xlsx?month=${OLD}`).set('Cookie', finance).buffer(true).parse(bytes).expect(200);
    expect(file.headers['content-type']).toContain('spreadsheetml');
    expect(file.headers['content-disposition']).toContain(`Client hours ${OLD}.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Lines']);
    const summary = rowsOf(wb.getWorksheet('Summary')!);
    expect(summary[0]).toEqual(['Client', 'Client code', 'Employee code', 'Employee', 'People', 'Approved hours', 'Waiting for approval', 'Total hours']);
    expect(summary.find((r) => r[0] === `Total: Client ${RUN}`)?.slice(4)).toEqual([2, 8, 3, 11]);
    const lines = rowsOf(wb.getWorksheet('Lines')!);
    expect(lines.find((r) => r[5] === 'Research' && String(r[2]).startsWith('Mia Monthly'))?.slice(3)).toEqual(['No client (tasks only)', undefined, 'Research', 2, undefined, 'Waiting for approval']);
    await api().get(`/api/reports/client-hours.xlsx?month=${OLD}`).set('Cookie', developer).expect(403);
  });
});
