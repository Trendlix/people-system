import { Injectable, UnauthorizedException } from '@nestjs/common';
import { CONNECTOR_ACCESS_TOKEN_SECONDS, CONNECTOR_UNUSED_MS } from '@trendlix/shared';
import { WITH_ROLES } from '../auth/session-user.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { accessRefusal, looksLike, newSecret, secretHash } from './connector-rules.js';

// A Claude connector's tokens (owner, 21 October 2026: "the connection method"; packages/shared connector.ts): an access
// token for an hour and a refresh token for 90 days, each given once and kept only as its SHA-256, both of the
// connector session they were given for (sessions, kind 'connector'). The guard (auth.guard.ts) checks an access token
// here on every request; the OAuth service (connector-oauth.service.ts) gives them. A session that ends (signed out on
// Your Sessions, ended by an Admin, the account deactivated, the password changed or reset, a newer connection) takes
// its tokens with it: they are never checked alone.

/** The 401 an access token is refused with: the reason in words, and `invalid_token` for the MCP endpoint's challenge. */
export const invalidToken = (message: string) => new UnauthorizedException({ statusCode: 401, error: 'Unauthorized', message, reason: 'invalid_token' });

const WITH_SESSION = {
  session: {
    select: {
      id: true,
      userId: true,
      kind: true,
      clientId: true,
      scope: true,
      resource: true,
      createdAt: true,
      lastActiveAt: true,
      expiresAt: true,
      endedAt: true,
      user: { include: WITH_ROLES },
      client: { select: { name: true } },
    },
  },
} as const satisfies Prisma.ConnectorTokenInclude;

export type ConnectorAccess = Prisma.ConnectorTokenGetPayload<{ include: typeof WITH_SESSION }>;

/** The tokens given at once: their values (this once), and how long the access token lasts. */
export interface IssuedTokens {
  access: string;
  refresh: string;
  expiresIn: number;
}

@Injectable()
export class ConnectorTokensService {
  constructor(private readonly prisma: PrismaService) {}

  /** The access token's session and its user (with their roles), or a 401 saying why it is refused. */
  async verifyAccess(token: string, now = new Date()): Promise<ConnectorAccess> {
    const row = looksLike('access', token) ? await this.prisma.connectorToken.findUnique({ where: { tokenHash: secretHash(token) }, include: WITH_SESSION }) : null;
    const refusal = accessRefusal(row, now);
    if (refusal || !row) throw invalidToken(refusal ?? 'The access token is not valid.');
    return row;
  }

  /**
   * A new access and refresh token for a session, in the transaction that starts or refreshes it; the session's own
   * end moves to the refresh token's (90 days without a refresh end it).
   */
  async issue(tx: Prisma.TransactionClient, sessionId: string, now: Date): Promise<IssuedTokens> {
    const access = newSecret('access');
    const refresh = newSecret('refresh');
    const refreshEnds = new Date(now.getTime() + CONNECTOR_UNUSED_MS);
    await tx.connectorToken.createMany({
      data: [
        { sessionId, kind: 'access', tokenHash: secretHash(access), createdAt: now, expiresAt: new Date(now.getTime() + CONNECTOR_ACCESS_TOKEN_SECONDS * 1000) },
        { sessionId, kind: 'refresh', tokenHash: secretHash(refresh), createdAt: now, expiresAt: refreshEnds },
      ],
    });
    await tx.session.update({ where: { id: sessionId }, data: { expiresAt: refreshEnds, lastActiveAt: now } });
    return { access, refresh, expiresIn: CONNECTOR_ACCESS_TOKEN_SECONDS };
  }
}
