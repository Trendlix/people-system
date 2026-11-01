import type { INestApplication } from '@nestjs/common';
import type { EmployeeBulkResult, Role } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, addMonths, toDateOnly, todayInCairo } from '../src/common/date-only.js';
import { ONLY_HR_EMPLOYMENT } from '../src/employee-bulk/employee-bulk.service.js';
import { MailService } from '../src/mail/mail.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The Employees list's bulk actions (owner, 1 November 2026: "i want to select and create bulk actions such as hold
// access, what else?"; chose Access, Work setup, Check-in rules, Export & message): HR, an Admin and the CEO run them;
// each person's done with its own service, so one refused is skipped with why and the others still done; the
// employment's changes are HR's; a message reaches the bell and, when asked, the email; the export is a spreadsheet of
// the chosen. Email is kept in MailService's outbox (MAIL_TRANSPORT=memory). Every name is invented; this file deletes
// what it made.

process.env.MAIL_TRANSPORT = 'memory';

const RUN = `eb${Date.now().toString(36)}`;
const TODAY = todayInCairo();

describe('Employee bulk actions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mail: MailService;
  let shiftId: string;
  let contracts = 0;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const emails: Record<string, string> = {};
  const people: Record<string, { id: string; employmentId: string }> = {};
  const bulk = (as: string, body: object) => api().post('/api/employees/bulk').set('Cookie', sessions[as]).send(body);
  const ids = (...keys: string[]) => keys.map((k) => people[k].id);

  async function account(key: string, roles: Role[]) {
    emails[key] = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email: emails[key] } })).id;
    sessions[key] = await signIn(app, emails[key]);
  }

  /** An employee in the office under shift A, with a contract in force and an account linked by the work email. */
  async function person(key: string, name: string) {
    await account(key, ['employee']);
    const e = await prisma.employee.create({
      data: {
        employeeCode: `${key.toUpperCase()}-${RUN}`,
        fullNameEn: `${name} ${RUN}`,
        fullNameAr: 'موظف تجريبي',
        workEmail: emails[key],
        employments: { create: { employmentType: 'full_time', status: 'active', joinDate: toDateOnly('2024-01-01'), workArrangement: 'office', shiftId } },
      },
      select: { id: true, employments: { select: { id: true } } },
    });
    const employmentId = e.employments[0].id;
    const start = addMonths(TODAY, -6);
    await prisma.contract.create({
      data: {
        number: `EB-${RUN}-${++contracts}`,
        employmentId,
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
    people[key] = { id: e.id, employmentId };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    mail = app.get(MailService);
    shiftId = (await prisma.shift.findFirstOrThrow({ where: { code: 'A' }, select: { id: true } })).id;
    await account('hr', ['hr']);
    await account('admin', ['admin']);
    await account('finance', ['finance']);
    await person('amal', 'Amal Bulk');
    await person('badr', 'Badr Bulk');
    await person('carm', 'Carmen Bulk');
  });

  afterAll(async () => {
    const mine = Object.values(people).map((p) => p.id);
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await prisma.accessHold.deleteMany({ where: { employeeId: { in: mine } } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: mine } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: mine } } });
    await prisma.employee.deleteMany({ where: { id: { in: mine } } });
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
    await app.close();
  });

  it('is HR’s, an Admin’s and the CEO’s, and checks what each action needs first', async () => {
    await bulk('finance', { action: 'hold', employeeIds: ids('amal'), reason: 'Invented' }).expect(403);
    expect((await bulk('hr', { action: 'hold', employeeIds: ids('amal') }).expect(400)).body.message).toEqual(['Write why their access is on hold.']);
    expect((await bulk('hr', { action: 'nope', employeeIds: ids('amal') }).expect(400)).body.message).toEqual(['Choose an action.']);
    await bulk('hr', { action: 'hold', employeeIds: [], reason: 'Invented' }).expect(400);
    expect((await bulk('hr', { action: 'message', employeeIds: ids('amal'), title: ' ', body: '' }).expect(400)).body.message).toEqual(['Write the message’s title.', 'Write the message.']);
  });

  it('holds access for each chosen person, skips the one already held and the unknown with why, and releases them', async () => {
    let r = (await bulk('hr', { action: 'hold', employeeIds: ids('amal', 'badr'), reason: 'Invented audit' }).expect(200)).body as EmployeeBulkResult;
    expect(r.done.map((p) => p.id)).toEqual(ids('amal', 'badr'));
    expect(r.skipped).toEqual([]);
    expect(await prisma.accessHold.count({ where: { employeeId: { in: ids('amal', 'badr') }, releasedAt: null } })).toBe(2);

    const unknown = '00000000-0000-4000-8000-00000000eb01';
    r = (await bulk('hr', { action: 'hold', employeeIds: [...ids('amal', 'carm'), unknown], reason: 'Invented again' }).expect(200)).body as EmployeeBulkResult;
    expect(r.done.map((p) => p.id)).toEqual(ids('carm'));
    expect(r.skipped.map((p) => [p.id, p.reason.length > 0])).toEqual([
      [people.amal.id, true],
      [unknown, true],
    ]);
    expect(r.skipped[1]).toMatchObject({ name: 'Unknown', reason: 'Not found.' });

    r = (await bulk('admin', { action: 'release', employeeIds: ids('amal', 'badr', 'carm') }).expect(200)).body as EmployeeBulkResult;
    expect(r.done).toHaveLength(3);
    expect(await prisma.accessHold.count({ where: { employeeId: { in: ids('amal', 'badr', 'carm') }, releasedAt: null } })).toBe(0);
  });

  it('changes the manager, the shift and check-in from anywhere: HR’s only', async () => {
    expect((await bulk('admin', { action: 'manager', employeeIds: ids('badr'), managerId: people.amal.id }).expect(403)).body.message).toBe(ONLY_HR_EMPLOYMENT);
    let r = (await bulk('hr', { action: 'manager', employeeIds: ids('badr', 'carm'), managerId: people.amal.id }).expect(200)).body as EmployeeBulkResult;
    expect(r.done).toHaveLength(2);
    const managers = await prisma.employment.findMany({ where: { id: { in: [people.badr.employmentId, people.carm.employmentId] } }, select: { managerId: true } });
    expect(managers.map((m) => m.managerId)).toEqual([people.amal.id, people.amal.id]);

    r = (await bulk('hr', { action: 'check_in_anywhere', employeeIds: ids('amal', 'badr'), on: true }).expect(200)).body as EmployeeBulkResult;
    expect(r.done).toHaveLength(2);
    const anywhere = await prisma.employment.findMany({ where: { id: { in: [people.amal.employmentId, people.badr.employmentId] } }, select: { checkInAnywhere: true } });
    expect(anywhere.every((e) => e.checkInAnywhere)).toBe(true);

    r = (await bulk('hr', { action: 'shift', employeeIds: ids('carm'), shiftId: null }).expect(200)).body as EmployeeBulkResult;
    expect(r.done).toHaveLength(1);
    expect((await prisma.employment.findUniqueOrThrow({ where: { id: people.carm.employmentId }, select: { shiftId: true } })).shiftId).toBeNull();
  });

  it('sends a message to the bell, and by email when asked; audited for each', async () => {
    const before = mail.outbox.length;
    const r = (await bulk('hr', { action: 'message', employeeIds: ids('amal', 'badr'), title: 'Office closed Thursday', body: 'The office is closed on Thursday.', email: true }).expect(200))
      .body as EmployeeBulkResult;
    expect(r.done).toHaveLength(2);
    const bell = await prisma.notification.findMany({ where: { userId: { in: [users.amal, users.badr] }, kind: 'hr_message' } });
    expect(bell.map((n) => n.title)).toEqual(['Office closed Thursday', 'Office closed Thursday']);
    const sent = mail.outbox.slice(before);
    expect(sent.map((m) => m.to).sort()).toEqual([emails.amal, emails.badr].sort());
    expect(sent[0]).toMatchObject({ subject: 'Office closed Thursday', text: 'The office is closed on Thursday.', replyTo: emails.hr });
    expect(await prisma.auditLog.count({ where: { action: 'send_message', entityId: { in: ids('amal', 'badr') } } })).toBe(2);
  });

  it('exports the chosen people as a spreadsheet', async () => {
    const file = await api().get(`/api/employees/bulk/export.xlsx?ids=${ids('amal', 'carm').join(',')}`).set('Cookie', sessions.hr).expect(200);
    expect(file.headers['content-type']).toContain('spreadsheetml');
    expect(file.headers['content-disposition']).toContain('Employees');
    await api().get(`/api/employees/bulk/export.xlsx?ids=${ids('amal').join(',')}`).set('Cookie', sessions.finance).expect(403);
    expect(await prisma.auditLog.findFirst({ where: { action: 'export_employees', entityType: 'employee', userId: users.hr }, orderBy: { at: 'desc' } })).toMatchObject({ diff: { people: 2 } });
  });
});
