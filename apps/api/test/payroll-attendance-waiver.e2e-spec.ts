import type { INestApplication } from '@nestjs/common';
import { payrollLine, type LawRates, type PayrollInputs, type PayrollResult, type PayrollRules, type PayrollTerms } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { firstDay, monthName, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The attendance deduction waived by the CEO (owner, 17 October 2026: "if there is an attendance deduction, allow the
// CEO to wave the deduction by ticking a box"): only the CEO, only while the run is with the CEO, only on a line with an
// attendance cut; the line is worked out again at once (the run's totals with it), the audit log has it, the amount only
// as changed; the approval takes it as it is, and nothing changes it after. These tests look at their own people (names
// end with RUN), and delete everything they made. Every name and amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const CURRENT = todayInCairo().slice(0, 7);
const MONTH = monthsLater(CURRENT, -9);
const JOINED = firstDay(monthsLater(CURRENT, -12));
const WITH_THE_CEO_ONLY = (status: string) => `The ${monthName(MONTH)} payroll ${status}: an attendance deduction is waived only while the run is with the CEO.`;

interface Line {
  id: string;
  employeeId: string;
  employeeCode: string;
  terms: PayrollTerms;
  inputs: PayrollInputs;
  result: PayrollResult;
}

interface Run {
  id: string;
  status: string;
  rules: PayrollRules;
  lawRates: LawRates;
  totals: Record<string, number>;
  lines: Line[];
}

interface Person {
  id: string;
  employeeCode: string;
}

describe('Payroll: the CEO waives an attendance deduction (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let ceoId: string;
  let finance: string;
  const people: string[] = [];
  let alpha: Person; // 160 of 200 hours: an attendance cut
  let beta: Person; // 190 of 200: none
  let run: Run;
  const api = () => request(app.getHttpServer());

  async function hire(name: string): Promise<Person> {
    const person = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    const hired = await api().post(`/api/employees/${person.body.id}/employments`).set('Cookie', hr).send({ employmentType: 'full_time', joinDate: JOINED }).expect(201);
    people.push(person.body.id);
    const draft = (await api().post(`/api/employees/${person.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', hr).send({ grossSalary: 10000 }).expect(201))
      .body as { id: string; startDate: string };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
    return { id: person.body.id as string, employeeCode: person.body.employeeCode as string };
  }

  const lineOf = (p: Person) => run.lines.find((l) => l.employeeId === p.id)!;
  const getRun = async () => (run = (await api().get(`/api/payroll/runs/${run.id}`).set('Cookie', hr).expect(200)).body as Run);
  const act = (step: string, session: string, body: object = {}) => api().post(`/api/payroll/runs/${run.id}/${step}`).set('Cookie', session).send(body);
  const waive = (p: Person, waived: unknown, session = ceo) =>
    api().post(`/api/payroll/runs/${run.id}/lines/${lineOf(p).id}/attendance-waiver`).set('Cookie', session).send({ waived });
  const auditOf = (p: Person) => prisma.auditLog.findMany({ where: { entityType: 'payroll_line', entityId: lineOf(p).id, action: { in: ['waive_attendance', 'restore_attendance'] } }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    const ceoEmail = await createUser(prisma, ['ceo']);
    ceo = await signIn(app, ceoEmail);
    ceoId = (await prisma.user.findUniqueOrThrow({ where: { email: ceoEmail } })).id;
    finance = await signIn(app, await createUser(prisma, ['finance']));
    await prisma.payrollRun.deleteMany({ where: { month: new Date(`${MONTH}-01T00:00:00Z`) } });
    alpha = await hire('Alpha');
    beta = await hire('Beta');
    run = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: MONTH }).expect(201)).body as Run;
    await api()
      .patch(`/api/payroll/runs/${run.id}/lines`)
      .set('Cookie', hr)
      .send({
        lines: [
          { id: lineOf(alpha).id, inputs: { workedHours: 160, expectedHours: 200 } },
          { id: lineOf(beta).id, inputs: { workedHours: 190, expectedHours: 200 } },
        ],
      })
      .expect(200);
    await getRun();
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { month: new Date(`${MONTH}-01T00:00:00Z`) } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await app.close();
  });

  it('is only while the run is with the CEO', async () => {
    // 160 of 200 hours: 80%, below 90%: 20% of the fixed 8,000 = 1,600
    expect(lineOf(alpha).result).toMatchObject({ attendanceRatio: 0.8, attendanceCut: 1600, attendanceWaived: 0 });
    expect((await waive(alpha, true).expect(409)).body.message).toBe(WITH_THE_CEO_ONLY('is a draft'));
    await act('submit', hr).expect(200);
  });

  it('is the CEO’s only, on a line with an attendance cut', async () => {
    for (const session of [hr, finance]) await waive(alpha, true, session).expect(403);
    expect((await waive(beta, true).expect(409)).body.message).toBe(`Beta ${RUN} has no attendance deduction to waive this month.`);
    expect((await waive(alpha, 'yes').expect(400)).body.message).toEqual(['Send whether the attendance deduction is waived as true or false.']);
    await waive(alpha, undefined).expect(400);
    await api().post(`/api/payroll/runs/${run.id}/lines/00000000-0000-4000-8000-000000000000/attendance-waiver`).set('Cookie', ceo).send({ waived: true }).expect(404);
    await api().post(`/api/payroll/runs/${run.id}/lines/nope/attendance-waiver`).set('Cookie', ceo).send({ waived: true }).expect(400);
    expect(await auditOf(alpha)).toEqual([]);
  });

  it('works the line out without the cut at once, the run’s totals with it, and the audit log says so', async () => {
    const before = run.totals;
    run = (await waive(alpha, true).expect(200)).body as Run;
    const a = lineOf(alpha);
    expect(a.inputs.attendanceWaived).toBe(true);
    // the 1,600 kept as waived; the fixed 8,000 paid in full: earned 10,000
    expect(a.result).toMatchObject({ attendanceRatio: 0.8, attendanceCut: 0, attendanceWaived: 1600, earned: 10_000 });
    expect(a.result).toEqual(payrollLine(a.terms, a.inputs, run.rules, run.lawRates));
    expect(run.totals.earned).toBe(Math.round((before.earned + 1600) * 100) / 100);
    // the list's totals are the lines' saved figures: the same
    const listed = ((await api().get('/api/payroll/runs').set('Cookie', finance).expect(200)).body as { id: string; totals: Record<string, number> }[]).find((r) => r.id === run.id)!;
    expect(listed.totals).toMatchObject({ earned: run.totals.earned, net: run.totals.net, transfer: run.totals.transfer });

    expect((await auditOf(alpha)).map((x) => [x.action, x.userId, x.diff])).toEqual([
      [
        'waive_attendance',
        ceoId,
        { runId: run.id, month: MONTH, employeeCode: alpha.employeeCode, attendanceWaived: { from: false, to: true }, attendanceCut: 'changed' },
      ],
    ]);
    expect(JSON.stringify((await auditOf(alpha)).map((x) => x.diff))).not.toContain('1600');
    // ticked again: nothing changes, nothing more in the audit log
    await waive(alpha, true).expect(200);
    expect(await auditOf(alpha)).toHaveLength(1);
  });

  it('unticked, the cut is taken again; ticked again, waived again', async () => {
    run = (await waive(alpha, false).expect(200)).body as Run;
    expect(lineOf(alpha).result).toMatchObject({ attendanceCut: 1600, attendanceWaived: 0 });
    expect((await auditOf(alpha)).at(-1)).toMatchObject({ action: 'restore_attendance', diff: { attendanceWaived: { from: true, to: false } } });
    run = (await waive(alpha, true).expect(200)).body as Run;
    expect(lineOf(alpha).result.attendanceCut).toBe(0);
  });

  it('stays when the CEO returns the run and HR changes the line, and is approved as it is; nothing changes it after', async () => {
    await act('return', ceo, { reason: 'Invented reason' }).expect(200);
    // HR changes the hours: still waived, at the cut they give now (150 of 200: 25% of 8,000 = 2,000)
    await api()
      .patch(`/api/payroll/runs/${run.id}/lines`)
      .set('Cookie', hr)
      .send({ lines: [{ id: lineOf(alpha).id, inputs: { workedHours: 150 } }] })
      .expect(200);
    await getRun();
    expect(lineOf(alpha).result).toMatchObject({ attendanceCut: 0, attendanceWaived: 2000 });
    await act('submit', hr).expect(200);
    run = (await act('approve', ceo).expect(200)).body as Run;
    const approved = lineOf(alpha);
    expect(approved.result).toMatchObject({ attendanceCut: 0, attendanceWaived: 2000 });
    expect((await waive(alpha, false).expect(409)).body.message).toBe(WITH_THE_CEO_ONLY('is approved'));
    await getRun();
    expect(lineOf(alpha).result).toEqual(approved.result);
  });
});
