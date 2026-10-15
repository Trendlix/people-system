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
  let admin: string;
  let superAdmin: string; // the only role that deletes (owner's decision, 15 October 2026)
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    employee = await signIn(app, await createUser(prisma, ['employee']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
  });

  afterAll(async () => {
    await app.close();
  });

  it('is seeded from the contract template and readable by everyone signed in', async () => {
    const res = await api().get('/api/company').set('Cookie', employee).expect(200);
    expect(res.body).toMatchObject({ nameEn: expect.any(String), hasLogo: expect.any(Boolean), hasThumbnail: expect.any(Boolean) });
    expect(res.body).not.toHaveProperty('logo');
    expect(res.body).not.toHaveProperty('thumbnail');
    expect(res.body).not.toHaveProperty('repNationalId');
  });

  it('needs a session to read, but the brand (name, logo and thumbnail versions) is public', async () => {
    await api().get('/api/company').expect(401);
    const brand = await api().get('/api/company/brand').expect(200);
    expect(Object.keys(brand.body).sort()).toEqual(['logoVersion', 'nameAr', 'nameEn', 'thumbnailVersion']);
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

  it('keeps the email domain every work email must use: tidied, refused when not a domain, cleared when empty', async () => {
    // put back afterwards: the test database keeps it for the other test files
    const before = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain as string | null;

    const set = await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: ' @TrendLIX.com ' }).expect(200);
    expect(set.body.emailDomain).toBe('trendlix.com');
    expect((await api().get('/api/company').set('Cookie', employee).expect(200)).body.emailDomain).toBe('trendlix.com');

    for (const emailDomain of ['trendlix', 'hr@trendlix.com', 'https://trendlix.com', 'trend lix.com']) {
      const res = await api().patch('/api/company').set('Cookie', hr).send({ emailDomain }).expect(400);
      expect(res.body.message).toEqual(['Enter the email domain, e.g. trendlix.com.']);
    }

    const cleared = await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    expect(cleared.body.emailDomain).toBeNull();
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'company' }, orderBy: { id: 'desc' } });
    expect(entry.diff).toEqual({ emailDomain: { from: 'trendlix.com', to: null } });

    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: before ?? '' }).expect(200);
  });

  it('rejects invalid values', async () => {
    await api().patch('/api/company').set('Cookie', hr).send({ nameEn: '  ' }).expect(400);
    await api().patch('/api/company').set('Cookie', hr).send({ email: 'not-an-email' }).expect(400);
    await api().patch('/api/company').set('Cookie', hr).send({ repNationalId: '12345' }).expect(400);
    await api().patch('/api/company').set('Cookie', hr).send({ logo: 'x' }).expect(400);
    await api().patch('/api/company').set('Cookie', hr).send({ thumbnail: 'x' }).expect(400);
  });

  it('stores the representative national ID but only ever returns it masked, and keeps it out of the audit log', async () => {
    // A number no other test sets: an unchanged value is not logged.
    const nationalId = '2' + String(Date.now()).padStart(13, '0').slice(-13);
    const arabicDigits = nationalId.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
    const res = await api()
      .patch('/api/company')
      .set('Cookie', hr)
      .send({ repName: 'أحمد محمد', repNameEn: 'Ahmed Mohamed', repTitleEn: 'Managing Director', repNationalId: arabicDigits }) // Arabic digits are accepted
      .expect(200);
    expect(res.body.repNationalIdMasked).toBe(`•••••••••• ${nationalId.slice(-4)}`);
    // the name and title in English too, for bilingual documents
    expect(res.body).toMatchObject({ repName: 'أحمد محمد', repNameEn: 'Ahmed Mohamed', repTitleEn: 'Managing Director' });
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

    it('can be removed by a Super Admin only: removing it deletes it (owner’s decision, 15 October 2026)', async () => {
      for (const who of [hr, admin]) {
        const refused = await api().delete('/api/company/logo').set('Cookie', who).expect(403);
        expect(refused.body.message).toBe('Only a Super Admin can delete records.');
      }
      expect((await api().get('/api/company/brand')).body.logoVersion).not.toBeNull();
      await api().delete('/api/company/logo').set('Cookie', superAdmin).expect(204);
      await api().get('/api/company/logo').expect(404);
      expect((await api().get('/api/company/brand')).body.logoVersion).toBeNull();
    });
  });

  // The square brand mark beside the logo (owner's request, 15 October 2026): kept, checked and served like the logo.
  describe('thumbnail', () => {
    // A WebP by its first bytes: the type is taken from the content, whatever the name or the browser says.
    const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(14)]);

    // the other test files share the database and expect neither image (e.g. the org chart's)
    afterAll(async () => {
      await api().delete('/api/company/logo').set('Cookie', superAdmin).expect(204);
      await api().delete('/api/company/thumbnail').set('Cookie', superAdmin).expect(204);
    });

    it('accepts a real image, serves it publicly with safe headers, and bumps its own version only', async () => {
      await api().put('/api/company/logo').set('Cookie', hr).attach('file', PNG, 'logo.png').expect(200);
      const before = (await api().get('/api/company/brand')).body as { logoVersion: number; thumbnailVersion: number | null };

      const res = await api().put('/api/company/thumbnail').set('Cookie', admin).attach('file', WEBP, { filename: 'mark.png', contentType: 'image/png' }).expect(200);
      expect(res.body).toMatchObject({ hasThumbnail: true, hasLogo: true, thumbnailUpdatedAt: expect.any(String) });
      expect(res.body).not.toHaveProperty('thumbnail');
      expect(res.body).not.toHaveProperty('thumbnailMimeType');

      const brand = await api().get('/api/company/brand').expect(200);
      expect(brand.body.thumbnailVersion).toEqual(expect.any(Number));
      expect(brand.body.thumbnailVersion).not.toBe(before.thumbnailVersion);
      expect(brand.body.logoVersion).toBe(before.logoVersion);

      const thumbnail = await api().get('/api/company/thumbnail').expect(200);
      expect(thumbnail.headers['content-type']).toBe('image/webp');
      expect(thumbnail.headers['cache-control']).toBe('public, max-age=300');
      expect(thumbnail.headers['x-content-type-options']).toBe('nosniff');
      expect(thumbnail.headers['content-security-policy']).toBe("default-src 'none'");
      expect(Buffer.compare(thumbnail.body as Buffer, WEBP)).toBe(0);
      // the logo is untouched
      expect(Buffer.compare((await api().get('/api/company/logo').expect(200)).body as Buffer, PNG)).toBe(0);

      const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'company' }, orderBy: { id: 'desc' } });
      expect(entry.diff).toEqual({ thumbnail: { type: 'image/webp', bytes: WEBP.length } });
    });

    it('rejects files that are not really images, files over 1 MB and requests without a file', async () => {
      const fake = Buffer.from('<svg onload="alert(1)"></svg>');
      const res = await api().put('/api/company/thumbnail').set('Cookie', hr).attach('file', fake, { filename: 'mark.png', contentType: 'image/png' }).expect(400);
      expect(res.body.message).toBe('The thumbnail must be a PNG, JPEG or WebP image.');

      const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
      await api().put('/api/company/thumbnail').set('Cookie', hr).attach('file', big, 'big.png').expect(413);
      const empty = await api().put('/api/company/thumbnail').set('Cookie', hr).expect(400);
      expect(empty.body.message).toBe('Choose an image file to upload.');
    });

    it('only HR and Admin can change it, and only a Super Admin can remove it: removing it deletes it', async () => {
      await api().put('/api/company/thumbnail').set('Cookie', employee).attach('file', PNG, 'mark.png').expect(403);
      await api().put('/api/company/thumbnail').attach('file', PNG, 'mark.png').expect(401);
      await api().delete('/api/company/thumbnail').set('Cookie', employee).expect(403);
      for (const who of [hr, admin]) {
        const refused = await api().delete('/api/company/thumbnail').set('Cookie', who).expect(403);
        expect(refused.body.message).toBe('Only a Super Admin can delete records.');
      }
      expect((await api().get('/api/company/brand')).body.thumbnailVersion).not.toBeNull();

      await api().delete('/api/company/thumbnail').set('Cookie', superAdmin).expect(204);
      const missing = await api().get('/api/company/thumbnail').expect(404);
      expect(missing.body.message).toBe('No thumbnail uploaded.');
      const brand = await api().get('/api/company/brand').expect(200);
      expect(brand.body.thumbnailVersion).toBeNull();
      expect(brand.body.logoVersion).not.toBeNull(); // the logo stays
      expect((await api().get('/api/company').set('Cookie', hr).expect(200)).body).toMatchObject({ hasThumbnail: false, thumbnailUpdatedAt: null, hasLogo: true });

      const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'company' }, orderBy: { id: 'desc' } });
      expect(entry.diff).toEqual({ thumbnail: 'removed' });
    });
  });
});
