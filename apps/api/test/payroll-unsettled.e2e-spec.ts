import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import { firstDay, monthName, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Unsettled (owner, 17 October 2026): the runs not yet paid, the lines on hold not paid out since, the final settlements
// of people who left (open from their employment's end until HR marks them settled), and the advances and loans still
// being recovered. Other test files leave people and ended employments in the same database, so these tests look at
// their own (names end with RUN), and delete everything they made. Every name and amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
/** The month of the run these tests make, approve and pay. */
const MONTH = monthsLater(CURRENT, -4);
const JOINED = firstDay(monthsLater(CURRENT, -8));
const LEFT = addDays(TODAY, -20);

interface Person {
  id: string;
  employeeCode: string;
  employmentId: string;
}

interface Settlement {
  employmentId: string;
  employee: { id: string; employeeCode: string; name: string };
  endDate: string;
  endReason: string | null;
  reasonText: string | null;
  status: string;
  daysOpen: number;
  reopened: boolean;
  settledOn: string | null;
  amountPaid: number | null;
  note: string | null;
  document: { id: string } | null;
  settledBy: { id: string } | null;
  clearances: { id: string; fileName: string }[];
}

interface Unsettled {
  today: string;
  runs: { count: number; transfer: number; rows: { id: string; month: string; status: string; employees: number; held: number; transfer: number }[] };
  held: { count: number; amount: number; rows: { lineId: string; runId: string; month: string; runStatus: string; employee: { id: string }; amount: number }[] };
  settlements: { count: number; rows: Settlement[]; recentlySettled: Settlement[] };
  advances: { count: number; amount: number; outstanding: number; rows: { id: string; employee: { id: string }; outstanding: number }[] };
}

describe('Payroll unsettled (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrId: string;
  let finance: string;
  let ceo: string;
  let admin: string;
  let staff: string;
  const people: string[] = [];
  let leaver: Person; // left 20 days ago
  let leaving: Person; // leaves in 10 days
  let paid: Person; // on the run, paid
  let held: Person; // on the run, held
  let templateVersionId: string;
  let clearanceId: string;
  let otherDocumentId: string;
  const api = () => request(app.getHttpServer());

  async function hire(name: string): Promise<Person> {
    const person = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    const hired = await api().post(`/api/employees/${person.body.id}/employments`).set('Cookie', hr).send({ employmentType: 'full_time', joinDate: JOINED }).expect(201);
    people.push(person.body.id);
    return { id: person.body.id, employeeCode: person.body.employeeCode, employmentId: hired.body.employment.id };
  }

  async function signed(p: Person) {
    const draft = (await api().post(`/api/employees/${p.id}/employments/${p.employmentId}/contracts`).set('Cookie', hr).send({ grossSalary: 9000 }).expect(201)).body as {
      id: string;
      startDate: string;
    };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
  }

  const unsettled = async (session = hr) => (await api().get('/api/payroll/unsettled').set('Cookie', session).expect(200)).body as Unsettled;
  const settle = (p: Person, body: object, session = hr) => api().post(`/api/payroll/final-settlements/${p.employmentId}/settle`).set('Cookie', session).send(body);
  const reopen = (p: Person, body: object, session = hr) => api().post(`/api/payroll/final-settlements/${p.employmentId}/reopen`).set('Cookie', session).send(body);
  const paidOut = (lineId: string, body: object, session = hr) => api().post(`/api/payroll/held-lines/${lineId}/paid-out`).set('Cookie', session).send(body);
  const auditOf = (entityType: string, entityId: string) => prisma.auditLog.findMany({ where: { entityType, entityId }, orderBy: { id: 'asc' } });
  const mine = (s: Unsettled, p: Person) => s.settlements.rows.find((r) => r.employmentId === p.employmentId);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } })).id;
    finance = await signIn(app, await createUser(prisma, ['finance']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    await prisma.payrollRun.deleteMany({ where: { month: new Date(`${MONTH}-01T00:00:00Z`) } });

    leaver = await hire('Leaver');
    await api().post(`/api/employees/${leaver.id}/employments/${leaver.employmentId}/end`).set('Cookie', hr).send({ endDate: LEFT, endReason: 'resigned' }).expect(200);
    leaving = await hire('Leaving');
    // an end date still to come, as an ending in progress records it
    await prisma.employment.update({ where: { id: leaving.employmentId }, data: { endDate: new Date(`${addDays(TODAY, 10)}T00:00:00Z`), endReason: 'resigned' } });
    paid = await hire('Paid');
    await signed(paid);
    held = await hire('Held');
    await signed(held);

    // a "Clearance and dues" document generated for the leaver's employment, and one of another kind
    const template = await prisma.templateVersion.create({
      data: { slotKey: 'clearance_dues', version: 900 + Math.floor(Math.random() * 90), fileName: 'clearance.docx', mimeType: 'application/zip', sizeBytes: 1, data: new Uint8Array([1]), language: 'ar', tags: [], unknownTags: [], broken: [] },
    });
    templateVersionId = template.id;
    const doc = (slotKey: string) => ({
      employeeId: leaver.id,
      employmentId: leaver.employmentId,
      slotKey,
      templateVersionId,
      documentDate: new Date(`${LEFT}T00:00:00Z`),
      fileName: `${slotKey}.docx`,
      data: new Uint8Array([1]),
      sizeBytes: 1,
      hasRestricted: false,
    });
    clearanceId = (await prisma.generatedDocument.create({ data: doc('clearance_dues') })).id;
    otherDocumentId = (await prisma.generatedDocument.create({ data: doc('experience_certificate') })).id;
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { month: new Date(`${MONTH}-01T00:00:00Z`) } });
    await prisma.generatedDocument.deleteMany({ where: { employeeId: { in: people } } });
    if (templateVersionId) await prisma.templateVersion.deleteMany({ where: { id: templateVersionId } });
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.payrollAdvance.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await app.close();
  });

  it('HR, Finance and the CEO see it; nobody else', async () => {
    for (const session of [hr, finance, ceo]) expect((await unsettled(session)).today).toBe(TODAY);
    for (const session of [admin, staff]) await api().get('/api/payroll/unsettled').set('Cookie', session).expect(403);
  });

  describe('final settlements', () => {
    it('are open from the employment’s end date, with the days open and the clearance documents', async () => {
      const s = await unsettled();
      expect(mine(s, leaver)).toMatchObject({
        employee: { id: leaver.id, employeeCode: leaver.employeeCode, name: `Leaver ${RUN}` },
        endDate: LEFT,
        endReason: 'resigned',
        reasonText: 'Resigned',
        status: 'open',
        daysOpen: 20,
        reopened: false,
        settledOn: null,
        amountPaid: null,
        clearances: [{ id: clearanceId, fileName: 'clearance_dues.docx' }],
      });
      // an end still to come isn't open yet; someone still employed has none
      expect(mine(s, leaving)).toBeUndefined();
      expect(mine(s, paid)).toBeUndefined();
      expect(s.settlements.count).toBe(s.settlements.rows.length);
      expect((await settle(leaving, { settledOn: TODAY, amountPaid: 0 }).expect(409)).body.message).toBe(
        `Leaving ${RUN}'s employment ends on ${addDays(TODAY, 10).split('-').reverse().join('/')}: its final settlement opens then.`,
      );
      expect((await settle(paid, { settledOn: TODAY, amountPaid: 0 }).expect(409)).body.message).toBe(`Paid ${RUN}'s employment hasn't ended, so there is no final settlement yet.`);
    });

    it('HR marks one settled: the day, the amount paid, a note and the clearance; the amount only as set', async () => {
      const body = { settledOn: TODAY, amountPaid: 18500.5, note: ' Final dues by transfer ', documentId: clearanceId };
      for (const session of [finance, ceo, admin, staff]) await settle(leaver, body, session).expect(403);
      const refused = async (b: object) => (await settle(leaver, { ...body, ...b }).expect(400)).body.message as string | string[];
      expect(await refused({ settledOn: addDays(TODAY, 1) })).toBe("The day the final dues were settled can't be in the future.");
      expect(await refused({ settledOn: addDays(JOINED, -1) })).toBe(`The final dues can't have been settled before Leaver ${RUN} joined, on ${JOINED.split('-').reverse().join('/')}.`);
      expect(await refused({ amountPaid: -1 })).toEqual(['Enter the amount paid in EGP, 0 or more, e.g. 18500.50.']);
      expect(await refused({ documentId: otherDocumentId })).toBe(`Choose one of the clearance and dues documents generated for Leaver ${RUN}'s employment.`);
      expect(await refused({ settledOn: '17/10/2026' })).toEqual(['Enter the day the final dues were settled, as YYYY-MM-DD.']);

      const settled = (await settle(leaver, body).expect(200)).body as Settlement;
      expect(settled).toMatchObject({ status: 'settled', daysOpen: 0, settledOn: TODAY, amountPaid: 18500.5, note: 'Final dues by transfer', document: { id: clearanceId }, settledBy: { id: hrId } });
      const s = await unsettled(finance);
      expect(mine(s, leaver)).toBeUndefined();
      expect(s.settlements.recentlySettled.find((r) => r.employmentId === leaver.employmentId)?.status).toBe('settled');
      expect((await settle(leaver, body).expect(409)).body.message).toBe(`Leaver ${RUN}'s final settlement is settled already.`);
      expect((await auditOf('final_settlement', leaver.employmentId)).map((a) => [a.action, a.diff])).toEqual([
        [
          'settle',
          {
            employeeCode: leaver.employeeCode,
            endDate: LEFT,
            status: { from: 'open', to: 'settled' },
            settledOn: TODAY,
            amountPaid: 'set',
            note: 'Final dues by transfer',
            documentId: clearanceId,
          },
        ],
      ]);
    });

    it('HR reopens one marked settled by mistake, saying why: it is open again', async () => {
      for (const session of [finance, ceo]) await reopen(leaver, { reason: 'x' }, session).expect(403);
      expect((await reopen(leaver, {}).expect(400)).body.message).toContain('Say why it is reopened.');
      const reopened = (await reopen(leaver, { reason: 'Leave balance was left out' }).expect(200)).body as Settlement;
      expect(reopened).toMatchObject({ status: 'open', reopened: true, daysOpen: 20 });
      expect(mine(await unsettled(), leaver)?.reopened).toBe(true);
      expect((await reopen(leaver, { reason: 'again' }).expect(409)).body.message).toBe(`Leaver ${RUN}'s final settlement is open already.`);
      expect((await auditOf('final_settlement', leaver.employmentId)).at(-1)).toMatchObject({
        action: 'reopen',
        diff: { status: { from: 'settled', to: 'open' }, reason: 'Leave balance was left out' },
      });
      // and settled again, without a document this time
      expect((await settle(leaver, { settledOn: TODAY, amountPaid: 19000 }).expect(200)).body).toMatchObject({ status: 'settled', amountPaid: 19000, document: null, note: null });
    });
  });

  describe('runs not yet paid and lines on hold', () => {
    let runId: string;
    let heldLine: string;
    let paidLine: string;
    const act = (step: string, session: string, body: object = {}) => api().post(`/api/payroll/runs/${runId}/${step}`).set('Cookie', session).send(body);

    it('lists each run until it is marked paid, with its people, its held lines and what it transfers', async () => {
      const made = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: MONTH }).expect(201)).body as {
        id: string;
        lines: { id: string; employeeId: string }[];
        totals: { transfer: number; employees: number };
      };
      runId = made.id;
      heldLine = made.lines.find((l) => l.employeeId === held.id)!.id;
      paidLine = made.lines.find((l) => l.employeeId === paid.id)!.id;
      await api().patch(`/api/payroll/runs/${runId}/lines`).set('Cookie', hr).send({ lines: [{ id: heldLine, onHold: true }] }).expect(200);

      const row = async () => (await unsettled()).runs.rows.find((r) => r.id === runId);
      const view = (await api().get(`/api/payroll/runs/${runId}`).set('Cookie', hr).expect(200)).body as { totals: { transfer: number; employees: number } };
      expect(await row()).toMatchObject({ month: MONTH, status: 'draft', employees: view.totals.employees, held: 1, transfer: view.totals.transfer });
      // a draft's hold may still change: not under Lines on Hold yet
      expect((await unsettled()).held.rows.find((h) => h.lineId === heldLine)).toBeUndefined();

      await act('submit', hr).expect(200);
      expect((await row())?.status).toBe('pending_ceo');
      await act('approve', ceo).expect(200);
      expect((await row())?.status).toBe('approved');
      const s = await unsettled();
      expect(s.runs.count).toBe(s.runs.rows.length);
      expect(s.runs.transfer).toBe(Math.round(s.runs.rows.reduce((sum, r) => sum + r.transfer * 100, 0)) / 100);
      // approved: the hold is final
      expect(s.held.rows.find((h) => h.lineId === heldLine)).toMatchObject({ runId, month: MONTH, runStatus: 'approved', employee: { id: held.id } });
      expect(s.held.rows.find((h) => h.lineId === heldLine)!.amount).toBeGreaterThan(0);

      await act('paid', hr, { paidOn: TODAY }).expect(200);
      const after = await unsettled();
      expect(after.runs.rows.find((r) => r.id === runId)).toBeUndefined();
      expect(after.held.rows.find((h) => h.lineId === heldLine)?.runStatus).toBe('paid');
      expect(after.held.amount).toBe(Math.round(after.held.rows.reduce((sum, h) => sum + h.amount * 100, 0)) / 100);
    });

    it('HR records held pay as paid out: the day, how and a note; then it is settled', async () => {
      const body = { paidOn: TODAY, method: 'bank_transfer', note: ' Paid once the bank details came ' };
      for (const session of [finance, ceo, admin]) await paidOut(heldLine, body, session).expect(403);
      expect((await paidOut(heldLine, { ...body, paidOn: addDays(firstDay(MONTH), -1) }).expect(400)).body.message).toBe(
        `The ${monthName(MONTH)} pay can't have been paid out before ${firstDay(MONTH).split('-').reverse().join('/')}.`,
      );
      expect((await paidOut(heldLine, { ...body, paidOn: addDays(TODAY, 1) }).expect(400)).body.message).toBe("The day the held pay was paid out can't be in the future.");
      expect((await paidOut(heldLine, { ...body, method: 'cheque' }).expect(400)).body.message).toEqual([
        'Choose how it was paid out: bank transfer, cash or with a later run.',
      ]);
      expect((await paidOut(paidLine, body).expect(409)).body.message).toBe(`Paid ${RUN} wasn't on hold in ${monthName(MONTH)}: the run paid them.`);
      await paidOut('00000000-0000-4000-8000-000000000000', body).expect(404);

      const released = (await paidOut(heldLine, body).expect(200)).body;
      expect(released).toMatchObject({ lineId: heldLine, month: MONTH, paidOut: { paidOn: TODAY, method: 'bank_transfer', note: 'Paid once the bank details came' } });
      expect((await unsettled()).held.rows.find((h) => h.lineId === heldLine)).toBeUndefined();
      expect((await paidOut(heldLine, body).expect(409)).body.message).toBe(`Held ${RUN}'s held pay for ${monthName(MONTH)} is recorded as paid out already.`);
      expect((await auditOf('payroll_line', heldLine)).at(-1)).toMatchObject({
        action: 'paid_out',
        userId: hrId,
        diff: { month: MONTH, employeeCode: held.employeeCode, paidOn: TODAY, method: 'bank_transfer', note: 'Paid once the bank details came' },
      });
    });
  });

  describe('advances and loans', () => {
    it('lists the open ones with what is outstanding, and the section’s totals', async () => {
      const loan = (
        await api()
          .post('/api/payroll/advances')
          .set('Cookie', hr)
          .send({ employeeId: paid.id, kind: 'loan', amount: 3000, givenOn: TODAY, reason: 'Invented loan', plan: '3 installments of 1,000' })
          .expect(201)
      ).body as { id: string };
      const s = await unsettled(ceo);
      expect(s.advances.rows.find((a) => a.id === loan.id)).toMatchObject({ employee: { id: paid.id }, outstanding: 3000 });
      expect(s.advances.count).toBe(s.advances.rows.length);
      expect(s.advances.outstanding).toBe(Math.round(s.advances.rows.reduce((sum, a) => sum + a.outstanding * 100, 0)) / 100);
      // settled: no longer listed
      await api().post(`/api/payroll/advances/${loan.id}/settle`).set('Cookie', hr).send({ note: 'Written off' }).expect(200);
      expect((await unsettled()).advances.rows.find((a) => a.id === loan.id)).toBeUndefined();
    });
  });
});
