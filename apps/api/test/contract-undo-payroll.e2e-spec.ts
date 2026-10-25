import type { INestApplication } from '@nestjs/common';
import type { PayrollTerms } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { deleteRefusal, unsignRefusal } from '../src/contracts/contracts.service.js';
import { lastDay, monthName, monthsLater } from '../src/payroll/months.js';
import { NO_CONTRACT } from '../src/payroll/roster.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Undoing a signing, or deleting a draft, never leaves payroll lines on a draft (owner's report, 25 October 2026: a
// renewal's draft, CON-2026-0004, couldn't be deleted: "This record is linked to other records, so it cannot be changed
// or deleted", as a draft payroll run had used it while it was signed, and its signing was undone after). The draft
// runs' lines worked out on it are taken again on the contract now in force (the version before it, or none); a run
// with the CEO, approved or paid keeps its lines, so the change is refused, saying which. Two runs: last month's, a
// draft, and the month before's, approved. Other test files leave people with signed contracts in the same database, so
// these tests look at their own people (names end with RUN). Every name and amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const CURRENT = todayInCairo().slice(0, 7);
/** The draft run's month: last month. */
const MONTH = monthsLater(CURRENT, -1);
/** The approved run's month: the month before. */
const PREVIOUS = monthsLater(MONTH, -1);
const day = (n: number, month = MONTH) => `${month}-${String(n).padStart(2, '0')}`;

interface Person {
  id: string;
  employmentId: string;
}

interface Contract {
  id: string;
  number: string;
  version: number;
  startDate: string;
}

describe('Undoing a signing and deleting a draft keep payroll off drafts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let superAdmin: string;
  let departmentId: string;
  let shiftId: string;
  let draftRun: string;
  let approvedRun: string;
  const hired: string[] = [];
  const api = () => request(app.getHttpServer());

  // a renewal signed, used by the draft run, then its signing undone (the owner's case); a renewal used by the approved
  // run; a renewal's draft a draft line still points at (the owner's data); one an approved line points at; a first
  // contract's signing undone; a raise with the CEO a draft line still points at
  let undone: Person;
  let kept: Person;
  let repaired: Person;
  let broken: Person;
  let first: Person;
  let rejected: Person;
  const contracts: Record<string, Contract[]> = {};

  async function hire(name: string, joinDate: string): Promise<Person> {
    const person = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    const made = await api().post(`/api/employees/${person.body.id}/employments`).set('Cookie', hr).send({ employmentType: 'full_time', joinDate, departmentId, shiftId }).expect(201);
    hired.push(person.body.id);
    return { id: person.body.id, employmentId: made.body.employment.id };
  }

  /** A contract version as HR enters it: signed unless `draft`; a change of pay sent to the CEO. */
  async function version(p: Person, body: Record<string, unknown>, draft = false): Promise<Contract> {
    const made = (await api().post(`/api/employees/${p.id}/employments/${p.employmentId}/contracts`).set('Cookie', hr).send(body).expect(201)).body as Contract;
    if (body.raiseReason) await api().post(`/api/raises/${made.id}/send`).set('Cookie', hr).send({}).expect(200);
    if (!draft) await api().post(`/api/contracts/${made.id}/sign`).set('Cookie', hr).send({ signedOn: made.startDate }).expect(200);
    (contracts[p.id] ??= []).push(made);
    return made;
  }

  /** Two months to the 14th of `month`, then a renewal of 12 months from the 15th, signed unless `draft`. */
  async function renewed(name: string, month: string, draft: boolean, renewal: Record<string, unknown> = {}): Promise<Person> {
    const p = await hire(name, day(15, monthsLater(month, -2)));
    await version(p, { grossSalary: 12000, durationMonths: 2, probationMonths: 0 });
    await version(p, { grossSalary: 12000, durationMonths: 12, ...renewal }, draft);
    return p;
  }

  const lineOf = (runId: string, p: Person) => prisma.payrollLine.findUnique({ where: { runId_employeeId: { runId, employeeId: p.id } } });
  const segments = (terms: unknown) => (terms as PayrollTerms).segments!.map((s) => [s.contractId, s.from, s.to, s.days]);
  const unsign = (id: string) => api().post(`/api/contracts/${id}/unsign`).set('Cookie', superAdmin);
  const remove = (id: string) => api().delete(`/api/contracts/${id}`).set('Cookie', superAdmin);
  const auditOf = (entityType: string, entityId: string) => prisma.auditLog.findMany({ where: { entityType, entityId }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    await prisma.payrollRun.deleteMany();
    departmentId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Undo ${RUN}` }).expect(201)).body.id;
    shiftId = ((await api().get('/api/shifts').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((s) => s.code === 'A')!.id;

    undone = await renewed('Renewal Undone', MONTH, false);
    // renewed from the 15th of the approved run's month
    kept = await renewed('Renewal Kept', PREVIOUS, false);
    repaired = await renewed('Draft Repaired', MONTH, true);
    broken = await renewed('Draft Broken', MONTH, true);
    first = await hire('First Undone', day(5));
    await version(first, { grossSalary: 12000 });
    rejected = await renewed('Raise Rejected', MONTH, true, { grossSalary: 15000, raiseReason: 'annual' });

    // the month before: made, sent to the CEO and approved; last month: a draft
    approvedRun = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: PREVIOUS }).expect(201)).body.id;
    await api().post(`/api/payroll/runs/${approvedRun}/submit`).set('Cookie', hr).expect(200);
    await api().post(`/api/payroll/runs/${approvedRun}/approve`).set('Cookie', ceo).expect(200);
    draftRun = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: MONTH }).expect(201)).body.id;
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany();
    await prisma.employee.deleteMany({ where: { id: { in: hired } } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await app.close();
  });

  it('undoing a renewal’s signing takes the draft run’s line back to version 1, recorded', async () => {
    const [v1, v2] = contracts[undone.id];
    const before = (await lineOf(draftRun, undone))!;
    expect(before.contractId).toBe(v2.id);
    expect(segments(before.terms)).toEqual([
      [v1.id, day(1), day(14), 14],
      [v2.id, day(15), lastDay(MONTH), 16],
    ]);
    const approvedLine = (await lineOf(approvedRun, undone))!;
    expect(approvedLine.contractId).toBe(v1.id);

    expect((await unsign(v2.id).expect(200)).body).toMatchObject({ id: v2.id, status: 'draft' });
    const after = (await lineOf(draftRun, undone))!;
    // the same line, on version 1 to its end, the 14th: the days after it aren't paid
    expect(after).toMatchObject({ id: before.id, contractId: v1.id, inputs: before.inputs, onHold: before.onHold, comments: before.comments });
    expect(segments(after.terms)).toEqual([[v1.id, day(1), day(14), 14]]);
    expect((after.terms as unknown as PayrollTerms).paidDays).toBe(14);
    // the approved run's line was on version 1 already: as it was
    expect(await lineOf(approvedRun, undone)).toEqual(approvedLine);

    const lineAudit = await auditOf('payroll_line', before.id);
    expect(lineAudit.at(-1)).toMatchObject({
      action: 'update',
      diff: { runId: draftRun, month: MONTH, contract: { from: v2.number, to: v1.number }, paidDays: { from: 30, to: 14 }, signingUndone: v2.number },
    });
    const unsigned = (await auditOf('contract', v2.id)).find((a) => a.action === 'unsign');
    expect(unsigned!.diff).toMatchObject({ number: v2.number, restored: v1.number, payrollRebuilt: [MONTH] });
  });

  it('then deleting the draft works', async () => {
    const [, v2] = contracts[undone.id];
    await remove(v2.id).expect(204);
    expect(await prisma.contract.findUnique({ where: { id: v2.id } })).toBeNull();
    const deleted = (await auditOf('contract', v2.id)).at(-1)!;
    expect(deleted.action).toBe('delete');
    // no line was on it any more
    expect(deleted.diff).not.toHaveProperty('payrollRebuilt');
  });

  it('refuses to undo a signing an approved run used, saying which; nothing changes', async () => {
    const [, v2] = contracts[kept.id];
    const approvedLine = (await lineOf(approvedRun, kept))!;
    const draftLine = (await lineOf(draftRun, kept))!;
    expect([approvedLine.contractId, draftLine.contractId]).toEqual([v2.id, v2.id]);

    const refused = await unsign(v2.id).expect(409);
    expect(refused.body.message).toBe(`${v2.number} was used in the ${monthName(PREVIOUS)} payroll, which is approved: its signing stays on record.`);
    expect(refused.body.message).toBe(unsignRefusal(v2.number, `the ${monthName(PREVIOUS)} payroll`, 'approved'));
    // still signed, and both runs' lines as they were
    expect((await prisma.contract.findUnique({ where: { id: v2.id } }))!.status).toBe('active');
    expect(await lineOf(approvedRun, kept)).toEqual(approvedLine);
    expect(await lineOf(draftRun, kept)).toEqual(draftLine);
    expect((await auditOf('contract', v2.id)).map((a) => a.action)).not.toContain('unsign');
  });

  it('deleting a draft a draft line still points at (a signing undone before the fix) takes the line again, then deletes it', async () => {
    const [v1, v2] = contracts[repaired.id];
    // the owner's data: the draft line left on the renewal when its signing was undone
    const before = (await lineOf(draftRun, repaired))!;
    expect(before.contractId).toBe(v1.id);
    await prisma.payrollLine.update({ where: { id: before.id }, data: { contractId: v2.id } });

    await remove(v2.id).expect(204);
    expect(await prisma.contract.findUnique({ where: { id: v2.id } })).toBeNull();
    const after = (await lineOf(draftRun, repaired))!;
    expect(after).toMatchObject({ id: before.id, contractId: v1.id });
    expect(segments(after.terms)).toEqual([[v1.id, day(1), day(14), 14]]);

    expect((await auditOf('payroll_line', before.id)).at(-1)).toMatchObject({
      action: 'update',
      diff: { runId: draftRun, month: MONTH, contract: { from: v2.number, to: v1.number }, draftDeleted: v2.number },
    });
    expect((await auditOf('contract', v2.id)).at(-1)).toMatchObject({ action: 'delete', diff: { number: v2.number, payrollRebuilt: [MONTH] } });
  });

  it('refuses clearly to delete a draft an approved line points at; nothing changes', async () => {
    const [v1, v2] = contracts[broken.id];
    const approved = (await lineOf(approvedRun, broken))!;
    await prisma.payrollLine.update({ where: { id: approved.id }, data: { contractId: v2.id } });
    const draftLine = (await lineOf(draftRun, broken))!;
    expect(draftLine.contractId).toBe(v1.id);

    const refused = await remove(v2.id).expect(409);
    expect(refused.body.message).toBe(
      `${v2.number} was used in the ${monthName(PREVIOUS)} payroll, which is approved, so it can't be deleted: sign it again, as that payroll keeps the terms it was worked out on.`,
    );
    expect(refused.body.message).toBe(deleteRefusal(v2.number, `the ${monthName(PREVIOUS)} payroll`, 'approved'));
    expect(refused.body.message).not.toMatch(/linked to other records/);
    expect(await prisma.contract.findUnique({ where: { id: v2.id } })).not.toBeNull();
    expect((await lineOf(approvedRun, broken))!.contractId).toBe(v2.id);
    expect(await lineOf(draftRun, broken)).toEqual(draftLine);
  });

  it('undoing a first contract’s signing takes the person off the draft run, with why', async () => {
    const [v1] = contracts[first.id];
    const before = (await lineOf(draftRun, first))!;
    expect(before.contractId).toBe(v1.id);
    expect(await lineOf(approvedRun, first)).toBeNull();

    await unsign(v1.id).expect(200);
    expect(await lineOf(draftRun, first)).toBeNull();
    const run = (await prisma.payrollRun.findUnique({ where: { id: draftRun } }))!;
    expect((run.exclusions as { employeeId: string; reason: string }[]).filter((x) => x.employeeId === first.id).map((x) => x.reason)).toEqual([NO_CONTRACT]);
    expect((await auditOf('payroll_line', before.id)).at(-1)).toMatchObject({
      action: 'delete',
      diff: { runId: draftRun, month: MONTH, contract: { from: v1.number, to: null }, excluded: NO_CONTRACT, signingUndone: v1.number },
    });
    // a draft again, with no line on it: deleted as any draft
    await remove(v1.id).expect(204);
  });

  it('the CEO rejecting a raise a draft line still points at takes the line again first', async () => {
    const [v1, v2] = contracts[rejected.id];
    const before = (await lineOf(draftRun, rejected))!;
    expect(before.contractId).toBe(v1.id);
    await prisma.payrollLine.update({ where: { id: before.id }, data: { contractId: v2.id } });

    await api().post(`/api/raises/${v2.id}/decline`).set('Cookie', ceo).send({ comment: 'Invented rejection' }).expect(204);
    expect(await prisma.contract.findUnique({ where: { id: v2.id } })).toBeNull();
    expect((await lineOf(draftRun, rejected))!.contractId).toBe(v1.id);
    expect((await auditOf('payroll_line', before.id)).at(-1)).toMatchObject({ action: 'update', diff: { contract: { from: v2.number, to: v1.number }, draftDeleted: v2.number } });
  });
});
