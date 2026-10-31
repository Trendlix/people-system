import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { OpenAPIObject } from '@nestjs/swagger';
import { APP_ENDPOINTS, appCalls, audiencesOf, moduleLabel } from './audiences.js';
import { basicCredentials, docsAccess } from './docs-access.js';
import { documentFor, handlerWords, whoMayCall } from './docs.js';
import { applyExamples, cleanExample, HIDDEN, mergeExamples } from './examples.js';

// The API documentation (owner, 31 October 2026: "Use Swagger to make apis documentation … /app /web and so on … Don't
// forget to add swagger examples on it too"; "Password-protected", "App / Website / Admin"): which page an endpoint is
// on, its section and who may call it, the examples cleaned and put in place, the sign-in in front of the pages, and the
// app's list kept in step with the Flutter app's code.

describe('the pages an endpoint is on', () => {
  const at = (method: string, path: string, more: Partial<Parameters<typeof audiencesOf>[0]> = {}) =>
    audiencesOf({ method, path, module: 'LeaveModule', roles: null, isPublic: false, ...more });

  it('puts the app’s on /app, anyone’s on /web, HR’s and the like on /admin', () => {
    expect(at('get', '/api/me/attendance/today')).toEqual(['app', 'web']);
    expect(at('get', '/api/leave/requests')).toEqual(['web']);
    expect(at('post', '/api/payroll/runs', { roles: ['hr', 'super_admin'] })).toEqual(['admin']);
    // a role list naming a manager is the website's (My Team), not only the admin panel's
    expect(at('get', '/api/kpis/team', { roles: ['manager', 'hr'] })).toEqual(['web']);
  });

  it('puts the webhooks and the connector on /admin, the public pages on /web', () => {
    expect(at('post', '/api/public/whatsapp/webhook', { module: 'WhatsAppModule', isPublic: true })).toEqual(['admin']);
    expect(at('post', '/api/connector/oauth/token', { module: 'ConnectorModule', isPublic: true })).toEqual(['admin']);
    expect(at('get', '/api/public/careers', { module: 'RecruitmentModule', isPublic: true })).toEqual(['web']);
    expect(at('post', '/api/auth/login', { module: 'AuthModule', isPublic: true })).toEqual(['app', 'web']);
  });

  it('matches the app’s list by method and path, any parameter name', () => {
    expect(appCalls('post', '/api/me/leave/requests/{id}/cancel')).toBe(true);
    expect(appCalls('get', '/api/me/leave/requests')).toBe(true);
    expect(appCalls('post', '/api/me/leave/requests')).toBe(true);
    expect(appCalls('patch', '/api/employees/{id}')).toBe(false);
    expect(appCalls('get', '/api/employees/{employeeId}')).toBe(true);
  });

  it('names each module’s section in words, and an endpoint without a comment by its handler', () => {
    expect(moduleLabel('ZohoPeopleModule')).toBe('Zoho People');
    expect(moduleLabel('AttendanceModule')).toBe('Attendance');
    expect(moduleLabel('ResignationRequestsModule')).toBe('Resignation requests');
    expect(moduleLabel('KpisModule')).toBe('KPIs');
    expect(handlerWords('listExclusions')).toBe('List exclusions');
    expect(handlerWords('mine')).toBe('Mine');
  });

  it('says who may call it', () => {
    expect(whoMayCall(null, true)).toBe('Anyone: no sign-in.');
    expect(whoMayCall(null, false)).toBe('Anyone signed in (the API checks what each may see or do).');
    expect(whoMayCall(['hr', 'super_admin'], false)).toBe('HR or Super Admin.');
  });
});

// the Flutter app's code names each endpoint it calls as '/api/…'; every one is in APP_ENDPOINTS
describe('the app’s list', () => {
  const dartFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? dartFiles(p) : p.endsWith('.dart') ? [p] : [];
    });

  it('has every path the Flutter app names', () => {
    const lib = new URL('../../../flutter/lib', import.meta.url).pathname;
    const shapes = new Set(APP_ENDPOINTS.map((e) => e.split(' ')[1]));
    const missing: string[] = [];
    for (const file of dartFiles(decodeURIComponent(lib))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/'(\/api\/[^'?]*)/g)) {
        const shape = m[1].replace(/\$\{[^}]*\}|\$\w+(\.\w+)*/g, '{x}').replace(/\/$/, '');
        // a base the app adds an action to ("/api/me/leave/requests/{x}/cancel") is listed with it
        if (!shapes.has(shape) && ![...shapes].some((s) => s.startsWith(`${shape}/`))) missing.push(`${shape} (${file.split('/lib/')[1]})`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('the examples', () => {
  it('blanks secrets, cuts long lists and texts', () => {
    const cleaned = cleanExample({
      email: 'mona@example.test',
      password: 'Secret123!',
      token: 'abc',
      refreshTokenEnc: 'x',
      session: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefGHIJ',
      items: [1, 2, 3, 4],
      note: 'a long note '.repeat(30),
      count: 3,
      isActive: true,
    }) as Record<string, unknown>;
    expect(cleaned).toMatchObject({ email: 'mona@example.test', password: HIDDEN, token: HIDDEN, refreshTokenEnc: HIDDEN, session: HIDDEN, items: [1, 2], count: 3, isActive: true });
    expect((cleaned.note as string).length).toBe(281);
  });

  it('keeps the richest success of each endpoint across runs', () => {
    const merged = mergeExamples([
      { 'A.list': { status: 400, response: { message: 'no' } } },
      { 'A.list': { status: 200, response: [{ id: 1 }] } },
      { 'A.list': { status: 200, response: [] }, 'B.one': { status: 201, body: { password: 'p' }, response: { id: 2 } } },
    ]);
    expect(merged['A.list']).toEqual({ status: 200, response: [{ id: 1 }] });
    expect(merged['B.one'].body).toEqual({ password: HIDDEN });
  });

  it('puts each in its operation: the parameters’ values, the body, the answer under its status', () => {
    const doc = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/api/x/{id}': {
          post: { operationId: 'X.make', parameters: [{ name: 'id', in: 'path' }, { name: 'month', in: 'query' }], responses: { '201': { description: '' } } },
        },
      },
    } as unknown as OpenAPIObject;
    applyExamples(doc, { 'X.make': { status: 201, params: { id: 'a1' }, query: { month: '2026-10' }, body: { name: 'N' }, response: { id: 'a1' } } });
    const op = (doc.paths['/api/x/{id}'] as Record<string, Record<string, unknown>>).post as {
      parameters: { example?: unknown }[];
      requestBody: { content: Record<string, { example: unknown }> };
      responses: Record<string, { content: Record<string, { example: unknown }> }>;
    };
    expect(op.parameters.map((p) => p.example)).toEqual(['a1', '2026-10']);
    expect(op.requestBody.content['application/json'].example).toEqual({ name: 'N' });
    expect(op.responses['201'].content['application/json'].example).toEqual({ id: 'a1' });
  });
});

describe('one page’s document', () => {
  it('keeps its endpoints, their sections, and only the schemas they use', () => {
    const full = {
      openapi: '3.0.0',
      info: { title: 'People System API', version: '1' },
      paths: {
        '/api/a': { get: { operationId: 'A.a', tags: ['Leave'], 'x-audiences': ['web'], responses: {} } },
        '/api/b': {
          post: { operationId: 'B.b', tags: ['Payroll'], 'x-audiences': ['admin'], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/PayDto' } } } }, responses: {} },
        },
      },
      components: { schemas: { PayDto: { type: 'object', properties: { line: { $ref: '#/components/schemas/LineDto' } } }, LineDto: { type: 'object' }, Unused: { type: 'object' } } },
    } as unknown as OpenAPIObject;
    const admin = documentFor(full, 'admin');
    expect(Object.keys(admin.paths)).toEqual(['/api/b']);
    expect(admin.tags).toEqual([{ name: 'Payroll' }]);
    expect(Object.keys(admin.components?.schemas ?? {}).sort()).toEqual(['LineDto', 'PayDto']);
    expect(admin.info.title).toBe('People System API · Admin panel');
    expect(Object.keys(documentFor(full, 'web').components?.schemas ?? {})).toEqual([]);
  });
});

describe('the sign-in in front of the pages', () => {
  const basic = (s: string) => `Basic ${Buffer.from(s).toString('base64')}`;
  const run = async (mw: ReturnType<typeof docsAccess>, header?: string) => {
    const res = { headers: {} as Record<string, string>, code: 200, body: '', setHeader(k: string, v: string) { this.headers[k] = v; }, status(c: number) { this.code = c; return this; }, type() { return this; }, send(b: string) { this.body = b; return this; } };
    let passed = false;
    await mw({ headers: { authorization: header } } as never, res as never, () => { passed = true; });
    return { passed, code: res.code, asks: !!res.headers['WWW-Authenticate'] };
  };

  it('reads the email and password', () => {
    expect(basicCredentials(basic('mona@example.test:pa:ss'))).toEqual({ email: 'mona@example.test', password: 'pa:ss' });
    expect(basicCredentials('Bearer x')).toBeNull();
    expect(basicCredentials(undefined)).toBeNull();
  });

  it('asks without one, refuses who isn’t a Super Admin or a developer, and remembers who is for 10 minutes', async () => {
    let checks = 0;
    let clock = 0;
    const auth = { docsSignIn: async (email: string) => { checks++; return email === 'admin@example.test' ? ({ id: 'u1' } as never) : null; } };
    const mw = docsAccess(auth, () => clock);
    expect(await run(mw)).toEqual({ passed: false, code: 401, asks: true });
    expect(await run(mw, basic('mona@example.test:x'))).toEqual({ passed: false, code: 401, asks: true });
    expect(await run(mw, basic('admin@example.test:right'))).toMatchObject({ passed: true });
    expect(await run(mw, basic('admin@example.test:right'))).toMatchObject({ passed: true });
    expect(checks).toBe(2);
    clock = 11 * 60 * 1000;
    await run(mw, basic('admin@example.test:right'));
    expect(checks).toBe(3);
  });
});
