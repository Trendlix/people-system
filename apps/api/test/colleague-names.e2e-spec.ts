import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Colleagues by their display names (owner, 31 October 2026: "for employees, make them see their coleagues display names,
// not full names - in any part or process in app and website"): an employee's or a manager's answers name every other
// person by their display name, the profile's or the first two names; HR's (and Finance's, the CEO's, Admin's and the
// Super Admin's) by their full names, as before. Read through the inbox, where a notification names a colleague. These
// tests look at their own people (names end with RUN) and delete what they made. Every name is invented.

const RUN = `cn${Date.now().toString(36)}`;

interface Inbox {
  items: { title: string; body: string }[];
}

describe('Colleagues by their display names (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let emailDomainBefore: string | null;
  const people: string[] = [];
  const users: Record<string, { id: string; session: string }> = {};
  const api = () => request(app.getHttpServer());
  // two colleagues: one with a display name set on the profile, one without
  const KARIM = `Karim Adel Mahmoud Fouad ${RUN}`;
  const NOUR = `Nour El Din Samir ${RUN}`;

  async function account(key: string, roles: Parameters<typeof createUser>[1]) {
    const email = await createUser(prisma, roles);
    const id = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    users[key] = { id, session: await signIn(app, email) };
  }

  const inboxOf = async (key: string) => (await api().get('/api/me/notifications').set('Cookie', users[key].session).expect(200)).body as Inbox;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('hr', ['hr']);
    hr = users.hr.session;
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    for (const [fullNameEn, fullNameAr, displayName] of [
      [KARIM, 'كريم عادل محمود فؤاد', `Karim Fouad ${RUN}`],
      [NOUR, 'نور الدين سمير عادل', null],
    ] as const) {
      const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn, fullNameAr, workEmail: `${RUN}-${people.length}@test.local` }).expect(201);
      people.push(res.body.id);
      if (displayName) await prisma.employee.update({ where: { id: res.body.id }, data: { displayName } });
    }
    await account('employee', ['employee']);
    await account('manager', ['employee', 'manager']);
    await account('finance', ['finance']);
    for (const key of ['hr', 'employee', 'manager', 'finance']) {
      await prisma.notification.create({
        data: { userId: users[key].id, kind: 'leave_waiting', title: `Leave request from ${KARIM}`, body: `${NOUR} covers while ${KARIM} is away. كريم عادل محمود فؤاد` },
      });
    }
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users).map((u) => u.id) } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  it('names colleagues by their display names for an employee and a manager: the profile’s, else the first two names', async () => {
    for (const key of ['employee', 'manager']) {
      const [item] = (await inboxOf(key)).items;
      // Karim's Display name; Nour's first two names, "El Din" kept with "Nour"; in Arabic the first two names
      expect(item.title).toBe(`Leave request from Karim Fouad ${RUN}`);
      expect(item.body).toBe(`Nour El Din Samir covers while Karim Fouad ${RUN} is away. كريم عادل`);
    }
  });

  it('keeps full names for HR and Finance', async () => {
    for (const key of ['hr', 'finance']) {
      const [item] = (await inboxOf(key)).items;
      expect(item.title).toBe(`Leave request from ${KARIM}`);
      expect(item.body).toBe(`${NOUR} covers while ${KARIM} is away. كريم عادل محمود فؤاد`);
    }
  });
});
