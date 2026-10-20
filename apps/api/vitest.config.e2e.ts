import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/test-env.js';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // WEB_KEY: the key the website signs a check-in's address with (deploy/web-key.sh; check-ins locked to the office
    // network, 20 October 2026), a made-up one for the tests; check-in-setup.e2e-spec.ts takes it away to test without it
    env: { DATABASE_URL: testDatabaseUrl(), WEB_KEY: 'e2e-web-key-for-tests-only-0123456789abcdefghijklmnop' },
    // Test files share one database, so run them one after another.
    fileParallelism: false,
  },
});
