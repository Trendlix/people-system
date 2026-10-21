import { clientIp } from '@/lib/client-ip';
import { oauthApiCall } from '@/lib/connector/api-call';
import { registerRequest } from '@/lib/connector/oauth-proxy';

// Dynamic client registration for the Claude connector (owner, 21 October 2026: "the connection method"; RFC 7591):
// Claude registers itself; the API accepts only Claude's own return addresses.

export function POST(request: Request) {
  return registerRequest(request, oauthApiCall, { ip: clientIp(request.headers) });
}
