import type { INestApplication } from '@nestjs/common';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Adjusting paperwork in the browser (cropping, straightening …): the pages of a photo or PDF as pictures
// (POST /paperwork/prepare), and a stored paper's file replaced by the adjusted one (PUT /paperwork/:itemId/file).

const RUN = String(Date.now()).slice(-8);

// Real pictures (made with sharp): a 4 × 2 JPEG and a 1 × 1 PNG. Test files carry a mark ("MARK:PAGES2" …) after
// their data, which tells the fake OCR service below what to answer; they are still JPEG, PNG or PDF by their content.
const JPEG_4X2 =
  '/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKABiz//2Q==';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const png = (mark: string) => Buffer.concat([PNG, Buffer.from(`MARK:${mark}`)]);

/** The JPEG, its EXIF orientation 6 (a phone held upright: the picture is stored lying on its side), and the mark. */
function jpeg(mark: string): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10); // orientation, a SHORT
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(6, 18);
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.from([0xff, 0xe1, 0, exif.length + 2]);
  const data = Buffer.from(JPEG_4X2, 'base64');
  return Buffer.concat([data.subarray(0, 2), app1, exif, data.subarray(2), Buffer.from(`MARK:${mark}`)]);
}

/** A PDF of so many pages (catalog, page tree and pages), with the mark in a comment. */
function pdf(pages: number, mark: string): Buffer {
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    ...Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>'),
  ];
  let body = `%PDF-1.4\n% MARK:${mark}\n`;
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  const rows = offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${rows}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** The pages the fake OCR service shows: each the JPEG, 1000, 1001 … px wide, so their order can be told. */
const shownPage = (i: number) => ({ image: JPEG_4X2, width: 1000 + i, height: 1400 });

interface FakeOcr {
  url: string;
  calls: string[];
  texts: Record<string, string>;
  /** Holds the answer to /read for MARK:SLOW until released. */
  hold: () => () => void;
  close: () => Promise<void>;
}

/**
 * A stand-in for services/ocr. POST /cards: MARK:PAGESn shows n pages (one otherwise), MARK:FAIL answers 500. POST
 * /read: the text for the file's mark.
 */
async function fakeOcr(texts: Record<string, string>): Promise<FakeOcr> {
  const calls: string[] = [];
  let held: Promise<void> = Promise.resolve();
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://ocr');
      if (req.method !== 'POST' || !['/cards', '/read'].includes(url.pathname)) return void res.writeHead(404).end();
      calls.push(url.pathname);
      const mark = /MARK:(\w+)/.exec(Buffer.concat(chunks).toString('latin1'))?.[1] ?? '';
      if (mark === 'FAIL') return void res.writeHead(500).end('Internal Server Error');
      const json = (body: object) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (url.pathname === '/cards') {
        const pages = Array.from({ length: Number(/^PAGES(\d+)$/.exec(mark)?.[1] ?? 1) }, (_, i) => shownPage(i));
        return void json({ pages, cards: [] });
      }
      const text = texts[mark] ?? 'مستند';
      const answer = () => json({ lang: 'ar', pages: [{ lines: [{ text, confidence: 0.9, box: [0, 0, 100, 20] }] }], text });
      if (mark === 'SLOW') void held.then(answer);
      else answer();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    texts,
    hold: () => {
      let release!: () => void;
      held = new Promise((resolve) => (release = resolve));
      return release;
    },
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

const OLD_TEXT = `شهادة ميلاد قديمة ${RUN}`;
const NEW_TEXT = `شهادة ميلاد بعد القص ${RUN}`;
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('Adjusting paperwork (e2e)', () => {
  const ocrUrlBefore = process.env.OCR_URL;
  let ocr: FakeOcr;
  let app: INestApplication<App>;
  let down: INestApplication<App>; // the same API with the OCR service not running
  let prisma: PrismaService;
  let hrEmail: string;
  let hrId: string;
  let hr: string;
  let ceo: string;
  let finance: string;
  let employeeId: string;
  const api = (target = app) => request(target.getHttpServer());

  beforeAll(async () => {
    ocr = await fakeOcr({ OLDTEXT: OLD_TEXT, NEWTEXT: NEW_TEXT, SLOW: NEW_TEXT });
    process.env.OCR_URL = ocr.url;
    ({ app, prisma } = await createApp());
    process.env.OCR_URL = await deadUrl();
    ({ app: down } = await createApp());
    hrEmail = await createUser(prisma, ['hr']);
    hrId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail }, select: { id: true } })).id;
    hr = await signIn(app, hrEmail);
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    const e = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `Cropped Paper ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    employeeId = e.body.id;
  });

  afterAll(async () => {
    await app.close();
    await down.close();
    await ocr.close();
    if (ocrUrlBefore === undefined) delete process.env.OCR_URL;
    else process.env.OCR_URL = ocrUrlBefore;
  });

  describe('the pages of a photo or PDF, for adjusting', () => {
    const prepare = (session = hr, target = app) => api(target).post('/api/paperwork/prepare').set('Cookie', session);

    it('gives a PNG photo as one JPEG page, made by the OCR service, storing and logging nothing', async () => {
      const stored = () => prisma.paperworkItem.count({ where: { uploadedById: hrId } });
      const logged = () => prisma.auditLog.count({ where: { userId: hrId } });
      const [storedBefore, loggedBefore, calls] = [await stored(), await logged(), ocr.calls.length];

      const res = await prepare().attach('file', png('PHOTO'), 'certificate.png').expect(200);
      expect(res.body).toEqual({ pages: [shownPage(0)] });
      expect(Buffer.from(res.body.pages[0].image, 'base64').subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff])); // a JPEG
      expect(ocr.calls.slice(calls)).toEqual(['/cards']);

      expect(await stored()).toBe(storedBefore);
      expect(await logged()).toBe(loggedBefore);
    });

    it('gives a JPEG photo back as it is, sized as shown upright, without the OCR service', async () => {
      const calls = ocr.calls.length;
      const photo = jpeg('PHOTO');
      const res = await prepare().attach('file', photo, 'phone.jpg').expect(200);
      // stored 4 × 2 on its side; browsers show it upright by its EXIF orientation, 2 × 4
      expect(res.body).toEqual({ pages: [{ image: photo.toString('base64'), width: 2, height: 4 }] });
      expect(ocr.calls.length).toBe(calls);
    });

    it('gives every page of a PDF, in order, rendered by the OCR service', async () => {
      const two = await prepare().attach('file', pdf(2, 'PAGES2'), 'certificate.pdf').expect(200);
      expect(two.body).toEqual({ pages: [shownPage(0), shownPage(1)] });
      const one = await prepare().attach('file', pdf(1, 'PAGES1'), 'one.pdf').expect(200);
      expect(one.body).toEqual({ pages: [shownPage(0)] });
    });

    it('refuses a PDF whose pages cannot all be shown, rather than show only some of them', async () => {
      const calls = ocr.calls.length;
      // the OCR service shows a PDF's first 2 pages: a longer PDF is refused before it is sent
      const three = await prepare().attach('file', pdf(3, 'PAGES2'), 'long.pdf').expect(400);
      expect(three.body.message).toBe('Only PDFs of up to 2 pages can be adjusted for now; this one has 3.');
      const long = await prepare().attach('file', pdf(25, 'PAGES2'), 'long.pdf').expect(400);
      expect(long.body.message).toBe('Only PDFs of up to 2 pages can be adjusted for now; this one has 25.');
      expect(ocr.calls.length).toBe(calls);

      // a PDF whose page count cannot be told: as many pages as the service shows may not be all of them
      const unknown = await prepare().attach('file', Buffer.from('%PDF-1.4\n% MARK:PAGES2\n%%EOF\n'), 'odd.pdf').expect(400);
      expect(unknown.body.message).toBe('Only PDFs of up to 2 pages can be adjusted for now; this one may have more.');
      const fewer = await prepare().attach('file', Buffer.from('%PDF-1.4\n% MARK:PAGES1\n%%EOF\n'), 'odd.pdf').expect(200);
      expect(fewer.body.pages).toHaveLength(1);

      // fewer pages shown than the PDF has
      const missing = await prepare().attach('file', pdf(2, 'PAGES1'), 'two.pdf').expect(502);
      expect(missing.body.message).toBe("The PDF's pages could not be shown: it may be damaged or protected by a password. Try again, or upload a photo.");
    });

    it('is for HR only, and takes a photo or a PDF of up to 10 MB', async () => {
      await prepare(ceo).attach('file', png('PHOTO'), 'a.png').expect(403);
      await prepare(finance).attach('file', png('PHOTO'), 'a.png').expect(403);
      await api().post('/api/paperwork/prepare').attach('file', png('PHOTO'), 'a.png').expect(401);

      const text = await prepare().attach('file', Buffer.from('just some text'), { filename: 'scan.pdf', contentType: 'application/pdf' }).expect(400);
      expect(text.body.message).toBe('The file must be a JPEG, PNG or WebP image, or a PDF.');
      expect((await prepare().expect(400)).body.message).toBe('Choose a photo or PDF to adjust.');
      const big = await prepare().attach('file', Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]), 'big.png').expect(413);
      expect(big.body.message).toBe('Each file must be 10 MB or smaller.');
    });

    it('cannot show a PDF while the OCR service is down (503) or failing (502), but still gives a photo', async () => {
      const pdfDown = await prepare(hr, down).attach('file', pdf(1, 'PAGES1'), 'certificate.pdf').expect(503);
      expect(pdfDown.body.message).toBe("PDF pages can't be shown right now; try again in a minute, or upload a photo.");
      const failed = await prepare().attach('file', pdf(1, 'FAIL'), 'certificate.pdf').expect(502);
      expect(failed.body.message).toBe("The PDF's pages could not be shown: it may be damaged or protected by a password. Try again, or upload a photo.");

      const photo = jpeg('PHOTO');
      const jpegDown = await prepare(hr, down).attach('file', photo, 'phone.jpg').expect(200);
      expect(jpegDown.body).toEqual({ pages: [{ image: photo.toString('base64'), width: 2, height: 4 }] });
      // a PNG cannot be made a JPEG without the service: it comes back as it is
      const pngDown = await prepare(hr, down).attach('file', png('PHOTO'), 'scan.png').expect(200);
      expect(pngDown.body).toEqual({ pages: [{ image: png('PHOTO').toString('base64'), width: 1, height: 1 }] });
    });
  });

  describe('replacing the file of a stored paper', () => {
    const replace = (itemId: string, session = hr, target = app) => api(target).put(`/api/paperwork/${itemId}/file`).set('Cookie', session);
    const auditOf = (itemId: string) => prisma.auditLog.findMany({ where: { entityType: 'paperwork', entityId: itemId }, orderBy: { id: 'asc' } });

    async function upload(file: Buffer, fileName: string, kind: string, fields: Record<string, string> = {}) {
      let req = api().post(`/api/employees/${employeeId}/paperwork`).set('Cookie', hr).field('kind', kind);
      for (const [name, value] of Object.entries(fields)) req = req.field(name, value);
      const res = await req.attach('file', file, fileName).expect(201);
      return res.body as { id: string; fileName: string; uploadedAt: string; [key: string]: unknown };
    }

    it('replaces the file, keeping its kind, number and expiry, and reads the new file’s text', async () => {
      const paper = await upload(pdf(1, 'OLDTEXT'), 'شهادة الميلاد.pdf', 'birth_certificate', { documentNo: `BC-${RUN}`, expiresOn: '2030-01-31' });
      expect(paper).toMatchObject({ ocrStatus: 'done', fileName: 'شهادة الميلاد.pdf' });
      const adjusted = jpeg('NEWTEXT');
      const calls = ocr.calls.length;

      const res = await replace(paper.id).attach('file', adjusted, 'blob').expect(200);
      expect(res.body).toEqual({
        id: paper.id,
        kind: 'birth_certificate',
        fileName: 'شهادة الميلاد-adjusted.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: adjusted.length,
        ocrStatus: 'done',
        uploadedAt: paper.uploadedAt, // still when it was first uploaded, and by whom
        uploadedBy: { email: hrEmail },
        documentNo: `BC-${RUN}`,
        expiresOn: '2030-01-31',
      });
      expect(ocr.calls.slice(calls)).toEqual(['/read']);

      // exactly as the paperwork list shows it
      const list = await api().get(`/api/employees/${employeeId}/paperwork`).set('Cookie', hr).expect(200);
      expect(list.body.find((i: { id: string }) => i.id === paper.id)).toEqual(res.body);

      const file = await api().get(`/api/paperwork/${paper.id}/file`).set('Cookie', ceo).expect(200);
      expect(file.headers['content-type']).toBe('image/jpeg');
      expect(file.headers['content-disposition']).toContain(encodeURIComponent('شهادة الميلاد-adjusted.jpg'));
      expect(Buffer.compare(file.body as Buffer, adjusted)).toBe(0);
      const text = await api().get(`/api/paperwork/${paper.id}/text`).set('Cookie', hr).expect(200);
      expect(text.body).toEqual({ ocrStatus: 'done', ocrText: NEW_TEXT });

      const audit = await auditOf(paper.id);
      expect(audit.map((a) => a.action)).toEqual(['create', 'update']);
      expect(audit[1].userId).toBe(hrId);
      expect(audit[1].diff).toEqual({ employeeId, file: 'replaced', fileName: 'شهادة الميلاد-adjusted.jpg', sizeBytes: adjusted.length });
    });

    it('keeps a name that says something, and never adds "-adjusted" twice', async () => {
      const paper = await upload(png('OLDTEXT'), 'Qualification.png', 'qualification_certificate');
      const first = await replace(paper.id).attach('file', jpeg('NEWTEXT'), 'image.jpg').expect(200);
      expect(first.body.fileName).toBe('Qualification-adjusted.jpg');
      const again = await replace(paper.id).attach('file', jpeg('NEWTEXT'), 'blob').expect(200);
      expect(again.body.fileName).toBe('Qualification-adjusted.jpg');
      const named = await replace(paper.id).attach('file', pdf(2, 'NEWTEXT'), 'Qualification, both sides.pdf').expect(200);
      expect(named.body).toMatchObject({ fileName: 'Qualification, both sides.pdf', mimeType: 'application/pdf', sizeBytes: pdf(2, 'NEWTEXT').length });
    });

    it('reads the text again as for a new upload: pending, then the OCR service, or "unavailable" when it is down', async () => {
      const paper = await upload(pdf(1, 'OLDTEXT'), 'record.pdf', 'criminal_record');

      // while the OCR service reads the new file, the paper is "pending"
      const release = ocr.hold();
      const replacing = replace(paper.id).attach('file', jpeg('SLOW'), 'blob').then((res) => res);
      let during: { ocrStatus: string; fileName: string } | null = null;
      for (let i = 0; i < 100 && during?.fileName !== 'record-adjusted.jpg'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        during = await prisma.paperworkItem.findUnique({ where: { id: paper.id }, select: { ocrStatus: true, fileName: true } });
      }
      expect(during).toEqual({ ocrStatus: 'pending', fileName: 'record-adjusted.jpg' });
      release();
      expect((await replacing).body).toMatchObject({ ocrStatus: 'done' });

      // the OCR service is down: the file is replaced all the same, and the old text goes with the old file
      const res = await replace(paper.id, hr, down).attach('file', jpeg('NEWTEXT'), 'blob').expect(200);
      expect(res.body).toMatchObject({ ocrStatus: 'unavailable', fileName: 'record-adjusted.jpg' });
      expect((await api().get(`/api/paperwork/${paper.id}/text`).set('Cookie', hr).expect(200)).body).toEqual({ ocrStatus: 'unavailable', ocrText: null });
    });

    it('lets HR, and only HR, replace a national ID scan, which is not a view of it', async () => {
      const card = await upload(png('OLDTEXT'), 'بطاقة.png', 'national_id_front', { documentNo: 'AB123456' });
      await replace(card.id, ceo).attach('file', jpeg('NEWTEXT'), 'blob').expect(403);
      const res = await replace(card.id).attach('file', jpeg('NEWTEXT'), 'blob').expect(200);
      expect(res.body).toMatchObject({ kind: 'national_id_front', fileName: 'بطاقة-adjusted.jpg', documentNo: 'AB123456' });
      const audit = await auditOf(card.id);
      expect(audit.map((a) => a.action)).toEqual(['create', 'update']);
      expect(JSON.stringify(audit.map((a) => a.diff))).not.toContain('AB123456');
    });

    it('answers 404 for an unknown paper and 403 for anyone but HR, and leaves the paper alone on a bad file', async () => {
      const paper = await upload(png('OLDTEXT'), 'letter.png', 'other');
      expect((await replace(UNKNOWN).attach('file', jpeg('NEWTEXT'), 'blob').expect(404)).body.message).toBe('Document not found.');
      await replace('not-a-uuid').attach('file', jpeg('NEWTEXT'), 'blob').expect(400);
      await replace(paper.id, ceo).attach('file', jpeg('NEWTEXT'), 'blob').expect(403);
      await replace(paper.id, finance).attach('file', jpeg('NEWTEXT'), 'blob').expect(403);
      await api().put(`/api/paperwork/${paper.id}/file`).attach('file', jpeg('NEWTEXT'), 'blob').expect(401);

      const text = await replace(paper.id).attach('file', Buffer.from('not an image'), 'adjusted.jpg').expect(400);
      expect(text.body.message).toBe('The file must be a JPEG, PNG or WebP image, or a PDF.');
      expect((await replace(paper.id).expect(400)).body.message).toBe('Choose the adjusted file to upload.');
      await replace(paper.id).attach('file', Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]), 'big.png').expect(413);

      const file = await api().get(`/api/paperwork/${paper.id}/file`).set('Cookie', hr).expect(200);
      expect(Buffer.compare(file.body as Buffer, png('OLDTEXT'))).toBe(0);
      expect((await auditOf(paper.id)).map((a) => a.action)).toEqual(['create']);
    });
  });
});
