import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { lawRatesFor, normalLawRates } from '@trendlix/shared';
import pg from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, addMonths, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { docx, p, r } from './fixtures/docx.js';
import { createApp, createUser, signIn } from './helpers.js';
import { assertTestDatabase } from './test-env.js';

// Employment types by Labour Law 14/2025 (owner, 18 October 2026: "can we update the employment types based on the
// labour law?"): Sales became Full-time paid by commission, Internship became Trainee (المتدرج, Arts. 28–30), Freelance
// kept outside the law (Art. 1(1)); the contract's length (Arts. 87, 88, 155), the nature of the work (Art. 1(6–8)) and
// remote work (Art. 96(1)) recorded, with the law's warnings. Dates that depend on today are counted from today in
// Cairo. Everyone here is invented, and deleted at the end.

const RUN = Date.now().toString(36).toLowerCase();
const MIGRATIONS = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
const MIGRATION = '20261018190000_employment_types_by_law';
const SCHEMA = 'employment_types_check';
const TYPE_MESSAGE = 'Choose an employment type: full_time, part_time, trainee, intern (an unpaid internship, outside the labour law) or freelance (outside the labour law).';

interface Contract {
  id: string;
  number: string;
  form: string;
  status: string;
  startDate: string;
  endDate: string | null;
  durationMonths: number | null;
  [key: string]: unknown;
}

interface Profile {
  id: string;
  fullNameEn: string;
  employment: ({ id: string; [key: string]: unknown } & Record<string, unknown>) | null;
}

describe('Employment types by the labour law (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let superAdmin: string;
  const today = todayInCairo();
  const api = () => request(app.getHttpServer());
  /** Everyone this file adds, deleted at the end with what was made for them. */
  const added: string[] = [];
  const offers: string[] = [];
  const versions: string[] = [];
  const reimbursementTypes: string[] = [];

  async function addEmployee(name: string, extra: object = {}): Promise<Profile> {
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف القانون', ...extra }).expect(201);
    added.push(res.body.id);
    return res.body as Profile;
  }

  const postHire = (employeeId: string, employment: object, contract: object) =>
    api()
      .post(`/api/employees/${employeeId}/hire`)
      .set('Cookie', hr)
      .send({ employment: { employmentType: 'full_time', joinDate: '2026-01-15', ...employment }, contract: { grossSalary: 12000, ...contract } });

  /** Hired in one form: the profile, its current employment and the draft contract made with it. */
  async function hire(name: string, employment: object = {}, contract: object = {}, person: object = {}) {
    const e = await addEmployee(name, person);
    const profile = (await postHire(e.id, employment, contract).expect(201)).body as Profile;
    const [draft] = await contractsOf(e.id, profile.employment!.id);
    return { id: e.id, employmentId: profile.employment!.id, profile, contract: draft };
  }

  const contractsOf = async (employeeId: string, employmentId: string) =>
    (await api().get(`/api/employees/${employeeId}/employments/${employmentId}/contracts`).set('Cookie', hr).expect(200)).body as Contract[];
  const profileOf = async (id: string) => (await api().get(`/api/employees/${id}`).set('Cookie', hr).expect(200)).body as Profile;
  const sign = async (c: Contract) => (await api().post(`/api/contracts/${c.id}/sign`).set('Cookie', hr).send({ signedOn: c.startDate <= today ? c.startDate : today }).expect(200)).body as Contract;
  const messageOf = (res: request.Response) => res.body.message as string | string[];

  async function publish(slot: string) {
    const upload = await api().post(`/api/templates/${slot}/versions`).set('Cookie', hr).attach('file', docx({ body: p(r('{{full_name_en}}')) }), `${slot}.docx`).field('language', 'en').expect(201);
    versions.push(upload.body.id);
    await api().post(`/api/templates/versions/${upload.body.id}/publish`).set('Cookie', hr).expect(200);
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
  });

  afterAll(async () => {
    // the year's rates as the seed has them, and nothing of this file left for the others' lists
    await prisma.payrollLawYear.updateMany({ where: { year: 2026 }, data: { minimumWage: null, updatedById: null } });
    await prisma.jobOffer.deleteMany({ where: { id: { in: offers } } });
    await prisma.employee.deleteMany({ where: { id: { in: added } } });
    await prisma.generatedDocument.deleteMany({ where: { templateVersionId: { in: versions } } });
    await prisma.templateVersion.deleteMany({ where: { id: { in: versions } } });
    await prisma.reimbursementType.deleteMany({ where: { id: { in: reimbursementTypes } } });
    await app.close();
  });

  describe('the migration', () => {
    let db: pg.Client;
    const sql = (migration: string) => readFileSync(`${MIGRATIONS}${migration}/migration.sql`, 'utf8');

    beforeAll(async () => {
      db = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      assertTestDatabase((await db.query<{ name: string }>('SELECT current_database() AS name')).rows[0].name);
    });

    afterAll(async () => {
      await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await db.end();
    });

    it('maps Sales to Full-time paid by commission and Internship to Trainee, wherever the type is kept', async () => {
      // the migrations before it, in a schema of their own, then the data as it was, then the migration
      await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; SET search_path TO ${SCHEMA}`);
      for (const m of readdirSync(MIGRATIONS).filter((m) => /^\d{14}_/.test(m) && m < MIGRATION).sort()) await db.query(sql(m));
      const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
      await db.query(`
        INSERT INTO employees (id, employee_code, full_name_en, full_name_ar, updated_at) VALUES
          ('${id(101)}', 'EMP-0101', 'Sami Sales', 'سامي', now()),
          ('${id(102)}', 'EMP-0102', 'Ines Intern', 'إيناس', now()),
          ('${id(103)}', 'EMP-0103', 'Fadi Fulltime', 'فادي', now());
        INSERT INTO employments (id, employee_id, employment_type, join_date, end_date, end_reason, updated_at) VALUES
          ('${id(1)}', '${id(101)}', 'sales', '2025-01-01', NULL, NULL, now()),
          ('${id(2)}', '${id(102)}', 'internship', '2025-03-01', '2025-08-31', 'contract_ended', now()),
          ('${id(3)}', '${id(103)}', 'full_time', '2025-05-01', NULL, NULL, now());
        INSERT INTO contracts (id, number, employment_id, version, start_date, end_date, duration_months, gross_salary, insured_salary, status, updated_at)
          VALUES ('${id(11)}', 'CON-2025-0101', '${id(1)}', 1, '2025-01-01', '2025-12-31', 12, 15000, 14500, 'active', now());
        INSERT INTO payroll_runs (id, month, rules, updated_at) VALUES ('${id(21)}', '2025-09-01', '{}', now());
        INSERT INTO payroll_lines (id, run_id, employee_id, employment_id, contract_id, employee_code, name_en, employment_type, pay_basis, terms, inputs, result,
            earned, allowances, employee_insurance, employer_insurance, monthly_tax, martyrs_fund, deductions, net, released, transfer, company_cost, updated_at)
          VALUES ('${id(22)}', '${id(21)}', '${id(101)}', '${id(1)}', '${id(11)}', 'EMP-0101', 'Sami Sales', 'sales', 'monthly', '{}', '{}', '{}',
            15000, 0, 1595, 2718.75, 1000, 7.5, 0, 12397.5, 0, 12397.5, 17718.75, now());
        INSERT INTO job_offers (id, number, full_name_en, full_name_ar, email, employment_type, join_date, gross_salary, expires_on, updated_at) VALUES
          ('${id(31)}', 'OFF-2025-0101', 'Selim Sales', 'سليم', 'selim@mail.test', 'sales', '2025-10-01', 9000, '2025-09-20', now()),
          ('${id(32)}', 'OFF-2025-0102', 'Ilham Intern', 'إلهام', 'ilham@mail.test', 'internship', '2025-10-01', 4000, '2025-09-20', now()),
          ('${id(33)}', 'OFF-2025-0103', 'Pia Part', 'بيا', 'pia@mail.test', 'part_time', '2025-10-01', 6000, '2025-09-20', now());
        INSERT INTO reimbursement_types (id, name_en, name_ar, employment_types, updated_at) VALUES
          ('${id(41)}', 'Fuel', 'وقود', ARRAY['sales', 'full_time'], now()),
          ('${id(42)}', 'Books', 'كتب', ARRAY['internship', 'part_time', 'sales'], now()),
          ('${id(43)}', 'Lunch', 'غداء', ARRAY[]::TEXT[], now());
      `);

      expect(sql(MIGRATION)).not.toMatch(/ON\s+COMMIT\s+DROP/i);
      await db.query(sql(MIGRATION));

      const rows = async (query: string) => (await db.query(query)).rows;
      expect(await rows('SELECT right(id::text, 1) AS id, employment_type AS type, paid_by_commission AS commission, work_nature AS nature FROM employments ORDER BY id')).toEqual([
        { id: '1', type: 'full_time', commission: true, nature: 'regular' },
        { id: '2', type: 'trainee', commission: false, nature: 'regular' },
        { id: '3', type: 'full_time', commission: false, nature: 'regular' },
      ]);
      expect(await rows('SELECT number, employment_type AS type, paid_by_commission AS commission, work_nature AS nature FROM job_offers ORDER BY number')).toEqual([
        { number: 'OFF-2025-0101', type: 'full_time', commission: true, nature: 'regular' },
        { number: 'OFF-2025-0102', type: 'trainee', commission: false, nature: 'regular' },
        { number: 'OFF-2025-0103', type: 'part_time', commission: false, nature: 'regular' },
      ]);
      // the payroll line's copy of the type, as the line was made
      expect(await rows('SELECT employment_type AS type FROM payroll_lines')).toEqual([{ type: 'full_time' }]);
      // who may claim: mapped the same way, each once, in their order
      expect(await rows('SELECT name_en AS name, employment_types AS types FROM reimbursement_types ORDER BY name_en')).toEqual([
        { name: 'Books', types: ['trainee', 'part_time', 'full_time'] },
        { name: 'Fuel', types: ['full_time'] },
        { name: 'Lunch', types: [] },
      ]);
      // the type has the four values, and the old one is gone
      const labels = await rows(`
        SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = '${SCHEMA}' AND t.typname = 'employment_type' ORDER BY e.enumsortorder`);
      expect(labels.map((l) => l.label)).toEqual(['full_time', 'part_time', 'trainee', 'freelance']);
      expect(await rows(`SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = '${SCHEMA}' AND t.typname = 'employment_type_before_law'`)).toEqual([]);
      // every contract so far is fixed-term, without a job or stages
      expect(await rows('SELECT form, job_to_do, trainee_stages FROM contracts')).toEqual([{ form: 'fixed', job_to_do: null, trainee_stages: null }]);
      expect(await rows("SELECT minimum_wage FROM payroll_law_years ORDER BY year")).toEqual([{ minimum_wage: null }, { minimum_wage: null }]);

      // the database refuses what the rules refuse
      await expect(db.query(`UPDATE employments SET paid_by_commission = true WHERE id = '${id(2)}'`)).rejects.toThrow(/employments_paid_by_commission_check/);
      await expect(db.query(`UPDATE employments SET work_nature = 'permanent' WHERE id = '${id(3)}'`)).rejects.toThrow(/employments_work_nature_check/);
      await expect(db.query(`UPDATE job_offers SET paid_by_commission = true WHERE number = 'OFF-2025-0103'`)).rejects.toThrow(/job_offers_paid_by_commission_check/);
      await expect(db.query(`UPDATE contracts SET form = 'open_ended'`)).rejects.toThrow(/contracts_open_ended_check/);
      await expect(db.query(`UPDATE contracts SET form = 'specific_job'`)).rejects.toThrow(/contracts_job_to_do_check/);
      await expect(db.query(`UPDATE contracts SET form = 'forever'`)).rejects.toThrow(/contracts_form_check/);
      await expect(db.query(`UPDATE reimbursement_types SET employment_types = ARRAY['sales'] WHERE name_en = 'Lunch'`)).rejects.toThrow(/reimbursement_types_employment_types_check/);
      await expect(db.query(`UPDATE employments SET employment_type = 'sales' WHERE id = '${id(3)}'`)).rejects.toThrow(/invalid input value for enum/);
      await expect(db.query('UPDATE payroll_law_years SET minimum_wage = 0')).rejects.toThrow(/payroll_law_years_minimum_wage_check/);
    });
  });

  describe('the employment', () => {
    it('takes the four types only, paid by commission for full-time only, and the nature of the work', async () => {
      const e = await addEmployee('Type Refused');
      expect(messageOf(await postHire(e.id, { employmentType: 'sales' }, {}).expect(400))).toEqual([TYPE_MESSAGE]);
      expect(messageOf(await postHire(e.id, { employmentType: 'internship' }, {}).expect(400))).toEqual([TYPE_MESSAGE]);
      expect(messageOf(await postHire(e.id, { employmentType: 'part_time', paidByCommission: true }, {}).expect(400))).toBe(
        'Paid by commission is for a full-time employment only. Choose Full-time, or leave paid by commission off.',
      );
      expect(messageOf(await postHire(e.id, { workNature: 'permanent' }, {}).expect(400))).toEqual(['Choose the nature of the work: regular, temporary, casual or seasonal.']);
      expect(await prisma.employment.count({ where: { employeeId: e.id } })).toBe(0);

      const sales = await hire('Sara Commission', { paidByCommission: true, workNature: 'seasonal', workArrangement: 'hybrid', officeDays: [0, 3] });
      expect(sales.profile.employment).toMatchObject({
        employmentType: 'full_time',
        paidByCommission: true,
        workNature: 'seasonal',
        workPattern: 'partly_remote',
        underLabourLaw: true,
        casualTooLong: false,
        becameOpenEnded: false,
      });
      // another type than full-time: the commission goes with it, and can't be put back
      const path = `/api/employees/${sales.id}/employments/${sales.employmentId}`;
      expect((await api().patch(path).set('Cookie', hr).send({ employmentType: 'part_time' }).expect(200)).body.employment).toMatchObject({
        employmentType: 'part_time',
        paidByCommission: false,
      });
      expect(messageOf(await api().patch(path).set('Cookie', hr).send({ paidByCommission: true }).expect(400))).toBe(
        'Paid by commission is for a full-time employment only. Choose Full-time, or leave paid by commission off.',
      );
      expect((await api().patch(path).set('Cookie', hr).send({ employmentType: 'full_time', paidByCommission: true, workArrangement: 'wfh' }).expect(200)).body.employment).toMatchObject({
        paidByCommission: true,
        workPattern: 'remote',
      });
    });

    it('warns of casual work past six months (Art. 1(7)), on the profile and on HR’s warnings', async () => {
      const long = await hire('Cara Casual', { workNature: 'casual', joinDate: addMonths(today, -7) });
      const short = await hire('Cody Casual', { workNature: 'casual', joinDate: addMonths(today, -2) });
      expect((await profileOf(long.id)).employment).toMatchObject({ workNature: 'casual', casualTooLong: true });
      expect((await profileOf(short.id)).employment).toMatchObject({ workNature: 'casual', casualTooLong: false });
      // with its contracts too
      expect((await contractsOf(long.id, long.employmentId)).map((c) => c.casualTooLong)).toEqual([true]);
      expect((await contractsOf(short.id, short.employmentId)).map((c) => c.casualTooLong)).toEqual([false]);
      const warnings = (await api().get('/api/contracts/law-warnings').set('Cookie', ceo).expect(200)).body as { kind: string; employmentId: string; since: string; message: string }[];
      const mine = warnings.filter((w) => [long.employmentId, short.employmentId].includes(w.employmentId));
      expect(mine).toEqual([
        expect.objectContaining({ kind: 'casual_too_long', employmentId: long.employmentId, since: addMonths(addMonths(today, -7), 6), contractId: null }),
      ]);
      expect(mine[0].message).toMatch(/past the 6 months casual work may last \(Labour Law Art\. 1\(7\)\)/);
      const staff = await signIn(app, await createUser(prisma, ['employee']));
      await api().get('/api/contracts/law-warnings').set('Cookie', staff).expect(403);
    });
  });

  describe('the contract’s length (Arts. 87, 88, 155)', () => {
    it('open-ended: no duration, no end date, no renewal, and no ending by non-renewal', async () => {
      const e = await addEmployee('Omar Open');
      expect(messageOf(await postHire(e.id, {}, { form: 'open_ended', durationMonths: 12 }).expect(400))).toBe(
        'An open-ended contract has no duration or end date (Labour Law Art. 87): leave the months out.',
      );
      const profile = (await postHire(e.id, { joinDate: addDays(today, -30) }, { form: 'open_ended' }).expect(201)).body as Profile;
      const [draft] = await contractsOf(e.id, profile.employment!.id);
      expect(draft).toMatchObject({ form: 'open_ended', durationMonths: null, endDate: null, jobToDo: null, nonRenewalNoticeBy: null, becameOpenEnded: false });
      const signed = await sign(draft);
      expect(signed).toMatchObject({ status: 'active', form: 'open_ended', endDate: null });
      const renewal = await api().post(`/api/employees/${e.id}/employments/${profile.employment!.id}/contracts`).set('Cookie', hr).send({ grossSalary: 13000 }).expect(409);
      expect(messageOf(renewal)).toBe(`${signed.number} is open-ended: it isn't renewed, it runs until it is ended by notice (Labour Law Art. 156). To change its pay, add a raise.`);
      const ending = await api().post(`/api/employees/${e.id}/employments/${profile.employment!.id}/endings`).set('Cookie', hr).send({ ruleKey: 'non_renewal', noticeGivenOn: today }).expect(400);
      expect(messageOf(ending)).toBe('Only a signed fixed-term contract can end by not being renewed. Sign one first, or choose another way to end the employment.');
      // never on the expiring list
      const expiring = (await api().get('/api/contracts/expiring?within=366').set('Cookie', hr).expect(200)).body as { id: string }[];
      expect(expiring.some((c) => c.id === signed.id)).toBe(false);
    });

    it('for a specific job: the job, and the day it is expected to be done if known; the list filters by length', async () => {
      const e = await addEmployee('Jana Job');
      expect(messageOf(await postHire(e.id, {}, { form: 'specific_job' }).expect(400))).toBe('Enter the job the contract is for (Labour Law Art. 155).');
      expect(messageOf(await postHire(e.id, {}, { jobToDo: 'The online store' }).expect(400))).toBe(
        'Only a contract for a specific job names the job: choose For a specific job, or leave the job out.',
      );
      expect(messageOf(await postHire(e.id, {}, { endDate: '2026-06-30' }).expect(400))).toBe(
        'A fixed-term contract ends when its duration does: send its months (durationMonths), not an end date.',
      );
      expect(messageOf(await postHire(e.id, {}, { form: 'specific_job', jobToDo: 'The online store', endDate: '2026-01-01' }).expect(400))).toBe(
        "The job can't be expected to be done before the contract starts, on 15/01/2026.",
      );
      const profile = (await postHire(e.id, {}, { form: 'specific_job', jobToDo: '  The online store  ', endDate: '2026-09-30' }).expect(201)).body as Profile;
      const [draft] = await contractsOf(e.id, profile.employment!.id);
      expect(draft).toMatchObject({ form: 'specific_job', jobToDo: 'The online store', durationMonths: null, endDate: '2026-09-30' });
      // changed to fixed-term: the job and its end go, the settings' months come
      const fixed = (await api().patch(`/api/contracts/${draft.id}`).set('Cookie', hr).send({ form: 'fixed' }).expect(200)).body as Contract;
      expect(fixed).toMatchObject({ form: 'fixed', jobToDo: null, durationMonths: 12, endDate: '2027-01-14' });
      const back = (await api().patch(`/api/contracts/${draft.id}`).set('Cookie', hr).send({ form: 'specific_job', jobToDo: 'The online store' }).expect(200)).body as Contract;
      expect(back).toMatchObject({ form: 'specific_job', jobToDo: 'The online store', durationMonths: null, endDate: null });
      const listed = (await api().get('/api/contracts').query({ form: 'specific_job', q: `Jana Job ${RUN}` }).set('Cookie', hr).expect(200)).body as Contract[];
      expect(listed.map((c) => [c.id, c.form, c.jobToDo])).toEqual([[draft.id, 'specific_job', 'The online store']]);
    });

    it('a fixed term past its end with the work going on is open-ended by the law (Art. 88(3)): warned of until renewed', async () => {
      const e = await hire('Badr Beyond', { joinDate: '2024-01-01' }, { durationMonths: 12 });
      const signed = await sign(e.contract);
      expect(signed).toMatchObject({ endDate: '2024-12-31', becameOpenEnded: true });
      expect((await profileOf(e.id)).employment).toMatchObject({ becameOpenEnded: true, contract: { id: signed.id, becameOpenEnded: true } });
      const listed = (await api().get('/api/contracts').query({ q: `Badr Beyond ${RUN}` }).set('Cookie', hr).expect(200)).body as Contract[];
      expect(listed.map((c) => [c.id, c.becameOpenEnded, c.casualTooLong])).toEqual([[signed.id, true, false]]);
      const expiring = (await api().get('/api/contracts/expiring').set('Cookie', hr).expect(200)).body as { id: string; becameOpenEnded: boolean }[];
      expect(expiring.find((c) => c.id === signed.id)).toMatchObject({ becameOpenEnded: true });
      const warnings = (await api().get('/api/contracts/law-warnings').set('Cookie', hr).expect(200)).body as { kind: string; contractId: string | null }[];
      expect(warnings.find((w) => w.contractId === signed.id)).toEqual({
        kind: 'became_open_ended',
        employee: { id: e.id, employeeCode: expect.any(String), fullNameEn: `Badr Beyond ${RUN}` },
        employmentId: e.employmentId,
        contractId: signed.id,
        contractNumber: signed.number,
        since: '2024-12-31',
        message: `${signed.number} ended on 31/12/2024 and the work goes on without a signed renewal: by Labour Law Art. 88 it is now open-ended. Renew it in writing, or end the employment.`,
      });

      // a draft renewal isn't the written agreement; signed, the warning goes
      const renewal = (await api().post(`/api/employees/${e.id}/employments/${e.employmentId}/contracts`).set('Cookie', hr).send({ grossSalary: 12000 }).expect(201)).body as Contract;
      expect((await profileOf(e.id)).employment).toMatchObject({ becameOpenEnded: true });
      await api().post(`/api/contracts/${renewal.id}/sign`).set('Cookie', hr).send({ signedOn: today }).expect(200);
      const after = (await profileOf(e.id)).employment!;
      expect(after.becameOpenEnded).toBe(renewal.endDate! < today);
      const now = (await api().get('/api/contracts/law-warnings').set('Cookie', hr).expect(200)).body as { contractId: string | null }[];
      expect(now.some((w) => w.contractId === signed.id)).toBe(false);
    });
  });

  describe('the trainee’s training agreement (Arts. 28–30)', () => {
    const STAGES = [
      { name: 'Basics', months: 3, pay: 4000 },
      { name: 'Practice', months: 3, pay: 7000 },
    ];

    it('needs its stages, each paying more than the one before, the trainee at least 14, the last at least the minimum wage', async () => {
      const e = await addEmployee('Tamer Trainee', { dateOfBirth: '2008-05-01' });
      const job = { employmentType: 'trainee', joinDate: '2026-10-01' };
      expect(messageOf(await postHire(e.id, job, {}).expect(400))).toEqual([
        'Add at least one training stage: a training agreement sets the training’s stages and the pay of each (Labour Law Art. 29).',
      ]);
      expect(messageOf(await postHire(e.id, job, { traineeStages: [STAGES[1], STAGES[0]] }).expect(400))).toEqual([
        'Training stage 2’s pay must be more than stage 1’s (7,000 EGP): the pay rises from stage to stage (Labour Law Art. 29).',
      ]);
      expect(messageOf(await postHire(e.id, job, { traineeStages: [{ name: '', months: 0.5, pay: 4000 }] }).expect(400))).toEqual([
        'Training stage 1 needs a name.',
        'Training stage 1’s length must be a whole number of months, 1 or more.',
      ]);
      expect(messageOf(await postHire(e.id, job, { traineeStages: STAGES, payBasis: 'hourly', hourlyRate: 50, hoursPerWeek: 20 }).expect(400))).toBe(
        'A trainee is paid by the training stages, a month each: choose a monthly salary.',
      );
      expect(messageOf(await postHire(e.id, job, { traineeStages: STAGES, form: 'open_ended' }).expect(400))).toBe(
        'A trainee’s training agreement runs for the training’s length, which its stages set (Labour Law Art. 29): leave the contract fixed-term.',
      );

      // too young on the start date (Art. 28)
      const young = await addEmployee('Yara Young', { dateOfBirth: '2012-10-02' });
      expect(messageOf(await postHire(young.id, job, { traineeStages: STAGES }).expect(400))).toEqual([
        'A trainee must be at least 14 years old on the start date (Labour Law Art. 28): this one would be 13.',
      ]);

      // the minimum wage set for the year (the Super Admin, Payroll Setup): the last stage at least that
      const rates = normalLawRates(lawRatesFor(2026));
      const { year: _year, ...sent } = rates;
      const set = await api().put('/api/payroll/law-rates/2026').set('Cookie', superAdmin).send({ ...sent, minimumWage: 7500 }).expect(200);
      expect(set.body.minimumWage).toBe(7500);
      expect(((await api().get('/api/payroll/law-rates').set('Cookie', hr).expect(200)).body as { year: number; minimumWage: number | null }[]).find((y) => y.year === 2026)!.minimumWage).toBe(7500);
      await api().put('/api/payroll/law-rates/2026').set('Cookie', hr).send({ ...sent, minimumWage: 1 }).expect(403);
      expect(messageOf(await postHire(e.id, job, { traineeStages: STAGES }).expect(400))).toEqual([
        'The last training stage’s pay (7,000 EGP) must be at least the minimum wage, 7,500 EGP (Labour Law Art. 29).',
      ]);
      expect(await prisma.employment.count({ where: { employeeId: e.id } })).toBe(0);

      // as the law has it: the gross is the first stage's pay, the term the stages' months together
      const stages = [STAGES[0], { ...STAGES[1], pay: 7500 }];
      const profile = (await postHire(e.id, job, { traineeStages: stages, grossSalary: 99999 }).expect(201)).body as Profile;
      const [draft] = await contractsOf(e.id, profile.employment!.id);
      expect(draft).toMatchObject({ form: 'fixed', grossSalary: 4000, durationMonths: 6, startDate: '2026-10-01', endDate: '2027-03-31', traineeStages: stages, traineeMonths: 6 });
      expect(draft.traineeStage).toEqual({ number: 1, name: 'Basics', pay: 4000 });
      // the stages' pay is salary data: the audit log only says they were set
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'contract', entityId: draft.id, action: 'create' } });
      expect(audit?.diff).toMatchObject({ form: 'fixed', durationMonths: 6, grossSalary: 'changed', traineeStages: 'changed' });
      expect(await sign(draft)).toMatchObject({ status: 'active' });

      // stages are a trainee's only; a trainee's pay follows them, not a raise
      const other = await addEmployee('Fatma Fulltime');
      expect(messageOf(await postHire(other.id, {}, { traineeStages: STAGES }).expect(400))).toBe('Training stages are for a trainee’s training agreement only.');
      const raise = await api()
        .post(`/api/employees/${e.id}/employments/${profile.employment!.id}/raises`)
        .set('Cookie', hr)
        .send({ way: 'amendment', effectiveDate: '2026-12-01', grossSalary: 5000, reason: 'annual' })
        .expect(400);
      expect(messageOf(raise)).toBe('A trainee is paid by the stages of the training agreement (Labour Law Art. 29): to change the pay, add a new training agreement with new stages.');
    });
  });

  describe('freelance, outside the labour law', () => {
    it('has no annual leave and can’t have leave recorded', async () => {
      const f = await hire('Farid Freelance', { employmentType: 'freelance', joinDate: '2025-01-01' });
      expect(f.profile.employment).toMatchObject({ employmentType: 'freelance', underLabourLaw: false });
      const unpaid = await prisma.leaveType.findUniqueOrThrow({ where: { key: 'unpaid' }, select: { id: true } });
      const refused = await api()
        .post('/api/leave/requests')
        .set('Cookie', hr)
        .field('employeeId', f.id)
        .field('typeId', unpaid.id)
        .field('startDate', '2026-11-02')
        .field('endDate', '2026-11-03')
        .expect(400);
      expect(messageOf(refused)).toEqual([`Farid Freelance ${RUN} is a freelancer, outside the labour law: there is no leave to record for a freelance employment.`]);
      const leave = (await api().get(`/api/employees/${f.id}/leave`).set('Cookie', hr).expect(200)).body as { annual: { entitlement: number; available: number } };
      expect(leave.annual).toMatchObject({ entitlement: 0, available: 0 });
      // a full-time employee of the same service has the law's days
      const ft = await hire('Fawzy Fulltime', { joinDate: '2025-01-01' });
      expect(((await api().get(`/api/employees/${ft.id}/leave`).set('Cookie', hr).expect(200)).body as { annual: { entitlement: number } }).annual.entitlement).toBeGreaterThan(0);
    });
  });

  describe('the commission templates', () => {
    it('are chosen for one paid by commission once published, the full-time ones otherwise', async () => {
      const commission = await hire('Kamal Commission', { paidByCommission: true });
      const plain = await hire('Paula Plain');
      const contractSlots = async (id: string) => {
        const tab = (await api().get(`/api/employees/${id}/documents`).set('Cookie', hr).expect(200)).body as { sections: { key: string; items: { slotKey: string }[] }[] };
        return tab.sections.find((s) => s.key === 'contract')!.items.map((i) => i.slotKey);
      };
      // nothing published for commission yet: the full-time contract
      expect(await contractSlots(commission.id)).toEqual(expect.arrayContaining(['contract_full_time']));
      expect(await contractSlots(commission.id)).not.toContain('contract_sales');

      await publish('contract_sales');
      expect(await contractSlots(commission.id)).toEqual(expect.arrayContaining(['contract_sales', 'contract_full_time_insurance']));
      expect(await contractSlots(commission.id)).not.toContain('contract_full_time');
      expect(await contractSlots(plain.id)).toContain('contract_full_time');
      expect(await contractSlots(plain.id)).not.toContain('contract_sales');
      const check = (id: string, slotKey: string, contractId: string) => api().get(`/api/employees/${id}/documents/check`).query({ slotKey, contractId }).set('Cookie', hr);
      expect(messageOf(await check(commission.id, 'contract_full_time', commission.contract.id).expect(400))).toBe(
        `Kamal Commission ${RUN} is paid by commission: choose Contract · Full-time, paid by commission.`,
      );
      expect(messageOf(await check(plain.id, 'contract_sales', plain.contract.id).expect(400))).toBe(
        `Contract · Full-time, paid by commission is for a full-time employment paid by commission; Paula Plain ${RUN}’s isn’t. Choose Contract · Full-time (official copy).`,
      );
      await check(commission.id, 'contract_sales', commission.contract.id).expect(200);

      // a job offer paid by commission: full-time only, its template the commission one once published
      const offer = (body: object) =>
        api()
          .post('/api/offers')
          .set('Cookie', hr)
          .send({ fullNameEn: `Omar Offer ${RUN}`, fullNameAr: 'عمر', email: `omar.offer.${RUN}@mail.test`, employmentType: 'full_time', joinDate: addDays(today, 30), grossSalary: 15000, ...body });
      expect(messageOf(await offer({ employmentType: 'part_time', paidByCommission: true }).expect(400))).toBe(
        'Paid by commission is for a full-time offer only. Choose Full-time, or leave paid by commission off.',
      );
      const draft = (await offer({ paidByCommission: true, workNature: 'temporary' }).expect(201)).body;
      offers.push(draft.id);
      expect(draft).toMatchObject({ paidByCommission: true, workNature: 'temporary', workPattern: 'on_site' });
      expect(draft.template).toMatchObject({ slotKey: 'offer_full_time' });
      await publish('offer_sales');
      const now = (await api().get(`/api/offers/${draft.id}`).set('Cookie', hr).expect(200)).body;
      expect(now.template).toMatchObject({ slotKey: 'offer_sales', name: 'Job offer · Full-time, paid by commission', status: 'published' });
      // changed to another type: no longer paid by commission
      expect((await api().patch(`/api/offers/${draft.id}`).set('Cookie', hr).send({ employmentType: 'trainee' }).expect(200)).body).toMatchObject({
        employmentType: 'trainee',
        paidByCommission: false,
        // the trainee's own offer since 19 October 2026 (offer_internship is the unpaid intern's)
        template: { slotKey: 'offer_trainee', name: 'Job offer · Trainee' },
      });
    });
  });

  describe('a fixed term the company doesn’t renew (Art. 154)', () => {
    it('carries the law’s note and an estimate on the ending: years of service × the last monthly wage', async () => {
      const joinDate = addMonths(today, -12);
      const e = await hire('Nabil Nonrenewal', { joinDate }, { durationMonths: 24, grossSalary: 15000 });
      const signed = await sign(e.contract);
      const res = await api().post(`/api/employees/${e.id}/employments/${e.employmentId}/endings`).set('Cookie', hr).send({ ruleKey: 'non_renewal', noticeGivenOn: today }).expect(201);
      expect(res.body).toMatchObject({
        ruleKey: 'non_renewal',
        lastWorkingDay: signed.endDate,
        art154Note: "Under Art. 154 the employee may be owed one month's wage for each year of service — check with your lawyer",
        art154Estimate: { serviceYears: 2, lastMonthlyWage: 15000, amount: 30000 },
      });
      // the CEO's queue says it too; no money is moved
      const queue = (await api().get('/api/endings?status=pending_ceo').set('Cookie', ceo).expect(200)).body as { id: string; art154Estimate: unknown }[];
      expect(queue.find((x) => x.id === res.body.id)).toMatchObject({ art154Estimate: { serviceYears: 2, amount: 30000 } });
      expect(await prisma.payrollAdjustment.count({ where: { employeeId: e.id } })).toBe(0);
      // the profile's ending says it too (the amounts only for those who see salaries: views.ts art154Estimate)
      const seen = (await api().get(`/api/employees/${e.id}`).set('Cookie', hr).expect(200)).body as { employment: { ending: { art154Note: string; art154Estimate: unknown } } };
      expect(seen.employment.ending).toMatchObject({ art154Note: expect.stringContaining('Art. 154'), art154Estimate: { serviceYears: 2, lastMonthlyWage: 15000, amount: 30000 } });
    });
  });

  describe('reimbursement types', () => {
    it('are limited to the employment types', async () => {
      const create = (employmentTypes: string[]) => api().post('/api/reimbursement-types').set('Cookie', hr).send({ nameEn: `Law ${RUN} ${employmentTypes.join(' ')}`, nameAr: 'نوع', employmentTypes });
      expect(messageOf(await create(['sales']).expect(400))).toEqual(['Choose the employment types from: full_time, part_time, trainee, intern, freelance; [] for every employment type.']);
      const made = (await create(['trainee', 'full_time']).expect(201)).body;
      reimbursementTypes.push(made.id);
      expect(made.employmentTypes).toEqual(['trainee', 'full_time']);
    });
  });
});
