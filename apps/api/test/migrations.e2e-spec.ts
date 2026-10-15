import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENDING_RULE_DEFAULTS, ENDING_RULES } from '@trendlix/shared';
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
    expect(rules).toEqual(ENDING_RULES.map((key, i) => ({ key, ...ENDING_RULE_DEFAULTS[key], active: true, sortOrder: i + 1 })));

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
});
