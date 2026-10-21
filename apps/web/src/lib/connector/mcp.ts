import { CONNECTOR_SCOPE, connectorResource, connectorResourceMetadataUrl, isConnectorAccessToken, type ConnectorMe } from '@trendlix/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { assetsApi, type ConnectorCall } from './assets-api';
import { mcpOriginAllowed, originOfRequest } from './site';
import { ASSET_TOOLS, SERVER_INSTRUCTIONS, type ToolContext } from './tools';

// The MCP endpoint of the Claude connector (owner, 21 October 2026: "the connection method": Claude reads and drafts in
// Assets on the owner's own Claude account), POST /api/mcp over Streamable HTTP, stateless: each request gets a server
// and a transport of its own (no session kept, JSON answers), as serverless hosting needs. Before the SDK runs, the
// request is checked here (Anthropic's connector docs: "Answer a protected call with 401 before the MCP SDK runs"):
// - an Origin header that isn't the site's or Claude's is refused (the transport spec's DNS rebinding rule);
// - no bearer token: 401 with WWW-Authenticate naming the protected resource metadata and the scope, which is what
//   starts Claude's sign-in;
// - a token that isn't the connector's, or one the API no longer accepts, or one issued for another MCP address
//   (RFC 8707: the token's resource must be this server): 401 invalid_token, so Claude refreshes or signs in again;
// - someone whose Assets access was taken away since: 403, said in the API's words.
// Pure code (no "@/" imports): the route gives it the call to the API. Tested, with the SDK's own client too.

export interface McpDeps {
  /** A request to the API (`path` under /api) with the connector's token. */
  call: ConnectorCall;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

/** A JSON-RPC error without an id, as the transport spec allows on a refused request. */
function rpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }), { status, headers: { ...JSON_HEADERS, ...headers } });
}

/** RFC 6750 §3: the challenge; `error` only when a token was sent and refused. */
export function challenge(origin: string, error?: { code: 'invalid_token'; description: string }): string {
  const parts = [
    ...(error ? [`error="${error.code}"`, `error_description="${error.description.replace(/"/g, "'")}"`] : []),
    `resource_metadata="${connectorResourceMetadataUrl(origin)}"`,
    `scope="${CONNECTOR_SCOPE}"`,
  ];
  return `Bearer ${parts.join(', ')}`;
}

function unauthorized(origin: string, description: string, tokenSent: boolean): Response {
  const body = { error: 'invalid_token', error_description: description };
  return new Response(JSON.stringify(body), {
    status: 401,
    headers: { ...JSON_HEADERS, 'www-authenticate': challenge(origin, tokenSent ? { code: 'invalid_token', description } : undefined) },
  });
}

const SIGN_IN = 'Sign in to Trendlix People to use Assets.';

/** The bearer token of the Authorization header, or null. */
export function bearerOf(authorization: string | null): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '');
  return m ? m[1] : null;
}

/** The MCP server for one request: the Assets tools bound to this connection. */
export function assetsServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: 'trendlix-people-assets', title: 'Trendlix People · Assets', version: '1.0.0' }, { instructions: SERVER_INSTRUCTIONS });
  for (const tool of ASSET_TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      (args: Record<string, unknown>) => tool.run(args, ctx),
    );
  }
  return server;
}

/** Whose connection the token is, from the API: their access now, or the response refusing the request. */
async function connectionOf(token: string, origin: string, deps: McpDeps): Promise<{ me: ConnectorMe } | { refusal: Response }> {
  let res: Response;
  try {
    res = await deps.call('/connector/me', token, { method: 'GET' });
  } catch {
    return { refusal: rpcError(503, 'Trendlix People can’t be reached right now. Please try again in a moment.') };
  }
  if (res.status === 401) return { refusal: unauthorized(origin, 'The connection has ended or the token has expired.', true) };
  if (res.status === 403) {
    let message = 'You do not have access to Assets.';
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // the words above
    }
    return { refusal: rpcError(403, message) };
  }
  if (!res.ok) return { refusal: rpcError(503, 'Trendlix People couldn’t answer. Please try again in a moment.') };
  let me: ConnectorMe;
  try {
    me = (await res.json()) as ConnectorMe;
  } catch {
    return { refusal: rpcError(503, 'Trendlix People sent an answer that could not be read.') };
  }
  // RFC 8707: only a token issued for this very address
  if (me.resource !== connectorResource(origin)) return { refusal: unauthorized(origin, 'This token was issued for another address.', true) };
  return { me };
}

/** POST /api/mcp (and the other methods, refused). */
export async function handleMcp(request: Request, deps: McpDeps): Promise<Response> {
  const origin = originOfRequest(request);
  if (!mcpOriginAllowed(request.headers.get('origin'), origin)) return rpcError(403, 'This origin may not call the Trendlix People connector.');
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: send each message as a POST.' }, id: null }), {
      status: 405,
      headers: { ...JSON_HEADERS, allow: 'POST' },
    });
  }

  const token = bearerOf(request.headers.get('authorization'));
  if (!token) return unauthorized(origin, SIGN_IN, false);
  // only the connector's own tokens are ever passed to the API from here (no website session token, no other issuer's)
  if (!isConnectorAccessToken(token)) return unauthorized(origin, 'This is not a Trendlix People connector token.', true);
  const connection = await connectionOf(token, origin, deps);
  if ('refusal' in connection) return connection.refusal;
  const { me } = connection;

  const server = assetsServer({ api: assetsApi(deps.call, token), me, origin });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, { authInfo: { token, clientId: me.client ?? 'claude', scopes: [me.scope], resource: new URL(connectorResource(origin)) } });
  } finally {
    // stateless: nothing is kept once the answer is ready
    void server.close().catch(() => undefined);
  }
}
