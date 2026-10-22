import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import type { INestApplication } from '@nestjs/common';
import { CLIENT_IP_AT_HEADER, CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER, careersIpToken } from '@trendlix/shared';
import type { ApplicationListItem, ApplicationView, CvSaveResult, CvTextView, CvUploadView, GeneralCvListItem, GeneralCvView, Role, VacancyView } from '@trendlix/shared';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { CvReadingsService } from '../src/recruitment/cv-readings.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Every CV read and analysed in the background (owner, 22 October 2026: "make the OCR egine reads the CV and analyse it.
// is that applicable?"; asked, "Built-in rules only"). A PDF's own text is read at once; a scan goes to the OCR service
// (a stand-in here), in English and again in Arabic when it came out mostly Arabic; a failing OCR service is tried
// again later, three times in all. The rules then find the years, education, languages and the vacancy's key skills
// (the CV match %), editable after people applied and every application scored again. The CV's text and contacts are
// never a developer's. Every person and CV is invented; the test deletes what it made.

const RUN = `cv${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const MINUTE = 60_000;
/** Each person's own mobile (candidate profiles, 22 October 2026: the same mobile is one person's, joined as one): +2010 and 8 digits. */
const mobileOf = (who: string) => {
  const key = `${who}|${RUN}`;
  let h = 7;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return `+2010${String(h % 100_000_000).padStart(8, '0')}`;
};

/** A PDF with these lines of text. */
async function pdfOf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 760 - i * 18, size: 11, font }));
  return Buffer.from(await doc.save());
}

/** A "scanned" PDF: no text of its own, its mark telling the stand-in OCR service what it reads. */
const scan = (mark: string) => Buffer.from(`%PDF-1.4\n% MARK:${mark}\n%%EOF\n`);

const EDITOR_CV = [
  'Mona Reader',
  `mona.reader.${RUN}@mail.test  +20 100 222 3344`,
  'Experience',
  'Senior Video Editor, Bright Studio, Jan 2022 - Present',
  'Video Editor, Nile Media, March 2019 - Dec 2021',
  'Education',
  'Bachelor of Fine Arts, Helwan University, 2014 - 2018',
  'Skills',
  `Adobe Premiere Pro, After-Effects, Zanzibarlogic${RUN}`,
  'Languages',
  'English, Arabic',
];

const ARABIC_SCAN = `منى العربية
الخبرات العملية
مونتير، استوديو برايت — يناير ٢٠٢٠ - الآن
التعليم
بكالوريوس الإعلام، جامعة القاهرة ٢٠١٥ - ٢٠١٩
المهارات
بريمير برو
اللغات
العربية، الإنجليزية`;

interface FakeOcr {
  url: string;
  calls: { mark: string; lang: string | null }[];
  close: () => Promise<void>;
}

/** A stand-in for services/ocr: POST /read answers the text for the file's mark, 500 for MARK:FAIL. */
async function fakeOcr(texts: Record<string, string>): Promise<FakeOcr> {
  const calls: { mark: string; lang: string | null }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://ocr');
      if (req.method !== 'POST' || url.pathname !== '/read') return void res.writeHead(404).end();
      const mark = /MARK:(\w+)/.exec(Buffer.concat(chunks).toString('latin1'))?.[1] ?? '';
      calls.push({ mark, lang: url.searchParams.get('lang') });
      if (mark === 'FAIL') return void res.writeHead(500).end('Internal Server Error');
      const text = texts[mark] ?? '';
      const pages = text.split('\f').map((p) => ({ lines: p.split('\n').map((line, i) => ({ text: line, confidence: 0.9, box: [0, i * 20, 300, i * 20 + 16] })) }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ lang: url.searchParams.get('lang'), pages, text }));
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

describe('CV reading and analysis (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let readings: CvReadingsService;
  let ocr: FakeOcr;
  const ocrUrlBefore = process.env.OCR_URL;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  let departmentId: string;
  let jobTitleId: string;
  let vacancy: VacancyView;

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const patch = (as: string, path: string, body: object) => api().patch(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const email = (who: string) => `${who}.${RUN}@mail.test`;

  async function account(key: string, roles: Role[]) {
    const e = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email: e } })).id;
    sessions[key] = await signIn(app, e);
  }

  /** An application from the careers page, its address signed as the website signs it. */
  async function apply(who: string, ip: string, file: Buffer): Promise<string> {
    const at = String(Date.now());
    const req = api()
      .post(`/api/public/careers/${vacancy.slug}/apply`)
      .set(CLIENT_IP_HEADER, ip)
      .set(CLIENT_IP_AT_HEADER, at)
      .set(CLIENT_IP_SIGNATURE_HEADER, signatureOf(process.env.WEB_KEY!, ip, at, careersIpToken(vacancy.slug)));
    const fields = { fullName: `${who} Applicant ${RUN}`, email: email(who), mobile: mobileOf(who), answers: '{}', consent: 'true', ip };
    let r = req;
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    await r.attach('cv', file, `${who}.pdf`).expect(201);
    return (await prisma.jobApplication.findFirstOrThrow({ where: { email: email(who) }, select: { id: true } })).id;
  }

  /** Rounds at `now` until nothing is left to read. */
  async function drain(now = new Date()) {
    for (let i = 0; i < 40; i++) if ((await readings.runOnce(now)) === 0) return;
  }

  const readingOf = (where: { applicationId?: string; generalCvId?: string; uploadId?: string }) =>
    prisma.cvReading.findFirst({ where, select: { status: true, method: true, attempts: true, error: true, text: true } });

  beforeAll(async () => {
    ocr = await fakeOcr({
      AR: ARABIC_SCAN,
      BULK: `Karim Scanned Ocr\nkarim.ocr.${RUN}@mail.test\n+20 112 345 6789\nExperience\nEditor 2018 - 2020`,
      EMPTY: '',
    });
    process.env.OCR_URL = ocr.url;
    ({ app, prisma } = await createApp());
    readings = app.get(CvReadingsService);
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await account('developer', ['developer', 'employee']);
    await account('outsider', ['employee']);
    departmentId = (await prisma.department.create({ data: { nameEn: `Reading ${RUN}` }, select: { id: true } })).id;
    jobTitleId = (await prisma.jobTitle.create({ data: { departmentId, titleEn: `Reader ${RUN}`, jdPurpose: '<p>Edit the studio’s videos.</p>' }, select: { id: true } })).id;
    const made = (
      await post('hr', '/recruitment/vacancies', {
        jobTitleId,
        employmentType: 'full_time',
        closingDate: addDays(TODAY, 30),
        keySkills: 'Premiere Pro, after effects, Final Cut Pro, Color Grading, premiere pro',
      }).expect(201)
    ).body as VacancyView;
    expect(made.keySkills).toEqual(['Premiere Pro', 'after effects', 'Final Cut Pro', 'Color Grading']);
    await post('hr', `/recruitment/vacancies/${made.id}/submit`).expect(200);
    vacancy = (await post('ceo', `/recruitment/vacancies/${made.id}/approve`).expect(200)).body as VacancyView;
  });

  afterAll(async () => {
    await prisma.cvUpload.deleteMany({ where: { createdById: { in: Object.values(users) } } });
    await prisma.generalCv.deleteMany({ where: { email: { endsWith: `.${RUN}@mail.test` } } });
    await prisma.jobApplication.deleteMany({ where: { vacancy: { jobTitleId } } });
    await prisma.vacancy.deleteMany({ where: { jobTitleId } });
    await prisma.jobTitle.deleteMany({ where: { id: jobTitleId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await app.close();
    await ocr.close();
    if (ocrUrlBefore === undefined) delete process.env.OCR_URL;
    else process.env.OCR_URL = ocrUrlBefore;
  });

  let mona: string;

  it('reads a PDF’s own text in the background, finds the years, education, languages and key skills, and scores the CV', async () => {
    mona = await apply('mona', '10.4.0.1', await pdfOf(EDITOR_CV));
    // nothing read on the request itself
    expect(await readingOf({ applicationId: mona })).toBeNull();
    await drain();
    expect(await readingOf({ applicationId: mona })).toMatchObject({ status: 'read', method: 'pdf', attempts: 1, error: null });
    const a = (await get('hr', `/recruitment/applications/${mona}`).expect(200)).body as ApplicationView;
    expect(a.cvMatchPercent).toBe(50);
    expect(a.cvReading).toMatchObject({
      status: 'read',
      method: 'pdf',
      education: 'bachelor',
      languages: ['English', 'Arabic'],
      skills: { found: ['Premiere Pro', 'after effects'], missing: ['Final Cut Pro', 'Color Grading'] },
      cvMatchPercent: 50,
    });
    expect(a.cvReading!.experience).toMatch(/^About \d+ years \(from the dates in the CV\)$/);
    // the OCR service wasn't needed
    expect(ocr.calls).toEqual([]);
  });

  it('reads a scan through the OCR service: in English, then in Arabic when it came out mostly Arabic', async () => {
    const id = await apply('arabic', '10.4.0.2', scan('AR'));
    await drain();
    expect(ocr.calls.filter((c) => c.mark === 'AR')).toEqual([
      { mark: 'AR', lang: 'en' },
      { mark: 'AR', lang: 'ar' },
    ]);
    expect(await readingOf({ applicationId: id })).toMatchObject({ status: 'read', method: 'ocr_ar' });
    const a = (await get('hr', `/recruitment/applications/${id}`).expect(200)).body as ApplicationView;
    expect(a.cvReading).toMatchObject({ education: 'bachelor', languages: ['English', 'Arabic'], skills: { found: [], missing: vacancy.keySkills }, cvMatchPercent: 0 });
  });

  it('a scan the OCR service finds nothing in is "no text"; one it fails on is tried again later, failed after the third try', async () => {
    const empty = await apply('empty', '10.4.0.3', scan('EMPTY'));
    const failing = await apply('failing', '10.4.0.4', scan('FAIL'));
    const now = Date.now();
    await drain(new Date(now));
    expect(await readingOf({ applicationId: empty })).toMatchObject({ status: 'no_text', method: 'ocr_en' });
    expect(await readingOf({ applicationId: failing })).toMatchObject({ status: 'pending', attempts: 1, error: 'The OCR service could not read it.' });
    // not before its next try (2 minutes later)
    await drain(new Date(now + MINUTE));
    expect((await readingOf({ applicationId: failing }))!.attempts).toBe(1);
    await drain(new Date(now + 3 * MINUTE));
    expect(await readingOf({ applicationId: failing })).toMatchObject({ status: 'pending', attempts: 2 });
    await drain(new Date(now + 15 * MINUTE));
    expect(await readingOf({ applicationId: failing })).toMatchObject({ status: 'failed', attempts: 3, error: 'The OCR service could not read it.' });
    const a = (await get('hr', `/recruitment/applications/${failing}`).expect(200)).body as ApplicationView;
    expect(a.cvReading).toMatchObject({ status: 'failed', cvMatchPercent: null, experience: null });
    expect(a.cvMatchPercent).toBeNull();
  });

  it('lists the CV match, filters and sorts by it, and searches the CVs’ text', async () => {
    const list = (q: string) => get('hr', `/recruitment/applications?vacancyId=${vacancy.id}${q}`).expect(200).then((r) => r.body as ApplicationListItem[]);
    expect((await list('')).find((a) => a.id === mona)?.cvMatchPercent).toBe(50);
    expect((await list('&minCvMatch=50')).map((a) => a.id)).toEqual([mona]);
    expect((await list('&sort=cv'))[0].id).toBe(mona);
    expect((await list(`&q=zanzibarlogic${RUN}`)).map((a) => a.id)).toEqual([mona]);
  });

  it('key skills changed after people applied score every application again, and are in the audit log', async () => {
    const changed = (await patch('hr', `/recruitment/vacancies/${vacancy.id}`, { keySkills: ['Premiere Pro', 'After Effects', 'بريمير برو'] }).expect(200)).body as VacancyView;
    expect(changed.keySkills).toEqual(['Premiere Pro', 'After Effects', 'بريمير برو']);
    const rows = await prisma.jobApplication.findMany({ where: { vacancyId: vacancy.id }, select: { email: true, cvMatchPercent: true } });
    expect(Object.fromEntries(rows.map((r) => [r.email.split('.')[0], r.cvMatchPercent]))).toEqual({ mona: 67, arabic: 33, empty: null, failing: null });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'vacancy', entityId: vacancy.id, action: 'update' }, orderBy: { at: 'desc' } });
    expect(entry.diff).toMatchObject({ keySkills: { from: ['Premiere Pro', 'after effects', 'Final Cut Pro', 'Color Grading'], to: ['Premiere Pro', 'After Effects', 'بريمير برو'] } });
    expect(said(await patch('hr', `/recruitment/vacancies/${vacancy.id}`, { keySkills: Array.from({ length: 21 }, (_, i) => `S${i}`) }).expect(400))).toEqual(['List at most 20 key skills.']);
  });

  it('gives the CV’s text and contacts to who may open the applicant, never to a developer', async () => {
    const t = (await get('hr', `/recruitment/applications/${mona}/cv-text`).expect(200)).body as CvTextView;
    expect(t).toMatchObject({ status: 'read', cvEmails: [`mona.reader.${RUN}@mail.test`], cvPhones: ['+201002223344'] });
    expect(t.cvText).toContain(`Zanzibarlogic${RUN}`);
    await get('developer', `/recruitment/applications/${mona}/cv-text`).expect(403);
    expect([403, 404]).toContain((await get('outsider', `/recruitment/applications/${mona}/cv-text`)).status);
    // the reading's summary has no contacts: a developer sees it
    const seen = (await get('developer', `/recruitment/applications/${mona}`).expect(200)).body as ApplicationView;
    expect(seen.cvReading).toMatchObject({ status: 'read', education: 'bachelor' });
  });

  it('reads HR’s general CVs too, searchable by their text', async () => {
    let req = api().post('/api/recruitment/general-cvs').set('Cookie', sessions.hr);
    const fields = { fullName: `Sara General ${RUN}`, email: email('sara'), mobile: '+20 100 999 8877', departmentId, consent: 'true', source: 'email' };
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    const added = (await req.attach('cv', await pdfOf(['Sara General', 'Experience', 'Designer 2018 - 2020', `Figmaquest${RUN}`, 'Master of Design']), 'sara.pdf').expect(201)).body as GeneralCvView;
    expect(added.cvReading).toMatchObject({ status: 'pending' });
    await drain();
    const after = (await get('hr', `/recruitment/general-cvs/${added.id}`).expect(200)).body as GeneralCvView;
    expect(after.cvReading).toMatchObject({ status: 'read', method: 'pdf', education: 'master', experience: 'About 2 years (from the dates in the CV)', skills: null, cvMatchPercent: null });
    expect(((await get('hr', `/recruitment/general-cvs?q=figmaquest${RUN}`).expect(200)).body as GeneralCvListItem[]).map((c) => c.id)).toEqual([added.id]);
    expect(((await get('hr', `/recruitment/general-cvs/${added.id}/cv-text`).expect(200)).body as CvTextView).cvText).toContain(`Figmaquest${RUN}`);
    await get('developer', `/recruitment/general-cvs/${added.id}/cv-text`).expect(403);
  });

  it('a bulk upload’s scan is read by the OCR service, its row filled in; saved, its reading goes with it', async () => {
    const res = await api().post(`/api/recruitment/cv-uploads?vacancyId=${vacancy.id}`).set('Cookie', sessions.hr).attach('cv', scan('BULK'), 'karim.pdf').expect(201);
    const row = res.body as CvUploadView;
    expect(row).toMatchObject({ textFound: false, reading: true, guess: { fullName: 'Karim', email: null, mobile: null } });
    await drain();
    const [read] = (await get('hr', `/recruitment/cv-uploads?vacancyId=${vacancy.id}`).expect(200)).body as CvUploadView[];
    expect(read).toMatchObject({ textFound: true, reading: false, guess: { fullName: 'Karim Scanned Ocr', email: `karim.ocr.${RUN}@mail.test`, mobile: '+201123456789' } });
    const callsBefore = ocr.calls.length;
    const saved = (
      await post('hr', '/recruitment/cv-uploads/save', {
        vacancyId: vacancy.id,
        rows: [{ id: read.id, fullName: read.guess.fullName, email: read.guess.email, mobile: read.guess.mobile, source: 'linkedin' }],
      }).expect(200)
    ).body as CvSaveResult;
    expect(saved.saved).toHaveLength(1);
    const app2 = await prisma.jobApplication.findFirstOrThrow({ where: { email: `karim.ocr.${RUN}@mail.test` }, select: { id: true } });
    // carried over: read already, not read again
    expect(await readingOf({ applicationId: app2.id })).toMatchObject({ status: 'read', method: 'ocr_en' });
    await drain();
    expect(ocr.calls.length).toBe(callsBefore);
  });

  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
});
