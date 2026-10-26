import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// An employee's request to resign (owner, 26 October 2026: "but the employee has to request resignation and then the HR
// generates the document"): sent from My Requests; HR told and the direct manager shown it; a C-level person's to the CEO
// and never HR; withdrawn until recorded; HR records the ending from it (notice day, link back, Recorded) or returns it;
// one waiting at a time; masked for a developer; audited. Every name is invented and ends with RUN; what is made is deleted.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

describe('Resignation requests (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrUserId: string;
  let ceo: string;
  let ceoUserId: string;
  let hrSuper: string;
  let dev: string;
  let deptId: string;
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const people: string[] = [];
  let emailDomainBefore: string | null;
  const api = () => request(app.getHttpServer());

  async function person(key: string, who: string, employment: Record<string, unknown> = {}, session = () => hr) {
    const email = await createUser(prisma, ['employee']);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${who} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', session())
      .send({ employmentType: 'full_time', joinDate: '2024-01-01', departmentId: deptId, workArrangement: 'office', ...employment })
      .expect(201);
  }

  const send = (key: string, fields: Record<string, string> = {}, letter?: Buffer) => {
    const r = api().post('/api/me/resignation').set('Cookie', sessions[key]).field('reason', 'A new chapter').field('confirmed', 'true');
    for (const [k, v] of Object.entries(fields)) r.field(k, v);
    return letter ? r.attach('letter', letter, 'letter.pdf') : r;
  };
  const inbox = (key: string | { userId: string }) =>
    prisma.notification.findMany({ where: { userId: typeof key === 'string' ? users[key] : key.userId, kind: { startsWith: 'resignation_' } }, orderBy: { createdAt: 'asc' }, select: { kind: true, title: true, body: true, link: true } });
  const recordBody = (extra: Record<string, unknown> = {}) => ({ ruleKey: 'resignation', noticeGivenOn: TODAY, certifiedOffice: 'Nasr City', certifiedSerial: `S-${RUN}`, certifiedOn: TODAY, reason: 'A new chapter', ...extra });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrUserId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } })).id;
    const ceoEmail = await createUser(prisma, ['ceo']);
    ceo = await signIn(app, ceoEmail);
    ceoUserId = (await prisma.user.findUniqueOrThrow({ where: { email: ceoEmail } })).id;
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    dev = await signIn(app, await createUser(prisma, ['developer']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Resignations ${RUN}` }).expect(201)).body.id;
    await person('mona', 'Mona Manager');
    await person('sara', 'Sara Sending', { managerId: ids.mona });
    await person('omar', 'Omar Other', { managerId: ids.mona });
    await person('fay', 'Fay Freelance', { employmentType: 'freelance' });
    const g9 = ((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((g) => g.code === 'G9')!;
    await person('cleo', 'Cleo Chief', { departmentId: null, gradeId: g9.id }, () => hrSuper);
  });

  afterAll(async () => {
    await prisma.resignationRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employmentEnding.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  it('the form says the notice and the last day it would give; a freelancer is not offered it', async () => {
    const mine = (await api().get('/api/me/resignation').set('Cookie', sessions.sara).expect(200)).body;
    expect(mine.requests).toEqual([]);
    expect(mine.form).toMatchObject({ offered: true, refusal: null, today: TODAY, notice: '3 months' });
    expect(mine.form.lastDayIfToday > TODAY).toBe(true);
    expect((await api().get('/api/me/resignation').set('Cookie', sessions.fay).expect(200)).body.form.offered).toBe(false);
    expect(said(await send('fay').expect(409))[0]).toMatch(/labour law/);
  });

  it('refuses every problem at once: no reason, no confirmation, a past day, a letter that is not a letter', async () => {
    const res = await api().post('/api/me/resignation').set('Cookie', sessions.sara).field('reason', ' ').field('preferredLastDay', addDays(TODAY, -1)).attach('letter', Buffer.from('not a pdf'), 'x.pdf').expect(400);
    expect(said(res)).toEqual(expect.arrayContaining(['Enter your reason for resigning.', 'Your preferred last working day must be today or later.', 'Tick the box to say you understand a resignation counts once certified at the labour office.', 'The letter must be a PDF or a JPEG, PNG or WebP photo.']));
  });

  let sentId: string;
  it('is sent with a letter: the notice day is today, HR and the manager are told, the CEO is not, nobody else sees it', async () => {
    const preferred = addDays(TODAY, 30);
    const v = (await send('sara', { preferredLastDay: preferred }, PDF).expect(201)).body;
    sentId = v.id;
    expect(v).toMatchObject({ status: 'sent', reason: 'A new chapter', sentOn: TODAY, preferredLastDay: preferred, notice: '3 months', mine: true, confidential: false });
    expect(v.letter).toMatchObject({ mimeType: 'application/pdf' });
    expect(await inbox({ userId: hrUserId })).toEqual([{ kind: 'resignation_new', title: 'A resignation request was sent', body: `Sara Sending ${RUN}`, link: `/resignations/${sentId}` }]);
    expect((await inbox('mona')).map((n) => n.title)).toEqual(['A resignation request from your team']);
    expect(await inbox({ userId: ceoUserId })).toEqual([]);
    expect(await inbox('sara')).toEqual([]);
    await api().get(`/api/resignation-requests/${sentId}`).set('Cookie', sessions.omar).expect(404);
  });

  it('the manager sees it without the reason and the letter; HR and the employee see all', async () => {
    const asManager = (await api().get('/api/resignation-requests').set('Cookie', sessions.mona).expect(200)).body as { id: string; reason: string | null; letter: unknown }[];
    expect(asManager.find((r) => r.id === sentId)).toMatchObject({ reason: null, letter: null });
    await api().get(`/api/resignation-requests/${sentId}/letter`).set('Cookie', sessions.mona).expect(403);
    const asHr = (await api().get(`/api/resignation-requests/${sentId}`).set('Cookie', hr).expect(200)).body;
    expect(asHr).toMatchObject({ reason: 'A new chapter', canRecord: true });
    const letter = await api().get(`/api/resignation-requests/${sentId}/letter`).set('Cookie', hr).expect(200);
    expect(letter.headers['content-type']).toMatch(/pdf/);
    await api().get(`/api/resignation-requests/${sentId}/letter`).set('Cookie', sessions.sara).expect(200);
    expect((await api().get('/api/resignation-requests?status=recorded').set('Cookie', hr).expect(200)).body.some((r: { id: string }) => r.id === sentId)).toBe(false);
  });

  it('a second one is refused while one waits; the employee withdraws, it is kept withdrawn, and may send again', async () => {
    expect(said(await send('sara').expect(409))[0]).toMatch(/already have a resignation request/);
    expect((await api().post(`/api/me/resignation/${sentId}/withdraw`).set('Cookie', sessions.omar).expect(404)).status).toBe(404);
    expect((await api().post(`/api/me/resignation/${sentId}/withdraw`).set('Cookie', sessions.sara).expect(200)).body).toMatchObject({ status: 'withdrawn' });
    expect((await prisma.resignationRequest.findUniqueOrThrow({ where: { id: sentId } })).withdrawnAt).not.toBeNull();
    await api().post(`/api/me/resignation/${sentId}/withdraw`).set('Cookie', sessions.sara).expect(409);
    await api().post(`/api/resignation-requests/${sentId}/record`).set('Cookie', hr).send(recordBody()).expect(409);
  });

  it('HR records the ending from a request: notice day, link back, Recorded, the employee told; no second request meanwhile', async () => {
    const id = (await send('sara').expect(201)).body.id as string;
    await api().post(`/api/resignation-requests/${id}/record`).set('Cookie', sessions.omar).send(recordBody()).expect(404);
    await api().post(`/api/resignation-requests/${id}/record`).set('Cookie', sessions.mona).send(recordBody()).expect(403);
    expect(said(await api().post(`/api/resignation-requests/${id}/record`).set('Cookie', hr).send(recordBody({ ruleKey: 'non_renewal' })).expect(400))[0]).toMatch(/recorded as a resignation/);
    const done = (await api().post(`/api/resignation-requests/${id}/record`).set('Cookie', hr).send(recordBody()).expect(200)).body;
    expect(done.request).toMatchObject({ status: 'recorded', recorded: { endingId: done.ending.id } });
    expect(done.ending).toMatchObject({ ruleKey: 'resignation', noticeGivenOn: TODAY, status: 'pending_ceo' });
    expect((await prisma.resignationRequest.findUniqueOrThrow({ where: { id } })).endingId).toBe(done.ending.id);
    expect((await inbox('sara')).map((n) => n.title)).toEqual(['Your resignation request was recorded']);
    await api().post(`/api/resignation-requests/${id}/record`).set('Cookie', hr).send(recordBody()).expect(409);
    await api().post(`/api/me/resignation/${id}/withdraw`).set('Cookie', sessions.sara).expect(409);
    const again = await send('sara').expect(409);
    expect(said(again)[0]).toMatch(/ending of your employment is already recorded/);
  });

  it('HR returns a mistaken request with a reason, the employee is told and may send it again', async () => {
    await prisma.employmentEnding.deleteMany({ where: { employment: { employeeId: ids.sara } } });
    const id = (await send('sara').expect(201)).body.id as string;
    await api().post(`/api/resignation-requests/${id}/return`).set('Cookie', hr).send({ reason: ' ' }).expect(400);
    const v = (await api().post(`/api/resignation-requests/${id}/return`).set('Cookie', hr).send({ reason: 'Sent by mistake' }).expect(200)).body;
    expect(v).toMatchObject({ status: 'returned', returned: { reason: 'Sent by mistake' } });
    expect((await inbox('sara')).map((n) => n.title)).toContain('Your resignation request was returned');
    await send('sara').expect(201);
  });

  it('a C-level person’s goes to the CEO and never HR; HR cannot see or record it', async () => {
    const v = (await send('cleo').expect(201)).body;
    expect(v.confidential).toBe(true);
    expect((await inbox({ userId: ceoUserId })).map((n) => n.kind)).toEqual(['resignation_new']);
    expect((await inbox({ userId: hrUserId })).every((n) => !n.body.includes('Cleo'))).toBe(true);
    const hrSees = (await api().get('/api/resignation-requests').set('Cookie', hr).expect(200)).body as { id: string }[];
    expect(hrSees.some((r) => r.id === v.id)).toBe(false);
    await api().get(`/api/resignation-requests/${v.id}`).set('Cookie', hr).expect(404);
    await api().post(`/api/resignation-requests/${v.id}/record`).set('Cookie', hr).send(recordBody()).expect(404);
    expect(((await api().get('/api/resignation-requests').set('Cookie', ceo).expect(200)).body as { id: string }[]).some((r) => r.id === v.id)).toBe(true);
    await api().post(`/api/resignation-requests/${v.id}/return`).set('Cookie', ceo).send({ reason: 'Please resend with a reason' }).expect(200);
  });

  it('a developer sees the request masked and cannot open the letter', async () => {
    const id = (await send('omar', {}, PDF).expect(201)).body.id as string;
    const masked = (await api().get(`/api/resignation-requests/${id}`).set('Cookie', dev).expect(200)).body;
    expect(masked.reason).not.toBe('A new chapter');
    expect(masked.letter.letterFileName).not.toBe('letter.pdf');
    expect(masked.employee.fullNameEn).not.toContain('Omar');
    await api().get(`/api/resignation-requests/${id}/letter`).set('Cookie', dev).expect(403);
  });

  it('every step is audited', async () => {
    const actions = (await prisma.auditLog.findMany({ where: { entityType: 'resignation_request', diff: { path: ['employeeId'], equals: ids.sara } }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['create', 'withdraw', 'record', 'return']));
    expect(await prisma.auditLog.count({ where: { entityType: 'resignation_letter', action: 'view_restricted' } })).toBeGreaterThan(0);
  });
});
