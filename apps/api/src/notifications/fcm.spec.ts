import { createVerify, generateKeyPairSync } from 'node:crypto';
import { accessTokenOf, fcmConfig, fcmErrorText, fcmMessage, fcmOutcome, fcmSendUrl, normalisePrivateKey, serviceAccountJwt, tokenRequestBody, unquoted } from './fcm.js';

// FCM's HTTP v1 API without a Firebase library (owner, 20 October 2026: "Push notifications: yes"; apps/mobile/README.md,
// Phase 4): the service account's settings read as deploy/.env may hold them, its JWT, Google's answers, the message and
// what each refusal means. The key here is made for the test; no real account is used.

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
/** The key as the service account's JSON file has it: its line breaks written \n. */
const ESCAPED = PEM.replace(/\n/g, '\\n');

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;

describe('FCM (push notifications)', () => {
  it('reads the private key with literal \\n, real line breaks, and quotes around it', () => {
    expect(normalisePrivateKey(ESCAPED)).toBe(PEM.trim());
    expect(normalisePrivateKey(`"${ESCAPED}"`)).toBe(PEM.trim());
    expect(normalisePrivateKey(`'${ESCAPED}'`)).toBe(PEM.trim());
    expect(normalisePrivateKey(`"'${ESCAPED}'"`)).toBe(PEM.trim());
    expect(normalisePrivateKey(PEM.replace(/\n/g, '\r\n'))).toBe(PEM.trim());
    expect(unquoted('  "people-system-123"  ')).toBe('people-system-123');
    expect(unquoted(undefined)).toBe('');
  });

  it('is on with all three settings and a key that reads; off otherwise, saying what is missing', () => {
    const on = fcmConfig({ projectId: 'people-test', clientEmail: '"push@people-test.iam.gserviceaccount.com"', privateKey: `"${ESCAPED}"` });
    expect(on.ok).toBe(true);
    if (on.ok) expect(on.credentials).toMatchObject({ projectId: 'people-test', clientEmail: 'push@people-test.iam.gserviceaccount.com' });
    expect(fcmConfig({})).toEqual({ ok: false, missing: ['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY'], invalidKey: false });
    expect(fcmConfig({ projectId: 'p', clientEmail: ' ', privateKey: ESCAPED })).toEqual({ ok: false, missing: ['FCM_CLIENT_EMAIL'], invalidKey: false });
    expect(fcmConfig({ projectId: 'p', clientEmail: 'e', privateKey: 'not a key' })).toEqual({ ok: false, missing: [], invalidKey: true });
    // an EC key isn't the service account's RSA one
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(fcmConfig({ projectId: 'p', clientEmail: 'e', privateKey: ec })).toEqual({ ok: false, missing: [], invalidKey: true });
  });

  it('signs the service account JWT with RS256, for the messaging scope, an hour long', () => {
    const config = fcmConfig({ projectId: 'people-test', clientEmail: 'push@people-test.iam.gserviceaccount.com', privateKey: ESCAPED });
    if (!config.ok) throw new Error('not configured');
    const jwt = serviceAccountJwt(config.credentials, 1_792_000_000);
    const [header, claims, signature] = jwt.split('.');
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decode(claims)).toEqual({
      iss: 'push@people-test.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_792_000_000,
      exp: 1_792_003_600,
    });
    expect(createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    expect(tokenRequestBody('a.b.c')).toBe('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=a.b.c');
  });

  it('keeps an access token until 5 minutes before it ends', () => {
    expect(accessTokenOf({ access_token: 'ya29.x', expires_in: 3599, token_type: 'Bearer' }, 1_000)).toEqual({ value: 'ya29.x', renewAt: 1_000 + 3_599_000 - 300_000 });
    expect(accessTokenOf({ access_token: 'ya29.x' }, 0)?.renewAt).toBe(3_600_000 - 300_000);
    expect(accessTokenOf({ error: 'invalid_grant' }, 0)).toBeNull();
    expect(accessTokenOf(null, 0)).toBeNull();
  });

  it('builds the message: Android shows it on the app’s channel, the data says what to open (strings only)', () => {
    expect(fcmSendUrl('people-test')).toBe('https://fcm.googleapis.com/v1/projects/people-test/messages:send');
    const m = fcmMessage('tok', { id: 'n1', kind: 'leave_waiting', title: 'A leave request is waiting for you', body: 'Mona Adel, 22/10/2026', link: '/leave/1' });
    expect(m).toEqual({
      message: {
        token: 'tok',
        notification: { title: 'A leave request is waiting for you', body: 'Mona Adel, 22/10/2026' },
        data: { id: 'n1', kind: 'leave_waiting', link: '/leave/1' },
        android: { priority: 'high', notification: { channel_id: 'general' } },
      },
    });
    expect(fcmMessage('tok', { id: 'n2', kind: 'check_in_reminder', title: 't', body: 'b', link: null }).message.data.link).toBe('');
    // the check-in reminder, every 10 minutes: tagged, so each replaces the last on the phone, and still sounds
    expect(fcmMessage('tok', { id: 'n3', kind: 'check_in_reminder', title: 't', body: 'b', link: '/my-attendance', tag: 'check_in_reminder' }).message.android).toEqual({
      priority: 'high',
      notification: { channel_id: 'general', tag: 'check_in_reminder', notification_priority: 'PRIORITY_HIGH', default_sound: true, default_vibrate_timings: true },
    });
    expect(fcmMessage('tok', { id: 'n4', kind: 'leave_waiting', title: 't', body: 'b', link: null, tag: null }).message.android.notification).toEqual({ channel_id: 'general' });
  });

  it('removes a token FCM says is UNREGISTERED or INVALID_ARGUMENT; the message’s own fault keeps it', () => {
    const fcm = (status: string, errorCode?: string, fields?: string[]) => ({
      error: {
        status,
        message: 'm',
        details: [
          ...(errorCode ? [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }] : []),
          ...(fields ? [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: fields.map((field) => ({ field })) }] : []),
        ],
      },
    });
    expect(fcmOutcome(200, { name: 'projects/p/messages/1' })).toBe('sent');
    expect(fcmOutcome(404, fcm('NOT_FOUND', 'UNREGISTERED'))).toBe('remove_token');
    expect(fcmOutcome(400, fcm('INVALID_ARGUMENT', 'INVALID_ARGUMENT'))).toBe('remove_token');
    expect(fcmOutcome(400, fcm('INVALID_ARGUMENT', 'INVALID_ARGUMENT', ['message.token']))).toBe('remove_token');
    expect(fcmOutcome(400, fcm('INVALID_ARGUMENT', 'INVALID_ARGUMENT', ['message.android.priority']))).toBe('failed');
    expect(fcmOutcome(401, fcm('UNAUTHENTICATED'))).toBe('unauthorised');
    expect(fcmOutcome(429, fcm('RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED'))).toBe('retry_later');
    expect(fcmOutcome(503, fcm('UNAVAILABLE', 'UNAVAILABLE'))).toBe('retry_later');
    expect(fcmOutcome(403, fcm('PERMISSION_DENIED', 'SENDER_ID_MISMATCH'))).toBe('failed');
    expect(fcmOutcome(500, null)).toBe('retry_later');
    expect(fcmErrorText(404, fcm('NOT_FOUND', 'UNREGISTERED'))).toBe('HTTP 404 UNREGISTERED');
    expect(fcmErrorText(502, 'gateway')).toBe('HTTP 502 unknown');
  });
});
