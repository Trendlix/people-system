import { CONNECTOR_PATHS, CONNECTOR_SCOPE, connectorResource } from '@trendlix/shared';

// The discovery documents of the Claude connector (owner, 21 October 2026: "the connection method"), as the MCP
// authorization spec (2026-07-28) asks: the protected resource metadata (RFC 9728) names the MCP endpoint and this site
// as its authorization server; the authorization server metadata (RFC 8414) names the sign-in, token, registration and
// revocation addresses, the code flow with S256 PKCE only, and the iss parameter on the way back (RFC 9207). Claude
// registers itself (dynamic client registration, RFC 7591): Client ID Metadata Documents are not advertised, so that is
// the path Claude takes by itself (the API still accepts Claude's own hosted document when one is sent). Pure code (no
// "@/" imports): tested.

const SCOPES = [CONNECTOR_SCOPE];
const AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'];

/** RFC 9728, served at /.well-known/oauth-protected-resource and …/oauth-protected-resource/api/mcp. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: connectorResource(origin),
    authorization_servers: [origin],
    scopes_supported: SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'Trendlix People · Assets',
    resource_documentation: `${origin}${CONNECTOR_PATHS.help}`,
  };
}

/** RFC 8414, served at /.well-known/oauth-authorization-server: the issuer is the origin itself. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${CONNECTOR_PATHS.authorize}`,
    token_endpoint: `${origin}${CONNECTOR_PATHS.token}`,
    registration_endpoint: `${origin}${CONNECTOR_PATHS.register}`,
    revocation_endpoint: `${origin}${CONNECTOR_PATHS.revoke}`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: AUTH_METHODS,
    revocation_endpoint_auth_methods_supported: AUTH_METHODS,
    scopes_supported: SCOPES,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}${CONNECTOR_PATHS.help}`,
  };
}

/** How the documents are answered: JSON anyone may read (they are public by design), kept five minutes. */
export function metadataResponse(document: object): Response {
  return new Response(JSON.stringify(document), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=300',
    },
  });
}
