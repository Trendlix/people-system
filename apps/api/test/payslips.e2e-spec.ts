import type { INestApplication } from '@nestjs/common';
import { PDFDocument } from '@cantoo/pdf-lib';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { shownDate, todayInCairo } from '../src/common/date-only.js';
import { firstDay, monthName, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { readZip } from '../src/templates/zip.js';
import { createApp, createUser, signIn } from './helpers.js';

// Payslips (owner's decisions, 16 October 2026): issued in English for everyone paid when HR marks the run paid, kept,
// the Arabic one drawn on request, downloaded one at a time or all of a run's as a ZIP by HR, Finance and the CEO, and
// listed on the employee file. And the employee's own (owner, 20 October 2026, the employee app: "My attendance and
// payslips"): their months paid and their own payslips from GET /me/payslips, anyone else's line not there. Other test
// files leave people with signed contracts in the same database, so these tests look at their own people (names end
// with RUN). Every name, account and amount is invented.

const RUN = `ps${Date.now().toString(36).toLowerCase()}`;
const CURRENT = todayInCairo().slice(0, 7);
/** The run's month: last month. */
const MONTH = monthsLater(CURRENT, -1);
const JOINED = firstDay(monthsLater(CURRENT, -3));
const ON_HOLD = 'On hold this month: not paid, so there is no payslip.';
const NOT_FOUND = 'Payroll line not found.';

interface Line {
  id: string;
  employeeId: string;
  employeeCode: string;
  onHold: boolean;
  result: { net: number; transfer: number };
  payslips: { en: boolean; ar: boolean };
}

interface Run {
  id: string;
  status: string;
  paidOn: string | null;
  lines: Line[];
  payslips: number;
}

interface Person {
  id: string;
  employeeCode: string;
  employmentId: string;
}

/** Reads a response body as bytes, whatever its type. */
const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

describe('Payslips (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  let admin: string;
  let staff: string; // an employee's sign-in without an employee profile
  let superAdmin: string;
  let superAdminId: string;
  let paidSession: string; // the paid employee themself
  let paidUserId: string;
  let heldSession: string; // the one on hold themself
  let emailDomainBefore: string | null;
  let paid: Person; // monthly, CIB, insured, with an allowance and a bonus
  let held: Person; // on hold this month
  let broken: Person; // its line can't be drawn when the run is marked paid
  let run: Run;
  const api = () => request(app.getHttpServer());

  const lineOf = (p: Person) => run.lines.find((l) => l.employeeId === p.id)!;
  const payslip = (lineId: string, language: string, session = hr) =>
    api().get(`/api/payroll/lines/${lineId}/payslip/${language}`).set('Cookie', session).buffer(true).parse(bytes);
  const zip = (session = hr) => api().get(`/api/payroll/runs/${run.id}/payslips`).set('Cookie', session).buffer(true).parse(bytes);
  const mine = (session: string) => api().get('/api/me/payslips').set('Cookie', session);
  const myPayslip = (lineId: string, language: string, session: string) => api().get(`/api/me/payslips/${lineId}/${language}`).set('Cookie', session).buffer(true).parse(bytes);
  const userIdOf = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
  const getRun = async () => (run = (await api().get(`/api/payroll/runs/${run.id}`).set('Cookie', hr).expect(200)).body as Run);
  const message = (res: request.Response) => JSON.parse((res.body as Buffer).toString('utf8')).message as string;
  const act = (step: string, session: string, body: object = {}) => api().post(`/api/payroll/runs/${run.id}/${step}`).set('Cookie', session).send(body);

  /** `email`: the work email of their sign-in, which makes the profile theirs. */
  async function hire(name: string, email?: string): Promise<Person> {
    const person = await api()
      .post('/api/employees')
      .set('Cookie', hr)
      .send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظفة تجريبية', ...(email && { workEmail: email }) })
      .expect(201);
    const hired = await api().post(`/api/employees/${person.body.id}/employments`).set('Cookie', hr).send({ employmentType: 'full_time', joinDate: JOINED }).expect(201);
    return { id: person.body.id, employeeCode: person.body.employeeCode, employmentId: hired.body.employment.id };
  }

  async function signed(p: Person, body: object = {}) {
    const draft = (await api().post(`/api/employees/${p.id}/employments/${p.employmentId}/contracts`).set('Cookie', hr).send({ grossSalary: 12000, ...body }).expect(201)).body as {
      id: string;
      startDate: string;
    };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    const superAdminEmail = await createUser(prisma, ['super_admin']);
    superAdmin = await signIn(app, superAdminEmail);
    superAdminId = await userIdOf(superAdminEmail);
    const paidEmail = await createUser(prisma, ['employee']);
    paidSession = await signIn(app, paidEmail);
    paidUserId = await userIdOf(paidEmail);
    const heldEmail = await createUser(prisma, ['employee']);
    heldSession = await signIn(app, heldEmail);
    await prisma.payrollRun.deleteMany();
    // sign-in accounts here are @test.local: no company email domain while these tests run
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);

    const transport = (await api().post('/api/allowance-types').set('Cookie', hr).send({ nameEn: `Transport ${RUN}`, nameAr: 'بدل انتقال', taxable: false }).expect(201)).body.id;
    paid = await hire('Paid', paidEmail);
    await signed(paid, { allowances: [{ allowanceTypeId: transport, amount: 1000 }] });
    await api().patch(`/api/employees/${paid.id}/bank`).set('Cookie', hr).send({ bankName: 'CIB', accountNo: '100012344821', holderName: `PAID ${RUN}` }).expect(200);
    await api().patch(`/api/employees/${paid.id}`).set('Cookie', hr).send({ socialInsured: true }).expect(200);
    held = await hire('Held', heldEmail);
    await signed(held);
    broken = await hire('Broken');
    await signed(broken);

    // a bonus day, on Additions / Deductions (owner, 17 October 2026: no longer typed on the run)
    await api()
      .post('/api/payroll/adjustments')
      .set('Cookie', hr)
      .send({ employeeId: paid.id, month: MONTH, kind: 'addition', type: 'bonus_days', days: 1, reason: 'Invented bonus day' })
      .expect(201);
    run = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: MONTH }).expect(201)).body as Run;
    await api().patch(`/api/payroll/runs/${run.id}/lines`).set('Cookie', hr).send({ lines: [{ id: lineOf(held).id, onHold: true }] }).expect(200);
    await act('submit', hr).expect(200);
    run = (await act('approve', ceo).expect(200)).body as Run;
  });

  afterAll(async () => {
    // runs keep their people on record: remove them so other test files can delete theirs
    await prisma.payrollRun.deleteMany();
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: paid.id } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  it('none before the run is marked paid', async () => {
    expect(run.payslips).toBe(0);
    expect(lineOf(paid).payslips).toEqual({ en: false, ar: false });
    const notYet = `The ${monthName(MONTH)} payroll is approved: payslips are issued once it is marked paid.`;
    expect(message(await payslip(lineOf(paid).id, 'en').expect(409))).toBe(notYet);
    expect(message(await zip().expect(409))).toBe(notYet);
    // the employee's own neither, in the same words, and nothing listed yet; anyone else's line isn't there, not even a 409
    expect(message(await myPayslip(lineOf(paid).id, 'en', paidSession).expect(409))).toBe(notYet);
    expect(message(await myPayslip(lineOf(paid).id, 'en', heldSession).expect(404))).toBe(NOT_FOUND);
    expect((await mine(paidSession).expect(200)).body).toEqual([]);
  });

  it('marking the run paid issues the English payslip of everyone paid; one that fails doesn’t stop it', async () => {
    // a line that can't be drawn (its worked-out pay unreadable)
    const brokenLine = lineOf(broken);
    const kept = await prisma.payrollLine.findUniqueOrThrow({ where: { id: brokenLine.id }, select: { result: true } });
    await prisma.payrollLine.update({ where: { id: brokenLine.id }, data: { result: {} } });
    run = (await act('paid', hr, { paidOn: todayInCairo() }).expect(200)).body as Run;
    expect(run.status).toBe('paid');

    const notHeld = run.lines.filter((l) => !l.onHold);
    expect(run.payslips).toBe(notHeld.length - 1);
    expect(lineOf(paid).payslips).toEqual({ en: true, ar: false });
    expect(lineOf(held).payslips).toEqual({ en: false, ar: false });
    expect(lineOf(broken).payslips).toEqual({ en: false, ar: false });

    // its payslip is drawn when it is first downloaded
    await prisma.payrollLine.update({ where: { id: brokenLine.id }, data: { result: kept.result as object } });
    await payslip(brokenLine.id, 'en').expect(200);
    await getRun();
    expect(run.payslips).toBe(notHeld.length);
    expect(lineOf(broken).payslips.en).toBe(true);
  });

  it('tells each person paid that their payslip is ready, not the one on hold (Phase 4: notifications)', async () => {
    const notes = await prisma.notification.findMany({ where: { userId: paidUserId, kind: 'payslip_issued' }, select: { title: true, body: true, link: true } });
    expect(notes).toEqual([{ title: `Your ${monthName(MONTH)} payslip is ready`, body: `Paid on ${shownDate(todayInCairo())}`, link: `/app/payslips/${lineOf(paid).id}` }]);
    const heldEmail = (await prisma.employee.findUniqueOrThrow({ where: { id: held.id }, select: { workEmail: true } })).workEmail!;
    expect(await prisma.notification.count({ where: { userId: await userIdOf(heldEmail), kind: 'payslip_issued' } })).toBe(0);
  });

  it('a payslip is a protected PDF, shown in the browser, named after the month and the employee', async () => {
    for (const session of [hr, finance, ceo]) {
      const res = await payslip(lineOf(paid).id, 'en', session).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['content-disposition']).toBe(`inline; filename="Payslip ${MONTH} ${paid.employeeCode}.pdf"; filename*=UTF-8''Payslip%20${MONTH}%20${paid.employeeCode}.pdf`);
      const doc = await PDFDocument.load(res.body as Buffer, { ignoreEncryption: true });
      expect(doc.isEncrypted).toBe(true);
      expect(doc.getPageCount()).toBe(1);
    }
    expect((await payslip(lineOf(paid).id, 'en').query({ download: '1' }).expect(200)).headers['content-disposition']).toMatch(/^attachment;/);
    for (const session of [admin, staff]) await payslip(lineOf(paid).id, 'en', session).expect(403);
  });

  it('the Arabic one is drawn the first time it is asked for, then kept: never drawn again', async () => {
    const first = await payslip(lineOf(paid).id, 'ar').expect(200);
    expect(first.headers['content-disposition']).toContain(`filename*=UTF-8''Payslip%20${MONTH}%20${paid.employeeCode}%20%28Arabic%29.pdf`);
    const again = await payslip(lineOf(paid).id, 'ar', finance).expect(200);
    expect(Buffer.compare(first.body as Buffer, again.body as Buffer)).toBe(0);
    expect(await prisma.payslip.count({ where: { lineId: lineOf(paid).id } })).toBe(2);
    await getRun();
    expect(lineOf(paid).payslips).toEqual({ en: true, ar: true });
    expect(run.payslips).toBe(run.lines.filter((l) => !l.onHold).length);
  });

  it('none for a line on hold, a language other than en or ar, or a line that isn’t there', async () => {
    expect(message(await payslip(lineOf(held).id, 'en').expect(409))).toBe(ON_HOLD);
    expect(message(await payslip(lineOf(paid).id, 'fr').expect(400))).toBe('Choose the payslip’s language: en (English) or ar (Arabic).');
    await payslip('00000000-0000-4000-8000-000000000000', 'en').expect(404);
    await payslip('not-a-uuid', 'en').expect(400);
  });

  it('all of a run’s English payslips as a ZIP, the missing ones drawn first; on hold left out', async () => {
    await prisma.payslip.deleteMany({ where: { lineId: lineOf(paid).id, language: 'en' } });
    const res = await zip(finance).expect(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="Payslips ${MONTH}.zip"; filename*=UTF-8''Payslips%20${MONTH}.zip`);
    const archive = readZip(res.body as Buffer);
    const notHeld = run.lines.filter((l) => !l.onHold).map((l) => `Payslip ${MONTH} ${l.employeeCode}.pdf`);
    expect(archive.entries.map((e) => e.name).sort()).toEqual(notHeld.sort());
    expect(archive.has(`Payslip ${MONTH} ${held.employeeCode}.pdf`)).toBe(false);
    const mine = archive.read(`Payslip ${MONTH} ${paid.employeeCode}.pdf`)!;
    expect(mine.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // the missing one was drawn and kept
    expect(await prisma.payslip.count({ where: { lineId: lineOf(paid).id, language: 'en' } })).toBe(1);
    for (const session of [hr, ceo]) await zip(session).expect(200);
    for (const session of [admin, staff]) await zip(session).expect(403);
  });

  it('the employee file lists the months paid, newest first, with which payslips are drawn', async () => {
    const list = (id: string, session = hr) => api().get(`/api/employees/${id}/payslips`).set('Cookie', session);
    const mine = (await list(paid.id, finance).expect(200)).body as { issued: { en: string | null; ar: string | null } }[];
    expect(mine).toEqual([
      {
        lineId: lineOf(paid).id,
        runId: run.id,
        month: MONTH,
        paidOn: todayInCairo(),
        net: lineOf(paid).result.net,
        transfer: lineOf(paid).result.transfer,
        onHold: false,
        issued: { en: expect.any(String), ar: expect.any(String) },
      },
    ]);
    expect(new Date(mine[0].issued.en!).toISOString()).toBe(mine[0].issued.en);
    expect(((await list(held.id, ceo).expect(200)).body as { onHold: boolean; issued: unknown }[])[0]).toMatchObject({ onHold: true, issued: { en: null, ar: null } });
    await list('00000000-0000-4000-8000-000000000000').expect(404);
    for (const session of [admin, staff]) await list(paid.id, session).expect(403);
  });

  it('every payslip drawn and every download is in the audit log, without amounts', async () => {
    const audit = await prisma.auditLog.findMany({ where: { entityType: 'payroll_line', entityId: lineOf(paid).id }, orderBy: { id: 'asc' } });
    const issued = audit.filter((a) => a.action === 'issue_payslip');
    expect(issued.map((a) => (a.diff as { language: string }).language)).toEqual(['en', 'ar', 'en']);
    expect(issued[0].diff).toEqual({ runId: run.id, month: MONTH, employeeCode: paid.employeeCode, language: 'en', fileName: `Payslip ${MONTH} ${paid.employeeCode}.pdf` });
    const downloads = audit.filter((a) => a.action === 'payslip_file');
    expect(downloads.length).toBeGreaterThanOrEqual(6);
    expect(downloads[0].diff).toEqual({ runId: run.id, month: MONTH, employeeCode: paid.employeeCode, language: 'en' });
    const zips = await prisma.auditLog.findMany({ where: { entityType: 'payroll_run', entityId: run.id, action: 'payslip_file' } });
    expect(zips[0].diff).toMatchObject({ month: MONTH, file: 'zip', language: 'en' });
    expect((zips[0].diff as { employees: string[] }).employees).toContain(paid.employeeCode);
    expect((zips[0].diff as { employees: string[] }).employees).not.toContain(held.employeeCode);
    // no amounts: the line is restricted data
    expect(JSON.stringify([...audit, ...zips].map((a) => a.diff))).not.toContain(String(lineOf(paid).result.net));
  });

  describe('the employee’s own, from GET /me/payslips', () => {
    it('an employee lists their own months paid, newest first, as their employee file does', async () => {
      const res = await mine(paidSession).expect(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.body).toEqual([
        {
          lineId: lineOf(paid).id,
          runId: run.id,
          month: MONTH,
          paidOn: todayInCairo(),
          net: lineOf(paid).result.net,
          transfer: lineOf(paid).result.transfer,
          onHold: false,
          issued: { en: expect.any(String), ar: expect.any(String) },
        },
      ]);
      expect(res.body).toEqual((await api().get(`/api/employees/${paid.id}/payslips`).set('Cookie', hr).expect(200)).body);
      // a month on hold is listed, without a payslip
      expect((await mine(heldSession).expect(200)).body).toEqual([expect.objectContaining({ lineId: lineOf(held).id, onHold: true, issued: { en: null, ar: null } })]);
    });

    it('none for a sign-in without an employee profile', async () => {
      for (const session of [staff, hr, finance, ceo]) expect((await mine(session).expect(200)).body).toEqual([]);
    });

    it('an employee opens their own payslip as HR does: the kept protected PDF, shown in the browser or saved', async () => {
      const res = await myPayslip(lineOf(paid).id, 'en', paidSession).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBe("default-src 'none'");
      expect(res.headers['content-disposition']).toBe(`inline; filename="Payslip ${MONTH} ${paid.employeeCode}.pdf"; filename*=UTF-8''Payslip%20${MONTH}%20${paid.employeeCode}.pdf`);
      const doc = await PDFDocument.load(res.body as Buffer, { ignoreEncryption: true });
      expect(doc.isEncrypted).toBe(true);
      expect(Buffer.compare(res.body as Buffer, (await payslip(lineOf(paid).id, 'en').expect(200)).body as Buffer)).toBe(0);
      expect((await myPayslip(lineOf(paid).id, 'en', paidSession).query({ download: '1' }).expect(200)).headers['content-disposition']).toMatch(/^attachment;/);
    });

    it('drawn the first time they ask for it, then kept; drawn and downloaded in the audit log as theirs', async () => {
      const lineId = lineOf(paid).id;
      await prisma.payslip.deleteMany({ where: { lineId, language: 'ar' } });
      const before = (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? 0n;
      const first = await myPayslip(lineId, 'ar', paidSession).expect(200);
      const again = await myPayslip(lineId, 'ar', paidSession).expect(200);
      expect(Buffer.compare(first.body as Buffer, again.body as Buffer)).toBe(0);
      expect(await prisma.payslip.findUniqueOrThrow({ where: { lineId_language: { lineId, language: 'ar' } }, select: { generatedById: true } })).toEqual({ generatedById: paidUserId });
      const audit = await prisma.auditLog.findMany({ where: { userId: paidUserId, entityType: 'payroll_line', entityId: lineId, id: { gt: before } }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['issue_payslip', 'payslip_file', 'payslip_file']);
      expect(audit[1].diff).toEqual({ runId: run.id, month: MONTH, employeeCode: paid.employeeCode, language: 'ar' });
    });

    it('anyone else’s line isn’t there: 404, never 403 or 409', async () => {
      for (const lineId of [lineOf(held).id, lineOf(broken).id]) expect(message(await myPayslip(lineId, 'en', paidSession).expect(404))).toBe(NOT_FOUND);
      // a sign-in without an employee profile has no line, HR's included
      for (const session of [staff, hr]) expect(message(await myPayslip(lineOf(paid).id, 'en', session).expect(404))).toBe(NOT_FOUND);
      expect(message(await myPayslip('00000000-0000-4000-8000-000000000000', 'en', paidSession).expect(404))).toBe(NOT_FOUND);
    });

    it('their own line on hold, a language other than en or ar, or not an id, as for HR', async () => {
      expect(message(await myPayslip(lineOf(held).id, 'en', heldSession).expect(409))).toBe(ON_HOLD);
      expect(message(await myPayslip(lineOf(paid).id, 'fr', paidSession).expect(400))).toBe('Choose the payslip’s language: en (English) or ar (Arabic).');
      await myPayslip('not-a-uuid', 'en', paidSession).expect(400);
    });

    it('a Super Admin viewing as the employee (view only) sees theirs, recorded as on their behalf', async () => {
      const res = await api().post('/api/auth/view-as').set('Cookie', superAdmin).send({ userId: paidUserId }).expect(200);
      const viewing = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='))!.split(';')[0];
      expect((await mine(viewing).expect(200)).body).toEqual((await mine(paidSession).expect(200)).body);
      await myPayslip(lineOf(paid).id, 'en', viewing).expect(200);
      await myPayslip(lineOf(held).id, 'en', viewing).expect(404);
      const seen = await prisma.auditLog.findFirstOrThrow({ where: { action: 'payslip_file', entityId: lineOf(paid).id }, orderBy: { id: 'desc' } });
      expect(seen).toMatchObject({ userId: paidUserId, onBehalfById: superAdminId });
      await api().post('/api/auth/view-as/stop').set('Cookie', viewing).expect(200);
    });

    it('the HR routes are as before: the employee gets 403 there, even for their own', async () => {
      await api().get(`/api/employees/${paid.id}/payslips`).set('Cookie', paidSession).expect(403);
      await payslip(lineOf(paid).id, 'en', paidSession).expect(403);
      await zip(paidSession).expect(403);
    });
  });
});
