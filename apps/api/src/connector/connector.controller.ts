import { Body, Catch, Controller, Get, Header, HttpCode, Post, UseFilters, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { ConnectorAuthorizeCheck, ConnectorAuthorizeGrant, ConnectorClientRegistration, ConnectorMe, ConnectorTokenResponse } from '@trendlix/shared';
import type { Response } from 'express';
import { ConnectorScope, CurrentActiveSession, CurrentUser, Public, ViewAsControl } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import type { ActiveSession } from '../auth/sessions.service.js';
import { OAuthError } from './connector-rules.js';
import { ConnectorOAuthService } from './connector-oauth.service.js';

// The Claude connector's OAuth endpoints (owner, 21 October 2026: "the connection method"; packages/shared
// connector.ts). The website serves the public addresses Claude knows (/oauth/register, /oauth/token, /oauth/revoke, its
// consent page at /oauth/authorize) and passes each request on to these, with the visitor's address. Registration,
// tokens and revocation are public (Claude has no session here) and answer OAuth's own errors ({ error,
// error_description }, never cached); the consent page's two calls are the person's, with their website session; /me is
// the connector's own, with its token. The bodies are read field by field (connector-rules.ts), not by a DTO: a client
// may send metadata this server doesn't know, which is ignored rather than refused.

/** OAuth's own errors as OAuth answers them (RFC 6749 §5.2), never cached. */
@Catch(OAuthError)
export class OAuthErrorFilter implements ExceptionFilter {
  catch(err: OAuthError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(err.status).set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' }).json(err.body);
  }
}

@Controller('connector')
@UseFilters(OAuthErrorFilter)
export class ConnectorController {
  constructor(private readonly oauth: ConnectorOAuthService) {}

  /** Dynamic client registration (RFC 7591). */
  @Public()
  @Post('oauth/register')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  register(@Body() body: Record<string, unknown>): Promise<ConnectorClientRegistration> {
    return this.oauth.register(body);
  }

  /** The token endpoint: a code (with its PKCE verifier) or a refresh token. */
  @Public()
  @Post('oauth/token')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  token(@Body() body: Record<string, unknown>): Promise<ConnectorTokenResponse> {
    return this.oauth.token(body);
  }

  /** Token revocation (RFC 7009): always 200. */
  @Public()
  @Post('oauth/revoke')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  revoke(@Body() body: Record<string, unknown>): Promise<Record<string, never>> {
    return this.oauth.revoke(body);
  }

  /**
   * The consent page's check, with the person's session. It changes nothing, so it is answered while viewing as someone
   * too (with why Allow isn't offered then).
   */
  @ViewAsControl()
  @Post('oauth/authorize/check')
  @HttpCode(200)
  check(@Body() body: Record<string, unknown>, @CurrentUser() user: SessionUser): Promise<ConnectorAuthorizeCheck> {
    return this.oauth.check(user, body);
  }

  /** Allow: the code. Never while viewing as someone, and only with Assets access. */
  @Post('oauth/authorize')
  @HttpCode(200)
  authorize(@Body() body: Record<string, unknown>, @CurrentUser() user: SessionUser, @CurrentActiveSession() session: ActiveSession): Promise<ConnectorAuthorizeGrant> {
    return this.oauth.authorize(user, session, body);
  }

  /** Whose connection this token is, and their Assets access now (the MCP endpoint asks before every request). */
  @ConnectorScope()
  @Get('me')
  me(@CurrentUser() user: SessionUser, @CurrentActiveSession() session: ActiveSession): Promise<ConnectorMe> {
    return this.oauth.me(user, session);
  }
}
