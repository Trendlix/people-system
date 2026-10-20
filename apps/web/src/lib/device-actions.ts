'use server';

// Fingerprint sign-in's actions (owner, 20 October 2026: chose Face ID / fingerprint sign-in for the app; README:
// "Sign-in: Face ID / fingerprint after the first password sign-in"; apps/mobile/README.md, "Phase 3 contract"). In the
// app, after a password sign-in: Turn on asks the API for a credential, whose secret the page hands straight to the
// phone's fingerprint (lib/native.ts, enrollBiometric), never to storage. Next time, the fingerprint unlocks it and the
// sign-in page trades it here for an ordinary app session, as signing in with the password does. Your Sessions signs a
// phone out. The API alone decides (an app session only, never while viewing as someone, its rate limit); these forward.
// The secret goes nowhere but the API request's body: never logged, never kept here.
import { DEVICE_PLATFORM_LABELS, deviceNameOf, isDevicePlatform, isDeviceRefusal, type DevicePlatform, type DeviceRefusal } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { API_URL, ApiError, apiSend, messagesOf } from './api';
import { clientIp } from './client-ip';
import { safeNext } from './safe-next';
import { keepSession } from './session-cookie';

/** A phone's name when it gave none: "Android phone", "iPhone". */
const UNNAMED: Record<DevicePlatform, string> = { android: `${DEVICE_PLATFORM_LABELS.android} phone`, ios: DEVICE_PLATFORM_LABELS.ios };

/** The longest id, secret (43 characters) or other word taken from the page. */
const MAX_TEXT = 200;
/** The longest page to go back to after signing in. */
const MAX_NEXT = 2000;

const isText = (value: unknown, max = MAX_TEXT): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

/** Turn on (Home, Your Sessions): the API's new credential for this phone, `{ id, secret }`, the secret this once. */
export async function turnOnFingerprint(input: { deviceName: string; platform: string }): Promise<{ id: string; secret: string } | { error: string }> {
  const platform: unknown = input?.platform;
  if (!isDevicePlatform(platform)) return { error: 'Fingerprint sign-in is turned on in the Trendlix People app, on an Android phone or an iPhone.' };
  const deviceName = deviceNameOf(input?.deviceName) ?? UNNAMED[platform];
  let made: { id?: unknown; secret?: unknown } | undefined;
  try {
    made = await apiSend<{ id?: unknown; secret?: unknown }>('POST', '/auth/devices', { deviceName, platform });
  } catch (err) {
    if (err instanceof ApiError) return { error: err.messages.join(' ') };
    throw err;
  }
  if (!isText(made?.id) || !isText(made?.secret)) return { error: 'Fingerprint sign-in couldn’t be turned on. Please try again.' };
  return { id: made.id, secret: made.secret };
}

/**
 * Signs a phone out of fingerprint sign-in: Your Sessions' Sign out (the page then shows the list again), and, best
 * effort, a credential just made whose turning on was cancelled or failed on the phone, so the server keeps none the
 * phone doesn't hold (`refresh: false`: nothing on the page to show again).
 */
export async function forgetFingerprint(id: string, options?: { refresh?: boolean }): Promise<{ error?: string }> {
  if (!isText(id)) return { error: 'That phone isn’t one of yours.' };
  try {
    await apiSend('POST', `/auth/devices/${encodeURIComponent(id)}/revoke`);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.messages.join(' ') };
    throw err;
  }
  if (options?.refresh !== false) refresh();
  return {};
}

/** Why the fingerprint didn't sign in: refused by the API (the password this time), or what went wrong. */
export interface FingerprintSignInState {
  refusal?: DeviceRefusal;
  error?: string;
}

/**
 * The sign-in page in the app: trades the credential the fingerprint unlocked for an app session (POST
 * /auth/devices/sign-in, public, with the app's user agent and address as signing in with the password sends them),
 * keeps its cookie, and opens `next` or the app's Home. A 401 says why (`refusal`: the page clears the phone's copy);
 * too many tries (429) and the rest in the API's words.
 */
export async function signInWithFingerprint(input: { id: string; secret: string; next: string }): Promise<FingerprintSignInState> {
  const id: unknown = input?.id;
  const secret: unknown = input?.secret;
  // nothing the API could take as a credential: none it knows
  if (!isText(id) || !isText(secret)) return { refusal: 'unknown' };
  const next = isText(input?.next, MAX_NEXT) ? input.next : '';

  const h = await headers();
  const userAgent = h.get('user-agent')?.trim().slice(0, 2000); // whole: the app's mark is at its end
  const ip = clientIp(h);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/auth/devices/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, secret, ...(userAgent && { userAgent }), ...(ip && { ip }) }),
    });
  } catch {
    return { error: 'Cannot reach the server. Please try again in a moment.' };
  }
  if (res.status === 401) {
    const body: unknown = await res.json().catch(() => null);
    const reason = body && typeof body === 'object' ? (body as { reason?: unknown }).reason : undefined;
    return { refusal: isDeviceRefusal(reason) ? reason : 'unknown' };
  }
  if (!res.ok) return { error: (await messagesOf(res)).join(' ') };

  if (!(await keepSession(res))) return { error: 'Sign-in failed. Please try again.' };
  redirect(safeNext(next, '/app'));
}
