import { randomUUID } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StreamableFile, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { tap, type Observable } from 'rxjs';
import type { DocExamples } from './examples.js';

// The examples of the API documentation, recorded (owner, 31 October 2026: "Don't forget to add swagger examples on it
// too"): only while the end-to-end tests run with DOCS_RECORD set to a folder (`npm run docs:examples`), never on the
// server. Each endpoint's successful requests are noted by its operation ("AttendanceController.mine", as the
// documentation names it), the fullest kept, and written to the folder when the test process ends; examples.ts merges
// and cleans them into apps/api/docs/examples.json.

const recorded: DocExamples = {};
// this module's own file (the tests load it again for each test file), written a moment after each new example: the
// test runner may end its processes without their exit
const fileId = randomUUID();
let folder: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  timer = null;
  if (!folder || !Object.keys(recorded).length) return;
  // whole or not at all: written beside, then renamed over the last
  const file = join(folder, `examples-${fileId}.json`);
  writeFileSync(`${file}.part`, JSON.stringify(recorded));
  renameSync(`${file}.part`, file);
}

function soon(): void {
  if (timer || !folder) return;
  timer = setTimeout(flush, 250);
  timer.unref();
}

/** How full each kept example is (its answer and body as JSON), so a new one is measured once. */
const sizes = new Map<string, number>();
const json = (v: unknown): string | null => {
  try {
    return v === undefined ? null : (JSON.stringify(v) ?? null);
  } catch {
    return null;
  }
};

/** Notes each successful JSON answer with its request. */
export class ExampleRecorder implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const key = `${context.getClass().name}.${context.getHandler().name}`;
    const http = context.switchToHttp();
    const req = http.getRequest<{ query?: Record<string, unknown>; params?: Record<string, unknown>; body?: unknown }>();
    const res = http.getResponse<{ statusCode: number }>();
    return next.handle().pipe(
      tap((data) => {
        if (data instanceof StreamableFile || Buffer.isBuffer(data)) return;
        const answer = json(data);
        const body = req.body !== undefined && !Buffer.isBuffer(req.body) ? json(req.body) : null;
        const size = (answer?.length ?? 0) + (body?.length ?? 0);
        if (recorded[key] && size <= (sizes.get(key) ?? 0)) return;
        recorded[key] = {
          status: res.statusCode,
          ...(req.query && Object.keys(req.query).length && { query: { ...req.query } }),
          ...(req.params && Object.keys(req.params).length && { params: { ...req.params } }),
          ...(body !== null && { body: JSON.parse(body) as unknown }),
          ...(answer !== null && { response: JSON.parse(answer) as unknown }),
        };
        sizes.set(key, size);
        soon();
      }),
    );
  }
}


/** Writes what is recorded to `to` (a file of this module's), a moment after each new example and at the end. */
export function recordExamplesTo(to: string): void {
  if (folder) return;
  folder = to;
  process.on('exit', flush);
}
