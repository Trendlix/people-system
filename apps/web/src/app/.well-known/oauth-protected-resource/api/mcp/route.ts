import { metadataResponse, protectedResourceMetadata } from '@/lib/connector/metadata';
import { originOfRequest } from '@/lib/connector/site';

// RFC 9728 §3.1's address for the MCP endpoint /api/mcp (owner, 21 October 2026: "the connection method"): the one the
// 401's WWW-Authenticate names, and the one clients try first.

export function GET(request: Request) {
  return metadataResponse(protectedResourceMetadata(originOfRequest(request)));
}
