import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  accessTokenOf,
  fcmConfig,
  fcmErrorText,
  fcmMessage,
  fcmOutcome,
  fcmSendUrl,
  GOOGLE_TOKEN_URL,
  serviceAccountJwt,
  tokenRequestBody,
  type AccessToken,
  type FcmCredentials,
  type PushPayload,
} from './fcm.js';

// Sends push notifications to the phones (owner, 20 October 2026: "Push notifications: yes"; apps/mobile/README.md,
// Phase 4) through FCM's HTTP v1 API, signed with the service account in deploy/.env (FCM_PROJECT_ID, FCM_CLIENT_EMAIL,
// FCM_PRIVATE_KEY). Without all three (or with a key that doesn't read) push is off: said once in the log, and the
// inbox works as ever. It never throws into the flow that sent a notification: every send has a time limit, and every
// refusal is logged (FCM's status, never a token or a text). A token FCM says is gone is removed (fcm.ts fcmOutcome).

/** How long a call to Google may take before it is given up. */
export const FCM_TIMEOUT_MS = 10_000;

/** How many phones are sent to at once. */
const AT_ONCE = 5;

/** A phone to push to: its row and its token. */
export interface PushTarget {
  id: string;
  token: string;
}

@Injectable()
export class FcmSender {
  private readonly logger = new Logger('Push');
  private readonly credentials: FcmCredentials | null;
  private token: AccessToken | null = null;
  private tokenAsked: Promise<string> | null = null;
  /** The network call; the tests give their own. */
  fetcher: typeof fetch = (input, init) => fetch(input, init);
  /** The clock; the tests give their own. */
  clock: () => number = () => Date.now();

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const result = fcmConfig({ projectId: config.get<string>('FCM_PROJECT_ID'), clientEmail: config.get<string>('FCM_CLIENT_EMAIL'), privateKey: config.get<string>('FCM_PRIVATE_KEY') });
    this.credentials = result.ok ? result.credentials : null;
    if (!result.ok) {
      // once, when the API starts; the values themselves are never logged
      this.logger.log(
        result.invalidKey
          ? 'Push notifications are off: FCM_PRIVATE_KEY is not a private key. Notifications are kept in the inbox only.'
          : `Push notifications are off: ${result.missing.join(', ')} ${result.missing.length === 1 ? 'is' : 'are'} not set. Notifications are kept in the inbox only.`,
      );
    }
  }

  /** Whether push is on: the three settings are there and the key reads. */
  get enabled(): boolean {
    return this.credentials !== null;
  }

  /** Pushes one notification to each phone. Never throws; a phone whose token is gone is removed. */
  async send(targets: readonly PushTarget[], payload: PushPayload): Promise<void> {
    if (!this.credentials || !targets.length) return;
    for (let i = 0; i < targets.length; i += AT_ONCE) {
      await Promise.all(targets.slice(i, i + AT_ONCE).map((t) => this.sendOne(t, payload)));
    }
  }

  private async sendOne(target: PushTarget, payload: PushPayload, retried = false): Promise<void> {
    const credentials = this.credentials;
    if (!credentials) return;
    try {
      const access = await this.accessToken(credentials);
      const res = await this.fetcher(fcmSendUrl(credentials.projectId), {
        method: 'POST',
        headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
        body: JSON.stringify(fcmMessage(target.token, payload)),
        signal: AbortSignal.timeout(FCM_TIMEOUT_MS),
      });
      const body: unknown = res.ok ? null : await res.json().catch(() => null);
      const outcome = fcmOutcome(res.status, body);
      if (outcome === 'sent') return;
      if (outcome === 'unauthorised' && !retried) {
        // the access token was refused (revoked, or the clock moved): a new one, once
        this.token = null;
        return this.sendOne(target, payload, true);
      }
      if (outcome === 'remove_token') {
        await this.prisma.pushDevice.deleteMany({ where: { id: target.id, token: target.token } });
        this.logger.log(`A phone's push token is no longer valid (${fcmErrorText(res.status, body)}): removed.`);
        return;
      }
      this.logger.warn(`A push notification was not sent (${fcmErrorText(res.status, body)}).`);
    } catch (err) {
      this.logger.warn(`A push notification was not sent: ${errorText(err)}.`);
    }
  }

  /** An access token: the one kept, or a new one from Google (one ask at a time). */
  private async accessToken(credentials: FcmCredentials): Promise<string> {
    const now = this.clock();
    if (this.token && now < this.token.renewAt) return this.token.value;
    if (!this.tokenAsked) {
      this.tokenAsked = this.askToken(credentials).finally(() => {
        this.tokenAsked = null;
      });
    }
    return this.tokenAsked;
  }

  private async askToken(credentials: FcmCredentials): Promise<string> {
    const asked = this.clock();
    const res = await this.fetcher(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: tokenRequestBody(serviceAccountJwt(credentials, Math.floor(asked / 1000))),
      signal: AbortSignal.timeout(FCM_TIMEOUT_MS),
    });
    const body: unknown = await res.json().catch(() => null);
    const token = res.ok ? accessTokenOf(body, asked) : null;
    if (!token) {
      const error = (body as { error?: unknown } | null)?.error;
      throw new Error(`Google refused the service account (HTTP ${res.status}${typeof error === 'string' ? ` ${error}` : ''})`);
    }
    this.token = token;
    return token.value;
  }
}

/** An error as a short line for the log (a time-out said as one). */
function errorText(err: unknown): string {
  if (err instanceof Error) return err.name === 'TimeoutError' || err.name === 'AbortError' ? `no answer within ${FCM_TIMEOUT_MS / 1000} seconds` : err.message;
  return String(err);
}
