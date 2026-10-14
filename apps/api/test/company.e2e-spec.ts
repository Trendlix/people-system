import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// A real 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('Company profile (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let employee: string;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    employee = await signIn(app, await createUser(prisma, ['employee']));
  });

  afterAll(async () => {
    await app.close();
  });

  it('is seeded from the contract template and readable by everyone signed in', async () => {
    const res = await api().get('/api/company').set('Cookie', employee).expect(200);
    expect(res.body).toMatchObject({ nameEn: expect.any(String), hasLogo: expect.any(Boolean) });
    expect(res.body).not.toHaveProperty('logo');
    expect(res.body).not.toHaveProperty('repNationalId');
  });

  it('needs a session to read, but the brand (name and logo version) is public', async () => {
    await api().get('/api/company').expect(401);
    const brand = await api().get('/api/company/brand').expect(200);
    expect(Object.keys(brand.body).sort()).toEqual(['logoVersion', 'nameAr', 'nameEn']);
  });

  it('lets HR edit it, but not employees', async () => {
    await api().patch('/api/company').set('Cookie', employee).send({ phone: '0100' }).expect(403);
    const res = await api()
      .patch('/api/company')
      .set('Cookie', hr)
      .send({ phone: ' 0225555555 ', website: 'trendlix.com', email: 'hr@trendlix.com', addressEn: '' })
      .expect(200);
    expect(res.body).toMatchObject({ phone: '0225555555', website: 'trendlix.com', email: 'hr@trendlix.com', addressEn: null });
  });

  it('rejects invalid values', async () => {
    await api().patch('/api/company').set('Cookie', hr).send({ nameEn: '  ' }).expect(400);
    await api().patch('/api/company').set('Cookie', hr).send({ email: 'not-an-email' }).expect(400);
    await api().patch('/api/company').set('Cookie', hr).send({ repNationalId: '12345' }).expect(400);
    await api().patch('/api/company').set('Cookie', hr).send({ logo: 'x' }).expect(400);
  });

  it('stores the representative national ID but only ever returns it masked, and keeps it out of the audit log', async () => {
    // New number each run: the test database keeps the value from earlier runs, and an unchanged value is not logged.
    const nationalId = '2' + String(Date.now()).padStart(13, '0').slice(-13);
    const arabicDigits = nationalId.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
    const res = await api()
      .patch('/api/company')
      .set('Cookie', hr)
      .send({ repName: 'أحمد محمد', repNationalId: arabicDigits }) // Arabic digits are accepted
      .expect(200);
    expect(res.body.repNationalIdMasked).toBe(`•••••••••• ${nationalId.slice(-4)}`);
    expect(JSON.stringify(res.body)).not.toContain(nationalId);

    const row = await prisma.company.findUniqueOrThrow({ where: { id: 1 } });
    expect(row.repNationalId).toBe(nationalId);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'company' }, orderBy: { id: 'desc' } });
    expect(JSON.stringify(entry.diff)).not.toContain(nationalId);
    expect(entry.diff).toMatchObject({ repNationalId: 'changed' });
  });

  describe('logo', () => {
    it('accepts a real PNG, serves it publicly with safe headers, and bumps the logo version', async () => {
      const before = (await api().get('/api/company/brand')).body.logoVersion;
      await api().put('/api/company/logo').set('Cookie', hr).attach('file', PNG, 'logo.png').expect(200);

      const brand = await api().get('/api/company/brand').expect(200);
      expect(brand.body.logoVersion).not.toBe(before);

      const logo = await api().get('/api/company/logo').expect(200);
      expect(logo.headers['content-type']).toBe('image/png');
      expect(logo.headers['x-content-type-options']).toBe('nosniff');
      expect(logo.headers['content-security-policy']).toBe("default-src 'none'");
      expect(Buffer.compare(logo.body as Buffer, PNG)).toBe(0);
    });

    it('rejects files that are not really images, even when named .png', async () => {
      const fake = Buffer.from('<svg onload="alert(1)"></svg>');
      const res = await api().put('/api/company/logo').set('Cookie', hr).attach('file', fake, { filename: 'logo.png', contentType: 'image/png' }).expect(400);
      expect(res.body.message).toContain('PNG, JPEG or WebP');
    });

    it('rejects files over 1 MB and requests without a file', async () => {
      const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
      await api().put('/api/company/logo').set('Cookie', hr).attach('file', big, 'big.png').expect(413);
      await api().put('/api/company/logo').set('Cookie', hr).expect(400);
    });

    it('only HR and Admin can change it', async () => {
      await api().put('/api/company/logo').set('Cookie', employee).attach('file', PNG, 'logo.png').expect(403);
      await api().delete('/api/company/logo').set('Cookie', employee).expect(403);
    });

    it('can be removed', async () => {
      await api().delete('/api/company/logo').set('Cookie', hr).expect(204);
      await api().get('/api/company/logo').expect(404);
      expect((await api().get('/api/company/brand')).body.logoVersion).toBeNull();
    });
  });
});
