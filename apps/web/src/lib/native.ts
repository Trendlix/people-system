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
// Face ID / fingerprint (Phase 3) and push notifications (Phase 4) are stubs that say they aren't there yet, so the
// pages can be written against them now. No "@/" imports: it is unit tested.

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

// ---------- later phases (stubs) ----------

/** Why a native feature isn't offered yet: the phase that adds it. */
export const NATIVE_LATER = {
  biometrics: 'Phase 3: Face ID or a fingerprint after the first sign-in with the password.',
  push: 'Phase 4: notifications on the phone. Until then nothing is sent.',
} as const;

/** Whether Face ID or a fingerprint can sign in (Phase 3). Not yet: always false. */
export async function canUseBiometrics(): Promise<boolean> {
  return false;
}

/** Asks for Face ID or a fingerprint (Phase 3), saying why. Not yet: always false (not verified). */
export async function verifyBiometrics(reason: string): Promise<boolean> {
  void reason;
  return false;
}

/** Registers the phone for push notifications (Phase 4), giving its token to send to the website. Not yet: null. */
export async function registerForPush(): Promise<{ token: string; platform: 'android' | 'ios' } | null> {
  return null;
}
