import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeExamples, type DocExamples } from './examples.js';

// `npm run docs:examples` (owner, 31 October 2026: "Don't forget to add swagger examples on it too"): runs the
// end-to-end tests with the recorder on (example-recorder.ts; the test database only, as the tests always use), then
// merges what each test process recorded into apps/api/docs/examples.json, cleaned (examples.ts). Run it again when
// endpoints change; the documentation reads the file when the API starts.

const folder = mkdtempSync(join(tmpdir(), 'people-docs-'));
try {
  try {
    execSync('npx vitest run --config ./vitest.config.e2e.ts', { stdio: 'inherit', env: { ...process.env, DOCS_RECORD: folder } });
  } catch {
    console.warn('Some end-to-end tests failed: the examples of those that passed are kept.');
  }
  // a file a test process left unfinished is skipped
  const runs = readdirSync(folder)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      try {
        return [JSON.parse(readFileSync(join(folder, f), 'utf8')) as DocExamples];
      } catch {
        return [];
      }
    });
  const merged = mergeExamples(runs);
  mkdirSync(new URL('../../docs/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../../docs/examples.json', import.meta.url), `${JSON.stringify(merged, null, 1)}\n`);
  console.log(`docs/examples.json: ${Object.keys(merged).length} endpoints with an example.`);
} finally {
  rmSync(folder, { recursive: true, force: true });
}
