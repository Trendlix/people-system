import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Role } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { hashPassword } from '../src/auth/password.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export const PASSWORD = 'test-password-123';

export async function createApp(): Promise<{ app: INestApplication<App>; prisma: PrismaService }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

let counter = 0;

/** Creates a user with the given roles and returns its email. */
export async function createUser(prisma: PrismaService, roles: Role[]): Promise<string> {
  const email = `user${Date.now()}-${++counter}@test.local`;
  const roleRows = await prisma.role.findMany({ where: { key: { in: roles } } });
  await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(PASSWORD),
      roles: { create: roleRows.map((r) => ({ roleId: r.id })) },
    },
  });
  return email;
}

/** Signs in and returns the session cookie to send with later requests. */
export async function signIn(app: INestApplication<App>, email: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
  const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='));
  if (!cookie) throw new Error('No session cookie returned');
  return cookie.split(';')[0];
}
