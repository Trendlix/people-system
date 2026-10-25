import type { INestApplication } from '@nestjs/common';
import { EARLIER_OFFERS_OFF } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { MockInstance } from 'vitest';
import { addDays, dayInCairo, shownDate, todayInCairo } from '../src/common/date-only.js';
import { MailService } from '../src/mail/mail.service.js';
import { PdfService } from '../src/pdf/pdf.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { paragraphTexts, textParts } from '../src/templates/docx-tags.js';
import { readZip } from '../src/templates/zip.js';
import { docx, p, r } from './fixtures/docx.js';
import { convertedPdf } from './fixtures/pdf.js';
import { createApp, createUser, signIn } from './helpers.js';

// Earlier job offers (owner, 25 October 2026: "allow the HR to add for now job offers with a past duedate to enter the
// previous data"): Recruitment Settings' "Entering earlier offers" (on for now; HR and a Super Admin switch it, audited),
// and while it is on, an offer saved with a past last day, recorded as sent earlier (no email, no link) and answered on
// a past day, with nothing sent to anyone; off, the rules as before. Emailing or linking an offer past its last day
// stays refused. Email is kept in MailService's outbox (MAIL_TRANSPORT=memory); the PDF converter is stood in for.
process.env.MAIL_TRANSPORT = 'memory';

const RUN = `${Date.now().toString(36)}8`;
const TODAY = todayInCairo();
const ORIGIN = 'https://people.example.com';
const PAST_LAST_DAY = "The offer's last day can't be in the past.";
/** An earlier offer's days: sent, its last day, the answer, the join date. */
const SENT_ON = addDays(TODAY, -60);
const LAST_DAY = addDays(TODAY, -53);
const ANSWERED_ON = addDays(TODAY, -55);
const JOINED = addDays(TODAY, -45);

/** The printed text of a .docx, one paragraph per line. */
function textOf(file: Buffer): string {
  const zip = readZip(file);
  return textParts(zip.entries.map((e) => e.name))
    .flatMap((name) => paragraphTexts(zip.read(name)!.toString('utf8')))
    .join('\n');
}

interface Offer {
  id: string;
  number: string;
  status: string;
  [key: string]: any;
}

describe('Earlier job offers (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mail: MailService;
  let hr: string;
  let hr2: string;
  let ceo: string;
  let finance: string;
  let staff: string;
  let superAdmin: string;
  let jobTitleId: string;
  let gradeId: string;
  let shiftId: string;
  let convert: MockInstance<PdfService['fromDocx']>;
  const api = () => request(app.getHttpServer());

  const create = (body: object, session = hr) => api().post('/api/offers').set('Cookie', session).send(body);
  const patch = (id: string, body: object, session = hr) => api().patch(`/api/offers/${id}`).set('Cookie', session).send(body);
  const send = (id: string, body: object, session = hr) => api().post(`/api/offers/${id}/send`).set('Cookie', session).send(body);
  const recordSent = (id: string, body: object, session = hr) => api().post(`/api/offers/${id}/record-sent`).set('Cookie', session).send(body);
  const answer = (id: string, body: object, session = hr) => api().post(`/api/offers/${id}/answer`).set('Cookie', session).send(body);
  const switchTo = (on: unknown, session = hr) => api().put('/api/recruitment/settings/earlier-offers').set('Cookie', session).send({ on });
  const lastAudit = (entityType: string, action: string, entityId?: string) =>
    prisma.auditLog.findFirst({ where: { entityType, action, ...(entityId !== undefined && { entityId }) }, orderBy: { id: 'desc' } });

  /** A candidate's offer as HR types it, unique to this run. */
  const candidate = (name: string, extra: object = {}) => ({
    fullNameEn: `${name} ${RUN}`,
    fullNameAr: 'سارة أحمد',
    email: `${name.toLowerCase().replace(/\s+/g, '.')}.${RUN}@mail.test`,
    employmentType: 'full_time',
    joinDate: addDays(TODAY, 21),
    jobTitleId,
    gradeId,
    shiftId,
    grossSalary: 18000,
    ...extra,
  });
  const draft = async (name: string, extra: object = {}, session = hr): Promise<Offer> => (await create(candidate(name, extra), session).expect(201)).body as Offer;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    mail = app.get(MailService);
    const pdf = app.get(PdfService);
    // the converter (Gotenberg) can't run here: said to be set up, its PDF stood in for
    const converted = await convertedPdf();
    vi.spyOn(pdf, 'available', 'get').mockReturnValue(true);
    convert = vi.spyOn(pdf, 'fromDocx').mockImplementation(async () => converted);
    await prisma.generatedDocument.deleteMany();
    await prisma.jobOffer.deleteMany();
    await prisma.templateVersion.deleteMany();
    // on for now: as before any change (no settings row)
    await prisma.recruitmentSettings.deleteMany();

    hr = await signIn(app, await createUser(prisma, ['hr']));
    hr2 = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));

    const dept = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Studio ${RUN}`, nameAr: 'الاستوديو' }).expect(201);
    const grades = (await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[];
    gradeId = grades.find((g) => g.code === 'G4')!.id;
    const title = await api()
      .post('/api/job-titles')
      .set('Cookie', hr)
      .send({ departmentId: dept.body.id, titleEn: `Editor ${RUN}`, titleAr: 'محرر', minGradeId: gradeId, maxGradeId: gradeId })
      .expect(201);
    jobTitleId = title.body.id;
    shiftId = ((await api().get('/api/shifts').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((s) => s.code === 'A')!.id;

    // the full-time job offer template, published by a Super Admin; the part-time one never is here
    const upload = await api()
      .post('/api/templates/offer_full_time/versions')
      .set('Cookie', superAdmin)
      .attach('file', docx({ body: p(r('{{full_name_en}} — {{offer_number}} open until {{offer_expiry}}')) + p(r('Dated {{date}}')) }), 'offer_full_time.docx')
      .field('language', 'en')
      .expect(201);
    await api().post(`/api/templates/versions/${upload.body.id}/publish`).set('Cookie', superAdmin).expect(200);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.generatedDocument.deleteMany();
    await prisma.jobOffer.deleteMany();
    await prisma.recruitmentSettings.deleteMany();
    await app.close();
  });

  describe('the switch', () => {
    it('is on for now; HR and a Super Admin switch it, audited; the CEO reads it', async () => {
      expect((await api().get('/api/recruitment/settings/earlier-offers').set('Cookie', hr).expect(200)).body).toMatchObject({ on: true });
      expect((await api().get('/api/recruitment/settings/earlier-offers').set('Cookie', ceo).expect(200)).body).toMatchObject({ on: true });
      await api().get('/api/recruitment/settings/earlier-offers').set('Cookie', finance).expect(403);
      await switchTo(false, ceo).expect(403);
      await switchTo(false, staff).expect(403);
      expect((await switchTo('yes').expect(400)).body.message).toEqual(['Say whether entering earlier offers is on or off.']);

      expect((await switchTo(false).expect(200)).body).toMatchObject({ on: false });
      expect((await lastAudit('recruitment_settings', 'update'))?.diff).toEqual({ earlierOffers: { from: true, to: false } });
      // the same again: nothing changes, nothing logged
      const logged = await prisma.auditLog.count({ where: { entityType: 'recruitment_settings' } });
      await switchTo(false).expect(200);
      expect(await prisma.auditLog.count({ where: { entityType: 'recruitment_settings' } })).toBe(logged);

      expect((await switchTo(true, superAdmin).expect(200)).body).toMatchObject({ on: true });
      expect((await lastAudit('recruitment_settings', 'update'))?.diff).toEqual({ earlierOffers: { from: false, to: true } });
      // the rest of Recruitment Settings as it was
      expect((await api().get('/api/recruitment/settings').set('Cookie', hr).expect(200)).body.rejection).toEqual({ subject: null, en: null, ar: null });
    });
  });

  describe('switched off', () => {
    beforeAll(async () => {
      await switchTo(false).expect(200);
    });
    afterAll(async () => {
      await switchTo(true).expect(200);
    });

    it('the rules are as before it: no past last day, no Record as sent earlier, an answer dated today', async () => {
      expect((await create(candidate('Off Past', { expiresOn: addDays(TODAY, -1) })).expect(400)).body.message).toBe(PAST_LAST_DAY);
      const o = await draft('Off Draft');
      expect(o.recordedEarlier).toBe(false);
      expect(o.earlierOffers).toBe(false);
      expect((await patch(o.id, { expiresOn: addDays(TODAY, -3) }).expect(400)).body.message).toBe(PAST_LAST_DAY);
      expect((await recordSent(o.id, { sentOn: addDays(TODAY, -3) }).expect(409)).body.message).toBe(`${EARLIER_OFFERS_OFF} Send the offer by email or as a link instead.`);
      expect((await answer(o.id, { answer: 'declined', answeredOn: addDays(TODAY, -1) }).expect(400)).body.message).toBe(
        "Only an earlier offer's answer is dated another day than today, while entering earlier offers is on.",
      );
      expect((await prisma.jobOffer.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('draft');
    });
  });

  describe('switched on', () => {
    it('enters an earlier offer: a past last day, recorded as sent earlier, accepted on a past day, and nothing is emailed', async () => {
      expect(await mail.ready()).toBe(true); // so a message would land in the outbox
      const outbox = mail.outbox.length;

      // a past last day and join date: an earlier offer, noted in the audit log
      const o = await draft('Sara Earlier', { expiresOn: LAST_DAY, joinDate: JOINED });
      expect(o).toMatchObject({ status: 'draft', recordedEarlier: true, earlierOffers: true, expiresOn: LAST_DAY, joinDate: JOINED });
      expect((await lastAudit('job_offer', 'create', o.id))?.diff).toMatchObject({ number: o.number, expiresOn: LAST_DAY, recordedEarlier: true });
      // marked in the list
      const list = (await api().get('/api/offers').query({ q: o.number }).set('Cookie', hr).expect(200)).body as Offer[];
      expect(list).toEqual([expect.objectContaining({ id: o.id, status: 'draft', recordedEarlier: true })]);

      // emailing or linking it past its last day stays refused
      const passed = `The offer's last day, ${shownDate(LAST_DAY)}, has passed. Set a later last day, then send it again.`;
      expect((await send(o.id, { via: 'link', origin: ORIGIN }).expect(409)).body.message).toBe(passed);
      expect((await send(o.id, { via: 'email', origin: ORIGIN }).expect(409)).body.message).toBe(passed);

      // the day it was sent: not in the future, nor after its last day; HR, the CEO and a Super Admin only
      expect((await recordSent(o.id, { sentOn: addDays(TODAY, 1) }).expect(400)).body.message).toBe("The day it was sent can't be in the future.");
      expect((await recordSent(o.id, { sentOn: addDays(LAST_DAY, 1) }).expect(400)).body.message).toBe(
        `It can't have been sent after its last day, ${shownDate(LAST_DAY)}. Choose an earlier day, or edit the last day first.`,
      );
      expect((await recordSent(o.id, { sentOn: '2026-02-30' }).expect(400)).body.message).toEqual(['Enter the day the offer was sent as a real date.']);
      await recordSent(o.id, { sentOn: SENT_ON }, finance).expect(403);
      await recordSent(o.id, { sentOn: SENT_ON }, staff).expect(403);

      // recorded as sent: outside the system, on that day, no link; the document filled in as of that day and kept
      const filledBefore = convert.mock.calls.length;
      const sent = (await recordSent(o.id, { sentOn: SENT_ON }).expect(200)).body as Offer;
      expect(sent).toMatchObject({ status: 'expired', sentVia: 'outside', sentTo: null, sentCount: 1, recordedEarlier: true, viewedAt: null });
      expect(dayInCairo(new Date(sent.sentAt))).toBe(SENT_ON);
      expect(sent.document).toMatchObject({ documentDate: SENT_ON, hasPdf: true });
      expect(convert.mock.calls.length).toBe(filledBefore + 1);
      const row = await prisma.jobOffer.findUniqueOrThrow({ where: { id: o.id }, select: { tokenHash: true, data: true, pdf: true } });
      expect(row.tokenHash).toBeNull();
      expect(row.pdf).not.toBeNull();
      expect(textOf(Buffer.from(row.data!))).toBe(`Sara Earlier ${RUN} — ${o.number} open until ${shownDate(LAST_DAY)}\nDated ${shownDate(SENT_ON)}`);
      expect((await lastAudit('job_offer', 'record_sent', o.id))?.diff).toMatchObject({
        number: o.number,
        status: { from: 'draft', to: 'sent' },
        via: 'outside',
        sentOn: SENT_ON,
        recordedEarlier: true,
        document: { documentDate: SENT_ON, pdf: true },
      });
      // only once: it is no longer a draft
      expect((await recordSent(o.id, { sentOn: SENT_ON }).expect(409)).body.message).toBe(`${o.number} has expired: only a draft can be recorded as sent earlier.`);

      // never emailed or linked, even with a later last day
      await patch(o.id, { expiresOn: addDays(TODAY, 10) }).expect(200);
      expect((await send(o.id, { via: 'link', origin: ORIGIN }).expect(409)).body.message).toBe(
        `${o.number} is an earlier offer, recorded as sent outside the system: it is never emailed or linked. To send the candidate an offer now, draft a new one.`,
      );
      // its last day back in the past, never before the day it was sent
      expect((await patch(o.id, { expiresOn: addDays(SENT_ON, -1) }).expect(400)).body.message).toBe(`The offer's last day can't be before the day it was sent, ${shownDate(SENT_ON)}.`);
      expect((await patch(o.id, { expiresOn: LAST_DAY }).expect(200)).body).toMatchObject({ status: 'expired', expiresOn: LAST_DAY });

      // the answer: past its last day, on a past day (not before it was sent, nor in the future)
      expect((await answer(o.id, { answer: 'accepted', answeredOn: addDays(SENT_ON, -1) }, hr2).expect(400)).body.message).toBe(
        `The answer can't be before the offer was sent, on ${shownDate(SENT_ON)}.`,
      );
      expect((await answer(o.id, { answer: 'accepted', answeredOn: addDays(TODAY, 1) }, hr2).expect(400)).body.message).toBe("The day of the answer can't be in the future.");
      await answer(o.id, { answer: 'accepted', answeredOn: ANSWERED_ON }, finance).expect(403);
      const accepted = (await answer(o.id, { answer: 'accepted', answeredOn: ANSWERED_ON }, hr2).expect(200)).body as Offer;
      expect(accepted).toMatchObject({ status: 'accepted', hireError: null, recordedEarlier: true });
      expect(dayInCairo(new Date(accepted.respondedAt))).toBe(ANSWERED_ON);
      expect(accepted.hiredAt).not.toBeNull();
      expect((await lastAudit('job_offer', 'answer', o.id))?.diff).toMatchObject({
        number: o.number,
        status: { from: 'sent', to: 'accepted' },
        answeredOn: ANSWERED_ON,
        recordedEarlier: true,
      });

      // like any accepted offer: the profile, the employment from the (past) join date, a draft contract, the document
      const employment = await prisma.employment.findFirstOrThrow({ where: { employeeId: accepted.employeeId }, include: { contracts: true } });
      expect(employment.joinDate.toISOString().slice(0, 10)).toBe(JOINED);
      expect(employment.contracts).toEqual([expect.objectContaining({ status: 'draft', version: 1 })]);
      const kept = await prisma.generatedDocument.findFirstOrThrow({ where: { employeeId: accepted.employeeId } });
      expect(kept.documentDate.toISOString().slice(0, 10)).toBe(SENT_ON);

      // nothing reached anyone: no email to the candidate, nor to HR who recorded it as sent
      expect(mail.outbox.length).toBe(outbox);
    });

    it('records it with no document while the template is not published; the CEO records a decline on its day', async () => {
      const outbox = mail.outbox.length;
      const o = await draft('Omar Part Time', { employmentType: 'part_time', expiresOn: LAST_DAY, joinDate: JOINED, daysPerWeek: 3 });
      expect(o).toMatchObject({ recordedEarlier: true, template: { status: 'missing' } });
      const sent = (await recordSent(o.id, { sentOn: SENT_ON }, ceo).expect(200)).body as Offer;
      expect(sent).toMatchObject({ status: 'expired', sentVia: 'outside', document: null, recordedEarlier: true });
      expect((await lastAudit('job_offer', 'record_sent', o.id))?.diff).toMatchObject({ via: 'outside', sentOn: SENT_ON, document: expect.stringMatching(/^none: the .+ template isn't published$/) });

      const declined = (await answer(o.id, { answer: 'declined', reason: 'Took another job', answeredOn: ANSWERED_ON }, ceo).expect(200)).body as Offer;
      expect(declined).toMatchObject({ status: 'declined', declineReason: 'Took another job', employeeId: null });
      expect(dayInCairo(new Date(declined.respondedAt))).toBe(ANSWERED_ON);
      expect(mail.outbox.length).toBe(outbox);
    });

    it("a draft given a past last day is an earlier one, a later one makes it ordinary again; any draft can be recorded as sent earlier", async () => {
      const o = await draft('Lina Later');
      expect(o.recordedEarlier).toBe(false);
      expect((await patch(o.id, { expiresOn: LAST_DAY }).expect(200)).body).toMatchObject({ recordedEarlier: true, expiresOn: LAST_DAY });
      expect((await lastAudit('job_offer', 'update', o.id))?.diff).toMatchObject({ expiresOn: { from: addDays(TODAY, 7), to: LAST_DAY }, recordedEarlier: { from: false, to: true } });
      expect((await patch(o.id, { expiresOn: addDays(TODAY, 5) }).expect(200)).body).toMatchObject({ recordedEarlier: false });

      // a draft still open, handed over earlier: recorded as sent today, then never sent from the system
      const sent = (await recordSent(o.id, { sentOn: TODAY }).expect(200)).body as Offer;
      expect(sent).toMatchObject({ status: 'sent', recordedEarlier: true, sentVia: 'outside' });
      expect((await send(o.id, { via: 'link', origin: ORIGIN }).expect(409)).body.message).toContain('is an earlier offer');
      await prisma.jobOffer.delete({ where: { id: o.id } });
    });

    it('an offer sent from the system keeps the rules: no past last day, an answer dated today, by HR only', async () => {
      const o = await draft('Mona Online');
      const res = await send(o.id, { via: 'link', origin: ORIGIN }).expect(200);
      expect(res.body.offer).toMatchObject({ status: 'sent', sentVia: 'link', recordedEarlier: false });
      expect((await patch(o.id, { expiresOn: addDays(TODAY, -2) }).expect(400)).body.message).toBe(PAST_LAST_DAY);
      expect((await recordSent(o.id, { sentOn: TODAY }).expect(409)).body.message).toBe(`${o.number} was sent: only a draft can be recorded as sent earlier.`);
      expect((await answer(o.id, { answer: 'declined', answeredOn: addDays(TODAY, -1) }).expect(400)).body.message).toBe(
        "Only an earlier offer's answer is dated another day than today, while entering earlier offers is on.",
      );
      expect((await answer(o.id, { answer: 'declined' }, ceo).expect(403)).body.message).toBe(
        "Only HR records a candidate's answer. The CEO and a Super Admin record an earlier offer's, while entering earlier offers is on.",
      );
      // past its last day: refused as before, the switch on or not
      await prisma.jobOffer.update({ where: { id: o.id }, data: { expiresOn: new Date(`${addDays(TODAY, -1)}T00:00:00.000Z`) } });
      expect((await answer(o.id, { answer: 'declined' }).expect(409)).body.message).toBe(
        `The offer's last day, ${shownDate(addDays(TODAY, -1))}, has passed. If the candidate answered in time, set a later last day first.`,
      );
      expect((await send(o.id, { via: 'link', origin: ORIGIN }).expect(409)).body.message).toBe(
        `The offer's last day, ${shownDate(addDays(TODAY, -1))}, has passed. Set a later last day, then send it again.`,
      );
    });

    it("switched off later, an earlier offer's answer is refused past its last day again", async () => {
      const o = await draft('Hana Pending', { expiresOn: LAST_DAY });
      await recordSent(o.id, { sentOn: SENT_ON }).expect(200);
      await switchTo(false).expect(200);
      try {
        expect((await answer(o.id, { answer: 'accepted', answeredOn: ANSWERED_ON }).expect(409)).body.message).toBe(
          `The offer's last day, ${shownDate(LAST_DAY)}, has passed. If the candidate answered in time, set a later last day first.`,
        );
        expect((await answer(o.id, { answer: 'accepted' }, ceo).expect(403)).body.message).toContain('Only HR records');
        const view = (await api().get(`/api/offers/${o.id}`).set('Cookie', hr).expect(200)).body as Offer;
        expect(view).toMatchObject({ status: 'expired', recordedEarlier: true, earlierOffers: false });
      } finally {
        await switchTo(true).expect(200);
      }
    });
  });
});
