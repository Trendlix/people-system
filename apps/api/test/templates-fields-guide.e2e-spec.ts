import type { INestApplication } from '@nestjs/common';
import { TEMPLATE_TAGS, type Role } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { shownDate, todayInCairo } from '../src/common/date-only.js';
import { PdfService } from '../src/pdf/pdf.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { paragraphTexts, readDocx } from '../src/templates/docx-tags.js';
import { readZip } from '../src/templates/zip.js';
import { createApp, createUser, signIn } from './helpers.js';

// The Fields Guide (owner's request, 15 October 2026: "Prepare a document with the mapping fields … where I can get it
// from the Templates page side menu"): every tag and template as a Word file, or a PDF once the server has a
// converter, for anyone who may read the tag list.

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Reads a response body as bytes, whatever its type. */
const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

describe('Templates: the Fields Guide (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const cookies = {} as Record<Role, string>;
  const api = () => request(app.getHttpServer());
  const guide = (cookie: string, query = '') => api().get(`/api/templates/fields-guide${query}`).set('Cookie', cookie).buffer(true).parse(bytes);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    for (const role of ['hr', 'admin', 'super_admin', 'ceo', 'finance', 'manager', 'employee'] as const) {
      cookies[role] = await signIn(app, await createUser(prisma, [role]));
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('downloads as a Word file with every tag, the company’s name and today’s date', async () => {
    const res = await guide(cookies.hr).expect(200);
    expect(res.headers['content-type']).toBe(DOCX);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="Template Fields Guide.docx"; filename*=UTF-8''Template%20Fields%20Guide.docx`);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');

    const file = res.body as Buffer;
    const reading = readDocx(file);
    expect([...reading.tags].sort()).toEqual(TEMPLATE_TAGS.map((t) => t.tag).sort());
    expect([reading.unknownTags, reading.broken]).toEqual([[], []]);
    const company = await prisma.company.findUniqueOrThrow({ where: { id: 1 } });
    const texts = paragraphTexts(readZip(file).read('word/document.xml')!.toString('utf8'));
    expect(texts.slice(0, 3)).toEqual(['Template Fields Guide', 'دليل حقول القوالب', `${company.nameEn} · ${shownDate(todayInCairo())}`]);
    expect(texts).toContain('How to Use the Fields');
    expect(texts).toContain('Templates in the Library');

    // ?format=docx is the same file
    const docx = await guide(cookies.hr, '?format=docx').expect(200);
    expect(Buffer.compare(docx.body as Buffer, file)).toBe(0);
  });

  it('is for everyone signed in, as the tag list is; not without a session', async () => {
    for (const [role, cookie] of Object.entries(cookies)) {
      const res = await guide(cookie);
      expect(res.status, role).toBe(200);
      expect(res.headers['content-type'], role).toBe(DOCX);
    }
    await api().get('/api/templates/fields-guide').expect(401);
  });

  it('as a PDF: refused (409) without a converter, then shown in the browser', async () => {
    const refused = await api().get('/api/templates/fields-guide?format=pdf').set('Cookie', cookies.employee).expect(409);
    expect(refused.body.message).toMatch(/^The PDF converter isn't set up/);

    const convert = vi.spyOn(app.get(PdfService), 'fromDocx').mockResolvedValue(Buffer.from('%PDF-1.7 guide'));
    try {
      const shown = await guide(cookies.ceo, '?format=pdf').expect(200);
      expect(shown.headers['content-type']).toBe('application/pdf');
      expect(shown.headers['content-disposition']).toBe(`inline; filename="Template Fields Guide.pdf"; filename*=UTF-8''Template%20Fields%20Guide.pdf`);
      expect((shown.body as Buffer).toString()).toBe('%PDF-1.7 guide');
      expect(convert).toHaveBeenCalledTimes(1);
      const [sent, name] = convert.mock.calls[0];
      expect(name).toBe('Template Fields Guide.docx');
      expect(readDocx(Buffer.from(sent)).tags.length).toBe(TEMPLATE_TAGS.length);
    } finally {
      convert.mockRestore();
    }
  });

  it('refuses a format it doesn’t make', async () => {
    const res = await api().get('/api/templates/fields-guide?format=odt').set('Cookie', cookies.hr).expect(400);
    expect(res.body.message).toBe('Choose the format: pdf or docx.');
  });
});
