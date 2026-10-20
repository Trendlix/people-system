import { readLocation, LOCATION_GIVE_UP_MS, type LocationResult } from '../app/(app)/my-attendance/check-in';

// The one bridge to the phone's own features (owner, 20 October 2026: "what if we tried to build a mobile app for the
// employees? to enable them to check in and out, and apply for their requests"; apps/mobile/README.md, "The native
// bridge"). Inside the TrendLIX People app, a Capacitor shell showing these pages, `window.Capacitor` is there with the
// plugins the shell carries; in a phone's or a computer's browser it isn't, and each helper falls back to the browser's
// own way. The web app depends on no Capacitor package: the plugins are reached through `window.Capacitor.Plugins`,
// typed here, and every page calls the phone only through this file. Phase 1: where the app runs, and the location for a
// check-in (the Geolocation plugin's when the shell has it, else the browser's). The camera (Phase 2), Face ID /
// fingerprint (Phase 3) and push notifications (Phase 4) are stubs that say they aren't there yet, so the pages can be
// written against them now. No "@/" imports: it is unit tested.

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
 * Where to read the location from: inside the app, the Geolocation plugin when the shell carries it (Phase 2 adds it:
 * better accuracy, and fake GPS reported); else the browser's navigator.geolocation (the app's web view has it too);
 * null when there is neither.
 */
export function geolocationSource(win: NativeHost | undefined = host()): Pick<Geolocation, 'getCurrentPosition'> | null {
  const plugin = pluginOf<GeolocationPlugin>('Geolocation', win);
  if (plugin && typeof plugin.getCurrentPosition === 'function') return pluginAsGeolocation(plugin);
  const geo = win?.navigator?.geolocation;
  return geo && typeof geo.getCurrentPosition === 'function' ? geo : null;
}

/**
 * Where the phone or computer is, read once for a check-in, fresh and as precise as it can within 10 seconds
 * (my-attendance/check-in.ts, LOCATION_OPTIONS). Never fails: refused, unavailable, too slow or not supported is its
 * reason, which the check-in sends instead of a point.
 */
export function getPosition(win: NativeHost | undefined = host(), giveUpMs = LOCATION_GIVE_UP_MS): Promise<LocationResult> {
  return readLocation(geolocationSource(win), giveUpMs);
}

// ---------- later phases (stubs) ----------

/** Why a native feature isn't offered yet: the phase that adds it. */
export const NATIVE_LATER = {
  camera: 'Phase 2: photos from the app’s camera. Until then the file box takes the photo (capture).',
  biometrics: 'Phase 3: Face ID or a fingerprint after the first sign-in with the password.',
  push: 'Phase 4: notifications on the phone. Until then nothing is sent.',
} as const;

/**
 * A photo from the phone's camera, for a receipt or a leave document (Phase 2: the Camera plugin inside the app). Null
 * for now: the page's file box, which opens the camera on a phone (capture="environment"), is the way.
 */
export async function takePhoto(): Promise<File | null> {
  return null;
}

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
