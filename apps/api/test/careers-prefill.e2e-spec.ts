import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import type { INestApplication } from '@nestjs/common';
import {
  CAREERS_SITE_STANDARD,
  careersIpToken,
  CLIENT_IP_AT_HEADER,
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  CV_PREFILL_IP_TOKEN,
  GENERAL_CV_IP_TOKEN,
  LINKEDIN_AUTHORIZE_URL,
  LINKEDIN_IP_TOKEN,
  LINKEDIN_ISSUER,
  LINKEDIN_TOKEN_URL,
  LINKEDIN_USERINFO_URL,
  PORTFOLIO_KINDS,
  positionKeyOf,
  positionNameOf,
  type ApplicationView,
  type CvPrefillResult,
  type GeneralCvView,
  type LinkedInFinish,
  type LinkedInSettingsView,
  type LinkedInStart,
  type PortfolioSettingsView,
  type PublicGeneralForm,
  type PublicVacancyView,
  type Role,
  type ScreeningComments,
  type VacancyView,
} from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { LinkedInHttp, type LinkedInFetch } from '../src/recruitment/linkedin-http.js';
import { docx, p, r } from './fixtures/docx.js';
import { createApp, createUser, signIn } from './helpers.js';

// The careers forms filled in from the CV, "Fill in with LinkedIn" and a portfolio per position (owner, 25 October 2026,
// on "Apply for This Job": "can i use linkedin to complete the data? and for creatives, they need to add their
// portfolios. so based on the positions i have, what kind of portfolios i might need to ask them for?"; asked, all
// three). The CV read on the spot (a PDF and a Word file) answers what it found and keeps nothing; its types, size and
// hourly cap. A video editor's job asks for a showreel (Required by the rule): refused without one or with a malformed
// link, taken with a Vimeo link; an accountant's job asks for none (what is sent is left aside), until its vacancy says
// Required (a PDF case study enough). Recruitment Settings' "Portfolio on the Forms" (HR changes, audited) and a
// position merging two job titles asking the strictest; "LinkedIn Sign-in" (a Super Admin's: the secret sealed, never
// sent back, audited only as changed). Each position's section title, the portfolio part's heading (owner, 26 October
// 2026: "a section title per position"): the rule's on the job page and the general form, HR's once set (audited), kept
// by a vacancy's own mode, shown on the application, the general CV and the CV window, blank back to the rule's.
// LinkedIn's sign-in against a fake LinkedIn: a bad state refused without calling
// it, a cancelled one said so, a good one giving the name and the verified email, which marks the application
// "Confirmed by LinkedIn" (only for that email and that form). A developer sees none of it. Every name is invented; the
// test deletes what it made.

const RUN = `cp${Date.now().toString(36)}`;
const STARTED = new Date();
const TODAY = todayInCairo();
const CLIENT_ID = `86tl${RUN}`;
const CLIENT_SECRET = `s3cr3t-${RUN}-do-not-echo`;
const ORIGIN = 'https://people.example.test';
/** LinkedIn's redirect URL: the careers site of Recruitment Settings (the standard here) and /linkedin/callback, never ORIGIN's (25 October 2026). */
const CALLBACK = `${CAREERS_SITE_STANDARD}/linkedin/callback`;

/** Each person's own mobile: +2010 and 8 digits. */
const mobileOf = (who: string) => {
  const key = `${who}|${RUN}`;
  let h = 7;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return `+2010${String(h % 100_000_000).padStart(8, '0')}`;
};

/** A PDF with these lines of text (none: a scan, no text). */
async function pdfOf(lines: string[] = []): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 760 - i * 20, size: 12, font }));
  return Buffer.from(await doc.save());
}

/** An ID token as LinkedIn's token address gives it (its signature isn't checked: it came straight from LinkedIn). */
const idToken = (claims: Record<string, unknown>) => `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2ln`;

describe('Careers forms: filled from the CV, LinkedIn sign-in, portfolio per position (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  let departmentId: string;
  let teamId: string;
  let editorTitleId: string;
  let accountantTitleId: string;
  let juniorMotionId: string;
  let seniorMotionId: string;
  let editorJob: VacancyView;
  let accountantJob: VacancyView;
  let cv: Buffer;
  let ipCount = 0;
  /** A new address each time, so no hourly limit is shared between the cases. */
  const nextIp = () => `198.51.${100 + Math.floor(ipCount / 200)}.${(ipCount++ % 200) + 1}`;

  const as = (who: string) => ({
    get: (path: string) => api().get(`/api${path}`).set('Cookie', sessions[who]),
    put: (path: string, body: object) => api().put(`/api${path}`).set('Cookie', sessions[who]).send(body),
    patch: (path: string, body: object) => api().patch(`/api${path}`).set('Cookie', sessions[who]).send(body),
    post: (path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[who]).send(body),
  });
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  const email = (who: string) => `${who}.${RUN}@mail.test`;

  async function account(key: string, roles: Role[]) {
    const e = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email: e } })).id;
    sessions[key] = await signIn(app, e);
    return e;
  }

  /** The headers of an address the website signed for `token`. */
  const signed = (ip: string, token: string) => {
    const at = String(Date.now());
    return { [CLIENT_IP_HEADER]: ip, [CLIENT_IP_AT_HEADER]: at, [CLIENT_IP_SIGNATURE_HEADER]: signatureOf(process.env.WEB_KEY!, ip, at, token) };
  };

  /** The CV read for the form, as the website sends it (its address signed for the prefill). */
  function prefill(file: Buffer | null, name = 'My CV.pdf', ip = nextIp()) {
    const req = api().post('/api/public/cv-prefill').set('x-careers-key', process.env.CAREERS_KEY!).set(signed(ip, CV_PREFILL_IP_TOKEN)).field('ip', ip);
    return file ? req.attach('cv', file, name) : req;
  }

  /** An application as the website sends it. */
  function apply(job: VacancyView, who: string, extra: Record<string, string> = {}, files: { portfolioFile?: Buffer } = {}) {
    const ip = nextIp();
    let req = api().post(`/api/public/careers/${job.slug}/apply`).set('x-careers-key', process.env.CAREERS_KEY!).set(signed(ip, careersIpToken(job.slug)));
    const fields = { fullName: `${who} Person ${RUN}`, email: email(who), mobile: mobileOf(who), yearsExperience: '3', consent: 'true', answers: '{}', ip, ...extra };
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    req = req.attach('cv', cv, 'My CV.pdf');
    return files.portfolioFile ? req.attach('portfolioFile', files.portfolioFile, 'Case study.pdf') : req;
  }

  /** "Send us your CV" as the website sends it. */
  function sendGeneral(who: string, extra: Record<string, string>) {
    const ip = nextIp();
    let req = api().post('/api/public/general-cvs').set('x-careers-key', process.env.CAREERS_KEY!).set(signed(ip, GENERAL_CV_IP_TOKEN));
    const fields = { fullName: `${who} Person ${RUN}`, email: email(who), mobile: mobileOf(who), consent: 'true', ip, ...extra };
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('cv', cv, 'My CV.pdf');
  }

  const applicationOf = (who: string) => prisma.jobApplication.findFirstOrThrow({ where: { email: email(who) }, include: { portfolioFile: true } });

  async function openJob(jobTitleId: string): Promise<VacancyView> {
    const made = (await as('hr').post('/recruitment/vacancies', { jobTitleId, employmentType: 'full_time', headcount: 3, closingDate: addDays(TODAY, 30), about: '<p>A made-up role.</p>' }).expect(201))
      .body as VacancyView;
    await as('hr').post(`/recruitment/vacancies/${made.id}/submit`).expect(200);
    return (await as('ceo').post(`/recruitment/vacancies/${made.id}/approve`).expect(200)).body as VacancyView;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await account('superAdmin', ['super_admin']);
    await account('outsider', ['employee']);
    const devEmail = await account('developer', ['employee']);
    await as('superAdmin').patch(`/users/${users.developer}`, { roles: ['employee', 'developer'] }).expect(200);
    sessions.developer = await signIn(app, devEmail);
    // none set up before this run's cases
    await prisma.linkedInSettings.deleteMany({});

    departmentId = (await prisma.department.create({ data: { nameEn: `Studio ${RUN}` }, select: { id: true } })).id;
    teamId = (await prisma.department.create({ data: { nameEn: `Post ${RUN}`, parentId: departmentId }, select: { id: true } })).id;
    const title = (titleEn: string) => prisma.jobTitle.create({ data: { departmentId: teamId, titleEn }, select: { id: true } }).then((t) => t.id);
    editorTitleId = await title(`Video Editor ${RUN}`);
    accountantTitleId = await title(`Accountant ${RUN}`);
    juniorMotionId = await title(`Junior Motion Designer ${RUN}`);
    seniorMotionId = await title(`Senior Motion Designer ${RUN}`);
    editorJob = await openJob(editorTitleId);
    accountantJob = await openJob(accountantTitleId);
    cv = await pdfOf(['A made-up CV']);
  });

  afterAll(async () => {
    const titles = [editorTitleId, accountantTitleId, juniorMotionId, seniorMotionId];
    await prisma.generalCv.deleteMany({ where: { email: { endsWith: `.${RUN}@mail.test` } } });
    await prisma.jobApplication.deleteMany({ where: { vacancy: { jobTitleId: { in: titles } } } });
    await prisma.vacancy.deleteMany({ where: { jobTitleId: { in: titles } } });
    await prisma.jobTitle.deleteMany({ where: { id: { in: titles } } });
    await prisma.department.deleteMany({ where: { id: teamId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await prisma.linkedInSettings.deleteMany({});
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    // "New CVs" and "New applications" told to every HR account there was, once a day: taken back so the next file's are sent
    await prisma.notification.deleteMany({
      where: { kind: 'applications_new', createdAt: { gte: STARTED }, link: { in: ['/recruitment/applicants?tab=general', ...[editorJob, accountantJob].filter(Boolean).map((v) => `/recruitment/vacancies/${v.id}`)] } },
    });
    await app.close();
  });

  // ---------- the CV read for the form ----------

  it('reads a PDF and a Word CV for the form, and keeps nothing', async () => {
    const counts = () =>
      Promise.all([prisma.jobApplication.count(), prisma.generalCv.count(), prisma.cvUpload.count(), prisma.cvReading.count(), prisma.jobApplicationCv.count(), prisma.generalCvFile.count()]);
    const before = await counts();
    const lines = ['Curriculum Vitae', 'Mona Adel', `mona.adel.${RUN}@mail.test`, 'Mobile: +20 100 123 4567', `linkedin.com/in/mona-adel-${RUN}`, 'Showreel: vimeo.com/123456789', 'Experience', 'Video Editor, A Studio, Jan 2018 - Dec 2021'];
    const expected = {
      read: true,
      fullName: 'Mona Adel',
      email: `mona.adel.${RUN}@mail.test`,
      mobile: '+201001234567',
      linkedin: `https://www.linkedin.com/in/mona-adel-${RUN}`,
      portfolioLinks: [{ url: 'https://vimeo.com/123456789', kind: 'vimeo' }],
      // Jan 2018 – Dec 2021: 3 years 11 months, rounded down
      yearsExperience: 3,
    };
    const fromPdf = (await prefill(await pdfOf(lines)).expect(200)).body as CvPrefillResult;
    expect(fromPdf).toEqual(expected);
    const word = docx({ body: lines.map((l) => p(r(l))).join('') });
    const fromWord = (await prefill(word, 'My CV.docx').expect(200)).body as CvPrefillResult;
    expect(fromWord).toEqual(expected);
    // Arabic digits in a Word file
    const arabic = (await prefill(docx({ body: [p(r('Omar Khaled')), p(r('موبايل ٠١٢٢٣٤٥٦٧٨٩'))].join('') }), 'CV.docx').expect(200)).body as CvPrefillResult;
    expect(arabic).toMatchObject({ read: true, fullName: 'Omar Khaled', mobile: '+201223456789' });
    // nothing kept: no row, no file
    expect(await counts()).toEqual(before);
  });

  it('refuses another type, no file and one over 5 MB; says when a file has no text; about 20 an hour from one address', async () => {
    expect(said(await prefill(Buffer.from('just some text'), 'cv.txt').expect(400))).toEqual(['Your CV must be a PDF or a Word file (.docx).']);
    expect(said(await prefill(null).expect(400))).toEqual(['Attach your CV, as a PDF or a Word file.']);
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(5 * 1024 * 1024 + 100, 0x20)]);
    expect(said(await prefill(big).expect(413))).toEqual(['Your CV must be 5 MB or smaller.']);
    // a scan: no text to read
    const scan = await pdfOf([]);
    expect((await prefill(scan).expect(200)).body).toEqual({ read: false, fullName: null, email: null, mobile: null, linkedin: null, portfolioLinks: [], yearsExperience: null });
    // the hourly cap, by the address the website signed
    const ip = nextIp();
    for (let i = 0; i < 20; i++) await prefill(scan, 'scan.pdf', ip).expect(200);
    expect(said(await prefill(scan, 'scan.pdf', ip).expect(429))[0]).toMatch(/fill in the form yourself/);
    // another address still reads
    await prefill(scan).expect(200);
  });

  // ---------- the portfolio on a job's form ----------

  it('a video editor’s job asks for a showreel: refused without one or malformed, taken with a Vimeo link', async () => {
    const page = (await api().get(`/api/public/careers/${editorJob.slug}`).set('x-careers-key', process.env.CAREERS_KEY!).expect(200)).body as PublicVacancyView;
    expect(page.portfolio).toEqual({ mode: 'required', title: 'Your showreel', hint: 'A 1–2 minute showreel', kinds: ['vimeo', 'youtube', 'google_drive', 'frame_io'], maxLinks: 3 });
    expect(page.linkedinSignIn).toBe(false);

    expect(said(await apply(editorJob, 'nolink').expect(400))).toContain('Add your portfolio: a 1–2 minute showreel.');
    expect(said(await apply(editorJob, 'malformed', { portfolioLinks: JSON.stringify(['https://vimeo.com/']) }).expect(400))).toContain(
      'This doesn’t look like a Vimeo link: write it as vimeo.com/123456789.',
    );
    expect(said(await apply(editorJob, 'insta', { portfolioLinks: JSON.stringify(['instagram.com/mona']) }).expect(400))[0]).toMatch(/^Instagram isn’t asked for here/);
    expect(await prisma.jobApplication.count({ where: { email: { in: [email('nolink'), email('malformed'), email('insta')] } } })).toBe(0);

    await apply(editorJob, 'vimeo', { portfolioLinks: JSON.stringify(['vimeo.com/123456789', '']) }).expect(201);
    const row = await applicationOf('vimeo');
    expect(row).toMatchObject({ portfolioLinks: ['https://vimeo.com/123456789'], portfolio: 'https://vimeo.com/123456789', emailConfirmedBy: null, portfolioFile: null });
    const view = (await as('hr').get(`/recruitment/applications/${row.id}`).expect(200)).body as ApplicationView;
    expect(view).toMatchObject({ portfolioLinks: ['https://vimeo.com/123456789'], portfolioFile: null, emailConfirmedBy: null });
    // an older page's one "portfolio" is still taken
    await apply(editorJob, 'older', { portfolio: 'youtu.be/dQw4w9WgXcQ' }).expect(201);
    expect((await applicationOf('older')).portfolioLinks).toEqual(['https://youtu.be/dQw4w9WgXcQ']);
  });

  it('an accountant’s job asks for none: what is sent is left aside', async () => {
    const page = (await api().get(`/api/public/careers/${accountantJob.slug}`).set('x-careers-key', process.env.CAREERS_KEY!).expect(200)).body as PublicVacancyView;
    expect(page.portfolio).toMatchObject({ mode: 'hidden', title: 'Your work samples' });
    await apply(accountantJob, 'hidden', { portfolioLinks: JSON.stringify(['not a link at all']), portfolio: 'nor this' }, { portfolioFile: await pdfOf(['A case study']) }).expect(201);
    expect(await applicationOf('hidden')).toMatchObject({ portfolioLinks: [], portfolio: null, portfolioFile: null });
  });

  it('the vacancy says otherwise: Required on an accountant’s job, a PDF case study enough; then as the job title again', async () => {
    const changed = (await as('hr').patch(`/recruitment/vacancies/${accountantJob.id}`, { portfolioMode: 'required' }).expect(200)).body as VacancyView;
    expect(changed).toMatchObject({ portfolioMode: 'required', jobTitlePortfolio: { mode: 'hidden' } });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: accountantJob.id, action: 'update' }, orderBy: { at: 'desc' } });
    expect(audit.diff).toMatchObject({ portfolioMode: { from: null, to: 'required' } });
    const page = (await api().get(`/api/public/careers/${accountantJob.slug}`).set('x-careers-key', process.env.CAREERS_KEY!).expect(200)).body as PublicVacancyView;
    // the job title's section title, as its hint (26 October 2026)
    expect(page.portfolio).toMatchObject({ mode: 'required', title: 'Your work samples', hint: null, kinds: [...PORTFOLIO_KINDS] });

    expect(said(await apply(accountantJob, 'override-none').expect(400)).some((m) => m.startsWith('Add your portfolio:'))).toBe(true);
    expect(said(await apply(accountantJob, 'override-word', {}, { portfolioFile: Buffer.from('PK not a pdf') }).expect(400))).toContain('Your portfolio file must be a PDF.');
    await apply(accountantJob, 'override-pdf', {}, { portfolioFile: await pdfOf(['My case study']) }).expect(201);
    const row = await applicationOf('override-pdf');
    expect(row.portfolioFile).toMatchObject({ mimeType: 'application/pdf', fileName: 'Case study.pdf' });
    const view = (await as('hr').get(`/recruitment/applications/${row.id}`).expect(200)).body as ApplicationView;
    expect(view.portfolioFile).toEqual({ fileName: 'Case study.pdf', sizeBytes: row.portfolioFile!.sizeBytes });
    const file = await as('hr').get(`/recruitment/applications/${row.id}/portfolio-file`).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(file.body as Buffer).subarray(0, 5).toString('ascii')).toBe('%PDF-');
    await as('outsider').get(`/recruitment/applications/${row.id}/portfolio-file`).expect(404);

    await as('hr').patch(`/recruitment/vacancies/${accountantJob.id}`, { portfolioMode: null }).expect(200);
    expect(((await api().get(`/api/public/careers/${accountantJob.slug}`).set('x-careers-key', process.env.CAREERS_KEY!).expect(200)).body as PublicVacancyView).portfolio?.mode).toBe('hidden');
  });

  // ---------- Recruitment Settings: "Portfolio on the Forms" ----------

  it('HR sets a position’s portfolio (audited); one set like its default keeps no row; the CEO reads, nobody else', async () => {
    const accountantKey = positionKeyOf(teamId, positionNameOf(`Accountant ${RUN}`));
    const view = (await as('ceo').get('/recruitment/settings/portfolio').expect(200)).body as PortfolioSettingsView;
    const accountant = view.positions.find((x) => x.key === accountantKey)!;
    expect(accountant).toMatchObject({ set: false, mixed: false, ask: { mode: 'hidden' }, defaultAsk: { mode: 'hidden' }, titles: [`Accountant ${RUN}`] });
    await as('outsider').get('/recruitment/settings/portfolio').expect(403);
    const setting = { key: accountantKey, mode: 'optional', hint: 'Your GitHub', kinds: ['github'], maxLinks: 1 };
    await as('ceo').put('/recruitment/settings/portfolio', { positions: [setting] }).expect(403);
    expect(said(await as('hr').put('/recruitment/settings/portfolio', { positions: [{ ...setting, kinds: [] }] }).expect(400))).toEqual([`Choose at least one kind of portfolio for Accountant ${RUN}.`]);
    expect(said(await as('hr').put('/recruitment/settings/portfolio', { positions: [{ ...setting, key: `${teamId}:nothing like it` }] }).expect(400))[0]).toMatch(/positions changed/);

    const saved = (await as('hr').put('/recruitment/settings/portfolio', { positions: [setting] }).expect(200)).body as PortfolioSettingsView;
    expect(saved.positions.find((x) => x.key === accountantKey)).toMatchObject({ set: true, ask: { mode: 'optional', hint: 'Your GitHub', kinds: ['github'], maxLinks: 1 } });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'recruitment_settings', userId: users.hr }, orderBy: { at: 'desc' } });
    expect((audit.diff as { portfolioOnForms: string[] }).portfolioOnForms).toEqual([
      `Accountant ${RUN} (Post ${RUN} · Studio ${RUN}): Hidden; title “Your work samples” → Optional: github; 1 link; “Your GitHub”; title “Your work samples”`,
    ]);
    // the job's form asks for it now, one link at most
    expect(((await api().get(`/api/public/careers/${accountantJob.slug}`).set('x-careers-key', process.env.CAREERS_KEY!).expect(200)).body as PublicVacancyView).portfolio).toEqual({
      mode: 'optional',
      title: 'Your work samples',
      hint: 'Your GitHub',
      kinds: ['github'],
      maxLinks: 1,
    });
    expect(said(await apply(accountantJob, 'two-links', { portfolioLinks: JSON.stringify(['github.com/a-dev', 'github.com/b-dev']) }).expect(400))).toEqual(['Add one portfolio link.']);

    // back to its default: no row
    await as('hr').put('/recruitment/settings/portfolio', { positions: [{ key: accountantKey, mode: 'hidden', hint: null, kinds: [], maxLinks: 3 }] }).expect(200);
    expect(await prisma.portfolioSetting.count({ where: { jobTitleId: accountantTitleId } })).toBe(0);
  });

  // reported 25 October 2026: a position set to Hidden lost its hint and platforms, while the form says "The kinds and
  // hint stay for a vacancy that asks for one anyway" (owner, 26 October 2026: "yes", keep them)
  it('a position set to Hidden keeps its hint, platforms, links and title: read back, saved again as shown, Optional again, asked anyway by a vacancy', async () => {
    const accountantKey = positionKeyOf(teamId, positionNameOf(`Accountant ${RUN}`));
    const kept = { title: 'Your spreadsheets', hint: 'Models you built, on Drive or your own site', kinds: ['google_drive', 'website'], maxLinks: 2 };
    const read = async () => ((await as('hr').get('/recruitment/settings/portfolio').expect(200)).body as PortfolioSettingsView).positions.find((x) => x.key === accountantKey)!;
    const jobPage = async () => ((await api().get(`/api/public/careers/${accountantJob.slug}`).set('x-careers-key', process.env.CAREERS_KEY!).expect(200)).body as PublicVacancyView).portfolio;

    await as('hr').put('/recruitment/settings/portfolio', { positions: [{ key: accountantKey, mode: 'optional', ...kept }] }).expect(200);
    expect(await read()).toMatchObject({ set: true, ask: { mode: 'optional', ...kept } });

    // Hidden, everything else as it was (the form sends every field of the row)
    const saved = (await as('hr').put('/recruitment/settings/portfolio', { positions: [{ key: accountantKey, mode: 'hidden', ...kept }] }).expect(200)).body as PortfolioSettingsView;
    expect(saved.positions.find((x) => x.key === accountantKey)).toMatchObject({ set: true, ask: { mode: 'hidden', ...kept } });
    expect(await prisma.portfolioSetting.findUniqueOrThrow({ where: { jobTitleId: accountantTitleId } })).toMatchObject({ mode: 'hidden', ...kept });
    const shown = await read();
    expect(shown).toMatchObject({ set: true, ask: { mode: 'hidden', ...kept } });

    // the page saved again as it shows the row (every row is sent on Save): still kept
    const again = { key: accountantKey, mode: shown.ask.mode, title: shown.ask.title, hint: shown.ask.hint, kinds: shown.ask.kinds, maxLinks: shown.ask.maxLinks };
    await as('hr').put('/recruitment/settings/portfolio', { positions: [again] }).expect(200);
    expect(await read()).toMatchObject({ set: true, ask: { mode: 'hidden', ...kept } });

    // the careers forms still don't ask: the job's form hidden, "Send us your CV" leaves it out
    expect((await jobPage())?.mode).toBe('hidden');
    const form = (await api().get('/api/public/general-cvs/form').set('x-careers-key', process.env.CAREERS_KEY!).expect(200)).body as PublicGeneralForm;
    expect(form.portfolios?.[accountantKey]).toBeUndefined();

    // a vacancy asking anyway uses them
    await as('hr').patch(`/recruitment/vacancies/${accountantJob.id}`, { portfolioMode: 'optional' }).expect(200);
    expect(await jobPage()).toEqual({ mode: 'optional', ...kept });
    await as('hr').patch(`/recruitment/vacancies/${accountantJob.id}`, { portfolioMode: null }).expect(200);

    // Optional again: they are there
    await as('hr').put('/recruitment/settings/portfolio', { positions: [{ ...again, mode: 'optional' }] }).expect(200);
    expect(await read()).toMatchObject({ set: true, ask: { mode: 'optional', ...kept } });
    expect(await jobPage()).toEqual({ mode: 'optional', ...kept });

    // back to its default: no row
    await as('hr').put('/recruitment/settings/portfolio', { positions: [{ key: accountantKey, mode: 'hidden', hint: null, kinds: [], maxLinks: 3 }] }).expect(200);
    expect(await prisma.portfolioSetting.count({ where: { jobTitleId: accountantTitleId } })).toBe(0);
  });

  it('"Send us your CV": a position merging two job titles asks the strictest of theirs', async () => {
    const motionKey = positionKeyOf(teamId, positionNameOf(`Junior Motion Designer ${RUN}`));
    // the junior one set apart (a job title added since the position was set): Optional, GitHub
    await prisma.portfolioSetting.create({ data: { jobTitleId: juniorMotionId, mode: 'optional', kinds: ['github'], maxLinks: 1 } });
    const settings = (await as('hr').get('/recruitment/settings/portfolio').expect(200)).body as PortfolioSettingsView;
    expect(settings.positions.find((x) => x.key === motionKey)).toMatchObject({ mixed: true, set: true, ask: { mode: 'required', kinds: ['behance', 'vimeo', 'youtube', 'github'] } });
    const form = (await api().get('/api/public/general-cvs/form').set('x-careers-key', process.env.CAREERS_KEY!).expect(200)).body as PublicGeneralForm;
    expect(form.portfolios?.[motionKey]).toEqual({ mode: 'required', title: 'Your showreel', hint: 'A showreel on Vimeo or YouTube', kinds: ['behance', 'vimeo', 'youtube', 'github'], maxLinks: 3 });
    // the accountant's (hidden) is left out; Other's takes any
    expect(form.portfolios?.[positionKeyOf(teamId, positionNameOf(`Accountant ${RUN}`))]).toBeUndefined();
    expect(form.otherPortfolio).toMatchObject({ mode: 'optional', title: 'Your work samples', kinds: [...PORTFOLIO_KINDS] });
    expect(form.linkedinSignIn).toBe(false);

    expect(said(await sendGeneral('gen-none', { positionKey: motionKey }).expect(400))).toContain('Add your portfolio: a showreel on Vimeo or YouTube.');
    await sendGeneral('gen-reel', { positionKey: motionKey, portfolioLinks: JSON.stringify(['https://www.youtube.com/@a-reel']) }).expect(201);
    const g = await prisma.generalCv.findFirstOrThrow({ where: { email: email('gen-reel') } });
    expect(g).toMatchObject({ portfolioLinks: ['https://www.youtube.com/@a-reel'], portfolio: 'https://www.youtube.com/@a-reel', emailConfirmedBy: null });
    const view = (await as('hr').get(`/recruitment/general-cvs/${g.id}`).expect(200)).body as GeneralCvView;
    expect(view).toMatchObject({ portfolioLinks: ['https://www.youtube.com/@a-reel'], portfolioFile: null, emailConfirmedBy: null });
    // moved to a vacancy, its links go with it
    const moved = (await as('hr').post(`/recruitment/general-cvs/${g.id}/move`, { vacancyId: editorJob.id }).expect(200)).body as GeneralCvView;
    const app2 = await prisma.jobApplication.findUniqueOrThrow({ where: { id: moved.movedTo!.applicationId } });
    expect(app2.portfolioLinks).toEqual(['https://www.youtube.com/@a-reel']);
  });

  // ---------- each position's section title (owner, 26 October 2026: "a section title per position") ----------

  it('HR titles a position’s section (audited): the job page, the general form, HR’s pages and the CV window follow; blank is the rule’s', async () => {
    const editorKey = positionKeyOf(teamId, positionNameOf(`Video Editor ${RUN}`));
    const motionKey = positionKeyOf(teamId, positionNameOf(`Junior Motion Designer ${RUN}`));
    const jobPage = async () => ((await api().get(`/api/public/careers/${editorJob.slug}`).set('x-careers-key', process.env.CAREERS_KEY!).expect(200)).body as PublicVacancyView).portfolio;
    const vimeo = await applicationOf('vimeo');
    const windowCv = async (path: string, id: string) => ((await as('hr').get(path).expect(200)).body as ScreeningComments).cvs.find((x) => x.id === id);

    // the rule's first: on the settings, the job page, the application and its CV window
    const before = (await as('hr').get('/recruitment/settings/portfolio').expect(200)).body as PortfolioSettingsView;
    const editor = before.positions.find((x) => x.key === editorKey)!;
    expect(editor).toMatchObject({ set: false, ask: { title: 'Your showreel' }, defaultAsk: { title: 'Your showreel' } });
    expect((await jobPage())?.title).toBe('Your showreel');
    expect(((await as('hr').get(`/recruitment/applications/${vimeo.id}`).expect(200)).body as ApplicationView).portfolioTitle).toBe('Your showreel');

    // HR's own: too long refused; trimmed, kept, audited
    const setting = { key: editorKey, mode: editor.ask.mode, title: '  Your   edit reel ', hint: editor.ask.hint, kinds: editor.ask.kinds, maxLinks: editor.ask.maxLinks };
    expect(said(await as('hr').put('/recruitment/settings/portfolio', { positions: [{ ...setting, title: 'x'.repeat(41) }] }).expect(400))).toEqual([
      `Keep the section title for Video Editor ${RUN} to 40 characters or fewer.`,
    ]);
    const saved = (await as('hr').put('/recruitment/settings/portfolio', { positions: [setting] }).expect(200)).body as PortfolioSettingsView;
    expect(saved.positions.find((x) => x.key === editorKey)).toMatchObject({ set: true, ask: { mode: 'required', title: 'Your edit reel' }, defaultAsk: { title: 'Your showreel' } });
    expect(await prisma.portfolioSetting.findUniqueOrThrow({ where: { jobTitleId: editorTitleId } })).toMatchObject({ mode: 'required', title: 'Your edit reel', hint: 'A 1–2 minute showreel' });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'recruitment_settings', userId: users.hr }, orderBy: { at: 'desc' } });
    const asked = 'Required: vimeo, youtube, google_drive, frame_io; 3 links; “A 1–2 minute showreel”';
    expect((audit.diff as { portfolioOnForms: string[] }).portfolioOnForms).toEqual([
      `Video Editor ${RUN} (Post ${RUN} · Studio ${RUN}): ${asked}; title “Your showreel” → ${asked}; title “Your edit reel”`,
    ]);

    // the public job data follows, every other field as it was
    expect(await jobPage()).toEqual({ mode: 'required', title: 'Your edit reel', hint: 'A 1–2 minute showreel', kinds: ['vimeo', 'youtube', 'google_drive', 'frame_io'], maxLinks: 3 });
    // the vacancy's own mode keeps it, as it keeps the hint
    await as('hr').patch(`/recruitment/vacancies/${editorJob.id}`, { portfolioMode: 'optional' }).expect(200);
    expect(await jobPage()).toMatchObject({ mode: 'optional', title: 'Your edit reel', hint: 'A 1–2 minute showreel' });
    await as('hr').patch(`/recruitment/vacancies/${editorJob.id}`, { portfolioMode: null }).expect(200);

    // HR's pages: the application and its CV window show the links under it
    expect(((await as('hr').get(`/recruitment/applications/${vimeo.id}`).expect(200)).body as ApplicationView).portfolioTitle).toBe('Your edit reel');
    expect(await windowCv(`/recruitment/applications/${vimeo.id}/comments`, vimeo.id)).toMatchObject({ portfolioLinks: ['https://vimeo.com/123456789'], portfolioTitle: 'Your edit reel' });

    // the general form's positions carry theirs (the motion one's, Other's); a general CV's page and window its position's
    const form = (await api().get('/api/public/general-cvs/form').set('x-careers-key', process.env.CAREERS_KEY!).expect(200)).body as PublicGeneralForm;
    expect(form.portfolios?.[motionKey]?.title).toBe('Your showreel');
    expect(form.otherPortfolio?.title).toBe('Your work samples');
    await sendGeneral('gen-titled', { positionKey: motionKey, portfolioLinks: JSON.stringify(['https://vimeo.com/987654321']) }).expect(201);
    const g = await prisma.generalCv.findFirstOrThrow({ where: { email: email('gen-titled') } });
    expect(((await as('hr').get(`/recruitment/general-cvs/${g.id}`).expect(200)).body as GeneralCvView).portfolioTitle).toBe('Your showreel');
    expect(await windowCv(`/recruitment/general-cvs/${g.id}/comments`, g.id)).toMatchObject({ portfolioLinks: ['https://vimeo.com/987654321'], portfolioTitle: 'Your showreel' });
    // Other (written): Other's
    await sendGeneral('gen-other', { positionKey: 'other', positionOther: `Puppeteer ${RUN}`, portfolioLinks: JSON.stringify(['https://vimeo.com/192837465']) }).expect(201);
    const other = await prisma.generalCv.findFirstOrThrow({ where: { email: email('gen-other') } });
    expect(((await as('hr').get(`/recruitment/general-cvs/${other.id}`).expect(200)).body as GeneralCvView).portfolioTitle).toBe('Your work samples');

    // blank: the rule's again, no row kept (the rest as its default)
    await as('hr').put('/recruitment/settings/portfolio', { positions: [{ ...setting, title: '   ' }] }).expect(200);
    expect(await prisma.portfolioSetting.count({ where: { jobTitleId: editorTitleId } })).toBe(0);
    expect((await jobPage())?.title).toBe('Your showreel');
  });

  // ---------- Recruitment Settings: "LinkedIn Sign-in" ----------

  it('LinkedIn Sign-in is a Super Admin’s: the secret sealed, never sent back, audited as changed', async () => {
    await as('hr').get('/recruitment/settings/linkedin').expect(403);
    await as('ceo').put('/recruitment/settings/linkedin', { enabled: true }).expect(403);
    await as('developer').get('/recruitment/settings/linkedin').expect(403);
    expect((await as('superAdmin').get('/recruitment/settings/linkedin').expect(200)).body).toMatchObject({ enabled: false, clientId: null, secretSet: false, ready: false });
    expect(said(await as('superAdmin').put('/recruitment/settings/linkedin', { enabled: true, clientId: CLIENT_ID }).expect(400))).toEqual(['Paste the client secret before switching LinkedIn sign-in on.']);

    const res = await as('superAdmin').put('/recruitment/settings/linkedin', { enabled: true, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }).expect(200);
    expect(res.body as LinkedInSettingsView).toMatchObject({ enabled: true, clientId: CLIENT_ID, secretSet: true, secretUnreadable: false, ready: true });
    expect(JSON.stringify(res.body)).not.toContain(CLIENT_SECRET);
    const row = await prisma.linkedInSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(row.clientSecretEnc).toMatch(/^v1:/);
    expect(row.clientSecretEnc).not.toContain(CLIENT_SECRET);
    expect(JSON.stringify((await as('superAdmin').get('/recruitment/settings/linkedin').expect(200)).body)).not.toContain(CLIENT_SECRET);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'linkedin_settings' }, orderBy: { at: 'desc' } });
    expect(audit.diff).toMatchObject({ enabled: { from: false, to: true }, clientId: { from: null, to: CLIENT_ID }, clientSecret: 'changed' });
    expect(JSON.stringify(audit.diff)).not.toContain(CLIENT_SECRET);
    // saved again without a secret: the one set stays
    await as('superAdmin').put('/recruitment/settings/linkedin', { enabled: true, clientId: CLIENT_ID }).expect(200);
    expect((await prisma.linkedInSettings.findUniqueOrThrow({ where: { id: 1 } })).clientSecretEnc).toBe(row.clientSecretEnc);
  });

  it('signs in with a (fake) LinkedIn: a bad state refused, a cancel said, the verified email marking the application', async () => {
    const calls: { url: string; body?: string; auth?: string }[] = [];
    const http = app.get(LinkedInHttp);
    const real = http.fetch;
    let nonce = '';
    const fake: LinkedInFetch = (url, init) => {
      calls.push({ url, body: init.body, auth: init.headers.authorization });
      if (url === LINKEDIN_TOKEN_URL) {
        const sent = new URLSearchParams(init.body ?? '');
        if (sent.get('code') !== 'good-code' || sent.get('client_secret') !== CLIENT_SECRET) return Promise.resolve(new Response('{"error":"invalid_grant"}', { status: 400 }));
        return Promise.resolve(
          Response.json({ access_token: 'at-fake', expires_in: 3600, id_token: idToken({ iss: LINKEDIN_ISSUER, aud: CLIENT_ID, sub: 'sub-1', nonce, exp: Math.floor(Date.now() / 1000) + 600 }) }),
        );
      }
      if (url === LINKEDIN_USERINFO_URL) {
        if (init.headers.authorization !== 'Bearer at-fake') return Promise.resolve(new Response('{}', { status: 401 }));
        return Promise.resolve(Response.json({ sub: 'sub-1', name: `Mona LinkedIn ${RUN}`, given_name: 'Mona', email: `Mona.LinkedIn.${RUN}@Mail.test`, email_verified: true, picture: 'https://media.example/photo.jpg' }));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    };
    http.fetch = fake;
    try {
      const page = (await api().get(`/api/public/careers/${editorJob.slug}`).set('x-careers-key', process.env.CAREERS_KEY!).expect(200)).body as PublicVacancyView;
      expect(page.linkedinSignIn).toBe(true);
      const form = `job:${editorJob.slug}`;
      const start = async () => {
        const s = (await api().post('/api/public/linkedin/start').set('x-careers-key', process.env.CAREERS_KEY!).set(signed(nextIp(), LINKEDIN_IP_TOKEN)).send({ form, src: 'linkedin', origin: ORIGIN }).expect(200)).body as LinkedInStart;
        if (!s.ok) throw new Error(`start refused: ${s.problem}`);
        const url = new URL(s.url);
        expect(`${url.origin}${url.pathname}`).toBe(LINKEDIN_AUTHORIZE_URL);
        expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: CALLBACK, scope: 'openid profile email' });
        expect(s.url).not.toContain(CLIENT_SECRET);
        return { state: url.searchParams.get('state')!, nonce: url.searchParams.get('nonce')!, binding: s.binding };
      };
      const finish = (body: object) => api().post('/api/public/linkedin/finish').set('x-careers-key', process.env.CAREERS_KEY!).set(signed(nextIp(), LINKEDIN_IP_TOKEN)).send(body).expect(200);

      // the website naming the careers pages' address itself: the redirect URL is there
      const www = (await api().post('/api/public/linkedin/start').set('x-careers-key', process.env.CAREERS_KEY!).set(signed(nextIp(), LINKEDIN_IP_TOKEN)).send({ form, origin: ORIGIN, careersBase: 'https://www.example.test/careers' }).expect(200))
        .body as LinkedInStart;
      expect(www.ok && new URL(www.url).searchParams.get('redirect_uri')).toBe('https://www.example.test/careers/linkedin/callback');
      expect((await api().post('/api/public/linkedin/start').set('x-careers-key', process.env.CAREERS_KEY!).set(signed(nextIp(), LINKEDIN_IP_TOKEN)).send({ form, careersBase: 'http://www.example.test/careers' }).expect(200)).body).toEqual({
        ok: false,
        problem: 'failed',
      });
      // Recruitment Settings' careers site changed (25 October 2026): the redirect URL follows it, as shown there
      await as('hr').patch('/recruitment/settings', { careersSite: 'https://careers.example.test/jobs' }).expect(200);
      try {
        const moved = (await api().post('/api/public/linkedin/start').set('x-careers-key', process.env.CAREERS_KEY!).set(signed(nextIp(), LINKEDIN_IP_TOKEN)).send({ form, origin: ORIGIN }).expect(200))
          .body as LinkedInStart;
        expect(moved.ok && new URL(moved.url).searchParams.get('redirect_uri')).toBe('https://careers.example.test/jobs/linkedin/callback');
      } finally {
        await as('hr').patch('/recruitment/settings', { careersSite: '' }).expect(200);
      }

      // a state that doesn't open, or another browser's: refused, LinkedIn never called
      const one = await start();
      expect((await finish({ state: 'v1:made:up:state', binding: one.binding, code: 'good-code' })).body).toEqual({ ok: false, form: null, src: null, problem: 'expired' });
      expect((await finish({ state: one.state, binding: 'another-browser', code: 'good-code' })).body).toMatchObject({ ok: false, form, src: 'linkedin', problem: 'expired' });
      expect(calls).toHaveLength(0);
      // cancelled at LinkedIn
      expect((await finish({ state: one.state, binding: one.binding, error: 'user_cancelled_login' })).body).toMatchObject({ ok: false, form, problem: 'cancelled' });
      // the code refused by LinkedIn
      expect((await finish({ state: one.state, binding: one.binding, code: 'bad-code' })).body).toMatchObject({ ok: false, form, problem: 'failed' });

      // signed in
      const two = await start();
      nonce = two.nonce;
      calls.length = 0;
      const done = (await finish({ state: two.state, binding: two.binding, code: 'good-code' })).body as LinkedInFinish;
      if (!done.ok) throw new Error(`finish refused: ${done.problem}`);
      expect(done).toMatchObject({ form, src: 'linkedin' });
      expect(done.ticket).not.toContain(`linkedin.${RUN}`.toLowerCase());
      expect(calls.map((c) => c.url)).toEqual([LINKEDIN_TOKEN_URL, LINKEDIN_USERINFO_URL]);
      expect(new URLSearchParams(calls[0].body).get('redirect_uri')).toBe(CALLBACK);
      // the ID token's nonce must be the sign-in's
      const three = await start();
      nonce = 'another-nonce';
      expect((await finish({ state: three.state, binding: three.binding, code: 'good-code' })).body).toMatchObject({ ok: false, problem: 'failed' });

      // the form opens it (its own form only), no photo in it
      const details = (await api().post('/api/public/linkedin/open').set('x-careers-key', process.env.CAREERS_KEY!).send({ ticket: done.ticket, form }).expect(200)).body;
      expect(details).toEqual({ fullName: `Mona LinkedIn ${RUN}`, email: `mona.linkedin.${RUN}@mail.test`, emailConfirmed: true, ticket: done.ticket });
      await api().post('/api/public/linkedin/open').set('x-careers-key', process.env.CAREERS_KEY!).send({ ticket: done.ticket, form: 'general' }).expect(400);

      // applied with that email: "Confirmed by LinkedIn"; with another, not
      const vimeo = JSON.stringify(['vimeo.com/987654321']);
      await apply(editorJob, 'linkedin', { email: `mona.linkedin.${RUN}@mail.test`, linkedinTicket: done.ticket, portfolioLinks: vimeo }).expect(201);
      const confirmed = await prisma.jobApplication.findFirstOrThrow({ where: { email: `mona.linkedin.${RUN}@mail.test` } });
      expect(confirmed.emailConfirmedBy).toBe('linkedin');
      expect(((await as('hr').get(`/recruitment/applications/${confirmed.id}`).expect(200)).body as ApplicationView).emailConfirmedBy).toBe('linkedin');
      await apply(editorJob, 'changed-email', { linkedinTicket: done.ticket, portfolioLinks: vimeo }).expect(201);
      expect((await applicationOf('changed-email')).emailConfirmedBy).toBeNull();
      // the job's ticket on "Send us your CV": not its form
      await sendGeneral('linkedin-general', { positionOther: 'Colourist', email: `mona.linkedin.${RUN}@mail.test`, linkedinTicket: done.ticket }).expect(201);
      expect((await prisma.generalCv.findFirstOrThrow({ where: { email: `mona.linkedin.${RUN}@mail.test` } })).emailConfirmedBy).toBeNull();

      // switched off: the forms don't offer it, a start is refused
      await as('superAdmin').put('/recruitment/settings/linkedin', { enabled: false }).expect(200);
      expect(((await api().get(`/api/public/careers/${editorJob.slug}`).set('x-careers-key', process.env.CAREERS_KEY!).expect(200)).body as PublicVacancyView).linkedinSignIn).toBe(false);
      expect((await api().post('/api/public/linkedin/start').set('x-careers-key', process.env.CAREERS_KEY!).set(signed(nextIp(), LINKEDIN_IP_TOKEN)).send({ form, origin: ORIGIN }).expect(200)).body).toEqual({ ok: false, problem: 'off' });
    } finally {
      http.fetch = real;
    }
  });

  // ---------- developers ----------

  it('a developer sees no portfolio link, no portfolio file and no LinkedIn mark', async () => {
    const vimeo = await applicationOf('vimeo');
    const dev = (await as('developer').get(`/recruitment/applications/${vimeo.id}`).expect(200)).body as ApplicationView;
    expect(dev.portfolioLinks).toEqual(['••••']);
    expect(dev.portfolio).toBe('••••');
    const pdf = await applicationOf('override-pdf');
    expect(((await as('developer').get(`/recruitment/applications/${pdf.id}`).expect(200)).body as ApplicationView).portfolioFile).toBeNull();
    await as('developer').get(`/recruitment/applications/${pdf.id}/portfolio-file`).expect(403);
    const confirmed = await prisma.jobApplication.findFirstOrThrow({ where: { email: `mona.linkedin.${RUN}@mail.test` } });
    expect(((await as('developer').get(`/recruitment/applications/${confirmed.id}`).expect(200)).body as ApplicationView).emailConfirmedBy).toBeNull();
    const g = await prisma.generalCv.findFirstOrThrow({ where: { email: email('gen-reel') } });
    expect(((await as('developer').get(`/recruitment/general-cvs/${g.id}`).expect(200)).body as GeneralCvView).portfolioLinks).toEqual(['••••']);
    await as('developer').get(`/recruitment/general-cvs/${g.id}/portfolio-file`).expect(403);
  });
});
