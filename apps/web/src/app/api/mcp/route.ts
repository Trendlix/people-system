import { connectorApiCall } from '@/lib/connector/api-call';
import { handleMcp } from '@/lib/connector/mcp';

// The Claude connector's MCP endpoint (owner, 21 October 2026: "the connection method"), the address pasted into Claude:
// https://people.trendlix.com/api/mcp. Streamable HTTP, stateless; checked and served by lib/connector/mcp.ts, every tool
// call going to the API with the connector's token. Public for the proxy (lib/public-paths.ts): it answers 401 itself.

const serve = (request: Request) => handleMcp(request, { call: connectorApiCall });

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
