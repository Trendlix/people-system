import type { INestApplication } from '@nestjs/common';
import { payrollLine, type LawRates, type PayrollInputs, type PayrollResult, type PayrollRules, type PayrollTerms } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { firstDay, monthName, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The KPI deduction waived by the CEO (owner, 1 November 2026: "make a button wave KPI deduction like the attendance
// one"): as the attendance waiver, only the CEO, only while the run is with the CEO, only on a line with a KPI cut; the
// line is worked out again at once, its attendance cut as it was, the audit log has it, the amount only as changed; the
// approval takes it as it is. A final scorecard's KPI is put on the line's terms directly, as the KPIs module would.
// These tests look at their own people (names end with RUN), and delete everything they made. Every name and amount is
// invented.

const RUN = Date.now().toString(36).toLowerCase();
const CURRENT = todayInCairo().slice(0, 7);
const MONTH = monthsLater(CURRENT, -10);
const JOINED = firstDay(monthsLater(CURRENT, -12));
const WITH_THE_CEO_ONLY = (status: string) => `The ${monthName(MONTH)} payroll ${status}: a KPI deduction is waived only while the run is with the CEO.`;

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

describe('Payroll: the CEO waives a KPI deduction (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let ceoId: string;
  let finance: string;
  const people: string[] = [];
  let alpha: Person; // a KPI of 50%: a KPI cut, and an attendance cut too
  let beta: Person; // no KPI: none
  let run: Run;
  let shiftA: string;
  let expected: number;
  /** Alpha's KPI cut as worked out without the waiver. */
  let kpiCut: number;
  let attendanceCut: number;
  const share = (part: number) => Math.round(expected * part * 100) / 100;
  const api = () => request(app.getHttpServer());

  async function hire(name: string): Promise<Person> {
    const person = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    const hired = await api()
      .post(`/api/employees/${person.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: JOINED, shiftId: shiftA })
      .expect(201);
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
    api().post(`/api/payroll/runs/${run.id}/lines/${lineOf(p).id}/kpi-waiver`).set('Cookie', session).send({ waived });
  const auditOf = (p: Person) => prisma.auditLog.findMany({ where: { entityType: 'payroll_line', entityId: lineOf(p).id, action: { in: ['waive_kpi', 'restore_kpi'] } }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    const ceoEmail = await createUser(prisma, ['ceo']);
    ceo = await signIn(app, ceoEmail);
    ceoId = (await prisma.user.findUniqueOrThrow({ where: { email: ceoEmail } })).id;
    finance = await signIn(app, await createUser(prisma, ['finance']));
    await prisma.payrollRun.deleteMany({ where: { month: new Date(`${MONTH}-01T00:00:00Z`) } });
    shiftA = ((await api().get('/api/shifts').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((x) => x.code === 'A')!.id;
    alpha = await hire('Alpha');
    beta = await hire('Beta');
    run = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: MONTH }).expect(201)).body as Run;
    expected = lineOf(alpha).terms.expectedHours!;
    await api()
      .patch(`/api/payroll/runs/${run.id}/lines`)
      .set('Cookie', hr)
      .send({
        lines: [
          { id: lineOf(alpha).id, inputs: { workedHours: share(0.8) } },
          { id: lineOf(beta).id, inputs: { workedHours: share(1) } },
        ],
      })
      .expect(200);
    await getRun();
    // a final scorecard of 60% on Alpha's line (as the KPIs module gives it), worked out with it
    const a = lineOf(alpha);
    const terms: PayrollTerms = { ...a.terms, kpi: { month: monthsLater(MONTH, -1), scorecardId: '00000000-0000-4000-8000-0000000000aa', finalPercent: 60, level: 'unsatisfactory' } };
    const result = payrollLine(terms, a.inputs, run.rules, run.lawRates);
    await prisma.payrollLine.update({ where: { id: a.id }, data: { terms: JSON.parse(JSON.stringify(terms)), result: JSON.parse(JSON.stringify(result)) } });
    kpiCut = result.kpiCut;
    attendanceCut = result.attendanceCut;
    expect(kpiCut).toBeGreaterThan(0);
    expect(attendanceCut).toBeGreaterThan(0);
    await getRun();
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { month: new Date(`${MONTH}-01T00:00:00Z`) } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await app.close();
  });

  it('is only while the run is with the CEO', async () => {
    expect((await waive(alpha, true).expect(409)).body.message).toBe(WITH_THE_CEO_ONLY('is a draft'));
    await act('submit', hr).expect(200);
    await getRun();
  });

  it('is the CEO’s only, on a line with a KPI cut', async () => {
    for (const session of [hr, finance]) await waive(alpha, true, session).expect(403);
    expect((await waive(beta, true).expect(409)).body.message).toBe(`Beta ${RUN} has no KPI deduction to waive this month.`);
    expect((await waive(alpha, 'yes').expect(400)).body.message).toEqual(['Send whether the KPI deduction is waived as true or false.']);
    await api().post(`/api/payroll/runs/${run.id}/lines/00000000-0000-4000-8000-000000000000/kpi-waiver`).set('Cookie', ceo).send({ waived: true }).expect(404);
    expect(await auditOf(alpha)).toEqual([]);
  });

  it('works the line out without the KPI cut at once, the attendance cut as it was, and the audit log says so', async () => {
    run = (await waive(alpha, true).expect(200)).body as Run;
    const a = lineOf(alpha);
    expect(a.inputs.kpiWaived).toBe(true);
    expect(a.result).toMatchObject({ kpiCut: 0, kpiWaived: kpiCut, attendanceCut, attendanceWaived: 0 });
    expect(a.result).toEqual(payrollLine(a.terms, a.inputs, run.rules, run.lawRates));
    expect((await auditOf(alpha)).map((x) => [x.action, x.userId, x.diff])).toEqual([
      ['waive_kpi', ceoId, { runId: run.id, month: MONTH, employeeCode: alpha.employeeCode, kpiWaived: { from: false, to: true }, kpiCut: 'changed' }],
    ]);
    // ticked again: nothing changes, nothing more in the audit log
    await waive(alpha, true).expect(200);
    expect(await auditOf(alpha)).toHaveLength(1);
  });

  it('unticked, the cut is taken again; the approval takes the waiver as it is, and nothing changes it after', async () => {
    run = (await waive(alpha, false).expect(200)).body as Run;
    expect(lineOf(alpha).result).toMatchObject({ kpiCut, kpiWaived: 0 });
    expect((await auditOf(alpha)).at(-1)).toMatchObject({ action: 'restore_kpi', diff: { kpiWaived: { from: true, to: false } } });
    run = (await waive(alpha, true).expect(200)).body as Run;
    run = (await act('approve', ceo).expect(200)).body as Run;
    expect(lineOf(alpha).result).toMatchObject({ kpiCut: 0, kpiWaived: kpiCut });
    expect((await waive(alpha, false).expect(409)).body.message).toBe(WITH_THE_CEO_ONLY('is approved'));
  });
});
