import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/test-env.js';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    env: { DATABASE_URL: testDatabaseUrl() },
    // Test files share one database, so run them one after another.
    fileParallelism: false,
  },
});
