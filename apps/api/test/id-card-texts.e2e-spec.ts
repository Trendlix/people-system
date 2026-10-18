import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdCardTextsService, RELIGION_CLEANED } from '../src/paperwork/id-card-texts.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The religion printed on the back of the national ID card has been left out of the text kept since 16 October 2026.
// Text read before then is cleaned once, when the API starts, by the same rule (owner, 18 October 2026: "I am not
// interested in the religion field in both systems"; asked whether to remove it from the records stored before 16
// October: yes). These tests make their own papers as they were stored before then, and delete them. Every name, number
// and card is invented.

const RUN = String(Date.now()).slice(-8);

const FRONT = `جمهورية مصر العربية
بطاقة تحقيق الشخصية
سامي
عادل فؤاد مسلم
٣ شارع الجلاء
المنشية - الإسكندرية
٢٩١٠٢٠٣٠٢٠٠٠١٢`;
const BACK = `٢٩١٠٢٠٣٠٢٠٠٠١٢   ٢٠٢٢/٠٥
مدرس
ذكر     مسيحي     متزوج
البطاقة سارية حتى ٢٠٢٩/٠٥/٢٠`;
const BACK_KEPT = `٢٩١٠٢٠٣٠٢٠٠٠١٢   ٢٠٢٢/٠٥
مدرس
ذكر متزوج
البطاقة سارية حتى ٢٠٢٩/٠٥/٢٠`;
// a woman's back as the reader often gives it, the religion on a line of its own (with a tatweel)
const BACK_HERS = `٢٩٥٠٨١٧٠١٠٠٠٤٤   ٢٠٢٣/٠١
أنثى
مسلمـة
آنسة
البطاقة سارية حتى ٢٠٣٠/٠١/٠٩`;
const BACK_HERS_KEPT = `٢٩٥٠٨١٧٠١٠٠٠٤٤   ٢٠٢٣/٠١
أنثى
آنسة
البطاقة سارية حتى ٢٠٣٠/٠١/٠٩`;
const FORM = `استمارة بيانات ${RUN}
الديانة: مسلم`;

const READ_AT = new Date('2026-10-15T09:30:00Z');

describe('National ID card texts read before the religion was left out (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let employeeId: string;
  const api = () => request(app.getHttpServer());

  /** A paper as it was stored before 16 October 2026, with the text read then. */
  async function storedBefore(kind: string, ocrText: string | null, mark: string) {
    const data = Buffer.from(`%PDF-1.4\n% ${mark} ${RUN}\n%%EOF\n`);
    return prisma.paperworkItem.create({
      data: {
        employeeId,
        kind,
        fileName: `${mark}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: data.length,
        data: new Uint8Array(data),
        ocrStatus: ocrText === null ? 'failed' : 'done',
        ocrText,
        ocrAt: ocrText === null ? null : READ_AT,
      },
    });
  }

  const row = (id: string) => prisma.paperworkItem.findUniqueOrThrow({ where: { id } });
  const lastAudit = async () => (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? 0n;
  const cleanupsSince = (id: bigint) =>
    prisma.auditLog.findMany({ where: { entityType: 'paperwork', entityId: null, id: { gt: id } }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    const e = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `Card Text ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    employeeId = e.body.id;
  });

  afterAll(async () => {
    await prisma.employee.delete({ where: { id: employeeId } });
    await app.close();
  });

  it('takes the religion out of the stored text of the ID card’s sides, by the rule new reads follow, and nothing else', async () => {
    const back = await storedBefore('national_id_back', BACK, 'back');
    const hers = await storedBefore('national_id_back', BACK_HERS, 'hers');
    const frontAlone = await storedBefore('national_id_front', FRONT, 'front');
    const bothSides = await storedBefore('national_id_front', `${FRONT}\f${BACK}`, 'both');
    const form = await storedBefore('other', FORM, 'form');
    const clean = await storedBefore('national_id_back', BACK_KEPT, 'clean');
    const unread = await storedBefore('national_id_back', null, 'unread');
    const all = [back, hers, frontAlone, bothSides, form, clean, unread];
    const before = new Map(await Promise.all(all.map(async (p) => [p.id, await row(p.id)] as const)));
    const since = await lastAudit();

    // two at a time: a batch after another
    expect(await app.get(IdCardTextsService).clean({ batch: 2 })).toEqual({ cleaned: 3, more: false });

    expect((await row(back.id)).ocrText).toBe(BACK_KEPT);
    expect((await row(hers.id)).ocrText).toBe(BACK_HERS_KEPT);
    // a front alone keeps a name such as مسلم; a front whose later page is the back loses the religion there only
    expect((await row(frontAlone.id)).ocrText).toBe(FRONT);
    expect((await row(bothSides.id)).ocrText).toBe(`${FRONT}\f${BACK_KEPT}`);
    // other papers, a text already without it and a side never read stay as they are
    expect((await row(form.id)).ocrText).toBe(FORM);
    expect((await row(clean.id)).ocrText).toBe(BACK_KEPT);
    expect((await row(unread.id)).ocrText).toBeNull();
    // nothing else of a paper changes: its file, its status, when it was read
    for (const p of all) expect({ ...(await row(p.id)), ocrText: undefined }).toEqual({ ...before.get(p.id), ocrText: undefined });

    // one audit entry, by nobody, with how many: never what they said or whose they are
    const audit = await cleanupsSince(since);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ userId: null, action: 'update', entityId: null, diff: { ocrText: 'religion removed', items: 3, reason: RELIGION_CLEANED } });
    expect(JSON.stringify(audit[0].diff)).not.toMatch(/مسلم|مسيح|سامي|عادل|٢٩١٠٢٠٣٠٢٠٠٠١٢|Card Text/);

    // shown as stored
    const shown = await api().get(`/api/paperwork/${back.id}/text`).set('Cookie', hr).expect(200);
    expect(shown.body.ocrText).toBe(BACK_KEPT);

    // a second run finds nothing: no change, no entry
    const after = new Map(await Promise.all(all.map(async (p) => [p.id, await row(p.id)] as const)));
    const again = await lastAudit();
    expect(await app.get(IdCardTextsService).clean()).toEqual({ cleaned: 0, more: false });
    for (const p of all) expect(await row(p.id)).toEqual(after.get(p.id));
    expect(await cleanupsSince(again)).toEqual([]);

    await prisma.paperworkItem.deleteMany({ where: { id: { in: all.map((p) => p.id) } } });
  });

  it('is done when the API starts', async () => {
    const back = await storedBefore('national_id_back', BACK, 'started');
    const since = await lastAudit();

    const started = await createApp();
    try {
      expect((await row(back.id)).ocrText).toBe(BACK_KEPT);
      const audit = await cleanupsSince(since);
      expect(audit.map((a) => a.diff)).toEqual([{ ocrText: 'religion removed', items: 1, reason: RELIGION_CLEANED }]);
    } finally {
      await started.app.close();
    }
    await prisma.paperworkItem.delete({ where: { id: back.id } });
  });

  it('stops when its time is up and cleans the rest the next time', async () => {
    const backs = [await storedBefore('national_id_back', BACK, 'late1'), await storedBefore('national_id_back', BACK_HERS, 'late2')];
    const service = app.get(IdCardTextsService);

    const first = await service.clean({ batch: 1, budgetMs: 0 });
    expect(first.more).toBe(true);
    const rest = await service.clean();
    expect(rest.more).toBe(false);
    expect(first.cleaned + rest.cleaned).toBe(2);
    expect((await row(backs[0].id)).ocrText).toBe(BACK_KEPT);
    expect((await row(backs[1].id)).ocrText).toBe(BACK_HERS_KEPT);

    await prisma.paperworkItem.deleteMany({ where: { id: { in: backs.map((p) => p.id) } } });
  });
});
