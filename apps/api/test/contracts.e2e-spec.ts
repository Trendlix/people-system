import type { INestApplication } from '@nestjs/common';
import { ENDING_RULE_DEFAULTS, ENDING_RULES } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, addMonths, shownDate, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Contracts and how an employment ends (owner's decisions, 15 October 2026, checked against Labour Law 14/2025).
// Dates that do not depend on today are fixed; those that do (completing an ending, the alert lists, probation still
// running) are counted from today in Cairo. 15 October 2026 is a Thursday.

const RUN = Date.now().toString(36).toLowerCase();
const PROBATION_CAP = "Probation can't be longer than 3 months (Labour Law Art. 90).";
const LEGAL_NOTICE = "The law requires at least 3 months' notice for this (Art. 156); it can be longer, not shorter.";
const CERTIFIED = { certifiedOffice: 'Nasr City labour office', certifiedSerial: 'R-2026-118', certifiedOn: '2026-09-30' };

/** A contract version as the API sends it. */
interface Contract {
  id: string;
  number: string;
  version: number;
  status: string;
  startDate: string;
  endDate: string | null;
  probationMonths: number;
  probationEnd: string | null;
  grossSalary: number | null;
  nonRenewalNoticeBy: string | null;
  [key: string]: unknown;
}

interface Ending {
  id: string;
  status: string;
  lastWorkingDay: string;
  endReason: string;
  [key: string]: unknown;
}

interface Employment {
  id: string;
  status: string;
  probationEnd: string | null;
  endDate: string | null;
  endReason: string | null;
  contract: Contract | null;
  ending: Ending | null;
  [key: string]: unknown;
}

interface Profile {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  employment: Employment | null;
  employments: Employment[];
}

/** Someone hired: the employee and their current employment. */
interface Hire {
  id: string;
  employmentId: string;
  employeeCode: string;
  fullNameEn: string;
}

describe('Contracts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hrEmail: string;
  let ceoEmail: string;
  let hr: string;
  let ceo: string;
  let finance: string;
  let admin: string;
  let superAdmin: string; // the only role that deletes (owner's decision, 15 October 2026)
  let shiftA: string;
  let teamId: string;
  let jobTitleId: string;
  let gradeG4: string;
  let emailDomainBefore: string | null;
  const today = todayInCairo();
  const api = () => request(app.getHttpServer());

  async function addEmployee(name: string, profile: Record<string, unknown> = {}) {
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', ...profile }).expect(201);
    return res.body as Profile;
  }

  async function hire(employeeId: string, employment: Record<string, unknown> = {}): Promise<Hire> {
    const res = await api()
      .post(`/api/employees/${employeeId}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: '2026-01-15', ...employment })
      .expect(201);
    const p = res.body as Profile;
    return { id: p.id, employmentId: p.employment!.id, employeeCode: p.employeeCode, fullNameEn: p.fullNameEn };
  }

  /** A new person, hired (from 15 January 2026 unless given). */
  async function newHire(name: string, employment: Record<string, unknown> = {}, profile: Record<string, unknown> = {}) {
    return hire((await addEmployee(name, profile)).id, employment);
  }

  const contractsOf = (e: Hire, session = hr) => api().get(`/api/employees/${e.id}/employments/${e.employmentId}/contracts`).set('Cookie', session);
  const postContract = (e: Hire, body: object, session = hr) =>
    api().post(`/api/employees/${e.id}/employments/${e.employmentId}/contracts`).set('Cookie', session).send(body);
  const patchContract = (id: string, body: object, session = hr) => api().patch(`/api/contracts/${id}`).set('Cookie', session).send(body);
  const signContract = (id: string, signedOn: string, session = hr) => api().post(`/api/contracts/${id}/sign`).set('Cookie', session).send({ signedOn });

  async function addContract(e: Hire, body: object = {}): Promise<Contract> {
    return (await postContract(e, { grossSalary: 12000, ...body }).expect(201)).body as Contract;
  }

  /** A contract added and signed on its start date. */
  async function signedContract(e: Hire, body: object = {}): Promise<Contract> {
    const draft = await addContract(e, body);
    return (await signContract(draft.id, draft.startDate <= today ? draft.startDate : today).expect(200)).body as Contract;
  }

  const postEnding = (e: Hire, body: object, session = hr) =>
    api().post(`/api/employees/${e.id}/employments/${e.employmentId}/endings`).set('Cookie', session).send(body);
  const act = (id: string, step: 'approve' | 'reject' | 'withdraw' | 'complete', session: string, body: object = {}) =>
    api().post(`/api/endings/${id}/${step}`).set('Cookie', session).send(body);

  async function addEnding(e: Hire, body: object): Promise<Ending> {
    return (await postEnding(e, body).expect(201)).body as Ending;
  }

  async function profileOf(id: string, session = hr): Promise<Profile> {
    return (await api().get(`/api/employees/${id}`).set('Cookie', session).expect(200)).body as Profile;
  }

  /** Hired 20 days ago with a signed first contract: on probation for 3 months from the join date. */
  async function onProbation(name: string, employment: Record<string, unknown> = {}) {
    const e = await newHire(name, { joinDate: addDays(today, -20), ...employment });
    const contract = await signedContract(e);
    return { ...e, contract };
  }

  const patchRule = (key: string, body: object, session = hr) => api().patch(`/api/ending-rules/${key}`).set('Cookie', session).send(body);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hrEmail = await createUser(prisma, ['hr']);
    ceoEmail = await createUser(prisma, ['ceo']);
    hr = await signIn(app, hrEmail);
    ceo = await signIn(app, ceoEmail);
    finance = await signIn(app, await createUser(prisma, ['finance']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));

    const shifts = await api().get('/api/shifts').set('Cookie', hr).expect(200);
    shiftA = (shifts.body as { id: string; code: string }[]).find((s) => s.code === 'A')!.id;
    const dept = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Sales ${RUN}` }).expect(201);
    const team = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Accounts', parentId: dept.body.id }).expect(201);
    teamId = team.body.id;
    const title = await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId: teamId, titleEn: 'Account Manager', titleAr: 'مدير حسابات' }).expect(201);
    jobTitleId = title.body.id;
    const grades = await api().get('/api/grades').set('Cookie', hr).expect(200);
    gradeG4 = (grades.body as { id: string; code: string }[]).find((g) => g.code === 'G4')!.id;
    // sign-in accounts here are @test.local: no company email domain while these tests run
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
  });

  afterAll(async () => {
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('settings', () => {
    it('anyone signed in reads the defaults; HR and Admin change them; probation is capped at 3 months', async () => {
      const staff = await signIn(app, await createUser(prisma, ['employee']));
      expect((await api().get('/api/contract-settings').set('Cookie', staff).expect(200)).body).toEqual({ probationMonths: 3, durationMonths: 12 });

      await api().patch('/api/contract-settings').set('Cookie', finance).send({ durationMonths: 24 }).expect(403);
      const changed = await api().patch('/api/contract-settings').set('Cookie', admin).send({ durationMonths: 24 }).expect(200);
      expect(changed.body).toEqual({ probationMonths: 3, durationMonths: 24 });
      const less = await api().patch('/api/contract-settings').set('Cookie', hr).send({ probationMonths: 2, durationMonths: 12 }).expect(200);
      expect(less.body).toEqual({ probationMonths: 2, durationMonths: 12 });

      const over = await api().patch('/api/contract-settings').set('Cookie', hr).send({ probationMonths: 4 }).expect(400);
      expect(over.body.message).toEqual([PROBATION_CAP]);
      await api().patch('/api/contract-settings').set('Cookie', hr).send({ durationMonths: 0 }).expect(400);
      await api().patch('/api/contract-settings').set('Cookie', hr).send({ durationMonths: 61 }).expect(400);
      await api().patch('/api/contract-settings').set('Cookie', hr).send({ probationMonths: 3 }).expect(200);
      expect((await api().get('/api/contract-settings').set('Cookie', hr).expect(200)).body).toEqual({ probationMonths: 3, durationMonths: 12 });

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'contract_settings' }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.diff)).toEqual([
        { durationMonths: { from: 12, to: 24 } },
        { probationMonths: { from: 3, to: 2 }, durationMonths: { from: 24, to: 12 } },
        { probationMonths: { from: 2, to: 3 } },
      ]);
    });
  });

  describe('ending rules', () => {
    it('lists the ways an employment can end, in order, as seeded', async () => {
      const res = await api().get('/api/ending-rules').set('Cookie', finance).expect(200);
      expect(res.body).toEqual(ENDING_RULES.map((key) => ({ key, ...ENDING_RULE_DEFAULTS[key], active: true })));
      expect(res.body[0]).toEqual({
        key: 'probation',
        label: 'Ending during probation',
        initiator: 'either',
        noticeAmount: 2,
        noticeUnit: 'weeks',
        payInLieu: false,
        endReason: 'terminated',
        source: 'Contract clause 4',
        active: true,
      });
    });

    it('HR and Admin tune a rule, with an audit entry; others may not', async () => {
      await patchRule('misconduct', { label: 'Gross misconduct' }, finance).expect(403);
      const tuned = await patchRule('misconduct', { label: '  Gross misconduct ', noticeAmount: 1, noticeUnit: 'days', active: false }).expect(200);
      expect(tuned.body).toMatchObject({ key: 'misconduct', label: 'Gross misconduct', noticeAmount: 1, noticeUnit: 'days', active: false, endReason: 'terminated' });
      const back = await patchRule('misconduct', { label: ENDING_RULE_DEFAULTS.misconduct.label, noticeAmount: 0, active: true }, admin).expect(200);
      expect(back.body).toMatchObject({ label: ENDING_RULE_DEFAULTS.misconduct.label, noticeAmount: 0, active: true });

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'ending_rule' }, orderBy: { id: 'asc' } });
      expect(audit[0].diff).toEqual({
        key: 'misconduct',
        label: { from: ENDING_RULE_DEFAULTS.misconduct.label, to: 'Gross misconduct' },
        noticeAmount: { from: 0, to: 1 },
        active: { from: true, to: false },
      });

      await patchRule('nonsense', { noticeAmount: 1 }).expect(404);
      await patchRule('misconduct', { noticeAmount: 366 }).expect(400);
      await patchRule('misconduct', { noticeUnit: 'fortnights' }).expect(400);
      await patchRule('misconduct', { initiator: 'employee' }).expect(400); // who starts it stays as seeded
    });

    it('keeps resignation and company notice at 3 months or more (3 months ≈ 90 days ≈ 13 weeks ≈ 65 working days)', async () => {
      for (const key of ['resignation', 'company_notice']) {
        for (const short of [
          { noticeAmount: 2 },
          { noticeAmount: 89, noticeUnit: 'days' },
          { noticeAmount: 12, noticeUnit: 'weeks' },
          { noticeAmount: 64, noticeUnit: 'working_days' },
        ]) {
          const res = await patchRule(key, short).expect(400);
          expect(res.body.message).toBe(LEGAL_NOTICE);
        }
      }
      // longer is fine, and so is the same in other units
      await patchRule('resignation', { noticeAmount: 4 }).expect(200);
      await patchRule('company_notice', { noticeAmount: 13, noticeUnit: 'weeks' }).expect(200);
      await patchRule('company_notice', { noticeAmount: 65, noticeUnit: 'working_days' }).expect(200);
      await patchRule('resignation', { noticeAmount: 3 }).expect(200);
      await patchRule('company_notice', { noticeAmount: 3, noticeUnit: 'months' }).expect(200);
      // other rules can have any notice
      await patchRule('probation', { noticeAmount: 1, noticeUnit: 'weeks' }).expect(200);
      await patchRule('probation', { noticeAmount: 2 }).expect(200);
      const rules = (await api().get('/api/ending-rules').set('Cookie', hr).expect(200)).body;
      expect(rules).toEqual(ENDING_RULES.map((key) => ({ key, ...ENDING_RULE_DEFAULTS[key], active: true })));
    });
  });

  describe('contracts', () => {
    it('version 1: from the join date for 12 months, with 3 months of probation; the insured salary is the gross', async () => {
      const e = await newHire('First Contract');
      const c = await addContract(e, { grossSalary: 12000 });
      expect(c).toEqual({
        id: expect.any(String),
        number: expect.stringMatching(/^CON-2026-\d{4}$/),
        version: 1,
        form: 'fixed',
        startDate: '2026-01-15',
        endDate: '2027-01-14',
        durationMonths: 12,
        probationMonths: 3,
        probationEnd: '2026-04-14',
        grossSalary: 12000,
        basicPercent: 80,
        basicSalary: 9600,
        variableSalary: 2400,
        netSalary: null,
        insuredSalary: 12000,
        jobTitleEn: null,
        jobTitleAr: null,
        gradeCode: null,
        departmentName: null,
        shiftCode: null,
        status: 'draft',
        signedOn: null,
        insuranceFiledOn: null,
        labourOfficeFiledOn: null,
        note: null,
        nonRenewalNoticeBy: null, // a draft
        salaryHidden: false,
      });
      expect((await contractsOf(e).expect(200)).body).toEqual([c]);

      // the salary is restricted: the audit log only says it was set
      const [audit] = await prisma.auditLog.findMany({ where: { entityType: 'contract', entityId: c.id } });
      expect(audit.action).toBe('create');
      expect(audit.diff).toMatchObject({ employmentId: e.employmentId, startDate: '2026-01-15', grossSalary: 'changed', insuredSalary: 'changed', probationMonths: 3 });
    });

    it('caps the insured salary at the start year’s maximum insurable wage; the basic share and net are HR’s', async () => {
      const e = await newHire('High Earner');
      const capped = await addContract(e, { grossSalary: 25000, basicPercent: 60, netSalary: 19500.5 });
      expect(capped).toMatchObject({ grossSalary: 25000, insuredSalary: 16700, basicSalary: 15000, variableSalary: 10000, netSalary: 19500.5 });
      await api().delete(`/api/contracts/${capped.id}`).set('Cookie', superAdmin).expect(204);

      const earlier = await newHire('Hired In 2025', { joinDate: '2025-03-01' });
      expect(await addContract(earlier, { grossSalary: 20000 })).toMatchObject({ startDate: '2025-03-01', insuredSalary: 14500 });
      const uncapped = await newHire('Uncapped');
      expect(await addContract(uncapped, { grossSalary: 16700 })).toMatchObject({ insuredSalary: 16700 });

      const more = await postContract(e, { grossSalary: 10000, netSalary: 10001 }).expect(400);
      expect(more.body.message).toBe("The net salary can't be more than the gross salary.");
      await postContract(e, { grossSalary: 0 }).expect(400);
      await postContract(e, {}).expect(400);
      await postContract(e, { grossSalary: 1000.555 }).expect(400);
    });

    it('hides the salary from a manager and from the employee themself; HR, Finance and the CEO see it', async () => {
      const managerEmail = await createUser(prisma, ['manager', 'employee']);
      const staffEmail = await createUser(prisma, ['employee']);
      const manager = await newHire('Contract Manager', {}, { workEmail: managerEmail });
      const report = await newHire('Contract Report', { managerId: manager.id }, { workEmail: staffEmail });
      const outsider = await newHire('Contract Outsider');
      const managerSession = await signIn(app, managerEmail);
      const staffSession = await signIn(app, staffEmail);
      const c = await signedContract(report, { grossSalary: 15000, netSalary: 12000 });

      const hidden = { grossSalary: null, basicSalary: null, variableSalary: null, netSalary: null, insuredSalary: null, salaryHidden: true };
      for (const session of [managerSession, staffSession]) {
        const [seen] = (await contractsOf(report, session).expect(200)).body as Contract[];
        expect(seen).toMatchObject({ id: c.id, number: c.number, basicPercent: 80, startDate: '2026-01-15', ...hidden });
        expect((await profileOf(report.id, session)).employment!.contract).toMatchObject({ id: c.id, ...hidden });
      }
      for (const session of [hr, finance, ceo]) {
        const [seen] = (await contractsOf(report, session).expect(200)).body as Contract[];
        expect(seen).toMatchObject({ grossSalary: 15000, netSalary: 12000, insuredSalary: 15000, salaryHidden: false });
      }
      await contractsOf(outsider, managerSession).expect(404);
      await postContract(report, { grossSalary: 1 }, managerSession).expect(403);
      await postContract(report, { grossSalary: 1 }, finance).expect(403);
    });

    it('one draft at a time; a draft changes freely and can be deleted, a signed one keeps its terms', async () => {
      const e = await newHire('One Draft');
      const draft = await addContract(e);
      const twice = await postContract(e, { grossSalary: 13000 }).expect(409);
      expect(twice.body.message).toBe(`Version 1 (${draft.number}) is still a draft. Sign or delete it before adding another.`);

      // the end, probation end and insured salary follow the terms
      const changed = await patchContract(draft.id, { durationMonths: 6, grossSalary: 18000, startDate: '2026-02-01', probationMonths: 2, note: 'Offer accepted' }).expect(200);
      expect(changed.body).toMatchObject({ number: draft.number, startDate: '2026-02-01', durationMonths: 6, endDate: '2026-07-31', probationMonths: 2, probationEnd: '2026-03-31', grossSalary: 18000, insuredSalary: 16700, note: 'Offer accepted' });
      const open = await patchContract(draft.id, { form: 'open_ended' }).expect(200);
      expect(open.body).toMatchObject({ form: 'open_ended', endDate: null, durationMonths: null });
      await patchContract(draft.id, { form: 'fixed' }).expect(200);
      const early = await patchContract(draft.id, { startDate: '2026-01-01' }).expect(400);
      expect(early.body.message).toBe("The contract can't start before the join date, 15/01/2026.");
      const long = await patchContract(draft.id, { durationMonths: 2, probationMonths: 3 }).expect(400);
      expect(long.body.message).toBe('The probation would end after the contract, on 30/04/2026. Shorten the probation or lengthen the contract.');
      const notYet = await patchContract(draft.id, { insuranceFiledOn: '2026-02-05' }).expect(400);
      expect(notYet.body.message).toBe('Sign the contract first: the signing and filing dates are recorded on a signed contract.');

      // a draft moved to another year is numbered in that year
      const moved = await patchContract(draft.id, { startDate: '2027-01-01' }).expect(200);
      expect(moved.body.number).toMatch(/^CON-2027-\d{4}$/);

      // only a Super Admin deletes a draft: HR, who wrote it, and an Admin get no delete (owner's decision, 15 October 2026)
      for (const who of [hr, admin]) {
        const refused = await api().delete(`/api/contracts/${draft.id}`).set('Cookie', who).expect(403);
        expect(refused.body.message).toBe('Only a Super Admin can delete records.');
      }
      await api().delete(`/api/contracts/${draft.id}`).set('Cookie', superAdmin).expect(204);
      expect((await contractsOf(e).expect(200)).body).toEqual([]);

      const again = await addContract(e);
      expect(again.version).toBe(1);
      const signed = await signContract(again.id, '2026-01-15').expect(200);
      expect(signed.body).toMatchObject({ status: 'active', signedOn: '2026-01-15' });
      await signContract(again.id, '2026-01-15').expect(409);

      const terms = await patchContract(again.id, { grossSalary: 20000 }).expect(400);
      expect(terms.body.message).toBe('This contract is signed: only the signing and filing dates and the note can be changed. For other changes, add a new version.');
      const filed = await patchContract(again.id, { insuranceFiledOn: '2026-01-20', labourOfficeFiledOn: '2026-01-25', note: 'Form 1 sent' }).expect(200);
      expect(filed.body).toMatchObject({ insuranceFiledOn: '2026-01-20', labourOfficeFiledOn: '2026-01-25', note: 'Form 1 sent', grossSalary: 12000 });
      await patchContract(again.id, { signedOn: addDays(today, 1) }).expect(400);
      await patchContract(again.id, { signedOn: null }).expect(400);
      const gone = await api().delete(`/api/contracts/${again.id}`).set('Cookie', superAdmin).expect(409);
      expect(gone.body.message).toBe(`${again.number} is signed: only a draft can be deleted, and a signed contract stays on record.`);
      await signContract((await addContract(await newHire('Future Signing'))).id, addDays(today, 1)).expect(400);
    });

    it('signing version 1 sets the employment’s probation end and status, and copies the job title, grade, team and shift', async () => {
      // probation still running: on probation until the contract's probation end
      const join = addDays(today, -30);
      const e = await newHire('Signed Up', { joinDate: join, jobTitleId, gradeId: gradeG4, shiftId: shiftA });
      const c = await signedContract(e);
      const probationEnd = addDays(addMonths(join, 3), -1);
      expect(c).toMatchObject({
        status: 'active',
        signedOn: join,
        probationEnd,
        jobTitleEn: 'Account Manager',
        jobTitleAr: 'مدير حسابات',
        gradeCode: 'G4',
        departmentName: `Sales ${RUN} › Accounts`,
        shiftCode: 'A',
      });
      const employment = (await profileOf(e.id)).employment!;
      expect(employment).toMatchObject({ status: 'probation', probationEnd, contract: { id: c.id, status: 'active', jobTitleEn: 'Account Manager' }, ending: null });

      // the snapshot keeps what was signed when the employment changes later
      await api().patch(`/api/employees/${e.id}/employments/${e.employmentId}`).set('Cookie', hr).send({ shiftId: null }).expect(200);
      expect(((await contractsOf(e).expect(200)).body as Contract[])[0].shiftCode).toBe('A');

      // a probation already over (hired in January): Active, and the last day for non-renewal notice is 45 working
      // days (Sunday to Thursday) before the end, 14 January 2027
      const past = await newHire('Past Probation');
      const pc = await signedContract(past);
      expect(pc).toMatchObject({ probationEnd: '2026-04-14', endDate: '2027-01-14', nonRenewalNoticeBy: '2026-11-14' });
      expect((await profileOf(past.id)).employment).toMatchObject({ status: 'active', probationEnd: '2026-04-14' });

      // no probation: Active, no probation end
      const none = await newHire('No Probation');
      const nc = await signedContract(none, { probationMonths: 0 });
      expect(nc.probationEnd).toBeNull();
      expect((await profileOf(none.id)).employment).toMatchObject({ status: 'active', probationEnd: null });

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'employment', entityId: e.employmentId, action: 'update' }, orderBy: { id: 'asc' } });
      expect(audit[0].diff).toMatchObject({ contract: c.number, probationEnd: { from: addMonths(join, 3), to: probationEnd } });
    });

    it('a renewal starts the day after the version before ends, with no probation, and supersedes it when signed', async () => {
      const e = await newHire('Renewed');
      const v1 = await signedContract(e);
      const probation = await postContract(e, { grossSalary: 14000, probationMonths: 1 }).expect(400);
      expect(probation.body.message).toBe('A renewal has no probation: the law allows it once per employer (Art. 90).');
      const early = await postContract(e, { grossSalary: 14000, startDate: '2026-01-15' }).expect(400);
      expect(early.body.message).toBe('Version 2 must start after version 1 started, on 15/01/2026.');

      const v2 = await addContract(e, { grossSalary: 14000 });
      expect(v2).toMatchObject({ version: 2, number: expect.stringMatching(/^CON-2027-\d{4}$/), startDate: '2027-01-15', endDate: '2028-01-14', probationMonths: 0, probationEnd: null, status: 'draft' });
      const signed = (await signContract(v2.id, today).expect(200)).body as Contract;
      expect(signed.status).toBe('active');

      const versions = (await contractsOf(e).expect(200)).body as Contract[];
      expect(versions.map((v) => [v.version, v.status])).toEqual([
        [2, 'active'],
        [1, 'superseded'],
      ]);
      expect(versions[1].id).toBe(v1.id);
      // the employment keeps the first contract's probation, and shows the renewal
      expect((await profileOf(e.id)).employment).toMatchObject({ probationEnd: '2026-04-14', contract: { id: v2.id, version: 2 } });
    });

    it('a rehire gets no probation: the law allows it once per employer', async () => {
      const first = await newHire('Rehired', { joinDate: '2025-01-01' });
      await api().post(`/api/employees/${first.id}/employments/${first.employmentId}/end`).set('Cookie', hr).send({ endDate: '2025-12-31', endReason: 'resigned' }).expect(200);
      const ended = await postContract(first, { grossSalary: 9000 }).expect(409);
      expect(ended.body.message).toBe('This employment ended on 31/12/2025: contracts are only added and signed for a current employment.');

      const again = await hire(first.id, { joinDate: '2026-03-01' });
      const c = await addContract(again, { grossSalary: 9000 });
      expect(c).toMatchObject({ startDate: '2026-03-01', probationMonths: 0, probationEnd: null });
      await api().delete(`/api/contracts/${c.id}`).set('Cookie', superAdmin).expect(204);

      const refused = await postContract(again, { grossSalary: 9000, probationMonths: 3 }).expect(400);
      expect(refused.body.message).toBe(`Rehired ${RUN} already had a probation with the company; the law allows it once (Art. 90).`);
      const over = await postContract(again, { grossSalary: 9000, probationMonths: 4 }).expect(400);
      expect(over.body.message).toEqual([PROBATION_CAP]);
    });

    it('confirms a probation: Active, with an audit entry; refused when not on probation', async () => {
      const e = await onProbation('Confirmed');
      const confirm = () => api().post(`/api/employees/${e.id}/employments/${e.employmentId}/confirm-probation`).set('Cookie', hr);
      await api().post(`/api/employees/${e.id}/employments/${e.employmentId}/confirm-probation`).set('Cookie', finance).expect(403);
      const res = await confirm().expect(200);
      expect((res.body as Profile).employment).toMatchObject({ status: 'active', probationEnd: e.contract.probationEnd });
      const again = await confirm().expect(409);
      expect(again.body.message).toBe(`Confirmed ${RUN} is not on probation, so there is nothing to confirm.`);
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'employment', entityId: e.employmentId, action: 'confirm_probation' } });
      expect(audit[0].diff).toMatchObject({ status: { from: 'probation', to: 'active' } });
    });
  });

  describe('endings', () => {
    it('during probation: 2 weeks’ notice, a resignation when the employee ends it and a termination when the company does', async () => {
      const a = await onProbation('Probation Leaver');
      const who = await postEnding(a, { ruleKey: 'probation', noticeGivenOn: today }).expect(400);
      expect(who.body.message).toBe('Choose who ends it: the employee or the company.');
      const byEmployee = await addEnding(a, { ruleKey: 'probation', initiator: 'employee', noticeGivenOn: today, reason: 'Moving abroad' });
      expect(byEmployee).toEqual({
        id: expect.any(String),
        ruleKey: 'probation',
        ruleLabel: 'Ending during probation',
        initiator: 'employee',
        noticeGivenOn: today,
        payInLieu: false,
        lastWorkingDay: addDays(today, 14),
        certifiedOffice: null,
        certifiedSerial: null,
        certifiedOn: null,
        decisionDueOn: null,
        reason: 'Moving abroad',
        note: null,
        status: 'pending_ceo',
        hrApprovedBy: { email: hrEmail },
        hrApprovedAt: expect.any(String),
        ceoDecidedBy: null,
        ceoDecidedAt: null,
        ceoNote: null,
        completedAt: null,
        endReason: 'resigned',
        deadlines: null,
      });
      const twice = await postEnding(a, { ruleKey: 'probation', initiator: 'company', noticeGivenOn: today }).expect(409);
      expect(twice.body.message).toBe('An ending of this employment is already waiting for the CEO. Withdraw it before recording another.');
      // the profile shows it, the employment unchanged until the CEO approves
      expect((await profileOf(a.id)).employment).toMatchObject({ status: 'probation', ending: { id: byEmployee.id, status: 'pending_ceo' } });

      const b = await onProbation('Probation Let Go');
      expect(await addEnding(b, { ruleKey: 'probation', initiator: 'company', noticeGivenOn: today })).toMatchObject({ initiator: 'company', endReason: 'terminated' });

      // not on probation any more, or notice after it ended
      const active = await newHire('Past Probation Leaver');
      await signedContract(active);
      const notOn = await postEnding(active, { ruleKey: 'probation', initiator: 'company', noticeGivenOn: today }).expect(400);
      expect(notOn.body.message).toBe(`Past Probation Leaver ${RUN} is not on probation. Choose another way to end the employment.`);
      const late = await newHire('Late Probation Notice'); // still Probation, its probation end 15 April 2026 (no contract)
      const after = await postEnding(late, { ruleKey: 'probation', initiator: 'company', noticeGivenOn: '2026-04-16' }).expect(400);
      expect(after.body.message).toBe('The probation ended on 15/04/2026: notice during probation must be given by then. Choose another way to end the employment.');
    });

    it('resignation: certified at the labour office, 3 months’ notice, the company’s decision due within 10 days', async () => {
      const e = await newHire('Resigning');
      const uncertified = await postEnding(e, { ruleKey: 'resignation', noticeGivenOn: '2026-10-01', certifiedOffice: 'Nasr City' }).expect(400);
      expect(uncertified.body.message).toBe('A resignation must be certified at the labour office (Decree 187/2025): enter the office, the serial number and the date.');
      const byCompany = await postEnding(e, { ruleKey: 'resignation', initiator: 'company', noticeGivenOn: '2026-10-01', ...CERTIFIED }).expect(400);
      expect(byCompany.body.message).toBe('"Resignation" is started by the employee.');
      const paid = await postEnding(e, { ruleKey: 'resignation', noticeGivenOn: '2026-10-01', payInLieu: true, ...CERTIFIED }).expect(400);
      expect(paid.body.message).toBe('"Resignation" can\'t be paid in lieu of notice.');
      await postEnding(e, { ruleKey: 'resignation', noticeGivenOn: '2026-10-01', ...CERTIFIED, certifiedOn: addDays(today, 1) }).expect(400);
      const early = await postEnding(e, { ruleKey: 'resignation', noticeGivenOn: '2026-01-01', ...CERTIFIED }).expect(400);
      expect(early.body.message).toBe('The notice date must be on or after the join date, 15/01/2026.');

      const ending = await addEnding(e, { ruleKey: 'resignation', noticeGivenOn: '2026-10-01', ...CERTIFIED });
      expect(ending).toMatchObject({
        initiator: 'employee',
        lastWorkingDay: '2027-01-01',
        decisionDueOn: '2026-10-11',
        ...CERTIFIED,
        endReason: 'resigned',
        status: 'pending_ceo',
      });
    });

    it('non-renewal: the last day is the contract’s end; refused after the notice-by date or without a signed fixed term', async () => {
      const e = await newHire('Not Renewed', { shiftId: shiftA }); // contract 15 January 2026 – 14 January 2027
      const c = await signedContract(e);
      expect(c.nonRenewalNoticeBy).toBe('2026-11-14');
      const late = await postEnding(e, { ruleKey: 'non_renewal', noticeGivenOn: '2026-11-15' }).expect(400);
      expect(late.body.message).toBe('The non-renewal notice is due 45 working days before the contract ends, by 14/11/2026.');
      const ending = await addEnding(e, { ruleKey: 'non_renewal', noticeGivenOn: '2026-11-14' });
      expect(ending).toMatchObject({ initiator: 'company', lastWorkingDay: '2027-01-14', endReason: 'contract_ended' });

      const noContract = await newHire('No Contract Yet');
      const refused = await postEnding(noContract, { ruleKey: 'non_renewal', noticeGivenOn: '2026-10-15' }).expect(400);
      expect(refused.body.message).toBe('Only a signed fixed-term contract can end by not being renewed. Sign one first, or choose another way to end the employment.');
      const open = await newHire('Open Ended');
      await signedContract(open, { form: 'open_ended' });
      await postEnding(open, { ruleKey: 'non_renewal', noticeGivenOn: '2026-10-15' }).expect(400);
    });

    it('company notice: 3 months, or paid in lieu with the notice date as the last working day', async () => {
      const e = await newHire('Let Go');
      const worked = await addEnding(e, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01' });
      expect(worked).toMatchObject({ initiator: 'company', payInLieu: false, lastWorkingDay: '2027-01-01', endReason: 'terminated' });
      await act(worked.id, 'withdraw', hr).expect(200);
      const paid = await addEnding(e, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01', payInLieu: true });
      expect(paid).toMatchObject({ payInLieu: true, lastWorkingDay: '2026-10-01' });
    });

    it('counts working days after the notice date by the shift: Sunday to Thursday, the shift’s own week, or Sunday to Thursday without one', async () => {
      await patchRule('mutual_agreement', { noticeAmount: 2, noticeUnit: 'working_days' }).expect(200);
      try {
        const code = `W${RUN.slice(-6).toUpperCase()}`;
        const monFri = await api().post('/api/shifts').set('Cookie', hr).send({ code, startTime: '09:00', endTime: '17:00', workingDays: [1, 2, 3, 4, 5] }).expect(201);
        // notice on Wednesday 14 October 2026
        const body = { ruleKey: 'mutual_agreement', initiator: 'employee', noticeGivenOn: '2026-10-14' };
        const sunThu = await addEnding(await newHire('Shift A Leaver', { shiftId: shiftA }), body);
        expect(sunThu).toMatchObject({ lastWorkingDay: '2026-10-18', endReason: 'mutual_agreement' }); // Thursday 15, Sunday 18
        const weekdays = await addEnding(await newHire('Weekday Leaver', { shiftId: monFri.body.id }), body);
        expect(weekdays.lastWorkingDay).toBe('2026-10-16'); // Thursday 15, Friday 16
        const noShift = await addEnding(await newHire('No Shift Leaver'), body);
        expect(noShift.lastWorkingDay).toBe('2026-10-18');

        // the non-renewal notice-by date follows the shift too: 45 working days Monday to Friday before 14 January 2027
        const c = await signedContract(await newHire('Weekday Contract', { shiftId: monFri.body.id }));
        expect(c.nonRenewalNoticeBy).toBe('2026-11-12');
      } finally {
        await patchRule('mutual_agreement', { noticeAmount: 0, noticeUnit: 'days' }).expect(200);
      }
    });

    it('only the CEO approves or rejects; HR records it, and the queue lists what waits for the CEO', async () => {
      const e = await newHire('Approved Leaver');
      const ending = await addEnding(e, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01', note: 'Restructuring' });
      await act(ending.id, 'approve', hr).expect(403);
      await act(ending.id, 'approve', finance).expect(403);

      const queue = (await api().get('/api/endings?status=pending_ceo').set('Cookie', ceo).expect(200)).body as (Ending & { employee: object; employmentId: string })[];
      expect(queue.find((x) => x.id === ending.id)).toMatchObject({
        status: 'pending_ceo',
        employee: { id: e.id, employeeCode: e.employeeCode, fullNameEn: e.fullNameEn },
        employmentId: e.employmentId,
        ruleLabel: 'Ended by the company with notice',
      });
      expect(queue.every((x) => x.status === 'pending_ceo')).toBe(true);
      await api().get('/api/endings').set('Cookie', hr).expect(200);
      await api().get('/api/endings').set('Cookie', finance).expect(403);
      await api().get('/api/endings?status=sometime').set('Cookie', ceo).expect(400);

      const approved = await act(ending.id, 'approve', ceo, { note: 'Agreed' }).expect(200);
      expect(approved.body).toMatchObject({ status: 'approved', ceoDecidedBy: { email: ceoEmail }, ceoDecidedAt: expect.any(String), ceoNote: 'Agreed' });
      expect((await profileOf(e.id)).employment).toMatchObject({ status: 'notice_period', ending: { id: ending.id, status: 'approved' } });
      const again = await act(ending.id, 'approve', ceo).expect(409);
      expect(again.body.message).toBe('Only an ending waiting for the CEO can be approved. This one is approved.');
      expect((await api().get('/api/endings?status=pending_ceo').set('Cookie', ceo).expect(200)).body.find((x: Ending) => x.id === ending.id)).toBeUndefined();

      const other = await newHire('Rejected Leaver');
      const rejected = await addEnding(other, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01' });
      await act(rejected.id, 'reject', hr, { note: 'No' }).expect(403);
      await act(rejected.id, 'reject', ceo, {}).expect(400);
      await act(rejected.id, 'reject', ceo, { note: '  ' }).expect(400);
      const no = await act(rejected.id, 'reject', ceo, { note: 'We need this role' }).expect(200);
      expect(no.body).toMatchObject({ status: 'rejected', ceoNote: 'We need this role', ceoDecidedBy: { email: ceoEmail } });
      // the employment goes on; the rejected ending stays on the profile, with the CEO's note, until a new one is
      // started (contracts review, 15 October 2026)
      expect((await profileOf(other.id)).employment).toMatchObject({
        status: 'probation',
        ending: { id: rejected.id, status: 'rejected', ceoNote: 'We need this role', ceoDecidedBy: { email: ceoEmail } },
      });
      const next = await addEnding(other, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-02' });
      expect((await profileOf(other.id)).employment).toMatchObject({ ending: { id: next.id, status: 'pending_ceo', ceoNote: null } });

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'employment_ending', entityId: ending.id }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['create', 'approve']);
    });

    it('only HR, Admin and the CEO see how an employment ends: not the employee, their manager or Finance', async () => {
      const managerEmail = await createUser(prisma, ['manager', 'employee']);
      const staffEmail = await createUser(prisma, ['employee']);
      const manager = await newHire('Ending Manager', {}, { workEmail: managerEmail });
      const e = await newHire('Ending Report', { managerId: manager.id }, { workEmail: staffEmail });
      const sessions = [await signIn(app, staffEmail), await signIn(app, managerEmail), finance];

      // a termination waiting for the CEO never reaches the employee before the CEO decides, nor after
      const ending = await addEnding(e, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01', reason: 'Restructuring' });
      for (const session of sessions) expect((await profileOf(e.id, session)).employment).toMatchObject({ id: e.employmentId, ending: null });
      for (const session of [hr, ceo]) expect((await profileOf(e.id, session)).employment).toMatchObject({ ending: { id: ending.id, status: 'pending_ceo' } });
      await act(ending.id, 'reject', ceo, { note: 'Not now' }).expect(200);
      for (const session of sessions) expect((await profileOf(e.id, session)).employment!.ending).toBeNull();
      expect((await profileOf(e.id, ceo)).employment!.ending).toMatchObject({ id: ending.id, status: 'rejected', ceoNote: 'Not now' });

      // an Admin sees it too, on a profile they may see (their own)
      const adminEmail = await createUser(prisma, ['admin', 'employee']);
      const self = await newHire('Ending Admin', {}, { workEmail: adminEmail });
      const own = await addEnding(self, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01' });
      expect((await profileOf(self.id, await signIn(app, adminEmail))).employment!.ending).toMatchObject({ id: own.id, status: 'pending_ceo' });
    });

    it('withdrawing an approved ending puts the employment back on probation while it runs, else Active', async () => {
      const p = await onProbation('Withdrawn On Probation');
      const ending = await addEnding(p, { ruleKey: 'misconduct', noticeGivenOn: today, note: 'Investigation' });
      expect(ending.lastWorkingDay).toBe(today); // no notice
      await act(ending.id, 'approve', ceo).expect(200);
      expect((await profileOf(p.id)).employment!.status).toBe('notice_period');
      await act(ending.id, 'withdraw', ceo).expect(403);
      const withdrawn = await act(ending.id, 'withdraw', hr, { note: 'Cleared' }).expect(200);
      expect(withdrawn.body).toMatchObject({ status: 'withdrawn', note: 'Investigation\nWithdrawn: Cleared' });
      expect((await profileOf(p.id)).employment).toMatchObject({ status: 'probation', ending: { id: ending.id, status: 'withdrawn' } });
      const again = await act(ending.id, 'withdraw', hr).expect(409);
      expect(again.body.message).toBe('Only an ending waiting for the CEO or approved can be withdrawn. This one is withdrawn.');

      const a = await newHire('Withdrawn Active');
      await signedContract(a); // probation over: Active
      const other = await addEnding(a, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01' });
      await act(other.id, 'approve', ceo).expect(200);
      await act(other.id, 'withdraw', hr).expect(200);
      expect((await profileOf(a.id)).employment!.status).toBe('active');

      // withdrawn before the CEO decided: the status never changed
      const pending = await addEnding(a, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01' });
      await act(pending.id, 'withdraw', hr).expect(200);
      expect((await profileOf(a.id)).employment!.status).toBe('active');
    });

    it('completes on or after the last working day: the employment ends for the rule’s reason, and the contract ends', async () => {
      const e = await newHire('Completed Leaver');
      const contract = await signedContract(e);

      // not before the last working day
      const future = await addEnding(e, { ruleKey: 'resignation', noticeGivenOn: today, ...CERTIFIED, certifiedOn: today });
      await act(future.id, 'approve', ceo).expect(200);
      const early = await act(future.id, 'complete', hr).expect(400);
      expect(early.body.message).toBe(`It can be completed on or after the last working day, ${shownDate(addMonths(today, 3))}.`);
      await act(future.id, 'withdraw', hr).expect(200);

      // paid in lieu, given on 1 September 2026: the last working day has passed
      const ending = await addEnding(e, { ruleKey: 'company_notice', noticeGivenOn: '2026-09-01', payInLieu: true, reason: 'Role closed' });
      const unapproved = await act(ending.id, 'complete', hr).expect(409);
      expect(unapproved.body.message).toBe('Only an approved ending can be completed. This one is waiting for the CEO.');
      await act(ending.id, 'approve', ceo).expect(200);
      await act(ending.id, 'complete', ceo).expect(403);
      const done = await act(ending.id, 'complete', hr).expect(200);
      expect(done.body).toMatchObject({
        status: 'completed',
        completedAt: expect.any(String),
        lastWorkingDay: '2026-09-01',
        endReason: 'terminated',
        deadlines: { finalDuesBy: '2026-09-08', labourOfficeFilingBy: '2026-09-16' },
      });

      const profile = await profileOf(e.id);
      expect(profile.employment).toBeNull();
      expect(profile.employments[0]).toMatchObject({
        id: e.employmentId,
        endDate: '2026-09-01',
        endReason: 'terminated',
        endNote: 'Ended by the company with notice: Role closed',
        status: 'terminated',
        contract: null, // no signed contract left: it ended
        ending: { id: ending.id, status: 'completed' },
      });
      expect(((await contractsOf(e).expect(200)).body as Contract[]).map((c) => [c.id, c.status])).toEqual([[contract.id, 'ended']]);
      await act(ending.id, 'complete', hr).expect(409);
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'employment', entityId: e.employmentId, action: 'end' } });
      expect(audit[0].diff).toMatchObject({ endDate: '2026-09-01', endReason: 'terminated', contract: { number: contract.number, status: { from: 'active', to: 'ended' } } });

      // an ending during probation by the employee: Resigned
      const p = await onProbation('Completed Probation');
      const quit = await addEnding(p, { ruleKey: 'probation', initiator: 'employee', noticeGivenOn: addDays(today, -20) });
      expect(quit.lastWorkingDay).toBe(addDays(today, -6));
      await act(quit.id, 'approve', ceo).expect(200);
      await act(quit.id, 'complete', hr).expect(200);
      expect((await profileOf(p.id)).employments[0]).toMatchObject({ endDate: addDays(today, -6), endReason: 'resigned', status: 'resigned' });
    });
  });

  describe('alerts', () => {
    it('lists signed fixed-term contracts ending soon, with the non-renewal notice day and whether a renewal is drafted', async () => {
      const soon = await newHire('Ending Soon', { joinDate: addMonths(today, -11) }); // ends in a month
      const soonContract = await signedContract(soon);
      const later = await newHire('Ending Later', { joinDate: today }); // ends in a year
      await signedContract(later);
      const expiring = () => api().get('/api/contracts/expiring?within=60').set('Cookie', ceo).expect(200);

      const list = (await expiring()).body as { id: string; endDate: string; renewalDraft: boolean }[];
      expect(list.find((x) => x.id === soonContract.id)).toEqual({
        id: soonContract.id,
        number: soonContract.number,
        employee: { id: soon.id, employeeCode: soon.employeeCode, fullNameEn: soon.fullNameEn },
        employmentId: soon.employmentId,
        endDate: soonContract.endDate,
        nonRenewalNoticeBy: soonContract.nonRenewalNoticeBy,
        renewalDraft: false,
      });
      expect(list.some((x) => x.endDate > addDays(today, 60))).toBe(false);
      expect(list.map((x) => x.endDate)).toEqual(list.map((x) => x.endDate).sort());

      await addContract(soon);
      expect(((await expiring()).body as { id: string; renewalDraft: boolean }[]).find((x) => x.id === soonContract.id)?.renewalDraft).toBe(true);
      const wide = (await api().get('/api/contracts/expiring?within=366').set('Cookie', hr).expect(200)).body as { employmentId: string }[];
      expect(wide.some((x) => x.employmentId === later.employmentId)).toBe(true);
      await api().get('/api/contracts/expiring').set('Cookie', finance).expect(403);
      await api().get('/api/contracts/expiring?within=soon').set('Cookie', hr).expect(400);
    });

    it('lists current employments whose probation ends soon, until confirmed', async () => {
      const soon = await newHire('Probation Soon', { joinDate: addDays(today, -80) });
      const contract = await signedContract(soon);
      const later = await onProbation('Probation Later');
      const ending = () => api().get('/api/employments/probation-ending?within=30').set('Cookie', ceo).expect(200);

      const list = (await ending()).body as { employmentId: string; probationEnd: string }[];
      expect(list.find((x) => x.employmentId === soon.employmentId)).toEqual({
        employee: { id: soon.id, employeeCode: soon.employeeCode, fullNameEn: soon.fullNameEn },
        employmentId: soon.employmentId,
        probationEnd: contract.probationEnd,
      });
      expect(list.some((x) => x.employmentId === later.employmentId)).toBe(false);
      expect(list.map((x) => x.probationEnd)).toEqual(list.map((x) => x.probationEnd).sort());

      await api().post(`/api/employees/${soon.id}/employments/${soon.employmentId}/confirm-probation`).set('Cookie', hr).expect(200);
      expect(((await ending()).body as { employmentId: string }[]).some((x) => x.employmentId === soon.employmentId)).toBe(false);
      await api().get('/api/employments/probation-ending').set('Cookie', hr).expect(200);
      await api().get('/api/employments/probation-ending').set('Cookie', finance).expect(403);
    });
  });
});
