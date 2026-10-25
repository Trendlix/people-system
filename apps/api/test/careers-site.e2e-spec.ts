import type { INestApplication } from '@nestjs/common';
import { CAREERS_SITE_STANDARD, type RecruitmentSettingsView, type Role } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Recruitment Settings' "Careers site address" (owner, 25 October 2026: the careers pages moved to the main website,
// www.trendlix.com/en/careers, and people.trendlix.com/careers only redirects there; the owner asked that the links stop
// relying on the redirect; packages/shared careers-base.ts). The standard until one is set; HR and a Super Admin change
// it, the CEO reads it, nobody else; an https address with no query, refused in words otherwise; each change audited
// from and to. The links that follow it: the invitation to apply's and a vacancy's (suggested-cvs.e2e-spec.ts), and
// LinkedIn's redirect URL (careers-prefill.e2e-spec.ts). The other address here is made up.

const SITE = 'https://careers.example.test/jobs';
const STANDARD = `${CAREERS_SITE_STANDARD} (standard)`;

describe('Recruitment Settings: the careers site’s address (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  let kept: string | null = null;
  const STARTED = new Date();

  const get = (as: string) => api().get('/api/recruitment/settings').set('Cookie', sessions[as]);
  const patch = (as: string, body: object) => api().patch('/api/recruitment/settings').set('Cookie', sessions[as]).send(body);
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  const siteOf = async (as = 'hr') => ((await get(as).expect(200)).body as RecruitmentSettingsView).careersSite;
  const audits = () =>
    prisma.auditLog.findMany({ where: { entityType: 'recruitment_settings', at: { gte: STARTED }, userId: { in: Object.values(users) } }, orderBy: { at: 'asc' }, select: { userId: true, action: true, diff: true } });

  async function account(key: string, roles: Role[]) {
    const e = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email: e }, select: { id: true } })).id;
    sessions[key] = await signIn(app, e);
    return e;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await account('superAdmin', ['super_admin']);
    await account('outsider', ['employee']);
    const devEmail = await account('developer', ['employee']);
    await api().patch(`/api/users/${users.developer}`).set('Cookie', sessions.superAdmin).send({ roles: ['employee', 'developer'] }).expect(200);
    sessions.developer = await signIn(app, devEmail);
    // the standard before this file's cases, put back as it was after them
    kept = (await prisma.recruitmentSettings.findUnique({ where: { id: 1 }, select: { careersSite: true } }))?.careersSite ?? null;
    await prisma.recruitmentSettings.updateMany({ where: { id: 1 }, data: { careersSite: null } });
  });

  afterAll(async () => {
    await prisma.recruitmentSettings.updateMany({ where: { id: 1 }, data: { careersSite: kept } });
    await app.close();
  });

  it('shows the standard until one is set: HR, the CEO and a Super Admin read it, nobody else', async () => {
    const standard = { set: null, standard: CAREERS_SITE_STANDARD, address: CAREERS_SITE_STANDARD };
    expect(CAREERS_SITE_STANDARD).toBe('https://www.trendlix.com/en/careers');
    expect(await siteOf('hr')).toEqual(standard);
    expect(await siteOf('ceo')).toEqual(standard);
    expect(await siteOf('superAdmin')).toEqual(standard);
    await get('outsider').expect(403);
  });

  it('refuses an address that isn’t https, has a query or a fragment, or isn’t one, in words; nothing kept', async () => {
    const https = 'Write the careers site’s address in full, starting with https://, e.g. https://www.trendlix.com/en/careers.';
    expect(said(await patch('hr', { careersSite: 'http://careers.example.test/jobs' }).expect(400))).toEqual([https]);
    expect(said(await patch('hr', { careersSite: 'careers.example.test/jobs' }).expect(400))).toEqual([https]);
    expect(said(await patch('hr', { careersSite: `${SITE}?src=hr` }).expect(400))).toEqual(['Leave out the part from ? or # in the careers site’s address: the links add their own.']);
    expect(said(await patch('hr', { careersSite: `${SITE}#open` }).expect(400))).toEqual(['Leave out the part from ? or # in the careers site’s address: the links add their own.']);
    expect(said(await patch('hr', { careersSite: 'https://careers/jobs' }).expect(400))).toEqual(['Write the careers site’s address as its job list’s page, e.g. https://www.trendlix.com/en/careers.']);
    expect(said(await patch('hr', { careersSite: 'https://careers.example.test/our jobs' }).expect(400))).toEqual([
      'Write the careers site’s address as its job list’s page, e.g. https://www.trendlix.com/en/careers.',
    ]);
    expect(said(await patch('hr', { careersSite: `https://careers.example.test/${'a'.repeat(200)}` }).expect(400))).toEqual(['Keep the careers site’s address to 200 characters or fewer.']);
    expect(said(await patch('hr', { careersSite: `https://careers.example.test/${'a'.repeat(500)}` }).expect(400))).toEqual(['Keep the careers site’s address to 200 characters or fewer.']);
    expect(said(await patch('hr', { careersSite: 5 }).expect(400))).toContain(https);
    // with another field: neither kept
    await patch('hr', { careersSite: 'http://careers.example.test', suggestMonths: 6 }).expect(400);
    expect((await get('hr').expect(200)).body).toMatchObject({ suggestions: { recencyMonths: 12 }, careersSite: { set: null, address: CAREERS_SITE_STANDARD } });
    expect(await audits()).toEqual([]);
  });

  it('HR and a Super Admin change it, each change audited from and to; the CEO, an employee and a developer can’t', async () => {
    await patch('ceo', { careersSite: SITE }).expect(403);
    await patch('outsider', { careersSite: SITE }).expect(403);
    await patch('developer', { careersSite: SITE }).expect(403);
    expect((await siteOf())?.set).toBeNull();

    // trimmed, without its slash at the end, its host in lower case
    const saved = (await patch('hr', { careersSite: '  https://Careers.Example.test/jobs/  ' }).expect(200)).body as RecruitmentSettingsView;
    expect(saved.careersSite).toEqual({ set: SITE, standard: CAREERS_SITE_STANDARD, address: SITE });
    expect(await siteOf('ceo')).toEqual({ set: SITE, standard: CAREERS_SITE_STANDARD, address: SITE });
    expect(await prisma.recruitmentSettings.findUniqueOrThrow({ where: { id: 1 }, select: { careersSite: true } })).toEqual({ careersSite: SITE });
    let log = await audits();
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual({ userId: users.hr, action: 'update', diff: { careersSite: { from: STANDARD, to: SITE } } });

    // the same again: nothing changed, nothing audited; another field left it as it was
    await patch('hr', { careersSite: `${SITE}/` }).expect(200);
    expect((await audits()).length).toBe(1);
    expect(((await patch('hr', { suggestMonths: 6 }).expect(200)).body as RecruitmentSettingsView).careersSite?.address).toBe(SITE);
    await patch('hr', { suggestMonths: 12 }).expect(200);

    // emptied by a Super Admin: back to the standard
    const back = (await patch('superAdmin', { careersSite: '' }).expect(200)).body as RecruitmentSettingsView;
    expect(back.careersSite).toEqual({ set: null, standard: CAREERS_SITE_STANDARD, address: CAREERS_SITE_STANDARD });
    log = await audits();
    expect(log.at(-1)).toEqual({ userId: users.superAdmin, action: 'update', diff: { careersSite: { from: SITE, to: STANDARD } } });

    // the standard typed in keeps none: still the standard, nothing to audit
    const count = log.length;
    expect(((await patch('hr', { careersSite: `${CAREERS_SITE_STANDARD}/` }).expect(200)).body as RecruitmentSettingsView).careersSite?.set).toBeNull();
    expect((await audits()).length).toBe(count);
  });
});
