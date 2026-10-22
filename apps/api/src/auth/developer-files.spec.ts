import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Developer role (owner, 22 October 2026: "Money and personal IDs" hidden): every route that answers with a file is
// marked, so a developer is refused it before it runs (@NotForDevelopers) or given it as it is (@DeveloperMaySee: a
// picture or a blank template, nothing personal). The interceptor refuses an unmarked file too, after it was made; this
// keeps every file route marked, so none is made for a developer at all.

const SRC = fileURLToPath(new URL('..', import.meta.url));

function controllers(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : controllers(path);
    return name.endsWith('.controller.ts') ? [path] : [];
  });
}

/** Each route of a controller: its decorators and body, up to the next route. */
function routes(source: string): string[] {
  const starts = [...source.matchAll(/^\s*@(Get|Post|Put|Patch|Delete)\(/gm)].map((m) => m.index!);
  return starts.map((start, i) => {
    // the decorators above the route decorator belong to it: back to the end of the previous method
    const before = source.lastIndexOf('}', start);
    return source.slice(before === -1 ? 0 : before, starts[i + 1] ?? source.length);
  });
}

describe('the files a developer may or may not receive', () => {
  it('marks every route answering with a file, one way or the other', () => {
    const unmarked: string[] = [];
    for (const file of controllers(SRC)) {
      for (const route of routes(readFileSync(file, 'utf8'))) {
        const answersFile = /StreamableFile\(|pdfFile\(/.test(route);
        if (!answersFile) continue;
        if (!/@NotForDevelopers\(\)|@DeveloperMaySee\(\)/.test(route)) unmarked.push(`${file.slice(SRC.length)}: ${route.match(/@(Get|Post|Put|Patch|Delete)\([^)]*\)/)?.[0]}`);
      }
    }
    expect(unmarked).toEqual([]);
  });
});
