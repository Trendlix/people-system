import type { OpenAPIObject } from '@nestjs/swagger';

// The API documentation's examples (owner, 31 October 2026: "Don't forget to add swagger examples on it too"): one
// request and its answer for each endpoint, recorded as the API really had them while the end-to-end tests ran
// (example-recorder.ts, `npm run docs:examples`), on the tests' own invented people and data. Kept in
// apps/api/docs/examples.json by the endpoint's operation ("AttendanceController.mine"); before they are kept, every
// password, token, key, secret and signature is blanked, long lists cut to their first items and long texts shortened.
// Pure, tested (docs.spec.ts).

/** One endpoint's example: the query, the path's parameters, the body sent, and the answer with its status. */
export interface RecordedExample {
  status: number;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
  body?: unknown;
  response?: unknown;
}

/** The examples, by operation ("AttendanceController.mine"). */
export type DocExamples = Record<string, RecordedExample>;

/** A field whose value is never shown: a password, a token, a key, a secret, a signature, a one-time code. */
const SECRET_KEY = /pass(word)?|token|secret|api[-_]?key|^key$|Key$|authori[sz]ation|cookie|signature|otp|verifier|credential|hash/i;
/** A value that looks like a token anyway: a JWT, or a long run of letters and digits. */
const SECRET_VALUE = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$|^[A-Za-z0-9+/_-]{48,}={0,2}$/;
export const HIDDEN = '••••••';
const MOST_ITEMS = 2;
const LONGEST_TEXT = 280;

/** A value made fit to show: secrets blanked, lists cut to their first items, long texts shortened. */
export function cleanExample(value: unknown, key = '', depth = 0): unknown {
  if (depth > 12) return '…';
  if (SECRET_KEY.test(key) && value !== null && value !== undefined && typeof value !== 'boolean' && typeof value !== 'number') return HIDDEN;
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) return HIDDEN;
    return value.length > LONGEST_TEXT ? `${value.slice(0, LONGEST_TEXT)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, MOST_ITEMS).map((v) => cleanExample(v, key, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, cleanExample(v, k, depth + 1)]));
  }
  return value;
}

/** How much an example shows: the better of two kept (a success over a refusal, then the fuller). */
const richness = (e: RecordedExample) => (e.status < 300 ? 1_000_000 : 0) + JSON.stringify(e.response ?? null).length + JSON.stringify(e.body ?? null).length;

/** The examples of several test runs as one: for each operation the richest success, cleaned. */
export function mergeExamples(runs: readonly DocExamples[]): DocExamples {
  const out: DocExamples = {};
  for (const run of runs) {
    for (const [key, e] of Object.entries(run)) {
      if (!out[key] || richness(e) > richness(out[key])) out[key] = e;
    }
  }
  return Object.fromEntries(
    Object.entries(out)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, e]) => [key, cleanExample(e) as RecordedExample]),
  );
}

type Op = { operationId?: string; parameters?: { name: string; in: string; example?: unknown }[]; requestBody?: { content?: Record<string, { example?: unknown; schema?: unknown }> }; responses?: Record<string, { description?: string; content?: Record<string, { example?: unknown; schema?: unknown }> }> };

/** Puts each operation's example in the document: its parameters' values, its body, its answer under its status. */
export function applyExamples(doc: OpenAPIObject, examples: DocExamples): void {
  for (const item of Object.values(doc.paths)) {
    for (const op of Object.values(item as Record<string, Op>)) {
      if (!op || typeof op !== 'object' || !op.operationId) continue;
      const e = examples[op.operationId];
      if (!e) continue;
      for (const p of op.parameters ?? []) {
        const from = p.in === 'query' ? e.query : p.in === 'path' ? e.params : undefined;
        if (from && from[p.name] !== undefined) p.example = from[p.name];
      }
      if (e.body !== undefined && e.body !== null && !(typeof e.body === 'object' && !Object.keys(e.body as object).length)) {
        const content = (op.requestBody ??= { content: {} }).content ?? (op.requestBody.content = {});
        const json = (content['application/json'] ??= { schema: { type: 'object' } });
        json.example = e.body;
      }
      if (e.response !== undefined) {
        const responses = (op.responses ??= {});
        const answer = (responses[String(e.status)] ??= { description: 'Example answer' });
        const content = (answer.content ??= {});
        (content['application/json'] ??= {}).example = e.response;
      }
    }
  }
}
