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
const FORM_REFUSED = 'Choose the contract’s length: fixed (fixed-term), open_ended or specific_job.';

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
      // the settings' audit from here on (other test files change the default basic wage before this one runs)
      const since = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
      const staff = await signIn(app, await createUser(prisma, ['employee']));
      expect((await api().get('/api/contract-settings').set('Cookie', staff).expect(200)).body).toEqual({ probationMonths: 3, durationMonths: 12, insuranceBasicDefault: 410, basicPercentDefault: 80 });

      await api().patch('/api/contract-settings').set('Cookie', finance).send({ durationMonths: 24 }).expect(403);
      const changed = await api().patch('/api/contract-settings').set('Cookie', admin).send({ durationMonths: 24 }).expect(200);
      expect(changed.body).toEqual({ probationMonths: 3, durationMonths: 24, insuranceBasicDefault: 410, basicPercentDefault: 80 });
      const less = await api().patch('/api/contract-settings').set('Cookie', hr).send({ probationMonths: 2, durationMonths: 12 }).expect(200);
      expect(less.body).toEqual({ probationMonths: 2, durationMonths: 12, insuranceBasicDefault: 410, basicPercentDefault: 80 });

      const over = await api().patch('/api/contract-settings').set('Cookie', hr).send({ probationMonths: 4 }).expect(400);
      expect(over.body.message).toEqual([PROBATION_CAP]);
      await api().patch('/api/contract-settings').set('Cookie', hr).send({ durationMonths: 0 }).expect(400);
      await api().patch('/api/contract-settings').set('Cookie', hr).send({ durationMonths: 61 }).expect(400);
      await api().patch('/api/contract-settings').set('Cookie', hr).send({ probationMonths: 3 }).expect(200);
      expect((await api().get('/api/contract-settings').set('Cookie', hr).expect(200)).body).toEqual({ probationMonths: 3, durationMonths: 12, insuranceBasicDefault: 410, basicPercentDefault: 80 });

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'contract_settings', id: { gt: since } }, orderBy: { id: 'asc' } });
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
        // by the labour law (owner, 18 October 2026): no job (a specific job's)
        jobToDo: null,
        startDate: '2026-01-15',
        endDate: '2027-01-14',
        durationMonths: 12,
        probationMonths: 3,
        probationEnd: '2026-04-14',
        payBasis: 'monthly',
        hoursPerWeek: null,
        daysPerWeek: null,
        grossSalary: 12000,
        basicPercent: 80,
        basicSalary: 9600,
        variableSalary: 2400,
        netSalary: null,
        insuredSalary: 12000,
        hourlyRate: null,
        allowances: [],
        allowancesTotal: 0,
        totalSalary: 12000,
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
        // neither of the law's warnings (Art. 88(3), Art. 1(7))
        becameOpenEnded: false,
        // not an intern's agreement, nor a conversion of one (19 October 2026)
        convertsTo: null,
        training: null,
        casualTooLong: false,
        salaryHidden: false,
        // a whole contract, not a raise (owner's decisions, 16 October 2026)
        kind: 'contract',
        stage: 'draft',
        raise: null,
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
      // 0 only for someone paid per client account (27 October 2026)
      expect((await postContract(e, { grossSalary: 0 }).expect(400)).body.message).toBe(
        'A salary of 0 is for someone paid per client account only: add a per-account allowance (e.g. Accounts allowance), or enter the salary.',
      );
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

      const hidden = {
        grossSalary: null,
        basicSalary: null,
        variableSalary: null,
        netSalary: null,
        insuredSalary: null,
        hourlyRate: null,
        allowances: null,
        allowancesTotal: null,
        totalSalary: null,
        salaryHidden: true,
      };
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
      // the contract's length (owner, 18 October 2026, after 15 October's fixed term only): an unknown one refused; a
      // draft made open-ended has no duration or end, and back to fixed-term takes the settings' months again
      expect((await patchContract(draft.id, { form: 'temporary' }).expect(400)).body.message).toEqual([FORM_REFUSED]);
      expect((await patchContract(draft.id, { form: 'open_ended' }).expect(200)).body).toMatchObject({ form: 'open_ended', durationMonths: null, endDate: null });
      expect((await patchContract(draft.id, { form: 'fixed', durationMonths: 6 }).expect(200)).body).toMatchObject({ form: 'fixed', endDate: '2026-07-31' });
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

      // a probation already over (hired in January, so Active from the start): it stays Active, and the last day for
      // non-renewal notice is 45 working days (Sunday to Thursday) before the end, 14 January 2027
      const past = await newHire('Past Probation');
      expect((await profileOf(past.id)).employment).toMatchObject({ status: 'active', probationEnd: '2026-04-14' });
      const pc = await signedContract(past);
      expect(pc).toMatchObject({ probationEnd: '2026-04-14', endDate: '2027-01-14', nonRenewalNoticeBy: '2026-11-14' });
      expect((await profileOf(past.id)).employment).toMatchObject({ status: 'active', probationEnd: '2026-04-14' });

      // on probation, and the contract's shorter probation is already over: Active, with the contract's probation end
      const shortJoin = addDays(today, -40);
      const short = await newHire('Short Probation', { joinDate: shortJoin });
      expect((await profileOf(short.id)).employment).toMatchObject({ status: 'probation', probationEnd: addDays(addMonths(shortJoin, 3), -1) });
      const sc = await signedContract(short, { probationMonths: 1 });
      expect(sc.probationEnd).toBe(addDays(addMonths(shortJoin, 1), -1));
      expect((await profileOf(short.id)).employment).toMatchObject({ status: 'active', probationEnd: sc.probationEnd });

      // no probation: Active, no probation end
      const none = await newHire('No Probation');
      const nc = await signedContract(none, { probationMonths: 0 });
      expect(nc.probationEnd).toBeNull();
      expect((await profileOf(none.id)).employment).toMatchObject({ status: 'active', probationEnd: null });

      // the employment's probation end is worked out as the contract's (join date + 3 months − 1 day), so the signing
      // records only what it changed: nothing while on probation or already Active, the probation end and status of a
      // shorter probation already over, and the probation end of a contract without one
      const updates = async (h: Hire) =>
        (await prisma.auditLog.findMany({ where: { entityType: 'employment', entityId: h.employmentId, action: 'update' }, orderBy: { id: 'asc' } })).map((a) => a.diff);
      expect(await updates(e)).toEqual([{ employeeId: e.id, shiftId: { from: shiftA, to: null } }]);
      expect(await updates(past)).toEqual([]);
      expect(await updates(short)).toEqual([
        { employeeId: short.id, contract: sc.number, probationEnd: { from: addDays(addMonths(shortJoin, 3), -1), to: sc.probationEnd }, status: { from: 'probation', to: 'active' } },
      ]);
      expect(await updates(none)).toEqual([{ employeeId: none.id, contract: nc.number, probationEnd: { from: '2026-04-14', to: null } }]);
    });

    it('a renewal starts the day after the version before ends, with no probation, and supersedes it when signed', async () => {
      const e = await newHire('Renewed');
      const v1 = await signedContract(e);
      const probation = await postContract(e, { grossSalary: 14000, probationMonths: 1 }).expect(400);
      expect(probation.body.message).toBe('A renewal has no probation: the law allows it once per employer (Art. 90).');
      const early = await postContract(e, { grossSalary: 14000, startDate: '2026-01-15' }).expect(400);
      expect(early.body.message).toBe('Version 2 must start after version 1 started, on 15/01/2026.');

      // the same pay: no CEO step (a renewal with new pay goes to the CEO: raises.e2e-spec.ts)
      const v2 = await addContract(e, { grossSalary: 12000 });
      expect(v2).toMatchObject({ version: 2, number: expect.stringMatching(/^CON-2027-\d{4}$/), startDate: '2027-01-15', endDate: '2028-01-14', probationMonths: 0, probationEnd: null, status: 'draft', raise: null });
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

    it('the employment’s probation end, worked out at every save: none for a rehire; the first contract’s once there is one, none too', async () => {
      const save = (h: Hire, body: object) => api().patch(`/api/employees/${h.id}/employments/${h.employmentId}`).set('Cookie', hr).send(body).expect(200);

      // hired again (an earlier employment): no probation end, wherever the join date moves; the earlier one keeps its own
      const first = await newHire('Back Again', { joinDate: '2025-01-01' });
      await api().post(`/api/employees/${first.id}/employments/${first.employmentId}/end`).set('Cookie', hr).send({ endDate: '2025-12-31', endReason: 'resigned' }).expect(200);
      const again = await hire(first.id, { joinDate: '2026-03-01' });
      expect((await profileOf(again.id)).employment).toMatchObject({ probationEnd: null, status: 'active' });
      const moved = (await save(again, { joinDate: '2026-03-15' })).body as Profile;
      expect(moved.employment).toMatchObject({ joinDate: '2026-03-15', probationEnd: null });
      expect(moved.employments[1]).toMatchObject({ id: first.employmentId, joinDate: '2025-01-01', probationEnd: '2025-03-31' });

      // a first contract signed without probation: none, after later saves too, the join date's among them
      const none = await newHire('Signed No Probation');
      await signedContract(none, { probationMonths: 0 });
      await save(none, { shiftId: shiftA });
      const later = (await save(none, { joinDate: '2026-01-14' })).body as Profile;
      expect(later.employment).toMatchObject({ joinDate: '2026-01-14', probationEnd: null, status: 'active' });
      const updates = await prisma.auditLog.findMany({ where: { entityType: 'employment', entityId: none.employmentId, action: 'update' }, orderBy: { id: 'asc' } });
      expect(updates.at(-1)!.diff).toEqual({ employeeId: none.id, joinDate: { from: '2026-01-15', to: '2026-01-14' } });

      // a first contract still a draft (e.g. made from a job offer of 1 month's probation, which the employment was given
      // when it was made): its probation, not the settings' 3 months
      const drafted = await newHire('Drafted One Month');
      expect((await addContract(drafted, { probationMonths: 1 })).probationEnd).toBe('2026-02-14');
      expect(((await save(drafted, { shiftId: shiftA })).body as Profile).employment).toMatchObject({ probationEnd: '2026-02-14' });
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

  // How the pay is set and what is paid on top of it (owner's requests, 15 October 2026): a monthly salary or by the
  // hour, the working days a week, and allowances whose kinds HR sets up, each taxed or not and insured or not.
  describe('pay and allowances', () => {
    const HOURLY_NEEDS_BOTH = 'Enter the hourly rate and the hours a week: pay by the hour needs both.';
    const MONTHLY_NO_HOURS = 'A monthly salary has no hourly rate or hours a week. Clear them, or choose pay by the hour.';
    const HOURS = 'Enter the hours a week as a number of more than 0 and up to 48, e.g. 24 or 22.5.';
    const DAYS = 'Enter the working days a week as a whole number, 1 to 6.';
    let transport: string; // taxed, not insured
    let housing: string; // taxed and insured
    let mobile: string; // made inactive below

    const addKind = async (nameEn: string, body: object = {}) =>
      (await api().post('/api/allowance-types').set('Cookie', hr).send({ nameEn: `${nameEn} ${RUN}`, nameAr: 'بدل', ...body }).expect(201)).body.id as string;

    beforeAll(async () => {
      transport = await addKind('Transport');
      housing = await addKind('Housing', { insured: true });
      mobile = await addKind('Mobile', { taxable: false });
    });

    it('rejects an unknown contract length; fixed-term for 12 months unless another is sent (owner, 18 October 2026)', async () => {
      const e = await newHire('Unknown Length Refused');
      expect((await postContract(e, { grossSalary: 9000, form: 'forever' }).expect(400)).body.message).toEqual([FORM_REFUSED]);
      expect(await addContract(e, { form: 'fixed' })).toMatchObject({ form: 'fixed', durationMonths: 12, endDate: '2027-01-14' });
    });

    it('by the hour: the gross is rate × hours a week × 52 ÷ 12, worked out by the server', async () => {
      const e = await newHire('Hourly Part Timer', { employmentType: 'part_time' });
      // a gross sent with it is replaced
      const c = await addContract(e, { payBasis: 'hourly', hourlyRate: 150, hoursPerWeek: 24, daysPerWeek: 3, grossSalary: 1 });
      expect(c).toMatchObject({
        payBasis: 'hourly',
        hourlyRate: 150,
        hoursPerWeek: 24,
        daysPerWeek: 3,
        grossSalary: 15600,
        basicSalary: 12480,
        insuredSalary: 15600,
        totalSalary: 15600,
      });

      // the hours change: the gross follows; a gross sent alone is replaced too
      const changed = await patchContract(c.id, { hoursPerWeek: 22.5, hourlyRate: 162.5 }).expect(200);
      expect(changed.body).toMatchObject({ hourlyRate: 162.5, hoursPerWeek: 22.5, grossSalary: 15843.75, insuredSalary: 15843.75 });
      expect((await patchContract(c.id, { grossSalary: 20000 }).expect(200)).body.grossSalary).toBe(15843.75);

      // switched to a monthly salary: the hourly terms go, the monthly estimate stays the gross unless one is sent
      const monthly = await patchContract(c.id, { payBasis: 'monthly' }).expect(200);
      expect(monthly.body).toMatchObject({ payBasis: 'monthly', hourlyRate: null, hoursPerWeek: null, daysPerWeek: 3, grossSalary: 15843.75 });
      expect((await patchContract(c.id, { grossSalary: 9000 }).expect(200)).body).toMatchObject({ grossSalary: 9000, insuredSalary: 9000 });
      // and back: the rate and hours are needed again
      expect((await patchContract(c.id, { payBasis: 'hourly' }).expect(400)).body.message).toBe(HOURLY_NEEDS_BOTH);
      expect((await patchContract(c.id, { payBasis: 'hourly', hourlyRate: 100, hoursPerWeek: 10.5 }).expect(200)).body.grossSalary).toBe(4550);

      // the salary audit: the hourly rate is masked like the gross; the hours are not restricted
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'contract', entityId: c.id }, orderBy: { id: 'asc' } });
      expect(audit[0].diff).toMatchObject({ payBasis: 'hourly', hourlyRate: 'changed', hoursPerWeek: 24, daysPerWeek: 3, grossSalary: 'changed' });
      expect(audit[1].diff).toMatchObject({ hourlyRate: 'changed', hoursPerWeek: { from: 24, to: 22.5 }, grossSalary: 'changed' });
      for (const { diff } of audit) {
        for (const key of ['hourlyRate', 'grossSalary', 'insuredSalary']) expect((diff as Record<string, unknown>)[key] ?? 'changed').toBe('changed');
      }
    });

    it('refuses hourly terms that are missing, too many hours, or hourly terms on a monthly salary', async () => {
      const e = await newHire('Hourly Refused', { employmentType: 'part_time' });
      expect((await postContract(e, { payBasis: 'hourly', hourlyRate: 150 }).expect(400)).body.message).toBe(HOURLY_NEEDS_BOTH);
      expect((await postContract(e, { payBasis: 'hourly', hoursPerWeek: 20 }).expect(400)).body.message).toBe(HOURLY_NEEDS_BOTH);
      expect((await postContract(e, { grossSalary: 9000, hourlyRate: 150 }).expect(400)).body.message).toBe(MONTHLY_NO_HOURS);
      expect((await postContract(e, { payBasis: 'monthly', hoursPerWeek: 20 }).expect(400)).body.message).toBe(MONTHLY_NO_HOURS);
      expect((await postContract(e, { payBasis: 'monthly' }).expect(400)).body.message).toBe('Enter the gross salary as an amount, e.g. 12000 or 12000.50.');
      for (const hoursPerWeek of [49, 0, 22.55]) {
        expect((await postContract(e, { payBasis: 'hourly', hourlyRate: 150, hoursPerWeek }).expect(400)).body.message).toEqual([HOURS]);
      }
      await postContract(e, { payBasis: 'hourly', hourlyRate: 0, hoursPerWeek: 20 }).expect(400);
      await postContract(e, { payBasis: 'weekly', grossSalary: 9000 }).expect(400);
      expect(await addContract(e, { payBasis: 'hourly', hourlyRate: 120.5, hoursPerWeek: 48 })).toMatchObject({ grossSalary: 25064 }); // 120.5 × 48 × 52 ÷ 12
    });

    it('days a week: any employment type, optional, 1 to 6; cleared with null', async () => {
      const e = await newHire('Days A Week');
      const c = await addContract(e, { daysPerWeek: 5 });
      expect(c).toMatchObject({ payBasis: 'monthly', daysPerWeek: 5, hoursPerWeek: null });
      for (const daysPerWeek of [0, 7, 2.5]) expect((await patchContract(c.id, { daysPerWeek }).expect(400)).body.message).toEqual([DAYS]);
      expect((await patchContract(c.id, { daysPerWeek: null }).expect(200)).body.daysPerWeek).toBeNull();
    });

    it('allowances: paid on top of the gross, in the kinds’ order; the insured ones count in the insured salary, within the cap', async () => {
      const e = await newHire('With Allowances');
      const c = await addContract(e, { grossSalary: 12000, allowances: [{ allowanceTypeId: housing, amount: 3000 }, { allowanceTypeId: transport, amount: 750.5 }] });
      expect(c).toMatchObject({
        grossSalary: 12000,
        allowances: [
          { allowanceTypeId: transport, nameEn: `Transport ${RUN}`, nameAr: 'بدل', taxable: true, insured: false, amount: 750.5 },
          { allowanceTypeId: housing, nameEn: `Housing ${RUN}`, nameAr: 'بدل', taxable: true, insured: true, amount: 3000 },
        ],
        allowancesTotal: 3750.5,
        totalSalary: 15750.5,
        insuredSalary: 15000, // the gross and the insured housing allowance, not the transport
      });
      // over the cap: the insured salary stops at the year's maximum insurable wage
      expect((await patchContract(c.id, { grossSalary: 15000 }).expect(200)).body).toMatchObject({ insuredSalary: 16700, totalSalary: 18750.5 });

      // the net may include the allowances, but not exceed the gross and the allowances together
      expect((await patchContract(c.id, { netSalary: 16000 }).expect(200)).body.netSalary).toBe(16000);
      const tooMuch = await patchContract(c.id, { netSalary: 18750.51 }).expect(400);
      expect(tooMuch.body.message).toBe("The net salary can't be more than the gross salary and the allowances together.");

      // sent again, the set is replaced; [] clears it
      const replaced = await patchContract(c.id, { allowances: [{ allowanceTypeId: mobile, amount: 200 }], netSalary: null }).expect(200);
      expect(replaced.body).toMatchObject({ allowances: [{ allowanceTypeId: mobile, taxable: false, insured: false, amount: 200 }], allowancesTotal: 200, insuredSalary: 15000 });
      const cleared = await patchContract(c.id, { allowances: [] }).expect(200);
      expect(cleared.body).toMatchObject({ allowances: [], allowancesTotal: 0, totalSalary: 15000 });

      // the audit log only says they changed
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'contract', entityId: c.id }, orderBy: { id: 'asc' } });
      expect(audit[0].diff).toMatchObject({ allowances: 'changed', insuredSalary: 'changed' });
      expect(audit.at(-1)!.diff).toMatchObject({ allowances: 'changed' });
      expect(JSON.stringify(audit.map((a) => a.diff))).not.toContain('amount');

      // HR, Finance and the CEO see them; a manager and the employee themself do not (salaryHidden)
      await patchContract(c.id, { allowances: [{ allowanceTypeId: transport, amount: 500 }] }).expect(200);
      const signed = (await signContract(c.id, '2026-01-15').expect(200)).body as Contract;
      expect((await profileOf(e.id, finance)).employment!.contract).toMatchObject({ id: signed.id, allowances: [{ allowanceTypeId: transport, amount: 500 }], totalSalary: 15500 });
    });

    it('refuses an unknown kind, the same kind twice, an amount of 0, and an inactive kind unless the draft already has it', async () => {
      const e = await newHire('Allowances Refused');
      const unknown = await postContract(e, { grossSalary: 9000, allowances: [{ allowanceTypeId: '00000000-0000-4000-8000-000000000000', amount: 100 }] }).expect(400);
      expect(unknown.body.message).toBe('One of the allowances is no longer on the list. Reload the page and choose it again.');
      const twice = await postContract(e, { grossSalary: 9000, allowances: [{ allowanceTypeId: transport, amount: 100 }, { allowanceTypeId: transport, amount: 200 }] }).expect(400);
      expect(twice.body.message).toEqual(['Add each allowance once.']);
      for (const amount of [0, -5, 10.555]) {
        const bad = await postContract(e, { grossSalary: 9000, allowances: [{ allowanceTypeId: transport, amount }] }).expect(400);
        expect(bad.body.message).toEqual(['Enter each allowance as an amount of more than 0, e.g. 500 or 750.50.']);
      }
      await postContract(e, { grossSalary: 9000, allowances: null }).expect(400);
      await postContract(e, { grossSalary: 9000, allowances: [{ allowanceTypeId: transport }] }).expect(400);
      await postContract(e, { grossSalary: 9000, allowances: [{ allowanceTypeId: transport, amount: 100, taxable: false }] }).expect(400);

      // a draft with the kind keeps it once it is made inactive, and may be saved with it again; a new contract may not
      const draft = await addContract(e, { allowances: [{ allowanceTypeId: mobile, amount: 300 }] });
      await api().patch(`/api/allowance-types/${mobile}`).set('Cookie', hr).send({ active: false }).expect(200);
      try {
        expect((await patchContract(draft.id, { allowances: [{ allowanceTypeId: mobile, amount: 350 }] }).expect(200)).body.allowances).toMatchObject([{ allowanceTypeId: mobile, amount: 350 }]);
        const other = await newHire('Inactive Allowance');
        const inactive = await postContract(other, { grossSalary: 9000, allowances: [{ allowanceTypeId: mobile, amount: 100 }] }).expect(400);
        expect(inactive.body.message).toBe(`Mobile ${RUN} is inactive, so it can't be added. Choose another allowance, or make it active again under Organization → Allowances.`);
      } finally {
        await api().patch(`/api/allowance-types/${mobile}`).set('Cookie', hr).send({ active: true }).expect(200);
      }
      // a draft with allowances is deleted with them
      await api().delete(`/api/contracts/${draft.id}`).set('Cookie', superAdmin).expect(204);
      expect(await prisma.contractAllowance.count({ where: { contractId: draft.id } })).toBe(0);
    });

    it('a renewal copies the version before’s allowances as they are, unless others are sent; a signed contract keeps them', async () => {
      const kind = await addKind('Renewal Bonus');
      const e = await newHire('Renewed With Allowances');
      const v1 = await signedContract(e, { grossSalary: 10000, allowances: [{ allowanceTypeId: kind, amount: 1000 }, { allowanceTypeId: housing, amount: 2000 }] });
      expect(v1).toMatchObject({ insuredSalary: 12000, totalSalary: 13000 });

      // allowances and pay are terms: a signed contract never changes them
      const SIGNED = 'This contract is signed: only the signing and filing dates and the note can be changed. For other changes, add a new version.';
      for (const body of [{ allowances: [] }, { payBasis: 'hourly' }, { daysPerWeek: 4 }, { hoursPerWeek: 10 }, { hourlyRate: 10 }]) {
        expect((await patchContract(v1.id, body).expect(400)).body.message).toBe(SIGNED);
      }

      // the kind is renamed and made inactive since: the renewal still copies it as the first version has it
      await api().patch(`/api/allowance-types/${kind}`).set('Cookie', hr).send({ nameEn: `Renamed Bonus ${RUN}`, taxable: false, active: false }).expect(200);
      // the same pay as version 1, so no CEO step (owner's decisions, 16 October 2026)
      const v2 = await addContract(e, { grossSalary: 10000 });
      expect(v2).toMatchObject({
        version: 2,
        allowances: [
          { allowanceTypeId: housing, nameEn: `Housing ${RUN}`, insured: true, amount: 2000 },
          { allowanceTypeId: kind, nameEn: `Renewal Bonus ${RUN}`, taxable: true, amount: 1000 },
        ],
        insuredSalary: 12000,
        totalSalary: 13000,
        raise: null,
      });
      // the first version is unchanged
      expect(((await contractsOf(e).expect(200)).body as Contract[]).find((c) => c.id === v1.id)).toMatchObject({ allowances: v1.allowances });
      await api().delete(`/api/contracts/${v2.id}`).set('Cookie', superAdmin).expect(204);

      // sent, they replace the copy; the inactive kind the version before has may stay, with its name as it is now
      // other allowances are new pay: a reason, for the CEO
      const v2b = await addContract(e, { grossSalary: 11000, allowances: [{ allowanceTypeId: kind, amount: 1200 }], raiseReason: 'adjustment' });
      expect(v2b).toMatchObject({ allowances: [{ allowanceTypeId: kind, nameEn: `Renamed Bonus ${RUN}`, taxable: false, amount: 1200 }], insuredSalary: 11000 });
      await api().delete(`/api/contracts/${v2b.id}`).set('Cookie', superAdmin).expect(204);
      const none = await addContract(e, { grossSalary: 11000, allowances: [], raiseReason: 'adjustment' });
      expect(none).toMatchObject({ allowances: [], totalSalary: 11000 });

      // undoing the signing keeps the allowances
      await api().delete(`/api/contracts/${none.id}`).set('Cookie', superAdmin).expect(204);
      await api().post(`/api/contracts/${v1.id}/unsign`).set('Cookie', superAdmin).expect(200);
      const [unsigned] = (await contractsOf(e).expect(200)).body as Contract[];
      expect(unsigned).toMatchObject({ id: v1.id, status: 'draft', allowances: v1.allowances, insuredSalary: 12000 });
    });
  });

  describe('undoing a signing', () => {
    const unsign = (id: string, session = superAdmin) => api().post(`/api/contracts/${id}/unsign`).set('Cookie', session);
    const ONLY_SUPER_ADMIN_UNSIGNS = 'Only a Super Admin can undo a signing.';

    it('a Super Admin only: version 1 is a draft again, and the employment’s probation is as before the signing', async () => {
      const join = addDays(today, -30);
      const e = await newHire('Signed By Mistake', { joinDate: join, jobTitleId, gradeId: gradeG4, shiftId: shiftA });
      const c = await signedContract(e);
      await patchContract(c.id, { insuranceFiledOn: today }).expect(200);
      expect((await profileOf(e.id)).employment).toMatchObject({ status: 'probation', probationEnd: addDays(addMonths(join, 3), -1) });

      for (const session of [hr, admin, ceo]) expect((await unsign(c.id, session).expect(403)).body.message).toBe(ONLY_SUPER_ADMIN_UNSIGNS);
      const res = await unsign(c.id).expect(200);
      expect(res.body).toMatchObject({
        id: c.id,
        number: c.number,
        status: 'draft',
        signedOn: null,
        insuranceFiledOn: null,
        jobTitleEn: null,
        gradeCode: null,
        departmentName: null,
        shiftCode: null,
        probationEnd: c.probationEnd,
      });
      // the employment's probation end was already the contract's, from the join date (+ 3 months − 1 day), and the
      // signing left it on probation: nothing to put back
      expect((await profileOf(e.id)).employment).toMatchObject({ status: 'probation', probationEnd: addDays(addMonths(join, 3), -1), contract: null });
      expect((await unsign(c.id).expect(409)).body.message).toBe(`${c.number} is not signed.`);

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'contract', entityId: c.id }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['create', 'sign', 'update', 'unsign']);
      expect(audit[3].diff).toMatchObject({ number: c.number, status: { from: 'active', to: 'draft' }, signedOn: { from: join, to: null }, insuranceFiledOn: { from: today, to: null } });
      expect(await prisma.auditLog.count({ where: { entityType: 'employment', entityId: e.employmentId, action: 'update' } })).toBe(0);

      // corrected and signed again, or deleted
      await patchContract(c.id, { grossSalary: 13000 }).expect(200);
      expect((await signContract(c.id, today).expect(200)).body).toMatchObject({ status: 'active', grossSalary: 13000, jobTitleEn: 'Account Manager' });
      expect((await unsign(c.id).expect(200)).body.status).toBe('draft');
      await api().delete(`/api/contracts/${c.id}`).set('Cookie', superAdmin).expect(204);
    });

    it('keeps the status a probation confirmed since; puts back Probation when the signing ended it', async () => {
      const confirmed = await onProbation('Confirmed Then Undone');
      await api().post(`/api/employees/${confirmed.id}/employments/${confirmed.employmentId}/confirm-probation`).set('Cookie', hr).expect(200);
      await unsign(confirmed.contract.id).expect(200);
      expect((await profileOf(confirmed.id)).employment).toMatchObject({ status: 'active', probationEnd: confirmed.contract.probationEnd });
      expect(confirmed.contract.probationEnd).toBe(addDays(addMonths(addDays(today, -20), 3), -1));

      // on probation, with a first contract whose shorter probation is already over: signing made it Active with the
      // contract's probation end; undoing it goes back to how it was (Probation, to the end worked out from the join date)
      const join = addDays(today, -40);
      const probationEnd = addDays(addMonths(join, 3), -1);
      const past = await newHire('Past Then Undone', { joinDate: join });
      const before = (await profileOf(past.id)).employment!;
      expect(before).toMatchObject({ status: 'probation', probationEnd });
      const c = await signedContract(past, { probationMonths: 1 });
      expect((await profileOf(past.id)).employment).toMatchObject({ status: 'active', probationEnd: c.probationEnd });
      await unsign(c.id).expect(200);
      expect((await profileOf(past.id)).employment).toMatchObject({ status: 'probation', probationEnd });
      const undone = await prisma.auditLog.findMany({ where: { entityType: 'employment', entityId: past.employmentId, action: 'update' }, orderBy: { id: 'asc' } });
      expect(undone.at(-1)!.diff).toEqual({
        employeeId: past.id,
        signingUndone: c.number,
        probationEnd: { from: c.probationEnd, to: probationEnd },
        status: { from: 'active', to: 'probation' },
      });
    });

    it('a renewal: the version before is the contract again; refused for a replaced version or with the next one drafted', async () => {
      const e = await newHire('Renewal Undone');
      const v1 = await signedContract(e);
      const v2 = await addContract(e, { grossSalary: 12000 });
      expect((await unsign(v1.id).expect(409)).body.message).toBe(`Version 2 (${v2.number}) follows it as a draft. Delete that draft first.`);

      await signContract(v2.id, today).expect(200);
      expect((await unsign(v1.id).expect(409)).body.message).toBe(`${v1.number} was replaced by a later version. Undo that version's signing first.`);
      expect((await unsign(v2.id).expect(200)).body).toMatchObject({ version: 2, status: 'draft', signedOn: null });
      const versions = (await contractsOf(e).expect(200)).body as Contract[];
      expect(versions.map((v) => [v.version, v.status])).toEqual([
        [2, 'draft'],
        [1, 'active'],
      ]);
      expect((await profileOf(e.id)).employment).toMatchObject({ status: 'active', probationEnd: '2026-04-14', contract: { id: v1.id } });
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'contract', entityId: v2.id, action: 'unsign' } });
      expect(audit!.diff).toMatchObject({ restored: v1.number });
    });

    it('refused while an ending is open, and for a contract ended with the employment', async () => {
      const e = await onProbation('Ending Not Undone');
      const ending = await addEnding(e, { ruleKey: 'probation', initiator: 'company', noticeGivenOn: today });
      expect((await unsign(e.contract.id).expect(409)).body.message).toBe('An ending of this employment is in progress. Withdraw it first, or keep the contract signed.');
      await act(ending.id, 'withdraw', hr).expect(200);
      await unsign(e.contract.id).expect(200);

      const gone = await newHire('Ended Not Undone', { joinDate: '2025-01-01' });
      const c = await signedContract(gone, { startDate: '2025-01-01' });
      await api().post(`/api/employees/${gone.id}/employments/${gone.employmentId}/end`).set('Cookie', hr).send({ endDate: '2025-12-31', endReason: 'resigned' }).expect(200);
      expect((await unsign(c.id).expect(409)).body.message).toBe(`${c.number} has ended, so its signing stays on record.`);
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
        noticeEndsOn: addDays(today, 14),
        lastDayAgreed: false,
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
        // only for a fixed term the company doesn't renew (Art. 154; owner, 18 October 2026)
        art154Note: null,
        art154Estimate: null,
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
      // on probation, then its join date corrected to 15 January: still Probation (not confirmed), its probation end 14
      // April 2026 (no contract)
      const late = await newHire('Late Probation Notice', { joinDate: addDays(today, -20) });
      const corrected = await api().patch(`/api/employees/${late.id}/employments/${late.employmentId}`).set('Cookie', hr).send({ joinDate: '2026-01-15' }).expect(200);
      expect(corrected.body.employment).toMatchObject({ status: 'probation', probationEnd: '2026-04-14' });
      const after = await postEnding(late, { ruleKey: 'probation', initiator: 'company', noticeGivenOn: '2026-04-15' }).expect(400);
      expect(after.body.message).toBe('The probation ended on 14/04/2026: notice during probation must be given by then. Choose another way to end the employment.');
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
    });

    it('company notice: 3 months, or paid in lieu with the notice date as the last working day', async () => {
      const e = await newHire('Let Go');
      const worked = await addEnding(e, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01' });
      expect(worked).toMatchObject({ initiator: 'company', payInLieu: false, lastWorkingDay: '2027-01-01', endReason: 'terminated' });
      await act(worked.id, 'withdraw', hr).expect(200);
      const paid = await addEnding(e, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01', payInLieu: true });
      expect(paid).toMatchObject({ payInLieu: true, lastWorkingDay: '2026-10-01' });
    });

    // "let me add agreed on last working date only by admin and HR" (owner, 26 October 2026)
    describe('an agreed last working day', () => {
      const lastDay = (id: string, body: object, session = hr) => api().patch(`/api/endings/${id}/last-day`).set('Cookie', session).send(body);
      const auditOf = (id: string) => prisma.auditLog.findMany({ where: { entityType: 'employment_ending', entityId: id }, orderBy: { id: 'asc' } });

      it('set when HR records the ending: it is the last working day, the notice’s end kept beside it, and completing works from it', async () => {
        const e = await newHire('Agreed At Start');
        const ending = await addEnding(e, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01', agreedLastWorkingDay: today });
        expect(ending).toMatchObject({ lastWorkingDay: today, noticeEndsOn: '2027-01-01', lastDayAgreed: true, status: 'pending_ceo' });
        const created = (await auditOf(ending.id))[0]!;
        expect(created.diff).toMatchObject({ lastWorkingDay: today, noticeEndsOn: '2027-01-01', lastDayAgreed: true });
        // the profile shows it too
        expect((await profileOf(e.id)).employment!.ending).toMatchObject({ lastWorkingDay: today, noticeEndsOn: '2027-01-01', lastDayAgreed: true });

        await act(ending.id, 'approve', ceo).expect(200);
        const done = await act(ending.id, 'complete', hr).expect(200);
        expect(done.body).toMatchObject({ status: 'completed', lastWorkingDay: today, lastDayAgreed: true });
        expect((await profileOf(e.id)).employments[0]).toMatchObject({ endDate: today });
      });

      it('left empty, the notice’s end stays the last working day, not agreed', async () => {
        const e = await newHire('Not Agreed');
        for (const empty of [undefined, null, '']) {
          const ending = await addEnding(e, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01', ...(empty !== undefined && { agreedLastWorkingDay: empty }) });
          expect(ending).toMatchObject({ lastWorkingDay: '2027-01-01', noticeEndsOn: '2027-01-01', lastDayAgreed: false });
          await act(ending.id, 'withdraw', hr).expect(200);
        }
      });

      it('refused before the notice day, and when the notice is paid instead of worked', async () => {
        const e = await newHire('Agreed Refused');
        const before = await postEnding(e, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01', agreedLastWorkingDay: '2026-09-30' }).expect(400);
        expect(before.body.message).toBe('The agreed last working day must be on or after the notice date, 01/10/2026.');
        await postEnding(e, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01', agreedLastWorkingDay: 'soon' }).expect(400);
        const paid = await postEnding(e, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01', payInLieu: true, agreedLastWorkingDay: '2026-10-20' }).expect(400);
        expect(paid.body.message).toMatch(/paid instead of worked/);
        // the notice day itself and a day after the notice's end are fine
        const same = await addEnding(e, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01', agreedLastWorkingDay: '2026-10-01' });
        expect(same).toMatchObject({ lastWorkingDay: '2026-10-01', lastDayAgreed: true });
        const ending = same;
        await lastDay(ending.id, { agreedLastWorkingDay: '2026-09-30' }).expect(400);
        const later = await lastDay(ending.id, { agreedLastWorkingDay: '2027-03-01' }).expect(200);
        expect(later.body).toMatchObject({ lastWorkingDay: '2027-03-01', noticeEndsOn: '2027-01-01', lastDayAgreed: true });
        await lastDay(ending.id, {}).expect(400);
        await lastDay(ending.id, { agreedLastWorkingDay: '2027-03-01' }).expect(400); // already so
      });

      it('HR and an Admin set it; the CEO and an employee are refused', async () => {
        const e = await newHire('Agreed Roles');
        const ending = await addEnding(e, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01' });
        const staff = await signIn(app, await createUser(prisma, ['employee']));
        await lastDay(ending.id, { agreedLastWorkingDay: '2026-11-30' }, ceo).expect(403);
        await lastDay(ending.id, { agreedLastWorkingDay: '2026-11-30' }, staff).expect(403);
        await lastDay(ending.id, { agreedLastWorkingDay: '2026-11-30' }, finance).expect(403);
        const byHr = await lastDay(ending.id, { agreedLastWorkingDay: '2026-11-30' }, hr).expect(200);
        expect(byHr.body).toMatchObject({ lastWorkingDay: '2026-11-30', noticeEndsOn: '2027-01-01', lastDayAgreed: true, status: 'pending_ceo' });
        const byAdmin = await lastDay(ending.id, { agreedLastWorkingDay: '2026-12-15' }, admin).expect(200);
        expect(byAdmin.body).toMatchObject({ lastWorkingDay: '2026-12-15', lastDayAgreed: true, status: 'pending_ceo' });
        const bySuper = await lastDay(ending.id, { agreedLastWorkingDay: '2026-12-20' }, superAdmin).expect(200);
        expect(bySuper.body).toMatchObject({ lastWorkingDay: '2026-12-20', lastDayAgreed: true });
        // cleared: the notice's end again
        const cleared = await lastDay(ending.id, { agreedLastWorkingDay: null }, hr).expect(200);
        expect(cleared.body).toMatchObject({ lastWorkingDay: '2027-01-01', noticeEndsOn: '2027-01-01', lastDayAgreed: false, status: 'pending_ceo' });
        await lastDay(ending.id, { agreedLastWorkingDay: null }, hr).expect(400); // nothing to clear

        const audit = (await auditOf(ending.id)).filter((a) => a.action === 'update');
        expect(audit).toHaveLength(4);
        expect(audit[0]!.diff).toMatchObject({ lastWorkingDay: { from: '2027-01-01', to: '2026-11-30' }, lastDayAgreed: { from: false, to: true } });
        expect(audit[3]!.diff).toMatchObject({ lastWorkingDay: { from: '2026-12-20', to: '2027-01-01' }, lastDayAgreed: { from: true, to: false } });
      });

      it('changed after the CEO approved it, it goes back to the CEO, who is told what changed; the employment stays in its notice', async () => {
        const e = await newHire('Agreed After Approval');
        const ending = await addEnding(e, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01', agreedLastWorkingDay: today });
        await act(ending.id, 'approve', ceo, { note: 'Fine' }).expect(200);
        expect((await profileOf(e.id)).employment).toMatchObject({ status: 'notice_period' });

        const back = await lastDay(ending.id, { agreedLastWorkingDay: addDays(today, 10), note: 'The handover needs longer' }, admin).expect(200);
        expect(back.body).toMatchObject({
          status: 'pending_ceo',
          lastWorkingDay: addDays(today, 10),
          lastDayAgreed: true,
          ceoDecidedBy: null,
          ceoDecidedAt: null,
          ceoNote: null,
        });
        expect(back.body.note).toBe(`Last working day agreed: ${shownDate(today)} → ${shownDate(addDays(today, 10))}. The handover needs longer`);
        expect((await profileOf(e.id)).employment).toMatchObject({ status: 'notice_period' });
        // it can't be completed until the CEO approves again, and is in the CEO's queue meanwhile
        await act(ending.id, 'complete', hr).expect(409);
        const queue = (await api().get('/api/endings?status=pending_ceo').set('Cookie', ceo).expect(200)).body as Ending[];
        expect(queue.find((x) => x.id === ending.id)).toMatchObject({ lastWorkingDay: addDays(today, 10), lastDayAgreed: true });
        const audit = (await auditOf(ending.id)).filter((a) => a.action === 'update');
        expect(audit[0]!.diff).toMatchObject({
          lastWorkingDay: { from: today, to: addDays(today, 10) },
          status: { from: 'approved', to: 'pending_ceo' },
          sentBackToCeo: true,
          ceoApproval: { by: ceoEmail, note: 'Fine' },
          note: 'The handover needs longer',
        });

        // approved again, then cleared: back to the CEO again; the CEO rejecting it ends the notice period
        await act(ending.id, 'approve', ceo).expect(200);
        const again = await lastDay(ending.id, { agreedLastWorkingDay: null }, hr).expect(200);
        expect(again.body).toMatchObject({ status: 'pending_ceo', lastWorkingDay: '2027-01-01', lastDayAgreed: false });
        await act(ending.id, 'reject', ceo, { note: 'Keep the first date' }).expect(200);
        expect((await profileOf(e.id)).employment).toMatchObject({ status: 'active' });
        // a rejected or withdrawn ending is closed to the change
        const closed = await lastDay(ending.id, { agreedLastWorkingDay: today }, hr).expect(409);
        expect(closed.body.message).toMatch(/not once it is rejected or withdrawn/);
      });

      it('withdrawing one sent back to the CEO puts the employment out of its notice period; a completed one can’t be changed', async () => {
        const e = await newHire('Agreed Withdrawn');
        const ending = await addEnding(e, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01', agreedLastWorkingDay: today });
        await act(ending.id, 'approve', ceo).expect(200);
        await lastDay(ending.id, { agreedLastWorkingDay: addDays(today, 3) }, hr).expect(200);
        await act(ending.id, 'withdraw', hr).expect(200);
        expect((await profileOf(e.id)).employment).toMatchObject({ status: 'active' });

        const done = await newHire('Agreed Completed');
        const finished = await addEnding(done, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01', agreedLastWorkingDay: today });
        await act(finished.id, 'approve', ceo).expect(200);
        await act(finished.id, 'complete', hr).expect(200);
        const late = await lastDay(finished.id, { agreedLastWorkingDay: null }, hr).expect(409);
        expect(late.body.message).toContain('This one is completed.');
      });
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
        status: 'active',
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

    it('while the approved ending runs its notice, HR does not change the status; withdrawn, HR chooses again (owner’s decision, 16 October 2026)', async () => {
      const e = await newHire('Working Their Notice'); // hired in January: Active
      const change = (body: object) => api().patch(`/api/employees/${e.id}/employments/${e.employmentId}`).set('Cookie', hr).send(body);
      const ending = await addEnding(e, { ruleKey: 'company_notice', noticeGivenOn: '2026-10-01' });
      await act(ending.id, 'approve', ceo).expect(200);
      expect((await profileOf(e.id)).employment!.status).toBe('notice_period');

      for (const status of ['active', 'on_leave']) {
        const refused = await change({ status, shiftId: shiftA }).expect(400);
        expect(refused.body.message).toBe(`Working Their Notice ${RUN} is working out their notice: the status follows the approved ending (withdraw it to go back).`);
      }
      const named = await change({ status: 'notice_period' }).expect(400);
      expect(named.body.message).toEqual(['Choose Active or On leave. Probation and Notice period are set by the system.']);
      // nothing saved; the rest of the employment changes without the status
      expect((await profileOf(e.id)).employment).toMatchObject({ status: 'notice_period', shiftId: null });
      expect((await change({ shiftId: shiftA }).expect(200)).body.employment).toMatchObject({ status: 'notice_period', shiftId: shiftA });

      await act(ending.id, 'withdraw', hr).expect(200);
      expect((await profileOf(e.id)).employment!.status).toBe('active');
      expect((await change({ status: 'on_leave' }).expect(200)).body.employment.status).toBe('on_leave');
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
        // neither an intern's agreement, nor its conversion to full-time drafted (19 October 2026)
        conversionDraft: false,
        // not past its end yet (Art. 88(3))
        becameOpenEnded: false,
        training: null,
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
