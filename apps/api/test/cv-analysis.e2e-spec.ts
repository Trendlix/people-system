import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import type { INestApplication } from '@nestjs/common';
import { CLIENT_IP_AT_HEADER, CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER, CV_FACTS_VERSION, careersIpToken, HIDDEN } from '@trendlix/shared';
import type { ApplicationListItem, ApplicationView, CandidateListItem, CvSaveResult, CvTextView, CvUploadView, GeneralCvListItem, GeneralCvView, Role, VacancyView } from '@trendlix/shared';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { CvReadingsService } from '../src/recruitment/cv-readings.service.js';
import { RecruitmentSchedulerService } from '../src/recruitment/recruitment-scheduler.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Every CV read and analysed in the background (owner, 22 October 2026: "make the OCR egine reads the CV and analyse it.
// is that applicable?"; asked, "Built-in rules only"). A PDF's own text is read at once; a scan goes to the OCR service
// (a stand-in here), in English and again in Arabic when it came out mostly Arabic; a failing OCR service is tried
// again later, three times in all. The rules then find the years, education, languages and the vacancy's key skills
// (the CV match %), editable after people applied and every application scored again. The CV's text and contacts are
// never a developer's. Since 24 October 2026 ("why isn't the experience pulled off the CV? is the pulled data all what
// can be pulled from the uploaded cv?"; "CV years in list + more rules"): the work history and latest role, education
// details, skills, certifications and city too, masked for a developer; the lists' years fall back to the CV's, and
// filter by them; the CVs read before have their facts worked out again from their text, never read again. Every
// person and CV is invented; the test deletes what it made. Since 25 October 2026 ("Full CV fit score"; cv-fit.ts) the
// CV match % is the CV fit's: here the job title "Reader …" is like none of theirs (the title part 0) and the vacancy asks
// no years nor has requirements, so the fit is its key skills (35) and title (25), re-weighted (cv-fit.e2e-spec.ts has
// the rest).

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
  'Nasr City, Cairo',
  'Experience',
  'Senior Video Editor, Bright Studio, Jan 2022 - Present',
  'Video Editor, Nile Media, March 2019 - Dec 2021',
  'Education',
  'Bachelor of Fine Arts, Helwan University, 2014 - 2018',
  'Skills',
  `Adobe Premiere Pro, After-Effects, Zanzibarlogic${RUN}`,
  'Certifications',
  'Google Ads Search Certification, 2021',
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
      .post(`/api/public/careers/${vacancy.slug}/apply`).set('x-careers-key', process.env.CAREERS_KEY!)
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
        // agency background left out (27 October 2026): the fits here are about the reading
        agencyBackground: 'not_needed',
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
    // the CV fit: 2 of the 4 key skills (50, weight 35) and no title like "Reader …" (0, weight 25): 50 × 35 ÷ 60 = 29
    expect(a.cvMatchPercent).toBe(29);
    expect(a.cvReading).toMatchObject({
      status: 'read',
      method: 'pdf',
      education: 'bachelor',
      languages: ['English', 'Arabic'],
      skills: { found: ['Premiere Pro', 'after effects'], missing: ['Final Cut Pro', 'Color Grading'] },
      cvMatchPercent: 29,
    });
    expect(a.cvReading!.fit!.parts.map((p) => [p.key, p.score])).toEqual([
      ['skills', 50],
      ['title', 0],
    ]);
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
    // "بريمير" is Premiere Pro's Arabic name in the skills dictionary (found so since 25 October 2026): 1 of 4 (25 × 35 ÷ 60 = 15)
    expect(a.cvReading).toMatchObject({ education: 'bachelor', languages: ['English', 'Arabic'], skills: { found: ['Premiere Pro'], missing: vacancy.keySkills.slice(1) }, cvMatchPercent: 15 });
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
    expect((await list('')).find((a) => a.id === mona)?.cvMatchPercent).toBe(29);
    expect((await list('&minCvMatch=29')).map((a) => a.id)).toEqual([mona]);
    expect((await list('&sort=cv'))[0].id).toBe(mona);
    expect((await list(`&q=zanzibarlogic${RUN}`)).map((a) => a.id)).toEqual([mona]);
  });

  it('key skills changed after people applied score every application again, and are in the audit log', async () => {
    const changed = (await patch('hr', `/recruitment/vacancies/${vacancy.id}`, { keySkills: ['Premiere Pro', 'After Effects', 'بريمير برو'] }).expect(200)).body as VacancyView;
    expect(changed.keySkills).toEqual(['Premiere Pro', 'After Effects', 'بريمير برو']);
    const rows = await prisma.jobApplication.findMany({ where: { vacancyId: vacancy.id }, select: { email: true, cvMatchPercent: true } });
    // 2 of the 3 each (the Arabic CV's "بريمير برو" and "Premiere Pro" under its Arabic name): 67 × 35 ÷ 60 = 39
    expect(Object.fromEntries(rows.map((r) => [r.email.split('.')[0], r.cvMatchPercent]))).toEqual({ mona: 39, arabic: 39, empty: null, failing: null });
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

  let sara: string;

  it('reads HR’s general CVs too, searchable by their text', async () => {
    let req = api().post('/api/recruitment/general-cvs').set('Cookie', sessions.hr);
    const fields = { fullName: `Sara General ${RUN}`, email: email('sara'), mobile: '+20 100 999 8877', departmentId, consent: 'true', source: 'email' };
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    const added = (await req.attach('cv', await pdfOf(['Sara General', 'Experience', 'Designer 2018 - 2020', `Figmaquest${RUN}`, 'Figma, Photoshop', 'Master of Design']), 'sara.pdf').expect(201)).body as GeneralCvView;
    sara = added.id;
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

  // ---------- more from each CV (24 October 2026) ----------

  it('finds the work history, the latest role, the education details, the skills, the certifications and the city', async () => {
    const a = (await get('hr', `/recruitment/applications/${mona}`).expect(200)).body as ApplicationView;
    expect(a.cvReading).toMatchObject({
      latestTitle: 'Senior Video Editor',
      latestCompany: 'Bright Studio',
      workHistory: [
        { pastTitle: 'Senior Video Editor', pastCompany: 'Bright Studio', from: '2022-01', to: null, current: true },
        { pastTitle: 'Video Editor', pastCompany: 'Nile Media', from: '2019-03', to: '2021-12', current: false },
      ],
      educationDetails: [{ institution: 'Helwan University', degree: 'Bachelor of Fine Arts', graduationYear: 2018 }],
      cvSkills: ['Premiere Pro', 'After Effects', 'Google Ads'],
      certifications: ['Google Ads Search Certification, 2021'],
      city: 'Nasr City',
    });
    // a scan read by the OCR service in Arabic: its job and school too
    const arabic = (await prisma.jobApplication.findFirstOrThrow({ where: { email: email('arabic') }, select: { id: true } })).id;
    const ar = (await get('hr', `/recruitment/applications/${arabic}`).expect(200)).body as ApplicationView;
    expect(ar.cvReading).toMatchObject({
      latestTitle: 'مونتير',
      latestCompany: 'استوديو برايت',
      educationDetails: [{ institution: 'جامعة القاهرة', degree: 'بكالوريوس الإعلام', graduationYear: 2019 }],
      cvSkills: ['Premiere Pro'],
    });
    const g = (await get('hr', `/recruitment/general-cvs/${sara}`).expect(200)).body as GeneralCvView;
    expect(g.cvReading).toMatchObject({ latestTitle: 'Designer', latestCompany: null, cvSkills: ['Figma', 'Photoshop'], certifications: [], city: null });
  });

  it('lists the CV’s years where none were typed, filters by them on both tabs and Candidates, and sorts by them', async () => {
    const idOf = async (who: string) => (await prisma.jobApplication.findFirstOrThrow({ where: { email: who }, select: { id: true } })).id;
    const arabic = await idOf(email('arabic'));
    const karim = await idOf(`karim.ocr.${RUN}@mail.test`);
    // typed years win over the CV's (the Arabic CV's dates say over 6 years)
    await prisma.jobApplication.update({ where: { id: arabic }, data: { yearsExperience: 3 } });
    const list = (q: string) => get('hr', `/recruitment/applications?vacancyId=${vacancy.id}&filtered=all${q}`).expect(200).then((r) => r.body as ApplicationListItem[]);
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
    const all = await list('');
    const m = all.find((x) => x.id === mona)!;
    expect(m.yearsExperience).toBeNull();
    expect(m.fromCv).toMatchObject({ status: 'read', latestTitle: 'Senior Video Editor', latestCompany: 'Bright Studio' });
    // March 2019 to now
    expect(m.fromCv!.experienceMonths).toBeGreaterThanOrEqual(90);
    expect(all.find((x) => x.id === arabic)).toMatchObject({ yearsExperience: 3, fromCv: { status: 'read' } });
    expect(all.find((x) => x.id === karim)!.fromCv).toMatchObject({ status: 'read', experienceMonths: 24, latestTitle: 'Editor', latestCompany: null });
    expect(all.find((x) => x.email === email('empty'))!.fromCv).toMatchObject({ status: 'no_text', experienceMonths: null });
    expect(all.find((x) => x.email === email('failing'))!.fromCv).toMatchObject({ status: 'failed', experienceMonths: null });
    // 2+: Karim's 24 months; 3+: Arabic's typed 3; 5+: Mona's CV alone (Arabic's typed 3, though its CV says more)
    expect(ids(await list('&minYears=2'))).toEqual([mona, arabic, karim].sort());
    expect(ids(await list('&minYears=3'))).toEqual([mona, arabic].sort());
    expect(ids(await list('&minYears=5'))).toEqual([mona]);
    expect(await list('&minYears=20')).toEqual([]);
    // most experience first, those without any last
    expect((await list('&sort=years')).map((r) => r.id).slice(0, 3)).toEqual([mona, arabic, karim]);
    // by a skill of the dictionary (the Arabic CV's "بريمير برو" is Premiere Pro)
    expect(ids(await list(`&skill=${encodeURIComponent('Premiere Pro')}`))).toEqual([mona, arabic].sort());
    expect(await list('&skill=Figma')).toEqual([]);
    expect(said(await get('hr', '/recruitment/applications?skill=Juggling').expect(400))).toEqual(['Choose a skill from the list.']);

    // the General CVs tab: Sara's 2 years (2018 – 2020), none typed
    const general = (q: string) => get('hr', `/recruitment/general-cvs?q=${RUN}${q}`).expect(200).then((r) => r.body as GeneralCvListItem[]);
    expect((await general('')).find((c) => c.id === sara)).toMatchObject({ yearsExperience: null, fromCv: { status: 'read', experienceMonths: 24, latestTitle: 'Designer', latestCompany: null } });
    expect(ids(await general('&minYears=2'))).toEqual([sara]);
    expect(await general('&minYears=3')).toEqual([]);
    expect(ids(await general('&skill=Figma'))).toEqual([sara]);
    expect(await general('&skill=Canva')).toEqual([]);
    await get('hr', '/recruitment/general-cvs?skill=Juggling').expect(400);

    // Candidates: the years of their applications and general CVs, typed else the CV's
    const candidates = (q: string) => get('hr', `/recruitment/candidates?q=${RUN}${q}`).expect(200).then((r) => r.body as CandidateListItem[]);
    const monaCandidate = (await prisma.jobApplication.findUniqueOrThrow({ where: { id: mona }, select: { candidateId: true } })).candidateId!;
    const arabicCandidate = (await prisma.jobApplication.findUniqueOrThrow({ where: { id: arabic }, select: { candidateId: true } })).candidateId!;
    const c = await candidates('');
    expect(c.find((x) => x.id === monaCandidate)).toMatchObject({ yearsExperience: null, fromCv: { status: 'read', latestTitle: 'Senior Video Editor' } });
    expect(c.find((x) => x.id === arabicCandidate)).toMatchObject({ yearsExperience: 3 });
    expect((await candidates('&minYears=5')).map((x) => x.id)).toEqual([monaCandidate]);
    expect(ids(await candidates('&minYears=3'))).toEqual([monaCandidate, arabicCandidate].sort());
  });

  it('a CV just in, not read yet, is "Reading…" on the lists', async () => {
    // enough text of its own (a PDF with next to none is a scan's, for the OCR service)
    const id = await apply('newcomer', '10.4.0.9', await pdfOf(['Nour Newcomer', 'An editor of short films and brand videos.', 'Experience', 'Editor 2020 - 2024']));
    const rows = (await get('hr', `/recruitment/applications?vacancyId=${vacancy.id}`).expect(200)).body as ApplicationListItem[];
    expect(rows.find((r) => r.id === id)).toMatchObject({ yearsExperience: null, fromCv: { status: 'pending', experienceMonths: null } });
    await drain();
    const after = (await get('hr', `/recruitment/applications?vacancyId=${vacancy.id}`).expect(200)).body as ApplicationListItem[];
    expect(after.find((r) => r.id === id)!.fromCv).toMatchObject({ status: 'read', experienceMonths: 48 });
  });

  it('works out again the facts of the CVs read before, from their kept text: no OCR, once', async () => {
    const arabic = (await prisma.jobApplication.findFirstOrThrow({ where: { email: email('arabic') }, select: { id: true } })).id;
    const before = await prisma.cvReading.findUniqueOrThrow({ where: { applicationId: arabic }, select: { facts: true, text: true } });
    // facts as kept before 24 October 2026 (version 1): the contacts, years, level and languages only
    const old = (f: unknown) => {
      const { emails, phones, linkedin, links, experienceMonths, education, languages } = f as Record<string, unknown>;
      return { emails, phones, linkedin, links, experienceMonths, education, languages };
    };
    for (const applicationId of [mona, arabic]) {
      const r = await prisma.cvReading.findUniqueOrThrow({ where: { applicationId }, select: { facts: true } });
      await prisma.cvReading.update({ where: { applicationId }, data: { facts: old(r.facts) as object } });
    }
    // read back with the new facts empty
    expect(((await get('hr', `/recruitment/applications/${mona}`).expect(200)).body as ApplicationView).cvReading).toMatchObject({ latestTitle: null, workHistory: [], cvSkills: [], city: null });
    const calls = ocr.calls.length;
    // the recruitment round, under its lock
    await app.get(RecruitmentSchedulerService).runOnce();
    expect(ocr.calls.length).toBe(calls);
    const after = await prisma.cvReading.findUniqueOrThrow({ where: { applicationId: arabic }, select: { facts: true, text: true, method: true, updatedAt: true } });
    expect(after).toMatchObject({ text: before.text, method: 'ocr_ar', facts: { version: CV_FACTS_VERSION, latestTitle: 'مونتير', latestCompany: 'استوديو برايت' } });
    expect(after.facts).toEqual(before.facts);
    expect(((await get('hr', `/recruitment/applications/${mona}`).expect(200)).body as ApplicationView).cvReading).toMatchObject({ latestTitle: 'Senior Video Editor', city: 'Nasr City' });
    // once: nothing left to work out again, nothing written
    expect(await readings.refreshFacts()).toBe(0);
    await app.get(RecruitmentSchedulerService).runOnce();
    expect((await prisma.cvReading.findUniqueOrThrow({ where: { applicationId: arabic }, select: { updatedAt: true } })).updatedAt).toEqual(after.updatedAt);
  });

  it('masks a developer’s view of them: the past jobs, schools, certifications and city; the years and skills stay', async () => {
    const seen = (await get('developer', `/recruitment/applications/${mona}`).expect(200)).body as ApplicationView;
    expect(seen.cvReading).toMatchObject({
      latestTitle: HIDDEN,
      latestCompany: HIDDEN,
      workHistory: [
        { pastTitle: HIDDEN, pastCompany: HIDDEN, from: '2022-01', to: null, current: true },
        { pastTitle: HIDDEN, pastCompany: HIDDEN, from: '2019-03', to: '2021-12', current: false },
      ],
      educationDetails: [{ institution: HIDDEN, degree: null, graduationYear: null }],
      cvSkills: ['Premiere Pro', 'After Effects', 'Google Ads'],
      certifications: [HIDDEN],
      city: HIDDEN,
    });
    const rows = (await get('developer', `/recruitment/applications?vacancyId=${vacancy.id}`).expect(200)).body as ApplicationListItem[];
    const text = JSON.stringify(rows);
    for (const v of ['Senior Video Editor', 'Bright Studio', 'Nile Media']) expect(text).not.toContain(v);
    expect(rows.some((r) => r.fromCv?.latestTitle === HIDDEN && (r.fromCv.experienceMonths ?? 0) >= 90)).toBe(true);
    const general = JSON.stringify([(await get('developer', `/recruitment/general-cvs/${sara}`).expect(200)).body, (await get('developer', '/recruitment/candidates').expect(200)).body]);
    expect(general).not.toContain('"Designer"');
    expect(general).not.toContain('Senior Video Editor');
  });

  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
});
