import 'server-only';
import type { MeetingChoices } from '@trendlix/shared';
import { apiFetch } from '@/lib/api';
import { NO_MEETING_CHOICES } from './meetings';

// "Create the meeting with" for the interview form (owner, 24 October 2026: "automatically generate meeting links";
// "make it both"): GET /meetings/choices, the company's connections and the scheduler's own. Anything but an answer (a
// refusal, an API from before it, the API down) offers "Paste a link" only, as before: the form never fails for it.
export async function loadMeetingChoices(): Promise<MeetingChoices> {
  try {
    const res = await apiFetch('/meetings/choices');
    if (!res.ok) return NO_MEETING_CHOICES;
    const body = (await res.json()) as MeetingChoices;
    return Array.isArray(body?.choices) && typeof body.start === 'string' ? body : NO_MEETING_CHOICES;
  } catch {
    return NO_MEETING_CHOICES;
  }
}
