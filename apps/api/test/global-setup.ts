import { execSync } from 'node:child_process';
import pg from 'pg';
import { assertTestDatabase, testDatabaseUrl } from './test-env.js';

// Prepares the test database at the start of each run: brings it up to the latest migration, empties every table, and
// loads what the tests rely on: roles, shifts, the grades G1–G9 and the company row (the seed, with no admin account).
// Each test file adds its own users. Emptied every run so test data never piles up: over 500 departments left by
// earlier runs had broken the department reorder test (15 October 2026).
export default async function setup() {
  const url = testDatabaseUrl(); // refuses a name without "test", or DATABASE_URL's database
  const schema = new URL(url).searchParams.get('schema') ?? 'public';

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // asked of the server too, before anything is deleted
    const { rows } = await client.query<{ name: string }>('SELECT current_database() AS name');
    assertTestDatabase(rows[0].name);

    // One run at a time: emptying the database would pull it from under another run. Held until this run ends, and
    // released by Postgres if the process stops.
    const { rows: lock } = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock(hashtext('people-system e2e')) AS ok");
    if (!lock[0].ok) throw new Error('Another end-to-end run is using the test database. Wait for it to finish, then run the tests again.');

    const env = { ...process.env, DATABASE_URL: url, SEED_ADMIN_EMAIL: '' };
    execSync('npx prisma migrate deploy', { env, stdio: 'pipe' });

    const { rows: tables } = await client.query<{ name: string }>(
      "SELECT tablename AS name FROM pg_tables WHERE schemaname = $1 AND tablename <> '_prisma_migrations'",
      [schema],
    );
    const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`;
    if (tables.length) {
      await client.query(`TRUNCATE TABLE ${tables.map((t) => `${quoted(schema)}.${quoted(t.name)}`).join(', ')} RESTART IDENTITY CASCADE`);
    }

    execSync('npx prisma db seed', { env, stdio: 'pipe' });
  } catch (err) {
    await client.end();
    throw err;
  }
  return async () => {
    await client.end();
  };
}
