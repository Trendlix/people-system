import { createPrivateKey, createSign, type KeyObject } from 'node:crypto';
import { PUSH_CHANNEL } from '@trendlix/shared';

// Push notifications through Firebase Cloud Messaging's HTTP v1 API (owner, 20 October 2026: "Push notifications: yes";
// apps/mobile/README.md, Phase 4), with no Firebase library: an OAuth2 access token from the service account's own
// signed JWT (RS256, Node's crypto), then one POST a phone. Pure code, tested (fcm.spec.ts); FcmSender sends with it.
// The service account's three values come from deploy/.env (FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY), never
// from the repository or a log.

export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Where a message is sent: the project's messages:send. */
export const fcmSendUrl = (projectId: string) => `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;

/** The service account, ready to sign with. */
export interface FcmCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: KeyObject;
}

/** Why push is off: a value missing (its name), or a private key that isn't one. */
export type FcmConfig = { ok: true; credentials: FcmCredentials } | { ok: false; missing: string[]; invalidKey: boolean };

/** A value as an .env file or a pasted JSON may hold it: trimmed, without the quotes around it (once or twice). */
export function unquoted(raw: string | undefined | null): string {
  let value = (raw ?? '').trim();
  for (let i = 0; i < 2; i++) {
    const quoted = value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
    if (!quoted) break;
    value = value.slice(1, -1).trim();
  }
  return value;
}

/**
 * The private key as deploy/.env may hold it: wrapped in quotes, its line breaks written as a literal \n (as the
 * service account's JSON file has them), or real ones. Back to the PEM it is.
 */
export function normalisePrivateKey(raw: string | undefined | null): string {
  return unquoted(raw)
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\r\n?/g, '\n')
    .trim();
}

/**
 * The service account from the three settings. All three are needed, and the key must read as a private key; otherwise
 * push is off (what is missing is said by name, never a value).
 */
export function fcmConfig(env: { projectId?: string | null; clientEmail?: string | null; privateKey?: string | null }): FcmConfig {
  const projectId = unquoted(env.projectId);
  const clientEmail = unquoted(env.clientEmail);
  const pem = normalisePrivateKey(env.privateKey);
  const missing = [!projectId && 'FCM_PROJECT_ID', !clientEmail && 'FCM_CLIENT_EMAIL', !pem && 'FCM_PRIVATE_KEY'].filter((m): m is string => !!m);
  if (missing.length) return { ok: false, missing, invalidKey: false };
  try {
    const privateKey = createPrivateKey({ key: pem, format: 'pem' });
    if (privateKey.asymmetricKeyType !== 'rsa') return { ok: false, missing: [], invalidKey: true };
    return { ok: true, credentials: { projectId, clientEmail, privateKey } };
  } catch {
    return { ok: false, missing: [], invalidKey: true };
  }
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** The service account's JWT that Google trades for an access token: valid an hour from `nowSeconds`. */
export function serviceAccountJwt(credentials: Pick<FcmCredentials, 'clientEmail' | 'privateKey'>, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: credentials.clientEmail, scope: FCM_SCOPE, aud: GOOGLE_TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 }));
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(credentials.privateKey);
  return `${header}.${claims}.${base64url(signature)}`;
}

/** The form posted to Google's token endpoint. */
export function tokenRequestBody(jwt: string): string {
  return new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString();
}

/** An access token, kept until a little before it ends. */
export interface AccessToken {
  value: string;
  /** When it stops being used here (ms since 1970): 5 minutes before Google ends it. */
  renewAt: number;
}

/** Minutes before an access token's end that a new one is asked for. */
export const TOKEN_RENEW_EARLY_MS = 5 * 60_000;

/** Google's answer as an access token; null when it isn't one. `now`: when it was asked for. */
export function accessTokenOf(body: unknown, now: number): AccessToken | null {
  const b = (body ?? {}) as { access_token?: unknown; expires_in?: unknown };
  if (typeof b.access_token !== 'string' || !b.access_token) return null;
  const seconds = typeof b.expires_in === 'number' && Number.isFinite(b.expires_in) && b.expires_in > 0 ? b.expires_in : 3600;
  return { value: b.access_token, renewAt: now + Math.max(seconds * 1000 - TOKEN_RENEW_EARLY_MS, 60_000) };
}

/** A notification as it is pushed: its inbox row's id, kind, texts and where it opens. */
export interface PushPayload {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
}

/**
 * The message for one phone: the notification Android shows by itself while the app is closed (on the app's channel,
 * high priority so it shows at once), and the data the app reads when it is tapped (every value a string, as FCM needs).
 */
export function fcmMessage(token: string, n: PushPayload) {
  return {
    message: {
      token,
      notification: { title: n.title, body: n.body },
      data: { id: n.id, kind: n.kind, link: n.link ?? '' },
      android: { priority: 'high', notification: { channel_id: PUSH_CHANNEL.id } },
    },
  };
}

/** What a send came to: sent; the token is gone (removed here); the access token refused; try later; or failed. */
export type FcmOutcome = 'sent' | 'remove_token' | 'unauthorised' | 'retry_later' | 'failed';

interface FcmErrorBody {
  error?: {
    status?: string;
    message?: string;
    details?: { '@type'?: string; errorCode?: string; fieldViolations?: { field?: string }[] }[];
  };
}

/**
 * The outcome of an answer from messages:send. A token FCM reports as UNREGISTERED (the app was removed, or its token
 * deleted on signing out) or INVALID_ARGUMENT (not a token) is removed. An INVALID_ARGUMENT that names another field of
 * the message than its token is the message's fault, not the phone's: the token is kept, and it is logged.
 */
export function fcmOutcome(status: number, body: unknown): FcmOutcome {
  if (status >= 200 && status < 300) return 'sent';
  const error = (body as FcmErrorBody | null)?.error;
  const codes = new Set<string>([error?.status ?? '', ...(error?.details ?? []).map((d) => d.errorCode ?? '')].filter(Boolean));
  if (codes.has('UNREGISTERED')) return 'remove_token';
  if (codes.has('INVALID_ARGUMENT')) {
    const fields = (error?.details ?? []).flatMap((d) => d.fieldViolations ?? []).map((v) => v.field ?? '');
    return fields.length && !fields.some((f) => f === 'message.token') ? 'failed' : 'remove_token';
  }
  if (status === 401 || codes.has('UNAUTHENTICATED')) return 'unauthorised';
  if (status === 429 || status >= 500 || codes.has('QUOTA_EXCEEDED') || codes.has('UNAVAILABLE') || codes.has('INTERNAL')) return 'retry_later';
  return 'failed';
}

/** A short line for the log about a refusal: FCM's status and code, never the token or the texts. */
export function fcmErrorText(status: number, body: unknown): string {
  const error = (body as FcmErrorBody | null)?.error;
  const code = (error?.details ?? []).map((d) => d.errorCode).find(Boolean) ?? error?.status ?? 'unknown';
  return `HTTP ${status} ${code}`;
}
