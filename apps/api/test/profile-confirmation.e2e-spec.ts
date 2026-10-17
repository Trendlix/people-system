import type { INestApplication } from '@nestjs/common';
import { CONFIRM_FIELD_KEYS, PROFILE_DISCLAIMER } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The employee's own check of their details (owner's decision, 15 October 2026): the employee confirms their data
// once and after each change, accepting the statement, and asks for changes, which HR or an Admin approves or rejects.
// The employee is the sign-in account whose email is the profile's work email.

const RUN = Date.now().toString(36).toLowerCase();
const VERSION = PROFILE_DISCLAIMER.version;
const NEVER = { confirmedAt: null, confirmedBy: null, upToDate: false, changedFields: [], disclaimerVersion: null };
const WAITING = 'You already have a change request waiting for HR. Cancel it to send a new one.';

interface Confirmation {
  confirmedAt: string | null;
  confirmedBy: { email: string } | null;
  upToDate: boolean;
  changedFields: string[];
  disclaimerVersion: number | null;
}

interface ChangeRequest {
  id: string;
  employee: { id: string; employeeCode: string; fullNameEn: string };
  changes: { field: string; label: string; from: unknown; to: unknown }[];
  note: string | null;
  status: string;
  requestedBy: { email: string };
  requestedAt: string;
  decidedBy: { email: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

interface Profile {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  mobile: string | null;
  workEmail: string | null;
  confirmation: Confirmation;
  changeRequests: ChangeRequest[];
  isSelf: boolean;
  [key: string]: unknown;
}

/** An employee with their own sign-in account. */
interface Staff {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  email: string;
  session: string;
}

describe('Profile confirmation and change requests (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hrEmail: string;
  let adminEmail: string;
  let hr: string;
  let admin: string;
  let ceo: string;
  let finance: string;
  let emailDomainBefore: string | null;
  const api = () => request(app.getHttpServer());

  /** A profile with the given details, and a sign-in account (Employee role) whose email is its work email. */
  async function newStaff(name: string, details: Record<string, unknown> = {}, roles: ('employee' | 'manager')[] = ['employee']): Promise<Staff> {
    const email = await createUser(prisma, roles);
    const res = await api()
      .post('/api/employees')
      .set('Cookie', hr)
      .send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email, mobile: '010 1234 5678', dateOfBirth: '1995-03-12', ...details })
      .expect(201);
    return { id: res.body.id, employeeCode: res.body.employeeCode, fullNameEn: res.body.fullNameEn, email, session: await signIn(app, email) };
  }

  async function profileOf(id: string, session = hr): Promise<Profile> {
    return (await api().get(`/api/employees/${id}`).set('Cookie', session).expect(200)).body as Profile;
  }

  const confirm = (s: Staff, body: object = { accept: true, disclaimerVersion: VERSION }, session = s.session) =>
    api().post(`/api/employees/${s.id}/confirm`).set('Cookie', session).send(body);
  const ask = (s: Staff, body: object, session = s.session) => api().post(`/api/employees/${s.id}/change-requests`).set('Cookie', session).send(body);
  const act = (id: string, step: 'approve' | 'reject' | 'cancel', session: string, body: object = {}) =>
    api().post(`/api/change-requests/${id}/${step}`).set('Cookie', session).send(body);
  const patch = (s: Staff, body: object) => api().patch(`/api/employees/${s.id}`).set('Cookie', hr).send(body);

  async function asked(s: Staff, changes: object, note?: string): Promise<ChangeRequest> {
    return (await ask(s, { changes, ...(note && { note }) }).expect(201)).body as ChangeRequest;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hrEmail = await createUser(prisma, ['hr']);
    adminEmail = await createUser(prisma, ['admin']);
    hr = await signIn(app, hrEmail);
    admin = await signIn(app, adminEmail);
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    // sign-in accounts here are @test.local: no company email domain, except where a test sets one
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
  });

  afterAll(async () => {
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('confirmation', () => {
    it('never confirmed, then confirmed by the employee themself, accepting the statement in force', async () => {
      const s = await newStaff('Confirming Employee');
      const own = await profileOf(s.id, s.session);
      expect(own).toMatchObject({ isSelf: true, confirmation: NEVER, changeRequests: [] });
      expect(await profileOf(s.id)).toMatchObject({ isSelf: false, confirmation: NEVER });

      // not HR on the employee's behalf
      const byHr = await confirm(s, undefined, hr).expect(403);
      expect(byHr.body.message).toBe('Only the employee can confirm their own details.');
      const unticked = await confirm(s, { accept: false, disclaimerVersion: VERSION }).expect(400);
      expect(unticked.body.message).toBe('Tick the statement to confirm your details.');
      await confirm(s, { disclaimerVersion: VERSION }).expect(400);
      const stale = await confirm(s, { accept: true, disclaimerVersion: VERSION + 1 }).expect(409);
      expect(stale.body.message).toBe('The statement has changed; read it again and confirm.');
      expect((await profileOf(s.id, s.session)).confirmation).toEqual(NEVER);

      const done = await confirm(s).expect(201);
      expect(done.body).toEqual({ confirmedAt: expect.any(String), confirmedBy: { email: s.email }, upToDate: true, changedFields: [], disclaimerVersion: VERSION });
      // whoever sees the profile sees the confirmation
      expect((await profileOf(s.id)).confirmation).toEqual(done.body);
      expect((await profileOf(s.id, ceo)).confirmation).toEqual(done.body);

      // the values confirmed, every one of them: dates as YYYY-MM-DD, empty as null
      const [row] = await prisma.profileConfirmation.findMany({ where: { employeeId: s.id } });
      const snapshot = row.snapshot as Record<string, unknown>;
      expect(Object.keys(snapshot).sort()).toEqual([...CONFIRM_FIELD_KEYS].sort());
      expect(snapshot).toMatchObject({ fullNameEn: s.fullNameEn, mobile: '+201012345678', dateOfBirth: '1995-03-12', workEmail: s.email, city: null, graduationYear: null });
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'profile_confirmation', entityId: row.id } });
      expect(audit.map((a) => [a.action, a.diff])).toEqual([['confirm', { employeeId: s.id, disclaimerVersion: VERSION }]]);
    });

    it('an HR edit makes it stale, naming the fields changed; changing them back makes it up to date again', async () => {
      const s = await newStaff('Stale Employee', { graduationYear: 2018 });
      await confirm(s).expect(201);

      await patch(s, { mobile: '+201011112222' }).expect(200);
      expect((await profileOf(s.id, s.session)).confirmation).toMatchObject({ upToDate: false, changedFields: ['mobile'] });
      await patch(s, { graduationYear: 2019, dateOfBirth: '1995-03-13' }).expect(200);
      expect((await profileOf(s.id)).confirmation).toMatchObject({ upToDate: false, changedFields: ['dateOfBirth', 'mobile', 'graduationYear'] });

      await patch(s, { mobile: '010 1234 5678', graduationYear: 2018, dateOfBirth: '1995-03-12' }).expect(200);
      expect((await profileOf(s.id, s.session)).confirmation).toMatchObject({ upToDate: true, changedFields: [] });

      // confirming again after a change: the newest confirmation counts
      await patch(s, { city: 'مدينة نصر' }).expect(200);
      expect((await profileOf(s.id)).confirmation).toMatchObject({ upToDate: false, changedFields: ['city'] });
      await confirm(s).expect(201);
      expect((await profileOf(s.id)).confirmation).toMatchObject({ upToDate: true, changedFields: [] });
    });
  });

  describe('change requests', () => {
    it('checked and tidied as an HR edit; other fields, the same values and a second waiting request are refused', async () => {
      const s = await newStaff('Asking Employee');

      // the same message as HR's own edit
      const hrInvalid = await patch(s, { mobile: 'call me' }).expect(400);
      const invalid = await ask(s, { changes: { mobile: 'call me' } }).expect(400);
      expect(invalid.body.message).toEqual(hrInvalid.body.message);
      expect(invalid.body.message).toEqual(['Enter the mobile number with its country code, e.g. +201012345678.']);
      const unnamed = await ask(s, { changes: { fullNameEn: '' } }).expect(400);
      expect(unnamed.body.message).toEqual(['Enter the full name in English.']);

      const code = await ask(s, { changes: { employeeCode: 'EMP-9999' } }).expect(400);
      expect(code.body.message).toBe("employeeCode can't be changed by request.");
      const salary = await ask(s, { changes: { mobile: '+201098765432', salary: 1 } }).expect(400);
      expect(salary.body.message).toBe("salary can't be changed by request.");
      await ask(s, { changes: ['mobile'] }).expect(400);
      await ask(s, {}).expect(400);

      // the work email is the company's (changed with the sign-in account), so it can't be asked for
      const company = await ask(s, { changes: { workEmail: `me.${RUN}@gmail.com` } }).expect(400);
      expect(company.body.message).toBe('The work email is set by the company. Ask HR to change it.');
      // the checks across fields, as an HR edit makes them
      const military = await ask(s, { changes: { gender: 'female', militaryStatus: 'completed' } }).expect(400);
      expect(military.body.message).toBe('Military status applies to men only. For a woman it is Not applicable.');

      // the same number typed another way is no change
      const same = await ask(s, { changes: { mobile: '010 1234-5678', fullNameEn: ` ${s.fullNameEn} ` } }).expect(400);
      expect(same.body.message).toBe('Nothing would change: the new values are the same as the current ones.');
      // only the employee asks
      const byHr = await ask(s, { changes: { mobile: '+201098765432' } }, hr).expect(403);
      expect(byHr.body.message).toBe('Only the employee can ask for a change to their own details.');

      // tidied as saved, the unchanged left out, in the order the fields are shown
      const r = await asked(s, { city: ' مدينة نصر ', mobile: '٠١٠ ٩٨٧٦ ٥٤٣٢', fullNameEn: s.fullNameEn, personalEmail: ' Me@Example.COM ', graduationYear: 2018 }, 'New SIM card');
      expect(r).toEqual({
        id: expect.any(String),
        employee: { id: s.id, employeeCode: s.employeeCode, fullNameEn: s.fullNameEn },
        changes: [
          { field: 'personalEmail', label: 'Personal email', from: null, to: 'me@example.com' },
          { field: 'mobile', label: 'Mobile', from: '+201012345678', to: '+201098765432' },
          { field: 'city', label: 'City', from: null, to: 'مدينة نصر' },
          { field: 'graduationYear', label: 'Graduation year', from: null, to: 2018 },
        ],
        note: 'New SIM card',
        status: 'pending',
        requestedBy: { email: s.email },
        requestedAt: expect.any(String),
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
      });
      // nothing changes until HR approves
      expect((await profileOf(s.id)).mobile).toBe('+201012345678');

      const twice = await ask(s, { changes: { mobile: '+201011112222' } }).expect(409);
      expect(twice.body.message).toBe(WAITING);

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'profile_change_request', entityId: r.id } });
      expect(audit.map((a) => a.action)).toEqual(['create']);
      expect(audit[0].diff).toMatchObject({ employeeId: s.id, status: 'pending', note: 'New SIM card' });
    });

    it('shows on the profile to the employee, HR, Admin and the CEO; not to the manager or Finance', async () => {
      const boss = await newStaff('Request Manager', {}, ['manager', 'employee']);
      const s = await newStaff('Request Report');
      await api().post(`/api/employees/${s.id}/employments`).set('Cookie', hr).send({ employmentType: 'full_time', joinDate: '2026-01-15', managerId: boss.id }).expect(201);
      const r = await asked(s, { mobile2: '+201011112222' });

      for (const session of [s.session, hr, ceo]) {
        expect((await profileOf(s.id, session)).changeRequests.map((x) => [x.id, x.status])).toEqual([[r.id, 'pending']]);
      }
      const byManager = await profileOf(s.id, boss.session);
      expect(byManager).toMatchObject({ isSelf: false, changeRequests: [] });
      expect((await profileOf(boss.id, boss.session)).isSelf).toBe(true);
      expect((await profileOf(s.id, finance)).changeRequests).toEqual([]);
      // the manager can't ask on the employee's behalf
      await ask(s, { changes: { mobile2: null } }, boss.session).expect(403);
    });

    it('the employee who asked cancels it while it waits, then may ask again', async () => {
      const s = await newStaff('Cancelling Employee');
      const r = await asked(s, { governorate: 'Cairo' });

      const byHr = await act(r.id, 'cancel', hr).expect(403);
      expect(byHr.body.message).toBe('Only the employee who asked for the change can cancel it.');
      const cancelled = await act(r.id, 'cancel', s.session).expect(200);
      expect(cancelled.body).toMatchObject({ id: r.id, status: 'cancelled', decidedBy: { email: s.email }, decidedAt: expect.any(String), decisionNote: null });
      const again = await act(r.id, 'cancel', s.session).expect(409);
      expect(again.body.message).toBe('Only a change request waiting for HR can be cancelled. This one is cancelled.');
      await act(r.id, 'approve', hr).expect(409);

      const next = await asked(s, { governorate: 'Giza' });
      // the one waiting first, then the closed ones
      expect((await profileOf(s.id, s.session)).changeRequests.map((x) => [x.id, x.status])).toEqual([
        [next.id, 'pending'],
        [r.id, 'cancelled'],
      ]);
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'profile_change_request', entityId: r.id }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['create', 'cancel']);
    });

    it('HR approves: the change is made as an HR edit, audited, and the employee must confirm again', async () => {
      const s = await newStaff('Approved Employee');
      await confirm(s).expect(201);
      const r = await asked(s, { mobile: '010 9876 5432', addressAr: '١٢ شارع التحرير' }, 'Moved');

      await act(r.id, 'approve', s.session).expect(403);
      await act(r.id, 'approve', ceo).expect(403);
      const approved = await act(r.id, 'approve', hr, { note: 'Checked against the new lease' }).expect(200);
      expect(approved.body).toMatchObject({
        id: r.id,
        status: 'approved',
        decidedBy: { email: hrEmail },
        decidedAt: expect.any(String),
        decisionNote: 'Checked against the new lease',
        changes: r.changes,
      });

      const profile = await profileOf(s.id, s.session);
      expect(profile).toMatchObject({ mobile: '+201098765432', addressAr: '١٢ شارع التحرير' });
      expect(profile.confirmation).toMatchObject({ upToDate: false, changedFields: ['mobile', 'addressAr'] });
      expect(profile.changeRequests).toMatchObject([{ id: r.id, status: 'approved' }]);

      // audited as HR's edit of the profile, and as the decision
      const hrUser = await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } });
      const edit = await prisma.auditLog.findFirst({ where: { entityType: 'employee', entityId: s.id, action: 'update' }, orderBy: { id: 'desc' } });
      expect(edit).toMatchObject({
        userId: hrUser.id,
        diff: { mobile: { from: '+201012345678', to: '+201098765432' }, addressAr: { from: null, to: '١٢ شارع التحرير' } },
      });
      const decided = await prisma.auditLog.findMany({ where: { entityType: 'profile_change_request', entityId: r.id }, orderBy: { id: 'asc' } });
      expect(decided.map((a) => [a.action, a.userId])).toEqual([
        ['create', expect.any(String)],
        ['approve', hrUser.id],
      ]);
      expect(decided[1].diff).toMatchObject({ status: { from: 'pending', to: 'approved' }, decisionNote: 'Checked against the new lease' });

      const again = await act(r.id, 'approve', hr).expect(409);
      expect(again.body.message).toBe('Only a change request waiting for HR can be approved. This one is approved.');

      // an Admin approves too; confirming again makes it up to date
      const next = await asked(s, { maritalStatus: 'married' });
      await act(next.id, 'approve', admin).expect(200);
      expect((await profileOf(s.id)).maritalStatus).toBe('married');
      await confirm(s).expect(201);
      expect((await profileOf(s.id, s.session)).confirmation).toMatchObject({ upToDate: true, changedFields: [] });
    });

    it('an approval the edit refuses (the insurance number taken meanwhile) keeps waiting; rejecting needs a reason', async () => {
      const s = await newStaff('Refused Employee');
      const wanted = String(Date.now()).slice(-9);
      const r = await asked(s, { insuranceNo: wanted });
      // someone else gets that insurance number before HR decides
      const other = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `Other ${RUN}`, fullNameAr: 'موظف', insuranceNo: wanted }).expect(201);

      const refused = await act(r.id, 'approve', hr).expect(409);
      expect(refused.body.message).toBe(`The social insurance number ${wanted} already belongs to ${other.body.employeeCode}.`);
      const still = (await profileOf(s.id, s.session)).changeRequests[0];
      expect(still).toMatchObject({ id: r.id, status: 'pending', decidedBy: null });
      expect((await profileOf(s.id)).insuranceNo).toBeNull();

      const noReason = await act(r.id, 'reject', hr).expect(400);
      expect(noReason.body.message).toBe('Say why the change is rejected.');
      await act(r.id, 'reject', hr, { note: '   ' }).expect(400);
      await act(r.id, 'reject', s.session, { note: 'No' }).expect(403);
      const rejected = await act(r.id, 'reject', hr, { note: 'That number belongs to someone else.' }).expect(200);
      expect(rejected.body).toMatchObject({ status: 'rejected', decidedBy: { email: hrEmail }, decisionNote: 'That number belongs to someone else.' });
      expect((await profileOf(s.id)).insuranceNo).toBeNull();
      const again = await act(r.id, 'reject', admin, { note: 'Again' }).expect(409);
      expect(again.body.message).toBe('Only a change request waiting for HR can be rejected. This one is rejected.');
    });

    it('lists requests for HR and Admin, newest first, waiting ones unless a status is chosen', async () => {
      const a = await newStaff('Listed First');
      const b = await newStaff('Listed Second');
      const first = await asked(a, { nationality: 'Egyptian' });
      const second = await asked(b, { nationality: 'Egyptian' });

      const waiting = (await api().get('/api/change-requests').set('Cookie', hr).expect(200)).body as ChangeRequest[];
      expect(waiting.every((x) => x.status === 'pending')).toBe(true);
      const ids = waiting.map((x) => x.id);
      expect(ids.indexOf(second.id)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
      expect(waiting.find((x) => x.id === first.id)).toMatchObject({ employee: { id: a.id, employeeCode: a.employeeCode }, requestedBy: { email: a.email } });

      await act(first.id, 'approve', admin).expect(200);
      const approved = (await api().get('/api/change-requests?status=approved').set('Cookie', admin).expect(200)).body as ChangeRequest[];
      expect(approved.every((x) => x.status === 'approved')).toBe(true);
      expect(approved.some((x) => x.id === first.id)).toBe(true);
      expect(((await api().get('/api/change-requests?status=pending').set('Cookie', hr).expect(200)).body as ChangeRequest[]).some((x) => x.id === first.id)).toBe(false);

      await api().get('/api/change-requests').set('Cookie', a.session).expect(403);
      await api().get('/api/change-requests').set('Cookie', ceo).expect(403);
      await api().get('/api/change-requests?status=sometime').set('Cookie', hr).expect(400);
    });

    it('lists every request whatever its status with ?status=all, newest first, for HR and Admin only (the Details Changes page)', async () => {
      const a = await newStaff('All Approved');
      const b = await newStaff('All Rejected');
      const c = await newStaff('All Cancelled');
      const d = await newStaff('All Waiting');
      const approved = await asked(a, { nationality: 'Egyptian' });
      const rejected = await asked(b, { nationality: 'Egyptian' });
      const cancelled = await asked(c, { nationality: 'Egyptian' });
      const waiting = await asked(d, { nationality: 'Egyptian' }, 'My nationality is missing.');
      await act(approved.id, 'approve', hr, { note: 'Checked against the passport.' }).expect(200);
      await act(rejected.id, 'reject', admin, { note: 'Send a copy of the passport first.' }).expect(200);
      await act(cancelled.id, 'cancel', c.session).expect(200);

      for (const session of [hr, admin]) {
        const all = (await api().get('/api/change-requests?status=all').set('Cookie', session).expect(200)).body as ChangeRequest[];
        const ours = all.filter((x) => [approved.id, rejected.id, cancelled.id, waiting.id].includes(x.id));
        // newest first, each with its status and its decision: who, when and why
        expect(ours.map((x) => [x.id, x.status])).toEqual([
          [waiting.id, 'pending'],
          [cancelled.id, 'cancelled'],
          [rejected.id, 'rejected'],
          [approved.id, 'approved'],
        ]);
        expect(ours[0]).toMatchObject({ employee: { id: d.id, employeeCode: d.employeeCode }, note: 'My nationality is missing.', decidedBy: null, decidedAt: null, decisionNote: null });
        expect(ours[1]).toMatchObject({ decidedBy: { email: c.email }, decisionNote: null });
        expect(ours[2]).toMatchObject({ decidedBy: { email: adminEmail }, decisionNote: 'Send a copy of the passport first.' });
        expect(ours[3]).toMatchObject({ decidedBy: { email: hrEmail }, decisionNote: 'Checked against the passport.', changes: [{ field: 'nationality', to: 'Egyptian' }] });
        expect(ours.every((x) => x.decidedAt === null || Date.parse(x.decidedAt) >= Date.parse(x.requestedAt))).toBe(true);
        const times = all.map((x) => Date.parse(x.requestedAt));
        expect(times).toEqual([...times].sort((x, y) => y - x));
        // every status is in it
        expect(new Set(all.map((x) => x.status))).toEqual(new Set(['pending', 'approved', 'rejected', 'cancelled']));
      }
      // a status still lists that status alone; none, the waiting ones
      const onlyRejected = (await api().get('/api/change-requests?status=rejected').set('Cookie', hr).expect(200)).body as ChangeRequest[];
      expect(onlyRejected.every((x) => x.status === 'rejected')).toBe(true);
      expect(onlyRejected.some((x) => x.id === rejected.id)).toBe(true);
      const cancelledOnes = (await api().get('/api/change-requests?status=cancelled').set('Cookie', admin).expect(200)).body as ChangeRequest[];
      expect(cancelledOnes.map((x) => x.id)).toContain(cancelled.id);
      expect(cancelledOnes.every((x) => x.status === 'cancelled')).toBe(true);
      expect(((await api().get('/api/change-requests').set('Cookie', hr).expect(200)).body as ChangeRequest[]).every((x) => x.status === 'pending')).toBe(true);

      // not for the employee, the CEO or Finance
      for (const session of [d.session, ceo, finance]) await api().get('/api/change-requests?status=all').set('Cookie', session).expect(403);
      const unknown = await api().get('/api/change-requests?status=everything').set('Cookie', hr).expect(400);
      expect(unknown.body.message).toEqual(['Choose a status: pending, approved, rejected, cancelled or all.']);
    });
  });
});
