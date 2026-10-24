import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MEETING_COMPANY_NAMES, MEETING_PAGES, MEETING_PROVIDER_LABELS, type MeetingOwner, type MeetingProvider } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { MeetingApp, MeetingConnection } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MeetingHttp } from './meeting-http.js';
import { appTokenRequest, MeetingProviderError, refreshRequest, tokenGrantOf, type AppCredentials, type TokenGrant } from './meeting-providers.js';
import { meetingKeyIdOf, meetingKeyOf, openMeetingSecret, sameMeetingKey, sealMeetingSecret, type MeetingSecretPurpose } from './meeting-secret.js';

// The meetings' secrets and tokens (owner, 24 October 2026: "make it both"; the brief: "all sealed … never returned …
// refreshed automatically; a refresh failure marks the connection 'Needs reconnecting' and tells its owner"):
// - the providers' apps, their secrets opened only to call the provider;
// - an access token for a connection: kept in memory until a minute before it expires, else made again from the
//   connection's refresh token (Microsoft and Zoom give a new refresh token each time: kept at once, sealed), or, for the
//   company's Microsoft and Zoom, from the app's own credentials. One refresh at a time a connection, so a refresh token
//   used once (Zoom's) is never spent twice;
// - a refresh refused for good (revoked, expired, a scope taken away) marks the connection needs_reconnecting with why,
//   written to the audit log, and its owner told (the company's: every Super Admin), once.
// Nothing here is ever logged but the provider's error codes.

export const MEETING_CONNECTION_ENTITY = 'meeting_connection';

/** A connection's whose: the company's (no user) or a person's own. */
export const ownerOf = (c: Pick<MeetingConnection, 'userId'>): MeetingOwner => (c.userId ? 'personal' : 'company');

/** Whether a connection hosts by the app alone (the company's Microsoft and Zoom: no sign-in, no refresh token). */
export const hostsByApp = (c: Pick<MeetingConnection, 'userId' | 'provider' | 'refreshTokenEnc'>): boolean => !c.userId && c.provider !== 'google' && !c.refreshTokenEnc;

/** A token is renewed this long before it expires. */
const MARGIN_MS = 60_000;

@Injectable()
export class MeetingTokensService {
  private readonly logger = new Logger('Meetings');
  private readonly key: Buffer;
  private readonly kept = new Map<string, { token: string; until: number }>();
  private readonly running = new Map<string, Promise<string>>();

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly http: MeetingHttp,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {
    this.key = meetingKeyOf(config.getOrThrow<string>('JWT_SECRET'));
  }

  // ---------- sealing ----------

  /** A secret sealed for its column, with the key's fingerprint. */
  seal(plain: string, purpose: MeetingSecretPurpose): { enc: string; keyId: string } {
    return { enc: sealMeetingSecret(plain, this.key, purpose), keyId: meetingKeyIdOf(this.key) };
  }

  /** A sealed secret opened; null when there is none or it was sealed with another key. */
  open(enc: string | null | undefined, keyId: string | null | undefined, purpose: MeetingSecretPurpose): string | null {
    if (!enc || !sameMeetingKey(keyId, this.key)) return null;
    return openMeetingSecret(enc, this.key, purpose);
  }

  /** Whether a saved secret can be opened with this server's key (false when none is saved). */
  readable(enc: string | null | undefined, keyId: string | null | undefined, purpose: MeetingSecretPurpose): boolean {
    return this.open(enc, keyId, purpose) !== null;
  }

  /** The state of a sign-in, sealed for the provider's round trip (its own purpose: never a token). */
  sealState(state: object): string {
    return sealMeetingSecret(JSON.stringify(state), this.key, 'oauth_state');
  }

  openState(sealed: string | null | undefined): Record<string, unknown> | null {
    const plain = openMeetingSecret(sealed, this.key, 'oauth_state');
    if (!plain) return null;
    try {
      const v = JSON.parse(plain) as unknown;
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  // ---------- the apps ----------

  app(provider: MeetingProvider): Promise<MeetingApp | null> {
    return this.prisma.meetingApp.findUnique({ where: { provider } });
  }

  /**
   * A provider's app credentials, the secret opened: the company's (Zoom: the Server-to-Server OAuth app) or for each
   * person's own (Zoom: the General app; the others: the same app). Null when not set up or not readable.
   */
  credentials(app: MeetingApp | null, owner: MeetingOwner): AppCredentials | null {
    if (!app) return null;
    if (owner === 'personal' && app.provider === 'zoom') {
      const secret = this.open(app.userClientSecretEnc, app.userClientSecretKeyId, 'user_client_secret');
      return app.userClientId && secret ? { clientId: app.userClientId, clientSecret: secret } : null;
    }
    const secret = this.open(app.clientSecretEnc, app.clientSecretKeyId, 'client_secret');
    if (!app.clientId || !secret) return null;
    if (app.provider === 'microsoft' && !app.tenantId) return null;
    if (app.provider === 'zoom' && owner === 'company' && !app.accountId) return null;
    return { clientId: app.clientId, clientSecret: secret, tenantId: app.tenantId, accountId: app.accountId };
  }

  /** The words when a provider's app isn't set up (or its secret can't be read). */
  noApp(provider: MeetingProvider): MeetingProviderError {
    return new MeetingProviderError('app', `The company’s ${MEETING_COMPANY_NAMES[provider]} app isn’t set up: a Super Admin sets it up on Organization → Meetings.`, 'no_app');
  }

  // ---------- tokens ----------

  /** Forgets the tokens kept for a connection, or for an app's own (after its credentials change). */
  forgetConnection(id: string): void {
    this.kept.delete(`connection:${id}`);
  }

  forgetApp(provider: MeetingProvider): void {
    this.kept.delete(`app:${provider}`);
    for (const k of this.kept.keys()) if (k.startsWith('connection:')) this.kept.delete(k);
  }

  /** Keeps a token just given (on connecting), for its life less a minute. */
  keep(connectionId: string, grant: Pick<TokenGrant, 'accessToken' | 'expiresIn'>): void {
    this.kept.set(`connection:${connectionId}`, { token: grant.accessToken, until: Date.now() + grant.expiresIn * 1000 - MARGIN_MS });
  }

  /**
   * An access token for the connection (kept, refreshed, or the app's own); `fresh`: not the kept one (it was refused).
   * Throws the provider's problem in words.
   */
  async tokenFor(c: MeetingConnection, options: { fresh?: boolean } = {}): Promise<string> {
    const key = hostsByApp(c) ? `app:${c.provider}` : `connection:${c.id}`;
    if (options.fresh) this.kept.delete(key);
    const kept = this.kept.get(key);
    if (kept && kept.until > Date.now()) return kept.token;
    const running = this.running.get(key);
    if (running) return running;
    const job = (hostsByApp(c) ? this.appToken(c.provider as 'microsoft' | 'zoom') : this.refreshed(c)).finally(() => this.running.delete(key));
    this.running.set(key, job);
    return job;
  }

  /** The app's own token for the company's host (Microsoft's client credentials, Zoom's account credentials). */
  async appToken(provider: 'microsoft' | 'zoom'): Promise<string> {
    const app = this.credentials(await this.app(provider), 'company');
    if (!app) throw this.noApp(provider);
    const grant = tokenGrantOf(provider, await this.http.send(appTokenRequest(provider, app)));
    this.kept.set(`app:${provider}`, { token: grant.accessToken, until: Date.now() + grant.expiresIn * 1000 - MARGIN_MS });
    return grant.accessToken;
  }

  /** A connection's refresh token traded for an access token; a new refresh token kept at once. */
  private async refreshed(c: MeetingConnection): Promise<string> {
    const provider = c.provider as MeetingProvider;
    if (c.status === 'needs_reconnecting') {
      throw new MeetingProviderError('reconnect', c.problem ?? `The ${MEETING_PROVIDER_LABELS[provider]} connection needs connecting again.`, 'needs_reconnecting');
    }
    const app = this.credentials(await this.app(provider), ownerOf(c));
    if (!app) throw this.noApp(provider);
    const refreshToken = this.open(c.refreshTokenEnc, c.tokenKeyId, 'refresh_token');
    if (!refreshToken) {
      const problem = 'The saved sign-in can’t be read any more (the server’s key changed): connect the account again.';
      await this.needsReconnecting(c, problem);
      throw new MeetingProviderError('reconnect', problem, 'unreadable');
    }
    let grant: TokenGrant;
    try {
      grant = tokenGrantOf(provider, await this.http.send(refreshRequest(provider, app, refreshToken)));
    } catch (err) {
      if (err instanceof MeetingProviderError && err.kind === 'reconnect') await this.needsReconnecting(c, err.message);
      if (err instanceof MeetingProviderError) this.logger.warn(`A ${provider} connection's token couldn't be refreshed: ${err.code ?? err.kind}.`);
      throw err;
    }
    if (grant.refreshToken && grant.refreshToken !== refreshToken) {
      const sealed = this.seal(grant.refreshToken, 'refresh_token');
      await this.prisma.meetingConnection.updateMany({ where: { id: c.id }, data: { refreshTokenEnc: sealed.enc, tokenKeyId: sealed.keyId } });
    }
    this.keep(c.id, grant);
    return grant.accessToken;
  }

  /**
   * Marks a connection needs_reconnecting with why, once: written to the audit log (no one did it: the provider refused),
   * and its owner told: the person, or every Super Admin for the company's.
   */
  async needsReconnecting(c: MeetingConnection, problem: string): Promise<void> {
    this.forgetConnection(c.id);
    const { count } = await this.prisma.meetingConnection.updateMany({ where: { id: c.id, status: 'connected' }, data: { status: 'needs_reconnecting', problem } });
    if (!count) return;
    const provider = c.provider as MeetingProvider;
    const owner = ownerOf(c);
    await this.audit.record({ userId: null, action: 'needs_reconnecting', entityType: MEETING_CONNECTION_ENTITY, entityId: c.id, diff: { provider, owner, problem } });
    const to = c.userId
      ? [c.userId]
      : (await this.prisma.user.findMany({ where: { isActive: true, roles: { some: { role: { key: 'super_admin' } } } }, select: { id: true } })).map((u) => u.id);
    await this.notifications.notify(to, {
      kind: 'meeting_connection',
      title: owner === 'company' ? `Connect the company’s ${MEETING_PROVIDER_LABELS[provider]} again` : `Connect your ${MEETING_PROVIDER_LABELS[provider]} again`,
      body: 'Interviews can’t create meetings with it until it is connected again.',
      link: MEETING_PAGES[owner],
    });
  }
}
