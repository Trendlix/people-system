import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
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
});
