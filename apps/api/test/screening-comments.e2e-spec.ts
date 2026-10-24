import type { INestApplication } from '@nestjs/common';
import {
  DEVELOPER_NO_FILES,
  EARLIER_NOTES_AUTHOR,
  HIDDEN,
  type ApplicationListItem,
  type CandidateListItem,
  type CandidateView,
  type GeneralCvListItem,
  type GeneralCvView,
  type Role,
  type ScreeningCommentView,
  type ScreeningComments,
  type VacancyBoard,
} from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { MockInstance } from 'vitest';
import { PdfService } from '../src/pdf/pdf.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { ScreeningCommentsService } from '../src/recruitment/screening-comments.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Screening comments and the CV window (owner, 24 October 2026, on a candidate's profile: "when opening a CV, open it in
// a popup window", "is there a way to add screening comments?", "and i can add genearrl comments"; asked, "Yes: Good fit
// / Maybe / Not a fit" and "HR + hiring manager & interviewers"). One candidate, Sara, with a general CV HR added (its
// notes her first comment), an application on the Video Editor vacancy (Hana its hiring manager, Ivan interviewing her),
// one on another vacancy (Omar's) and one on a C-level vacancy; Adam, another applicant with no verdict. HR's general
// and record comments with a verdict; the lists' badges and their Verdict filter; what Hana and Ivan read and write, and
// are refused; mentions told and refused; the 24 hours to edit; only a Super Admin deleting; HR's notes of before moved
// in; the C-level application's comments hidden from HR; a developer's "••••"; the CV as a PDF (a Word one converted and
// kept); the audit log. Every name is invented; this file deletes what it made.

const RUN = `sc${Date.now().toString(36)}`;
const DAY = 86_400_000;
const PDF = Buffer.from(`%PDF-1.4\n% ${RUN}\n%%EOF\n`);
const DOCX = Buffer.from(`PK\x03\x04 word/document.xml ${RUN}`);
const CONVERTED = Buffer.from(`%PDF-1.7\n% converted ${RUN}\n%%EOF\n`);

const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

describe('Screening comments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const emails: Record<string, string> = {};
  const people: Record<string, string> = {};
  const employeeIds: string[] = [];
  const vacancyIds: string[] = [];
  const titleIds: string[] = [];
  let departmentId: string;
  let generalCvId: string;
  let candidateId: string;
  /** Sara's applications: the Video Editor (Hana's), Omar's vacancy, the C-level one; and Adam's. */
  const apps: Record<'mine' | 'other' | 'chief' | 'adam', string> = { mine: '', other: '', chief: '', adam: '' };

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const patch = (as: string, path: string, body: object = {}) => api().patch(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const del = (as: string, path: string) => api().delete(`/api${path}`).set('Cookie', sessions[as]);
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  const comment = (as: string, body: object) => post(as, '/recruitment/comments', body);
  const mentions = (key: string) => prisma.notification.findMany({ where: { userId: users[key], kind: 'screening_mention' }, orderBy: { createdAt: 'asc' }, select: { title: true, body: true, link: true } });

  async function account(key: string, roles: Role[]) {
    const email = await createUser(prisma, roles);
    emails[key] = email;
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
  }

  /** A user with an employee profile (linked by their work email), signed in. */
  async function person(key: string, name: string) {
    await account(key, ['employee']);
    const e = await prisma.employee.create({
      data: {
        employeeCode: `${key.toUpperCase()}-${RUN}`,
        fullNameEn: `${name} ${RUN}`,
        fullNameAr: 'اسم',
        workEmail: emails[key],
        employments: { create: { employmentType: 'full_time', status: 'active', joinDate: new Date('2024-01-01'), departmentId } },
      },
      select: { id: true },
    });
    people[key] = e.id;
    employeeIds.push(e.id);
    await prisma.user.update({ where: { id: users[key] }, data: { employeeId: e.id } });
  }

  async function vacancy(title: string, hiringManagerId: string | null, minGradeId: string | null = null) {
    const n = vacancyIds.length + 1;
    const jobTitleId = (await prisma.jobTitle.create({ data: { departmentId, titleEn: `${title} ${RUN}`, minGradeId }, select: { id: true } })).id;
    titleIds.push(jobTitleId);
    const v = await prisma.vacancy.create({
      data: { number: `VAC-1998-${String(Date.now()).slice(-6)}${n}`, slug: `screening-${RUN}-${n}`, status: 'open', title: `${title} ${RUN}`, jobTitleId, employmentType: 'full_time', hiringManagerId, publishedAt: new Date() },
      select: { id: true },
    });
    vacancyIds.push(v.id);
    return v.id;
  }

  async function application(vacancyId: string, name: string, stage: string, cand: string | null, cv: { data: Buffer; mimeType: string; fileName: string }) {
    const n = Object.values(apps).filter(Boolean).length + 1;
    const a = await prisma.jobApplication.create({
      data: {
        number: `APP-1998-${String(Date.now()).slice(-6)}${n}`,
        vacancyId,
        stage,
        fullName: `${name} ${RUN}`,
        email: `${name.toLowerCase()}.${n}.${RUN}@mail.test`,
        mobile: '+201001234567',
        consentAt: new Date(),
        candidateId: cand,
        cv: { create: { fileName: cv.fileName, mimeType: cv.mimeType, sizeBytes: cv.data.length, data: new Uint8Array(cv.data) } },
        steps: { create: [{ event: 'applied', stage: 'applied' }, ...(stage === 'applied' ? [] : [{ event: 'shortlisted', stage: 'shortlisted' }])] },
      },
      select: { id: true },
    });
    return a.id;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    departmentId = (await prisma.department.create({ data: { nameEn: `Screening ${RUN}` }, select: { id: true } })).id;
    await account('hr', ['hr']);
    await account('hr2', ['hr']);
    await account('ceo', ['ceo']);
    await account('superAdmin', ['super_admin']);
    await account('developer', ['developer']);
    await person('hm', 'Hana Hiring');
    await person('iv', 'Ivan Interviewer');
    await person('otherHm', 'Omar Manager');
    const g9 = (await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true } })).id;
    const mine = await vacancy('Video Editor', people.hm);
    const other = await vacancy('Motion Designer', people.otherHm);
    const chief = await vacancy('Chief Editor', null, g9);
    // Sara's general CV, added by HR with a note: her candidate made, the note her first comment
    generalCvId = (
      await api()
        .post('/api/recruitment/general-cvs')
        .set('Cookie', sessions.hr)
        .field('fullName', `Sara Example ${RUN}`)
        .field('email', `sara.${RUN}@mail.test`)
        .field('mobile', '01001234599')
        .field('areaOther', 'Video')
        .field('source', 'email')
        .field('consent', 'true')
        .field('notes', 'Sent by email after the fair')
        .attach('cv', DOCX, 'Sara CV.docx')
        .expect(201)
    ).body.id;
    candidateId = (await prisma.generalCv.findUniqueOrThrow({ where: { id: generalCvId }, select: { candidateId: true } })).candidateId!;
    apps.mine = await application(mine, 'Sara', 'shortlisted', candidateId, { data: PDF, mimeType: 'application/pdf', fileName: 'Sara CV.pdf' });
    apps.other = await application(other, 'Sara', 'shortlisted', candidateId, { data: PDF, mimeType: 'application/pdf', fileName: 'Sara CV 2.pdf' });
    apps.chief = await application(chief, 'Sara', 'shortlisted', candidateId, { data: PDF, mimeType: 'application/pdf', fileName: 'Sara CV 3.pdf' });
    apps.adam = await application(mine, 'Adam', 'shortlisted', null, { data: DOCX, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: 'Adam CV.docx' });
    // Ivan interviews Sara for the Video Editor
    await prisma.interview.create({ data: { applicationId: apps.mine, startsAt: new Date(Date.now() + 7 * DAY), minutes: 45, kind: 'in_person', interviewers: { create: [{ employeeId: people.iv }] } } });
  });

  afterAll(async () => {
    await prisma.jobApplication.deleteMany({ where: { vacancyId: { in: vacancyIds } } });
    await prisma.generalCv.deleteMany({ where: { id: generalCvId } });
    await prisma.candidate.deleteMany({ where: { id: candidateId } });
    await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
    await prisma.jobTitle.deleteMany({ where: { id: { in: titleIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await prisma.user.updateMany({ where: { id: { in: Object.values(users) } }, data: { employeeId: null } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await app.close();
  });

  describe('HR', () => {
    let general: ScreeningCommentView;
    let onRecord: ScreeningCommentView;

    it('finds HR’s Add a CV note as the general CV’s first comment, written by them', async () => {
      const cv = (await get('hr', `/recruitment/general-cvs/${generalCvId}`).expect(200)).body as GeneralCvView;
      expect(cv).toMatchObject({ notes: null, can: { editNotes: false }, verdict: null });
      const all = (await get('hr', `/recruitment/general-cvs/${generalCvId}/comments`).expect(200)).body as ScreeningComments;
      expect(all.comments).toHaveLength(1);
      expect(all.comments[0]).toMatchObject({ comment: 'Sent by email after the fair', about: { kind: 'general_cv', id: generalCvId }, authorRole: 'hr', author: { email: emails.hr }, verdict: null, mine: true });
    });

    it('adds a general comment and one on an application with a verdict; the profile reads them newest first with their chips', async () => {
      general = (await comment('hr', { candidateId, comment: 'Calm and clear on the phone.' }).expect(201)).body as ScreeningCommentView;
      expect(general).toMatchObject({ about: { kind: 'general', id: null }, aboutLabel: 'General', authorRole: 'hr', verdict: null, editedAt: null, can: { edit: true, delete: false } });
      onRecord = (await comment('hr', { applicationId: apps.mine, comment: 'Strong reel, fast cuts.', verdict: 'good_fit' }).expect(201)).body as ScreeningCommentView;
      expect(onRecord).toMatchObject({ about: { kind: 'application', id: apps.mine, title: `Video Editor ${RUN}` }, verdict: 'good_fit' });
      expect(onRecord.aboutLabel).toMatch(/^APP-1998-\d+ · Video Editor /);
      expect(said(await comment('hr', { candidateId, comment: '   ' }).expect(400))).toEqual(['Write the comment.']);
      expect(said(await comment('hr', { candidateId, applicationId: apps.mine, comment: 'Both?' }).expect(400))).toEqual(['Say what the comment is about: an application, a general CV, or the candidate in general.']);
      expect((await comment('hr', { candidateId, comment: 'x', verdict: 'great' }).expect(400)).body.message).toEqual(['Choose Good fit, Maybe or Not a fit, or no verdict.']);
      const all = (await get('hr', `/recruitment/candidates/${candidateId}/comments`).expect(200)).body as ScreeningComments;
      expect(all.comments.map((c) => c.id).slice(0, 2)).toEqual([onRecord.id, general.id]);
      expect(all.can.add).toBe(true);
      // General first, then the applications HR sees (not the C-level one), then the general CV
      expect(all.targets.map((t) => t.key)).toEqual(['general', `application:${apps.other}`, `application:${apps.mine}`, `general_cv:${generalCvId}`]);
      expect(all.targets.some((t) => t.key === `application:${apps.chief}`)).toBe(false);
      expect(all.targets.find((t) => t.key === `application:${apps.mine}`)).toMatchObject({ count: 1, verdict: 'good_fit' });
      // the CVs HR may open, the window's previous and next: three, never the C-level one's
      expect(all.cvs.map((c) => c.key).sort()).toEqual([`application:${apps.mine}`, `application:${apps.other}`, `general_cv:${generalCvId}`].sort());
      // the profile: its verdict and a timeline line each
      const profile = (await get('hr', `/recruitment/candidates/${candidateId}`).expect(200)).body as CandidateView;
      expect(profile.verdict).toBe('good_fit');
      expect(profile.timeline.filter((t) => t.kind === 'comment').map((t) => t.text)).toEqual(
        expect.arrayContaining(['Screening comment: General', expect.stringMatching(/^Screening comment \(Good fit\): APP-1998-\d+ · Video Editor /)]),
      );
    });

    it('shows the latest verdict on the lists and the board, and filters by it; an application’s from its own comments only', async () => {
      const list = (await get('hr', `/recruitment/applications?vacancyId=${vacancyIds[0]}`).expect(200)).body as ApplicationListItem[];
      expect(Object.fromEntries(list.map((a) => [a.id, a.verdict]))).toEqual({ [apps.mine]: 'good_fit', [apps.adam]: null });
      const good = (await get('hr', `/recruitment/applications?vacancyId=${vacancyIds[0]}&verdict=good_fit`).expect(200)).body as ApplicationListItem[];
      expect(good.map((a) => a.id)).toEqual([apps.mine]);
      const none = (await get('hr', `/recruitment/applications?vacancyId=${vacancyIds[0]}&verdict=none`).expect(200)).body as ApplicationListItem[];
      expect(none.map((a) => a.id)).toEqual([apps.adam]);
      await get('hr', '/recruitment/applications?verdict=great').expect(400);
      const board = (await get('hr', `/recruitment/vacancies/${vacancyIds[0]}/board`).expect(200)).body as VacancyBoard;
      expect(board.columns.flatMap((c) => c.cards).find((c) => c.id === apps.mine)?.verdict).toBe('good_fit');
      // a newer general comment's verdict: the candidate's latest, never the application's
      await comment('hr', { candidateId, comment: 'Second thoughts after the call.', verdict: 'maybe' }).expect(201);
      expect(((await get('hr', `/recruitment/applications/${apps.mine}`).expect(200)).body as ApplicationListItem).verdict).toBe('good_fit');
      const candidates = (await get('hr', `/recruitment/candidates?q=${encodeURIComponent(`Sara Example ${RUN}`)}`).expect(200)).body as CandidateListItem[];
      expect(candidates.map((c) => [c.id, c.verdict])).toEqual([[candidateId, 'maybe']]);
      expect(((await get('hr', `/recruitment/candidates?q=${RUN}&verdict=maybe`).expect(200)).body as CandidateListItem[]).map((c) => c.id)).toEqual([candidateId]);
      expect((await get('hr', `/recruitment/candidates?q=${RUN}&verdict=good_fit`).expect(200)).body).toEqual([]);
      // the general CVs' tab
      await comment('hr', { generalCvId, comment: 'Kept for the next opening.', verdict: 'not_a_fit' }).expect(201);
      const cvs = (await get('hr', `/recruitment/general-cvs?q=${RUN}`).expect(200)).body as GeneralCvListItem[];
      expect(cvs.map((c) => [c.id, c.verdict])).toEqual([[generalCvId, 'not_a_fit']]);
      expect(((await get('hr', `/recruitment/general-cvs?q=${RUN}&verdict=none`).expect(200)).body as GeneralCvListItem[]).map((c) => c.id)).toEqual([]);
      // the verdict moves no stage
      expect((await get('hr', `/recruitment/applications/${apps.mine}`).expect(200)).body.stage).toBe('shortlisted');
    });

    it('edits their own comment within 24 hours ("edited"), never someone else’s, nor after', async () => {
      const edited = (await patch('hr', `/recruitment/comments/${onRecord.id}`, { comment: 'Strong reel, fast cuts, good colour.', verdict: 'maybe' }).expect(200)).body as ScreeningCommentView;
      expect(edited).toMatchObject({ comment: 'Strong reel, fast cuts, good colour.', verdict: 'maybe', editedAt: expect.any(String) });
      expect(said(await patch('hr2', `/recruitment/comments/${onRecord.id}`, { comment: 'Mine now' }).expect(403))).toEqual(['Only its author edits a comment.']);
      await prisma.screeningComment.update({ where: { id: onRecord.id }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
      expect(said(await patch('hr', `/recruitment/comments/${onRecord.id}`, { verdict: 'good_fit' }).expect(403))).toEqual(['A comment can be edited for 24 hours after it was written.']);
      const seen = ((await get('hr', `/recruitment/candidates/${candidateId}/comments`).expect(200)).body as ScreeningComments).comments.find((c) => c.id === onRecord.id)!;
      expect(seen).toMatchObject({ can: { edit: false }, editableUntil: null, verdict: 'maybe' });
    });

    it('can’t delete one; a Super Admin can', async () => {
      const made = (await comment('hr', { candidateId, comment: 'Posted on the wrong person.' }).expect(201)).body as ScreeningCommentView;
      expect(said(await del('hr', `/recruitment/comments/${made.id}`).expect(403))).toEqual(['Only a Super Admin can delete records.']);
      await del('superAdmin', `/recruitment/comments/${made.id}`).expect(204);
      expect(await prisma.screeningComment.count({ where: { id: made.id } })).toBe(0);
      await del('superAdmin', `/recruitment/comments/${made.id}`).expect(404);
      const logged = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'screening_comment', entityId: made.id, action: 'delete' }, select: { userId: true, diff: true } });
      expect(logged.userId).toBe(users.superAdmin);
      expect(JSON.stringify(logged.diff)).not.toContain('wrong person');
    });
  });

  describe('the hiring manager and the interviewer', () => {
    it('the hiring manager reads and writes on their vacancy’s applicant only, marked with their role', async () => {
      const mine = (await get('hm', `/recruitment/applications/${apps.mine}/comments`).expect(200)).body as ScreeningComments;
      // the application's own: never the general ones nor the general CV's
      expect(mine.comments.every((c) => c.about.kind === 'application' && c.about.id === apps.mine)).toBe(true);
      expect(mine.targets.map((t) => t.key)).toEqual([`application:${apps.mine}`]);
      expect(mine.cvs.map((c) => c.key)).toEqual([`application:${apps.mine}`]);
      const made = (await comment('hm', { applicationId: apps.mine, comment: 'Would fit the team.', verdict: 'good_fit' }).expect(201)).body as ScreeningCommentView;
      expect(made).toMatchObject({ authorRole: 'hiring_manager', author: { email: emails.hm } });
      // and HR reads it with the role
      const hr = (await get('hr', `/recruitment/applications/${apps.mine}/comments`).expect(200)).body as ScreeningComments;
      expect(hr.comments.find((c) => c.id === made.id)?.authorRole).toBe('hiring_manager');
    });

    it('the hiring manager is refused the general comments, the general CVs, another vacancy’s and the candidate’s profile', async () => {
      expect(said(await comment('hm', { candidateId, comment: 'About her in general' }).expect(403))[0]).toMatch(/^Only HR, the CEO and a Super Admin/);
      await comment('hm', { generalCvId, comment: 'On the CV' }).expect(403);
      await comment('hm', { applicationId: apps.other, comment: 'On Omar’s' }).expect(404);
      await get('hm', `/recruitment/applications/${apps.other}/comments`).expect(404);
      await get('hm', `/recruitment/candidates/${candidateId}/comments`).expect(403);
      await get('hm', `/recruitment/candidates/${candidateId}`).expect(403);
      await get('hm', `/recruitment/general-cvs/${generalCvId}/comments`).expect(403);
      // another vacancy's hiring manager sees nothing of Hana's
      await get('otherHm', `/recruitment/applications/${apps.mine}/comments`).expect(404);
      const theirs = (await get('otherHm', `/recruitment/applications/${apps.other}/comments`).expect(200)).body as ScreeningComments;
      expect(theirs.comments).toEqual([]);
    });

    it('the interviewer the same, on the applicant they interview only', async () => {
      const made = (await comment('iv', { applicationId: apps.mine, comment: 'Answered the brief well.' }).expect(201)).body as ScreeningCommentView;
      expect(made.authorRole).toBe('interviewer');
      const seen = (await get('iv', `/recruitment/applications/${apps.mine}/comments`).expect(200)).body as ScreeningComments;
      expect(seen.comments.map((c) => c.about.kind)).not.toContain('general');
      expect(seen.comments.map((c) => c.about.kind)).not.toContain('general_cv');
      await comment('iv', { applicationId: apps.adam, comment: 'Not mine' }).expect(404);
      await comment('iv', { candidateId, comment: 'General' }).expect(403);
      await get('iv', `/recruitment/candidates/${candidateId}/comments`).expect(403);
      await get('iv', `/recruitment/applications/${apps.other}/comments`).expect(404);
    });
  });

  describe('mentions', () => {
    it('tell those mentioned who may read it (names only); one who may not is refused', async () => {
      const all = (await get('hr', `/recruitment/applications/${apps.mine}/comments`).expect(200)).body as ScreeningComments;
      const target = all.targets.find((t) => t.key === `application:${apps.mine}`)!;
      // who may read a comment on Sara's Video Editor application: HR, the CEO, the Super Admins, Hana and Ivan; not Omar
      expect(target.mentionable).toEqual(expect.arrayContaining([users.hm, users.iv, users.ceo, users.superAdmin, users.hr2]));
      expect(target.mentionable).not.toContain(users.otherHm);
      expect(target.mentionable).not.toContain(users.hr);
      expect(all.people.find((p) => p.id === users.hm)).toMatchObject({ role: 'hiring_manager', name: `Hana Hiring ${RUN}` });
      const made = (await comment('hr', { applicationId: apps.mine, comment: '@Hana Hiring what did you think?', mentions: [users.hm, users.iv] }).expect(201)).body as ScreeningCommentView;
      expect(made.mentions.map((m) => m.id).sort()).toEqual([users.hm, users.iv].sort());
      const told = await mentions('hm');
      expect(told).toHaveLength(1);
      expect(told[0]).toMatchObject({ link: `/recruitment/applicants/${apps.mine}#screening-comments` });
      expect(told[0].title).toMatch(/mentioned you in a screening comment$/);
      // named as on the application, with its reference and job
      expect(told[0].body).toMatch(new RegExp(`^Sara ${RUN} · APP-1998-\\d+ · Video Editor ${RUN}$`));
      expect(JSON.stringify(told)).not.toContain('what did you think');
      // Omar can't read Sara's Video Editor comments, nor Hana a general one
      expect(said(await comment('hr', { applicationId: apps.mine, comment: 'FYI', mentions: [users.otherHm] }).expect(400))).toEqual([`Omar Manager ${RUN} can’t read this comment, so they can’t be mentioned.`]);
      await comment('hr', { candidateId, comment: 'FYI', mentions: [users.hm] }).expect(400);
      expect(await mentions('otherHm')).toEqual([]);
      // an edit tells only the newly mentioned
      const edit = (await patch('hr', `/recruitment/comments/${made.id}`, { mentions: [users.hm, users.iv, users.ceo] }).expect(200)).body as ScreeningCommentView;
      expect(edit.mentions).toHaveLength(3);
      expect(await mentions('hm')).toHaveLength(1);
      expect(await mentions('ceo')).toHaveLength(1);
    });
  });

  describe('C-level', () => {
    it('the C-level application’s comments are the CEO’s and the Super Admins’: hidden from HR, and from HR’s verdict', async () => {
      const chief = (await comment('ceo', { applicationId: apps.chief, comment: 'Ready to lead the team.', verdict: 'not_a_fit' }).expect(201)).body as ScreeningCommentView;
      expect(chief.authorRole).toBe('ceo');
      // HR may not be mentioned on it
      await comment('ceo', { applicationId: apps.chief, comment: 'FYI', mentions: [users.hr] }).expect(400);
      await comment('hr', { applicationId: apps.chief, comment: 'Me too' }).expect(404);
      await get('hr', `/recruitment/applications/${apps.chief}/comments`).expect(404);
      const forHr = (await get('hr', `/recruitment/candidates/${candidateId}/comments`).expect(200)).body as ScreeningComments;
      expect(forHr.comments.map((c) => c.id)).not.toContain(chief.id);
      const forCeo = (await get('ceo', `/recruitment/candidates/${candidateId}/comments`).expect(200)).body as ScreeningComments;
      expect(forCeo.comments[0].id).toBe(chief.id);
      // the CEO's latest is theirs on the C-level application; HR's the newest they may see, Hana's Good fit
      expect(forCeo.verdict).toBe('not_a_fit');
      expect(forHr.verdict).toBe('good_fit');
      const hrList = (await get('hr', `/recruitment/candidates?q=${RUN}`).expect(200)).body as CandidateListItem[];
      const ceoList = (await get('ceo', `/recruitment/candidates?q=${RUN}`).expect(200)).body as CandidateListItem[];
      expect(ceoList.find((c) => c.id === candidateId)?.verdict).toBe('not_a_fit');
      expect(hrList.find((c) => c.id === candidateId)?.verdict).toBe('good_fit');
      expect(((await get('hr', `/recruitment/candidates?q=${RUN}&verdict=not_a_fit`).expect(200)).body as CandidateListItem[]).map((c) => c.id)).toEqual([]);
      expect((await get('hr', `/recruitment/candidates/${candidateId}`).expect(200)).body.timeline.some((t: { href: string | null }) => t.href?.includes(apps.chief))).toBe(false);
    });
  });

  describe('HR’s notes of before', () => {
    it('move into a first comment of their record, "HR (earlier notes)", at its last change, once; the old addresses answer 410', async () => {
      await prisma.jobApplication.update({ where: { id: apps.other }, data: { notes: '  Asked about relocation.  ' } });
      await prisma.generalCv.update({ where: { id: generalCvId }, data: { notes: 'Met at the fair.' } });
      // one without a candidate yet waits for it
      await prisma.jobApplication.update({ where: { id: apps.adam }, data: { notes: 'Call back in May.' } });
      const comments = app.get(ScreeningCommentsService);
      const first = await comments.moveEarlierNotes();
      expect(first.applications).toBeGreaterThanOrEqual(1);
      expect(first.generalCvs).toBeGreaterThanOrEqual(1);
      const moved = await prisma.screeningComment.findMany({ where: { fromNotes: true, OR: [{ applicationId: apps.other }, { generalCvId }] }, select: { text: true, authorId: true, authorLabel: true, verdict: true, createdAt: true, applicationId: true } });
      const app2 = await prisma.jobApplication.findUniqueOrThrow({ where: { id: apps.other }, select: { updatedAt: true } });
      expect(moved.find((m) => m.applicationId === apps.other)).toMatchObject({ text: 'Asked about relocation.', authorId: null, authorLabel: EARLIER_NOTES_AUTHOR, verdict: null, createdAt: app2.updatedAt });
      expect(moved.find((m) => !m.applicationId)?.text).toBe('Met at the fair.');
      expect(await prisma.screeningComment.count({ where: { applicationId: apps.adam } })).toBe(0);
      // again: nothing more
      expect(await comments.moveEarlierNotes()).toEqual({ applications: 0, generalCvs: 0 });
      const seen = ((await get('hr', `/recruitment/candidates/${candidateId}/comments`).expect(200)).body as ScreeningComments).comments.find((c) => c.comment === 'Asked about relocation.');
      expect(seen).toMatchObject({ author: null, authorLabel: EARLIER_NOTES_AUTHOR, authorRole: null, can: { edit: false } });
      expect(await prisma.auditLog.count({ where: { entityType: 'screening_comment', action: 'move_notes' } })).toBeGreaterThan(0);
      // nothing writes the notes now
      expect(said(await patch('hr', `/recruitment/applications/${apps.mine}/notes`, { notes: 'x' }).expect(410))[0]).toMatch(/screening comments now/);
      await patch('hr', `/recruitment/general-cvs/${generalCvId}/notes`, { notes: 'x' }).expect(410);
    });
  });

  describe('the CV window’s PDF', () => {
    let convert: MockInstance<PdfService['fromDocx']>;
    let available: MockInstance<() => boolean>;

    beforeAll(() => {
      const pdf = app.get(PdfService);
      convert = vi.spyOn(pdf, 'fromDocx').mockImplementation(async () => CONVERTED);
      available = vi.spyOn(pdf, 'available', 'get').mockReturnValue(true);
    });

    afterAll(() => {
      convert.mockRestore();
      available.mockRestore();
    });

    const preview = (as: string, path: string) => get(as, path).buffer(true).parse(bytes);

    it('a PDF as sent; a Word CV converted once and kept; refused in words without the converter; never to a developer', async () => {
      const shown = await preview('hm', `/recruitment/applications/${apps.mine}/cv/preview`).expect(200);
      expect(shown.headers['content-type']).toBe('application/pdf');
      expect(shown.headers['content-disposition']).toMatch(/^inline/);
      expect(Buffer.compare(shown.body as Buffer, PDF)).toBe(0);
      expect(convert).not.toHaveBeenCalled();
      // Sara's general CV is a Word file
      const word = await preview('hr', `/recruitment/general-cvs/${generalCvId}/cv/preview`).expect(200);
      expect(Buffer.compare(word.body as Buffer, CONVERTED)).toBe(0);
      expect(word.headers['content-disposition']).toContain('Sara%20CV.pdf');
      await preview('hr', `/recruitment/general-cvs/${generalCvId}/cv/preview`).expect(200);
      expect(convert).toHaveBeenCalledTimes(1);
      // without the converter: the kept one still shows; a Word CV never converted is refused in words
      available.mockReturnValue(false);
      await preview('hr', `/recruitment/general-cvs/${generalCvId}/cv/preview`).expect(200);
      const refused = await get('hr', `/recruitment/applications/${apps.adam}/cv/preview`).expect(409);
      expect(refused.body.message).toBe("The PDF converter isn't set up on the server, so a Word CV can't be shown here: download it instead.");
      available.mockReturnValue(true);
      // who may open the applicant, as the CV itself
      await get('otherHm', `/recruitment/applications/${apps.mine}/cv/preview`).expect(404);
      await get('hm', `/recruitment/general-cvs/${generalCvId}/cv/preview`).expect(403);
      for (const path of [`/recruitment/applications/${apps.mine}/cv/preview`, `/recruitment/general-cvs/${generalCvId}/cv/preview`]) {
        const res = await get('developer', path).expect(403);
        expect(res.body.message).toBe(DEVELOPER_NO_FILES);
      }
    });
  });

  describe('a developer', () => {
    it('reads the comments as "••••", the authors and those mentioned as pseudonyms; writes nothing', async () => {
      const seen = (await get('developer', `/recruitment/candidates/${candidateId}/comments`).expect(200)).body as ScreeningComments;
      expect(seen.comments.length).toBeGreaterThan(3);
      expect(seen.comments.every((c) => c.comment === HIDDEN)).toBe(true);
      const text = JSON.stringify(seen);
      for (const real of ['Strong reel', 'Calm and clear', emails.hr, emails.hm, `Hana Hiring ${RUN}`, `Sara Example ${RUN}`]) expect(text).not.toContain(real);
      expect(seen.comments.find((c) => c.author)?.author?.email).not.toBe(emails.hr);
      await comment('developer', { candidateId, comment: 'Nope' }).expect(403);
    });
  });

  describe('the audit log', () => {
    it('keeps each write, never the text', async () => {
      const rows = await prisma.auditLog.findMany({ where: { entityType: 'screening_comment', userId: { in: [users.hr, users.hm, users.iv, users.ceo] } }, select: { action: true, diff: true } });
      expect(new Set(rows.map((r) => r.action))).toEqual(new Set(['create', 'update']));
      const text = JSON.stringify(rows.map((r) => r.diff));
      for (const words of ['Strong reel', 'Would fit the team', 'Answered the brief', 'Ready to lead']) expect(text).not.toContain(words);
      const changes = rows.filter((r) => r.action === 'update').map((r) => (r.diff as { changed: string[] }).changed);
      expect(changes).toEqual(expect.arrayContaining([expect.arrayContaining(['text', 'verdict']), ['mentions']]));
    });
  });
});
