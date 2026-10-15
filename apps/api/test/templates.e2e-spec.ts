import type { INestApplication } from '@nestjs/common';
import { TEMPLATE_SLOTS, TEMPLATE_TAGS } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PdfService } from '../src/pdf/pdf.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { CONTRACT_TAGS, docx, p, r, realTemplate, RESIGNATION_TAGS, TEMPLATE_TYPE } from './fixtures/docx.js';
import { createApp, createUser, signIn } from './helpers.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SAVE_AS = 'Save it as a Word document (.docx) and upload again.';
const ONLY_SUPER_ADMIN = 'Only a Super Admin can delete records.';

/** Reads a response body as bytes, whatever its type. */
const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

interface Slot {
  key: string;
  status: string;
  copyOf: string | null;
  overrides: Record<string, string> | null;
  published: { id: string; version: number; fileName: string; publishedBy: { email: string } | null } | null;
  latestDraft: { id: string; version: number; unknownTags: string[]; broken: string[] } | null;
  versionCount: number;
}

describe('Templates (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let admin: string;
  let superAdmin: string;
  let ceo: string;
  let employee: string;
  let hrEmail: string;
  const api = () => request(app.getHttpServer());

  const upload = (slot: string, file: Buffer, fileName: string, cookie = hr) =>
    api().post(`/api/templates/${slot}/versions`).set('Cookie', cookie).attach('file', file, fileName);
  const publish = (id: string, cookie = hr) => api().post(`/api/templates/versions/${id}/publish`).set('Cookie', cookie);
  const slots = async (cookie = hr): Promise<Slot[]> => (await api().get('/api/templates').set('Cookie', cookie).expect(200)).body;
  const slotOf = async (key: string) => (await slots()).find((s) => s.key === key)!;
  const auditOf = (id: string) => prisma.auditLog.findMany({ where: { entityType: 'template_version', entityId: id }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await prisma.templateVersion.deleteMany();
    hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    employee = await signIn(app, await createUser(prisma, ['employee']));
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists every slot in the library’s order, all missing at first', async () => {
    const list = await slots();
    expect(list.map((s) => s.key)).toEqual(TEMPLATE_SLOTS.map((s) => s.key));
    expect(list.every((s) => s.status === 'missing' && s.published === null && s.latestDraft === null && s.versionCount === 0)).toBe(true);
    expect(list.find((s) => s.key === 'contract_full_time')).toEqual({
      key: 'contract_full_time',
      name: 'Contract · Full-time (official copy)',
      folder: 'contracts',
      language: 'ar',
      appliesTo: ['full_time'],
      triggers: ['on_hire', 'renewal'],
      signers: 'both',
      copyOf: null,
      overrides: null,
      status: 'missing',
      published: null,
      latestDraft: null,
      versionCount: 0,
    });
    const copy = list.find((s) => s.key === 'contract_full_time_insurance')!;
    // its own file since 15 October 2026 (the owner's file holds both copies, worded differently); its salary tags read the insured salary
    expect([copy.copyOf, copy.overrides]).toEqual([null, { gross_salary: 'insured_salary', gross_salary_words: 'insured_salary_words', gross_salary_words_en: 'insured_salary_words_en' }]);
  });

  it('HR uploads a draft: the tags are read, and it is version 1', async () => {
    const file = realTemplate('Contract');
    const res = await upload('contract_full_time', file, 'عقد العمل.docx').field('note', 'As used today').expect(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      version: 1,
      fileName: 'عقد العمل.docx',
      sizeBytes: file.length,
      language: 'ar',
      tags: CONTRACT_TAGS,
      unknownTags: [],
      broken: [],
      status: 'draft',
      note: 'As used today',
      uploadedBy: { email: hrEmail },
      uploadedAt: expect.any(String),
      publishedBy: null,
      publishedAt: null,
      usedBy: 0,
    });

    const slot = await slotOf('contract_full_time');
    expect(slot).toMatchObject({ status: 'draft', published: null, versionCount: 1 });
    expect(slot.latestDraft).toEqual({ id: res.body.id, version: 1, fileName: 'عقد العمل.docx', uploadedAt: res.body.uploadedAt, unknownTags: [], broken: [] });

    const audit = await auditOf(res.body.id);
    expect(audit.map((a) => [a.action, a.diff])).toEqual([
      ['create', { slot: 'contract_full_time', version: 1, fileName: 'عقد العمل.docx', language: 'ar', tags: 17, unknownTags: 0, broken: 0 }],
    ]);
  });

  it('takes the language on upload when the slot has none, and keeps a fixed one', async () => {
    const file = docx({ body: p(r('{{full_name_en}} {{date}}')) });
    const none = await upload('nda', file, 'NDA.docx').expect(400);
    expect(none.body.message).toBe('Choose the language of the template: Arabic or English.');
    await upload('nda', file, 'NDA.docx').field('language', 'fr').expect(400);
    const nda = await upload('nda', file, 'NDA.docx', admin).field('language', 'en').expect(201);
    expect([nda.body.language, nda.body.tags, nda.body.uploadedBy]).toEqual(['en', ['full_name_en', 'date'], { email: expect.any(String) }]);
    // Arabic and English side by side (the owner's NDA): the tags that name their language print in it
    const both = await upload('nda', docx({ body: p(r('{{job_title_ar}} / {{job_title_en}}')) }), 'NDA both.docx').field('language', 'bilingual').expect(201);
    expect([both.body.language, both.body.tags]).toEqual(['bilingual', ['job_title_ar', 'job_title_en']]);

    const wrong = await upload('hr_letter_ar', file, 'letter.docx').field('language', 'en').expect(400);
    expect(wrong.body.message).toBe('HR letter · Arabic is always in Arabic.');
    const letter = await upload('hr_letter_ar', file, 'letter').expect(201); // the slot's language, and a .docx name
    expect([letter.body.language, letter.body.fileName]).toEqual(['ar', 'letter.docx']);
  });

  it('refuses a file that is not a Word document (.docx)', async () => {
    const say = async (file: Buffer, name: string) => (await upload('resignation_request', file, name).expect(400)).body.message as string;
    expect(await say(Buffer.from('%PDF-1.4\n%%EOF\n'), 'contract.pdf')).toBe(`This file isn't a Word document. ${SAVE_AS}`);
    expect(await say(Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]), 'old.doc')).toMatch(
      /^This is an old Word document \(\.doc\)/,
    );
    expect(await say(docx({ body: p(r('{{date}}')), mainType: TEMPLATE_TYPE }), 'contract.dotx')).toBe(`This is a Word template (.dotx). ${SAVE_AS}`);
    const empty = await api().post('/api/templates/resignation_request/versions').set('Cookie', hr).field('note', 'x').expect(400);
    expect(empty.body.message).toBe('Choose the Word file (.docx) to upload.');
    const big = await upload('resignation_request', Buffer.alloc(10 * 1024 * 1024 + 1), 'big.docx').expect(413);
    expect(big.body.message).toBe('Each file must be 10 MB or smaller.');
    expect((await slotOf('resignation_request')).versionCount).toBe(0);
  });

  it('does not publish a version with unknown or broken tags, and says which', async () => {
    const unknown = await upload('resignation_request', docx({ body: p(r('{{full_name_ar}} {{salary}}')) + p(r('{{ manager }}')) }), 'r.docx').expect(201);
    expect([unknown.body.tags, unknown.body.unknownTags, unknown.body.broken]).toEqual([['full_name_ar'], ['salary', 'manager'], []]);
    expect((await publish(unknown.body.id).expect(400)).body.message).toBe(
      "This version uses tags the system doesn't know: {{salary}}, {{manager}}. Fix them in Word and upload it again.",
    );

    const broken = await upload('resignation_request', docx({ body: p(r('{{ full_name_ar'), r(' و{reason_ar} {{date}}')) }), 'r.docx').expect(201);
    expect([broken.body.version, broken.body.tags, broken.body.broken]).toEqual([2, ['date'], ['{{ full_name_ar', '{reason_ar}']]);
    expect((await publish(broken.body.id).expect(400)).body.message).toBe(
      "This version has tags that aren't written correctly: {{ full_name_ar, {reason_ar}. Fix them in Word and upload it again.",
    );

    const slot = await slotOf('resignation_request');
    expect(slot).toMatchObject({ status: 'draft', published: null, versionCount: 2 });
    expect(slot.latestDraft).toMatchObject({ version: 2, unknownTags: [], broken: ['{{ full_name_ar', '{reason_ar}'] });

    // the real file goes through
    const good = await upload('resignation_request', realTemplate('Resignation'), 'طلب استقالة.docx').expect(201);
    expect(good.body.tags).toEqual(RESIGNATION_TAGS);
    expect((await publish(good.body.id).expect(200)).body.status).toBe('published');
  });

  it('publishing retires the version in use; only drafts are published', async () => {
    const { latestDraft } = await slotOf('contract_full_time');
    const first = await publish(latestDraft!.id).expect(200);
    expect(first.body).toMatchObject({ version: 1, status: 'published', publishedBy: { email: hrEmail }, publishedAt: expect.any(String) });
    expect((await publish(latestDraft!.id).expect(409)).body.message).toBe('Version 1 is already in use.');

    const second = await upload('contract_full_time', realTemplate('Contract'), 'عقد العمل.docx').field('note', 'Second wording').expect(201);
    expect(second.body.version).toBe(2);
    let slot = await slotOf('contract_full_time');
    expect(slot).toMatchObject({ status: 'published', published: { id: first.body.id, version: 1 }, latestDraft: { id: second.body.id, version: 2 }, versionCount: 2 });

    await publish(second.body.id, superAdmin).expect(200); // a Super Admin can do what an Admin can
    slot = await slotOf('contract_full_time');
    expect(slot).toMatchObject({ status: 'published', published: { id: second.body.id, version: 2 }, latestDraft: null });

    const detail = await api().get('/api/templates/contract_full_time').set('Cookie', hr).expect(200);
    expect(detail.body.versions.map((v: { version: number; status: string; note: string }) => [v.version, v.status, v.note])).toEqual([
      [2, 'published', 'Second wording'],
      [1, 'retired', 'As used today'],
    ]);
    expect(detail.body.versions[1]).toMatchObject({ publishedBy: { email: hrEmail }, tags: CONTRACT_TAGS, sizeBytes: realTemplate('Contract').length });
    expect(await prisma.templateVersion.count({ where: { slotKey: 'contract_full_time', status: 'published' } })).toBe(1);

    const retired = await publish(first.body.id).expect(409);
    expect(retired.body.message).toBe("Version 1 was replaced and can't be used again. Upload the file again to make it a new version.");
    expect((await auditOf(second.body.id)).map((a) => [a.action, a.diff])).toEqual([
      ['create', expect.objectContaining({ version: 2 })],
      ['publish', { slot: 'contract_full_time', version: 2, status: { from: 'draft', to: 'published' }, retired: [1] }],
    ]);
    expect((await auditOf(first.body.id)).map((a) => a.action)).toEqual(['create', 'publish', 'update']);
    expect((await auditOf(first.body.id)).at(-1)!.diff).toEqual({ slot: 'contract_full_time', version: 1, status: { from: 'published', to: 'retired' }, replacedBy: 2 });
  });

  it('a draft older than the version in use is not published', async () => {
    const older = await upload('clearance_dues', realTemplate('Clearance_Dues'), 'إخلاء طرف.docx').expect(201);
    const newer = await upload('clearance_dues', realTemplate('Clearance_Dues'), 'إخلاء طرف.docx').expect(201);
    await publish(newer.body.id).expect(200);
    expect((await slotOf('clearance_dues')).latestDraft).toBeNull(); // the older draft would only put back an older file
    const res = await publish(older.body.id).expect(409);
    expect(res.body.message).toBe('Version 1 is older than version 2, which is in use. Upload the file again to make it a new version.');
  });

  it('keeps one version in use when two uploads and two publishes come at once', async () => {
    const file = docx({ body: p(r('{{pay_month}} {{net_salary}}')) });
    const [a, b] = await Promise.all([upload('payslip_ar', file, 'a.docx').expect(201), upload('payslip_ar', file, 'b.docx').expect(201)]);
    expect([a.body.version, b.body.version].sort((x, y) => x - y)).toEqual([1, 2]);
    await Promise.all([publish(a.body.id), publish(b.body.id)]);
    const rows = await prisma.templateVersion.findMany({ where: { slotKey: 'payslip_ar' }, orderBy: { version: 'asc' } });
    expect(rows.filter((v) => v.status === 'published')).toHaveLength(1);
    expect(rows.at(-1)!.status).toBe('published'); // the newer one, whichever came first
  });

  it('the insurance copy has its own file, uploaded and published apart from the official copy', async () => {
    const before = (await slots()).find((s) => s.key === 'contract_full_time')!;
    const res = await upload('contract_full_time_insurance', realTemplate('Contract'), 'نسخة التأمينات.docx').expect(201);
    expect(res.body).toMatchObject({ version: 1, status: 'draft', unknownTags: [], broken: [] });
    await publish(res.body.id).expect(200);

    const list = await slots();
    const copy = list.find((s) => s.key === 'contract_full_time_insurance')!;
    expect(copy).toMatchObject({ copyOf: null, status: 'published', versionCount: 1 });
    expect(copy.published!.id).toBe(res.body.id);
    // the official copy is untouched
    expect(list.find((s) => s.key === 'contract_full_time')!.published).toEqual(before.published);
  });

  it('downloads the file as uploaded, with its Arabic name', async () => {
    const { published } = await slotOf('contract_full_time');
    const res = await api().get(`/api/templates/versions/${published!.id}/file`).set('Cookie', ceo).buffer(true).parse(bytes).expect(200);
    expect(res.headers['content-type']).toBe(DOCX);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="_ _.docx"; filename*=UTF-8''${encodeURIComponent('عقد العمل.docx')}`);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.compare(res.body as Buffer, realTemplate('Contract'))).toBe(0);
    await api().get('/api/templates/versions/00000000-0000-4000-8000-000000000000/file').set('Cookie', hr).expect(404);

    // Preview: the same file as a PDF shown in the browser, once the server has a PDF converter
    const preview = () => api().get(`/api/templates/versions/${published!.id}/file?format=pdf`).set('Cookie', ceo);
    expect((await preview().expect(409)).body.message).toMatch(/^The PDF converter isn't set up/);
    const convert = vi.spyOn(app.get(PdfService), 'fromDocx').mockResolvedValue(Buffer.from('%PDF-1.7 preview'));
    const shown = await preview().buffer(true).parse(bytes).expect(200);
    expect(shown.headers['content-type']).toBe('application/pdf');
    expect(shown.headers['content-disposition']).toMatch(/^inline; .*\.pdf/);
    expect(convert).toHaveBeenCalledWith(expect.any(Buffer), 'عقد العمل.docx');
    convert.mockRestore();
    await api().get(`/api/templates/versions/${published!.id}/file?format=odt`).set('Cookie', ceo).expect(400);
  });

  it('only a Super Admin deletes, any version nothing was made from', async () => {
    await upload('contract_full_time', realTemplate('Contract'), 'عقد العمل.docx').expect(201); // a new draft, version 3
    const { published, latestDraft } = await slotOf('contract_full_time');
    expect((await api().delete(`/api/templates/versions/${latestDraft!.id}`).set('Cookie', hr).expect(403)).body.message).toBe(ONLY_SUPER_ADMIN);
    await api().delete(`/api/templates/versions/${latestDraft!.id}`).set('Cookie', admin).expect(403);

    // the version it replaced, which nothing was made from, goes too (owner, 15 October 2026); a used one is kept (documents spec)
    const detail = await api().get('/api/templates/contract_full_time').set('Cookie', hr).expect(200);
    expect(detail.body.versions.map((v: { usedBy: number }) => v.usedBy)).toEqual([0, 0, 0]);
    const retired = detail.body.versions.find((v: { status: string }) => v.status === 'retired');
    await api().delete(`/api/templates/versions/${retired.id}`).set('Cookie', superAdmin).expect(204);
    expect(published).toBeTruthy(); // the version in use could go too; it is kept here for the tests that follow

    await api().delete(`/api/templates/versions/${latestDraft!.id}`).set('Cookie', superAdmin).expect(204);
    const after = await slotOf('contract_full_time');
    expect(after).toMatchObject({ status: 'published', latestDraft: null, versionCount: 1 });
    expect((await auditOf(latestDraft!.id)).map((a) => [a.action, a.diff])).toEqual([
      ['create', expect.objectContaining({ version: 3 })],
      ['delete', { slot: 'contract_full_time', version: 3, fileName: 'عقد العمل.docx', status: 'draft' }],
    ]);
    await api().delete(`/api/templates/versions/${latestDraft!.id}`).set('Cookie', superAdmin).expect(404);
  });

  it('the CEO views and downloads, but does not upload or publish', async () => {
    expect((await slots(ceo)).length).toBe(TEMPLATE_SLOTS.length);
    await api().get('/api/templates/nda').set('Cookie', ceo).expect(200);
    await upload('payslip_en', docx({ body: p(r('{{pay_month}}')) }), 'payslip.docx', ceo).expect(403);
    const draft = await upload('payslip_en', docx({ body: p(r('{{pay_month}}')) }), 'payslip.docx').expect(201);
    await publish(draft.body.id, ceo).expect(403);
    await api().get(`/api/templates/versions/${draft.body.id}/file`).set('Cookie', ceo).expect(200);
    await api().delete(`/api/templates/versions/${draft.body.id}`).set('Cookie', ceo).expect(403);
  });

  it('an employee sees none of it, but may read the tag dictionary', async () => {
    const { published } = await slotOf('contract_full_time');
    await api().get('/api/templates').set('Cookie', employee).expect(403);
    await api().get('/api/templates/contract_full_time').set('Cookie', employee).expect(403);
    await api().get(`/api/templates/versions/${published!.id}/file`).set('Cookie', employee).expect(403);
    await upload('nda', docx({ body: p(r('{{date}}')) }), 'nda.docx', employee).field('language', 'en').expect(403);
    await publish(published!.id, employee).expect(403);

    const tags = await api().get('/api/templates/tags').set('Cookie', employee).expect(200);
    expect(tags.body).toEqual(TEMPLATE_TAGS);
    await api().get('/api/templates/tags').expect(401);
  });

  it('an unknown slot is not found', async () => {
    expect((await api().get('/api/templates/nope').set('Cookie', hr).expect(404)).body.message).toBe('Template not found.');
    await upload('nope', docx({ body: '' }), 'x.docx').expect(404);
    await publish('00000000-0000-4000-8000-000000000000').expect(404);
    await publish('not-a-uuid').expect(400);
  });
});
