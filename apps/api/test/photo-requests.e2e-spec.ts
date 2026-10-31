import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// A new photo of themself the employee sends HR (owner, 31 October 2026: "allow them to upload a new photo as a request
// and approved from the HR"): only the employee sends one, for their own profile, one at a time, and may cancel it while
// it waits; HR or an Admin sees it and approves it (it becomes the employee file's personal photo, as HR's upload of it
// would) or rejects it, with a note or none. The employee sees their own picture and the one they sent; nobody else
// sees more than before. Logged and notified as each step is taken.

const RUN = Date.now().toString(36).toLowerCase();

// A real 1×1 PNG, with a mark after it so each photo differs; a JPEG and a PDF by their first bytes.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const png = (mark: string) => Buffer.concat([PNG, Buffer.from(`MARK:${mark}`)]);
const jpeg = (mark: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from(`MARK:${mark}`)]);
const pdf = Buffer.from('%PDF-1.4\n% MARK:PDF\n%%EOF\n');

const WAITING = 'You already have a new photo waiting for HR. Cancel it to send another.';

interface PhotoRequest {
  id: string;
  employee: { id: string; employeeCode: string; fullNameEn: string };
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  note: string | null;
  status: string;
  requestedBy: { email: string };
  requestedAt: string;
  decidedBy: { email: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  photoId: string | null;
  currentPhotoId?: string | null;
  confidential: boolean;
}

/** An employee with their own sign-in account. */
interface Staff {
  id: string;
  fullNameEn: string;
  email: string;
  session: string;
}

describe('A new photo sent to HR (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hrEmail: string;
  let hr: string;
  let admin: string;
  let ceo: string;
  let finance: string;
  let emailDomainBefore: string | null;
  let mona: Staff;
  let omar: Staff;
  const api = () => request(app.getHttpServer());

  async function newStaff(name: string): Promise<Staff> {
    const email = await createUser(prisma, ['employee']);
    const res = await api()
      .post('/api/employees')
      .set('Cookie', hr)
      .send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email, mobile: '010 1234 5678', dateOfBirth: '1995-03-12' })
      .expect(201);
    return { id: res.body.id, fullNameEn: res.body.fullNameEn, email, session: await signIn(app, email) };
  }

  const send = (s: Staff, file: Buffer, name = 'me.png', session = s.session, note?: string) => {
    const req = api().post(`/api/employees/${s.id}/photo-requests`).set('Cookie', session).attach('file', file, name);
    return note === undefined ? req : req.field('note', note);
  };
  const act = (id: string, step: 'approve' | 'reject' | 'cancel', session: string, body: object = {}) =>
    api().post(`/api/photo-requests/${id}/${step}`).set('Cookie', session).send(body);
  const photoOf = (id: string, session: string) => api().get(`/api/photo-requests/${id}/photo`).set('Cookie', session);
  const profileOf = async (id: string, session: string) => (await api().get(`/api/employees/${id}`).set('Cookie', session).expect(200)).body;
  const listed = async (session: string, status = 'pending') =>
    (await api().get(`/api/photo-requests?status=${status}`).set('Cookie', session).expect(200)).body as PhotoRequest[];
  // what was done (the refusals along the way are logged too, apart)
  const auditOf = (entityId: string) => prisma.auditLog.findMany({ where: { entityId, action: { not: 'refused' } }, orderBy: { id: 'asc' } });
  const userId = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
  const notices = async (email: string, kind: string) => prisma.notification.findMany({ where: { userId: await userId(email), kind }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    admin = await signIn(app, await createUser(prisma, ['admin']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    // sign-in accounts here are @test.local: no company email domain while these run
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    mona = await newStaff('Mona Photo');
    omar = await newStaff('Omar Photo');
  });

  afterAll(async () => {
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  it('shows the employee their own picture beside their name, and nobody else more than before', async () => {
    const upload = await api()
      .post(`/api/employees/${mona.id}/paperwork`)
      .set('Cookie', hr)
      .field('kind', 'personal_photo')
      .attach('file', jpeg('HR'), 'from-hr.jpg')
      .expect(201);
    const own = await profileOf(mona.id, mona.session);
    expect(own.photoId).toBe(upload.body.id);
    expect(own.photoRequests).toEqual([]);
    const file = await api().get(`/api/paperwork/${upload.body.id}/photo`).set('Cookie', mona.session).expect(200);
    expect(Buffer.compare(file.body as Buffer, jpeg('HR'))).toBe(0);

    // another employee, and Finance, as before
    await api().get(`/api/paperwork/${upload.body.id}/photo`).set('Cookie', omar.session).expect(403);
    await api().get(`/api/paperwork/${upload.body.id}/photo`).set('Cookie', finance).expect(403);
    expect((await profileOf(mona.id, finance)).photoId).toBeNull();
  });

  it('takes a photo from the employee themself only, an image, one at a time', async () => {
    // not HR on their behalf, nor a colleague
    expect((await send(mona, png('A'), 'me.png', hr).expect(403)).body.message).toBe('Only the employee can send a new photo of themself.');
    await send(mona, png('A'), 'me.png', omar.session).expect(403);
    // an image, by its content
    expect((await send(mona, pdf, 'me.png').expect(400)).body.message).toBe('The photo must be a JPEG, PNG or WebP image.');
    expect((await api().post(`/api/employees/${mona.id}/photo-requests`).set('Cookie', mona.session).expect(400)).body.message).toBe('Choose a photo of yourself to send.');

    const sent = await send(mona, png('FIRST'), 'Mona new.png', mona.session, '  My new badge photo  ').expect(201);
    expect(sent.body).toEqual({
      id: expect.any(String),
      employee: { id: mona.id, employeeCode: expect.any(String), fullNameEn: mona.fullNameEn },
      fileName: 'Mona new.png',
      mimeType: 'image/png',
      sizeBytes: png('FIRST').length,
      note: 'My new badge photo',
      status: 'pending',
      requestedBy: { email: mona.email },
      requestedAt: expect.any(String),
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      photoId: null,
      confidential: false,
    });
    expect((await send(mona, png('SECOND')).expect(409)).body.message).toBe(WAITING);

    // the employee sees it waiting, and the photo they sent; so do those who decide it
    const own = await profileOf(mona.id, mona.session);
    expect(own.photoRequests.map((r: PhotoRequest) => [r.id, r.status])).toEqual([[sent.body.id, 'pending']]);
    expect(Buffer.compare((await photoOf(sent.body.id, mona.session).expect(200)).body as Buffer, png('FIRST'))).toBe(0);
    const seen = await photoOf(sent.body.id, hr).expect(200);
    expect(seen.headers['content-type']).toBe('image/png');
    expect(seen.headers['cache-control']).toBe('private, no-store');
    await photoOf(sent.body.id, admin).expect(200);
    // nobody else
    await photoOf(sent.body.id, omar.session).expect(403);
    await photoOf(sent.body.id, finance).expect(403);

    // HR's queue, with the picture beside the name now to compare
    const queue = await listed(hr);
    const mine = queue.find((r) => r.id === sent.body.id)!;
    expect(mine).toMatchObject({ status: 'pending', currentPhotoId: own.photoId, confidential: false });
    await api().get('/api/photo-requests').set('Cookie', omar.session).expect(403);
    await api().get('/api/photo-requests').set('Cookie', finance).expect(403);

    // HR told one waits, by name only; logged without the photo
    const told = await notices(hrEmail, 'photo_request_waiting');
    expect(told.at(-1)).toMatchObject({ title: 'A new photo is waiting for you', body: mona.fullNameEn, link: '/approvals' });
    const audit = await auditOf(sent.body.id);
    expect(audit.map((a) => [a.action, a.entityType])).toEqual([['create', 'profile_photo_request']]);
    expect(audit[0].diff).toEqual({ employeeId: mona.id, fileName: 'Mona new.png', sizeBytes: png('FIRST').length, note: 'My new badge photo', status: 'pending' });

    // the employee withdraws it while it waits; then it can't be decided
    await act(sent.body.id, 'cancel', omar.session).expect(403);
    await act(sent.body.id, 'cancel', hr).expect(403);
    const cancelled = await act(sent.body.id, 'cancel', mona.session).expect(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', decidedBy: { email: mona.email }, decidedAt: expect.any(String) });
    expect((await act(sent.body.id, 'approve', hr).expect(409)).body.message).toBe('Only a photo waiting for HR can be approved. This one is cancelled.');
    expect((await auditOf(sent.body.id)).map((a) => a.action)).toEqual(['create', 'cancel']);
    expect(await listed(hr)).not.toContainEqual(expect.objectContaining({ id: sent.body.id }));
    expect((await listed(hr, 'all')).map((r) => r.id)).toContain(sent.body.id);
  });

  it('rejected, with a note or none: nothing changes, and the employee is told', async () => {
    const before = (await profileOf(mona.id, mona.session)).photoId;
    const sent = await send(mona, jpeg('REJECT'), 'me.jpg').expect(201);
    // the CEO decides only a C-level person's
    expect((await act(sent.body.id, 'reject', ceo).expect(403)).body.message).toBe("HR or an Admin decides this photo request: the CEO decides only a C-level person's.");
    await act(sent.body.id, 'reject', mona.session).expect(403);

    const rejected = await act(sent.body.id, 'reject', hr, { note: 'Please use a photo without sunglasses.' }).expect(200);
    expect(rejected.body).toMatchObject({ status: 'rejected', decidedBy: { email: hrEmail }, decisionNote: 'Please use a photo without sunglasses.', photoId: null });
    expect((await profileOf(mona.id, mona.session)).photoId).toBe(before);
    expect(await notices(mona.email, 'photo_request_decided')).toEqual([
      expect.objectContaining({ title: 'Your new photo was rejected', link: `/employees/${mona.id}/photo` }),
    ]);
    expect((await auditOf(sent.body.id)).map((a) => [a.action, a.diff])).toEqual([
      ['create', expect.anything()],
      ['reject', { employeeId: mona.id, status: { from: 'pending', to: 'rejected' }, decisionNote: 'Please use a photo without sunglasses.' }],
    ]);

    // without a note too (Admin decides as HR does)
    const again = await send(mona, jpeg('REJECT-2'), 'me.jpg').expect(201);
    expect((await act(again.body.id, 'reject', admin).expect(200)).body).toMatchObject({ status: 'rejected', decisionNote: null });
  });

  it('approved: the employee file’s personal photo, as HR’s upload of it would be, and the employee is told', async () => {
    const sent = await send(mona, png('APPROVE'), 'Mona.png', mona.session).expect(201);
    const approved = await act(sent.body.id, 'approve', hr, { note: 'Looks good' }).expect(200);
    expect(approved.body).toMatchObject({ status: 'approved', decidedBy: { email: hrEmail }, decisionNote: 'Looks good', photoId: expect.any(String) });
    const photoId = approved.body.photoId as string;

    // in the employee file as a personal photo uploaded by HR, uncropped; the picture beside the name for everyone who saw one
    const item = await prisma.paperworkItem.findUniqueOrThrow({ where: { id: photoId }, select: { employeeId: true, kind: true, mimeType: true, fileName: true, uploadedBy: { select: { email: true } }, photoCrop: true } });
    expect(item).toEqual({ employeeId: mona.id, kind: 'personal_photo', mimeType: 'image/png', fileName: 'Mona.png', uploadedBy: { email: hrEmail }, photoCrop: null });
    expect((await profileOf(mona.id, mona.session)).photoId).toBe(photoId);
    expect((await profileOf(mona.id, hr)).photoId).toBe(photoId);
    expect(Buffer.compare((await api().get(`/api/paperwork/${photoId}/photo`).set('Cookie', mona.session).expect(200)).body as Buffer, png('APPROVE'))).toBe(0);
    await api().get(`/api/paperwork/${photoId}/photo`).set('Cookie', omar.session).expect(403);
    const papers = (await api().get(`/api/employees/${mona.id}/paperwork`).set('Cookie', hr).expect(200)).body as { id: string; kind: string }[];
    expect(papers[0]).toMatchObject({ id: photoId, kind: 'personal_photo' });

    // logged as the request decided and as a paper added to the file, from the request
    expect((await auditOf(sent.body.id)).map((a) => [a.action, a.diff])).toEqual([
      ['create', expect.anything()],
      ['approve', { employeeId: mona.id, status: { from: 'pending', to: 'approved' }, decisionNote: 'Looks good', photoId }],
    ]);
    expect((await auditOf(photoId)).map((a) => [a.action, a.diff])).toEqual([
      ['create', { employeeId: mona.id, kind: 'personal_photo', fileName: 'Mona.png', sizeBytes: png('APPROVE').length, photoRequestId: sent.body.id }],
    ]);
    expect((await notices(mona.email, 'photo_request_decided')).at(-1)).toMatchObject({ title: 'Your new photo was approved', body: 'It is now your picture in People.' });

    // decided once: a second decision is refused, and another photo may be sent now
    expect((await act(sent.body.id, 'reject', admin).expect(409)).body.message).toBe('Only a photo waiting for HR can be rejected. This one is approved.');
    await send(mona, png('NEXT'), 'next.png').expect(201);
    const own = await profileOf(mona.id, mona.session);
    expect(own.photoRequests.map((r: PhotoRequest) => r.status)).toEqual(['pending', 'approved', 'rejected', 'rejected', 'cancelled']);
    // those who decide see them on the profile too; a colleague doesn't get the profile at all
    expect((await profileOf(mona.id, hr)).photoRequests).toHaveLength(5);
    await api().get(`/api/employees/${mona.id}`).set('Cookie', omar.session).expect(404);
  });
});
