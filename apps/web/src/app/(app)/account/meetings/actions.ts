'use server';

// Your Meetings (owner, 24 October 2026: "make it both": each HR person's own Google, Microsoft or Zoom account, connected
// by them): Disconnect and Create a test meeting, forwarded to the API, which checks it is HR or a Super Admin in their
// own session, so calling these directly bypasses nothing. Connecting is lib/meeting-actions.ts startMeetingConnect.
import { isMeetingProvider, type MeetingTestView, type MyMeetingsView } from '@trendlix/shared';
import { refresh } from 'next/cache';
import type { MeetingTestState } from '@/components/meeting-connection';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';

/** POST /meetings/mine/:provider/disconnect. */
export async function disconnectMyMeetings(provider: string): Promise<FormState> {
  if (!isMeetingProvider(provider)) return { errors: ['Choose a provider.'] };
  try {
    await apiSend<MyMeetingsView>('POST', `/meetings/mine/${encodeURIComponent(provider)}/disconnect`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  return { message: 'Disconnected.' };
}

/** POST /meetings/mine/:provider/test: one made with their own account and deleted at once, the result in plain words. */
export async function testMyMeetings(provider: string, prev: MeetingTestState): Promise<MeetingTestState> {
  if (!isMeetingProvider(provider)) return { errors: ['Choose a provider.'] };
  try {
    const test = await apiSend<MeetingTestView>('POST', `/meetings/mine/${encodeURIComponent(provider)}/test`);
    refresh();
    return { test };
  } catch (err) {
    if (err instanceof ApiError) return { ...prev, errors: err.messages };
    throw err;
  }
}
