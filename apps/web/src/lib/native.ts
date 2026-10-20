import { PUSH_CHANNEL, PUSH_TOKEN_MAX } from '@trendlix/shared';
import { readLocation, LOCATION_GIVE_UP_MS, LOCATION_OPTIONS, type LocationResult } from '../app/(app)/my-attendance/check-in';

// The one bridge to the phone's own features (owner, 20 October 2026: "what if we tried to build a mobile app for the
// employees? to enable them to check in and out, and apply for their requests"; apps/mobile/README.md, "The native
// bridge"). Inside the TrendLIX People app, a Capacitor shell showing these pages, `window.Capacitor` is there with the
// plugins the shell carries; in a phone's or a computer's browser it isn't, and each helper falls back to the browser's
// own way. The web app depends on no Capacitor package: the plugins are reached through `window.Capacitor.Plugins`,
// typed here, and every page calls the phone only through this file. Phase 1: where the app runs. Phase 2 (20 October
// 2026, README: "location through the Capacitor Geolocation plugin inside the app (high accuracy, a timeout, a clear
// message when refused) … Android mock location → mock: true on the punch"; "Receipts: the Camera plugin inside the
// app"): the location for a check-in from the app's own TrendlixLocation plugin, which tells a mock (fake GPS)
// location, else the Geolocation plugin, else the browser's; a photo from the app's camera as a File for the forms.
// Phase 3 (owner, 20 October 2026: chose Face ID / fingerprint sign-in for the app; README: "Sign-in: Face ID /
// fingerprint after the first password sign-in"): the app's own TrendlixBiometric plugin keeps the sign-in's secret
// behind the fingerprint. Phase 4 (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for
// someone, a check-in reminder)"; README, Phase 4): the Capacitor Push Notifications plugin asks the phone's permission,
// gives the phone's push token for the website to register with the API, and tells the page of a notification opened or
// received while the app is open; only in an APK built with Firebase's settings, which the app's own TrendlixPush plugin
// says (without them the plugin's register() crashes the app). No "@/" imports: it is unit tested.

// ---------- what the shell puts on the page ----------

/** The part of `window.Capacitor` used here (Capacitor 6+: isNativePlatform, getPlatform, isPluginAvailable, Plugins). */
export interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  isPluginAvailable?: (name: string) => boolean;
  Plugins?: Record<string, unknown>;
}

/** Where the helpers look: the page's `window` (globalThis in a browser), or a stand-in in the tests. */
export interface NativeHost {
  Capacitor?: CapacitorGlobal;
  navigator?: { geolocation?: Pick<Geolocation, 'getCurrentPosition'> };
}

const host = (): NativeHost | undefined => (typeof globalThis === 'undefined' ? undefined : (globalThis as unknown as NativeHost));

/** The shell's Capacitor object; null in a browser (and on the server). */
export function capacitorOf(win: NativeHost | undefined = host()): CapacitorGlobal | null {
  const c = win?.Capacitor;
  return c && typeof c === 'object' ? c : null;
}

/** Whether the page is shown inside the TrendLIX People app (not a browser, nor the server). */
export function isNativeApp(win: NativeHost | undefined = host()): boolean {
  const c = capacitorOf(win);
  try {
    return typeof c?.isNativePlatform === 'function' && c.isNativePlatform() === true;
  } catch {
    return false;
  }
}

/** The phone the app runs on: "android" or "ios"; "web" in a browser. */
export function nativePlatform(win: NativeHost | undefined = host()): 'android' | 'ios' | 'web' {
  if (!isNativeApp(win)) return 'web';
  let platform = '';
  try {
    platform = capacitorOf(win)?.getPlatform?.() ?? '';
  } catch {
    platform = '';
  }
  return platform === 'android' || platform === 'ios' ? platform : 'web';
}

/** A plugin the shell carries, by its name ("Geolocation"); null outside the app or when the shell doesn't carry it. */
export function pluginOf<T>(name: string, win: NativeHost | undefined = host()): T | null {
  if (!isNativeApp(win)) return null;
  const c = capacitorOf(win);
  try {
    if (typeof c?.isPluginAvailable === 'function' && !c.isPluginAvailable(name)) return null;
  } catch {
    return null;
  }
  const plugin = c?.Plugins?.[name];
  return plugin && typeof plugin === 'object' ? (plugin as T) : null;
}

// ---------- the location, for a check-in ----------

/** The Capacitor Geolocation plugin, as far as it is used (@capacitor/geolocation's getCurrentPosition). */
export interface GeolocationPlugin {
  getCurrentPosition(options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number }): Promise<{
    coords: { latitude: number; longitude: number; accuracy?: number | null };
    timestamp?: number;
  }>;
}

/**
 * The plugin's refusal as the browser's error code: 1 refused (location permission denied), 3 too slow, 2 anything else
 * (location services off, no fix). The plugin says it in words (its message, or its code such as OS-PLUG-GLOC-0003).
 */
export function pluginErrorCode(err: unknown): 1 | 2 | 3 {
  const e = (err ?? {}) as { message?: unknown; code?: unknown };
  const text = `${typeof e.message === 'string' ? e.message : ''} ${typeof e.code === 'string' ? e.code : ''}`.toLowerCase();
  if (/denied|permission|not authori[sz]ed/.test(text)) return 1;
  if (/time ?out|timed out/.test(text)) return 3;
  return 2;
}

/** The plugin shaped as the browser's navigator.geolocation, so the check-in reads either the same way. */
export function pluginAsGeolocation(plugin: GeolocationPlugin): Pick<Geolocation, 'getCurrentPosition'> {
  return {
    getCurrentPosition(success, error, options) {
      const opts = options ? { enableHighAccuracy: options.enableHighAccuracy, timeout: options.timeout, maximumAge: options.maximumAge } : undefined;
      let asked: Promise<Awaited<ReturnType<GeolocationPlugin['getCurrentPosition']>>>;
      try {
        asked = plugin.getCurrentPosition(opts);
      } catch (err) {
        asked = Promise.reject(err);
      }
      asked.then(
        (position) => success({ coords: position?.coords, timestamp: position?.timestamp ?? Date.now() } as unknown as GeolocationPosition),
        (err: unknown) => error?.({ code: pluginErrorCode(err), message: err instanceof Error ? err.message : String(err ?? '') } as GeolocationPositionError),
      );
    },
  };
}

/**
 * Where to read the location from when the app's own plugin isn't there (or can't read it): inside the app, the
 * Geolocation plugin when the shell carries it (better accuracy than the web view's); else the browser's
 * navigator.geolocation (the app's web view has it too); null when there is neither.
 */
export function geolocationSource(win: NativeHost | undefined = host()): Pick<Geolocation, 'getCurrentPosition'> | null {
  const plugin = pluginOf<GeolocationPlugin>('Geolocation', win);
  if (plugin && typeof plugin.getCurrentPosition === 'function') return pluginAsGeolocation(plugin);
  const geo = win?.navigator?.geolocation;
  return geo && typeof geo.getCurrentPosition === 'function' ? geo : null;
}

/** The name the shell registers its own location plugin under (apps/mobile/android, TrendlixLocationPlugin.java). */
export const OWN_LOCATION_PLUGIN = 'TrendlixLocation';

/**
 * The app's own location plugin (Phase 2, 20 October 2026; apps/mobile/README.md, "Fake GPS"): Android's fused location
 * read once, as precise as it can within the timeout, with whether Android said it is a mock one (Location.isMock, or
 * isFromMockProvider before Android 12), which the Geolocation plugin doesn't give. It refuses with a code: DENIED (the
 * permission refused), LOCATION_OFF (the phone's location off), TIMEOUT, UNAVAILABLE, NO_PLAY_SERVICES (a phone
 * without Google Play services: the Geolocation plugin reads it instead).
 */
export interface TrendlixLocationPlugin {
  getPosition(options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number }): Promise<{
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    timestamp?: number;
    mock?: boolean;
  }>;
}

/** A plugin's refusal code ("NO_PLAY_SERVICES", "OS-PLUG-GLOC-0003"); empty when it has none. */
const codeOf = (err: unknown): string => {
  const code = (err ?? {}) as { code?: unknown };
  return typeof code.code === 'string' ? code.code : '';
};

/**
 * The app's own plugin shaped as the browser's navigator.geolocation, so readLocation reads it as any other (its give-up
 * timer, the error codes), the point's `mock` kept beside its coordinates. `refused`: told the plugin's refusal as it is.
 */
export function ownLocationAsGeolocation(plugin: TrendlixLocationPlugin, refused?: (err: unknown) => void): Pick<Geolocation, 'getCurrentPosition'> {
  return {
    getCurrentPosition(success, error, options) {
      const opts = { enableHighAccuracy: options?.enableHighAccuracy ?? true, timeout: options?.timeout ?? LOCATION_OPTIONS.timeout, maximumAge: options?.maximumAge ?? 0 };
      let asked: ReturnType<TrendlixLocationPlugin['getPosition']>;
      try {
        asked = plugin.getPosition(opts);
      } catch (err) {
        asked = Promise.reject(err);
      }
      asked.then(
        (p) =>
          success({
            coords: { latitude: p?.latitude, longitude: p?.longitude, accuracy: p?.accuracy ?? null, mock: p?.mock },
            timestamp: p?.timestamp ?? Date.now(),
          } as unknown as GeolocationPosition),
        (err: unknown) => {
          refused?.(err);
          error?.({ code: pluginErrorCode(err), message: err instanceof Error ? err.message : String(err ?? '') } as GeolocationPositionError);
        },
      );
    },
  };
}

/**
 * Where the phone or computer is, read once for a check-in, fresh and as precise as it can within 10 seconds
 * (my-attendance/check-in.ts, LOCATION_OPTIONS). Inside the app: its own plugin, saying whether the point is a mock one
 * (`mock`); on a phone without Google Play services, the Geolocation plugin (mock not known). In a browser: its
 * navigator.geolocation (mock not known: left out). Never fails: refused, unavailable, too slow or not supported is its
 * reason, which the check-in sends instead of a point.
 */
export async function getPosition(win: NativeHost | undefined = host(), giveUpMs = LOCATION_GIVE_UP_MS): Promise<LocationResult> {
  const own = pluginOf<TrendlixLocationPlugin>(OWN_LOCATION_PLUGIN, win);
  if (own && typeof own.getPosition === 'function') {
    const seen = { noPlayServices: false };
    const refused = (err: unknown) => {
      seen.noPlayServices = codeOf(err) === 'NO_PLAY_SERVICES';
    };
    const result = await readLocation(ownLocationAsGeolocation(own, refused), giveUpMs);
    if (!seen.noPlayServices) return result;
  }
  return readLocation(geolocationSource(win), giveUpMs);
}

// ---------- the camera, for a receipt or a document ----------

/** The Capacitor Camera plugin, as far as it is used (@capacitor/camera 8's takePhoto). */
export interface CameraPlugin {
  takePhoto(options?: { quality?: number; correctOrientation?: boolean; saveToGallery?: boolean; editable?: 'in-app' | 'external' | 'no' }): Promise<{
    webPath?: string;
    uri?: string;
    metadata?: { format?: string };
  }>;
}

/** Whether Take a photo opens the app's own camera: inside the app whose shell carries the Camera plugin. */
export function canTakePhoto(win: NativeHost | undefined = host()): boolean {
  const camera = pluginOf<CameraPlugin>('Camera', win);
  return !!camera && typeof camera.takePhoto === 'function';
}

/** What Take a photo gave: the photo as a file; closed without one; refused or failed, in words; no camera of the app's here. */
export type PhotoResult = { kind: 'photo'; file: File } | { kind: 'cancelled' } | { kind: 'failed'; message: string } | { kind: 'unavailable' };

/** What is said when the app's camera can't give the photo. */
export const CAMERA_MESSAGES = {
  denied: 'TrendLIX People isn’t allowed to use the camera: allow it on the phone (Settings → Apps → TrendLIX People → Permissions → Camera), or choose a file instead.',
  failed: 'The photo couldn’t be taken. Please try again, or choose a file instead.',
} as const;

/** The camera plugin's refusal: closed without a photo, the camera permission refused, or anything else. */
export function cameraErrorKind(err: unknown): 'cancelled' | 'denied' | 'failed' {
  const e = (err ?? {}) as { message?: unknown };
  const text = `${typeof e.message === 'string' ? e.message : ''} ${codeOf(err)}`.toLowerCase();
  if (/cancel|no picture|no image|not taken/.test(text)) return 'cancelled';
  if (/denied|permission|not authori[sz]ed/.test(text)) return 'denied';
  return 'failed';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A photo's file name from when it was taken, on the phone's clock: "photo-20261020-091503.jpg" (".png" for a PNG). */
export function photoName(taken: Date, type = 'image/jpeg'): string {
  const day = `${taken.getFullYear()}${pad(taken.getMonth() + 1)}${pad(taken.getDate())}`;
  const time = `${pad(taken.getHours())}${pad(taken.getMinutes())}${pad(taken.getSeconds())}`;
  return `photo-${day}-${time}.${type === 'image/png' ? 'png' : 'jpg'}`;
}

/** The photo the camera saved, read from the app's own address for it (served by the shell, on the site's origin). */
async function loadPhoto(address: string): Promise<Blob> {
  const res = await fetch(address);
  if (!res.ok) throw new Error(`The photo couldn’t be read (${res.status}).`);
  return res.blob();
}

/**
 * A photo from the phone's camera, for a receipt or a leave document (Phase 2: the Camera plugin inside the app, the
 * back camera, upright, not saved to the gallery), as a File the forms take as a chosen one (made smaller there).
 * Outside the app, or a shell without the plugin: "unavailable", and the page's file box (capture="environment") is
 * the way. `load` reads the photo's address (the tests give their own).
 */
export async function takePhoto(win: NativeHost | undefined = host(), load: (address: string) => Promise<Blob> = loadPhoto, now: () => Date = () => new Date()): Promise<PhotoResult> {
  const camera = pluginOf<CameraPlugin>('Camera', win);
  if (!camera || typeof camera.takePhoto !== 'function') return { kind: 'unavailable' };
  let photo: Awaited<ReturnType<CameraPlugin['takePhoto']>>;
  try {
    photo = await camera.takePhoto({ quality: 90, correctOrientation: true, saveToGallery: false, editable: 'no' });
  } catch (err) {
    const kind = cameraErrorKind(err);
    return kind === 'cancelled' ? { kind } : { kind: 'failed', message: CAMERA_MESSAGES[kind] };
  }
  const address = photo?.webPath;
  if (!address) return { kind: 'failed', message: CAMERA_MESSAGES.failed };
  try {
    const blob = await load(address);
    const type = blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
    const taken = now();
    return { kind: 'photo', file: new File([blob], photoName(taken, type), { type, lastModified: taken.getTime() }) };
  } catch {
    return { kind: 'failed', message: CAMERA_MESSAGES.failed };
  }
}

// ---------- the fingerprint, for signing in (Phase 3) ----------

/** The name the shell registers its own biometric plugin under (apps/mobile/android, TrendlixBiometricPlugin.java). */
export const OWN_BIOMETRIC_PLUGIN = 'TrendlixBiometric';

/**
 * The app's own biometric plugin (Phase 3, 20 October 2026; apps/mobile/README.md, "Phase 3 contract"): an AES key in the
 * Android Keystore that needs a strong biometric (on Android, the fingerprint) for every use; the sign-in's secret is
 * kept encrypted with it, behind the prompt. It refuses with a code: CANCELLED (closed, or "Use password"), LOCKOUT (too
 * many tries), KEY_INVALIDATED (a fingerprint added or removed since: everything cleared), NOT_AVAILABLE, FAILED. The
 * prompt's texts come from the page.
 */
export interface TrendlixBiometricPlugin {
  isAvailable(): Promise<{ available: boolean; reason?: string; deviceName?: string }>;
  isEnrolled(): Promise<{ enrolled: boolean; id?: string }>;
  enroll(options: { id: string; secret: string; title?: string; negativeButtonText?: string }): Promise<{ enrolled: boolean }>;
  unlock(options?: { title?: string; negativeButtonText?: string }): Promise<{ id?: string; secret?: string }>;
  clear(): Promise<unknown>;
}

/** The prompt's texts (no text for people in native code): turning it on, and signing in. */
export const BIOMETRIC_PROMPTS = {
  enroll: { title: 'Turn on fingerprint sign-in', negativeButtonText: 'Cancel' },
  unlock: { title: 'Sign in to TrendLIX People', negativeButtonText: 'Use password' },
} as const;

/** Why the fingerprint can't sign in here: not the app (or a shell without the plugin), or what the phone said. */
export type BiometricUnavailableReason = 'NOT_APP' | 'NONE_ENROLLED' | 'NO_HARDWARE' | 'WEAK_ONLY' | 'UNAVAILABLE';

const PHONE_REASONS: readonly BiometricUnavailableReason[] = ['NONE_ENROLLED', 'NO_HARDWARE', 'WEAK_ONLY', 'UNAVAILABLE'];

/**
 * What the phone can do: whether a strong biometric can unlock (`reason` why not, null when it can), whether a sign-in is
 * kept behind it (`id`: the credential's id, never the secret), the phone's own name ("Google Pixel 8") and its kind.
 */
export interface BiometricStatus {
  available: boolean;
  reason: BiometricUnavailableReason | null;
  enrolled: boolean;
  id: string | null;
  deviceName: string | null;
  platform: 'android' | 'ios' | null;
}

/** The plugin, when the shell carries one that answers to it; null outside the app. */
function biometricPlugin(win: NativeHost | undefined): TrendlixBiometricPlugin | null {
  const plugin = pluginOf<TrendlixBiometricPlugin>(OWN_BIOMETRIC_PLUGIN, win);
  return plugin && typeof plugin.isAvailable === 'function' && typeof plugin.unlock === 'function' ? plugin : null;
}

const filled = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/**
 * What the phone can do for fingerprint sign-in. Outside the app, or a shell without the plugin: not available
 * (NOT_APP), nothing kept. A plugin that fails to answer: not available (UNAVAILABLE). Never throws.
 */
export async function biometricStatus(win: NativeHost | undefined = host()): Promise<BiometricStatus> {
  const off = (reason: BiometricUnavailableReason): BiometricStatus => ({ available: false, reason, enrolled: false, id: null, deviceName: null, platform: null });
  const plugin = biometricPlugin(win);
  if (!plugin) return off('NOT_APP');
  const kind = nativePlatform(win);
  const platform = kind === 'web' ? null : kind;
  let answer: Awaited<ReturnType<TrendlixBiometricPlugin['isAvailable']>>;
  try {
    answer = await plugin.isAvailable();
  } catch {
    return { ...off('UNAVAILABLE'), platform };
  }
  const deviceName = filled(answer?.deviceName) ? answer.deviceName.trim() : null;
  const available = answer?.available === true;
  const said = answer?.reason as BiometricUnavailableReason | undefined;
  const reason = available ? null : said && PHONE_REASONS.includes(said) ? said : 'UNAVAILABLE';
  let kept: Awaited<ReturnType<TrendlixBiometricPlugin['isEnrolled']>> | null = null;
  try {
    kept = typeof plugin.isEnrolled === 'function' ? await plugin.isEnrolled() : null;
  } catch {
    kept = null;
  }
  const id = kept?.enrolled === true && filled(kept.id) ? kept.id : null;
  return { available, reason, enrolled: id !== null, id, deviceName, platform };
}

/** Turning it on: kept behind the fingerprint; closed; too many tries; no strong biometric here; anything else. */
export type BiometricEnrollResult = { kind: 'enrolled' } | { kind: 'cancelled' } | { kind: 'lockout' } | { kind: 'unavailable' } | { kind: 'failed' };

/** Signing in: the credential, unlocked; closed; too many tries; the fingerprints changed (all cleared); none here; anything else. */
export type BiometricUnlockResult =
  | { kind: 'unlocked'; id: string; secret: string }
  | { kind: 'cancelled' }
  | { kind: 'lockout' }
  | { kind: 'key_invalidated' }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

/** A plugin refusal's code, as a result's kind. */
function refusalKind(err: unknown): 'cancelled' | 'lockout' | 'key_invalidated' | 'unavailable' | 'failed' {
  switch (codeOf(err)) {
    case 'CANCELLED':
      return 'cancelled';
    case 'LOCKOUT':
      return 'lockout';
    case 'KEY_INVALIDATED':
      return 'key_invalidated';
    case 'NOT_AVAILABLE':
      return 'unavailable';
    default:
      return 'failed';
  }
}

/**
 * Keeps the credential the API just made behind the phone's fingerprint (the prompt: "Turn on fingerprint sign-in").
 * The secret goes to the plugin only: never logged, never kept by the page. Never throws.
 */
export async function enrollBiometric(id: string, secret: string, win: NativeHost | undefined = host()): Promise<BiometricEnrollResult> {
  const plugin = biometricPlugin(win);
  if (!plugin || typeof plugin.enroll !== 'function') return { kind: 'unavailable' };
  if (!filled(id) || !filled(secret)) return { kind: 'failed' };
  try {
    const answer = await plugin.enroll({ id, secret, ...BIOMETRIC_PROMPTS.enroll });
    return answer?.enrolled === true ? { kind: 'enrolled' } : { kind: 'failed' };
  } catch (err) {
    const kind = refusalKind(err);
    // a key changed while turning it on is a failure like any other: the page asks again
    return { kind: kind === 'key_invalidated' ? 'failed' : kind };
  }
}

/**
 * Asks for the fingerprint to sign in (the prompt: "Sign in to TrendLIX People", "Use password"), giving the credential
 * it unlocks, for the sign-in action only. An answer without both is a failure. Never throws.
 */
export async function unlockBiometric(win: NativeHost | undefined = host()): Promise<BiometricUnlockResult> {
  const plugin = biometricPlugin(win);
  if (!plugin) return { kind: 'unavailable' };
  try {
    const answer = await plugin.unlock({ ...BIOMETRIC_PROMPTS.unlock });
    return filled(answer?.id) && filled(answer?.secret) ? { kind: 'unlocked', id: answer.id, secret: answer.secret } : { kind: 'failed' };
  } catch (err) {
    return { kind: refusalKind(err) };
  }
}

/** Forgets the phone's credential (the key and what is kept): the API refused it, or it was signed out. Never rejects. */
export async function clearBiometric(win: NativeHost | undefined = host()): Promise<void> {
  const plugin = pluginOf<TrendlixBiometricPlugin>(OWN_BIOMETRIC_PLUGIN, win);
  try {
    if (plugin && typeof plugin.clear === 'function') await plugin.clear();
  } catch {
    // nothing kept, or the plugin failed: the API no longer takes it either way
  }
}

// ---------- push notifications (Phase 4) ----------

/** The name the Capacitor Push Notifications plugin (@capacitor/push-notifications 8) is registered under. */
export const PUSH_PLUGIN = 'PushNotifications';

/** What the phone says of the notifications permission (Android 13+ asks for POST_NOTIFICATIONS; before, it is given). */
export type PushPermissionState = 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied';

/** A listener the plugin added, to take off again. */
export interface PushListenerHandle {
  remove(): Promise<void>;
}

/** A notification as the plugin gives it: what it said, and its data (the API's { link, kind, id }, strings). */
export interface PushMessage {
  id?: string;
  title?: string;
  body?: string;
  data?: unknown;
}

/** The events the plugin tells of: the token, a failed registration, one received while open, one tapped. */
export type PushEventName = 'registration' | 'registrationError' | 'pushNotificationReceived' | 'pushNotificationActionPerformed';

/** The Android notification channel, as createChannel takes it (importance 1–5: 4 is high, shown as a heads-up). */
export interface PushChannel {
  id: string;
  name: string;
  description?: string;
  importance?: 1 | 2 | 3 | 4 | 5;
  visibility?: -1 | 0 | 1;
  vibration?: boolean;
  lights?: boolean;
}

/** The plugin, as far as it is used. */
export interface PushNotificationsPlugin {
  checkPermissions(): Promise<{ receive: PushPermissionState }>;
  requestPermissions(): Promise<{ receive: PushPermissionState }>;
  register(): Promise<void>;
  unregister?(): Promise<void>;
  createChannel?(channel: PushChannel): Promise<void>;
  addListener(eventName: PushEventName, listener: (event: never) => void): Promise<PushListenerHandle> | PushListenerHandle;
  removeAllListeners?(): Promise<void>;
}

/** Whether notifications can come to this phone: not the app (or no plugin), not asked yet, allowed, or refused. */
export type PushStatus = 'unavailable' | 'prompt' | 'granted' | 'denied';

/** What registering came to: the phone's token, or why there is none. `not_asked`: not allowed yet, and not asked. */
export type PushRegistration =
  | { token: string; platform: 'android' | 'ios' }
  | { reason: 'unavailable' | 'not_asked' | 'denied' | 'failed' | 'timeout' };

/** How long registering waits for the phone's token (Firebase answers within a few seconds online). */
export const PUSH_REGISTER_TIMEOUT_MS = 15_000;

/** The plugin, when the app's shell carries one that answers to it; null outside the app. */
function pushPlugin(win: NativeHost | undefined): PushNotificationsPlugin | null {
  const plugin = pluginOf<PushNotificationsPlugin>(PUSH_PLUGIN, win);
  return plugin && typeof plugin.checkPermissions === 'function' && typeof plugin.register === 'function' && typeof plugin.addListener === 'function' ? plugin : null;
}

/** The name the shell registers its own push plugin under (apps/mobile/android, TrendlixPushPlugin). */
export const OWN_PUSH_PLUGIN = 'TrendlixPush';

/**
 * The app's own push plugin: whether the APK was built with the Firebase project's settings (google-services.json).
 * Without them Firebase isn't set up, and the Push Notifications plugin's register() and unregister() crash the app, so
 * nothing of push is asked of the phone then.
 */
export interface TrendlixPushPlugin {
  isConfigured(): Promise<{ configured: boolean }>;
}

/** How long the app's own plugin is waited for (it only reads the APK's settings). */
const PUSH_CONFIGURED_WAIT_MS = 5_000;

/**
 * The Push Notifications plugin, only when the shell carries both it and its own plugin, and the APK was built with
 * Firebase's settings (TrendlixPush says configured: true); null otherwise: missing, not configured, refused, too slow.
 * Never rejects.
 */
async function configuredPushPlugin(win: NativeHost | undefined): Promise<PushNotificationsPlugin | null> {
  const plugin = pushPlugin(win);
  if (!plugin || nativePlatform(win) === 'web') return null;
  const own = pluginOf<TrendlixPushPlugin>(OWN_PUSH_PLUGIN, win);
  if (!own || typeof own.isConfigured !== 'function') return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const slow = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), PUSH_CONFIGURED_WAIT_MS);
    });
    const answer = await Promise.race([own.isConfigured(), slow]);
    return answer?.configured === true ? plugin : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The phone's word on the permission, as a status: "prompt-with-rationale" is still a prompt; anything else unknown. */
function statusOf(state: unknown): Exclude<PushStatus, 'unavailable'> | null {
  if (state === 'granted' || state === 'denied' || state === 'prompt') return state;
  return state === 'prompt-with-rationale' ? 'prompt' : null;
}

/**
 * Whether notifications can come to this phone. Outside the app, a shell without the plugins, an APK built without
 * Firebase's settings, or a plugin that can't say: unavailable. Before Android 13 the permission is given with the app,
 * so it is "granted". Never throws.
 */
export async function pushStatus(win: NativeHost | undefined = host()): Promise<PushStatus> {
  const plugin = await configuredPushPlugin(win);
  if (!plugin) return 'unavailable';
  try {
    return statusOf((await plugin.checkPermissions())?.receive) ?? 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Takes a listener off, whether the plugin has given its handle yet or not; never fails. */
function removeLater(handle: Promise<PushListenerHandle> | PushListenerHandle | undefined): void {
  void Promise.resolve(handle)
    .then((h) => h?.remove?.())
    .catch(() => undefined);
}

/**
 * Registers this phone for push notifications, giving its token for the website to register with the API. `ask`: asks
 * the phone's permission when it hasn't been given yet (Android 13 and later's prompt; Home's Turn on), else only when
 * it already is (the app's silent registration on each open, which keeps the token fresh). Makes the app's channel on
 * Android (packages/shared PUSH_CHANNEL, importance high: shown as a heads-up), then waits for the token up to
 * `timeoutMs`. Nothing is asked of the phone in an APK built without Firebase's settings (unavailable). Never throws:
 * refused, failed, too slow or not the app is its reason.
 */
export async function registerForPush(
  options: { ask: boolean },
  win: NativeHost | undefined = host(),
  timeoutMs = PUSH_REGISTER_TIMEOUT_MS,
): Promise<PushRegistration> {
  const plugin = await configuredPushPlugin(win);
  const platform = nativePlatform(win);
  if (!plugin || platform === 'web') return { reason: 'unavailable' };
  try {
    let state = statusOf((await plugin.checkPermissions())?.receive);
    if (state === 'prompt') {
      if (!options.ask) return { reason: 'not_asked' };
      state = statusOf((await plugin.requestPermissions())?.receive);
    }
    if (state === 'denied' || state === 'prompt') return { reason: 'denied' };
    if (state !== 'granted') return { reason: 'failed' };

    if (platform === 'android' && typeof plugin.createChannel === 'function') {
      try {
        await plugin.createChannel({ ...PUSH_CHANNEL, importance: 4, vibration: true });
      } catch {
        // a channel the phone can't make: Android's default channel shows them all the same
      }
    }

    return await new Promise<PushRegistration>((resolve) => {
      const handles: (Promise<PushListenerHandle> | PushListenerHandle)[] = [];
      let done = false;
      const finish = (result: PushRegistration) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        handles.forEach(removeLater);
        resolve(result);
      };
      const timer = setTimeout(() => finish({ reason: 'timeout' }), timeoutMs);
      const listen = async () => {
        handles.push(
          plugin.addListener('registration', ((event: { value?: unknown }) => {
            const token = typeof event?.value === 'string' ? event.value.trim() : '';
            finish(token && token.length <= PUSH_TOKEN_MAX ? { token, platform } : { reason: 'failed' });
          }) as (event: never) => void),
        );
        handles.push(plugin.addListener('registrationError', (() => finish({ reason: 'failed' })) as (event: never) => void));
        await Promise.all(handles);
        if (!done) await plugin.register();
      };
      listen().catch(() => finish({ reason: 'failed' }));
    });
  } catch {
    return { reason: 'failed' };
  }
}

/** A notification's data as strings only (the API sends { link, kind, id }); anything else left out. */
export function pushData(data: unknown): Record<string, string> {
  if (!data || typeof data !== 'object') return {};
  return Object.fromEntries(Object.entries(data as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

/** Listens to one of the plugin's events; the remover takes it off (also before the plugin gave its handle). */
function listenTo(eventName: PushEventName, listener: (event: unknown) => void, win: NativeHost | undefined): () => void {
  const plugin = pushPlugin(win);
  if (!plugin) return () => {};
  let handle: Promise<PushListenerHandle> | PushListenerHandle | undefined;
  try {
    handle = plugin.addListener(eventName, listener as (event: never) => void);
  } catch {
    return () => {};
  }
  // a plugin that refused to listen: nothing to take off
  void Promise.resolve(handle).catch(() => undefined);
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    removeLater(handle);
  };
}

/**
 * Tells `fn` of a notification tapped (in the tray, or the one that opened the app: the plugin keeps it until a listener
 * comes), with its data. Gives the remover; outside the app nothing is listened to.
 */
export function onPushOpened(fn: (data: Record<string, string>) => void, win: NativeHost | undefined = host()): () => void {
  return listenTo('pushNotificationActionPerformed', (event) => fn(pushData((event as { notification?: PushMessage } | null)?.notification?.data)), win);
}

/**
 * Tells `fn` of a notification received while the app is open (the shell shows it in the tray too: capacitor.config.ts
 * presentationOptions). Gives the remover.
 */
export function onPushReceived(fn: (message: { title: string; body: string; data: Record<string, string> }) => void, win: NativeHost | undefined = host()): () => void {
  return listenTo(
    'pushNotificationReceived',
    (event) => {
      const m = (event ?? {}) as PushMessage;
      fn({ title: typeof m.title === 'string' ? m.title : '', body: typeof m.body === 'string' ? m.body : '', data: pushData(m.data) });
    },
    win,
  );
}

/**
 * Stops this phone's push notifications (signing out): the plugin forgets its token, best effort; not in an APK built
 * without Firebase's settings (nothing was registered). Never rejects.
 */
export async function forgetPush(win: NativeHost | undefined = host()): Promise<void> {
  const plugin = await configuredPushPlugin(win);
  try {
    if (plugin && typeof plugin.unregister === 'function') await plugin.unregister();
  } catch {
    // nothing registered, or the plugin failed: the website has unregistered the token with the API anyway
  }
}
