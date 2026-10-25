import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import type { INestApplication } from '@nestjs/common';
import { CLIENT_IP_AT_HEADER, CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER, GENERAL_CV_IP_TOKEN, positionKeyOf } from '@trendlix/shared';
import type { CandidateView, CvPositionsView, CvSaveResult, CvUploadView, GeneralCvListItem, GeneralCvView, PublicGeneralForm, Role, VacancySuggestions, VacancyView } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { VacancySuggestionsService } from '../src/recruitment/vacancy-suggestions.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// "Send us your CV" asks for a position, not an area (owner, 25 October 2026, on General CVs' "Area" filter: "what do you
// mean by area here?", then "should it be the positions?"; asked, "Position, grouped by team"; packages/shared
// cv-positions.ts). The careers form lists the job titles with their levels merged, grouped by team, never C-level and
// never one HR hid, plus Other in words; a CV keeps the position chosen and its team; HR hides or renames positions in
// Recruitment Settings (audited), picks one on Add a CV and the bulk upload (hidden ones too), and filters the general
// CVs by position and team; an older page's area is still taken, and an older CV still shows its area; a position like
// the job counts as a title in Suggested From Earlier CVs. Every name is invented; the test deletes what it made.

const RUN = `cp${Date.now().toString(36)}`;
const TODAY = todayInCairo();

/** Each person's own mobile (the same mobile is one candidate): +2010 and 8 digits. */
const mobileOf = (who: string) => {
  const key = `${who}|${RUN}`;
  let h = 11;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return `+2010${String(h % 100_000_000).padStart(8, '0')}`;
};

async function pdfOf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 760 - i * 20, size: 12, font }));
  return Buffer.from(await doc.save());
}

describe('The positions on “Send us your CV” (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const dept: Record<'studio' | 'video' | 'sound' | 'radio' | 'radioSound', string> = { studio: '', video: '', sound: '', radio: '', radioSound: '' };
  const titleIds: string[] = [];
  let vacancy: VacancyView;
  let cv: Buffer;
  let ipN = 0;

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const put = (as: string, path: string, body: object = {}) => api().put(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  const email = (who: string) => `${who}.${RUN}@mail.test`;
  const nameOf = (who: string) => `${who[0].toUpperCase()}${who.slice(1)} Person ${RUN}`;
  const key = {
    editor: () => positionKeyOf(dept.video, 'Video Editor'),
    motion: () => positionKeyOf(dept.video, 'Motion Designer'),
    colourist: () => positionKeyOf(dept.video, 'Colourist'),
    head: () => positionKeyOf(dept.studio, 'Head of Studio'),
    sound: () => positionKeyOf(dept.sound, 'Sound Engineer'),
    radioSound: () => positionKeyOf(dept.radioSound, 'Sound Engineer'),
    chief: () => positionKeyOf(dept.studio, 'Chief Studio Officer'),
  };

  async function account(name: string, roles: Role[]) {
    const e = await createUser(prisma, roles);
    users[name] = (await prisma.user.findUniqueOrThrow({ where: { email: e } })).id;
    sessions[name] = await signIn(app, e);
  }

  /** "Send us your CV" as the website sends it, its address signed for the general form. */
  function send(who: string, fields: Record<string, string>) {
    const ip = `10.77.${Math.floor(++ipN / 200)}.${(ipN % 200) + 1}`;
    const at = String(Date.now());
    let req = api()
      .post('/api/public/general-cvs')
      .set(CLIENT_IP_HEADER, ip)
      .set(CLIENT_IP_AT_HEADER, at)
      .set(CLIENT_IP_SIGNATURE_HEADER, signatureOf(process.env.WEB_KEY!, ip, at, GENERAL_CV_IP_TOKEN));
    // a showreel of their own: a video editor's position asks for one (owner, 25 October 2026: "Portfolio per position")
    const reel = `https://vimeo.com/${mobileOf(who).slice(-8)}`;
    for (const [k, v] of Object.entries({ fullName: nameOf(who), email: email(who), mobile: mobileOf(who), consent: 'true', ip, portfolioLinks: JSON.stringify([reel]), ...fields })) req = req.field(k, v);
    return req.attach('cv', cv, 'My CV.pdf');
  }

  /** HR's Add a CV. */
  function add(as: string, who: string, fields: Record<string, string>) {
    let req = api().post('/api/recruitment/general-cvs').set('Cookie', sessions[as]);
    for (const [k, v] of Object.entries({ fullName: nameOf(who), email: email(who), mobile: mobileOf(who), source: 'email', consent: 'true', ...fields })) req = req.field(k, v);
    return req.attach('cv', cv, 'Their CV.pdf');
  }

  const form = async () => (await api().get('/api/public/general-cvs/form').expect(200)).body as PublicGeneralForm;
  const mine = (f: PublicGeneralForm) => (f.positions ?? []).filter((g) => Object.values(dept).includes(g.teamId));
  /** HR's list of this test's general CVs, with these filters; `byEmail`: one person's. */
  const list = async (query: string) => (await get('hr', `/recruitment/general-cvs?q=${RUN}&${query}`).expect(200)).body as GeneralCvListItem[];
  const byEmail = async (who: string) => (await get('hr', `/recruitment/general-cvs?q=${encodeURIComponent(email(who))}`).expect(200)).body as GeneralCvListItem[];
  const row = (who: string) => prisma.generalCv.findFirstOrThrow({ where: { email: email(who) } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await account('outsider', ['employee']);
    const department = async (nameEn: string, parentId?: string) => (await prisma.department.create({ data: { nameEn, parentId }, select: { id: true } })).id;
    dept.studio = await department(`Studio ${RUN}`);
    dept.video = await department(`Video ${RUN}`, dept.studio);
    dept.sound = await department(`Sound ${RUN}`, dept.studio);
    dept.radio = await department(`Radio ${RUN}`);
    dept.radioSound = await department(`Sound ${RUN}`, dept.radio);
    const g9 = (await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true } })).id;
    const title = async (departmentId: string, titleEn: string, minGradeId?: string) =>
      titleIds.push((await prisma.jobTitle.create({ data: { departmentId, titleEn, minGradeId, jdPurpose: '<p>Made-up work for a made-up team.</p>' }, select: { id: true } })).id);
    await title(dept.video, 'Junior Video Editor');
    await title(dept.video, 'Senior Video Editor');
    await title(dept.video, 'Motion Designer');
    await title(dept.video, 'Colourist');
    await title(dept.studio, 'Head of Studio');
    // C-level: for G9 · Executive, a confidential grade
    await title(dept.studio, 'Chief Studio Officer', g9);
    // the same name in two teams
    await title(dept.sound, 'Sound Engineer');
    await title(dept.radioSound, 'Senior Sound Engineer');
    cv = await pdfOf(['A made-up CV']);
  });

  afterAll(async () => {
    const candidates = await prisma.candidateContact.findMany({ where: { kind: 'email', value: { endsWith: `.${RUN}@mail.test` } }, select: { candidateId: true } });
    await prisma.cvUpload.deleteMany({ where: { createdById: { in: Object.values(users) } } });
    await prisma.vacancySuggestion.deleteMany({ where: { vacancy: { jobTitleId: { in: titleIds } } } });
    await prisma.generalCv.deleteMany({ where: { email: { endsWith: `.${RUN}@mail.test` } } });
    await prisma.candidate.deleteMany({ where: { id: { in: candidates.map((c) => c.candidateId) } } });
    await prisma.vacancy.deleteMany({ where: { jobTitleId: { in: titleIds } } });
    await prisma.cvPositionChoice.deleteMany({ where: { key: { in: Object.values(key).map((k) => k()) } } });
    await prisma.jobTitle.deleteMany({ where: { id: { in: titleIds } } });
    await prisma.department.deleteMany({ where: { id: { in: [dept.video, dept.sound, dept.radioSound] } } });
    await prisma.department.deleteMany({ where: { id: { in: [dept.studio, dept.radio] } } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await app.close();
  });

  it('the careers form lists the positions grouped by team, levels merged, never C-level; the same name under each of two teams', async () => {
    const groups = mine(await form());
    // in the organisation's order (Radio before Studio; a department's own job titles, then its teams by name)
    expect(groups).toEqual([
      { teamId: dept.radioSound, team: `Sound ${RUN} (Radio ${RUN})`, positions: [{ key: key.radioSound(), name: 'Sound Engineer' }] },
      { teamId: dept.studio, team: `Studio ${RUN}`, positions: [{ key: key.head(), name: 'Head of Studio' }] },
      { teamId: dept.sound, team: `Sound ${RUN} (Studio ${RUN})`, positions: [{ key: key.sound(), name: 'Sound Engineer' }] },
      {
        teamId: dept.video,
        team: `Video ${RUN}`,
        positions: [
          { key: key.colourist(), name: 'Colourist' },
          { key: key.motion(), name: 'Motion Designer' },
          { key: key.editor(), name: 'Video Editor' },
        ],
      },
    ]);
    expect(JSON.stringify(groups)).not.toContain('Chief');
    // the areas of before are still there for one release, for a page that asks for one
    expect((await form()).areas.map((a) => a.id)).toContain(dept.video);
  });

  it('a position sent is kept with its name as shown and its team; Other in words; an unknown, C-level or empty one refused', async () => {
    const sent = (await send('mona', { positionKey: key.editor() }).expect(201)).body as { reference: string };
    expect(await row('mona')).toMatchObject({ number: sent.reference, positionKey: key.editor(), positionName: 'Video Editor', positionOther: null, departmentId: dept.video, areaOther: null });
    // the audit log names the position
    const mona = await row('mona');
    expect((await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'general_cv', entityId: mona.id } })).diff).toMatchObject({ position: 'Video Editor', area: `Video ${RUN} · Studio ${RUN}` });
    // the same name in another team: that team's
    await send('rana', { positionKey: key.radioSound() }).expect(201);
    expect(await row('rana')).toMatchObject({ positionName: 'Sound Engineer', departmentId: dept.radioSound });
    // Other in words: no team
    await send('omar', { positionKey: 'other', positionOther: '  Drone   pilot ' }).expect(201);
    expect(await row('omar')).toMatchObject({ positionKey: null, positionName: null, positionOther: 'Drone pilot', departmentId: null, areaOther: null });
    expect(said(await send('long', { positionOther: 'x'.repeat(81) }).expect(400))).toEqual(['Keep the position to 80 characters or fewer.']);
    for (const bad of ['not-a-key', `${dept.video}:nobody here`, key.chief()]) {
      expect(said(await send('nope', { positionKey: bad }).expect(400)), bad).toEqual(['Choose a position from the list.']);
    }
    expect(said(await send('none', {}).expect(400))).toEqual(['Choose the position you would like, or Other and write it.']);
  });

  // owner, 25 October 2026: a careers page opened before the change still sends an area (one release)
  it('an older page’s area is still taken, as its team with no position; an older CV shows its area', async () => {
    await send('cached', { departmentId: dept.video }).expect(201);
    expect(await row('cached')).toMatchObject({ departmentId: dept.video, positionKey: null, positionName: null, positionOther: null });
    await send('cachedother', { departmentId: '', areaOther: 'Photography' }).expect(201);
    expect(await row('cachedother')).toMatchObject({ departmentId: null, areaOther: 'Photography', positionKey: null });
    // a CV from before the positions, as it was kept
    const older = await prisma.generalCv.create({
      data: { number: `APP-${TODAY.slice(0, 4)}-8${String(Date.now()).slice(-5)}`, fullName: nameOf('older'), email: email('older'), mobile: mobileOf('older'), departmentId: dept.sound, source: 'email', consentAt: new Date() },
      select: { id: true },
    });
    const [item] = await byEmail('older');
    expect(item).toMatchObject({ id: older.id, area: `Sound ${RUN} · Studio ${RUN}`, team: `Sound ${RUN} · Studio ${RUN}`, departmentId: dept.sound, positionKey: null, positionName: null, positionOther: null });
    expect(((await get('hr', `/recruitment/general-cvs/${older.id}`).expect(200)).body as GeneralCvView).area).toBe(`Sound ${RUN} · Studio ${RUN}`);
    const [other] = await byEmail('cachedother');
    expect(other).toMatchObject({ area: 'Photography', team: null, positionName: null });
  });

  it('HR hides a position and renames another: off the careers page, refused there, audited; HR, the CEO read; nobody else', async () => {
    const before = (await get('ceo', '/recruitment/settings/positions').expect(200)).body as CvPositionsView;
    const editor = before.positions.find((p) => p.key === key.editor())!;
    expect(editor).toMatchObject({ name: 'Video Editor', hidden: false, publicName: null, teamId: dept.video, teamHrName: `Video ${RUN} · Studio ${RUN}`, titles: ['Junior Video Editor', 'Senior Video Editor'] });
    expect(editor.titleIds).toHaveLength(2);
    expect(before.positions.some((p) => p.key === key.chief())).toBe(false);
    // the Team filter's options: the positions' teams, and the areas of before
    expect(before.teams).toEqual(expect.arrayContaining([{ id: dept.studio, name: `Studio ${RUN}` }, { id: dept.video, name: `Video ${RUN} · Studio ${RUN}` }, { id: dept.radioSound, name: `Sound ${RUN} · Radio ${RUN}` }]));
    await get('outsider', '/recruitment/settings/positions').expect(403);
    await put('ceo', '/recruitment/settings/positions', { positions: [{ key: key.colourist(), hidden: true }] }).expect(403);

    const saved = (
      await put('hr', '/recruitment/settings/positions', {
        positions: [
          { key: key.colourist(), hidden: true, publicName: '' },
          { key: key.motion(), hidden: false, publicName: '  Motion   Graphics Designer ' },
          // as it was: nothing changes
          { key: key.editor(), hidden: false, publicName: 'Video Editor' },
        ],
      }).expect(200)
    ).body as CvPositionsView;
    expect(saved.positions.find((p) => p.key === key.colourist())).toMatchObject({ hidden: true, shownName: 'Colourist' });
    expect(saved.positions.find((p) => p.key === key.motion())).toMatchObject({ hidden: false, publicName: 'Motion Graphics Designer', shownName: 'Motion Graphics Designer' });
    expect(saved.positions.find((p) => p.key === key.editor())).toMatchObject({ publicName: null });
    expect(saved.updatedBy?.email).toBeTruthy();
    expect(await prisma.cvPositionChoice.count({ where: { key: key.editor() } })).toBe(0);

    const video = mine(await form()).find((g) => g.teamId === dept.video)!;
    expect(video.positions).toEqual([
      { key: key.motion(), name: 'Motion Graphics Designer' },
      { key: key.editor(), name: 'Video Editor' },
    ]);
    expect(said(await send('hidden', { positionKey: key.colourist() }).expect(400))).toEqual(['Choose a position from the list.']);
    // a CV sent for the renamed one keeps the name it was shown by
    await send('dana', { positionKey: key.motion() }).expect(201);
    expect(await row('dana')).toMatchObject({ positionKey: key.motion(), positionName: 'Motion Graphics Designer', departmentId: dept.video });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'recruitment_settings', userId: users.hr }, orderBy: { at: 'desc' } });
    expect(audit).toMatchObject({ action: 'update' });
    expect(audit.diff).toEqual({
      positionsOnCvForm: {
        hidden: [`Colourist (Video ${RUN} · Studio ${RUN})`],
        publicNames: [`Motion Designer (Video ${RUN} · Studio ${RUN}): its own name → Motion Graphics Designer`],
      },
    });
    // shown again, by its own name: no row, audited
    await put('hr', '/recruitment/settings/positions', { positions: [{ key: key.motion(), hidden: false, publicName: null }] }).expect(200);
    expect(await prisma.cvPositionChoice.count({ where: { key: key.motion() } })).toBe(0);
    const again = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'recruitment_settings', userId: users.hr }, orderBy: { at: 'desc' } });
    expect(again.diff).toEqual({ positionsOnCvForm: { publicNames: [`Motion Designer (Video ${RUN} · Studio ${RUN}): Motion Graphics Designer → its own name`] } });
    // a position not on the list, and a public name too long
    expect(said(await put('hr', '/recruitment/settings/positions', { positions: [{ key: `${dept.video}:gone`, hidden: true }] }).expect(400))).toEqual([
      'The positions changed since the page opened: reload it and try again.',
    ]);
    expect(said(await put('hr', '/recruitment/settings/positions', { positions: [{ key: key.editor(), hidden: false, publicName: 'x'.repeat(81) }] }).expect(400))).toEqual([
      'Keep each public name to 80 characters or fewer.',
    ]);
  });

  it('HR’s Add a CV takes a position of HR’s list, a hidden one too, or Other; never one not on it', async () => {
    const made = (await add('hr', 'karim', { positionKey: key.colourist() }).expect(201)).body as GeneralCvView;
    expect(made).toMatchObject({ positionKey: key.colourist(), positionName: 'Colourist', positionOther: null, departmentId: dept.video, team: `Video ${RUN} · Studio ${RUN}` });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'general_cv', entityId: made.id, action: 'create' } })).diff).toMatchObject({ position: 'Colourist' });
    const other = (await add('hr', 'salma', { positionOther: 'Set designer' }).expect(201)).body as GeneralCvView;
    expect(other).toMatchObject({ positionKey: null, positionName: null, positionOther: 'Set designer', team: null, area: 'Other' });
    expect(said(await add('hr', 'nobody', { positionKey: key.chief() }).expect(400))).toEqual(['Choose a position from the list.']);
    expect(said(await add('hr', 'nobody', {}).expect(400))).toEqual(['Choose the position they would like, or Other and write it.']);
    // the candidate's profile shows it
    const candidateId = (await prisma.generalCv.findUniqueOrThrow({ where: { id: made.id }, select: { candidateId: true } })).candidateId!;
    const profile = (await get('hr', `/recruitment/candidates/${candidateId}`).expect(200)).body as CandidateView;
    expect(profile.generalCvs[0]).toMatchObject({ positionName: 'Colourist', team: `Video ${RUN} · Studio ${RUN}` });
  });

  it('the bulk upload’s general rows name a position (hidden ones too) or Other; one not on the list is left in the batch', async () => {
    const upload = async (who: string) =>
      (await api().post('/api/recruitment/cv-uploads').set('Cookie', sessions.hr).attach('cv', await pdfOf([nameOf(who), email(who)]), `${who}.pdf`).expect(201)).body as CvUploadView;
    const a = await upload('bulka');
    const b = await upload('bulkb');
    const c = await upload('bulkc');
    const rowOf = (u: CvUploadView, who: string, extra: object) => ({ id: u.id, fullName: nameOf(who), email: email(who), mobile: mobileOf(who), source: 'linkedin', ...extra });
    const result = (
      await post('hr', '/recruitment/cv-uploads/save', {
        rows: [rowOf(a, 'bulka', { positionKey: key.sound() }), rowOf(b, 'bulkb', { positionKey: 'other', positionOther: 'Gaffer' }), rowOf(c, 'bulkc', { positionKey: key.chief() })],
      }).expect(200)
    ).body as CvSaveResult;
    expect(result.saved.map((s) => s.fullName)).toEqual([nameOf('bulka'), nameOf('bulkb')]);
    expect(result.skipped.map((s) => s.reason)).toEqual(['Choose a position from the list.']);
    expect(await row('bulka')).toMatchObject({ positionKey: key.sound(), positionName: 'Sound Engineer', departmentId: dept.sound, source: 'linkedin' });
    expect(await row('bulkb')).toMatchObject({ positionKey: null, positionOther: 'Gaffer', departmentId: null });
    const bulka = await row('bulka');
    expect((await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'general_cv', entityId: bulka.id } })).diff).toMatchObject({ position: 'Sound Engineer', via: 'bulk upload' });
  });

  it('HR’s list shows each CV’s position and team, and filters by position (or those written) and by team', async () => {
    const [mona] = await byEmail('mona');
    expect(mona).toMatchObject({ positionKey: key.editor(), positionName: 'Video Editor', positionOther: null, team: `Video ${RUN} · Studio ${RUN}`, area: `Video ${RUN} · Studio ${RUN}`, departmentId: dept.video });
    const emailsOf = (rows: GeneralCvListItem[]) => rows.map((r) => r.email).sort();
    expect(emailsOf(await list(`positionKey=${encodeURIComponent(key.editor())}`))).toEqual([email('mona')]);
    expect(emailsOf(await list(`positionKey=${encodeURIComponent(key.radioSound())}`))).toEqual([email('rana')]);
    expect(emailsOf(await list('positionKey=other'))).toEqual([email('bulkb'), email('omar'), email('salma')].sort());
    // the team: the positions' and the areas of before alike
    expect(emailsOf(await list(`departmentId=${dept.video}`))).toEqual([email('cached'), email('dana'), email('karim'), email('mona')].sort());
    expect(emailsOf(await list(`departmentId=${dept.video}&positionKey=${encodeURIComponent(key.motion())}`))).toEqual([email('dana')]);
  });

  it('Suggested From Earlier CVs: a general CV’s position like the job counts as a title, beside the same team', async () => {
    const jobTitleId = (await prisma.jobTitle.findFirstOrThrow({ where: { departmentId: dept.video, titleEn: 'Senior Video Editor' }, select: { id: true } })).id;
    const made = (await post('hr', '/recruitment/vacancies', { jobTitleId, employmentType: 'full_time', headcount: 1, closingDate: addDays(TODAY, 30) }).expect(201)).body as VacancyView;
    await post('hr', `/recruitment/vacancies/${made.id}/submit`).expect(200);
    vacancy = (await post('ceo', `/recruitment/vacancies/${made.id}/approve`).expect(200)).body as VacancyView;
    await app.get(VacancySuggestionsService).refreshVacancy(vacancy.id, { notify: false });
    const s = (await get('hr', `/recruitment/vacancies/${vacancy.id}/suggestions`).expect(200)).body as VacancySuggestions;
    const monaId = (await row('mona')).candidateId;
    const monaRow = s.rows.find((r) => r.candidate.id === monaId)!;
    expect(monaRow.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'area', exact: true }), { kind: 'title', from: 'position', matchedTitle: 'Video Editor', points: 20 }]));
    expect(monaRow.source).toMatchObject({ kind: 'general_cv', position: 'Video Editor', area: `Video ${RUN} · Studio ${RUN}` });
    // an older CV of the team: the team only, no title from a position
    const cachedId = (await row('cached')).candidateId;
    const cached = s.rows.find((r) => r.candidate.id === cachedId)!;
    expect(cached.reasons.some((r) => r.kind === 'title')).toBe(false);
    expect(cached.source).toMatchObject({ kind: 'general_cv', position: null });
  });
});
