import { defineConfig } from 'vitest/config';

// Unit tests of the web app's pure code (e.g. the card geometry of the ID scan). Pages are checked in the browser.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
