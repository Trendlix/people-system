import { generateKeyPairSync } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service.js';
import { FcmSender } from './fcm-sender.service.js';

// The FCM sender (owner, 20 October 2026: "Push notifications: yes"; apps/mobile/README.md, Phase 4) against a fake
// Google: the access token asked for once and kept, a new one once it is near its end or refused, a token FCM says is
// gone removed, nothing thrown into the flow, and nothing sent while push is off.

const PEM = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const ON = { FCM_PROJECT_ID: 'people-test', FCM_CLIENT_EMAIL: 'push@people-test.iam.gserviceaccount.com', FCM_PRIVATE_KEY: `"${PEM.replace(/\n/g, '\\n')}"` };
const PAYLOAD = { id: 'n1', kind: 'leave_waiting', title: 'A leave request is waiting for you', body: 'Mona Adel, 22/10/2026', link: '/leave/1' };

const config = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as unknown as ConfigService;

/** A fake Google: the token endpoint and messages:send, answering from `sends` in turn (200 when none is left). */
function google(sends: { status: number; body?: unknown }[] = [], token: { status: number; body: unknown } = { status: 200, body: { access_token: 'ya29.test', expires_in: 3600 } }) {
  const calls: { url: string; body: string; authorization?: string }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : '', authorization: headers.authorization });
    const answer = url.includes('oauth2') ? token : (sends.shift() ?? { status: 200, body: { name: 'projects/people-test/messages/1' } });
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetcher };
}

function sender(values: Record<string, string> = ON) {
  const deleted: unknown[] = [];
  const prisma = { pushDevice: { deleteMany: async (args: unknown) => (deleted.push(args), { count: 1 }) } } as unknown as PrismaService;
  return { fcm: new FcmSender(config(values), prisma), deleted };
}

describe('FcmSender', () => {
  it('sends nothing while push is off', async () => {
    const { fcm } = sender({});
    const g = google();
    fcm.fetcher = g.fetcher;
    expect(fcm.enabled).toBe(false);
    await fcm.send([{ id: 'd1', token: 'tok-1' }], PAYLOAD);
    expect(g.calls).toEqual([]);
  });

  it('asks for the access token once and keeps it until 5 minutes before it ends', async () => {
    const { fcm } = sender();
    const g = google();
    fcm.fetcher = g.fetcher;
    let now = 1_000_000;
    fcm.clock = () => now;
    await fcm.send([{ id: 'd1', token: 'tok-1' }, { id: 'd2', token: 'tok-2' }], PAYLOAD);
    expect(g.calls.map((c) => c.url)).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://fcm.googleapis.com/v1/projects/people-test/messages:send',
      'https://fcm.googleapis.com/v1/projects/people-test/messages:send',
    ]);
    expect(g.calls[0].body).toMatch(/^grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(g.calls[1].authorization).toBe('Bearer ya29.test');
    expect(JSON.parse(g.calls[1].body).message.token).toBe('tok-1');
    // 54 minutes on: the same token; 56 minutes on: a new one
    now += 54 * 60_000;
    await fcm.send([{ id: 'd1', token: 'tok-1' }], PAYLOAD);
    expect(g.calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1);
    now += 2 * 60_000;
    await fcm.send([{ id: 'd1', token: 'tok-1' }], PAYLOAD);
    expect(g.calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(2);
  });

  it('removes a phone whose token FCM says is gone, and keeps one refused for another reason', async () => {
    const { fcm, deleted } = sender();
    const gone = { status: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } };
    const busy = { status: 503, body: { error: { status: 'UNAVAILABLE', details: [{ errorCode: 'UNAVAILABLE' }] } } };
    fcm.fetcher = google([gone, busy]).fetcher;
    await fcm.send([{ id: 'd1', token: 'tok-1' }], PAYLOAD);
    await fcm.send([{ id: 'd2', token: 'tok-2' }], PAYLOAD);
    expect(deleted).toEqual([{ where: { id: 'd1', token: 'tok-1' } }]);
  });

  it('asks for a new access token once when FCM refuses it', async () => {
    const { fcm } = sender();
    const g = google([{ status: 401, body: { error: { status: 'UNAUTHENTICATED' } } }]);
    fcm.fetcher = g.fetcher;
    await fcm.send([{ id: 'd1', token: 'tok-1' }], PAYLOAD);
    expect(g.calls.map((c) => (c.url.includes('oauth2') ? 'token' : 'send'))).toEqual(['token', 'send', 'token', 'send']);
  });

  it('never throws: Google refusing the account, or no answer in time', async () => {
    const refused = sender();
    refused.fcm.fetcher = google([], { status: 400, body: { error: 'invalid_grant' } }).fetcher;
    await expect(refused.fcm.send([{ id: 'd1', token: 'tok-1' }], PAYLOAD)).resolves.toBeUndefined();
    const slow = sender();
    slow.fcm.fetcher = (async () => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    }) as typeof fetch;
    await expect(slow.fcm.send([{ id: 'd1', token: 'tok-1' }], PAYLOAD)).resolves.toBeUndefined();
    expect(slow.deleted).toEqual([]);
  });
});
