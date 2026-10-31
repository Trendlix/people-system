import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AuthService } from '../src/auth/auth.service.js';
import { APP_ENDPOINTS, pathShape } from '../src/docs/audiences.js';
import { docsAccess } from '../src/docs/docs-access.js';
import { buildFullDocument, setupDocs } from '../src/docs/docs.js';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createUser, PASSWORD } from './helpers.js';

// The API documentation (owner, 31 October 2026: "Use Swagger to make apis documentation … /app /web and so on";
// "Password-protected"): made from the whole app without an error, every endpoint in a module's section and on a page,
// the app's list naming only endpoints there are; the pages behind a People sign-in of a Super Admin or a developer.

describe('API documentation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: string;
  let employee: string;
  const api = () => request(app.getHttpServer());
  const basic = (email: string, password = PASSWORD) => `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}`;

  beforeAll(async () => {
    // mounted before the app starts, as main.ts does (after, the API's own "not found" would answer first)
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    configureApp(app);
    app.use('/api/docs', docsAccess(app.get(AuthService)));
    setupDocs(app, 'test');
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createUser(prisma, ['super_admin']);
    employee = await createUser(prisma, ['employee']);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [admin, employee] } } });
    await app.close();
  });

  it('documents every endpoint, each in its module’s section and on a page; the app’s list names only real ones', () => {
    const doc = buildFullDocument(app, 'test');
    const ops = Object.entries(doc.paths).flatMap(([path, item]) =>
      Object.entries(item as Record<string, { tags?: string[]; summary?: string; 'x-audiences'?: string[] }>).map(([method, op]) => ({ method, path, op })),
    );
    expect(ops.length).toBeGreaterThan(700);
    expect(ops.filter((o) => !o.op.tags?.length || !o.op.summary || !o.op['x-audiences']?.length).map((o) => `${o.method} ${o.path}`)).toEqual([]);
    const unmatched = APP_ENDPOINTS.filter((entry) => {
      const [m, p] = entry.split(' ');
      return !ops.some((o) => pathShape(o.path) === p && (m === '*' || o.method === m.toLowerCase()));
    });
    expect(unmatched).toEqual([]);
  });

  it('asks for a sign-in, refuses an employee, and shows the pages to a Super Admin', async () => {
    const asked = await api().get('/api/docs').expect(401);
    expect(asked.headers['www-authenticate']).toMatch(/^Basic realm=/);
    await api().get('/api/docs/app').set('Authorization', basic(employee)).expect(401);
    await api().get('/api/docs/app').set('Authorization', basic(admin, 'wrong')).expect(401);
    const landing = await api().get('/api/docs').set('Authorization', basic(admin)).expect(200);
    expect(landing.text).toContain('/api/docs/admin');
    await api().get('/api/docs/web/').set('Authorization', basic(admin)).expect(200);
    for (const page of ['app', 'web', 'admin'] as const) {
      const json = (await api().get(`/api/docs/${page}/openapi.json`).set('Authorization', basic(admin)).expect(200)).body as { info: { title: string }; paths: Record<string, unknown>; tags: { name: string }[] };
      expect(json.info.title).toContain('People System API');
      expect(Object.keys(json.paths).length).toBeGreaterThan(10);
      expect(json.tags.length).toBeGreaterThan(5);
    }
    // the refusals are failed sign-ins, the opening is logged
    expect(await prisma.auditLog.count({ where: { action: 'api_docs_open' } })).toBeGreaterThan(0);
  });
});
