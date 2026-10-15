import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { paragraphTexts, textParts } from '../src/templates/docx-tags.js';
import { readZip } from '../src/templates/zip.js';
import { docx, headerXml, p, r, realTemplate } from './fixtures/docx.js';
import { createApp, createUser, signIn } from './helpers.js';

// Map Fields (owner's request, 15 October 2026: "I want a manual mapping fix"): HR places, changes or removes tags in
// a template version inside the system; saving makes a new draft version, checked and published as usual, and the
// version mapped keeps its own file.

/** Reads a response body as bytes, whatever its type. */
const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

/** The printed text of a .docx, part by part. */
function partsOf(file: Buffer): Record<string, string[]> {
  const zip = readZip(file);
  return Object.fromEntries(textParts(zip.entries.map((e) => e.name)).map((name) => [name, paragraphTexts(zip.read(name)!.toString('utf8'))]));
}

interface Line {
  id: string;
  part: string;
  partLabel: string;
  index: number;
  text: string;
  tags: { tag: string; from: number; to: number; known: boolean }[];
  blanks: { from: number; to: number }[];
  suggestions: { tag: string; from: number; to: number; label: string; text: string }[];
}

// A bilingual NDA as typed for printing: labels in both languages with blanks to fill in by hand, a tag split over
// two runs, a tag the dictionary doesn't have, and a header.
const NDA = docx({
  body:
    p(r('اتفاقية عدم إفصاح / Non-Disclosure Agreement')) +
    p(r('الطرف الأول: '), r('شركة تريندليكس')) +
    p(r('الطرف الثاني: السيد/ '), r('......'), r('..........')) +
    p(r('Second Party: Mr. '), r('________________')) +
    p(r('الرقم القومي: '), r('{{national_'), r('id}}')) +
    p(r('Job Title: ..........')) +
    p(r('الوظيفة: ..........')) +
    p(r('Date:')) +
    p(r('الراتب: {{salary}}')) +
    '<w:p/>',
  parts: { 'word/header1.xml': headerXml(p(r('Ref:'))) },
});

describe('Template Map Fields (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let admin: string;
  let ceo: string;
  let employee: string;
  let hrEmail: string;
  let v1: string;
  const api = () => request(app.getHttpServer());

  const upload = (slot: string, file: Buffer, fileName: string, language?: string) => {
    const req = api().post(`/api/templates/${slot}/versions`).set('Cookie', hr).attach('file', file, fileName);
    return language ? req.field('language', language) : req;
  };
  const lines = async (id: string, cookie = hr): Promise<Line[]> => (await api().get(`/api/templates/versions/${id}/lines`).set('Cookie', cookie).expect(200)).body.lines;
  const map = (id: string, body: object, cookie = hr) => api().post(`/api/templates/versions/${id}/map`).set('Cookie', cookie).send(body);
  const refused = async (id: string, edits: object[]) => (await map(id, { edits }).expect(400)).body.message as string | string[];
  const download = async (id: string) => (await api().get(`/api/templates/versions/${id}/file`).set('Cookie', hr).buffer(true).parse(bytes).expect(200)).body as Buffer;
  const versions = (slotKey: string) => prisma.templateVersion.count({ where: { slotKey } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await prisma.generatedDocument.deleteMany();
    await prisma.templateVersion.deleteMany();
    hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    admin = await signIn(app, await createUser(prisma, ['admin']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    employee = await signIn(app, await createUser(prisma, ['employee']));
    v1 = (await upload('nda', NDA, 'NDA.docx', 'bilingual').expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the lines with text, their tags, blanks and suggested fields', async () => {
    const res = await api().get(`/api/templates/versions/${v1}/lines`).set('Cookie', hr).expect(200);
    expect(res.body).toMatchObject({ versionId: v1, version: 1, slotKey: 'nda', language: 'bilingual' });
    const all: Line[] = res.body.lines;
    expect(all.map((l) => [l.id, l.partLabel, l.index])).toEqual([
      ...Array.from({ length: 9 }, (_, i) => [`word/document.xml#${i}`, 'Body', i]),
      ['word/header1.xml#0', 'Header', 0],
    ]);
    // the tag reader's paragraphs, part by part
    const parts = partsOf(NDA);
    expect(all.filter((l) => l.part === 'word/document.xml').map((l) => l.text)).toEqual(parts['word/document.xml']);

    const [title, first, second, secondEn, id, jobEn, jobAr, date, salary, ref] = all;
    expect(title).toEqual({
      id: 'word/document.xml#0',
      part: 'word/document.xml',
      partLabel: 'Body',
      index: 0,
      text: 'اتفاقية عدم إفصاح / Non-Disclosure Agreement',
      tags: [],
      blanks: [],
      suggestions: [],
    });
    expect(first.suggestions).toEqual([]); // the company's name is typed in already
    const blank = second.text.indexOf('.');
    expect(second.blanks).toEqual([{ from: blank, to: second.text.length }]);
    expect(second.suggestions).toEqual([{ tag: 'full_name_ar', from: blank, to: second.text.length, label: 'الطرف الثاني', text: '{{full_name_ar}}' }]);
    expect(secondEn.suggestions).toEqual([{ tag: 'full_name_en', from: 18, to: 34, label: 'Second Party', text: '{{full_name_en}}' }]);
    expect([id.text, id.tags, id.suggestions]).toEqual(['الرقم القومي: {{national_id}}', [{ tag: 'national_id', from: 14, to: 29, known: true }], []]);
    // on a bilingual template the job title is asked for in the label's language
    expect([jobEn.suggestions[0].tag, jobAr.suggestions[0].tag]).toEqual(['job_title_en', 'job_title_ar']);
    expect(date.suggestions).toEqual([{ tag: 'date', from: 5, to: 5, label: 'Date', text: ' {{date}}' }]);
    expect(salary.tags).toEqual([{ tag: 'salary', from: 8, to: 18, known: false }]);
    expect(ref).toMatchObject({ part: 'word/header1.xml', text: 'Ref:', suggestions: [] });
  });

  it('saves the changes as a new draft, keeping the version mapped as it was', async () => {
    const all = await lines(v1);
    const fill = (l: Line) => ({ line: l.id, from: l.suggestions[0].from, to: l.suggestions[0].to, text: l.suggestions[0].text });
    const res = await map(v1, {
      edits: [
        fill(all[2]), // a blank spread over two runs
        fill(all[3]),
        fill(all[5]),
        fill(all[6]),
        fill(all[7]), // inserted after "Date:"
        { line: all[4].id, from: 14, to: 29, text: '' }, // the tag split over two runs, taken out
        { line: all[8].id, from: 8, to: 18, text: '{{gross_salary}}' }, // the unknown tag changed
        { line: all[9].id, from: 4, to: 4, text: ' {{employee_code}}' }, // the header
        { line: all[0].id, from: 0, to: 0, text: '{{date}} ' },
      ],
    }).expect(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      version: 2,
      fileName: 'NDA (fields mapped).docx',
      sizeBytes: expect.any(Number),
      language: 'bilingual',
      tags: ['date', 'full_name_ar', 'full_name_en', 'job_title_en', 'job_title_ar', 'gross_salary', 'employee_code'],
      unknownTags: [],
      broken: [],
      status: 'draft',
      note: 'Fields mapped in People System from v1',
      uploadedBy: { email: hrEmail },
      uploadedAt: expect.any(String),
      publishedBy: null,
      publishedAt: null,
    });

    const file = await download(res.body.id);
    expect(partsOf(file)['word/document.xml']).toEqual([
      '{{date}} اتفاقية عدم إفصاح / Non-Disclosure Agreement',
      'الطرف الأول: شركة تريندليكس',
      'الطرف الثاني: السيد/ {{full_name_ar}}',
      'Second Party: Mr. {{full_name_en}}',
      'الرقم القومي: ',
      'Job Title: {{job_title_en}}',
      'الوظيفة: {{job_title_ar}}',
      'Date: {{date}}',
      'الراتب: {{gross_salary}}',
    ]);
    expect(partsOf(file)['word/header1.xml']).toEqual(['Ref: {{employee_code}}']);
    // the new tags keep the Arabic runs' formatting
    expect(readZip(file).read('word/document.xml')!.toString('utf8')).toContain(
      '<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">{{full_name_ar}}</w:t></w:r><w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve"></w:t></w:r>',
    );
    expect(Buffer.compare(await download(v1), NDA)).toBe(0);

    const audit = await prisma.auditLog.findMany({ where: { entityType: 'template_version', entityId: res.body.id } });
    expect(audit.map((a) => [a.action, a.diff])).toEqual([
      [
        'map',
        {
          slot: 'nda',
          version: 2,
          from: { id: v1, version: 1 },
          fileName: 'NDA (fields mapped).docx',
          inserted: 7,
          changed: 1,
          removed: 1,
          tags: 7,
          unknownTags: 0,
          broken: 0,
        },
      ],
    ]);

    // checked and published as usual
    const published = await api().post(`/api/templates/versions/${res.body.id}/publish`).set('Cookie', hr).expect(200);
    expect(published.body).toMatchObject({ version: 2, status: 'published' });
  });

  it('maps the version in use too, and refuses one that was replaced', async () => {
    const inUse = (await prisma.templateVersion.findFirstOrThrow({ where: { slotKey: 'nda', status: 'published' } })).id;
    const all = await lines(inUse);
    expect(all[4].text).toBe('الرقم القومي: ');
    // after the space left there
    expect(all[4].suggestions).toEqual([{ tag: 'national_id', from: 14, to: 14, label: 'الرقم القومي', text: '{{national_id}}' }]);
    const res = await map(inUse, { edits: [{ line: all[4].id, from: 14, to: 14, text: '{{national_id}}' }], note: 'National ID back' }, admin).expect(201);
    // named after the version mapped, not "(fields mapped) (fields mapped)"
    expect(res.body).toMatchObject({ version: 3, status: 'draft', fileName: 'NDA (fields mapped).docx', note: 'National ID back' });
    expect(res.body.tags).toContain('national_id');

    await api().post(`/api/templates/versions/${res.body.id}/publish`).set('Cookie', hr).expect(200);
    const replaced = await map(inUse, { edits: [{ line: all[4].id, from: 14, to: 14, text: '{{national_id}}' }] }).expect(409);
    expect(replaced.body.message).toBe("Version 2 was replaced, so its fields can't be mapped. Map the version in use or a newer draft.");
    // a replaced version's lines can still be read
    await lines(inUse);
  });

  it('refuses changes to the wording, unknown tags and overlapping changes, naming the line', async () => {
    const before = await versions('nda');
    const all = await lines(v1);
    const blank = all[2].blanks[0];
    expect(await refused(v1, [{ line: all[0].id, from: 0, to: 7, text: '{{date}}' }])).toBe(
      "Line 1 of the body: only a tag or a blank (dots, dashes or underscores) can be replaced. The template's wording is never changed.",
    );
    expect(await refused(v1, [{ line: all[2].id, from: blank.from - 2, to: blank.to, text: '{{full_name_ar}}' }])).toMatch(/^Line 3 of the body: only a tag or a blank/);
    expect(await refused(v1, [{ line: all[3].id, from: 18, to: 34, text: 'Ahmed' }])).toBe(
      'Line 4 of the body: put in one tag, such as {{national_id}}, or nothing to take a tag out.',
    );
    expect(await refused(v1, [{ line: all[3].id, from: 18, to: 34, text: '{{full_name_en}} {{date}}' }])).toMatch(/^Line 4 of the body: put in one tag/);
    expect(await refused(v1, [{ line: all[3].id, from: 18, to: 34, text: '  {{full_name_en}}' }])).toMatch(/^Line 4 of the body: put in one tag/);
    expect(await refused(v1, [{ line: all[8].id, from: 8, to: 18, text: '{{basic_pay}}' }])).toBe("Line 9 of the body: {{basic_pay}} isn't a tag the system knows.");
    expect(await refused(v1, [{ line: all[4].id, from: 20, to: 20, text: '{{date}}' }])).toBe("Line 5 of the body: a tag can't go inside another tag.");
    expect(await refused(v1, [{ line: all[7].id, from: 5, to: 5, text: '' }])).toBe('Line 8 of the body: choose the tag to put in.');
    expect(await refused(v1, [{ line: all[3].id, from: 18, to: 34, text: '' }])).toBe('Line 4 of the body: choose the tag to put in the blank.');
    expect(
      await refused(v1, [
        { line: all[3].id, from: 18, to: 30, text: '{{full_name_en}}' },
        { line: all[3].id, from: 25, to: 34, text: '{{date}}' },
      ]),
    ).toBe('Line 4 of the body: two changes overlap. Make one change at each place.');
    expect(
      await refused(v1, [
        { line: all[7].id, from: 5, to: 5, text: ' {{date}}' },
        { line: all[7].id, from: 5, to: 5, text: ' {{phone}}' },
      ]),
    ).toBe('Line 8 of the body: two changes overlap. Make one change at each place.');
    expect(await refused(v1, [{ line: all[9].id, from: 2, to: 9, text: '{{date}}' }])).toBe(
      "Line 1 of the header: the place to change isn't on the line. Reload the page and try again.",
    );
    expect(await refused(v1, [{ line: 'word/document.xml#9', from: 0, to: 0, text: '{{date}}' }])).toBe(
      'There is no line "word/document.xml#9" in this version. Reload the page and try again.',
    );
    // checked with the body, so listed as the form's messages are
    expect(await refused(v1, [])).toEqual(['Make at least one change.']);
    const many = Array.from({ length: 201 }, () => ({ line: all[7].id, from: 5, to: 5, text: ' {{date}}' }));
    expect(await refused(v1, many)).toEqual(['Make at most 200 changes at a time.']);
    await map(v1, { edits: [{ line: all[7].id, from: -1, to: 5, text: ' {{date}}' }] }).expect(400);
    await map(v1, { edits: [{ line: all[7].id, from: '5', to: 5, text: ' {{date}}' }] }).expect(400);
    await map(v1, { edits: [{ line: all[7].id, from: 5, to: 5, text: ' {{date}}', extra: 1 }] }).expect(400);
    await map(v1, {}).expect(400);
    expect(await versions('nda')).toBe(before); // nothing saved

    await api().get('/api/templates/versions/00000000-0000-4000-8000-000000000000/lines').set('Cookie', hr).expect(404);
    await map('00000000-0000-4000-8000-000000000000', { edits: [{ line: all[7].id, from: 5, to: 5, text: ' {{date}}' }] }).expect(404);
    await api().get('/api/templates/versions/not-a-uuid/lines').set('Cookie', hr).expect(400);
  });

  it("reads the owner's contract and fills its signature blanks", async () => {
    const contract = (await upload('contract_full_time', realTemplate('Contract'), 'عقد العمل.docx').expect(201)).body.id;
    const all = await lines(contract);
    const parts = partsOf(realTemplate('Contract'));
    for (const [part, texts] of Object.entries(parts)) expect(all.filter((l) => l.part === part).map((l) => l.text)).toEqual(texts);
    const names = all.filter((l) => l.text.startsWith('الاسم: _'));
    expect(names).toHaveLength(4);
    expect(names.every((l) => l.suggestions.length === 1 && l.suggestions[0].tag === 'full_name_ar')).toBe(true);
    // the lines that hold their tag already are offered nothing
    expect(all.find((l) => l.text === 'تليفون: {{phone}}')!.suggestions).toEqual([]);

    const s = names[1].suggestions[0];
    const res = await map(contract, { edits: [{ line: names[1].id, from: s.from, to: s.to, text: s.text }] }).expect(201);
    expect(res.body).toMatchObject({ version: 2, fileName: 'عقد العمل (fields mapped).docx', unknownTags: [], broken: [] });
    const after = partsOf(await download(res.body.id))['word/document.xml'];
    const index = Number(names[1].id.split('#')[1]);
    expect(after[index]).toBe('الاسم: {{full_name_ar}}');
    expect(after.filter((_, i) => i !== index)).toEqual(parts['word/document.xml'].filter((_, i) => i !== index));
  });

  it('is for HR and Admin only: the CEO and employees are refused', async () => {
    const all = await lines(v1, admin);
    const edit = { edits: [{ line: all[7].id, from: 5, to: 5, text: ' {{date}}' }] };
    await api().get(`/api/templates/versions/${v1}/lines`).set('Cookie', ceo).expect(403);
    await api().get(`/api/templates/versions/${v1}/lines`).set('Cookie', employee).expect(403);
    await map(v1, edit, ceo).expect(403);
    await map(v1, edit, employee).expect(403);
    await api().get(`/api/templates/versions/${v1}/lines`).expect(401);
  });
});
