import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  ASSETS_REFUSALS,
  assetsAccessOf,
  authorizeRequestError,
  CONNECTOR_CODE_SECONDS,
  CONNECTOR_REFUSALS,
  CONNECTOR_SCOPE,
  CONNECTOR_UNUSED_MS,
  hostOf,
  isClaudeClientDocumentUrl,
  isClaudeRedirectUri,
  type ConnectorAuthorizeCheck,
  type ConnectorAuthorizeGrant,
  type ConnectorAuthorizeInput,
  type ConnectorClientRegistration,
  type ConnectorMe,
  type ConnectorTokenResponse,
  type Role,
} from '@trendlix/shared';
import { assetsCallerOf } from '../assets/assets-access.js';
import { AuditService } from '../audit/audit.service.js';
import { endedBySignIn, keptIp, keptUserAgent } from '../auth/session-rules.js';
import { WITH_ROLES, type SessionUser } from '../auth/session-user.js';
import type { ActiveSession } from '../auth/sessions.service.js';
import type { ConnectorClient } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  clientAuthenticated,
  clientCredentials,
  codeVerdict,
  grantedScope,
  isResource,
  looksLike,
  newSecret,
  OAuthError,
  readClientDocument,
  readRegistration,
  readTokenRequest,
  refreshVerdict,
  secretHash,
  type TokenRequest,
} from './connector-rules.js';
import { ConnectorTokensService, type IssuedTokens } from './connector-tokens.service.js';

// The Claude connector's sign-in (owner, 21 October 2026: "i might link a claude account for the assets section only to
// fetch data and help in the data entry"; then "the connection method" / "option a"; packages/shared connector.ts). The
// website hosts the addresses Claude uses (/oauth/register, /oauth/authorize, /oauth/token, /oauth/revoke) and passes
// every request on to here, where it is decided and kept:
// - registration (RFC 7591): Claude's return addresses only; a public client unless it asks for a secret. Limited to 20
//   an hour from one address (200 in all); one never allowed by anybody is removed a day later (housekeeping, not a
//   record anyone made).
// - a client may instead identify by its metadata document's address (CIMD), only on Claude's own hosts: read (5
//   seconds, 10 KB at most, no redirects) and kept for an hour. Not advertised: Claude registers itself (DCR) by default.
// - the consent page asks the person (their own session on the website; never while viewing as someone; only with
//   Assets access); Allow gives a code (5 minutes, once, PKCE S256, bound to the client, its return address and the MCP
//   address).
// - the code becomes a connector session (sessions, kind 'connector', one a person: the newest wins) with an access
//   token (an hour) and a refresh token (rotated on every use; used again a minute later, the session ends). A code used
//   twice ends the session it started. 90 days without a refresh end the session.
// - revoking either token ends its session; so do Your Sessions' Sign out, an Admin, deactivating the account and a
//   password change or reset. Written to the audit log as the person's: Allow, connecting, and a session ended for safety.

const ENTITY = 'user';
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const REGISTRATIONS_AN_HOUR_FROM_ONE_ADDRESS = 20;
const REGISTRATIONS_AN_HOUR = 200;
const DOCUMENT_FRESH_MS = HOUR_MS;
const DOCUMENT_MAX_BYTES = 10_000;
const DOCUMENT_TIMEOUT_MS = 5_000;

const SHOW = {
  noAddress: 'This sign-in page could not tell its own address. Please try again.',
  noClient: 'The sign-in link has no client. Start again from Claude.',
  unknownClient: 'This app is not registered with Trendlix People. In Claude, remove the connector and add it again.',
  badReturn: 'The return address in this sign-in link isn’t one of Claude’s, so Trendlix People won’t send you there.',
} as const;

const AUTHORIZE_FIELDS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'scope', 'state', 'resource'] as const;

/** The authorization request's fields as the website passes them on (text only), and the MCP address it expects. */
function readAuthorizeBody(body: unknown): { input: ConnectorAuthorizeInput; expectedResource: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const field = (k: string) => (typeof b[k] === 'string' && (b[k] as string).length <= 2000 ? (b[k] as string).trim() : '');
  const input = Object.fromEntries(AUTHORIZE_FIELDS.map((k) => [k, field(k)])) as unknown as ConnectorAuthorizeInput;
  return { input, expectedResource: field('expectedResource') };
}

type Review = ConnectorAuthorizeCheck | (Extract<ConnectorAuthorizeCheck, { kind: 'ok' }> & { input: ConnectorAuthorizeInput; resource: string; clientRow: ConnectorClient });

@Injectable()
export class ConnectorOAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: ConnectorTokensService,
  ) {}

  // ---------- registration ----------

  /** POST /connector/oauth/register (RFC 7591): a new client, with its secret this once when it asked for one. */
  async register(body: unknown): Promise<ConnectorClientRegistration> {
    const wanted = readRegistration(body);
    const ip = keptIp(body && typeof body === 'object' ? ((body as Record<string, unknown>).ip as string | undefined) : null);
    const now = new Date();
    // registrations nobody ever allowed, a day on: Claude registers again whenever it connects afresh
    await this.prisma.connectorClient.deleteMany({ where: { kind: 'dcr', usedAt: null, createdAt: { lt: new Date(now.getTime() - DAY_MS) }, sessions: { none: {} } } });
    const since = new Date(now.getTime() - HOUR_MS);
    const [fromThere, inAll] = await Promise.all([
      ip ? this.prisma.connectorClient.count({ where: { ip, createdAt: { gt: since } } }) : 0,
      this.prisma.connectorClient.count({ where: { kind: 'dcr', createdAt: { gt: since } } }),
    ]);
    if (fromThere >= REGISTRATIONS_AN_HOUR_FROM_ONE_ADDRESS || inAll >= REGISTRATIONS_AN_HOUR) {
      throw new OAuthError('temporarily_unavailable', 'Too many registrations. Try again in an hour.', 429);
    }
    const id = newSecret('client');
    const secret = wanted.authMethod === 'none' ? null : newSecret('secret');
    await this.prisma.connectorClient.create({
      data: { id, kind: 'dcr', name: wanted.name, redirectUris: wanted.redirectUris, authMethod: wanted.authMethod, secretHash: secret ? secretHash(secret) : null, ip, createdAt: now },
    });
    return {
      client_id: id,
      client_id_issued_at: Math.floor(now.getTime() / 1000),
      ...(secret && { client_secret: secret, client_secret_expires_at: 0 as const }),
      client_name: wanted.name,
      redirect_uris: wanted.redirectUris,
      grant_types: wanted.grantTypes,
      response_types: wanted.responseTypes,
      token_endpoint_auth_method: wanted.authMethod,
      scope: CONNECTOR_SCOPE,
    };
  }

  /**
   * A client by its id: one registered here, or one identified by its metadata document on Claude's own hosts (read
   * again when an hour old and `fetch` allows; the copy kept when it can't be read). Null for anything else.
   */
  async client(id: string, options: { fetch: boolean }): Promise<ConnectorClient | null> {
    if (looksLike('client', id)) return this.prisma.connectorClient.findUnique({ where: { id } });
    if (!isClaudeClientDocumentUrl(id)) return null;
    const kept = await this.prisma.connectorClient.findUnique({ where: { id } });
    const now = new Date();
    if (kept && (!options.fetch || (kept.fetchedAt && now.getTime() - kept.fetchedAt.getTime() < DOCUMENT_FRESH_MS))) return kept;
    if (!options.fetch) return null;
    let read: { name: string; redirectUris: string[] };
    try {
      read = readClientDocument(id, await this.fetchDocument(id));
    } catch {
      return kept;
    }
    return this.prisma.connectorClient.upsert({
      where: { id },
      create: { id, kind: 'cimd', name: read.name, redirectUris: read.redirectUris, authMethod: 'none', fetchedAt: now, createdAt: now },
      update: { name: read.name, redirectUris: read.redirectUris, fetchedAt: now },
    });
  }

  /** A metadata document read from Claude's host: JSON, within 5 seconds, 10 KB at most, never following a redirect. */
  private async fetchDocument(url: string): Promise<unknown> {
    const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(DOCUMENT_TIMEOUT_MS), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`The client's metadata document answered ${res.status}.`);
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > DOCUMENT_MAX_BYTES) throw new Error('The client’s metadata document is too large.');
    const text = await res.text();
    if (text.length > DOCUMENT_MAX_BYTES) throw new Error('The client’s metadata document is too large.');
    return JSON.parse(text);
  }

  // ---------- the consent page ----------

  /**
   * The request checked for the consent page (POST /connector/oauth/authorize/check): the client and its return address
   * first, said on the page when wrong (never sent anywhere); then the rest, sent back to Claude with the error; then
   * whether the person can allow it: Assets access, and not viewing as someone.
   */
  async check(user: SessionUser, body: unknown): Promise<ConnectorAuthorizeCheck> {
    const r = await this.review(user, body);
    if (r.kind !== 'ok') return r;
    const { client, redirectUri, redirectHost, access, values, refusal } = r;
    return { kind: 'ok', client, redirectUri, redirectHost, access, values, refusal };
  }

  private async review(user: SessionUser, body: unknown): Promise<Review> {
    const { input, expectedResource } = readAuthorizeBody(body);
    if (!isResource(expectedResource)) return { kind: 'show', message: SHOW.noAddress };
    if (!input.client_id) return { kind: 'show', message: SHOW.noClient };
    const client = await this.client(input.client_id, { fetch: true });
    if (!client) return { kind: 'show', message: SHOW.unknownClient };
    // a client with one return address may leave it out (RFC 6749 §3.1.2.3)
    const redirectUri = input.redirect_uri || (client.redirectUris.length === 1 ? client.redirectUris[0] : '');
    if (!redirectUri || !client.redirectUris.includes(redirectUri) || !isClaudeRedirectUri(redirectUri)) return { kind: 'show', message: SHOW.badReturn };
    const error = authorizeRequestError(input, expectedResource);
    if (error) return { kind: 'redirect', redirectUri, error };
    const caller = await assetsCallerOf(this.prisma, user);
    const refusal = user.viewAs ? 'viewing_as' : caller.access === 'none' ? 'no_access' : null;
    return {
      kind: 'ok',
      client: { id: client.id, name: client.name },
      redirectUri,
      redirectHost: hostOf(redirectUri),
      access: caller.access,
      values: caller.values,
      refusal,
      input,
      resource: input.resource || expectedResource,
      clientRow: client,
    };
  }

  /** Allow (POST /connector/oauth/authorize): the code Claude is sent back with, for 5 minutes, once. */
  async authorize(user: SessionUser, session: Pick<ActiveSession, 'kind'>, body: unknown): Promise<ConnectorAuthorizeGrant> {
    if (session.kind === 'connector') throw new ForbiddenException('Connect Claude from the website.');
    const r = await this.review(user, body);
    if (r.kind === 'show') throw new BadRequestException([r.message]);
    if (r.kind === 'redirect') throw new BadRequestException([r.error.description]);
    if (!('input' in r)) throw new BadRequestException([SHOW.noClient]);
    if (r.refusal) throw new ForbiddenException(CONNECTOR_REFUSALS[r.refusal]);
    const code = newSecret('code');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.connectorCode.create({
        data: {
          codeHash: secretHash(code),
          clientId: r.clientRow.id,
          userId: user.id,
          redirectUri: r.redirectUri,
          codeChallenge: r.input.code_challenge,
          scope: CONNECTOR_SCOPE,
          resource: r.resource,
          createdAt: now,
          expiresAt: new Date(now.getTime() + CONNECTOR_CODE_SECONDS * 1000),
        },
      }),
      this.prisma.connectorClient.update({ where: { id: r.clientRow.id }, data: { usedAt: now } }),
    ]);
    await this.audit.record({
      userId: user.id,
      action: 'connector_allow',
      entityType: ENTITY,
      entityId: user.id,
      diff: { client: r.clientRow.name, clientId: r.clientRow.id, returnsTo: r.redirectHost, scope: CONNECTOR_SCOPE },
    });
    return { code, redirectUri: r.redirectUri };
  }

  // ---------- tokens ----------

  /** POST /connector/oauth/token: a code or a refresh token for new tokens (RFC 6749 §4.1.3, §6). */
  async token(body: unknown): Promise<ConnectorTokenResponse> {
    const req = readTokenRequest(body);
    if (req.grant_type === 'authorization_code') return this.exchange(req);
    if (req.grant_type === 'refresh_token') return this.refresh(req);
    if (!req.grant_type) throw new OAuthError('invalid_request', 'Send grant_type.');
    throw new OAuthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported.');
  }

  /** The client, as it authenticates at the token or revocation endpoint (a public one by its id alone). */
  private async authenticate(req: TokenRequest): Promise<ConnectorClient> {
    const credentials = clientCredentials(req);
    if (!credentials.clientId) throw new OAuthError('invalid_client', 'Send the client_id.');
    const client = await this.client(credentials.clientId, { fetch: false });
    if (!client || !clientAuthenticated(client, credentials)) throw new OAuthError('invalid_client', 'The client is not known, or its credentials are wrong.');
    return client;
  }

  private async exchange(req: TokenRequest): Promise<ConnectorTokenResponse> {
    const client = await this.authenticate(req);
    const code = looksLike('code', req.code) ? await this.prisma.connectorCode.findUnique({ where: { codeHash: secretHash(req.code) } }) : null;
    const now = new Date();
    const verdict = codeVerdict(code, { clientId: client.id, redirectUri: req.redirect_uri, verifier: req.code_verifier, resource: req.resource }, now);
    if (!verdict.ok) {
      // a code used twice: whoever holds it may have stolen it, so the session it started ends (OAuth 2.1 §4.1.3)
      if (verdict.reused && code?.sessionId) await this.endForSafety(code.sessionId, code.userId, 'code_reused');
      throw verdict.error;
    }
    const found = code!;
    const user = await this.prisma.user.findUnique({ where: { id: found.userId }, include: WITH_ROLES });
    if (!user?.isActive) throw new OAuthError('invalid_grant', 'The account is not active.');
    const roles = user.roles.map((r) => r.role.key as Role);
    if (assetsAccessOf({ roles, assetsAccess: user.assetsAccess }) === 'none') throw new OAuthError('invalid_grant', ASSETS_REFUSALS.none);

    const { sessionId, issued, replaced } = await this.prisma.$transaction(async (tx) => {
      const used = await tx.connectorCode.updateMany({ where: { id: found.id, usedAt: null }, data: { usedAt: now } });
      if (!used.count) throw new OAuthError('invalid_grant', 'The code was already used. Connect Claude again.');
      // one connection a person at a time: the newest wins, as a second sign-in on the website does
      await tx.$queryRaw`SELECT 1 FROM users WHERE id = ${found.userId}::uuid FOR UPDATE`;
      const open = await tx.session.findMany({ where: { userId: found.userId, kind: 'connector', endedAt: null }, select: { id: true, kind: true, expiresAt: true } });
      const ending = endedBySignIn(open, 'connector', now);
      for (const reason of ['replaced', 'expired'] as const) {
        const ids = ending.filter((e) => e.reason === reason).map((e) => e.session.id);
        if (ids.length) await tx.session.updateMany({ where: { id: { in: ids }, endedAt: null }, data: { endedAt: now, endReason: reason } });
      }
      const session = await tx.session.create({
        data: {
          userId: found.userId,
          kind: 'connector',
          createdAt: now,
          lastActiveAt: now,
          expiresAt: new Date(now.getTime() + CONNECTOR_UNUSED_MS),
          userAgent: keptUserAgent(req.userAgent),
          ip: keptIp(req.ip),
          clientId: client.id,
          scope: CONNECTOR_SCOPE,
          resource: found.resource,
        },
        select: { id: true },
      });
      await tx.connectorCode.update({ where: { id: found.id }, data: { sessionId: session.id } });
      const issued = await this.tokens.issue(tx, session.id, now);
      return { sessionId: session.id, issued, replaced: ending.filter((e) => e.reason === 'replaced').map((e) => e.session.id) };
    });
    for (const old of replaced) {
      await this.audit.record({ userId: found.userId, action: 'session_replaced', entityType: ENTITY, entityId: found.userId, diff: { kind: 'connector', sessionId: old, by: sessionId } });
    }
    await this.audit.record({ userId: found.userId, action: 'connector_connect', entityType: ENTITY, entityId: found.userId, diff: { kind: 'connector', sessionId, client: client.name } });
    return answer(issued);
  }

  private async refresh(req: TokenRequest): Promise<ConnectorTokenResponse> {
    const client = await this.authenticate(req);
    const now = new Date();
    const token = looksLike('refresh', req.refresh_token)
      ? await this.prisma.connectorToken.findUnique({
          where: { tokenHash: secretHash(req.refresh_token) },
          include: {
            session: {
              select: { id: true, userId: true, kind: true, clientId: true, resource: true, expiresAt: true, endedAt: true, user: { select: { isActive: true, assetsAccess: true, ...WITH_ROLES } } },
            },
          },
        })
      : null;
    const verdict = refreshVerdict(token, { clientId: client.id, resource: req.resource }, now);
    if (verdict.kind === 'refuse') {
      if (verdict.end && token) await this.endForSafety(token.session.id, token.session.userId, 'refresh_token_reused');
      throw verdict.error;
    }
    const found = token!;
    const roles = found.session.user.roles.map((r) => r.role.key as Role);
    if (assetsAccessOf({ roles, assetsAccess: found.session.user.assetsAccess }) === 'none') throw new OAuthError('invalid_grant', ASSETS_REFUSALS.none);
    const issued = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.connectorToken.updateMany({ where: { id: found.id, rotatedAt: null }, data: { rotatedAt: now } });
      if (!count) throw new OAuthError('invalid_grant', 'The refresh token was already used. Connect Claude again.');
      return this.tokens.issue(tx, found.sessionId, now);
    });
    return answer(issued);
  }

  /**
   * POST /connector/oauth/revoke (RFC 7009): either token ends its connection ('signed_out'). Always answered 200, even
   * for a token that isn't known; a client that sends credentials must have them right.
   */
  async revoke(body: unknown): Promise<Record<string, never>> {
    const req = readTokenRequest(body);
    const credentials = clientCredentials(req);
    let clientId: string | null = null;
    if (credentials.clientId) clientId = (await this.authenticate(req)).id;
    if (!looksLike('access', req.token) && !looksLike('refresh', req.token)) return {};
    const row = await this.prisma.connectorToken.findUnique({ where: { tokenHash: secretHash(req.token) }, select: { session: { select: { id: true, userId: true, clientId: true, endedAt: true } } } });
    if (!row || row.session.endedAt || (clientId && row.session.clientId !== clientId)) return {};
    const { count } = await this.prisma.session.updateMany({ where: { id: row.session.id, endedAt: null }, data: { endedAt: new Date(), endReason: 'signed_out' } });
    if (count) await this.audit.record({ userId: row.session.userId, action: 'logout', entityType: ENTITY, entityId: row.session.userId, diff: { kind: 'connector', sessionId: row.session.id } });
    return {};
  }

  /** A connection ended because one of its codes or tokens came again: written to the person's audit log. */
  private async endForSafety(sessionId: string, userId: string, reason: 'code_reused' | 'refresh_token_reused'): Promise<void> {
    const { count } = await this.prisma.session.updateMany({ where: { id: sessionId, endedAt: null }, data: { endedAt: new Date(), endReason: 'revoked' } });
    if (count) await this.audit.record({ userId, action: 'connector_refused', entityType: ENTITY, entityId: userId, diff: { kind: 'connector', sessionId, reason } });
  }

  // ---------- whose connection ----------

  /** GET /connector/me, with the connector's token: the person, their Assets access now, and the connection. */
  async me(user: SessionUser, session: Pick<ActiveSession, 'id' | 'kind'>): Promise<ConnectorMe> {
    if (session.kind !== 'connector') throw new ForbiddenException('Only the Claude connector asks this.');
    const [row, own, caller] = await Promise.all([
      this.prisma.session.findUniqueOrThrow({ where: { id: session.id }, select: { scope: true, resource: true, client: { select: { name: true } } } }),
      (user.employeeId ? this.prisma.employee.findUnique({ where: { id: user.employeeId }, select: { fullNameEn: true } }) : null),
      assetsCallerOf(this.prisma, user),
    ]);
    if (caller.access === 'none') throw new ForbiddenException(ASSETS_REFUSALS.none);
    return {
      userId: user.id,
      email: user.email,
      name: own?.fullNameEn ?? null,
      assets: { access: caller.access, values: caller.values },
      scope: row.scope ?? CONNECTOR_SCOPE,
      resource: row.resource,
      client: row.client?.name ?? null,
      sessionId: session.id,
    };
  }
}

/** The token endpoint's answer (RFC 6749 §5.1): Assets alone, whatever was asked. */
const answer = (issued: IssuedTokens): ConnectorTokenResponse => ({
  access_token: issued.access,
  token_type: 'Bearer',
  expires_in: issued.expiresIn,
  refresh_token: issued.refresh,
  scope: grantedScope(),
});
