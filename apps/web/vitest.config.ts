import { defineConfig } from 'vitest/config';

// Unit tests of the web app's pure code (e.g. the card geometry of the ID scan). Pages are checked in the browser.
export default defineConfig({
  // the app's "@/…" imports, as tsconfig.json maps them (a module a test loads may use them, e.g. employees/avatar.tsx)
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
