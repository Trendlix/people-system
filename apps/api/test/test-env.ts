import 'dotenv/config';

// End-to-end tests run against TEST_DATABASE_URL, never the development database.
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set in apps/api/.env');
  if (url === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL');
  return url;
}
