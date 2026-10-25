import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { INTERN_NO_WAGE_MESSAGE, INTERN_TERM_MESSAGE, NO_PROBATION_MESSAGE, RENEWED_ONCE_MESSAGE, trainingAgainFrom, trainingTooSoonMessage } from '@trendlix/shared';
import pg from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, addMonths, shownDate, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';
import { assertTestDatabase } from './test-env.js';

// Trainees and interns (owner, 19 October 2026). On the Employees list showing a trainee as Probation: "interns to be
// labeled trainees instead of probation and their contracts are never renewed", then "or can be only renewed 1 time,
// after that it should be converted to a full time contract. a new trainee contract can be issued after 6 months of the
// expiration of the last trainee contract"; and "in case of trainee, we are not paying them salary, its just
// transportation allowance" (the unpaid internship, outside the labour law). Since 25 October 2026 the intern is the one
// trainee (owner: "unpaid internship and training are the same thing .. keep the unpaid internship with its document and
// delete the trainee with its documents"): the rules hold for interns, and the paid trainee is refused. The migration of
// 19 October 2026 is replayed as it ran. Dates that depend on today are counted from today in Cairo. Everyone here is
// invented, and deleted at the end.

const RUN = Date.now().toString(36).toLowerCase();
const MIGRATIONS = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
const MIGRATION = '20261019170000_trainees_and_interns';
const SCHEMA = 'trainees_interns_check';

interface Contract {
  id: string;
  number: string;
  version: number;
  status: string;
  startDate: string;
  endDate: string | null;
  [key: string]: unknown;
}

interface Profile {
  id: string;
  fullNameEn: string;
  employment: ({ id: string; [key: string]: unknown } & Record<string, unknown>) | null;
  [key: string]: unknown;
}

const TYPE_MESSAGE = 'Choose an employment type: full_time, part_time, intern (an unpaid internship, outside the labour law; a trainee is an intern now) or freelance (outside the labour law).';

describe('Trainees and interns (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let superAdmin: string;
  let transportId: string;
  const today = todayInCairo();
  const api = () => request(app.getHttpServer());
  /** Everyone this file adds, deleted at the end with what was made for them. */
  const added: string[] = [];
  const offers: string[] = [];

  async function addEmployee(name: string, extra: object = {}): Promise<Profile> {
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'متدرب تجريبي', ...extra }).expect(201);
    added.push(res.body.id);
    return res.body as Profile;
  }

  const postHire = (employeeId: string, employment: object, contract: object = {}) =>
    api()
      .post(`/api/employees/${employeeId}/hire`)
      .set('Cookie', hr)
      .send({ employment: { employmentType: 'full_time', joinDate: today, ...employment }, contract });

  /** Hired in one form: the profile, its current employment and the draft contract made with it. */
  async function hire(name: string, employment: object, contract: object = {}) {
    const e = await addEmployee(name);
    const profile = (await postHire(e.id, employment, contract).expect(201)).body as Profile;
    const [draft] = await contractsOf(e.id, profile.employment!.id);
    return { id: e.id, name: `${name} ${RUN}`, employmentId: profile.employment!.id, profile, contract: draft };
  }

  const contractsOf = async (employeeId: string, employmentId: string) =>
    (await api().get(`/api/employees/${employeeId}/employments/${employmentId}/contracts`).set('Cookie', hr).expect(200)).body as Contract[];
  const profileOf = async (id: string) => (await api().get(`/api/employees/${id}`).set('Cookie', hr).expect(200)).body as Profile;
  const listed = async (id: string) =>
    ((await api().get('/api/employees').set('Cookie', hr).expect(200)).body as { id: string; standing: string }[]).find((r) => r.id === id);
  const sign = async (c: Contract) =>
    (await api().post(`/api/contracts/${c.id}/sign`).set('Cookie', hr).send({ signedOn: c.startDate <= today ? c.startDate : today }).expect(200)).body as Contract;
  const draftVersion = (h: { id: string; employmentId: string }, body: object) => api().post(`/api/employees/${h.id}/employments/${h.employmentId}/contracts`).set('Cookie', hr).send(body);
  const messageOf = (res: request.Response) => res.body.message as string | string[];
  const expiring = async () => (await api().get('/api/contracts/expiring?within=365').set('Cookie', hr).expect(200)).body as Record<string, unknown>[];
  const lawWarnings = async () => (await api().get('/api/contracts/law-warnings').set('Cookie', hr).expect(200)).body as Record<string, unknown>[];
  const probationEnding = async () =>
    ((await api().get('/api/employments/probation-ending?within=365').set('Cookie', hr).expect(200)).body as { employmentId: string }[]).map((p) => p.employmentId);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    // the transportation allowance an intern is paid (owner, 19 October 2026), untaxed and not insured
    transportId = (await api().post('/api/allowance-types').set('Cookie', superAdmin).send({ nameEn: `Transport ${RUN}`, nameAr: 'بدل انتقال', taxable: false, insured: false }).expect(201)).body.id;
  });

  afterAll(async () => {
    await prisma.jobOffer.deleteMany({ where: { id: { in: offers } } });
    await prisma.employment.updateMany({ where: { employeeId: { in: added } }, data: { managerId: null } });
    await prisma.employee.deleteMany({ where: { id: { in: added } } });
    await prisma.allowanceType.deleteMany({ where: { id: transportId } });
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

    it('makes yesterday’s trainees without stages unpaid interns, takes probation from trainees and interns, and adds the ending', async () => {
      // the migrations before it, in a schema of their own, then the data as it was, then the migration
      await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; SET search_path TO ${SCHEMA}`);
      for (const m of readdirSync(MIGRATIONS).filter((m) => /^\d{14}_/.test(m) && m < MIGRATION).sort()) await db.query(sql(m));
      const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
      const stages = JSON.stringify([{ name: 'Basics', months: 6, pay: 7500 }]);
      await db.query(`
        INSERT INTO employees (id, employee_code, full_name_en, full_name_ar, updated_at) VALUES
          ('${id(101)}', 'EMP-0101', 'Tamer Trainee', 'تامر', now()),
          ('${id(102)}', 'EMP-0102', 'Ines Intern', 'إيناس', now()),
          ('${id(103)}', 'EMP-0103', 'Ola Old Intern', 'علا', now()),
          ('${id(104)}', 'EMP-0104', 'Fadi Fulltime', 'فادي', now());
        INSERT INTO employments (id, employee_id, employment_type, status, join_date, probation_end, end_date, end_reason, updated_at) VALUES
          ('${id(1)}', '${id(101)}', 'trainee', 'probation', '2026-09-01', '2026-11-30', NULL, NULL, now()),
          ('${id(2)}', '${id(102)}', 'trainee', 'probation', '2026-09-15', '2026-12-14', NULL, NULL, now()),
          ('${id(3)}', '${id(103)}', 'trainee', 'terminated', '2025-03-01', '2025-05-31', '2025-08-31', 'contract_ended', now()),
          ('${id(4)}', '${id(104)}', 'full_time', 'probation', '2026-09-01', '2026-11-30', NULL, NULL, now());
        INSERT INTO contracts (id, number, employment_id, version, start_date, end_date, duration_months, probation_months, probation_end,
            gross_salary, insured_salary, net_salary, pay_basis, hourly_rate, hours_per_week, status, trainee_stages, updated_at) VALUES
          ('${id(11)}', 'CON-2026-0101', '${id(1)}', 1, '2026-09-01', '2027-02-28', 6, 3, '2026-11-30', 7500, 7500, NULL, 'monthly', NULL, NULL, 'active', '${stages}', now()),
          ('${id(12)}', 'CON-2026-0102', '${id(2)}', 1, '2026-09-15', '2027-09-14', 12, 3, '2026-12-14', 5000, 5000, 4500, 'hourly', 48.08, 24, 'active', NULL, now()),
          ('${id(13)}', 'CON-2025-0103', '${id(3)}', 1, '2025-03-01', '2026-02-28', 12, 3, '2025-05-31', 4000, 4000, NULL, 'monthly', NULL, NULL, 'ended', NULL, now()),
          ('${id(14)}', 'CON-2026-0104', '${id(4)}', 1, '2026-09-01', '2027-08-31', 12, 3, '2026-11-30', 15000, 14500, NULL, 'monthly', NULL, NULL, 'active', NULL, now());
        INSERT INTO allowance_types (id, name_en, name_ar, taxable, insured, updated_at) VALUES ('${id(51)}', 'Transport', 'انتقال', false, false, now());
        INSERT INTO contract_allowances (id, contract_id, allowance_type_id, name_en, name_ar, taxable, insured, amount) VALUES
          ('${id(52)}', '${id(12)}', '${id(51)}', 'Transport', 'انتقال', false, false, 1500);
        INSERT INTO job_offers (id, number, full_name_en, full_name_ar, email, employment_type, join_date, gross_salary, probation_months, status, expires_on, updated_at) VALUES
          ('${id(31)}', 'OFF-2026-0101', 'Dina Draft', 'دينا', 'dina@mail.test', 'trainee', '2026-11-01', 4000, 3, 'draft', '2026-10-30', now()),
          ('${id(32)}', 'OFF-2026-0102', 'Sami Sent', 'سامي', 'sami@mail.test', 'trainee', '2026-11-01', 4000, 3, 'sent', '2026-10-30', now()),
          ('${id(33)}', 'OFF-2026-0103', 'Fawzy Full', 'فوزي', 'fawzy@mail.test', 'full_time', '2026-11-01', 9000, 3, 'draft', '2026-10-30', now());
        INSERT INTO reimbursement_types (id, name_en, name_ar, employment_types, updated_at) VALUES
          ('${id(41)}', 'Books', 'كتب', ARRAY['trainee', 'part_time'], now()),
          ('${id(42)}', 'Fuel', 'وقود', ARRAY['full_time'], now());
        INSERT INTO payroll_runs (id, month, rules, updated_at) VALUES ('${id(21)}', '2026-09-01', '{}', now());
        INSERT INTO payroll_lines (id, run_id, employee_id, employment_id, contract_id, employee_code, name_en, employment_type, pay_basis, terms, inputs, result,
            earned, allowances, employee_insurance, employer_insurance, monthly_tax, martyrs_fund, deductions, net, released, transfer, company_cost, updated_at)
          VALUES ('${id(22)}', '${id(21)}', '${id(102)}', '${id(2)}', '${id(12)}', 'EMP-0102', 'Ines Intern', 'trainee', 'hourly', '{}', '{}', '{}',
            2500, 750, 0, 0, 0, 0, 0, 3250, 0, 3250, 3250, now());
      `);

      expect(sql(MIGRATION)).not.toMatch(/ON\s+COMMIT\s+DROP/i);
      await db.query(sql(MIGRATION));

      const rows = async (query: string) => (await db.query(query)).rows;
      // the trainee with training stages stays a trainee; the ones without are the owner's unpaid interns; no probation
      expect(await rows('SELECT right(id::text, 1) AS id, employment_type AS type, status, probation_end::text FROM employments ORDER BY id')).toEqual([
        { id: '1', type: 'trainee', status: 'active', probation_end: null },
        { id: '2', type: 'intern', status: 'active', probation_end: null },
        { id: '3', type: 'intern', status: 'terminated', probation_end: null },
        { id: '4', type: 'full_time', status: 'probation', probation_end: '2026-11-30' },
      ]);
      // an intern's agreement pays no wage, monthly, nothing insured, the allowance kept; the probation gone
      expect(
        await rows(`SELECT number, gross_salary::float AS gross, insured_salary::float AS insured, net_salary, pay_basis, hourly_rate, hours_per_week,
          probation_months, probation_end::text FROM contracts ORDER BY number`),
      ).toEqual([
        { number: 'CON-2025-0103', gross: 0, insured: 0, net_salary: null, pay_basis: 'monthly', hourly_rate: null, hours_per_week: null, probation_months: 0, probation_end: null },
        { number: 'CON-2026-0101', gross: 7500, insured: 7500, net_salary: null, pay_basis: 'monthly', hourly_rate: null, hours_per_week: null, probation_months: 0, probation_end: null },
        { number: 'CON-2026-0102', gross: 0, insured: 0, net_salary: null, pay_basis: 'monthly', hourly_rate: null, hours_per_week: null, probation_months: 0, probation_end: null },
        {
          number: 'CON-2026-0104',
          gross: 15000,
          insured: 14500,
          net_salary: null,
          pay_basis: 'monthly',
          hourly_rate: null,
          hours_per_week: null,
          probation_months: 3,
          probation_end: '2026-11-30',
        },
      ]);
      expect(await rows('SELECT amount::float AS amount FROM contract_allowances')).toEqual([{ amount: 1500 }]);
      // a draft trainee offer offers no probation; a sent one stays as it was sent
      expect(await rows('SELECT number, employment_type AS type, probation_months FROM job_offers ORDER BY number')).toEqual([
        { number: 'OFF-2026-0101', type: 'trainee', probation_months: 0 },
        { number: 'OFF-2026-0102', type: 'trainee', probation_months: 3 },
        { number: 'OFF-2026-0103', type: 'full_time', probation_months: 3 },
      ]);
      // who may claim: the trainees' types given to interns too
      expect(await rows('SELECT name_en AS name, employment_types AS types FROM reimbursement_types ORDER BY name_en')).toEqual([
        { name: 'Books', types: ['trainee', 'part_time', 'intern'] },
        { name: 'Fuel', types: ['full_time'] },
      ]);
      // the payroll line's copy of the type, as the line was made
      expect(await rows('SELECT employment_type AS type FROM payroll_lines')).toEqual([{ type: 'trainee' }]);
      // the type has the five values, and the old one is gone
      const labels = await rows(`
        SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = '${SCHEMA}' AND t.typname = 'employment_type' ORDER BY e.enumsortorder`);
      expect(labels.map((l) => l.label)).toEqual(['full_time', 'part_time', 'trainee', 'intern', 'freelance']);
      expect(await rows(`SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = '${SCHEMA}' AND t.typname = 'employment_type_before_interns'`)).toEqual([]);
      // how a training or internship agreement ends with its term
      expect(await rows(`SELECT key, label, initiator, notice_amount, notice_unit, pay_in_lieu, end_reason, source, active, sort_order FROM ending_rules WHERE key = 'training_completed'`)).toEqual([
        {
          key: 'training_completed',
          label: 'Training completed',
          initiator: 'none',
          notice_amount: 0,
          notice_unit: 'days',
          pay_in_lieu: false,
          end_reason: 'training_completed',
          source: 'Labour Law Arts. 28–30; the internship agreement',
          active: true,
          sort_order: 12,
        },
      ]);
      expect(await rows('SELECT converts_to FROM contracts GROUP BY converts_to')).toEqual([{ converts_to: null }]);

      // the database refuses what the rules refuse
      await expect(db.query(`UPDATE employments SET paid_by_commission = true WHERE id = '${id(2)}'`)).rejects.toThrow(/employments_paid_by_commission_check/);
      await expect(db.query(`UPDATE contracts SET converts_to = 'part_time' WHERE id = '${id(14)}'`)).rejects.toThrow(/contracts_converts_to_check/);
      // version 1 is never a conversion
      await expect(db.query(`UPDATE contracts SET converts_to = 'full_time' WHERE id = '${id(14)}'`)).rejects.toThrow(/contracts_converts_to_check/);
      await expect(db.query(`UPDATE reimbursement_types SET employment_types = ARRAY['sales'] WHERE name_en = 'Fuel'`)).rejects.toThrow(/reimbursement_types_employment_types_check/);
      await db.query(`UPDATE reimbursement_types SET employment_types = ARRAY['intern'] WHERE name_en = 'Fuel'`);
      await db.query(`UPDATE employments SET employment_type = 'intern' WHERE id = '${id(4)}'`);
    });
  });

  describe('a trainee', () => {
    it('is refused: an intern now, the unpaid internship (owner, 25 October 2026)', async () => {
      const t = await addEmployee('Tala Trainee');
      expect(messageOf(await postHire(t.id, { employmentType: 'trainee' }, { grossSalary: 8000 }).expect(400))).toEqual([TYPE_MESSAGE]);
      // nor its training stages, for anyone
      await postHire(t.id, { employmentType: 'intern' }, { traineeStages: [{ name: 'Basics', months: 3, pay: 4000 }] }).expect(400);
      expect(await prisma.employment.count({ where: { employeeId: t.id } })).toBe(0);
      // nor later, on an employment of another type
      const f = await hire('Tina Typed', { joinDate: today }, { grossSalary: 12000 });
      const path = `/api/employees/${f.id}/employments/${f.employmentId}`;
      expect(messageOf(await api().patch(path).set('Cookie', hr).send({ employmentType: 'trainee' }).expect(400))).toEqual([TYPE_MESSAGE]);
      expect((await profileOf(f.id)).employment).toMatchObject({ employmentType: 'full_time' });
      // nor in the company-wide list's filter
      expect(messageOf(await api().get('/api/contracts?type=trainee').set('Cookie', hr).expect(400))).toEqual([TYPE_MESSAGE]);
    });
  });

  describe('an intern’s standing', () => {
    it('stands as Intern, with no probation, and is left out of the probations ending', async () => {
      const t = await addEmployee('Tala Intern');
      const job = { employmentType: 'intern', joinDate: addMonths(today, -1) };
      expect(messageOf(await postHire(t.id, job, { probationMonths: 2 }).expect(400))).toBe(NO_PROBATION_MESSAGE);
      expect(await prisma.employment.count({ where: { employeeId: t.id } })).toBe(0);

      const profile = (await postHire(t.id, job).expect(201)).body as Profile;
      expect(profile.employment).toMatchObject({ employmentType: 'intern', status: 'active', probationEnd: null });
      const [draft] = await contractsOf(t.id, profile.employment!.id);
      expect(draft).toMatchObject({ probationMonths: 0, probationEnd: null, training: { agreement: 1, next: 'renew_or_convert' }, convertsTo: null });
      expect(await listed(t.id)).toMatchObject({ standing: 'intern' });
      const signed = await sign(draft);
      expect(signed).toMatchObject({ status: 'active', probationEnd: null, nonRenewalNoticeBy: null, becameOpenEnded: false });
      expect((await profileOf(t.id)).employment).toMatchObject({ status: 'active', probationEnd: null });
      expect(await listed(t.id)).toMatchObject({ standing: 'intern' });
      const missing = (await api().get('/api/employees/missing').set('Cookie', hr).expect(200)).body as { rows: { id: string; standing: string }[] };
      expect(missing.rows.find((r) => r.id === t.id)).toMatchObject({ standing: 'intern' });

      // even one left on Probation from before 19 October 2026: Intern, never on the probation list, nothing to confirm
      await prisma.employment.update({ where: { id: profile.employment!.id }, data: { status: 'probation', probationEnd: new Date(`${addDays(today, 10)}T00:00:00.000Z`) } });
      expect(await listed(t.id)).toMatchObject({ standing: 'intern' });
      expect(await probationEnding()).not.toContain(profile.employment!.id);
      const confirm = await api().post(`/api/employees/${t.id}/employments/${profile.employment!.id}/confirm-probation`).set('Cookie', hr).expect(409);
      expect(messageOf(confirm)).toBe(`Tala Intern ${RUN} is an intern: an internship agreement has no probation, so there is nothing to confirm.`);
      // an edit of the employment puts it right: Active, no probation end; or HR chooses On leave straight away
      await api().patch(`/api/employees/${t.id}/employments/${profile.employment!.id}`).set('Cookie', hr).send({ status: 'on_leave' }).expect(200);
      expect((await profileOf(t.id)).employment).toMatchObject({ status: 'on_leave', probationEnd: null });
      expect(await listed(t.id)).toMatchObject({ standing: 'on_leave' });
      await prisma.employment.update({ where: { id: profile.employment!.id }, data: { status: 'probation' } });
      await api().patch(`/api/employees/${t.id}/employments/${profile.employment!.id}`).set('Cookie', hr).send({ workArrangement: 'office' }).expect(200);
      expect((await profileOf(t.id)).employment).toMatchObject({ status: 'active', probationEnd: null });

      // a manager's direct reports show where each stands
      const boss = await hire('Badr Boss', { joinDate: addMonths(today, -12) }, { grossSalary: 20000 });
      await api().patch(`/api/employees/${t.id}/employments/${profile.employment!.id}`).set('Cookie', hr).send({ managerId: boss.id }).expect(200);
      expect(((await profileOf(boss.id)).reports as { id: string; standing: string }[]).find((r) => r.id === t.id)).toMatchObject({ status: 'active', standing: 'intern' });

      // a full-time hire is on probation, and on the list, as before
      const f = await hire('Fady Fulltime', { joinDate: today }, { grossSalary: 12000 });
      expect(f.profile.employment).toMatchObject({ status: 'probation' });
      expect(await listed(f.id)).toMatchObject({ standing: 'probation' });
      expect(await probationEnding()).toContain(f.employmentId);
    });
  });

  describe('an intern (the unpaid internship)', () => {
    it('is paid no wage, only allowances, on a short fixed term, with no probation, and stands as Intern', async () => {
      const i = await addEmployee('Iman Intern');
      const job = { employmentType: 'intern', joinDate: today };
      const transport = [{ allowanceTypeId: transportId, amount: 1500 }];
      expect(messageOf(await postHire(i.id, job, { grossSalary: 3000 }).expect(400))).toBe(INTERN_NO_WAGE_MESSAGE);
      expect(messageOf(await postHire(i.id, job, { durationMonths: 13 }).expect(400))).toBe(INTERN_TERM_MESSAGE);
      expect(messageOf(await postHire(i.id, job, { payBasis: 'hourly', hourlyRate: 50, hoursPerWeek: 20 }).expect(400))).toBe(
        'An intern is paid no wage, so not by the hour: leave the pay monthly, the gross at 0.',
      );
      expect(messageOf(await postHire(i.id, job, { form: 'open_ended' }).expect(400))).toBe(`An intern’s internship agreement is a short fixed term: leave the contract fixed-term. ${INTERN_TERM_MESSAGE}`);
      expect(messageOf(await postHire(i.id, job, { probationMonths: 1 }).expect(400))).toBe(NO_PROBATION_MESSAGE);

      const profile = (await postHire(i.id, job, { allowances: transport }).expect(201)).body as Profile;
      expect(profile.employment).toMatchObject({ employmentType: 'intern', status: 'active', probationEnd: null, underLabourLaw: false });
      const [draft] = await contractsOf(i.id, profile.employment!.id);
      expect(draft).toMatchObject({
        form: 'fixed',
        durationMonths: 3,
        startDate: today,
        endDate: addDays(addMonths(today, 3), -1),
        payBasis: 'monthly',
        grossSalary: 0,
        insuredSalary: 0,
        allowancesTotal: 1500,
        totalSalary: 1500,
        probationMonths: 0,
        training: { agreement: 1, next: 'renew_or_convert' },
      });
      expect(await listed(i.id)).toMatchObject({ standing: 'intern' });
      // a draft takes no gross either
      expect(messageOf(await api().patch(`/api/contracts/${draft.id}`).set('Cookie', hr).send({ grossSalary: 2000 }).expect(400))).toBe(INTERN_NO_WAGE_MESSAGE);
      expect((await api().patch(`/api/contracts/${draft.id}`).set('Cookie', hr).send({ durationMonths: 6 }).expect(200)).body).toMatchObject({ durationMonths: 6, grossSalary: 0 });
      // the company-wide list finds interns
      const interns = (await api().get('/api/contracts?type=intern').set('Cookie', hr).expect(200)).body as { id: string; training: unknown }[];
      expect(interns.find((c) => c.id === draft.id)).toMatchObject({ training: { agreement: 1, next: 'renew_or_convert' } });
    });
  });

  describe('an agreement renewed once, then converted to full-time', () => {
    it('is reminded of as training ending, renewed once, refused a second renewal, and converted on the same employment', async () => {
      const transport = [{ allowanceTypeId: transportId, amount: 1500 }];
      const i = await hire('Rana Renewed', { employmentType: 'intern', joinDate: addMonths(today, -5) }, { allowances: transport });
      const v1 = await sign(i.contract);
      const v1End = addDays(addMonths(today, -2), -1);
      expect(v1).toMatchObject({ endDate: v1End, training: { agreement: 1, next: 'renew_or_convert' }, nonRenewalNoticeBy: null, becameOpenEnded: false });

      // past its end, not renewed: "internship ended", never the Art. 88 warning
      const warnings = await lawWarnings();
      expect(warnings.filter((w) => w.contractId === v1.id)).toEqual([
        {
          kind: 'training_ended',
          employee: { id: i.id, employeeCode: expect.any(String), fullNameEn: i.name },
          employmentId: i.employmentId,
          contractId: v1.id,
          contractNumber: v1.number,
          since: v1End,
          message: `${v1.number}: Internship ended on ${shownDate(v1End)}: renew it once, or convert to full-time.`,
        },
      ]);
      expect((await expiring()).find((c) => c.id === v1.id)).toMatchObject({
        endDate: v1End,
        nonRenewalNoticeBy: null,
        becameOpenEnded: false,
        renewalDraft: false,
        conversionDraft: false,
        training: { agreement: 1, next: 'renew_or_convert' },
      });

      // renewed once: the day after it ends, the internship's 3 months
      const renewal = (await draftVersion(i, {}).expect(201)).body as Contract;
      expect(renewal).toMatchObject({ version: 2, startDate: addDays(v1End, 1), durationMonths: 3, grossSalary: 0, allowancesTotal: 1500, raise: null, training: { agreement: 2, next: 'convert_or_end' } });
      expect((await expiring()).find((c) => c.id === v1.id)).toMatchObject({ renewalDraft: true, conversionDraft: false });
      const v2 = await sign(renewal);
      expect((await lawWarnings()).some((w) => w.employmentId === i.employmentId)).toBe(false);
      expect((await expiring()).find((c) => c.id === v2.id)).toMatchObject({ nonRenewalNoticeBy: null, training: { agreement: 2, next: 'convert_or_end' } });

      // not a second time
      expect(messageOf(await draftVersion(i, {}).expect(409))).toBe(RENEWED_ONCE_MESSAGE);

      // converted to a full-time contract: the employment's next version, with an employment contract's probation
      const conversion = (await draftVersion(i, { convertsTo: 'full_time', grossSalary: 9000, probationMonths: 2 }).expect(201)).body as Contract;
      const start = addDays(v2.endDate!, 1);
      expect(conversion).toMatchObject({
        version: 3,
        convertsTo: 'full_time',
        form: 'fixed',
        startDate: start,
        durationMonths: 12,
        endDate: addDays(addMonths(start, 12), -1),
        probationMonths: 2,
        probationEnd: addDays(addMonths(start, 2), -1),
        grossSalary: 9000,
        allowancesTotal: 1500,
        raise: null,
        training: null,
      });
      expect((await expiring()).find((c) => c.id === v2.id)).toMatchObject({ renewalDraft: false, conversionDraft: true });
      // the draft is changed as a full-time contract: its probation too
      expect((await api().patch(`/api/contracts/${conversion.id}`).set('Cookie', hr).send({ probationMonths: 3, grossSalary: 9500 }).expect(200)).body).toMatchObject({
        probationMonths: 3,
        grossSalary: 9500,
        raise: null,
      });

      // signed: the same employment is full-time now, on probation while it runs
      const signed = await sign(conversion);
      expect(signed).toMatchObject({ status: 'active', convertsTo: 'full_time' });
      const after = await profileOf(i.id);
      expect(after.employment).toMatchObject({ id: i.employmentId, employmentType: 'full_time', status: 'probation', probationEnd: addDays(addMonths(start, 3), -1) });
      expect(await listed(i.id)).toMatchObject({ standing: 'probation' });
      expect(await probationEnding()).toContain(i.employmentId);
      expect((await contractsOf(i.id, i.employmentId)).map((c) => [c.version, c.status])).toEqual([
        [3, 'active'],
        [2, 'superseded'],
        [1, 'superseded'],
      ]);
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'employment', entityId: i.employmentId, action: 'update' }, orderBy: { id: 'desc' } });
      expect(audit?.diff).toMatchObject({ contract: signed.number, employmentType: { from: 'intern', to: 'full_time' }, status: { from: 'active', to: 'probation' } });

      // a signing undone: an intern again, Active, the renewal in force
      await api().post(`/api/contracts/${signed.id}/unsign`).set('Cookie', superAdmin).expect(200);
      expect((await profileOf(i.id)).employment).toMatchObject({ employmentType: 'intern', status: 'active', probationEnd: null });
      expect((await contractsOf(i.id, i.employmentId)).map((c) => [c.version, c.status])).toEqual([
        [3, 'draft'],
        [2, 'active'],
        [1, 'superseded'],
      ]);
      await sign(signed);
      expect((await profileOf(i.id)).employment).toMatchObject({ employmentType: 'full_time' });

      // only an intern's agreement is converted
      const f = await hire('Farah Fulltime', { joinDate: addMonths(today, -2) }, { grossSalary: 12000 });
      await sign(f.contract);
      expect(messageOf(await draftVersion(f, { convertsTo: 'full_time', grossSalary: 13000 }).expect(400))).toBe(
        'Only an intern’s internship agreement is converted to a full-time contract.',
      );
      expect(messageOf(await draftVersion(f, { convertsTo: 'part_time', grossSalary: 13000 }).expect(400))).toEqual([
        'An internship agreement is converted to full_time: send convertsTo as full_time, or leave it out.',
      ]);
    });
  });

  describe('Training completed, and a new agreement 6 months later', () => {
    it('ends an intern’s agreement with its last day, with no Art. 154 note; a new one starts 6 months after it at the earliest', async () => {
      const joinDate = addMonths(today, -7);
      const t = await hire('Tarek Intern', { employmentType: 'intern', joinDate }, { durationMonths: 6 });
      await sign(t.contract);
      const end = addDays(addMonths(joinDate, 6), -1);
      const endings = (body: object) => api().post(`/api/employees/${t.id}/employments/${t.employmentId}/endings`).set('Cookie', hr).send(body);

      // not a fixed term the company doesn't renew
      expect(messageOf(await endings({ ruleKey: 'non_renewal', noticeGivenOn: addMonths(joinDate, 1) }).expect(400))).toBe(
        'An internship agreement isn’t renewed as a fixed term is: end it as Training completed, or convert it to a full-time contract.',
      );
      const ending = (await endings({ ruleKey: 'training_completed', noticeGivenOn: addMonths(joinDate, 1) }).expect(201)).body;
      expect(ending).toMatchObject({ ruleKey: 'training_completed', ruleLabel: 'Training completed', initiator: null, lastWorkingDay: end, endReason: 'training_completed', art154Note: null, art154Estimate: null });
      await api().post(`/api/endings/${ending.id}/approve`).set('Cookie', ceo).send({}).expect(200);
      await api().post(`/api/endings/${ending.id}/complete`).set('Cookie', hr).expect(200);
      const ended = await profileOf(t.id);
      expect(ended.employment).toBeNull();
      expect(ended.employments).toEqual([expect.objectContaining({ endDate: end, endReason: 'training_completed', status: 'terminated' })]);
      expect(await listed(t.id)).toMatchObject({ standing: 'former' });
      const from = trainingAgainFrom(end);
      expect(ended.nextTraining).toEqual({ lastEnded: end, from });

      // Training completed is an intern's only
      const f = await hire('Fouad Fulltime', { joinDate: addMonths(today, -2) }, { grossSalary: 12000 });
      await sign(f.contract);
      const refused = await api().post(`/api/employees/${f.id}/employments/${f.employmentId}/endings`).set('Cookie', hr).send({ ruleKey: 'training_completed', noticeGivenOn: today }).expect(400);
      expect(messageOf(refused)).toBe(`Fouad Fulltime ${RUN} isn’t an intern: "Training completed" ends an internship agreement. Choose another way to end the employment.`);

      // a job offer for a new agreement before then: refused when drafted, and when accepted
      const offer = (body: object) =>
        api()
          .post('/api/offers')
          .set('Cookie', hr)
          .send({ fullNameEn: t.name, fullNameAr: 'متدرب تجريبي', email: `tarek.${RUN}@mail.test`, employeeId: t.id, joinDate: addDays(from, -1), ...body });
      expect(messageOf(await offer({ employmentType: 'intern' }).expect(400))).toBe(trainingTooSoonMessage(t.name, end));
      const fullTime = (await offer({ employmentType: 'full_time', grossSalary: 8000 }).expect(201)).body;
      offers.push(fullTime.id);
      await prisma.jobOffer.update({ where: { id: fullTime.id }, data: { employmentType: 'intern', grossSalary: 0, probationMonths: 0 } });
      const answered = (await api().post(`/api/offers/${fullTime.id}/answer`).set('Cookie', hr).send({ answer: 'accepted' }).expect(200)).body;
      expect(answered).toMatchObject({ status: 'accepted', hiredAt: null, hireError: trainingTooSoonMessage(t.name, end) });

      // rehired as an intern before then: refused with the day it becomes possible; from that day, made
      expect(messageOf(await postHire(t.id, { employmentType: 'intern', joinDate: addDays(end, 1) }).expect(400))).toBe(trainingTooSoonMessage(t.name, end));
      expect(messageOf(await postHire(t.id, { employmentType: 'intern', joinDate: addDays(from, -1) }).expect(400))).toBe(
        `A new internship agreement for ${t.name} can start from ${shownDate(from)}, six months after their last one ended on ${shownDate(end)}.`,
      );
      expect(await prisma.employment.count({ where: { employeeId: t.id } })).toBe(1);
      const rehired = (await postHire(t.id, { employmentType: 'intern', joinDate: from }).expect(201)).body as Profile;
      expect(rehired.employment).toMatchObject({ employmentType: 'intern', joinDate: from, status: 'active' });
    });
  });

  describe('job offers', () => {
    it('offer an intern no probation and no wage, and a trainee not at all', async () => {
      const offer = (name: string, body: object) =>
        api()
          .post('/api/offers')
          .set('Cookie', hr)
          .send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'مرشح', email: `${name.toLowerCase().replace(/ /g, '.')}.${RUN}@mail.test`, joinDate: addDays(today, 30), ...body });
      // the paid trainee went on 25 October 2026: an intern now
      expect(messageOf(await offer('Taha Trainee', { employmentType: 'trainee', grossSalary: 8000 }).expect(400))).toEqual([TYPE_MESSAGE]);
      expect(await prisma.jobOffer.count({ where: { fullNameEn: `Taha Trainee ${RUN}` } })).toBe(0);

      expect(messageOf(await offer('Inas Intern', { employmentType: 'intern', probationMonths: 2 }).expect(400))).toBe(NO_PROBATION_MESSAGE);
      expect(messageOf(await offer('Inas Intern', { employmentType: 'intern', grossSalary: 4000 }).expect(400))).toBe(INTERN_NO_WAGE_MESSAGE);
      expect(messageOf(await offer('Inas Intern', { employmentType: 'intern', durationMonths: 18 }).expect(400))).toBe(INTERN_TERM_MESSAGE);
      const intern = (await offer('Inas Intern', { employmentType: 'intern', allowances: [{ allowanceTypeId: transportId, amount: 1200 }] }).expect(201)).body;
      offers.push(intern.id);
      expect(intern).toMatchObject({
        employmentType: 'intern',
        grossSalary: 0,
        probationMonths: 0,
        durationMonths: 3,
        payBasis: 'monthly',
        template: { slotKey: 'offer_internship', name: 'Job offer · Unpaid internship' },
      });
      // a full-time offer changed to an intern's: no wage; and back: a salary again, and the settings' probation
      const changed = (await offer('Carl Changed', { employmentType: 'full_time', grossSalary: 9000 }).expect(201)).body;
      offers.push(changed.id);
      expect((await api().patch(`/api/offers/${changed.id}`).set('Cookie', hr).send({ employmentType: 'intern' }).expect(200)).body).toMatchObject({
        grossSalary: 0,
        probationMonths: 0,
        durationMonths: 3,
      });
      expect(messageOf(await api().patch(`/api/offers/${changed.id}`).set('Cookie', hr).send({ employmentType: 'full_time' }).expect(400))).toBe('Enter the gross salary.');
      expect((await api().patch(`/api/offers/${changed.id}`).set('Cookie', hr).send({ employmentType: 'full_time', grossSalary: 9000 }).expect(200)).body).toMatchObject({
        grossSalary: 9000,
        probationMonths: 3,
      });

      // accepted: the intern's employment and agreement, no wage and no probation
      const accepted = (await api().post(`/api/offers/${intern.id}/answer`).set('Cookie', hr).send({ answer: 'accepted' }).expect(200)).body;
      expect(accepted).toMatchObject({ status: 'accepted', hireError: null });
      added.push(accepted.employeeId);
      const profile = await profileOf(accepted.employeeId);
      expect(profile.employment).toMatchObject({ employmentType: 'intern', status: 'active', probationEnd: null });
      const [draft] = await contractsOf(accepted.employeeId, profile.employment!.id);
      expect(draft).toMatchObject({ grossSalary: 0, insuredSalary: 0, allowancesTotal: 1200, probationMonths: 0, durationMonths: 3 });
    });
  });
});
