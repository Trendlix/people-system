import { authorizationServerMetadata, metadataResponse } from '@/lib/connector/metadata';
import { originOfRequest } from '@/lib/connector/site';

// RFC 8414's authorization server metadata for the Claude connector (owner, 21 October 2026: "the connection method"):
// the issuer is this site's origin, so it is served at the root's well-known address.

export function GET(request: Request) {
  return metadataResponse(authorizationServerMetadata(originOfRequest(request)));
}
