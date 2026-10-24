'use server';

// Organization → Meetings (owner, 24 October 2026: "can i link an online meeting service provider to automatically
// generate meeting links?"; "make it both"): the page's forms, each forwarded to the API, which checks the session, that
// it is a Super Admin in their own session, and every value again, so calling these directly bypasses nothing. A secret
// typed is sent on to the API once and never comes back: the answers carry whether one is saved, never its value.
import { isMeetingProvider, type MeetingProvider, type MeetingSettingsView, type MeetingTestView } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { MeetingTestState } from '@/components/meeting-connection';
import type { FormState } from '@/lib/types';
import { defaultBody, hostBody, meetingAppBody, type MeetingAppState } from './setup';

const enc = (p: MeetingProvider) => encodeURIComponent(p);

/** The request's answer, or the API's refusal as the form's errors. */
async function refused<S extends FormState>(prev: S, request: () => Promise<S>): Promise<S> {
  try {
    return await request();
  } catch (err) {
    if (err instanceof ApiError) return { ...prev, errors: err.messages, message: undefined };
    throw err;
  }
}

const unknown = { errors: ['Choose a provider.'] };

/** PUT /meetings/apps/:provider: an empty secret box keeps the saved secret. */
export async function saveMeetingApp(provider: string, prev: MeetingAppState, fd: FormData): Promise<MeetingAppState> {
  if (!isMeetingProvider(provider)) return { ...unknown, saved: prev.saved };
  const { body, errors } = meetingAppBody(provider, fd);
  if (errors.length) return { errors, saved: prev.saved };
  return refused(prev, async () => {
    await apiSend<MeetingSettingsView>('PUT', `/meetings/apps/${enc(provider)}`, body);
    refresh();
    return { message: 'Saved.', saved: (prev.saved ?? 0) + 1 };
  });
}

/** POST /meetings/company/:provider/host: the company's Microsoft mailbox or Zoom user that hosts its meetings. */
export async function saveMeetingHost(provider: string, prev: FormState, fd: FormData): Promise<FormState> {
  if (provider !== 'microsoft' && provider !== 'zoom') return unknown;
  const { body, errors } = hostBody(fd);
  if (!body) return { errors };
  return refused(prev, async () => {
    await apiSend<MeetingSettingsView>('POST', `/meetings/company/${enc(provider)}/host`, body);
    refresh();
    return { message: 'Saved: the company’s meetings are hosted there.' };
  });
}

/** POST /meetings/company/:provider/disconnect. */
export async function disconnectCompanyMeetings(provider: string, prev: FormState): Promise<FormState> {
  if (!isMeetingProvider(provider)) return unknown;
  return refused(prev, async () => {
    await apiSend<MeetingSettingsView>('POST', `/meetings/company/${enc(provider)}/disconnect`);
    refresh();
    return { message: 'Disconnected.' };
  });
}

/** POST /meetings/company/:provider/test: one made and deleted at once, the result in plain words (kept as the last test). */
export async function testCompanyMeetings(provider: string, prev: MeetingTestState): Promise<MeetingTestState> {
  if (!isMeetingProvider(provider)) return unknown;
  return refused(prev, async () => {
    const test = await apiSend<MeetingTestView>('POST', `/meetings/company/${enc(provider)}/test`);
    refresh();
    return { test };
  });
}

/** PUT /meetings/default: the company connection new online interviews start with, or none. */
export async function saveMeetingDefault(prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = defaultBody(fd);
  if (!body) return { errors };
  return refused(prev, async () => {
    await apiSend<MeetingSettingsView>('PUT', '/meetings/default', body);
    refresh();
    return { message: body.choice ? 'Saved: new online interviews start with it.' : 'Saved: each scheduler starts with their own, else a pasted link.' };
  });
}
