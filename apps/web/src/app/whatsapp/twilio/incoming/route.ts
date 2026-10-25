import 'server-only';
import '@/lib/api-ca';
import { API_URL } from '@/lib/api';
import { twilioWebhookPost } from '@/lib/whatsapp-twilio-webhook';
import type { ApiCall } from '@/lib/whatsapp-webhook';

// What people write to the business number, through Twilio (owner, 25 October 2026: "Add Twilio as a choice"; "No,
// WhatsApp only"): the WhatsApp sender's "When a message comes in" in the Twilio Console,
// https://people.trendlix.com/whatsapp/twilio/incoming, shown on Organization → Company → WhatsApp. Public for the proxy
// (lib/public-paths.ts); the API checks each call's X-Twilio-Signature and reads STOP from it, nothing else.

const apiCall: ApiCall = (path, init) => fetch(`${API_URL}/api${path}`, init);

export function POST(request: Request) {
  return twilioWebhookPost(request, 'incoming', apiCall);
}
