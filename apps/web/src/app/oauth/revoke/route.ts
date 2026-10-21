import { oauthApiCall } from '@/lib/connector/api-call';
import { revokeRequest } from '@/lib/connector/oauth-proxy';

// Token revocation for the Claude connector (owner, 21 October 2026: "the connection method"; RFC 7009): the
// connection the token belongs to ends.

export function POST(request: Request) {
  return revokeRequest(request, oauthApiCall);
}
