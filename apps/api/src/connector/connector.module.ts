import { Module } from '@nestjs/common';
import { ConnectorController } from './connector.controller.js';
import { ConnectorOAuthService } from './connector-oauth.service.js';
import { ConnectorTokensService } from './connector-tokens.service.js';

/**
 * The Claude connector (Assets, step 2; owner, 21 October 2026: "i might link a claude account for the assets section
 * only to fetch data and help in the data entry"; then "the connection method" / "option a"; packages/shared
 * connector.ts): its OAuth sign-in (registration, the consent page's calls, codes, tokens, revocation) and /me. The MCP
 * server itself is on the website (/api/mcp), calling the Assets endpoints with the connector's token; the guard checks
 * that token (ConnectorTokensService, also provided to the auth module for it).
 */
@Module({
  controllers: [ConnectorController],
  providers: [ConnectorOAuthService, ConnectorTokensService],
})
export class ConnectorModule {}
