'use server';

// Push notifications on the phone (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for
// someone, a check-in reminder)"; apps/mobile/README.md, Phase 4): the app's push token, given by the phone (lib/native.ts,
// registerForPush), registered with the API for the person signed in, by Home's Turn on and silently on each open of the
// app once allowed (which keeps the token and its last seen fresh). The API alone decides: an app session only, never
// while viewing as someone (403). Signing out unregisters it (app/login/actions.ts, logout).
import { isDevicePlatform } from '@trendlix/shared';
import { ApiError, apiSend } from './api';
import { pushTokenOf, PUSH_TEXT } from './notifications';

/** Registers this phone's push token with the API (POST /me/push-devices); the API's words when it refuses. */
export async function registerPushDevice(input: { token: string; platform: string }): Promise<{ error?: string }> {
  const token = pushTokenOf(input?.token);
  const platform: unknown = input?.platform;
  if (!token || !isDevicePlatform(platform)) return { error: PUSH_TEXT.failed };
  try {
    await apiSend('POST', '/me/push-devices', { token, platform });
  } catch (err) {
    if (err instanceof ApiError) return { error: err.status === 404 ? PUSH_TEXT.failed : err.messages.join(' ') };
    throw err;
  }
  return {};
}
