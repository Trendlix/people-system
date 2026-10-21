import { clientIp } from '@/lib/client-ip';
import { oauthApiCall } from '@/lib/connector/api-call';
import { tokenRequest } from '@/lib/connector/oauth-proxy';

// The Claude connector's token endpoint (owner, 21 October 2026: "the connection method"; RFC 6749 §3.2): an
// authorization code (with its PKCE verifier) or a refresh token traded for tokens. Decided by the API.

export function POST(request: Request) {
  return tokenRequest(request, oauthApiCall, { ip: clientIp(request.headers), userAgent: request.headers.get('user-agent') ?? undefined });
}
