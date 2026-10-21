import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENDING_RULE_DEFAULTS, ENDING_RULES, KPI_PILLARS } from '@trendlix/shared';
import pg from 'pg';
import { dutiesFromHtml, dutyRow, htmlFromLines } from '../src/organisation/job-titles/jd-html.js';
import { assertTestDatabase } from './test-env.js';

// Migrations that move data, replayed into a schema of their own in the test database (the tables the other tests use
// are left alone): the migrations before one run first, then data as it was, then the migration itself.
const MIGRATIONS = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
const SCHEMA = 'migration_check';

describe('Migrations (e2e)', () => {
  let db: pg.Client;
  const sql = (migration: string) => readFileSync(`${MIGRATIONS}${migration}/migration.sql`, 'utf8');

  /** An empty schema with every migration before `migration` applied. */
  async function migratedUpTo(migration: string) {
    await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; SET search_path TO ${SCHEMA}`);
    const earlier = readdirSync(MIGRATIONS).filter((m) => /^\d{14}_/.test(m) && m < migration).sort();
    for (const m of earlier) await db.query(sql(m));
  }

  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    const { rows } = await db.query<{ name: string }>('SELECT current_database() AS name');
    assertTestDatabase(rows[0].name);
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await db.end();
  });

  it('grades on employments: a job title’s grade becomes its range, and every employment keeps the grade it had', async () => {
    const migration = readdirSync(MIGRATIONS).find((m) => m.endsWith('_grades_on_employments'))!;
    await migratedUpTo(migration);

    // before: a job title with grade G4 and one with none; employments under each (one of them ended), and one without
    await db.query(`
      INSERT INTO departments (id, name_en, updated_at) VALUES ('00000000-0000-4000-8000-0000000000d1', 'Sales', now());
      INSERT INTO departments (id, name_en, parent_id, updated_at)
        VALUES ('00000000-0000-4000-8000-0000000000d2', 'Accounts', '00000000-0000-4000-8000-0000000000d1', now());
      INSERT INTO job_titles (id, department_id, title_en, grade_id, updated_at) VALUES
        ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d2', 'Account Manager', (SELECT id FROM grades WHERE code = 'G4'), now()),
        ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000d2', 'Sales Assistant', NULL, now());
      INSERT INTO employees (id, employee_code, full_name_en, full_name_ar, updated_at) VALUES
        ('00000000-0000-4000-8000-0000000000e1', 'EMP-0001', 'Omar', 'عمر', now()),
        ('00000000-0000-4000-8000-0000000000e2', 'EMP-0002', 'Nour', 'نور', now()),
        ('00000000-0000-4000-8000-0000000000e3', 'EMP-0003', 'Salma', 'سلمى', now());
      INSERT INTO employments (id, employee_id, employment_type, job_title_id, join_date, end_date, end_reason, updated_at) VALUES
        ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000e1', 'full_time', '00000000-0000-4000-8000-0000000000a1', '2024-01-01', '2025-06-30', 'resigned', now()),
        ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000e1', 'full_time', '00000000-0000-4000-8000-0000000000a2', '2025-09-01', NULL, NULL, now()),
        ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000e2', 'full_time', '00000000-0000-4000-8000-0000000000a1', '2026-01-15', NULL, NULL, now()),
        ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000e3', 'part_time', NULL, '2026-02-01', NULL, NULL, now());
    `);

    await db.query(sql(migration));

    const { rows: titles } = await db.query<{ title: string; min: string | null; max: string | null }>(`
      SELECT j.title_en AS title, lo.code AS min, hi.code AS max FROM job_titles j
      LEFT JOIN grades lo ON lo.id = j.min_grade_id LEFT JOIN grades hi ON hi.id = j.max_grade_id ORDER BY j.title_en`);
    expect(titles).toEqual([
      { title: 'Account Manager', min: 'G4', max: 'G4' },
      { title: 'Sales Assistant', min: null, max: null },
    ]);
    const { rows: employments } = await db.query<{ id: string; grade: string | null }>(`
      SELECT right(e.id::text, 1) AS id, g.code AS grade FROM employments e LEFT JOIN grades g ON g.id = e.grade_id ORDER BY e.id`);
    expect(employments).toEqual([
      { id: '1', grade: 'G4' }, // ended, under the graded title
      { id: '2', grade: null }, // a title with no grade
      { id: '3', grade: 'G4' },
      { id: '4', grade: null }, // no job title
    ]);
    // the job title's single grade is gone
    const { rows: left } = await db.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'job_titles' AND column_name = 'grade_id'",
      [SCHEMA],
    );
    expect(left).toEqual([]);
  });

  it('job description as rich text: plain text becomes HTML, the duties too from their rows, which stay as they are', async () => {
    const migration = readdirSync(MIGRATIONS).find((m) => m.endsWith('_job_description_rich_text'))!;
    await migratedUpTo(migration);

    // before: the owner's kind of job description (numbered sections, middle-dot bullets, a line of underscores between
    // sections), saved as plain text and as duty rows one per line; and a title with nothing written
    const purpose = 'Run day-to-day HR operations & keep records <accurate>.\r\n\r\n  Report to the HR Manager.  ';
    const requirements = "Bachelor's degree in HR or Business\n- 3+ years in HR\n- Fluent English & Arabic\n----\nCIPD a plus";
    const duties = [
      '1. Recruitment & Onboarding',
      '· Post job vacancies on LinkedIn & Wuzzuf',
      '· Screen candidates and arrange interviews',
      '____',
      '2. Personnel & Attendance',
      '· Maintain records',
    ];
    await db.query("INSERT INTO departments (id, name_en, updated_at) VALUES ('00000000-0000-4000-8000-0000000000d1', 'Human Resources', now())");
    await db.query(
      `INSERT INTO job_titles (id, department_id, title_en, jd_purpose, jd_requirements, updated_at) VALUES
        ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'HR Specialist', $1, $2, now()),
        ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000d1', 'HR Assistant', NULL, $3, now())`,
      [purpose, requirements, ' \n '],
    );
    // rows written out of order: the HTML follows their positions
    for (const i of [3, 0, 5, 1, 4, 2]) {
      await db.query('INSERT INTO job_title_duties (id, job_title_id, position, duty) VALUES (gen_random_uuid(), $1, $2, $3)', [
        '00000000-0000-4000-8000-0000000000a1',
        i + 1,
        duties[i],
      ]);
    }

    await db.query(sql(migration));

    const { rows } = await db.query<{ title: string; purpose: string | null; requirements: string | null; duties: string | null }>(
      'SELECT title_en AS title, jd_purpose AS purpose, jd_requirements AS requirements, jd_duties AS duties FROM job_titles ORDER BY title_en',
    );
    expect(rows).toEqual([
      { title: 'HR Assistant', purpose: null, requirements: null, duties: null },
      {
        title: 'HR Specialist',
        purpose: '<p>Run day-to-day HR operations &amp; keep records &lt;accurate&gt;.</p><p>Report to the HR Manager.</p>',
        requirements:
          "<p>Bachelor's degree in HR or Business</p><ul><li>3+ years in HR</li><li>Fluent English &amp; Arabic</li></ul><p>----</p><p>CIPD a plus</p>",
        duties:
          '<p>1. Recruitment &amp; Onboarding</p>' +
          '<ul><li>Post job vacancies on LinkedIn &amp; Wuzzuf</li><li>Screen candidates and arrange interviews</li></ul>' +
          '<p>____</p><p>2. Personnel &amp; Attendance</p><ul><li>Maintain records</li></ul>',
      },
    ]);
    // the API converts plain text the same way, and reads back the same duties as the rows hold, so the first save after
    // the migration is not a new version of the job description
    const [, specialist] = rows;
    expect(htmlFromLines([purpose])).toBe(specialist.purpose);
    expect(htmlFromLines([requirements])).toBe(specialist.requirements);
    expect(htmlFromLines(duties)).toBe(specialist.duties);
    expect(dutiesFromHtml(specialist.duties)).toEqual(duties.map(dutyRow).filter((d) => d !== null));

    // the duty rows stay as they were, and the conversion function is gone
    const { rows: kept } = await db.query<{ duty: string }>('SELECT duty FROM job_title_duties ORDER BY position');
    expect(kept.map((r) => r.duty)).toEqual(duties);
    const { rows: fn } = await db.query("SELECT 1 FROM pg_proc WHERE proname = 'jd_lines_to_html'");
    expect(fn).toEqual([]);
  });

  it('contracts: the settings row and the ending rules as packages/shared has them, in order', async () => {
    const migration = readdirSync(MIGRATIONS).find((m) => m.endsWith('_contracts'))!;
    await migratedUpTo(migration);
    await db.query(sql(migration));

    const { rows: settings } = await db.query('SELECT id, probation_months, duration_months FROM contract_settings');
    expect(settings).toEqual([{ id: 1, probation_months: 3, duration_months: 12 }]);
    const { rows: rules } = await db.query<Record<string, unknown>>(`
      SELECT key, label, initiator, notice_amount AS "noticeAmount", notice_unit AS "noticeUnit", pay_in_lieu AS "payInLieu",
        end_reason AS "endReason", source, active, sort_order AS "sortOrder"
      FROM ending_rules ORDER BY sort_order`);
    // Training completed came with the trainees' and interns' agreements (20261019170000_trainees_and_interns)
    const seeded = ENDING_RULES.filter((key) => key !== 'training_completed');
    expect(rules).toEqual(seeded.map((key, i) => ({ key, ...ENDING_RULE_DEFAULTS[key], active: true, sortOrder: i + 1 })));

    // the law's caps hold in the database too
    await expect(db.query('UPDATE contract_settings SET probation_months = 4')).rejects.toThrow(/contract_settings_probation_months_check/);
    await expect(db.query('INSERT INTO contract_settings (id, updated_at) VALUES (2, now())')).rejects.toThrow(/contract_settings_one_row/);
  });

  it('the occupation on the employee: each gets their current job title’s, and the job titles lose it (owner, 16 October 2026)', async () => {
    const migration = readdirSync(MIGRATIONS).find((m) => m.endsWith('_occupation_on_employee'))!;
    await migratedUpTo(migration);

    // before: titles with an occupation and one without; people under them now, and before
    await db.query(`
      INSERT INTO departments (id, name_en, updated_at) VALUES ('00000000-0000-4000-8000-0000000000d1', 'Sales', now());
      INSERT INTO job_titles (id, department_id, title_en, occupation_code, updated_at) VALUES
        ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'Sales Manager', '212300', now()),
        ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000d1', 'Sales Assistant', NULL, now()),
        ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000d1', 'Chemist', '011100', now());
      INSERT INTO employees (id, employee_code, full_name_en, full_name_ar, updated_at) VALUES
        ('00000000-0000-4000-8000-0000000000e1', 'EMP-0001', 'Omar', 'عمر', now()),
        ('00000000-0000-4000-8000-0000000000e2', 'EMP-0002', 'Nour', 'نور', now()),
        ('00000000-0000-4000-8000-0000000000e3', 'EMP-0003', 'Salma', 'سلمى', now()),
        ('00000000-0000-4000-8000-0000000000e4', 'EMP-0004', 'Karim', 'كريم', now()),
        ('00000000-0000-4000-8000-0000000000e5', 'EMP-0005', 'Hana', 'هنا', now());
      INSERT INTO employments (id, employee_id, employment_type, job_title_id, join_date, end_date, end_reason, updated_at) VALUES
        ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000e1', 'full_time', '00000000-0000-4000-8000-0000000000a1', '2025-01-01', NULL, NULL, now()),
        ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000e2', 'full_time', '00000000-0000-4000-8000-0000000000a3', '2024-01-01', '2025-06-30', 'resigned', now()),
        ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000e2', 'full_time', '00000000-0000-4000-8000-0000000000a2', '2025-09-01', NULL, NULL, now()),
        ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000e3', 'full_time', '00000000-0000-4000-8000-0000000000a1', '2024-01-01', '2025-06-30', 'resigned', now()),
        ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000e4', 'part_time', '00000000-0000-4000-8000-0000000000a3', '2026-02-01', NULL, NULL, now());
    `);

    await db.query(sql(migration));

    const { rows } = await db.query<{ code: string; occupation: string | null }>('SELECT employee_code AS code, occupation_code AS occupation FROM employees ORDER BY employee_code');
    expect(rows).toEqual([
      { code: 'EMP-0001', occupation: '212300' }, // their current title's
      { code: 'EMP-0002', occupation: null }, // their current title has none; the ended one's is not taken
      { code: 'EMP-0003', occupation: null }, // only an ended employment
      { code: 'EMP-0004', occupation: '011100' }, // whatever the employment type
      { code: 'EMP-0005', occupation: null }, // never employed
    ]);
    // the job titles' occupation is gone; the employee's is checked by the database as it was
    const { rows: left } = await db.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'job_titles' AND column_name = 'occupation_code'",
      [SCHEMA],
    );
    expect(left).toEqual([]);
    await expect(db.query("UPDATE employees SET occupation_code = '12345' WHERE employee_code = 'EMP-0005'")).rejects.toThrow(/employees_occupation_code_check/);
  });

  it('installments: the advances settled already told how, the warning at 10%, a Recurring deduction allowed (owner, 18 October 2026)', async () => {
    const migration = readdirSync(MIGRATIONS).find((m) => m.endsWith('_installments'))!;
    await migratedUpTo(migration);

    // before: an advance still open, one HR settled with a note (paid back), one settled automatically (recovered)
    await db.query(`
      INSERT INTO employees (id, employee_code, full_name_en, full_name_ar, updated_at) VALUES ('00000000-0000-4000-8000-0000000000e1', 'EMP-0001', 'Omar', 'عمر', now());
      INSERT INTO payroll_advances (id, employee_id, kind, amount, given_on, reason, status, settled_at, settled_note, updated_at) VALUES
        ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1', 'loan', 6000, '2026-05-01', 'Car repair', 'open', NULL, NULL, now()),
        ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000e1', 'advance', 500, '2026-05-01', 'Salary advance', 'settled', now(), 'Paid back in cash', now()),
        ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000e1', 'loan', 1000, '2026-05-01', 'Laptop', 'settled', now(), NULL, now());
    `);

    await db.query(sql(migration));

    const { rows } = await db.query<{ reason: string; how: string | null }>('SELECT reason, settled_how AS how FROM payroll_advances ORDER BY id');
    expect(rows).toEqual([
      { reason: 'Car repair', how: null },
      { reason: 'Salary advance', how: 'paid_back' },
      { reason: 'Laptop', how: 'recovered' },
    ]);
    await expect(db.query("UPDATE payroll_advances SET status = 'settled' WHERE reason = 'Car repair'")).rejects.toThrow(/payroll_advances_settled_how_check/);
    expect((await db.query('SELECT installment_warn_percent::float AS percent FROM payroll_settings')).rows).toEqual([{ percent: 10 }]);
    await expect(db.query('UPDATE payroll_settings SET installment_warn_percent = 0')).rejects.toThrow(/payroll_settings_installment_warn_percent_check/);

    // a recurring deduction and its month's Recurring deduction, once a month; only a Recurring deduction links to one
    await db.query(`
      INSERT INTO recurring_deductions (id, employee_id, name, amount, start_month, updated_at)
        VALUES ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1', 'Medical subscription', 350, '2026-11-01', now());
      INSERT INTO payroll_adjustments (id, employee_id, month, kind, type, taxed, amount, reason, recurring_id, updated_at)
        VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000000e1', '2026-11-01', 'deduction', 'recurring', false, 350, 'Medical subscription', '00000000-0000-4000-8000-0000000000b1', now());
    `);
    const again = (type: string, month: string) =>
      db.query(
        `INSERT INTO payroll_adjustments (id, employee_id, month, kind, type, taxed, amount, reason, recurring_id, updated_at)
         VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000000e1', $1, 'deduction', $2, false, 350, 'Medical subscription', '00000000-0000-4000-8000-0000000000b1', now())`,
        [month, type],
      );
    await expect(again('recurring', '2026-11-01')).rejects.toThrow(/payroll_adjustments_recurring_id_month_key/);
    await expect(again('other', '2026-12-01')).rejects.toThrow(/payroll_adjustments_recurring_check/);
    await expect(db.query("UPDATE recurring_deductions SET stopped_from = '2026-10-01'")).rejects.toThrow(/recurring_deductions_months_check/);
  });

  it('the Labour Law’s limits: the installments warning becomes the law’s limit, 1 to 10 and never none; recurring deductions get their consent (owner, 18 October 2026)', async () => {
    const migration = readdirSync(MIGRATIONS).find((m) => m.endsWith('_labour_law_limits'))!;
    await migratedUpTo(migration);
    // before: a recurring deduction set up without a consent
    await db.query(`
      INSERT INTO employees (id, employee_code, full_name_en, full_name_ar, updated_at) VALUES ('00000000-0000-4000-8000-0000000000e1', 'EMP-0001', 'Omar', 'عمر', now());
      INSERT INTO recurring_deductions (id, employee_id, name, amount, start_month, updated_at)
        VALUES ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1', 'Medical subscription', 350, '2026-11-01', now());
    `);
    // the share as it was set: none (no warning) and above 10 become the law's 10; one of 1 to 10 is kept
    for (const [before, after] of [
      [null, 10],
      [25, 10],
      [7.5, 7.5],
      [10, 10],
    ] as const) {
      await db.query('BEGIN');
      await db.query('UPDATE payroll_settings SET installment_warn_percent = $1', [before]);
      await db.query(sql(migration));
      expect((await db.query('SELECT installment_limit_percent::float AS percent FROM payroll_settings')).rows).toEqual([{ percent: after }]);
      await db.query('ROLLBACK');
    }

    await db.query(sql(migration));
    expect((await db.query('SELECT installment_limit_percent::float AS percent FROM payroll_settings')).rows).toEqual([{ percent: 10 }]);
    await expect(db.query('UPDATE payroll_settings SET installment_limit_percent = 10.5')).rejects.toThrow(/payroll_settings_installment_limit_percent_check/);
    await expect(db.query('UPDATE payroll_settings SET installment_limit_percent = 0')).rejects.toThrow(/payroll_settings_installment_limit_percent_check/);
    await expect(db.query('UPDATE payroll_settings SET installment_limit_percent = NULL')).rejects.toThrow(/null value/);
    // the one set up before has no consent; who and the paper only with when
    expect((await db.query('SELECT consent_recorded_at, consent_recorded_by, consent_paperwork_id FROM recurring_deductions')).rows).toEqual([
      { consent_recorded_at: null, consent_recorded_by: null, consent_paperwork_id: null },
    ]);
    await expect(db.query("UPDATE recurring_deductions SET consent_paperwork_id = gen_random_uuid()")).rejects.toThrow(/recurring_deductions_consent_check/);
    await db.query('UPDATE recurring_deductions SET consent_recorded_at = now()');
  });

  it('department leads: departments without a head; the requests and claims sent so far went to the direct manager (owner, 19 October 2026)', async () => {
    const migration = readdirSync(MIGRATIONS).find((m) => m.endsWith('_department_leads'))!;
    await migratedUpTo(migration);
    // before: a department, its employees, a leave request and a claim to the direct manager, and one of each straight to HR
    await db.query(`
      INSERT INTO departments (id, name_en, updated_at) VALUES ('00000000-0000-4000-8000-0000000000d1', 'Sales', now());
      INSERT INTO employees (id, employee_code, full_name_en, full_name_ar, updated_at) VALUES
        ('00000000-0000-4000-8000-0000000000e1', 'EMP-0001', 'Mona', 'منى', now()),
        ('00000000-0000-4000-8000-0000000000e2', 'EMP-0002', 'Ben', 'بن', now());
      INSERT INTO employments (id, employee_id, employment_type, department_id, manager_id, join_date, updated_at) VALUES
        ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000e1', 'full_time', '00000000-0000-4000-8000-0000000000d1', NULL, '2024-01-01', now()),
        ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000e2', 'full_time', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1', '2024-01-01', now());
      INSERT INTO leave_requests (id, employee_id, employment_id, type_id, start_date, end_date, days, status, manager_id, updated_at) VALUES
        ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-000000000002', (SELECT id FROM leave_types WHERE key = 'annual'), '2026-11-01', '2026-11-02', 2, 'with_manager', '00000000-0000-4000-8000-0000000000e1', now()),
        ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000001', (SELECT id FROM leave_types WHERE key = 'annual'), '2026-11-01', '2026-11-02', 2, 'with_hr', NULL, now());
      INSERT INTO reimbursement_types (id, name_en, name_ar, updated_at) VALUES ('00000000-0000-4000-8000-0000000000c1', 'Travel', 'انتقالات', now());
      INSERT INTO reimbursement_claims (id, employee_id, employment_id, type_id, expense_date, amount, description, status, manager_id, updated_at) VALUES
        ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000c1', '2026-10-01', 100, 'Taxi', 'with_manager', '00000000-0000-4000-8000-0000000000e1', now()),
        ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1', '2026-10-01', 100, 'Taxi', 'with_hr', NULL, now());
    `);

    await db.query(sql(migration));
    expect((await db.query('SELECT head_id FROM departments')).rows).toEqual([{ head_id: null }]);
    for (const table of ['leave_requests', 'reimbursement_claims']) {
      expect((await db.query(`SELECT manager_id IS NOT NULL AS managed, approver_role FROM ${table} ORDER BY id`)).rows).toEqual([
        { managed: true, approver_role: 'direct_manager' },
        { managed: false, approver_role: null },
      ]);
      // one of the three, exactly when someone decides the manager stage
      await expect(db.query(`UPDATE ${table} SET approver_role = 'manager' WHERE manager_id IS NOT NULL`)).rejects.toThrow(new RegExp(`${table}_approver_role_check`));
      await expect(db.query(`UPDATE ${table} SET approver_role = NULL WHERE manager_id IS NOT NULL`)).rejects.toThrow(new RegExp(`${table}_approver_role_check`));
      await expect(db.query(`UPDATE ${table} SET approver_role = 'team_lead' WHERE manager_id IS NULL`)).rejects.toThrow(new RegExp(`${table}_approver_role_check`));
      await db.query(`UPDATE ${table} SET approver_role = 'department_head' WHERE manager_id IS NOT NULL`);
    }

    // a head is an employee; deleting the profile leaves the department without one
    await db.query("UPDATE departments SET head_id = '00000000-0000-4000-8000-0000000000e1'");
    await expect(db.query("UPDATE departments SET head_id = '00000000-0000-4000-8000-0000000000ff'")).rejects.toThrow(/departments_head_id_fkey/);
    await db.query("INSERT INTO employees (id, employee_code, full_name_en, full_name_ar, updated_at) VALUES ('00000000-0000-4000-8000-0000000000e3', 'EMP-0003', 'Dan', 'دان', now())");
    await db.query("UPDATE departments SET head_id = '00000000-0000-4000-8000-0000000000e3'");
    await db.query("DELETE FROM employees WHERE id = '00000000-0000-4000-8000-0000000000e3'");
    expect((await db.query('SELECT head_id FROM departments')).rows).toEqual([{ head_id: null }]);
  });

  it('direct raise requests: every version with the CEO’s step gets its request, prepared directly by HR, with its steps (owner, 19 October 2026)', async () => {
    const migration = readdirSync(MIGRATIONS).find((m) => m.endsWith('_direct_raise_requests'))!;
    await migratedUpTo(migration);
    const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
    // before: six employments, each with its version 1, and a version 2 with the CEO's step at each stage; one of them
    // prepared from a request already
    await db.query(`
      INSERT INTO users (id, email, updated_at) VALUES ('${id(1)}', 'hr@x.test', now()), ('${id(2)}', 'ceo@x.test', now()), ('${id(3)}', 'hr2@x.test', now());
      INSERT INTO employees (id, employee_code, full_name_en, full_name_ar, updated_at) VALUES
        ('${id(10)}', 'EMP-0010', 'Amy', 'إيمي', now()), ('${id(11)}', 'EMP-0011', 'Ben', 'بن', now()), ('${id(12)}', 'EMP-0012', 'Cara', 'كارا', now()),
        ('${id(13)}', 'EMP-0013', 'Dana', 'دانة', now()), ('${id(14)}', 'EMP-0014', 'Eli', 'إيلي', now()), ('${id(15)}', 'EMP-0015', 'Fadi', 'فادي', now());
      INSERT INTO employments (id, employee_id, employment_type, join_date, updated_at) VALUES
        ('${id(20)}', '${id(10)}', 'full_time', '2026-01-01', now()), ('${id(21)}', '${id(11)}', 'full_time', '2026-01-01', now()),
        ('${id(22)}', '${id(12)}', 'full_time', '2026-01-01', now()), ('${id(23)}', '${id(13)}', 'full_time', '2026-01-01', now()),
        ('${id(24)}', '${id(14)}', 'full_time', '2026-01-15', now()), ('${id(25)}', '${id(15)}', 'full_time', '2026-01-01', now());
      INSERT INTO contracts (id, employment_id, number, version, start_date, end_date, duration_months, probation_months, gross_salary, insured_salary, status, updated_at) VALUES
        ('${id(40)}', '${id(20)}', 'CON-2026-0001', 1, '2026-01-01', '2026-12-31', 12, 3, 10000, 10000, 'active', now()),
        ('${id(41)}', '${id(21)}', 'CON-2026-0002', 1, '2026-01-01', '2026-12-31', 12, 3, 10000, 10000, 'active', now()),
        ('${id(42)}', '${id(22)}', 'CON-2026-0003', 1, '2026-01-01', '2026-12-31', 12, 3, 10000, 10000, 'active', now()),
        ('${id(43)}', '${id(23)}', 'CON-2026-0004', 1, '2026-01-01', '2026-12-31', 12, 3, 10000, 10000, 'active', now()),
        ('${id(44)}', '${id(24)}', 'CON-2026-0005', 1, '2026-01-15', '2027-01-14', 12, 3, 10000, 10000, 'superseded', now()),
        ('${id(45)}', '${id(25)}', 'CON-2026-0006', 1, '2026-01-01', '2026-12-31', 12, 3, 10000, 10000, 'active', now());
      INSERT INTO contracts (id, employment_id, number, version, kind, start_date, end_date, duration_months, probation_months, gross_salary, insured_salary, status,
          raise_reason, approval, sent_at, approved_by, approved_at, returned_reason, note, created_at, updated_at) VALUES
        -- a draft HR entered, with a note
        ('${id(31)}', '${id(20)}', 'CON-2026-0001-A1', 2, 'amendment', '2026-11-01', '2026-12-31', NULL, 0, 12500, 10000, 'draft', 'promotion', 'draft', NULL, NULL, NULL, NULL, ' Promoted after the audit ', '2026-10-18T10:00:00Z', now()),
        -- returned by the CEO
        ('${id(32)}', '${id(21)}', 'CON-2026-0002-A1', 2, 'amendment', '2026-11-01', '2026-12-31', NULL, 0, 11000, 10000, 'draft', 'annual', 'draft', '2026-10-18T11:00:00Z', NULL, NULL, 'Round it', NULL, '2026-10-18T10:30:00Z', now()),
        -- with the CEO, nothing in the audit log
        ('${id(33)}', '${id(22)}', 'CON-2026-0007', 2, 'contract', '2026-11-01', '2027-10-31', 12, 0, 12000, 10000, 'draft', 'performance', 'pending_ceo', '2026-10-18T13:00:00Z', NULL, NULL, NULL, NULL, '2026-10-18T12:30:00Z', now()),
        -- approved with another raise, to sign
        ('${id(34)}', '${id(23)}', 'CON-2026-0004-A1', 2, 'amendment', '2026-11-01', '2026-12-31', NULL, 0, 11200, 10000, 'draft', 'performance', 'approved', '2026-10-18T14:00:00Z', '${id(2)}', '2026-10-18T15:00:00Z', NULL, '', '2026-10-18T13:30:00Z', now()),
        -- a renewal with new pay (a cut, from the 15th), signed
        ('${id(35)}', '${id(24)}', 'CON-2027-0001', 2, 'contract', '2027-01-15', '2028-01-14', 12, 0, 9500, 9500, 'active', 'adjustment', 'approved', '2026-10-18T16:00:00Z', '${id(2)}', '2026-10-18T17:00:00Z', NULL, NULL, '2026-10-18T15:30:00Z', now()),
        -- prepared from a request already
        ('${id(36)}', '${id(25)}', 'CON-2026-0006-A1', 2, 'amendment', '2026-11-01', '2026-12-31', NULL, 0, 11000, 10000, 'draft', 'annual', 'pending_ceo', '2026-10-18T18:00:00Z', NULL, NULL, NULL, NULL, '2026-10-18T17:30:00Z', now());
      INSERT INTO raise_requests (id, employee_id, employment_id, requester, raise_reason, comment, effective_from, status, contract_id, created_at, updated_at)
        VALUES ('${id(50)}', '${id(15)}', '${id(25)}', 'self', 'annual', 'A good year', '2026-11-01', 'with_ceo', '${id(36)}', '2026-10-17T09:00:00Z', now());
      INSERT INTO audit_log (user_id, action, entity_type, entity_id, diff, at) VALUES
        ('${id(1)}', 'create', 'contract', '${id(31)}', '{}', '2026-10-18T10:00:00Z'),
        ('${id(1)}', 'create', 'contract', '${id(32)}', '{}', '2026-10-18T10:30:00Z'),
        ('${id(1)}', 'submit', 'contract', '${id(32)}', '{}', '2026-10-18T11:00:00Z'),
        ('${id(2)}', 'return', 'contract', '${id(32)}', '{"reason":"Round it"}', '2026-10-18T12:00:00Z'),
        ('${id(1)}', 'create', 'contract', '${id(34)}', '{}', '2026-10-18T13:30:00Z'),
        ('${id(3)}', 'submit', 'contract', '${id(34)}', '{}', '2026-10-18T14:00:00Z'),
        ('${id(2)}', 'approve', 'contract', '${id(34)}', '{"decision":"approve_other","comment":"Make it 12%"}', '2026-10-18T15:00:00Z'),
        ('${id(1)}', 'create', 'contract', '${id(35)}', '{}', '2026-10-18T15:30:00Z'),
        ('${id(3)}', 'sign', 'contract', '${id(35)}', '{}', '2026-10-19T09:00:00Z');
    `);

    await db.query(sql(migration));

    const { rows: requests } = await db.query<Record<string, unknown>>(`
      SELECT right(r.contract_id::text, 2) AS contract, r.origin, r.requester, r.status, r.raise_reason AS reason, r.comment, r.suggested_increase::text AS increase,
        r.suggested_percent::text AS percent, r.suggested_gross::text AS gross, to_char(r.effective_from, 'YYYY-MM-DD') AS "from", u.email AS "by", r.done_at AS "doneAt"
      FROM raise_requests r LEFT JOIN users u ON u.id = r.requested_by ORDER BY r.contract_id`);
    const request = (contract: string, origin: string, requester: string, status: string, reason: string, comment: string, increase: string | null, gross: string | null, from: string, by: string | null) =>
      expect.objectContaining({ contract, origin, requester, status, reason, comment, increase, percent: null, gross, from, by });
    expect(requests).toEqual([
      request('31', 'direct', 'hr', 'with_hr', 'promotion', 'Promoted after the audit', '2500.00', '12500.00', '2026-11-01', 'hr@x.test'),
      request('32', 'direct', 'hr', 'with_hr', 'annual', 'Prepared directly by HR', '1000.00', '11000.00', '2026-11-01', 'hr@x.test'),
      request('33', 'direct', 'hr', 'with_ceo', 'performance', 'Prepared directly by HR', '2000.00', '12000.00', '2026-11-01', null),
      request('34', 'direct', 'hr', 'approved', 'performance', 'Prepared directly by HR', '1200.00', '11200.00', '2026-11-01', 'hr@x.test'),
      // a cut: the gross alone; a reason kept from before, and a renewal's start that isn't a 1st
      request('35', 'direct', 'hr', 'done', 'adjustment', 'Prepared directly by HR', null, '9500.00', '2027-01-15', 'hr@x.test'),
      // the one asked for stays as it was
      request('36', 'request', 'self', 'with_ceo', 'annual', 'A good year', null, null, '2026-11-01', null),
    ]);
    expect(requests.filter((r) => r.contract !== '35').every((r) => r.doneAt === null)).toBe(true);
    expect((requests.find((r) => r.contract === '35')!.doneAt as Date).toISOString()).toBe('2026-10-19T09:00:00.000Z');

    const { rows: steps } = await db.query<Record<string, unknown> & { at: Date }>(`
      SELECT right(r.contract_id::text, 2) AS contract, s.kind, s.decision, s.comment, s.raise_reason AS reason, s.increase_amount::text AS amount,
        s.increase_percent::text AS percent, s.gross::text AS gross, s.way, to_char(s.effective_date, 'YYYY-MM-DD') AS date, s.contract_number AS number, u.email AS "by", s.at
      FROM raise_request_steps s JOIN raise_requests r ON r.id = s.request_id LEFT JOIN users u ON u.id = s.actor_id ORDER BY r.contract_id, s.id`);
    const row = (s: (typeof steps)[number]) => [s.contract, s.kind, s.decision, s.comment, s.reason, s.amount, s.percent, s.gross, s.way, s.date, s.number, s.by];
    expect(steps.map(row)).toEqual([
      ['31', 'prepared', null, 'Promoted after the audit', 'promotion', '2500.00', '25.00', '12500.00', 'amendment', '2026-11-01', 'CON-2026-0001-A1', 'hr@x.test'],
      ['32', 'prepared', null, 'Prepared directly by HR', 'annual', '1000.00', '10.00', '11000.00', 'amendment', '2026-11-01', 'CON-2026-0002-A1', 'hr@x.test'],
      ['32', 'sent', null, null, null, null, null, '11000.00', null, null, 'CON-2026-0002-A1', 'hr@x.test'],
      ['32', 'returned', null, 'Round it', null, null, null, null, null, null, 'CON-2026-0002-A1', 'ceo@x.test'],
      ['33', 'prepared', null, 'Prepared directly by HR', 'performance', '2000.00', '20.00', '12000.00', 'contract', '2026-11-01', 'CON-2026-0007', null],
      ['33', 'sent', null, null, null, null, null, '12000.00', null, null, 'CON-2026-0007', null],
      ['34', 'prepared', null, 'Prepared directly by HR', 'performance', '1200.00', '12.00', '11200.00', 'amendment', '2026-11-01', 'CON-2026-0004-A1', 'hr@x.test'],
      ['34', 'sent', null, null, null, null, null, '11200.00', null, null, 'CON-2026-0004-A1', 'hr2@x.test'],
      ['34', 'ceo_decision', 'approve_other', 'Make it 12%', null, '1200.00', '12.00', '11200.00', null, null, 'CON-2026-0004-A1', 'ceo@x.test'],
      ['35', 'prepared', null, 'Prepared directly by HR', 'adjustment', '-500.00', '-5.00', '9500.00', 'contract', '2027-01-15', 'CON-2027-0001', 'hr@x.test'],
      ['35', 'sent', null, null, null, null, null, '9500.00', null, null, 'CON-2027-0001', null],
      ['35', 'ceo_decision', 'approve', null, null, '-500.00', '-5.00', '9500.00', null, null, 'CON-2027-0001', 'ceo@x.test'],
      ['35', 'signed', null, null, null, null, null, '9500.00', null, '2027-01-15', 'CON-2027-0001', 'hr2@x.test'],
    ]);
    // each when it happened: the version entered, sent, returned, approved, signed
    const at = (contract: string) => steps.filter((s) => s.contract === contract).map((s) => s.at.toISOString());
    expect(at('32')).toEqual(['2026-10-18T10:30:00.000Z', '2026-10-18T11:00:00.000Z', '2026-10-18T12:00:00.000Z']);
    expect(at('35')).toEqual(['2026-10-18T15:30:00.000Z', '2026-10-18T16:00:00.000Z', '2026-10-18T17:00:00.000Z', '2026-10-19T09:00:00.000Z']);

    // a direct one is by HR; adjustment and any day for a direct one only; the reason before only on the CEO's change
    const ask = (origin: string, requester: string, reason: string, from: string) =>
      db.query(
        `INSERT INTO raise_requests (id, employee_id, employment_id, requester, origin, raise_reason, comment, effective_from, status, updated_at)
         VALUES (gen_random_uuid(), '${id(15)}', '${id(25)}', $1, $2, $3, 'x', $4, 'with_hr', now())`,
        [requester, origin, reason, from],
      );
    await expect(ask('direct', 'self', 'annual', '2026-11-01')).rejects.toThrow(/raise_requests_origin_check/);
    await expect(ask('elsewhere', 'hr', 'annual', '2026-11-01')).rejects.toThrow(/raise_requests_origin_check/);
    await expect(ask('request', 'hr', 'adjustment', '2026-11-01')).rejects.toThrow(/raise_requests_raise_reason_check/);
    await expect(ask('request', 'hr', 'annual', '2026-11-15')).rejects.toThrow(/raise_requests_effective_from_check/);
    const step = (kind: string, decision: string | null, reason: string | null, from: string) =>
      db.query(`INSERT INTO raise_request_steps (request_id, kind, decision, raise_reason, raise_reason_from) VALUES ('${id(50)}', $1, $2, $3, $4)`, [kind, decision, reason, from]);
    await expect(step('prepared', null, 'annual', 'performance')).rejects.toThrow(/raise_request_steps_raise_reason_from_check/);
    await expect(step('ceo_decision', 'approve', null, 'performance')).rejects.toThrow(/raise_request_steps_raise_reason_from_check/);
    await step('ceo_decision', 'approve', 'annual', 'performance');
  });

  it('deductions before tax: every one there is stays after tax, only a Recurring deduction may be before tax, the limit empty or above 0 (owner, 20 October 2026)', async () => {
    const migration = readdirSync(MIGRATIONS).find((m) => m.endsWith('_before_tax_deductions'))!;
    await migratedUpTo(migration);
    // before: a recurring deduction, its month's Recurring deduction, and a one-off deduction
    await db.query(`
      INSERT INTO employees (id, employee_code, full_name_en, full_name_ar, updated_at) VALUES ('00000000-0000-4000-8000-0000000000e1', 'EMP-0001', 'Omar', 'عمر', now());
      INSERT INTO recurring_deductions (id, employee_id, name, amount, start_month, updated_at)
        VALUES ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1', 'Medical subscription', 350, '2026-11-01', now());
      INSERT INTO payroll_adjustments (id, employee_id, month, kind, type, taxed, amount, reason, recurring_id, updated_at) VALUES
        ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1', '2026-11-01', 'deduction', 'recurring', false, 350, 'Medical subscription', '00000000-0000-4000-8000-0000000000b1', now()),
        ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000e1', '2026-11-01', 'deduction', 'other', false, 100, 'Invented', NULL, now());
    `);
    await db.query(sql(migration));

    expect((await db.query('SELECT before_tax FROM recurring_deductions')).rows).toEqual([{ before_tax: false }]);
    expect((await db.query('SELECT type, before_tax FROM payroll_adjustments ORDER BY id')).rows).toEqual([
      { type: 'recurring', before_tax: false },
      { type: 'other', before_tax: false },
    ]);
    expect((await db.query('SELECT before_tax_health_limit FROM payroll_law_years')).rows.every((r: { before_tax_health_limit: unknown }) => r.before_tax_health_limit === null)).toBe(true);
    // ticked: the recurring deduction and its month's deduction; never another deduction, nor an addition
    await db.query("UPDATE recurring_deductions SET before_tax = true");
    await db.query("UPDATE payroll_adjustments SET before_tax = true WHERE type = 'recurring'");
    await expect(db.query("UPDATE payroll_adjustments SET before_tax = true WHERE type = 'other'")).rejects.toThrow(/payroll_adjustments_before_tax_check/);
    // the recurring deduction deleted: its months' deductions keep it
    await db.query('DELETE FROM recurring_deductions');
    expect((await db.query("SELECT recurring_id, before_tax FROM payroll_adjustments WHERE type = 'recurring'")).rows).toEqual([{ recurring_id: null, before_tax: true }]);
    // the limit a year: empty, or above 0
    await db.query('UPDATE payroll_law_years SET before_tax_health_limit = 6000 WHERE year = 2026');
    await expect(db.query('UPDATE payroll_law_years SET before_tax_health_limit = 0 WHERE year = 2026')).rejects.toThrow(/payroll_law_years_before_tax_health_limit_check/);
  });

  describe('super admin: the role, given to the original admin account only (owner’s decision, 15 October 2026)', () => {
    const migration = () => readdirSync(MIGRATIONS).find((m) => m.endsWith('_super_admin'))!;
    const superAdmins = async () =>
      (
        await db.query<{ email: string }>(`
          SELECT u.email FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
          WHERE r.key = 'super_admin' ORDER BY u.email`)
      ).rows.map((r) => r.email);

    /** The roles the seed gave, and users created at the given times with the given roles. */
    async function before(users: { email: string; createdAt: string; roles: string[] }[]) {
      await migratedUpTo(migration());
      await db.query(`INSERT INTO roles (id, key, name) VALUES
        (gen_random_uuid(), 'employee', 'Employee'), (gen_random_uuid(), 'hr', 'HR'), (gen_random_uuid(), 'admin', 'Admin')`);
      for (const u of users) {
        const { rows } = await db.query<{ id: string }>(
          'INSERT INTO users (id, email, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, now()) RETURNING id',
          [u.email, u.createdAt],
        );
        await db.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = ANY($2)', [rows[0].id, u.roles]);
      }
    }

    it('adds the role and gives it to admin@trendlix.com, even when another admin is older', async () => {
      await before([
        { email: 'first.admin@trendlix.com', createdAt: '2026-10-01T09:00:00Z', roles: ['admin'] },
        { email: 'admin@trendlix.com', createdAt: '2026-10-02T09:00:00Z', roles: ['admin', 'hr'] },
        { email: 'later.admin@trendlix.com', createdAt: '2026-10-03T09:00:00Z', roles: ['admin'] },
      ]);
      await db.query(sql(migration()));

      const { rows: role } = await db.query("SELECT name FROM roles WHERE key = 'super_admin'");
      expect(role).toEqual([{ name: 'Super Admin' }]);
      expect(await superAdmins()).toEqual(['admin@trendlix.com']);
      // their other roles stay
      const { rows } = await db.query<{ key: string }>(`
        SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id
        WHERE u.email = 'admin@trendlix.com' ORDER BY r.key`);
      expect(rows.map((r) => r.key)).toEqual(['admin', 'hr', 'super_admin']);
    });

    it('without admin@trendlix.com, gives it to the earliest-created admin, and to nobody else', async () => {
      await before([
        { email: 'staff@trendlix.com', createdAt: '2026-09-01T09:00:00Z', roles: ['employee'] }, // older, not an admin
        { email: 'later.admin@trendlix.com', createdAt: '2026-10-03T09:00:00Z', roles: ['admin'] },
        { email: 'first.admin@trendlix.com', createdAt: '2026-10-01T09:00:00Z', roles: ['admin', 'hr'] },
      ]);
      await db.query(sql(migration()));
      expect(await superAdmins()).toEqual(['first.admin@trendlix.com']);
    });

    it('on a new database (no users yet), only adds the role: the seed gives it to the first account', async () => {
      await migratedUpTo(migration());
      await db.query(sql(migration()));
      const { rows } = await db.query('SELECT key, name FROM roles');
      expect(rows).toEqual([{ key: 'super_admin', name: 'Super Admin' }]);
      expect(await superAdmins()).toEqual([]);
    });
  });

  // several check-in locations (owner, 20 October 2026: "Own page, several locations"): the one office point Payroll
  // Setup had becomes the first location, "Office"; none set, none made; the old columns stay
  describe('check-in locations', () => {
    const migration = () => readdirSync(MIGRATIONS).find((m) => m.endsWith('_check_in_locations'))!;
    const locations = async () =>
      (await db.query<{ name: string; latitude: string; longitude: string; radius: number }>('SELECT name, latitude, longitude, radius_metres AS radius FROM check_in_locations')).rows;

    it('copies the office point set on Payroll Setup into a first location named Office, with its radius', async () => {
      await migratedUpTo(migration());
      await db.query('UPDATE payroll_settings SET office_latitude = 30.0596, office_longitude = 31.3462, office_radius_metres = 220 WHERE id = 1');
      await db.query(sql(migration()));
      expect(await locations()).toEqual([{ name: 'Office', latitude: '30.059600', longitude: '31.346200', radius: 220 }]);
      const { rows } = await db.query<{ lat: string }>('SELECT office_latitude AS lat FROM payroll_settings WHERE id = 1');
      expect(rows).toEqual([{ lat: '30.059600' }]);
    });

    it('makes none when no office point was set', async () => {
      await migratedUpTo(migration());
      await db.query(sql(migration()));
      expect(await locations()).toEqual([]);
    });
  });

  // "You haven't checked in" every 10 minutes (owner, 20 October 2026: "a reminder for people that didn't checkin and
  // not on a leave every 10 minutes. like a popup"): the reminders sent before count once, sent when they were
  it('check-in reminder steps: each reminder sent before counts as one, its time the last sent, no inbox row yet', async () => {
    const migration = readdirSync(MIGRATIONS).find((m) => m.endsWith('_check_in_reminder_steps'))!;
    await migratedUpTo(migration);
    await db.query(`
      INSERT INTO users (id, email, updated_at) VALUES ('00000000-0000-4000-8000-0000000000b1', 'rami@trendlix.com', now());
      INSERT INTO reminders_sent (user_id, day, kind, sent_at) VALUES
        ('00000000-0000-4000-8000-0000000000b1', '2026-10-20', 'check_in_reminder', '2026-10-20T07:45:00Z'),
        ('00000000-0000-4000-8000-0000000000b1', '2026-10-20', 'check_out_reminder', '2026-10-20T15:15:00Z');
    `);
    await db.query(sql(migration));
    const { rows } = await db.query<{ kind: string; count: number; at: string; inbox: string | null }>(
      `SELECT kind, count, to_char(last_sent_at AT TIME ZONE 'UTC', 'HH24:MI') AS at, notification_id AS inbox FROM reminders_sent ORDER BY kind`,
    );
    expect(rows).toEqual([
      { kind: 'check_in_reminder', count: 1, at: '07:45', inbox: null },
      { kind: 'check_out_reminder', count: 1, at: '15:15', inbox: null },
    ]);
    await expect(db.query(`UPDATE reminders_sent SET count = 0 WHERE kind = 'check_in_reminder'`)).rejects.toThrow(/reminders_sent_count_check/);
  });

  // the main office and its sub-locations (owner, 20 October 2026: "main office location is the hero and other locations
  // are like sub locations. shown with their name and linked users"): the oldest location becomes the main, by when it
  // was added then by name, as Check-in Setup listed them; never two mains; links one a location and person; the flag
  describe('sub-locations', () => {
    const migration = () => readdirSync(MIGRATIONS).find((m) => m.endsWith('_sub_locations'))!;
    const mains = async () => (await db.query<{ name: string; main: boolean }>('SELECT name, is_main AS main FROM check_in_locations ORDER BY name')).rows;

    it('makes the oldest location the main office, the others sub-locations; a second main is refused', async () => {
      await migratedUpTo(migration());
      await db.query(`
        INSERT INTO check_in_locations (id, name, latitude, longitude, radius_metres, created_at, updated_at) VALUES
          ('00000000-0000-4000-8000-0000000000c1', 'Studio', 30.0444, 31.2357, 100, '2026-10-20T10:00:00Z', now()),
          ('00000000-0000-4000-8000-0000000000c2', 'Office', 30.0596, 31.3462, 150, '2026-10-20T08:30:00Z', now()),
          ('00000000-0000-4000-8000-0000000000c3', 'Annex', 30.0601, 31.3465, 150, '2026-10-20T08:30:00Z', now());
      `);
      await db.query(sql(migration()));
      // Annex and Office added at the same moment: Annex first by its name
      expect(await mains()).toEqual([
        { name: 'Annex', main: true },
        { name: 'Office', main: false },
        { name: 'Studio', main: false },
      ]);
      await expect(db.query(`UPDATE check_in_locations SET is_main = true WHERE name = 'Studio'`)).rejects.toThrow(/check_in_locations_one_main/);
      // a new location is a sub-location unless the API says otherwise
      await db.query(`INSERT INTO check_in_locations (id, name, latitude, longitude, updated_at) VALUES (gen_random_uuid(), 'Client', 30.01, 31.2, now())`);
      expect((await mains()).find((l) => l.name === 'Client')).toEqual({ name: 'Client', main: false });
    });

    it('makes no main without locations; links each person to a location once, gone with either; allows the new flag', async () => {
      await migratedUpTo(migration());
      await db.query(sql(migration()));
      expect(await mains()).toEqual([]);
      await db.query(`
        INSERT INTO check_in_locations (id, name, latitude, longitude, updated_at) VALUES ('00000000-0000-4000-8000-0000000000c1', 'Studio', 30.0444, 31.2357, now());
        INSERT INTO employees (id, employee_code, full_name_en, full_name_ar, updated_at) VALUES ('00000000-0000-4000-8000-0000000000e1', 'EMP-0001', 'Omar', 'عمر', now());
        INSERT INTO check_in_location_people (location_id, employee_id) VALUES ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1');
      `);
      await expect(
        db.query(`INSERT INTO check_in_location_people (location_id, employee_id) VALUES ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1')`),
      ).rejects.toThrow(/check_in_location_people_pkey/);
      await db.query(`
        INSERT INTO attendance_punches (id, employee_id, date, kind, place, expected, flags, location_name)
          VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000000e1', '2026-10-20', 'in', 'remote', 'anywhere', ARRAY['not_their_location'], 'Studio');
      `);
      await expect(
        db.query(`INSERT INTO attendance_punches (id, employee_id, date, kind, place, expected, flags) VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000000e1', '2026-10-20', 'in', 'remote', 'anywhere', ARRAY['made_up'])`),
      ).rejects.toThrow(/attendance_punches_flags_check/);
      await db.query(`DELETE FROM check_in_locations WHERE id = '00000000-0000-4000-8000-0000000000c1'`);
      expect((await db.query('SELECT 1 FROM check_in_location_people')).rows).toEqual([]);
    });
  });

  // the KPI framework (owner, 21 October 2026: "am i able to edit the pillars of the KPIs?", "Fully flexible"): the plan's
  // four pillars become version 1, in force from the start; every template version keeps them, a published one with
  // version 1; the metrics' pillars (1–4) become their keys, and the scorecards' kept percents are by key
  it('the KPI framework: the plan’s four pillars are version 1, every version keeps them, the pillars become keys (owner, 21 October 2026)', async () => {
    const migration = readdirSync(MIGRATIONS).find((m) => m.endsWith('_kpi_framework'))!;
    await migratedUpTo(migration);
    const criteria = `'[{"label": "Yes", "points": 10}, {"label": "No", "points": 0}]'`;
    await db.query(`
      INSERT INTO departments (id, name_en, updated_at) VALUES ('00000000-0000-4000-8000-0000000000d1', 'Web', now());
      INSERT INTO job_titles (id, department_id, title_en, updated_at) VALUES ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'Developer', now());
      INSERT INTO employees (id, employee_code, full_name_en, full_name_ar, updated_at) VALUES ('00000000-0000-4000-8000-0000000000e1', 'EMP-0001', 'Omar', 'عمر', now());
      INSERT INTO employments (id, employee_id, employment_type, job_title_id, join_date, updated_at)
        VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000e1', 'full_time', '00000000-0000-4000-8000-0000000000a1', '2026-01-01', now());
      INSERT INTO kpi_templates (id, job_title_id, version, status, opens_from, published_at, updated_at) VALUES
        ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 1, 'published', '2026-10-01', now(), now()),
        ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a1', 2, 'draft', NULL, NULL, now());
      INSERT INTO kpi_metrics (id, template_id, position, pillar, name, target_points, criteria) VALUES
        (gen_random_uuid(), '00000000-0000-4000-8000-0000000000b1', 1, 1, 'On time', 10, ${criteria}),
        (gen_random_uuid(), '00000000-0000-4000-8000-0000000000b1', 2, 2, 'Accurate', 10, ${criteria}),
        (gen_random_uuid(), '00000000-0000-4000-8000-0000000000b1', 3, 3, 'Liked', 10, ${criteria}),
        (gen_random_uuid(), '00000000-0000-4000-8000-0000000000b1', 4, 4, 'Learning', 10, ${criteria}),
        (gen_random_uuid(), '00000000-0000-4000-8000-0000000000b2', 1, 3, 'Liked', 10, ${criteria});
      INSERT INTO kpi_scorecards (id, employee_id, employment_id, month, template_id, status, scorer, attendance_achieved, attendance_source, final_percent, level, pillars, updated_at)
        VALUES ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000001', '2026-09-01',
          '00000000-0000-4000-8000-0000000000b1', 'sign_off', 'hr', 20, 'none', 85, 'needs_improvement', '{"1": 50, "2": 100, "3": 100, "4": 90.5}', now());
    `);

    await db.query(sql(migration));

    const { rows: frameworks } = await db.query(`SELECT version, applies_from::text AS "appliesFrom", attendance_pillar AS "attendancePillar", pillars FROM kpi_frameworks`);
    expect(frameworks).toEqual([{ version: 1, appliesFrom: '2000-01-01', attendancePillar: 'discipline', pillars: KPI_PILLARS }]);
    const { rows: templates } = await db.query(`
      SELECT t.version, t.status, f.version AS framework, t.attendance_pillar AS "attendancePillar", t.pillars = f2.pillars AS "planPillars"
      FROM kpi_templates t LEFT JOIN kpi_frameworks f ON f.id = t.framework_id CROSS JOIN kpi_frameworks f2 ORDER BY t.version`);
    expect(templates).toEqual([
      { version: 1, status: 'published', framework: 1, attendancePillar: 'discipline', planPillars: true },
      // a draft keeps the pillars its metrics are in, and gets its framework when published
      { version: 2, status: 'draft', framework: null, attendancePillar: 'discipline', planPillars: true },
    ]);
    const { rows: metrics } = await db.query<{ pillar: string; wasIn: string | null }>(`
      SELECT m.pillar, m.was_in AS "wasIn" FROM kpi_metrics m JOIN kpi_templates t ON t.id = m.template_id ORDER BY t.version, m.position`);
    expect(metrics).toEqual(['delivery', 'quality', 'clients', 'discipline', 'clients'].map((pillar) => ({ pillar, wasIn: null })));
    const { rows: cards } = await db.query(`SELECT pillars FROM kpi_scorecards`);
    expect(cards).toEqual([{ pillars: { delivery: 50, quality: 100, clients: 100, discipline: 90.5 } }]);

    // a key as keys are written; only a metric in Unplaced says where it was; a published version has its framework; the
    // Attendance metric's pillar one of the pillars
    await expect(db.query(`UPDATE kpi_metrics SET pillar = 'Not A Key'`)).rejects.toThrow(/kpi_metrics_pillar_check/);
    await expect(db.query(`UPDATE kpi_metrics SET was_in = 'Clients & Teamwork'`)).rejects.toThrow(/kpi_metrics_was_in_check/);
    await db.query(`UPDATE kpi_metrics SET pillar = NULL, was_in = 'Clients & Teamwork' WHERE template_id = '00000000-0000-4000-8000-0000000000b2'`);
    await expect(db.query(`UPDATE kpi_templates SET framework_id = NULL WHERE status = 'published'`)).rejects.toThrow(/kpi_templates_framework_check/);
    await expect(db.query(`UPDATE kpi_frameworks SET attendance_pillar = 'growth'`)).rejects.toThrow(/kpi_frameworks_attendance_pillar_check/);
    await expect(
      db.query(`INSERT INTO kpi_frameworks (id, version, applies_from, pillars, attendance_pillar, updated_at) VALUES (gen_random_uuid(), 2, '2026-11-15', '[{"key": "all"}]', 'all', now())`),
    ).rejects.toThrow(/kpi_frameworks_applies_from_check/);
  });
});
