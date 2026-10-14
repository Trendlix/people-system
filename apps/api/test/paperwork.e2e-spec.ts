import type { INestApplication } from '@nestjs/common';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Unique per run, because the test database keeps data from earlier runs.
const RUN = String(Date.now()).slice(-8);
const arabicDigits = (s: string) => s.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));

// A real 1×1 PNG. Test files carry a mark ("MARK:FRONT" …) after the image data, which tells the fake OCR service
// below what to answer; the file is still a PNG by its first bytes.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const png = (mark: string) => Buffer.concat([PNG, Buffer.from(`MARK:${mark}`)]);
const jpeg = (mark: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from(`MARK:${mark}`)]);
const pdf = (mark: string) => Buffer.from(`%PDF-1.4\n% MARK:${mark}\n%%EOF\n`);

// What the cards say, as the OCR service reads them (Arabic-Indic digits, as printed).
const FRONT = `جمهورية مصر العربية
بطاقة تحقيق الشخصية
محمد
أحمد محمود عبد الله
١٥ شارع مكرم عبيد
أول مدينة نصر - القاهرة
٢٩٥٠ ٣١٢٠ ١٢٣٤ ٥٦`;
const BACK = `٢٩٥٠٣١٢٠١٢٣٤٥٦   ٢٠٢٠/٠٧
سجل مدني مدينة نصر
مهندس برمجيات
ذكر     مسلم     أعزب
البطاقة سارية حتى ٢٠٢٧/٠٧/١١`;
const RECEIPT = `إقـرار اسْتلام العُهدة رقم ${arabicDigits(RUN)}
يقر الموظف باستلام جهاز حاسب محمول`;
const ID_BACK = `بطاقة مسجلة برقم ملف ${arabicDigits(RUN)}٧`;

interface FakeOcr {
  url: string;
  calls: { lang: string | null }[];
  close: () => Promise<void>;
}

/** A stand-in for services/ocr: answers POST /read with the text for the file's mark, or 500 for MARK:FAIL. */
async function fakeOcr(texts: Record<string, string>): Promise<FakeOcr> {
  const calls: { lang: string | null }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://ocr');
      if (req.method !== 'POST' || url.pathname !== '/read') return void res.writeHead(404).end();
      const lang = url.searchParams.get('lang');
      calls.push({ lang });
      const mark = /MARK:(\w+)/.exec(Buffer.concat(chunks).toString('latin1'))?.[1] ?? '';
      if (mark === 'FAIL') return void res.writeHead(500).end('Internal Server Error');
      const text = texts[mark] ?? 'مستند';
      const lines = text.split('\n').map((line, i) => ({ text: line, confidence: 0.93, box: [10, i * 30, 400, i * 30 + 24] }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ lang, pages: [{ lines }], text }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** An address where nothing listens: the OCR service is not running. */
async function deadUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}`;
}

describe('Paperwork (e2e)', () => {
  const ocrUrlBefore = process.env.OCR_URL;
  let ocr: FakeOcr;
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hrEmail: string;
  let hr: string;
  let ceo: string;
  let finance: string;
  let staff: string;
  let employeeId: string;
  const api = () => request(app.getHttpServer());

  async function upload(file: Buffer, fileName: string, kind: string, target = app) {
    const res = await request(target.getHttpServer())
      .post(`/api/employees/${employeeId}/paperwork`)
      .set('Cookie', hr)
      .field('kind', kind)
      .attach('file', file, fileName)
      .expect(201);
    return res.body as { id: string; ocrStatus: string; fileName: string; [key: string]: unknown };
  }

  const auditOf = (itemId: string) => prisma.auditLog.findMany({ where: { entityType: 'paperwork', entityId: itemId }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    ocr = await fakeOcr({ FRONT, BACK, RECEIPT, ID_BACK });
    process.env.OCR_URL = ocr.url;
    ({ app, prisma } = await createApp());
    hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    const e = await api()
      .post('/api/employees')
      .set('Cookie', hr)
      .send({ fullNameEn: `Paper Trail ${RUN}`, fullNameAr: 'موظف تجريبي', employmentType: 'full_time', joinDate: '2026-01-15' })
      .expect(201);
    employeeId = e.body.id;
  });

  afterAll(async () => {
    await app.close();
    await ocr.close();
    if (ocrUrlBefore === undefined) delete process.env.OCR_URL;
    else process.env.OCR_URL = ocrUrlBefore;
  });

  it('stores a document, reads its text in Arabic, and lists the file newest first without its bytes or text', async () => {
    const form = await upload(pdf('RECEIPT'), 'استمارة ١.pdf', 'insurance_form_1');
    expect(form).toEqual({
      id: expect.any(String),
      kind: 'insurance_form_1',
      fileName: 'استمارة ١.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdf('RECEIPT').length,
      ocrStatus: 'done',
      uploadedAt: expect.any(String),
      uploadedBy: { email: hrEmail },
    });
    expect(ocr.calls.at(-1)).toEqual({ lang: 'ar' });
    const photo = await upload(png('NONE'), 'photo.png', 'personal_photo');

    const list = await api().get(`/api/employees/${employeeId}/paperwork`).set('Cookie', ceo).expect(200);
    expect(list.body.slice(0, 2).map((i: { id: string }) => i.id)).toEqual([photo.id, form.id]);
    expect(Object.keys(list.body[0]).sort()).toEqual(['fileName', 'id', 'kind', 'mimeType', 'ocrStatus', 'sizeBytes', 'uploadedAt', 'uploadedBy']);

    const text = await api().get(`/api/paperwork/${form.id}/text`).set('Cookie', hr).expect(200);
    expect(text.body).toEqual({ ocrStatus: 'done', ocrText: RECEIPT });

    const audit = await auditOf(form.id);
    expect(audit.map((a) => a.action)).toEqual(['create']); // not restricted: reading the text is not logged
    expect(audit[0].diff).toEqual({ employeeId, kind: 'insurance_form_1', fileName: 'استمارة ١.pdf', sizeBytes: pdf('RECEIPT').length });
  });

  it('serves the file with safe headers, and logs every view of a national ID scan', async () => {
    const card = await upload(png('NONE'), 'بطاقة<1>.png', 'national_id_front');
    expect(card.fileName).toBe('بطاقة_1_.png');

    const file = await api().get(`/api/paperwork/${card.id}/file`).set('Cookie', ceo).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['content-disposition']).toBe(`inline; filename="__1_.png"; filename*=UTF-8''${encodeURIComponent('بطاقة_1_.png')}`);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['content-security-policy']).toBe("default-src 'none'");
    expect(file.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.compare(file.body as Buffer, png('NONE'))).toBe(0);
    await api().get(`/api/paperwork/${card.id}/text`).set('Cookie', hr).expect(200);

    const audit = await auditOf(card.id);
    expect(audit.map((a) => [a.action, (a.diff as { fields?: string[] }).fields])).toEqual([
      ['create', undefined],
      ['view_restricted', ['file']],
      ['view_restricted', ['ocrText']],
    ]);
    expect(audit[1].diff).toEqual({ employeeId, kind: 'national_id_front', fields: ['file'] });

    await api().get('/api/paperwork/00000000-0000-4000-8000-000000000000/file').set('Cookie', hr).expect(404);
  });

  it('refuses files that are not JPEG, PNG, WebP or PDF, files over 10 MB, and uploads without a file or kind', async () => {
    const before = await prisma.paperworkItem.count({ where: { employeeId } });
    const post = () => api().post(`/api/employees/${employeeId}/paperwork`).set('Cookie', hr);

    const fake = await post()
      .field('kind', 'other')
      .attach('file', Buffer.from('just some text'), { filename: 'scan.png', contentType: 'image/png' })
      .expect(400);
    expect(fake.body.message).toBe('The file must be a JPEG, PNG or WebP image, or a PDF.');

    const big = await post()
      .field('kind', 'other')
      .attach('file', Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]), 'big.png')
      .expect(413);
    expect(big.body.message).toBe('Each file must be 10 MB or smaller.');

    expect((await post().field('kind', 'other').expect(400)).body.message).toBe('Choose a file to upload.');
    await post().attach('file', png('NONE'), 'x.png').expect(400); // no kind
    await post().field('kind', 'passport').attach('file', png('NONE'), 'x.png').expect(400);
    await api()
      .post('/api/employees/00000000-0000-4000-8000-000000000000/paperwork')
      .set('Cookie', hr)
      .field('kind', 'other')
      .attach('file', png('NONE'), 'x.png')
      .expect(404);

    expect(await prisma.paperworkItem.count({ where: { employeeId } })).toBe(before);
  });

  it('is for HR and the CEO only, and only HR changes it', async () => {
    const item = await upload(png('NONE'), 'letter.png', 'bank_letter');
    await api().get(`/api/employees/${employeeId}/paperwork`).set('Cookie', finance).expect(403);
    await api().get(`/api/employees/${employeeId}/paperwork`).set('Cookie', staff).expect(403);
    await api().get(`/api/paperwork/${item.id}/file`).set('Cookie', finance).expect(403);
    await api().get(`/api/paperwork/${item.id}/text`).set('Cookie', staff).expect(403);
    await api().get('/api/paperwork/search?q=letter').set('Cookie', finance).expect(403);
    await api().post(`/api/employees/${employeeId}/paperwork`).set('Cookie', ceo).field('kind', 'other').attach('file', png('NONE'), 'x.png').expect(403);
    await api().post(`/api/paperwork/${item.id}/ocr`).set('Cookie', ceo).expect(403);
    await api().delete(`/api/paperwork/${item.id}`).set('Cookie', ceo).expect(403);
    await api().post(`/api/employees/${employeeId}/identity/scan`).set('Cookie', ceo).attach('front', jpeg('FRONT'), 'f.jpg').expect(403);
    await api().get(`/api/paperwork/${item.id}/file`).set('Cookie', ceo).expect(200);
  });

  it('deletes a document, keeping a record of it in the audit log', async () => {
    const item = await upload(png('NONE'), 'old.png', 'other');
    await api().delete(`/api/paperwork/${item.id}`).set('Cookie', hr).expect(204);
    await api().get(`/api/paperwork/${item.id}/file`).set('Cookie', hr).expect(404);
    await api().delete(`/api/paperwork/${item.id}`).set('Cookie', hr).expect(404);
    const audit = await auditOf(item.id);
    expect(audit.map((a) => a.action)).toEqual(['create', 'delete']);
    expect(audit[1].diff).toEqual({ employeeId, kind: 'other', fileName: 'old.png', sizeBytes: png('NONE').length });
  });

  describe('search', () => {
    it('finds a document by its Arabic text, whatever the hamza, ta marbuta, tatweel, diacritics or digits', async () => {
      const receipt = await upload(jpeg('RECEIPT'), 'receipt.jpg', 'other');
      const res = await api()
        .get('/api/paperwork/search')
        .query({ q: ` اقرار  استلام العهده رقم ${RUN} ` })
        .set('Cookie', ceo)
        .expect(200);
      const hit = res.body.find((r: { item: { id: string } }) => r.item.id === receipt.id);
      expect(hit).toEqual({
        item: { ...receipt, uploadedBy: { email: hrEmail } },
        employee: { id: employeeId, employeeCode: expect.stringMatching(/^EMP-/), fullNameEn: `Paper Trail ${RUN}` },
        snippet: expect.stringContaining(`إقـرار اسْتلام العُهدة رقم ${arabicDigits(RUN)}`),
      });
      expect(Object.keys(hit.item).sort()).toEqual(['fileName', 'id', 'kind', 'mimeType', 'ocrStatus', 'sizeBytes', 'uploadedAt', 'uploadedBy']);

      const typedOtherwise = await api().get('/api/paperwork/search').query({ q: `العُهدة رقم ${arabicDigits(RUN)}` }).set('Cookie', hr).expect(200);
      expect(typedOtherwise.body.map((r: { item: { id: string } }) => r.item.id)).toContain(receipt.id);
    });

    it('leaves national ID scans out, so their text is never shown or logged as a view', async () => {
      const card = await upload(png('ID_BACK'), 'back.png', 'national_id_back');
      const res = await api().get('/api/paperwork/search').query({ q: `ملف ${RUN}٧` }).set('Cookie', hr).expect(200);
      expect(res.body).toEqual([]);
      const audit = await auditOf(card.id);
      expect(audit.map((a) => a.action)).toEqual(['create']);
    });

    it('needs at least 2 characters, and treats % and _ as plain characters', async () => {
      await api().get('/api/paperwork/search').query({ q: 'ا' }).set('Cookie', hr).expect(400);
      await api().get('/api/paperwork/search').query({ q: 'ـــ ً' }).set('Cookie', hr).expect(400); // nothing left once normalised
      await api().get('/api/paperwork/search').set('Cookie', hr).expect(400);
      const wild = await api().get('/api/paperwork/search').query({ q: '%_' }).set('Cookie', hr).expect(200);
      expect(wild.body).toEqual([]);
    });
  });

  describe('reading a national ID card', () => {
    it('keeps both photos in the employee file and suggests what the card says, without changing the employee', async () => {
      const res = await api()
        .post(`/api/employees/${employeeId}/identity/scan`)
        .set('Cookie', hr)
        .attach('front', jpeg('FRONT'), 'front.jpg')
        .attach('back', png('BACK'), 'back.png')
        .expect(200);
      expect(res.body).toEqual({
        suggestions: {
          nationalId: '29503120123456',
          dateOfBirth: '1995-03-12',
          fullNameAr: 'محمد أحمد محمود عبد الله',
          addressAr: '١٥ شارع مكرم عبيد، أول مدينة نصر - القاهرة',
          gender: 'male',
          issueDate: '2020-07-01',
          expiryDate: '2027-07-11',
          issuingOffice: 'سجل مدني مدينة نصر',
        },
        front: { itemId: expect.any(String), text: FRONT },
        back: { itemId: expect.any(String), text: BACK },
      });

      const list = await api().get(`/api/employees/${employeeId}/paperwork`).set('Cookie', hr).expect(200);
      const stored = list.body.filter((i: { id: string }) => [res.body.front.itemId, res.body.back.itemId].includes(i.id));
      expect(stored.map((i: { kind: string; ocrStatus: string }) => [i.kind, i.ocrStatus]).sort()).toEqual([
        ['national_id_back', 'done'],
        ['national_id_front', 'done'],
      ]);

      // nothing about the employee changed: HR saves the suggestions through the identity form
      const identity = await api().get(`/api/employees/${employeeId}/identity`).set('Cookie', hr).expect(200);
      expect(identity.body.nationalId).toBeNull();
      const profile = await api().get(`/api/employees/${employeeId}`).set('Cookie', hr).expect(200);
      expect(profile.body).toMatchObject({ dateOfBirth: null, gender: null, addressAr: null });

      // the uploads are logged, but never the number or the text
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'paperwork', entityId: { in: [res.body.front.itemId, res.body.back.itemId] } } });
      expect(audit.map((a) => a.action)).toEqual(['create', 'create']);
      expect(JSON.stringify(audit.map((a) => a.diff))).not.toMatch(/29503120123456|مكرم/);
    });

    it('needs the front; the back is optional', async () => {
      const res = await api().post(`/api/employees/${employeeId}/identity/scan`).set('Cookie', hr).attach('back', png('BACK'), 'b.png').expect(400);
      expect(res.body.message).toBe('Choose a photo of the front of the ID card.');
      const fake = await api()
        .post(`/api/employees/${employeeId}/identity/scan`)
        .set('Cookie', hr)
        .attach('front', Buffer.from('not an image'), 'front.jpg')
        .expect(400);
      expect(fake.body.message).toBe('The photo of the front must be a JPEG, PNG or WebP image, or a PDF.');

      const front = await api().post(`/api/employees/${employeeId}/identity/scan`).set('Cookie', hr).attach('front', jpeg('FRONT'), 'f.jpg').expect(200);
      expect(front.body).not.toHaveProperty('back');
      expect(front.body.suggestions).toMatchObject({ nationalId: '29503120123456', fullNameAr: 'محمد أحمد محمود عبد الله' });
    });
  });

  describe('when the OCR service is down or fails', () => {
    let down: INestApplication<App>;
    const apiDown = () => request(down.getHttpServer());

    beforeAll(async () => {
      process.env.OCR_URL = await deadUrl();
      ({ app: down } = await createApp());
    });

    afterAll(async () => {
      await down.close();
    });

    it('still stores documents, marked "unavailable" or "failed", and reads them again later', async () => {
      const unread = await upload(pdf('RECEIPT'), 'later.pdf', 'other', down);
      expect(unread.ocrStatus).toBe('unavailable');
      const failed = await upload(png('FAIL'), 'broken.png', 'other');
      expect(failed.ocrStatus).toBe('failed');
      expect((await api().get(`/api/paperwork/${unread.id}/text`).set('Cookie', hr).expect(200)).body).toEqual({ ocrStatus: 'unavailable', ocrText: null });

      const reread = await api().post(`/api/paperwork/${unread.id}/ocr`).set('Cookie', hr).expect(200);
      expect(reread.body).toMatchObject({ id: unread.id, ocrStatus: 'done' });
      expect((await auditOf(unread.id)).at(-1)).toMatchObject({ action: 'update', diff: { ocrStatus: { from: 'unavailable', to: 'done' } } });

      // a failed read never loses text read earlier
      const res = await apiDown().post(`/api/paperwork/${unread.id}/ocr`).set('Cookie', hr).expect(503);
      expect(res.body.message).toBe('The OCR service is not running. The text read earlier is kept.');
      expect((await api().get(`/api/paperwork/${unread.id}/text`).set('Cookie', hr).expect(200)).body).toEqual({ ocrStatus: 'done', ocrText: RECEIPT });
    });

    it('keeps the ID card photos but answers 503 when the card cannot be read', async () => {
      const before = await prisma.paperworkItem.count({ where: { employeeId, kind: { in: ['national_id_front', 'national_id_back'] } } });
      const res = await apiDown()
        .post(`/api/employees/${employeeId}/identity/scan`)
        .set('Cookie', hr)
        .attach('front', jpeg('FRONT'), 'front.jpg')
        .attach('back', png('BACK'), 'back.png')
        .expect(503);
      expect(res.body.message).toBe(
        'Reading ID cards is not available right now: the OCR service is not running. The photos were saved in the employee file.',
      );
      const kept = await prisma.paperworkItem.findMany({
        where: { employeeId, kind: { in: ['national_id_front', 'national_id_back'] } },
        orderBy: { uploadedAt: 'desc' },
        take: 2,
        select: { kind: true, ocrStatus: true },
      });
      expect(await prisma.paperworkItem.count({ where: { employeeId, kind: { in: ['national_id_front', 'national_id_back'] } } })).toBe(before + 2);
      expect(kept.map((k) => k.ocrStatus)).toEqual(['unavailable', 'unavailable']);

      const failed = await api().post(`/api/employees/${employeeId}/identity/scan`).set('Cookie', hr).attach('front', jpeg('FAIL'), 'f.jpg').expect(502);
      expect(failed.body.message).toBe('The OCR service could not read the ID card. The photos were saved in the employee file.');
    });
  });
});
