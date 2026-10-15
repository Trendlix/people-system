import 'dotenv/config';

/** The name of the database a connection URL points to, e.g. trendlix_hrms_test. */
export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

// End-to-end tests run against TEST_DATABASE_URL, never the development database.
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set in apps/api/.env');
  const main = process.env.DATABASE_URL;
  if (main && (url === main || databaseName(url) === databaseName(main))) {
    throw new Error('TEST_DATABASE_URL must point to another database than DATABASE_URL');
  }
  assertTestDatabase(databaseName(url));
  return url;
}

/**
 * Refuses unless `name` is a test database's: it must contain "test". Checked before anything is deleted, so the
 * development and production databases (trendlix_hrms) are never emptied by the tests.
 */
export function assertTestDatabase(name: string): void {
  if (!/test/i.test(name)) {
    throw new Error(`Refusing to use the database "${name}" for tests: the test database's name must contain "test". Check TEST_DATABASE_URL.`);
  }
}
