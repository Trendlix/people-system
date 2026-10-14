import { execSync } from 'node:child_process';
import { testDatabaseUrl } from './test-env.js';

// Brings the test database up to the latest migration and loads roles and shifts (no admin account).
// Nothing is deleted: tests use unique names per run, so earlier test data does not get in the way.
export default function setup() {
  const env = { ...process.env, DATABASE_URL: testDatabaseUrl(), SEED_ADMIN_EMAIL: '' };
  execSync('npx prisma migrate deploy', { env, stdio: 'pipe' });
  execSync('npx prisma db seed', { env, stdio: 'pipe' });
}
