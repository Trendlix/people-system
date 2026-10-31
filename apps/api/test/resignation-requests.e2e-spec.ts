import type { INestApplication } from '@nestjs/common';
import { RESIGNATION_LETTER_NO_TEMPLATE, RESIGNATION_LETTER_NOT_SENT, toArabicDigits } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { MockInstance } from 'vitest';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import { PdfService } from '../src/pdf/pdf.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { paragraphTexts, textParts } from '../src/templates/docx-tags.js';
import { readZip } from '../src/templates/zip.js';
import { realTemplate } from './fixtures/docx.js';
import { convertedPdf } from './fixtures/pdf.js';
import { createApp, createUser, signIn } from './helpers.js';

// An employee's request to resign (owner, 26 October 2026: "but the employee has to request resignation and then the HR
// generates the document"): sent from My Requests; HR told and the direct manager shown it; a C-level person's to the CEO
// and never HR; withdrawn until recorded; HR records the ending from it (notice day, link back, Recorded) or returns it;
// one waiting at a time; masked for a developer; audited. Every name is invented and ends with RUN; what is made is deleted.
// The letter (owner, 31 October 2026: "on the resignation, the letter is auto generated, viewed by the employee but
// uploaded by the HR"): no file with the request; People's letter filled in from the owner's real resignation template
// once published (the converter stood in for, as in documents.e2e-spec.ts), for the employee and HR, never the manager;
// the signed copy uploaded by HR (the CEO for a C-level person), replaceable, and opened by the employee.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

/** Reads a response body as bytes, whatever its type. */
const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

/** The printed text of a .docx: its paragraphs, in order, one per line. */
function textOf(file: Uint8Array): string {
  const zip = readZip(Buffer.from(file));
  return textParts(zip.entries.map((e) => e.name))
    .flatMap((name) => paragraphTexts(zip.read(name)!.toString('utf8')))
    .join('\n');
}

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
  let convert: MockInstance<PdfService['fromDocx']>;
  let templateId: string | null = null;
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

  // as a form, as the app sent it before 31 October 2026; the website sends JSON (below)
  const send = (key: string, fields: Record<string, string> = {}) => {
    const r = api().post('/api/me/resignation').set('Cookie', sessions[key]).field('reason', 'A new chapter').field('confirmed', 'true');
    for (const [k, v] of Object.entries(fields)) r.field(k, v);
    return r;
  };
  const generated = (id: string, session: string, query = '') => api().get(`/api/resignation-requests/${id}/generated-letter${query}`).set('Cookie', session).buffer(true).parse(bytes);
  const upload = (id: string, session: string, file: Buffer, name = 'signed.pdf') => api().post(`/api/resignation-requests/${id}/letter`).set('Cookie', session).attach('letter', file, name);
  /** A refusal's message, read as bytes. */
  const saidBytes = (res: request.Response) => ([] as string[]).concat((JSON.parse((res.body as Buffer).toString('utf8')) as { message: string | string[] }).message);
  const inbox = (key: string | { userId: string }) =>
    prisma.notification.findMany({ where: { userId: typeof key === 'string' ? users[key] : key.userId, kind: { startsWith: 'resignation_' } }, orderBy: { createdAt: 'asc' }, select: { kind: true, title: true, body: true, link: true } });
  const recordBody = (extra: Record<string, unknown> = {}) => ({ ruleKey: 'resignation', noticeGivenOn: TODAY, certifiedOffice: 'Nasr City', certifiedSerial: `S-${RUN}`, certifiedOn: TODAY, reason: 'A new chapter', ...extra });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    // the converter (Gotenberg) can't run here: its PDF is stood in for, and protected for real
    const converted = await convertedPdf();
    convert = vi.spyOn(app.get(PdfService), 'fromDocx').mockImplementation(async () => converted);
    // no Resignation request template to start with (documents.e2e-spec.ts leaves its own published)
    await prisma.generatedDocument.deleteMany({ where: { slotKey: 'resignation_request' } });
    await prisma.templateVersion.deleteMany({ where: { slotKey: 'resignation_request' } });
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
    if (templateId) await prisma.templateVersion.deleteMany({ where: { id: templateId } });
    vi.restoreAllMocks();
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

  it('refuses every problem at once: no reason, no confirmation, a past day', async () => {
    const res = await api().post('/api/me/resignation').set('Cookie', sessions.sara).field('reason', ' ').field('preferredLastDay', addDays(TODAY, -1)).expect(400);
    expect(said(res)).toEqual(['Enter your reason for resigning.', 'Your preferred last working day must be today or later.', 'Tick the box to say you understand a resignation counts once certified at the labour office.']);
  });

  it('takes no letter from the employee: People prepares it', async () => {
    expect(said(await send('sara').attach('letter', PDF, 'letter.pdf').expect(400))).toEqual([RESIGNATION_LETTER_NOT_SENT]);
    expect(said(await send('sara').attach('file', PDF, 'letter.pdf').expect(400))).toEqual([RESIGNATION_LETTER_NOT_SENT]);
    expect(await prisma.resignationRequest.count({ where: { employeeId: ids.sara } })).toBe(0);
  });

  let sentId: string;
  it('is sent (as JSON): the notice day is today, HR and the manager are told, the CEO is not, nobody else sees it', async () => {
    const preferred = addDays(TODAY, 30);
    const v = (await api().post('/api/me/resignation').set('Cookie', sessions.sara).send({ reason: 'A new chapter', preferredLastDay: preferred, confirmed: true }).expect(201)).body;
    sentId = v.id;
    expect(v).toMatchObject({ status: 'sent', reason: 'A new chapter', sentOn: TODAY, preferredLastDay: preferred, notice: '3 months', mine: true, confidential: false });
    expect(v).toMatchObject({ letter: null, preparedLetter: 'no_template' });
    expect(await inbox({ userId: hrUserId })).toEqual([{ kind: 'resignation_new', title: 'A resignation request was sent', body: `Sara Sending ${RUN}`, link: `/resignations/${sentId}` }]);
    expect((await inbox('mona')).map((n) => n.title)).toEqual(['A resignation request from your team']);
    expect(await inbox({ userId: ceoUserId })).toEqual([]);
    expect(await inbox('sara')).toEqual([]);
    await api().get(`/api/resignation-requests/${sentId}`).set('Cookie', sessions.omar).expect(404);
  });

  it('the manager sees it without the reason and the letters; HR and the employee see all', async () => {
    const asManager = (await api().get('/api/resignation-requests').set('Cookie', sessions.mona).expect(200)).body as { id: string; reason: string | null; letter: unknown }[];
    expect(asManager.find((r) => r.id === sentId)).toMatchObject({ reason: null, letter: null, preparedLetter: null });
    await api().get(`/api/resignation-requests/${sentId}/letter`).set('Cookie', sessions.mona).expect(403);
    await generated(sentId, sessions.mona).expect(403);
    const asHr = (await api().get(`/api/resignation-requests/${sentId}`).set('Cookie', hr).expect(200)).body;
    expect(asHr).toMatchObject({ reason: 'A new chapter', canRecord: true, canUploadLetter: true, letter: null });
    expect((await api().get(`/api/resignation-requests/${sentId}`).set('Cookie', sessions.sara).expect(200)).body).toMatchObject({ canRecord: false, canUploadLetter: false });
    expect(saidBytes(await api().get(`/api/resignation-requests/${sentId}/letter`).set('Cookie', sessions.sara).buffer(true).parse(bytes).expect(404))).toEqual(['The signed letter hasn’t been uploaded yet.']);
    expect((await api().get('/api/resignation-requests?status=recorded').set('Cookie', hr).expect(200)).body.some((r: { id: string }) => r.id === sentId)).toBe(false);
  });

  it('the letter waits for HR to publish the Resignation request template', async () => {
    expect(saidBytes(await generated(sentId, sessions.sara).expect(409))).toEqual([RESIGNATION_LETTER_NO_TEMPLATE]);
    expect(saidBytes(await generated(sentId, hr).expect(409))).toEqual([RESIGNATION_LETTER_NO_TEMPLATE]);
    expect(convert).not.toHaveBeenCalled();
  });

  it('once published, People fills the letter in from the request for the employee and HR, as a protected PDF', async () => {
    const draft = await api().post('/api/templates/resignation_request/versions').set('Cookie', hrSuper).attach('file', realTemplate('Resignation'), 'resignation_request.docx').expect(201);
    templateId = draft.body.id as string;
    // a draft isn't enough
    expect((await api().get('/api/me/resignation').set('Cookie', sessions.sara).expect(200)).body.requests[0].preparedLetter).toBe('no_template');
    await api().post(`/api/templates/versions/${templateId}/publish`).set('Cookie', hrSuper).expect(200);
    expect((await api().get('/api/me/resignation').set('Cookie', sessions.sara).expect(200)).body.requests[0].preparedLetter).toBe('ready');

    const pdf = await generated(sentId, sessions.sara).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(/^inline/);
    expect((pdf.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // the request stands for the ending: its day is the resignation date and the request date; an English reason prints the owner's default
    const text = textOf(convert.mock.calls.at(-1)![0]);
    const day = toArabicDigits(`${Number(TODAY.slice(0, 4))}/${Number(TODAY.slice(5, 7))}/${Number(TODAY.slice(8, 10))}`);
    expect(text).toContain('أنا موظف تجريبي');
    expect(text).toContain(`من العمل داخل الشركة لأسباب شخصية وذلك اعتبارا من اليوم الموافق:  ${day}`);
    expect(text).not.toContain('{{');

    expect((await generated(sentId, hr, '?download=1').expect(200)).headers['content-disposition']).toMatch(/^attachment/);
    await generated(sentId, dev).expect(403);
    await generated(sentId, sessions.omar).expect(404);
    const opened = await prisma.auditLog.findMany({ where: { entityType: 'resignation_letter', entityId: sentId, action: 'view_restricted' } });
    expect(opened.map((a) => (a.diff as { letter?: string }).letter)).toEqual(['generated', 'generated']);
  });

  it('an Arabic reason is printed as written', async () => {
    const id = (await api().post('/api/me/resignation').set('Cookie', sessions.omar).send({ reason: 'لظروف عائلية', confirmed: true }).expect(201)).body.id as string;
    await generated(id, sessions.omar).expect(200);
    expect(textOf(convert.mock.calls.at(-1)![0])).toContain('من العمل داخل الشركة لظروف عائلية وذلك');
    await api().post(`/api/me/resignation/${id}/withdraw`).set('Cookie', sessions.omar).expect(200);
  });

  it('HR uploads the signed letter, and may replace it; the employee opens it, the manager never', async () => {
    expect(said(await upload(sentId, sessions.sara, PDF).expect(403))[0]).toBe('HR keeps the signed copy of your letter: hand it to HR.');
    expect(said(await upload(sentId, sessions.mona, PDF).expect(403))[0]).toBe('Only HR uploads the signed letter.');
    expect(said(await upload(sentId, ceo, PDF).expect(403))[0]).toBe('Only HR uploads the signed letter.');
    await upload(sentId, sessions.omar, PDF).expect(404);
    expect(said(await api().post(`/api/resignation-requests/${sentId}/letter`).set('Cookie', hr).expect(400))).toEqual(['Choose the signed letter: a PDF or a photo.']);
    expect(said(await upload(sentId, hr, Buffer.from('not a pdf')).expect(400))).toEqual(['The letter must be a PDF or a JPEG, PNG or WebP photo.']);

    const kept = (await upload(sentId, hr, PDF, 'سارة.pdf').expect(200)).body;
    expect(kept).toMatchObject({ id: sentId, status: 'sent', letter: { letterFileName: 'سارة.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length } });
    const letter = await api().get(`/api/resignation-requests/${sentId}/letter`).set('Cookie', sessions.sara).expect(200);
    expect(letter.headers['content-type']).toMatch(/pdf/);
    await api().get(`/api/resignation-requests/${sentId}/letter`).set('Cookie', hr).expect(200);
    expect((await api().get(`/api/resignation-requests/${sentId}`).set('Cookie', sessions.mona).expect(200)).body).toMatchObject({ letter: null });

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    expect((await upload(sentId, hr, png, 'photo.png').expect(200)).body.letter).toMatchObject({ letterFileName: 'photo.png', mimeType: 'image/png' });
    const steps = await prisma.auditLog.findMany({ where: { entityType: 'resignation_letter', entityId: sentId, action: 'attach_signed' }, orderBy: { id: 'asc' } });
    expect(steps.map((a) => [a.userId, (a.diff as { letterFileName: string }).letterFileName, (a.diff as { replaced?: string }).replaced ?? null])).toEqual([
      [hrUserId, 'سارة.pdf', null],
      [hrUserId, 'photo.png', 'سارة.pdf'],
    ]);
  });

  it('a second one is refused while one waits; the employee withdraws, it is kept withdrawn, and may send again', async () => {
    expect(said(await send('sara').expect(409))[0]).toMatch(/already have a resignation request/);
    expect((await api().post(`/api/me/resignation/${sentId}/withdraw`).set('Cookie', sessions.omar).expect(404)).status).toBe(404);
    expect((await api().post(`/api/me/resignation/${sentId}/withdraw`).set('Cookie', sessions.sara).expect(200)).body).toMatchObject({ status: 'withdrawn' });
    expect((await prisma.resignationRequest.findUniqueOrThrow({ where: { id: sentId } })).withdrawnAt).not.toBeNull();
    await api().post(`/api/me/resignation/${sentId}/withdraw`).set('Cookie', sessions.sara).expect(409);
    await api().post(`/api/resignation-requests/${sentId}/record`).set('Cookie', hr).send(recordBody()).expect(409);
    // a withdrawn request keeps the signed letter it had, but takes no other
    expect(said(await upload(sentId, hr, PDF).expect(409))[0]).toBe("This request is withdrawn, so its signed letter isn't kept.");
    expect((await api().get(`/api/resignation-requests/${sentId}`).set('Cookie', hr).expect(200)).body).toMatchObject({ canUploadLetter: false, letter: { letterFileName: 'photo.png' } });
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
    // the signed letter is kept once it is recorded too
    expect((await upload(id, hr, PDF).expect(200)).body).toMatchObject({ status: 'recorded', letter: { mimeType: 'application/pdf' } });
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
    // the letter: HR never sees it nor keeps its signed copy; the CEO does
    await generated(v.id, hr).expect(404);
    await upload(v.id, hr, PDF).expect(404);
    await generated(v.id, ceo).expect(200);
    expect((await upload(v.id, ceo, PDF).expect(200)).body).toMatchObject({ confidential: true, letter: { mimeType: 'application/pdf' } });
    await api().post(`/api/resignation-requests/${v.id}/return`).set('Cookie', ceo).send({ reason: 'Please resend with a reason' }).expect(200);
  });

  it('a developer sees the request masked and cannot open the letters or upload one', async () => {
    const id = (await send('omar').expect(201)).body.id as string;
    await upload(id, hr, PDF, 'letter.pdf').expect(200);
    const masked = (await api().get(`/api/resignation-requests/${id}`).set('Cookie', dev).expect(200)).body;
    expect(masked.reason).not.toBe('A new chapter');
    expect(masked.letter.letterFileName).not.toBe('letter.pdf');
    expect(masked.employee.fullNameEn).not.toContain('Omar');
    await api().get(`/api/resignation-requests/${id}/letter`).set('Cookie', dev).expect(403);
    await generated(id, dev).expect(403);
    await upload(id, dev, PDF).expect(403);
  });

  it('every step is audited', async () => {
    const actions = (await prisma.auditLog.findMany({ where: { entityType: 'resignation_request', diff: { path: ['employeeId'], equals: ids.sara } }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['create', 'withdraw', 'record', 'return']));
    expect(await prisma.auditLog.count({ where: { entityType: 'resignation_letter', action: 'view_restricted' } })).toBeGreaterThan(0);
    expect(await prisma.auditLog.count({ where: { entityType: 'resignation_letter', action: 'attach_signed' } })).toBeGreaterThan(0);
  });
});
