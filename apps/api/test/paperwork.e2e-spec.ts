import type { INestApplication } from '@nestjs/common';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Unique per run, because the test database keeps data from earlier runs.
const RUN = String(Date.now()).slice(-8);
const arabicDigits = (s: string) => s.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
// digits as Arabic letters (0 → ب …), for a word unique to this run
const arabicLetters = (s: string) => s.replace(/\d/g, (d) => 'بتثجحخدذرز'[Number(d)]);

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
// What FRONT and BACK give.
const SUGGESTIONS = {
  nationalId: '29503120123456',
  dateOfBirth: '1995-03-12',
  fullNameAr: 'محمد أحمد محمود عبد الله',
  addressAr: '١٥ شارع مكرم عبيد، أول مدينة نصر - القاهرة',
  gender: 'male',
  issueDate: '2020-07-01',
  expiryDate: '2027-07-11',
  issuingOffice: 'سجل مدني مدينة نصر',
};

interface FakeOcr {
  url: string;
  calls: { lang: string | null }[];
  /** What each mark reads as; tests may add marks. */
  texts: Record<string, string>;
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
      if (req.method === 'POST' && url.pathname === '/cards') {
        cardsAnswer(Buffer.concat(chunks), res);
        return;
      }
      if (req.method !== 'POST' || url.pathname !== '/read') return void res.writeHead(404).end();
      const lang = url.searchParams.get('lang');
      calls.push({ lang });
      const mark = /MARK:(\w+)/.exec(Buffer.concat(chunks).toString('latin1'))?.[1] ?? '';
      if (mark === 'FAIL') return void res.writeHead(500).end('Internal Server Error');
      const text = texts[mark] ?? 'مستند';
      // pages are separated by \f, as services/ocr does
      const pages = text.split('\f').map((page) => ({
        lines: page.split('\n').map((line, i) => ({ text: line, confidence: 0.93, box: [10, i * 30, 400, i * 30 + 24] })),
      }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ lang, pages, text }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    texts,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const box = (cy: number, angle: number) => ({ cx: 500, cy, w: 704, h: 444, angle });
/** The fake /cards: MARK:TWOCARDS is a page with the back above the front, MARK:NOCARD a page without a card. */
function cardsAnswer(body: Buffer, res: ServerResponse) {
  const mark = /MARK:(\w+)/.exec(body.toString('latin1'))?.[1] ?? '';
  if (mark === 'FAIL') {
    res.writeHead(500).end('Internal Server Error');
    return;
  }
  const page = { width: 1000, height: 1400, image: Buffer.from(`PAGE:${mark}`).toString('base64') };
  const cards =
    mark === 'TWOCARDS'
      ? [
          { page: 0, box: box(300, -2.5), image: Buffer.from('BACK').toString('base64'), side: 'back', confidence: 0.94 },
          { page: 0, box: box(1000, 1.2), image: Buffer.from('FRONT').toString('base64'), side: 'front', confidence: 0.97 },
        ]
      : mark === 'NOCARD'
        ? []
        : [{ page: 0, box: box(700, 0.4), image: Buffer.from(`CARD:${mark}`).toString('base64'), side: null, confidence: 0.5 }];
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ pages: [page], cards }));
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
    ocr = await fakeOcr({ FRONT, BACK, RECEIPT, ID_BACK, BOTHSIDES: `${FRONT}\f${BACK}` });
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
      .send({ fullNameEn: `Paper Trail ${RUN}`, fullNameAr: 'موظف تجريبي' })
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
      documentNo: null,
      expiresOn: null,
    });
    expect(ocr.calls.at(-1)).toEqual({ lang: 'ar' });
    const photo = await upload(png('NONE'), 'photo.png', 'personal_photo');

    const list = await api().get(`/api/employees/${employeeId}/paperwork`).set('Cookie', ceo).expect(200);
    expect(list.body.slice(0, 2).map((i: { id: string }) => i.id)).toEqual([photo.id, form.id]);
    expect(Object.keys(list.body[0]).sort()).toEqual(['documentNo', 'expiresOn', 'fileName', 'id', 'kind', 'mimeType', 'ocrStatus', 'sizeBytes', 'uploadedAt', 'uploadedBy']);

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

  describe('the number printed on a paper and when it expires', () => {
    const post = () => api().post(`/api/employees/${employeeId}/paperwork`).set('Cookie', hr);
    const describePaper = (itemId: string, body: object, session = hr) => api().patch(`/api/paperwork/${itemId}`).set('Cookie', session).send(body);

    it('keeps them with the upload, and lets HR change or clear them, logging only what changed', async () => {
      const res = await post()
        .field('kind', 'criminal_record')
        .field('documentNo', ` FS-${RUN} `)
        .field('expiresOn', '2026-12-31')
        .attach('file', png('NONE'), 'record.png')
        .expect(201);
      const itemId = (res.body as { id: string }).id;
      expect(res.body).toMatchObject({ kind: 'criminal_record', documentNo: `FS-${RUN}`, expiresOn: '2026-12-31' });

      const later = await describePaper(itemId, { expiresOn: '2027-06-30' }).expect(200);
      expect(later.body).toMatchObject({ id: itemId, kind: 'criminal_record', documentNo: `FS-${RUN}`, expiresOn: '2027-06-30' }); // the number stays
      const cleared = await describePaper(itemId, { documentNo: '' }).expect(200);
      expect(cleared.body).toMatchObject({ documentNo: null, expiresOn: '2027-06-30' });
      await describePaper(itemId, { expiresOn: '2027-06-30' }).expect(200); // nothing changes, so nothing is logged

      const list = await api().get(`/api/employees/${employeeId}/paperwork`).set('Cookie', ceo).expect(200);
      expect(list.body.find((i: { id: string }) => i.id === itemId)).toMatchObject({ documentNo: null, expiresOn: '2027-06-30' });

      const audit = await auditOf(itemId);
      expect(audit.map((a) => a.action)).toEqual(['create', 'update', 'update']);
      expect(audit[1].diff).toEqual({ employeeId, expiresOn: { from: '2026-12-31', to: '2027-06-30' } });
      expect(audit[2].diff).toEqual({ employeeId, documentNo: { from: `FS-${RUN}`, to: null } });
    });

    it('checks them, and only HR changes them', async () => {
      const before = await prisma.paperworkItem.count({ where: { employeeId } });
      await post().field('kind', 'other').field('expiresOn', '2026-02-30').attach('file', png('NONE'), 'x.png').expect(400);
      await post().field('kind', 'other').field('documentNo', 'x'.repeat(61)).attach('file', png('NONE'), 'x.png').expect(400);
      expect(await prisma.paperworkItem.count({ where: { employeeId } })).toBe(before);

      const item = await upload(png('NONE'), 'certificate.png', 'qualification_certificate');
      expect(item).toMatchObject({ documentNo: null, expiresOn: null });
      await describePaper(item.id, { expiresOn: '31/12/2026' }).expect(400);
      await describePaper(item.id, { kind: 'other' }).expect(400); // what kind of paper it is does not change here
      await describePaper(item.id, { documentNo: 'X' }, ceo).expect(403);
      await describePaper(item.id, { documentNo: 'X' }, finance).expect(403);
      await describePaper('00000000-0000-4000-8000-000000000000', { documentNo: 'X' }).expect(404);
      expect((await auditOf(item.id)).map((a) => a.action)).toEqual(['create']);
    });

    it('logs only that the number of a national ID scan changed, never the number', async () => {
      const card = await post().field('kind', 'national_id_front').field('documentNo', 'AB123456').attach('file', png('NONE'), 'card.png').expect(201);
      const itemId = (card.body as { id: string }).id;
      expect(card.body.documentNo).toBe('AB123456');
      const changed = await describePaper(itemId, { documentNo: 'CD654321', expiresOn: '2031-05-01' }).expect(200);
      expect(changed.body).toMatchObject({ documentNo: 'CD654321', expiresOn: '2031-05-01' });

      const audit = await auditOf(itemId);
      expect(audit.map((a) => a.action)).toEqual(['create', 'update']);
      expect(audit[1].diff).toEqual({ employeeId, documentNo: 'changed', expiresOn: { from: null, to: '2031-05-01' } });
      expect(JSON.stringify(audit.map((a) => a.diff))).not.toMatch(/AB123456|CD654321/);
    });
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
      expect(Object.keys(hit.item).sort()).toEqual(['documentNo', 'expiresOn', 'fileName', 'id', 'kind', 'mimeType', 'ocrStatus', 'sizeBytes', 'uploadedAt', 'uploadedBy']);

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
        suggestions: SUGGESTIONS,
        corrected: [],
        notes: [],
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
      expect(res.body.message).toBe('Choose a photo or PDF scan of the front of the ID card.');
      const fake = await api()
        .post(`/api/employees/${employeeId}/identity/scan`)
        .set('Cookie', hr)
        .attach('front', Buffer.from('not an image'), 'front.jpg')
        .expect(400);
      expect(fake.body.message).toBe('The front of the card must be a JPEG, PNG or WebP image, or a PDF.');

      const front = await api().post(`/api/employees/${employeeId}/identity/scan`).set('Cookie', hr).attach('front', jpeg('FRONT'), 'f.jpg').expect(200);
      expect(front.body).not.toHaveProperty('back');
      expect(front.body.suggestions).toMatchObject({ nationalId: '29503120123456', fullNameAr: 'محمد أحمد محمود عبد الله' });
    });
  });

  describe('reading the ID card of a new employee', () => {
    const readCard = (session = hr) => api().post('/api/employees/read-id-card').set('Cookie', session);

    it('suggests what the card says, storing nothing and logging nothing from the card', async () => {
      const { id: hrId } = await prisma.user.findUniqueOrThrow({ where: { email: hrEmail }, select: { id: true } });
      const stored = () => prisma.paperworkItem.count({ where: { uploadedById: hrId } });
      const logged = () => prisma.auditLog.count({ where: { userId: hrId } });
      const [storedBefore, loggedBefore, started] = [await stored(), await logged(), new Date()];
      const calls = ocr.calls.length;

      const res = await readCard().attach('front', jpeg('FRONT'), 'front.jpg').attach('back', png('BACK'), 'back.png').expect(200);
      expect(res.body).toEqual({ suggestions: SUGGESTIONS, corrected: [], notes: [], front: { text: FRONT }, back: { text: BACK } });
      expect(ocr.calls.slice(calls)).toEqual([{ lang: 'ar' }, { lang: 'ar' }]);

      expect(await stored()).toBe(storedBefore);
      expect(await logged()).toBe(loggedBefore);
      const since = await prisma.auditLog.findMany({ where: { at: { gte: started } }, select: { diff: true } });
      expect(JSON.stringify(since)).not.toContain('29503120123456');
    });

    it('reads a PDF scan with the front on page 1 and the back on page 2', async () => {
      const res = await readCard().attach('front', pdf('BOTHSIDES'), 'card.pdf').expect(200);
      expect(res.body.suggestions).toEqual(SUGGESTIONS);
      expect(res.body.front.text).toBe(FRONT);
      expect(res.body.back.text).toBe(BACK);
    });

    it('needs the front (a photo or a PDF scan); the back is optional', async () => {
      expect((await readCard().attach('back', png('BACK'), 'b.png').expect(400)).body.message).toBe('Choose a photo or PDF scan of the front of the ID card.');
      expect((await readCard().attach('front', jpeg('FRONT'), 'f.jpg').attach('back', Buffer.from('not an image'), 'b.png').expect(400)).body.message).toBe(
        'The back of the card must be a JPEG, PNG or WebP image, or a PDF.',
      );
      const big = await readCard()
        .attach('front', Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]), 'big.png')
        .expect(413);
      expect(big.body.message).toBe('Each file must be 10 MB or smaller.');

      const front = await readCard().attach('front', jpeg('FRONT'), 'f.jpg').expect(200);
      expect(front.body).toEqual({ suggestions: expect.objectContaining({ nationalId: '29503120123456' }), corrected: [], notes: [], front: { text: FRONT } });
    });

    it('is for HR only, and is not mistaken for an employee', async () => {
      await readCard(finance).attach('front', jpeg('FRONT'), 'f.jpg').expect(403);
      await readCard(ceo).attach('front', jpeg('FRONT'), 'f.jpg').expect(403);
      await readCard(staff).attach('front', jpeg('FRONT'), 'f.jpg').expect(403);
      await api().post('/api/employees/read-id-card').attach('front', jpeg('FRONT'), 'f.jpg').expect(401);
      await api().get('/api/employees/read-id-card').set('Cookie', hr).expect(400); // GET /employees/:id wants a UUID
    });
  });

  describe('finding the card on a scan', () => {
    const prepare = (session = hr) => api().post('/api/id-card/prepare').set('Cookie', session);

    it('finds both sides on one page, front first, storing and logging nothing', async () => {
      const { id: hrId } = await prisma.user.findUniqueOrThrow({ where: { email: hrEmail }, select: { id: true } });
      const logged = () => prisma.auditLog.count({ where: { userId: hrId } });
      const before = await logged();
      const res = await prepare().attach('front', pdf('TWOCARDS'), 'scan.pdf').expect(200);
      expect(res.body).toEqual({
        pages: [{ width: 1000, height: 1400, image: Buffer.from('PAGE:TWOCARDS').toString('base64') }],
        front: { image: Buffer.from('FRONT').toString('base64'), page: 0, box: box(1000, 1.2), recognised: 'front', confidence: 0.97 },
        back: { image: Buffer.from('BACK').toString('base64'), page: 0, box: box(300, -2.5), recognised: 'back', confidence: 0.94 },
        found: 2,
      });
      expect(await logged()).toBe(before);
    });

    it('takes the front and the back from two files, and says when a side is missing', async () => {
      const two = await prepare().attach('front', jpeg('ONE'), 'a.jpg').attach('back', png('TWO'), 'b.png').expect(200);
      expect(two.body.pages).toHaveLength(2);
      expect(two.body.front).toMatchObject({ page: 0, image: Buffer.from('CARD:ONE').toString('base64') });
      expect(two.body.back).toMatchObject({ page: 1, image: Buffer.from('CARD:TWO').toString('base64') });

      const none = await prepare().attach('front', jpeg('NOCARD'), 'a.jpg').expect(200);
      expect(none.body).toMatchObject({ front: null, back: null, found: 0 });
    });

    it('is for HR only', async () => {
      await prepare(finance).attach('front', jpeg('ONE'), 'a.jpg').expect(403);
      await prepare().expect(400);
    });
  });

  describe('learning from corrections', () => {
    // a misread word unique to this run, so what is learned here never changes other readings
    const misread = arabicLetters(RUN);
    const LEARN = FRONT.replace('١٥ شارع مكرم عبيد', `١٥ شارع ${misread} عبيد`);

    beforeAll(() => {
      ocr.texts.LEARN = LEARN;
    });

    it('learns the words HR corrected and fixes them in the next reading', async () => {
      const first = await api().post('/api/employees/read-id-card').set('Cookie', hr).attach('front', jpeg('LEARN'), 'f.jpg').expect(200);
      expect(first.body.suggestions.addressAr).toBe(`١٥ شارع ${misread} عبيد، أول مدينة نصر - القاهرة`);
      expect(first.body.corrected).toEqual([]);

      await api()
        .post('/api/id-card/corrections')
        .set('Cookie', finance)
        .send({ corrections: [] })
        .expect(403);
      const learned = await api()
        .post('/api/id-card/corrections')
        .set('Cookie', hr)
        .send({
          corrections: [
            { field: 'addressAr', read: first.body.suggestions.addressAr, saved: SUGGESTIONS.addressAr },
            { field: 'fullNameAr', read: SUGGESTIONS.fullNameAr, saved: SUGGESTIONS.fullNameAr }, // unchanged: nothing to learn
          ],
        })
        .expect(200);
      expect(learned.body).toEqual({ learned: 1 });

      const next = await api().post('/api/employees/read-id-card').set('Cookie', hr).attach('front', jpeg('LEARN'), 'f.jpg').expect(200);
      expect(next.body.suggestions.addressAr).toBe(SUGGESTIONS.addressAr);
      expect(next.body.corrected).toEqual(['addressAr']);

      const list = await api().get('/api/id-card/corrections').set('Cookie', hr).expect(200);
      const fix = list.body.find((c: { wrong: string }) => c.wrong === misread);
      expect(fix).toMatchObject({ field: 'addressAr', right: 'مكرم', timesSeen: 1 });

      // the log says how many, never the words
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'ocr_correction', action: 'learn' }, orderBy: { id: 'desc' } });
      expect(audit?.diff).toEqual({ fixes: 1 });

      await api().delete(`/api/id-card/corrections/${fix.id}`).set('Cookie', hr).expect(204);
      const after = await api().post('/api/employees/read-id-card').set('Cookie', hr).attach('front', jpeg('LEARN'), 'f.jpg').expect(200);
      expect(after.body.corrected).toEqual([]);
    });

    it('refuses fields that are never learned', async () => {
      await api()
        .post('/api/id-card/corrections')
        .set('Cookie', hr)
        .send({ corrections: [{ field: 'nationalId', read: '29503120123456', saved: '29503120123457' }] })
        .expect(400);
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

    it('answers 503 or 502 for a new employee’s ID card that cannot be read (no filling in by hand)', async () => {
      const down503 = await apiDown()
        .post('/api/employees/read-id-card')
        .set('Cookie', hr)
        .attach('front', jpeg('FRONT'), 'front.jpg')
        .attach('back', png('BACK'), 'back.png')
        .expect(503);
      expect(down503.body.message).toBe('Reading ID cards is not available right now: the OCR service is not running. Try again in a few minutes.');

      const failed = await api().post('/api/employees/read-id-card').set('Cookie', hr).attach('front', jpeg('FAIL'), 'f.jpg').expect(502);
      expect(failed.body.message).toBe('The OCR service could not read the ID card. Try again, or use a clearer scan.');

      // one side read is enough
      const half = await api().post('/api/employees/read-id-card').set('Cookie', hr).attach('front', jpeg('FAIL'), 'f.jpg').attach('back', png('BACK'), 'b.png').expect(200);
      expect(half.body).toMatchObject({ front: { text: null }, back: { text: BACK }, suggestions: { gender: 'male', expiryDate: '2027-07-11' } });
    });
  });
});
