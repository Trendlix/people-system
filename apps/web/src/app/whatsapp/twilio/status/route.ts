import 'server-only';
import '@/lib/api-ca';
import { API_URL } from '@/lib/api';
import { twilioWebhookPost } from '@/lib/whatsapp-twilio-webhook';
import type { ApiCall } from '@/lib/whatsapp-webhook';

// Twilio's status callback for WhatsApp (owner, 25 October 2026: "Add Twilio as a choice"): sent by the system with each
// message as its StatusCallback, https://people.trendlix.com/whatsapp/twilio/status, and shown on Organization → Company
// → WhatsApp. Public for the proxy (lib/public-paths.ts): Twilio calls it from its servers without a session; the API
// checks each call's X-Twilio-Signature (lib/whatsapp-twilio-webhook.ts passes the call on as it came).

const apiCall: ApiCall = (path, init) => fetch(`${API_URL}/api${path}`, init);

export function POST(request: Request) {
  return twilioWebhookPost(request, 'status', apiCall);
}
