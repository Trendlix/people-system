import { readFileSync } from 'node:fs';
import { Logger, type INestApplication } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { APP_USER_AGENT_MARK, BACKGROUND_HEADER, CLIENT_IP_AT_HEADER, CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER, ROLE_LABELS, type Role } from '@trendlix/shared';
import { CAREERS_KEY_HEADER } from '../recruitment/careers-key.guard.js';
import { IS_PUBLIC, REQUIRED_ROLES } from '../auth/decorators.js';
import { SESSION_COOKIE } from '../auth/session-user.js';
import { audiencesOf, DOC_AUDIENCE_INFO, DOC_AUDIENCES, moduleLabel, type DocAudience } from './audiences.js';
import { applyExamples, type DocExamples } from './examples.js';

// The API's documentation (owner, 31 October 2026: "Use Swagger to make apis documentation. Respect Queries,
// Parameters, Body and Headers … Each one is a separated link on the swagger base /app /web and so on. Each link has
// its own page which display the components. Each components refer to a module with its endpoints. Don't forget to add
// swagger examples on it too"; asked, "Password-protected" and "App / Website / Admin"). One OpenAPI document of every
// endpoint, from the controllers and their DTOs (the Swagger CLI plugin, nest-cli.json: each DTO's fields, types,
// validation and comments; each endpoint's comment as its summary), then:
// - each endpoint's section is its module ("Attendance", "Leave" …), its pages by who may call it (audiences.ts), who
//   may call it said in words, and the public ones without a session;
// - the examples recorded from the end-to-end tests (examples.ts), each request and answer as the API really had them;
// - a page each at /api/docs/app, /api/docs/web and /api/docs/admin (each with only its schemas), and /api/docs listing
//   them; its JSON at …/openapi.json. Behind a People sign-in (docs-access.ts).

type Operation = Record<string, unknown> & { operationId?: string; tags?: string[]; description?: string; summary?: string; security?: unknown[]; parameters?: Header[] };
type Header = { name: string; in: string; required?: boolean; description?: string; schema?: unknown; example?: unknown };

const header = (name: string, description: string, required = false, example?: string): Header => ({ name, in: 'header', required, description, schema: { type: 'string' }, ...(example && { example }) });

/** The address the website signed for a check-in (packages/shared office-network.ts): its three headers. */
const SIGNED_ADDRESS: Header[] = [
  header(CLIENT_IP_HEADER, 'The visitor’s address as the website saw it. Sent by the website’s server only; the app’s check-in uses its own connection’s.', false, '197.45.12.8'),
  header(CLIENT_IP_AT_HEADER, 'When the website signed the address (milliseconds since 1970), within a minute of the API’s clock.', false, '1793451017622'),
  header(CLIENT_IP_SIGNATURE_HEADER, 'HMAC-SHA256 with WEB_KEY over the address, the time and the session token’s SHA-256 (base64url).'),
];

/**
 * The headers an endpoint reads besides the session (owner, 31 October 2026: "Respect … Headers"): every signed-in one
 * the website's background header; signing in the User-Agent (the app's is a session of its own); a check-in and the
 * office network's setup the address the website signed; the careers site its key; the webhooks their signatures.
 */
function headersOf(controller: string, handler: string, cls: object | undefined, isPublic: boolean): Header[] {
  const out: Header[] = [];
  if (!isPublic) out.push(header(BACKGROUND_HEADER, '"1" on a request the website makes by itself (the sidebar’s counts, the idle check): it doesn’t count as activity, so a page left open doesn’t keep a session alive.', false, '1'));
  if (controller === 'AuthController' && ['login', 'deviceSignIn'].includes(handler)) {
    out.push(header('User-Agent', `Ends with "${APP_USER_AGENT_MARK}" in the Trendlix People app: the session is the app’s (one of each kind at a time).`, false, `Dart/3.9 (dart:io) ${APP_USER_AGENT_MARK}`));
  }
  if ((controller === 'CheckInController' && handler === 'punch') || (controller === 'CheckInSetupController' && ['networks', 'updateNetworks'].includes(handler))) out.push(...SIGNED_ADDRESS);
  const guards = cls ? ((Reflect.getMetadata(GUARDS_METADATA, cls) as { name?: string }[] | undefined) ?? []) : [];
  if (guards.some((g) => g?.name === 'CareersKeyGuard')) out.push(header(CAREERS_KEY_HEADER, 'The careers site’s key (CAREERS_KEY on the server): the careers pages’ server sends it.', true));
  if (controller === 'WhatsAppWebhookController' && handler === 'receive') out.push(header('x-hub-signature-256', 'Meta’s signature of the exact body (sha256=…), checked with the app secret.', true));
  if (controller === 'WhatsAppTwilioWebhookController') out.push(header('x-twilio-signature', 'Twilio’s signature of the URL and its parameters, checked with the auth token.', true));
  return out;
}
const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head'] as const;

/** Where each controller is: its module and its class, by the class's name. */
function controllersOf(app: INestApplication): Map<string, { module: string; cls: { prototype: Record<string, unknown> } }> {
  const out = new Map<string, { module: string; cls: { prototype: Record<string, unknown> } }>();
  for (const mod of app.get(ModulesContainer).values()) {
    const module = mod.metatype?.name ?? 'AppModule';
    for (const wrapper of mod.controllers.values()) {
      const cls = wrapper.metatype as unknown as { name: string; prototype: Record<string, unknown> } | null;
      if (cls) out.set(cls.name, { module, cls });
    }
  }
  return out;
}

/** A handler's name in words: "listExclusions" → "List exclusions", "mine" → "Mine". */
export function handlerWords(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

/** "HR, Finance or a Super Admin", from an endpoint's roles; null when anyone signed in may. */
export function whoMayCall(roles: readonly Role[] | null, isPublic: boolean): string {
  if (isPublic) return 'Anyone: no sign-in.';
  if (!roles?.length) return 'Anyone signed in (the API checks what each may see or do).';
  const names = roles.map((r) => ROLE_LABELS[r] ?? r);
  return `${names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0]}.`;
}

/** Every endpoint in one document, each with its module's section, its pages, who may call it, and its examples. */
export function buildFullDocument(app: INestApplication, version: string, examples: DocExamples = {}): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('People System API')
    .setDescription('Trendlix People: the HR system’s API.')
    .setVersion(version)
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'The session token: from POST /api/auth/login (`token`), or the website’s server.' }, 'session')
    .addCookieAuth(SESSION_COOKIE, { type: 'apiKey', in: 'cookie', description: 'The API’s own session cookie, set by POST /api/auth/login.' }, 'cookie')
    .build();
  const doc = SwaggerModule.createDocument(app, config, { operationIdFactory: (controller, method) => `${controller}.${method}` });
  doc.security = [{ session: [] }, { cookie: [] }];
  const controllers = controllersOf(app);
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const op = (item as Record<string, Operation | undefined>)[method];
      if (!op?.operationId) continue;
      const [controllerName, handlerName] = op.operationId.split('.');
      const found = controllers.get(controllerName);
      const handler = found?.cls.prototype[handlerName] as object | undefined;
      const read = <T>(key: string): T | undefined => (handler ? (Reflect.getMetadata(key, handler) as T | undefined) : undefined) ?? (found ? (Reflect.getMetadata(key, found.cls) as T | undefined) : undefined);
      const roles = read<Role[]>(REQUIRED_ROLES) ?? null;
      const isPublic = read<boolean>(IS_PUBLIC) === true;
      const module = found?.module ?? 'AppModule';
      op.tags = [moduleLabel(module)];
      // an endpoint without a comment of its own: its handler's name in words ("listExclusions" → "List exclusions")
      if (!op.summary) op.summary = handlerWords(handlerName ?? '');
      op['x-audiences'] = audiencesOf({ method, path, module, roles, isPublic });
      op.description = [op.description, `**Who may call:** ${whoMayCall(roles, isPublic)}`].filter(Boolean).join('\n\n');
      if (isPublic) op.security = [];
      const headers = headersOf(controllerName, handlerName, found?.cls, isPublic);
      if (headers.length) op.parameters = [...(op.parameters ?? []), ...headers.filter((h) => !(op.parameters ?? []).some((p) => p.in === 'header' && p.name.toLowerCase() === h.name.toLowerCase()))];
    }
  }
  applyExamples(doc, examples);
  return doc;
}

/** The refs (#/components/schemas/X) a part of the document names, followed through the schemas. */
function schemasUsed(doc: OpenAPIObject, start: unknown): Set<string> {
  const used = new Set<string>();
  const schemas = (doc.components?.schemas ?? {}) as Record<string, unknown>;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (k === '$ref' && typeof x === 'string' && x.startsWith('#/components/schemas/')) {
        const name = x.slice('#/components/schemas/'.length);
        if (!used.has(name)) {
          used.add(name);
          walk(schemas[name]);
        }
      } else walk(x);
    }
  };
  walk(start);
  return used;
}

/** One page's document: its endpoints, its sections in order, only the schemas they use. */
export function documentFor(full: OpenAPIObject, audience: DocAudience): OpenAPIObject {
  const doc = structuredClone(full) as OpenAPIObject;
  doc.info = { ...doc.info, title: DOC_AUDIENCE_INFO[audience].title, description: DOC_AUDIENCE_INFO[audience].description };
  const tags = new Set<string>();
  for (const [path, item] of Object.entries(doc.paths)) {
    const kept = item as Record<string, Operation | undefined>;
    for (const method of METHODS) {
      const op = kept[method];
      if (!op) continue;
      if (!(op['x-audiences'] as DocAudience[] | undefined)?.includes(audience)) delete kept[method];
      else op.tags?.forEach((t) => tags.add(t));
    }
    if (!METHODS.some((m) => kept[m])) delete doc.paths[path];
  }
  doc.tags = [...tags].sort((a, b) => a.localeCompare(b)).map((name) => ({ name }));
  const used = schemasUsed(doc, doc.paths);
  const schemas = (doc.components?.schemas ?? {}) as Record<string, unknown>;
  for (const name of Object.keys(schemas)) if (!used.has(name)) delete schemas[name];
  return doc;
}

/** The examples recorded from the end-to-end tests (apps/api/docs/examples.json), none when the file isn't there. */
export function readExamples(): DocExamples {
  try {
    return JSON.parse(readFileSync(new URL('../../docs/examples.json', import.meta.url), 'utf8')) as DocExamples;
  } catch {
    return {};
  }
}

/** /api/docs: the three pages, and how to try an endpoint. */
export function landingHtml(): string {
  const links = DOC_AUDIENCES.map((a) => `<li><a href="/api/docs/${a}">/${a}</a> · ${DOC_AUDIENCE_INFO[a].title.split(' · ')[1]}<br><small>${DOC_AUDIENCE_INFO[a].description.replace(/`/g, '')}</small></li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>People System API</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#111}a{color:#111;font-weight:600}li{margin:0 0 16px}small{color:#666}code{background:#eee;padding:1px 4px;border-radius:4px}</style></head>
<body><h1>People System API</h1><p>Each page lists its endpoints by module, with their parameters, bodies, headers and examples.</p><ul>${links}</ul>
<p>To try an endpoint: sign in with <code>POST /api/auth/login</code> (Try it out); its answer’s <code>token</code> goes in <b>Authorize</b> → <i>session</i>. Requests are made as you, on the live system.</p></body></html>`;
}

/**
 * Mounts the pages (main.ts), each with its JSON, once the app's routes are known. A documentation that can't be made
 * never stops the API: /api/docs then says so, and the reason is logged.
 */
export function setupDocs(app: INestApplication, version: string): void {
  const http = app.getHttpAdapter();
  let full: OpenAPIObject;
  try {
    full = buildFullDocument(app, version, readExamples());
  } catch (e) {
    new Logger('Docs').error(`The API documentation couldn't be made: ${(e as Error).message}`);
    http.get('/api/docs', (_req: unknown, res: { status: (n: number) => { type: (t: string) => { send: (s: string) => void } } }) =>
      res.status(503).type('text').send('The API documentation couldn’t be made on this version. The API itself works.'),
    );
    return;
  }
  http.get('/api/docs', (_req: unknown, res: { type: (t: string) => { send: (s: string) => void } }) => res.type('html').send(landingHtml()));
  for (const audience of DOC_AUDIENCES) {
    SwaggerModule.setup(`api/docs/${audience}`, app, documentFor(full, audience), {
      jsonDocumentUrl: `api/docs/${audience}/openapi.json`,
      yamlDocumentUrl: `api/docs/${audience}/openapi.yaml`,
      customSiteTitle: DOC_AUDIENCE_INFO[audience].title,
      // TrendLIX's mark in the tab, the website's (31 October 2026)
      customfavIcon: 'https://people.trendlix.com/favicon.ico',
      swaggerOptions: { persistAuthorization: true, docExpansion: 'none', filter: true, tagsSorter: 'alpha', displayRequestDuration: true, tryItOutEnabled: false },
    });
  }
}
