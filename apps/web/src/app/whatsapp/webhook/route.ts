import 'server-only';
import '@/lib/api-ca';
import { API_URL } from '@/lib/api';
import { webhookGet, webhookPost, type ApiCall } from '@/lib/whatsapp-webhook';

// Meta's WhatsApp webhook (owner, 24 October 2026: "how to make whatsapp notifications?"; "Directly to Meta"): the
// Callback URL shown on Organization → Company → WhatsApp, https://people.trendlix.com/whatsapp/webhook. Public for the
// proxy (lib/public-paths.ts): Meta calls it from its servers without a session; the API checks the verify token and
// each event's signature (lib/whatsapp-webhook.ts passes them on as they came).

const apiCall: ApiCall = (path, init) => fetch(`${API_URL}/api${path}`, init);

export function GET(request: Request) {
  return webhookGet(request, apiCall);
}

export function POST(request: Request) {
  return webhookPost(request, apiCall);
}
