import { metadataResponse, protectedResourceMetadata } from '@/lib/connector/metadata';
import { originOfRequest } from '@/lib/connector/site';

// RFC 9728's protected resource metadata for the Claude connector (owner, 21 October 2026: "the connection method"), at
// the root: the MCP endpoint and this site as its authorization server. The same at …/oauth-protected-resource/api/mcp.

export function GET(request: Request) {
  return metadataResponse(protectedResourceMetadata(originOfRequest(request)));
}
